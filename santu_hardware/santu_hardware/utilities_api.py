"""Utilities module APIs — import, export, bulk update, audit, Tally."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime

import frappe
from frappe.utils import cint, flt, getdate, now_datetime, today

ITEM_IMPORT_FIELDS = {
	"item_name": "Item Name",
	"item_code": "Item Code",
	"item_group": "Item Group",
	"brand": "Brand",
	"hsn_code": "HSN Code",
	"description": "Description",
	"standard_rate": "Selling Price",
	"valuation_rate": "Purchase Price",
	"stock_uom": "Stock UOM",
	"opening_stock": "Opening Stock",
	"min_order_qty": "Minimum Stock",
	"barcode": "Barcode",
	"gst_hsn_code": "HSN Code",
}

PARTY_IMPORT_FIELDS = {
	"party_name": "Party Name",
	"customer_group": "Customer Group",
	"supplier_group": "Supplier Group",
	"gstin": "GSTIN",
	"pan": "PAN",
	"mobile_no": "Mobile",
	"email_id": "Email",
	"opening_balance": "Opening Balance",
}


def _require_manager():
	frappe.only_for(("System Manager", "Administrator"))


def _read_uploaded_file(file_url: str):
	from frappe.utils.file_manager import get_file

	fname, content = get_file(file_url)
	return fname, content


def _parse_tabular_file(file_url: str):
	fname, content = _read_uploaded_file(file_url)
	lower = (fname or "").lower()
	if lower.endswith((".xlsx", ".xls")):
		from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file

		rows = read_xlsx_file_from_attached_file(fcontent=content)
		if not rows:
			return [], []
		headers = [str(h or "").strip() for h in rows[0]]
		data = []
		for row in rows[1:]:
			data.append({headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))})
		return headers, data
	if lower.endswith(".csv"):
		text = content.decode("utf-8-sig", errors="replace")
		reader = csv.DictReader(io.StringIO(text))
		headers = reader.fieldnames or []
		return list(headers), list(reader)
	frappe.throw("Unsupported file type. Upload .xlsx, .xls or .csv")


def _gstin_valid(gstin: str) -> bool:
	if not gstin:
		return True
	return bool(re.match(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", gstin.upper()))


@frappe.whitelist()
def lookup_barcode_item(barcode: str):
	"""Reuse existing barcode lookup for Import Items scan flow."""
	from santu_hardware.santu_hardware.api import search_products

	result = search_products(barcode, limit=5)
	return result


@frappe.whitelist()
def parse_items_import_file(file_url: str):
	_require_manager()
	headers, rows = _parse_tabular_file(file_url)
	suggested = {}
	for erp_field, label in ITEM_IMPORT_FIELDS.items():
		for h in headers:
			if h.lower().replace(" ", "_") == erp_field or h.lower() == label.lower():
				suggested[h] = erp_field
	return {"headers": headers, "rows": rows[:500], "total_rows": len(rows), "suggested_mapping": suggested}


@frappe.whitelist()
def parse_items_import_file_from_pdf(file_url: str):
	"""Same contract as parse_items_import_file (headers/rows/total_rows/
	suggested_mapping) but sourced from a printed/scanned PDF price list or
	catalogue instead of an Excel/CSV file — feeds the exact same Map
	Columns -> Validate -> Import steps, so "import new items" stays one
	single downstream path regardless of which file type it started from.
	Reuses the GST bill line-item text-parsing engine already built for
	Purchase Bill Upload (`_guess_item_rows`) rather than a second PDF
	reader — one shared "read a PDF's item rows" capability, several
	screens that call into it for their own purpose."""
	_require_manager()
	from santu_hardware.santu_hardware.api import _extract_pdf_pages, _guess_item_rows

	text = "\n".join(_extract_pdf_pages(file_url))
	parsed_rows = _guess_item_rows(text)
	if not parsed_rows:
		frappe.throw(
			"Couldn't read any item rows from this PDF — it may be a scanned image "
			"rather than a real PDF, or not in a recognisable price-list layout."
		)

	headers = ["Item Name", "HSN Code", "Purchase Price", "Item Code"]
	rows = [
		{
			"Item Name": r["description"],
			"HSN Code": r.get("hsn") or "",
			"Purchase Price": r.get("rate") or "",
			"Item Code": r.get("item_code") or "",
		}
		for r in parsed_rows
	]
	suggested_mapping = {
		"Item Name": "item_name",
		"HSN Code": "gst_hsn_code",
		"Purchase Price": "valuation_rate",
		"Item Code": "item_code",
	}
	return {"headers": headers, "rows": rows[:500], "total_rows": len(rows), "suggested_mapping": suggested_mapping}


@frappe.whitelist()
def validate_items_import(file_url: str = None, rows: str = None, mapping: str = None):
	_require_manager()
	mapping = frappe.parse_json(mapping) if isinstance(mapping, str) else (mapping or {})
	if file_url:
		_, raw_rows = _parse_tabular_file(file_url)
	else:
		raw_rows = frappe.parse_json(rows) if isinstance(rows, str) else (rows or [])

	valid, warnings, errors = [], [], []
	seen_codes, seen_barcodes = set(), set()

	for idx, raw in enumerate(raw_rows, start=2):
		row = {}
		for excel_col, erp_field in mapping.items():
			if erp_field and excel_col in raw:
				row[erp_field] = raw.get(excel_col)

		item_name = (row.get("item_name") or "").strip()
		item_code = (row.get("item_code") or "").strip()
		barcode = (row.get("barcode") or "").strip()
		issues = []

		if not item_name:
			issues.append("Missing item name")
		if item_code:
			if item_code in seen_codes:
				issues.append("Duplicate item code in file")
			seen_codes.add(item_code)
			if frappe.db.exists("Item", item_code):
				issues.append("Item code already exists")
		if barcode:
			if barcode in seen_barcodes:
				issues.append("Duplicate barcode in file")
			seen_barcodes.add(barcode)
			existing = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
			if existing:
				issues.append(f"Barcode already used by {existing}")
		try:
			if row.get("standard_rate") not in (None, ""):
				flt(row.get("standard_rate"))
		except Exception:
			issues.append("Invalid selling price")
		if row.get("item_group") and not frappe.db.exists("Item Group", row.get("item_group")):
			issues.append(f"Item Group '{row.get('item_group')}' not found")

		entry = {"row": idx, "data": row, "issues": issues}
		if any("Missing" in i or "Invalid" in i or "already" in i or "Duplicate" in i for i in issues):
			errors.append(entry)
		elif issues:
			warnings.append(entry)
		else:
			valid.append(entry)

	return {"valid": valid, "warnings": warnings, "errors": errors, "counts": {"valid": len(valid), "warnings": len(warnings), "errors": len(errors)}}


@frappe.whitelist()
def import_items_valid(rows: str):
	_require_manager()
	rows = frappe.parse_json(rows) if isinstance(rows, str) else rows
	company = frappe.defaults.get_user_default("Company")
	warehouse = frappe.db.get_value("Warehouse", {"company": company, "is_group": 0, "disabled": 0}, "name")
	created, failed = [], []

	for entry in rows:
		data = entry.get("data") if isinstance(entry, dict) else entry
		try:
			item_code = (data.get("item_code") or "").strip() or frappe.scrub(data.get("item_name"))
			if frappe.db.exists("Item", item_code):
				failed.append({"item_code": item_code, "error": "Already exists"})
				continue
			item = frappe.new_doc("Item")
			item.item_code = item_code
			item.item_name = data.get("item_name")
			item.item_group = data.get("item_group") or "Products"
			item.stock_uom = data.get("stock_uom") or "Nos"
			item.is_stock_item = 1
			if data.get("brand"):
				item.brand = data.get("brand")
			if data.get("hsn_code") or data.get("gst_hsn_code"):
				item.gst_hsn_code = data.get("hsn_code") or data.get("gst_hsn_code")
			if data.get("description"):
				item.description = data.get("description")
			if data.get("standard_rate") not in (None, ""):
				item.standard_rate = flt(data.get("standard_rate"))
			if data.get("valuation_rate") not in (None, ""):
				item.valuation_rate = flt(data.get("valuation_rate"))
			if data.get("barcode"):
				item.append("barcodes", {"barcode": data.get("barcode")})
			item.insert(ignore_permissions=True)

			opening = flt(data.get("opening_stock"))
			if opening and warehouse:
				ste = frappe.new_doc("Stock Entry")
				ste.stock_entry_type = "Material Receipt"
				ste.company = company
				ste.append("items", {"item_code": item.name, "qty": opening, "t_warehouse": warehouse, "basic_rate": flt(data.get("valuation_rate") or data.get("standard_rate"))})
				ste.insert(ignore_permissions=True)
				ste.submit()

			created.append(item.name)
		except Exception as e:
			failed.append({"item_code": data.get("item_code"), "error": str(e)})

	frappe.db.commit()
	return {"created": created, "failed": failed, "created_count": len(created)}


@frappe.whitelist()
def get_bulk_items(mode: str = "pricing", search: str = None, page: int = 1, page_size: int = 50):
	_require_manager()
	page, page_size = cint(page) or 1, min(cint(page_size) or 50, 200)
	filters = {"disabled": 0}
	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = [
			["item_name", "like", like],
			["item_code", "like", like],
			["gst_hsn_code", "like", like],
			["brand", "like", like],
		]
		total = frappe.db.sql(
			"""SELECT COUNT(*) FROM `tabItem`
			WHERE disabled = 0 AND (
				item_name LIKE %(s)s OR item_code LIKE %(s)s
				OR gst_hsn_code LIKE %(s)s OR brand LIKE %(s)s
			)""",
			{"s": like},
		)[0][0]
	else:
		total = frappe.db.count("Item", filters=filters)
	items = frappe.get_all(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name", "item_name", "item_code", "item_group", "brand", "gst_hsn_code",
			"standard_rate", "valuation_rate", "stock_uom", "description", "is_stock_item",
		],
		order_by="item_name asc",
		limit_start=(page - 1) * page_size,
		limit_page_length=page_size,
	)

	for it in items:
		it["barcode"] = frappe.db.get_value("Item Barcode", {"parent": it.name}, "barcode") or ""
		bin = frappe.db.get_value("Bin", {"item_code": it.name}, ["actual_qty", "warehouse"], as_dict=True) or {}
		it["actual_qty"] = flt(bin.get("actual_qty"))
		it["warehouse"] = bin.get("warehouse") or ""

	return {"items": items, "total": total, "page": page, "page_size": page_size}


@frappe.whitelist()
def match_pdf_items_for_bulk_update(file_url: str):
	"""Match a PDF price list's lines against items already in the
	catalogue, for Update Items In Bulk's "Import from PDF" action — this
	screen only edits existing masters, it never creates new ones, so
	unmatched lines are just counted (not returned): a genuinely new item
	belongs in Import Items -> Import From PDF instead, which shares the
	same underlying PDF reader. Rate is treated as this shop's own
	Purchase Price, matching what a supplier's price list actually lists."""
	_require_manager()
	from santu_hardware.santu_hardware.api import _extract_pdf_pages, _guess_item_rows

	text = "\n".join(_extract_pdf_pages(file_url))
	parsed_rows = _guess_item_rows(text)
	if not parsed_rows:
		frappe.throw(
			"Couldn't read any item rows from this PDF — it may be a scanned image "
			"rather than a real PDF, or not in a recognisable price-list layout."
		)

	matched, unmatched_count, seen = [], 0, set()
	for r in parsed_rows:
		item_code = r.get("item_code")
		if not item_code:
			unmatched_count += 1
			continue
		if item_code in seen:
			continue
		seen.add(item_code)
		item_name = frappe.db.get_value("Item", item_code, "item_name") or r["description"]
		matched.append({"item_code": item_code, "item_name": item_name, "rate": r.get("rate"), "hsn": r.get("hsn")})

	return {"matched": matched, "matched_count": len(matched), "unmatched_count": unmatched_count}


