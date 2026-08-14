"""Dashboard widget metrics and user widget preferences."""

from __future__ import annotations

import json

import frappe
from frappe.utils import flt

ALLOWED_WIDGETS = [
	"purchases",
	"expenses",
	"stock_value",
	"cash_in_hand",
	"bank_balance",
	"low_stock",
	"whatsapp",
	"google_profile",
]


def _company():
	return frappe.defaults.get_user_default("Company")


def _can_read(doctype: str) -> bool:
	return bool(frappe.has_permission(doctype, "read"))


def _account_balance(account_type: str) -> float:
	if not _can_read("Account"):
		return 0.0
	company = _company()
	filters = {"account_type": account_type, "is_group": 0, "disabled": 0}
	if company:
		filters["company"] = company
	accounts = frappe.get_all("Account", filters=filters, pluck="name")
	if not accounts:
		return 0.0
	try:
		from erpnext.accounts.utils import get_balance_on
	except Exception:
		row = frappe.db.sql(
			"""
			select sum(debit) - sum(credit)
			from `tabGL Entry`
			where is_cancelled = 0 and account in %(accounts)s
			""",
			{"accounts": accounts},
		)
		return flt(row[0][0] if row else 0)

	total = 0.0
	for account in accounts:
		total += flt(get_balance_on(account, company=company))
	return total


def _period_totals(period: str = "This Month", from_date: str = None, to_date: str = None):
	from santu_hardware.santu_hardware.api import (
		_purchase_fetch_expense_rows,
		_sale_resolve_date_range,
	)

	start, end = _sale_resolve_date_range(period, from_date, to_date)
	company = _company()
	pi_where = "docstatus = 1 and posting_date between %s and %s"
	pi_args = [start, end]
	if company:
		pi_where += " and company = %s"
		pi_args.append(company)
	purchases = 0.0
	if _can_read("Purchase Invoice"):
		purchases = flt(
			frappe.db.sql(
				f"select sum(grand_total) from `tabPurchase Invoice` where {pi_where}",
				tuple(pi_args),
			)[0][0]
		)
	expenses = 0.0
	try:
		if _can_read("Payment Entry") or _can_read("Journal Entry"):
			rows = _purchase_fetch_expense_rows(start, end, company)
			expenses = sum(flt(r.get("amount")) for r in rows)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Dashboard expenses total failed")
	return {
		"from_date": str(start),
		"to_date": str(end),
		"purchases": purchases,
		"expenses": expenses,
	}


def get_widget_metrics(period: str = "This Month", from_date: str = None, to_date: str = None) -> dict:
	period_totals = _period_totals(period, from_date, to_date)

	stock_value = 0.0
	if _can_read("Bin") or _can_read("Stock Ledger Entry"):
		company = _company()
		if company:
			stock_value = flt(
				frappe.db.sql(
					"""
					select sum(b.stock_value)
					from `tabBin` b
					inner join `tabWarehouse` w on w.name = b.warehouse
					where w.company = %s
					""",
					(company,),
				)[0][0]
			)
		else:
			stock_value = flt(frappe.db.sql("select sum(stock_value) from `tabBin`")[0][0])

	whatsapp_connected = False
	whatsapp_label = "Connect with Parties"
	try:
		from santu_hardware.santu_hardware.whatsapp_service import get_connection_state

		conn = get_connection_state()
		whatsapp_connected = conn.get("state") == "CONNECTED"
		whatsapp_label = "Connected with Parties" if whatsapp_connected else "Connect with Parties"
	except Exception:
		pass

	google_available = bool(frappe.db.exists("DocType", "Google Settings"))

	return {
		"purchases": period_totals["purchases"],
		"expenses": period_totals["expenses"],
		"stock_value": stock_value,
		"cash_in_hand": _account_balance("Cash"),
		"bank_balance": _account_balance("Bank"),
		"whatsapp_connected": whatsapp_connected,
		"whatsapp_label": whatsapp_label,
		"google_available": google_available,
		"google_label": "Track your business visibility" if google_available else "Not configured",
		"period_from": period_totals["from_date"],
		"period_to": period_totals["to_date"],
	}


def widget_catalog(metrics: dict, low_stock_count: int = 0) -> list:
	return [
		{
			"key": "purchases",
			"title": "Purchases",
			"kind": "currency",
			"value": metrics.get("purchases") or 0,
			"route": "santu-purchase",
		},
		{
			"key": "expenses",
			"title": "Expenses",
			"kind": "currency",
			"value": metrics.get("expenses") or 0,
			"route": "santu-reports",
			"report_id": "expense",
		},
		{
			"key": "stock_value",
			"title": "Stock Value",
			"kind": "currency",
			"value": metrics.get("stock_value") or 0,
			"route": "query-report",
			"report_name": "Stock Balance",
		},
		{
			"key": "cash_in_hand",
			"title": "Cash In Hand",
			"kind": "currency",
			"value": metrics.get("cash_in_hand") or 0,
			"route": "query-report",
			"report_name": "Account Balance",
		},
		{
			"key": "bank_balance",
			"title": "Total Bank Balance",
			"kind": "currency",
			"value": metrics.get("bank_balance") or 0,
			"route": "query-report",
			"report_name": "Account Balance",
		},
		{
			"key": "low_stock",
			"title": "Low Stocks Items",
			"kind": "text",
			"text": "View Items Low on Stock",
			"count": low_stock_count,
			"route": "santu-low-stock",
		},
		{
			"key": "whatsapp",
			"title": "WhatsApp Smart Connect",
			"kind": "text",
			"text": metrics.get("whatsapp_label") or "Connect with Parties",
			"route": "santu-whatsapp-connect",
		},
		{
			"key": "google_profile",
			"title": "Google Profile Manager",
			"kind": "text",
			"text": metrics.get("google_label") or "Not configured",
			"route": "Form",
			"doctype": "Google Settings",
			"available": bool(metrics.get("google_available")),
		},
	]


def get_user_widgets() -> list:
	name = frappe.db.get_value("Santu Dashboard Preference", {"user": frappe.session.user}, "name")
	if not name:
		return []
	raw = frappe.db.get_value("Santu Dashboard Preference", name, "widgets") or "[]"
	try:
		keys = json.loads(raw)
	except Exception:
		keys = []
	return [k for k in keys if k in ALLOWED_WIDGETS]


@frappe.whitelist()
def save_dashboard_widgets(widgets=None):
	if isinstance(widgets, str):
		widgets = frappe.parse_json(widgets)
	keys = [k for k in (widgets or []) if k in ALLOWED_WIDGETS]
	existing = frappe.db.get_value("Santu Dashboard Preference", {"user": frappe.session.user}, "name")
	if existing:
		doc = frappe.get_doc("Santu Dashboard Preference", existing)
	else:
		doc = frappe.new_doc("Santu Dashboard Preference")
		doc.user = frappe.session.user
	doc.widgets = json.dumps(keys)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"widgets": keys}


@frappe.whitelist()
def get_dashboard_widget_data(period: str = "This Month", from_date: str = None, to_date: str = None):
	metrics = get_widget_metrics(period, from_date, to_date)
	return {
		"metrics": metrics,
		"catalog": widget_catalog(metrics),
		"selected": get_user_widgets(),
	}
