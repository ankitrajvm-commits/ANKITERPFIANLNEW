"""
Intensive Sale module test suite — run via:
  cd frappe-bench && bench --site site1.local run-tests --module santu_hardware.tests.test_sale_intensive

Or standalone (30 min soak):
  cd frappe-bench/sites && ../env/bin/python ../apps/santu_hardware/santu_hardware/tests/test_sale_intensive.py --soak 1800
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

VIEWS = [
	"invoices",
	"quotation",
	"proforma",
	"delivery_challan",
	"sales_order",
	"sales_return",
	"payment_in",
]

PERIODS = ["Today", "This Week", "This Month", "This Year", "Custom"]


@dataclass
class TestResult:
	name: str
	ok: bool
	detail: str = ""
	duration_ms: int = 0


@dataclass
class TestReport:
	started: str = ""
	ended: str = ""
	results: list[TestResult] = field(default_factory=list)
	errors: list[str] = field(default_factory=list)

	def add(self, r: TestResult):
		self.results.append(r)
		if not r.ok:
			self.errors.append(f"{r.name}: {r.detail}")

	@property
	def passed(self):
		return sum(1 for r in self.results if r.ok)

	@property
	def failed(self):
		return sum(1 for r in self.results if not r.ok)


def _run(name, fn, report: TestReport):
	t0 = time.time()
	try:
		fn()
		ms = int((time.time() - t0) * 1000)
		report.add(TestResult(name, True, "ok", ms))
		return True
	except Exception as e:
		ms = int((time.time() - t0) * 1000)
		report.add(TestResult(name, False, str(e)[:500], ms))
		return False


def run_sale_tests(frappe, report: TestReport):
	from frappe.utils import flt
	from santu_hardware.santu_hardware.api import (
		get_sale_dashboard_data,
		get_sale_invoice_init,
		search_customers_by_name,
		search_products,
		save_sale_invoice,
		get_invoice_view_data,
	)
	from santu_hardware.santu_hardware.transaction_message_service import get_invoice_pdf_bytes
	from santu_hardware.santu_hardware.transaction_message_api import get_send_preview
	from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status

	frappe.set_user("Administrator")

	# 1. Dashboard — all views
	for view in VIEWS:
		def _dash(v=view):
			data = get_sale_dashboard_data(view=v, period="This Month")
			assert "summary" in data, "missing summary"
			assert "transactions" in data, "missing transactions"
			assert "title" in data.get("summary", {}), "missing summary.title"

		_run(f"dashboard.view.{view}", _dash, report)

	# 2. Dashboard periods
	for period in PERIODS:
		def _period(p=period):
			kwargs = {"period": p, "view": "invoices"}
			if p == "Custom":
				kwargs["from_date"] = "2026-01-01"
				kwargs["to_date"] = "2026-08-16"
			data = get_sale_dashboard_data(**kwargs)
			assert isinstance(data.get("transactions"), list)

		_run(f"dashboard.period.{period}", _period, report)

	# 3. Dashboard search
	def _search():
		data = get_sale_dashboard_data(view="invoices", period="This Year", search="chandra")
		assert isinstance(data["transactions"], list)

	_run("dashboard.search", _search, report)

	# 4. Sale invoice init
	def _init():
		data = get_sale_invoice_init()
		assert data.get("company"), "no company"
		assert data.get("warehouse"), "no warehouse"

	_run("sale_invoice.init", _init, report)

	# 5. Customer search
	def _cust():
		rows = search_customers_by_name("chandra")
		assert isinstance(rows, list)

	_run("customer.search", _cust, report)

	# 6. Product search
	def _prod():
		data = search_products("jaguar")
		assert isinstance(data, dict), "expected dict"
		assert isinstance(data.get("results"), list)

	_run("product.search", _prod, report)

	# 7. Create + submit test invoice
	def _save_invoice():
		init = get_sale_invoice_init()
		customer = init.get("default_customer") or "Walk-in Customer"
		db_items = frappe.get_all(
			"Item", filters={"disabled": 0, "is_sales_item": 1}, fields=["name"], limit=1
		)
		if not db_items:
			raise AssertionError("no items in system")
		item_code = db_items[0]["name"]

		from santu_hardware.santu_hardware.api import get_sale_item_row

		row = get_sale_item_row(customer, item_code, init.get("warehouse"), 1)
		rate = flt(row.get("rate")) or flt(row.get("price_list_rate")) or 100
		payload = {
			"customer": customer,
			"company": init["company"],
			"warehouse": init["warehouse"],
			"payment_mode": "cash",
			"mode_of_payment": init.get("default_mode_of_payment") or "Cash",
			"items": [
				{
					"item_code": item_code,
					"qty": 1,
					"rate": rate,
					"warehouse": init["warehouse"],
				}
			],
			"payments": [{"mode_of_payment": init.get("default_mode_of_payment") or "Cash", "amount": rate}],
		}
		inv = save_sale_invoice(json.dumps(payload), submit=1)
		assert inv.get("name"), "invoice not created"
		report._last_invoice = inv["name"]
		report._last_doctype = "Sales Invoice"

	_run("sale_invoice.save_submit", _save_invoice, report)

	# 8. Invoice view data
	if getattr(report, "_last_invoice", None):
		def _view():
			data = get_invoice_view_data(report._last_doctype, report._last_invoice)
			assert data.get("name") == report._last_invoice

		_run("invoice.view_data", _view, report)

	# 9. PDF generation
	inv_name = getattr(report, "_last_invoice", None) or frappe.db.get_value(
		"Sales Invoice", {"docstatus": 1}, "name", order_by="creation desc"
	)
	if inv_name:
		def _pdf():
			doc = frappe.get_doc("Sales Invoice", inv_name)
			b, fn = get_invoice_pdf_bytes(doc)
			assert len(b) > 1000, f"pdf too small: {len(b)}"
			assert fn.endswith(".pdf")

		_run("whatsapp.pdf_generate", _pdf, report)

	# 10. WhatsApp preview
	if inv_name:
		def _wa_preview():
			p = get_send_preview("Sales Invoice", inv_name)
			assert p.get("message"), "no message preview"

		_run("whatsapp.preview", _wa_preview, report)

	# 11. Bridge status
	def _bridge():
		st = read_bridge_status()
		assert st.get("state") in ("CONNECTED", "QR", "DISCONNECTED", "CONNECTING")

	_run("whatsapp.bridge_status", _bridge, report)

	# 12. WhatsApp send (only if connected + party has phone)
	if inv_name:
		def _wa_send():
			st = read_bridge_status()
			if st.get("state") != "CONNECTED":
				raise AssertionError("skip: bridge not connected")
			# Prefer an invoice for a customer that has a mobile number
			phone_inv = frappe.db.sql(
				"""
				SELECT si.name FROM `tabSales Invoice` si
				INNER JOIN `tabCustomer` c ON c.name = si.customer
				WHERE si.docstatus = 1 AND IFNULL(c.mobile_no, '') != ''
				ORDER BY si.creation DESC LIMIT 1
				"""
			)
			target = phone_inv[0][0] if phone_inv else inv_name
			from santu_hardware.santu_hardware.transaction_message_api import send_whatsapp_message

			r = send_whatsapp_message("Sales Invoice", target)
			assert r.get("ok"), r.get("error") or r.get("message")

		_run("whatsapp.send_with_pdf", _wa_send, report)

	# 13. Validation — no customer
	def _val_no_customer():
		try:
			save_sale_invoice(json.dumps({"items": [{"item_code": "X", "qty": 1}]}), submit=0)
			raise AssertionError("should have thrown")
		except Exception as e:
			assert "customer" in str(e).lower()

	_run("validation.no_customer", _val_no_customer, report)

	# 14. Validation — no items
	def _val_no_items():
		try:
			save_sale_invoice(json.dumps({"customer": "Walk-in Customer", "items": []}), submit=0)
			raise AssertionError("should have thrown")
		except Exception as e:
			assert "item" in str(e).lower()

	_run("validation.no_items", _val_no_items, report)

	# 15. Item row rate should not be zero when price list has a rate
	def _item_row_rate():
		init = get_sale_invoice_init()
		customer = "Walk-in Customer"
		item = frappe.db.get_value("Item", {"disabled": 0, "is_sales_item": 1}, "name")
		if not item:
			raise AssertionError("no item")
		from santu_hardware.santu_hardware.api import get_sale_item_row

		row = get_sale_item_row(customer, item, init.get("warehouse"), 1)
		assert flt(row.get("rate")) > 0, f"rate is zero (plr={row.get('price_list_rate')})"

	_run("sale_invoice.item_row_rate", _item_row_rate, report)

	frappe.db.commit()


def print_report(report: TestReport):
	print("\n" + "=" * 60)
	print(f"SALE INTENSIVE TEST — {report.started} → {report.ended}")
	print(f"PASSED: {report.passed}  FAILED: {report.failed}  TOTAL: {len(report.results)}")
	print("=" * 60)
	for r in report.results:
		icon = "✓" if r.ok else "✗"
		print(f"  {icon} [{r.duration_ms:>5}ms] {r.name}" + (f" — {r.detail}" if not r.ok else ""))
	if report.errors:
		print("\nFAILURES:")
		for e in report.errors:
			print(f"  • {e}")
	print("=" * 60 + "\n")


def soak_loop(duration_sec: int, interval_sec: int = 60):
	import os

	import frappe

	os.chdir(str(Path(__file__).resolve().parents[4] / "sites"))
	frappe.init(site="site1.local")
	frappe.connect()

	report = TestReport(started=datetime.now().isoformat())
	deadline = time.time() + duration_sec
	round_num = 0
	while time.time() < deadline:
		round_num += 1
		print(f"\n--- Soak round {round_num} @ {datetime.now().strftime('%H:%M:%S')} ---")
		try:
			run_sale_tests(frappe, report)
		except Exception:
			traceback.print_exc()
		remaining = deadline - time.time()
		if remaining <= 0:
			break
		sleep = min(interval_sec, remaining)
		print(f"Sleeping {int(sleep)}s ({int(remaining)}s remaining)...")
		time.sleep(sleep)

	report.ended = datetime.now().isoformat()
	print_report(report)
	frappe.destroy()
	return 0 if report.failed == 0 else 1


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--soak", type=int, default=0, help="Soak test duration in seconds (e.g. 1800 for 30 min)")
	parser.add_argument("--interval", type=int, default=90, help="Seconds between soak rounds")
	args = parser.parse_args()

	if args.soak:
		return soak_loop(args.soak, args.interval)

	# Single run (for bench run-tests)
	import frappe

	frappe.init(site="site1.local")
	frappe.connect()
	report = TestReport(started=datetime.now().isoformat())
	run_sale_tests(frappe, report)
	report.ended = datetime.now().isoformat()
	print_report(report)
	frappe.destroy()
	return 0 if report.failed == 0 else 1


def run_all():
	import frappe
	report = TestReport(started=datetime.now().isoformat())
	run_sale_tests(frappe, report)
	report.ended = datetime.now().isoformat()
	print_report(report)
	return {"passed": report.passed, "failed": report.failed, "errors": report.errors}


if __name__ == "__main__":
	sys.exit(main())