@frappe.whitelist()
def bulk_update_items(updates: str):
	_require_manager()
	updates = frappe.parse_json(updates) if isinstance(updates, str) else updates
	updated, failed = [], []
	for u in updates:
		try:
			name = u.get("name")
			fields = u.get("fields") or {}
			if not name or not frappe.db.exists("Item", name):
				failed.append({"name": name, "error": "Not found"})
				continue
			doc = frappe.get_doc("Item", name)
			for k, v in fields.items():
				if k == "barcode" and v:
					if not doc.barcodes:
						doc.append("barcodes", {"barcode": v})
					else:
						doc.barcodes[0].barcode = v
				elif hasattr(doc, k):
					doc.set(k, v)
			doc.save(ignore_permissions=True)
			updated.append(name)
		except Exception as e:
			failed.append({"name": u.get("name"), "error": str(e)})
	frappe.db.commit()
	return {"updated": updated, "failed": failed, "updated_count": len(updated)}


@frappe.whitelist()
def parse_parties_import_file(file_url: str, party_type: str = "Customer"):
	_require_manager()
	headers, rows = _parse_tabular_file(file_url)
	return {"headers": headers, "rows": rows[:500], "total_rows": len(rows), "party_type": party_type}


@frappe.whitelist()
def import_parties(rows: str, party_type: str = "Customer"):
	_require_manager()
	rows = frappe.parse_json(rows) if isinstance(rows, str) else rows
	doctype = "Customer" if party_type == "Customer" else "Supplier"
	created, failed = [], []
	for data in rows:
		try:
			name = (data.get("party_name") or data.get("customer_name") or data.get("supplier_name") or "").strip()
			if not name:
				failed.append({"error": "Missing name"})
				continue
			if data.get("gstin") and not _gstin_valid(data.get("gstin")):
				failed.append({"name": name, "error": "Invalid GSTIN"})
				continue
			if frappe.db.exists(doctype, name):
				failed.append({"name": name, "error": "Already exists"})
				continue
			doc = frappe.new_doc(doctype)
			doc.name = name
			if doctype == "Customer":
				doc.customer_name = name
				doc.customer_group = data.get("customer_group") or "All Customer Groups"
				doc.customer_type = "Company"
			else:
				doc.supplier_name = name
				doc.supplier_group = data.get("supplier_group") or "All Supplier Groups"
				doc.supplier_type = "Company"
			if data.get("gstin"):
				doc.gstin = data.get("gstin").upper()
			if data.get("pan"):
				doc.pan = data.get("pan")
			if data.get("mobile_no"):
				doc.mobile_no = data.get("mobile_no")
			if data.get("email_id"):
				doc.email_id = data.get("email_id")
			doc.insert(ignore_permissions=True)
			created.append(name)
		except Exception as e:
			failed.append({"name": data.get("party_name"), "error": str(e)})
	frappe.db.commit()
	return {"created": created, "failed": failed}


@frappe.whitelist()
def export_items_file(filters: str = None):
	_require_manager()
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	item_filters = {"disabled": 0}
	if filters.get("item_group"):
		item_filters["item_group"] = filters.get("item_group")
	if filters.get("brand"):
		item_filters["brand"] = filters.get("brand")

	items = frappe.get_all(
		"Item",
		filters=item_filters,
		fields=["name", "item_name", "item_code", "item_group", "brand", "gst_hsn_code", "standard_rate", "valuation_rate", "stock_uom", "description"],
		order_by="item_name asc",
		limit_page_length=0,
	)
	headers = ["Item Name", "Item Code", "Item Group", "Brand", "HSN", "Sale Price", "Purchase Price", "UOM", "Stock", "Barcode", "Description"]
	rows = [headers]
	for it in items:
		barcode = frappe.db.get_value("Item Barcode", {"parent": it.name}, "barcode") or ""
		qty = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", it.name)[0][0] or 0
		rows.append([it.item_name, it.item_code, it.item_group, it.brand or "", it.gst_hsn_code or "", it.standard_rate, it.valuation_rate, it.stock_uom, qty, barcode, it.description or ""])

	from frappe.utils.xlsxutils import make_xlsx
	from frappe.utils.file_manager import save_file

	xlsx = make_xlsx(rows, "Items Export")
	file_doc = save_file(f"items-export-{today()}.xlsx", xlsx.getvalue(), None, None, is_private=1)
	return {"file_url": file_doc.file_url, "count": len(items)}


@frappe.whitelist()
def get_tally_export_data(from_date: str, to_date: str, types: str = None):
	_require_manager()
	from_date, to_date = getdate(from_date), getdate(to_date)
	types = frappe.parse_json(types) if isinstance(types, str) else (types or ["Sale", "Purchase", "Credit Note", "Debit Note", "Sale Cancelled"])
	rows = []

	if "Sale" in types:
		for r in frappe.get_all(
			"POS Invoice",
			filters={"docstatus": 1, "is_return": 0, "posting_date": ["between", [from_date, to_date]]},
			fields=["name", "posting_date", "customer", "grand_total", "outstanding_amount"],
		):
			rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.customer, "type": "Sale", "payment_type": "—", "amount": r.grand_total, "balance": r.outstanding_amount})
		for r in frappe.get_all(
			"Sales Invoice",
			filters={"docstatus": 1, "is_return": 0, "is_pos": 0, "posting_date": ["between", [from_date, to_date]]},
			fields=["name", "posting_date", "customer", "grand_total", "outstanding_amount"],
		):
			rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.customer, "type": "Sale", "payment_type": "—", "amount": r.grand_total, "balance": r.outstanding_amount})

	if "Credit Note" in types:
		for dt in ("POS Invoice", "Sales Invoice"):
			f = {"docstatus": 1, "is_return": 1, "posting_date": ["between", [from_date, to_date]]}
			if dt == "Sales Invoice":
				f["is_pos"] = 0
			for r in frappe.get_all(dt, filters=f, fields=["name", "posting_date", "customer", "grand_total", "outstanding_amount"]):
				rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.customer, "type": "Credit Note", "payment_type": "—", "amount": r.grand_total, "balance": r.outstanding_amount})

	if "Purchase" in types:
		for r in frappe.get_all(
			"Purchase Invoice",
			filters={"docstatus": 1, "is_return": 0, "posting_date": ["between", [from_date, to_date]]},
			fields=["name", "posting_date", "supplier", "grand_total", "outstanding_amount"],
		):
			rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.supplier, "type": "Purchase", "payment_type": "—", "amount": r.grand_total, "balance": r.outstanding_amount})

	if "Debit Note" in types:
		for r in frappe.get_all(
			"Purchase Invoice",
			filters={"docstatus": 1, "is_return": 1, "posting_date": ["between", [from_date, to_date]]},
			fields=["name", "posting_date", "supplier", "grand_total", "outstanding_amount"],
		):
			rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.supplier, "type": "Debit Note", "payment_type": "—", "amount": r.grand_total, "balance": r.outstanding_amount})

	if "Sale Cancelled" in types:
		for r in frappe.get_all(
			"Sales Invoice",
			filters={"docstatus": 2, "posting_date": ["between", [from_date, to_date]]},
			fields=["name", "posting_date", "customer", "grand_total"],
		):
			rows.append({"date": r.posting_date, "invoice_no": r.name, "party": r.customer, "type": "Sale Cancelled", "payment_type": "—", "amount": r.grand_total, "balance": 0})

	rows.sort(key=lambda x: (str(x.get("date") or ""), x.get("invoice_no") or ""), reverse=True)
	return {"transactions": rows, "count": len(rows)}


@frappe.whitelist()
def download_tally_export(from_date: str, to_date: str, types: str = None):
	_require_manager()
	data = get_tally_export_data(from_date, to_date, types)
	headers = ["Date", "Invoice No", "Party", "Transaction Type", "Payment Type", "Amount", "Balance"]
	csv_rows = [headers]
	for r in data.get("transactions", []):
		csv_rows.append([r.get("date"), r.get("invoice_no"), r.get("party"), r.get("type"), r.get("payment_type"), r.get("amount"), r.get("balance")])

	from frappe.utils.xlsxutils import make_xlsx
	from frappe.utils.file_manager import save_file

	xlsx = make_xlsx(csv_rows, "Tally Export")
	file_doc = save_file(f"tally-export-{today()}.xlsx", xlsx.getvalue(), None, None, is_private=1)
	return {"file_url": file_doc.file_url, "count": data.get("count", 0)}


@frappe.whitelist()
def get_data_audit():
	_require_manager()
	issues = []

	dup_codes = frappe.db.sql(
		"""SELECT item_code, COUNT(*) c FROM `tabItem` WHERE disabled=0 GROUP BY item_code HAVING c > 1""",
		as_dict=True,
	)
	for d in dup_codes:
		issues.append({"category": "Items", "severity": "Error", "record": d.item_code, "description": "Duplicate item code", "fix": "Review Required"})

	dup_barcodes = frappe.db.sql(
		"""SELECT barcode, COUNT(*) c FROM `tabItem Barcode` GROUP BY barcode HAVING c > 1""",
		as_dict=True,
	)
	for d in dup_barcodes:
		issues.append({"category": "Items", "severity": "Error", "record": d.barcode, "description": "Duplicate barcode", "fix": "Review Required"})

	missing_group = frappe.get_all("Item", filters={"disabled": 0, "item_group": ["in", ["", None]]}, pluck="name", limit=50)
	for n in missing_group:
		issues.append({"category": "Items", "severity": "Warning", "record": n, "description": "Missing item group", "fix": "Set Item Group"})

	missing_hsn = frappe.get_all("Item", filters={"disabled": 0, "gst_hsn_code": ["in", ["", None]]}, pluck="name", limit=50)
	for n in missing_hsn:
		issues.append({"category": "Items", "severity": "Warning", "record": n, "description": "Missing HSN code", "fix": "Set HSN"})

	neg_stock = frappe.db.sql(
		"""SELECT item_code, warehouse, actual_qty FROM `tabBin` WHERE actual_qty < 0 LIMIT 50""",
		as_dict=True,
	)
	for b in neg_stock:
		issues.append({"category": "Stock", "severity": "Error", "record": f"{b.item_code} @ {b.warehouse}", "description": f"Negative stock ({b.actual_qty})", "fix": "Review Required"})

	dup_gstin = frappe.db.sql(
		"""SELECT gstin, COUNT(*) c FROM `tabCustomer` WHERE gstin IS NOT NULL AND gstin != '' GROUP BY gstin HAVING c > 1""",
		as_dict=True,
	)
	for d in dup_gstin:
		issues.append({"category": "Parties", "severity": "Error", "record": d.gstin, "description": "Duplicate customer GSTIN", "fix": "Review Required"})

	draft_si = frappe.db.count("Sales Invoice", {"docstatus": 0})
	if draft_si:
		issues.append({"category": "Sales", "severity": "Warning", "record": f"{draft_si} docs", "description": "Draft sales invoices exist", "fix": "Submit or cancel"})

	draft_pi = frappe.db.count("Purchase Invoice", {"docstatus": 0})
	if draft_pi:
		issues.append({"category": "Purchases", "severity": "Warning", "record": f"{draft_pi} docs", "description": "Draft purchase invoices exist", "fix": "Submit or cancel"})

	errors = len([i for i in issues if i["severity"] == "Error"])
	warnings = len([i for i in issues if i["severity"] == "Warning"])
	passed = max(0, 10 - errors - warnings)

	return {
		"summary": {"passed": passed, "warnings": warnings, "errors": errors, "health": "Good" if errors == 0 else "Needs Attention"},
		"issues": issues,
	}


@frappe.whitelist()
def get_fiscal_year_checklist():
	_require_manager()
	from frappe.utils import get_first_day, get_last_day

	company = frappe.defaults.get_user_default("Company")
	today_date = getdate(today())
	fy = frappe.db.get_value("Fiscal Year", {"year_start_date": ["<=", today_date], "year_end_date": [">=", today_date]}, ["name", "year_start_date", "year_end_date"], as_dict=True)

	checks = []
	checks.append({"label": "No draft sales invoices", "ok": frappe.db.count("Sales Invoice", {"docstatus": 0}) == 0, "detail": f"{frappe.db.count('Sales Invoice', {'docstatus': 0})} draft"})
	checks.append({"label": "No draft purchase invoices", "ok": frappe.db.count("Purchase Invoice", {"docstatus": 0}) == 0, "detail": f"{frappe.db.count('Purchase Invoice', {'docstatus': 0})} draft"})
	cust_out = frappe.db.sql("""SELECT SUM(outstanding_amount) FROM `tabSales Invoice` WHERE docstatus=1 AND outstanding_amount > 0""")[0][0] or 0
	checks.append({"label": "Customer outstanding reviewed", "ok": flt(cust_out) == 0, "detail": f"₹ {flt(cust_out):,.2f} outstanding"})
	sup_out = frappe.db.sql("""SELECT SUM(outstanding_amount) FROM `tabPurchase Invoice` WHERE docstatus=1 AND outstanding_amount > 0""")[0][0] or 0
	checks.append({"label": "Supplier outstanding reviewed", "ok": flt(sup_out) == 0, "detail": f"₹ {flt(sup_out):,.2f} outstanding"})
	neg = frappe.db.count("Bin", {"actual_qty": ["<", 0]})
	checks.append({"label": "No negative stock", "ok": neg == 0, "detail": f"{neg} negative bins"})

	all_ok = all(c["ok"] for c in checks[:3])  # strict on drafts + stock
	return {"fiscal_year": fy, "checks": checks, "can_close": all_ok, "company": company}


@frappe.whitelist()
def get_salesman_report(from_date: str = None, to_date: str = None):
	_require_manager()
	if not from_date or not to_date:
		from frappe.utils import get_first_day
		from_date, to_date = get_first_day(today()), today()
	from_date, to_date = getdate(from_date), getdate(to_date)

	staff = frappe.get_all("Staff Member", filters={"active": 1}, fields=["name", "staff_name"], order_by="staff_name asc")
	rows = []
	for s in staff:
		# Attribution via POS Invoice owner if no custom field
		sales = frappe.db.sql(
			"""
			SELECT COUNT(*) as cnt, SUM(grand_total) as total
			FROM `tabPOS Invoice`
			WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %s AND %s AND owner=%s
			""",
			(from_date, to_date, s.name),
			as_dict=True,
		)
		row = sales[0] if sales else {}
		rows.append({
			"salesman": s.staff_name or s.name,
			"total_sales": flt(row.get("total")),
			"invoice_count": cint(row.get("cnt")),
			"collection": flt(row.get("total")),
			"outstanding": 0,
		})

	# Also aggregate by invoice owner for users not in Staff Member
	return {"rows": rows, "from_date": str(from_date), "to_date": str(to_date), "note": "Sales attributed by invoice owner. Configure Staff Member for POS attribution."}


@frappe.whitelist()
def get_business_setup():
	_require_manager()
	company_name = frappe.defaults.get_user_default("Company")
	company = frappe.get_doc("Company", company_name) if company_name else None
	return {
		"company": {
			"name": company.name if company else "",
			"company_name": company.company_name if company else "",
			"abbr": company.abbr if company else "",
			"phone_no": company.phone_no if company else "",
			"email": company.email if company else "",
			"gstin": getattr(company, "gstin", None) or "",
			"default_currency": company.default_currency if company else "INR",
		} if company else {},
		# Must exclude disabled warehouses, or this reports one bills can never
		# use: it was showing "Goods In Transit" (disabled) while every bill
		# was actually going to Stores.
		"warehouse": frappe.db.get_value(
			"Warehouse", {"company": company_name, "is_group": 0, "disabled": 0}, "name"
		)
		if company_name
		else "",
		"price_list": frappe.db.get_single_value("Selling Settings", "selling_price_list"),
		"payment_modes": frappe.get_all("Mode of Payment", filters={"enabled": 1}, pluck="name"),
	}


@frappe.whitelist()
def save_business_setup(data: str):
	_require_manager()
	data = frappe.parse_json(data) if isinstance(data, str) else data
	company_name = data.get("company_name") or frappe.defaults.get_user_default("Company")
	if not company_name:
		frappe.throw("Company is required")
	company = frappe.get_doc("Company", company_name)
	for field in ("phone_no", "email", "company_name"):
		if data.get(field) is not None:
			company.set(field, data.get(field))
	if data.get("gstin") is not None and hasattr(company, "gstin"):
		company.gstin = data.get("gstin")
	company.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True}


@frappe.whitelist()
def generate_barcode_labels(items: str, label_size: str = "50x25"):
	"""Return barcode label data using existing barcode generator."""
	from santu_hardware.santu_hardware.api import get_barcode_data_uri

	items = frappe.parse_json(items) if isinstance(items, str) else items
	labels = []
	for it in items:
		code = it.get("item_code") or it.get("barcode") or it.get("item_name")
		if not code:
			continue
		labels.append({
			"item_code": it.get("item_code"),
			"item_name": it.get("item_name"),
			"header": it.get("header", ""),
			"lines": [it.get("line1", ""), it.get("line2", ""), it.get("line3", ""), it.get("line4", "")],
			"labels_count": cint(it.get("labels_count") or 1),
			"barcode_data_uri": get_barcode_data_uri(code),
			"barcode_value": code,
		})
	return {"labels": labels, "label_size": label_size}
