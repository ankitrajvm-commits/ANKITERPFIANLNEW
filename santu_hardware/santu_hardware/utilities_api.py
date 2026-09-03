"""Utilities module APIs — import, export, bulk update, audit, Tally."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from santu_hardware.santu_hardware.api import default_selling_warehouse

ITEM_IMPORT_FIELDS = {
	"item_name": "Item Name",
	"item_code": "Item Code",
	"item_group": "Item Group",
	"brand": "Brand",
	"hsn_code": "HSN Code",
	"description": "Description",
	"standard_rate": "Selling Price",
	"valuation_rate": "Purchase Price",
	"custom_mrp": "MRP",
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


def _fold_size_into_item_name(headers: list, rows: list) -> tuple:
	"""No "Size" field exists on Item (2026-09-03 decision: fold size into
	the item name rather than add a schema field), so any uploaded column
	that looks like a size ("Size", "Size (inch)", ...) gets appended onto
	the item-name column's value here, before column mapping is even shown
	— e.g. "SUPREME CPVC REDUCER" + '1" x 3/4"' -> 'SUPREME CPVC REDUCER 1" x 3/4"'.
	Applies to every Excel/CSV item import, not just one file.
	"""
	name_header = next((h for h in headers if h.strip().lower() in ("item name", "item_name", "name")), None)
	size_header = next((h for h in headers if re.match(r"^size\b", h.strip(), re.IGNORECASE)), None)
	if not name_header or not size_header:
		return headers, rows
	for row in rows:
		size_val = str(row.get(size_header) or "").strip()
		if size_val:
			row[name_header] = f"{str(row.get(name_header) or '').strip()} {size_val}".strip()
		row.pop(size_header, None)
	return [h for h in headers if h != size_header], rows


def _drop_dead_columns(headers, rows):
	"""Throw away columns that carry nothing.

	A spreadsheet exported from somewhere else routinely has a spacer column
	between two real ones — no header text, no values, but openpyxl still
	reports it, so it arrived here as a header of "" (2026-09-03: a supplier's
	CPVC sheet came through as Item Name / Size / MRP / SP / "" / Source&nbsp;/&nbsp;Note).
	An unnamed column then drew a dropdown with a blank label on the Map
	Columns screen — a control the operator cannot possibly answer — and,
	because it could never be mapped, it also blocked the one-click path that
	skips mapping entirely when every column is already understood.

	Dropped only when the column is genuinely dead: no header AND no value in
	any row. A blank header over real data is still handed to the operator to
	map, since that is a real column someone forgot to label.
	"""
	dead = []
	for h in headers:
		if str(h or "").strip():
			continue
		if all(str(r.get(h, "") or "").strip() == "" for r in rows):
			dead.append(h)
	if not dead:
		return headers, rows
	for r in rows:
		for h in dead:
			r.pop(h, None)
	return [h for h in headers if h not in dead], rows


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
		headers, data = _drop_dead_columns(headers, data)
		return _fold_size_into_item_name(headers, data)
	if lower.endswith(".csv"):
		text = content.decode("utf-8-sig", errors="replace")
		reader = csv.DictReader(io.StringIO(text))
		headers = reader.fieldnames or []
		rows = list(reader)
		headers, rows = _drop_dead_columns(list(headers), rows)
		return _fold_size_into_item_name(headers, rows)
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


# Short-form column headers sellers actually type in their own price-list
# Excel sheets (e.g. "SP" for Selling Price, "CP"/"PP" for Purchase Price) —
# matched only when the header doesn't already match ITEM_IMPORT_FIELDS'
# fieldname/label exactly, so a same-format re-upload maps every column
# without the user touching a dropdown (2026-09-03 request: "1 click me
# kaam karao, jo v ho excel same format ka hi aayega").
ITEM_IMPORT_FIELD_ALIASES = {
	"sp": "standard_rate",
	"cp": "valuation_rate",
	"pp": "valuation_rate",
	"mrp": "custom_mrp",
	"hsn": "gst_hsn_code",
	"uom": "stock_uom",
	"unit": "stock_uom",
	"qty": "opening_stock",
	"code": "item_code",
	"name": "item_name",
}


@frappe.whitelist()
def parse_items_import_file(file_url: str):
	_require_manager()
	headers, rows = _parse_tabular_file(file_url)
	suggested = {}
	for erp_field, label in ITEM_IMPORT_FIELDS.items():
		for h in headers:
			if h.lower().replace(" ", "_") == erp_field or h.lower() == label.lower():
				suggested[h] = erp_field
	for h in headers:
		if h in suggested:
			continue
		alias_field = ITEM_IMPORT_FIELD_ALIASES.get(h.strip().lower())
		if alias_field:
			suggested[h] = alias_field
	# Columns that are commentary, not item data. A supplier's sheet almost
	# always carries one ("Source / Note", "Remarks", …) and there is no field
	# to map it to — but it used to count as "unmapped", which forced the Map
	# Columns screen even when Item Name / MRP / SP had all been understood
	# on their own, losing the one-click import (2026-09-03 request: "1 click
	# me kaam karao"). The caller treats these as already handled instead of
	# making the operator answer a dropdown whose only sane answer is Skip.
	ignorable = [
		h
		for h in headers
		if h not in suggested and re.search(r"\b(note|notes|source|remark|remarks|comment|comments)\b", h, re.IGNORECASE)
	]
	return {
		"headers": headers,
		"rows": rows[:500],
		"total_rows": len(rows),
		"suggested_mapping": suggested,
		"ignorable_headers": ignorable,
	}


@frappe.whitelist()
def parse_items_import_file_from_pdf(file_url: str):
	"""Ultra-high-tech PDF parser sourcing item catalogs, price lists, and
	GST purchase invoices from ANY PDF layout. Feeds into column mapping,
	validation, and 1-click batch import."""
	_require_manager()
	from santu_hardware.santu_hardware.pdf_extractor import extract_items_from_pdf

	extracted_items = extract_items_from_pdf(file_url)
	if not extracted_items:
		frappe.throw("Is PDF me koi item list ya rate card identify nahi ho paya.")

	headers = ["Item Name", "HSN Code", "Stock Unit (UOM)", "Purchase Price", "Selling Price (MRP)", "Item Code", "Opening Stock"]
	rows = [
		{
			"Item Name": r["item_name"],
			"HSN Code": r.get("gst_hsn_code") or "",
			"Stock Unit (UOM)": r.get("stock_uom") or "Nos",
			"Purchase Price": r.get("valuation_rate") or "",
			"Selling Price (MRP)": r.get("standard_rate") or "",
			"Item Code": r.get("item_code") or "",
			"Opening Stock": r.get("opening_stock") or "",
		}
		for r in extracted_items
	]
	suggested_mapping = {
		"Item Name": "item_name",
		"HSN Code": "gst_hsn_code",
		"Stock Unit (UOM)": "stock_uom",
		"Purchase Price": "valuation_rate",
		"Selling Price (MRP)": "standard_rate",
		"Item Code": "item_code",
		"Opening Stock": "opening_stock",
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
		try:
			if row.get("custom_mrp") not in (None, ""):
				flt(row.get("custom_mrp"))
		except Exception:
			issues.append("Invalid MRP")
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
	warehouse = default_selling_warehouse(company)
	created, failed = [], []

	for entry in rows:
		data = entry.get("data") if isinstance(entry, dict) else entry
		try:
			item_code = (data.get("item_code") or "").strip()
			if not item_code:
				# No Item Code column mapped — generate a real item number the
				# same way quick_create_item does (api.py), not frappe.scrub's
				# lowercase/underscore slug of the name, which isn't a usable
				# item number (2026-08-25 bug: bulk-imported items had "no
				# item number"). Collision-safe with a numeric suffix, same
				# as the quick-create flow.
				slug = re.sub(r"[^A-Za-z0-9]+", "-", data.get("item_name") or "").strip("-").upper() or "ITEM"
				item_code = slug
				suffix = 1
				while frappe.db.exists("Item", item_code):
					suffix += 1
					item_code = f"{slug}-{suffix}"
			elif frappe.db.exists("Item", item_code):
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
			if data.get("custom_mrp") not in (None, ""):
				item.custom_mrp = flt(data.get("custom_mrp"))
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
	page, page_size = cint(page) or 1, min(cint(page_size) or 50, 500)
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

	# Fetch all Item Price rows for these items in two queries (faster than per-item)
	item_names = [it.name for it in items]
	if item_names:
		sell_prices = {
			r.item_code: r.price_list_rate
			for r in frappe.get_all(
				"Item Price",
				filters={"item_code": ["in", item_names], "price_list": "Standard Selling", "selling": 1},
				fields=["item_code", "price_list_rate"],
			)
		}
		buy_prices = {
			r.item_code: r.price_list_rate
			for r in frappe.get_all(
				"Item Price",
				filters={"item_code": ["in", item_names], "price_list": "Standard Buying", "buying": 1},
				fields=["item_code", "price_list_rate"],
			)
		}
	else:
		sell_prices, buy_prices = {}, {}

	for it in items:
		it["barcode"] = frappe.db.get_value("Item Barcode", {"parent": it.name}, "barcode") or ""
		bin_row = frappe.db.get_value("Bin", {"item_code": it.name}, ["actual_qty", "warehouse"], as_dict=True) or {}
		it["actual_qty"] = flt(bin_row.get("actual_qty"))
		it["warehouse"] = bin_row.get("warehouse") or ""
		it["standard_rate"] = flt(sell_prices.get(it.name, it.get("standard_rate") or 0))
		it["valuation_rate"] = flt(buy_prices.get(it.name, it.get("valuation_rate") or 0))

	return {"items": items, "total": total, "page": page, "page_size": page_size}


def _parse_price_list_rows(text: str) -> list:
	"""Parse a simple supplier price list — lines with just item name and price.

	Handles formats like:
	  Asian Putty 25kg      480
	  Birla Putty 25 Kg     ₹704.00
	  1. Washer              2.00 per piece

	Returns list of {"description": str, "rate": float}.
	"""
	import re

	_PRICE_LIST_NON_ITEM = (
		"total", "subtotal", "grand", "gst", "tax", "discount", "hsn", "sac",
		"invoice", "bill no", "date", "thank", "phone", "address", "gstin",
		"page", "rate", "price", "amount", "description", "serial",
	)

	rows = []
	for raw in text.splitlines():
		line = raw.strip()
		if len(line) < 5:
			continue
		low = line.lower()
		if any(kw in low for kw in _PRICE_LIST_NON_ITEM):
			continue

		# Line must end with a price: optional ₹/Rs, digits, optional decimals
		m = re.match(
			r"^(?:\d{1,3}[\.\)]\s*)?(?P<desc>.+?)\s+"
			r"(?:rs\.?|inr|₹)?\s*(?P<price>[\d,]{1,9}(?:\.\d{1,2})?)\s*(?:per\s+\S+)?\s*$",
			line, re.IGNORECASE,
		)
		if not m:
			continue

		desc = re.sub(r"\s+", " ", m.group("desc")).strip()
		if len(desc) < 3 or not re.search(r"[A-Za-z]{3,}", desc):
			continue

		try:
			price = flt(m.group("price").replace(",", ""))
		except ValueError:
			continue
		if price <= 0 or price > 1_000_000:
			continue

		rows.append({"description": desc, "rate": price})

	return rows


@frappe.whitelist()
def match_pdf_items_for_bulk_update(file_url: str):
	"""Match a PDF price list's lines against items already in the
	catalogue, for Update Items In Bulk's "Import from PDF" action."""
	_require_manager()
	from santu_hardware.santu_hardware.pdf_extractor import extract_items_from_pdf
	from santu_hardware.santu_hardware.api import _fuzzy_ratio

	extracted_items = extract_items_from_pdf(file_url)
	if not extracted_items:
		frappe.throw("Is PDF me koi item list ya rate card identify nahi ho paya.")

	items = frappe.get_all("Item", filters={"disabled": 0}, fields=["name", "item_code", "item_name"])
	_THRESHOLD = 0.55

	matched, unmatched_count, seen = [], 0, set()
	for it in extracted_items:
		desc = it["item_name"]
		rate = it.get("valuation_rate") or it.get("standard_rate")
		hsn = it.get("gst_hsn_code")

		best_code, best_score = None, 0.0
		for master in items:
			score = _fuzzy_ratio(desc.lower(), master.item_name.lower())
			if score > best_score:
				best_code, best_score = master.item_code, score

		if best_score >= _THRESHOLD and best_code and best_code not in seen:
			seen.add(best_code)
			item_name = frappe.db.get_value("Item", best_code, "item_name") or desc
			matched.append({"item_code": best_code, "item_name": item_name, "rate": rate, "hsn": hsn})
		else:
			unmatched_count += 1

	return {
		"matched": matched,
		"matched_count": len(matched),
		"unmatched_count": unmatched_count,
		"parser": "universal_ai_pdf_engine",
	}


def _upsert_item_price(item_code: str, price_list: str, rate: float, selling: int = 0, buying: int = 0):
	existing = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": price_list}, "name")
	if existing:
		frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
	else:
		ip = frappe.new_doc("Item Price")
		ip.item_code = item_code
		ip.price_list = price_list
		ip.price_list_rate = rate
		ip.selling = selling
		ip.buying = buying
		ip.insert(ignore_permissions=True)


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
				elif k == "standard_rate":
					_upsert_item_price(name, "Standard Selling", selling=1, rate=flt(v))
					doc.standard_rate = flt(v)
				elif k == "valuation_rate":
					_upsert_item_price(name, "Standard Buying", buying=1, rate=flt(v))
					doc.valuation_rate = flt(v)
				elif k in ["custom_min_selling_price", "custom_mrp"]:
					# Ensure numeric and non-negative
					if v is None or (isinstance(v, (int, float, str)) and float(v) < 0):
						raise ValueError(f"{k} must be a non‑negative number")
					doc.set(k, flt(v))
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
	company = frappe.defaults.get_user_default("Company")
	from santu_hardware.santu_hardware.api import (
		_sale_fetch_si_rows,
		_sale_fetch_pos_rows,
		_purchase_fetch_pi_rows,
	)

	rows = []

	if "Sale" in types:
		for r in _sale_fetch_pos_rows(from_date, to_date, company, is_return=0):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Sale", "payment_type": r.get("payment_type") or "Cash", "amount": flt(r["amount"]), "balance": flt(r["balance"])})
		for r in _sale_fetch_si_rows(from_date, to_date, company, is_return=0):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Sale", "payment_type": r.get("payment_type") or "—", "amount": flt(r["amount"]), "balance": flt(r["balance"])})

	if "Credit Note" in types:
		for r in _sale_fetch_pos_rows(from_date, to_date, company, is_return=1):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Credit Note", "payment_type": r.get("payment_type") or "—", "amount": abs(flt(r["amount"])), "balance": flt(r["balance"])})
		for r in _sale_fetch_si_rows(from_date, to_date, company, is_return=1):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Credit Note", "payment_type": r.get("payment_type") or "—", "amount": abs(flt(r["amount"])), "balance": flt(r["balance"])})

	if "Purchase" in types:
		for r in _purchase_fetch_pi_rows(from_date, to_date, company, is_return=0):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Purchase", "payment_type": r.get("payment_type") or "—", "amount": flt(r["amount"]), "balance": flt(r["balance"])})

	if "Debit Note" in types:
		for r in _purchase_fetch_pi_rows(from_date, to_date, company, is_return=1):
			rows.append({"date": str(r["posting_date"]), "invoice_no": r["invoice_no"], "party": r["party_name"], "type": "Debit Note", "payment_type": r.get("payment_type") or "—", "amount": abs(flt(r["amount"])), "balance": flt(r["balance"])})

	if "Sale Cancelled" in types:
		c_filters = {"docstatus": 2, "posting_date": ["between", [from_date, to_date]]}
		if company:
			c_filters["company"] = company
		for r in frappe.get_all(
			"Sales Invoice",
			filters=c_filters,
			fields=["name", "posting_date", "customer", "grand_total", "santu_bill_no"],
		):
			from santu_hardware.santu_hardware.api import bill_label
			inv_no = bill_label(r.get("santu_bill_no"))
			rows.append({"date": str(r.posting_date), "invoice_no": inv_no, "party": r.customer, "type": "Sale Cancelled", "payment_type": "—", "amount": flt(r.grand_total), "balance": 0})

	rows.sort(key=lambda x: (str(x.get("date") or ""), str(x.get("invoice_no") or "")), reverse=True)
	return {"transactions": rows, "count": len(rows)}


def _generate_tally_xml(transactions, company):
	from xml.sax.saxutils import escape
	esc = escape
	lines = [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<ENVELOPE>',
		'  <HEADER>',
		'    <TALLYREQUEST>Import Data</TALLYREQUEST>',
		'  </HEADER>',
		'  <BODY>',
		'    <IMPORTDATA>',
		'      <REQUESTDESC>',
		'        <REPORTNAME>Vouchers</REPORTNAME>',
		f'        <STATICVARIABLES><SVCURRENTCOMPANY>{esc(company or "Santu Hardware")}</SVCURRENTCOMPANY></STATICVARIABLES>',
		'      </REQUESTDESC>',
		'      <REQUESTDATA>',
	]

	for t in transactions:
		ttype = t.get("type")
		if ttype == "Sale Cancelled":
			continue
		vch_type = "Sales" if ttype == "Sale" else ("Credit Note" if ttype == "Credit Note" else ("Purchase" if ttype == "Purchase" else "Debit Note"))
		date_str = str(t.get("date") or "").replace("-", "")
		inv_no = esc(str(t.get("invoice_no") or ""))
		party = esc(str(t.get("party") or "Cash"))
		abs_amount = abs(flt(t.get("amount")))

		lines.append('        <TALLYMESSAGE xmlns:UDF="TallyUDF">')
		lines.append(f'          <VOUCHER VCHTYPE="{vch_type}" ACTION="Create" OBJVIEW="Accounting Voucher View">')
		lines.append(f'            <DATE>{date_str}</DATE>')
		lines.append(f'            <VOUCHERTYPENAME>{vch_type}</VOUCHERTYPENAME>')
		lines.append(f'            <VOUCHERNUMBER>{inv_no}</VOUCHERNUMBER>')
		lines.append(f'            <PARTYLEDGERNAME>{party}</PARTYLEDGERNAME>')
		lines.append('            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>')

		if ttype in ("Sale", "Credit Note"):
			is_debit = "Yes" if ttype == "Sale" else "No"
			is_credit = "No" if ttype == "Sale" else "Yes"
			lines.append('            <ALLLEDGERENTRIES.LIST>')
			lines.append(f'              <LEDGERNAME>{party}</LEDGERNAME>')
			lines.append(f'              <ISDEEMEDPOSITIVE>{is_debit}</ISDEEMEDPOSITIVE>')
			lines.append(f'              <AMOUNT>{-abs_amount if ttype == "Sale" else abs_amount}</AMOUNT>')
			lines.append('            </ALLLEDGERENTRIES.LIST>')
			lines.append('            <ALLLEDGERENTRIES.LIST>')
			lines.append('              <LEDGERNAME>Sales Account</LEDGERNAME>')
			lines.append(f'              <ISDEEMEDPOSITIVE>{is_credit}</ISDEEMEDPOSITIVE>')
			lines.append(f'              <AMOUNT>{abs_amount if ttype == "Sale" else -abs_amount}</AMOUNT>')
			lines.append('            </ALLLEDGERENTRIES.LIST>')
		elif ttype in ("Purchase", "Debit Note"):
			is_debit = "No" if ttype == "Purchase" else "Yes"
			is_credit = "Yes" if ttype == "Purchase" else "No"
			lines.append('            <ALLLEDGERENTRIES.LIST>')
			lines.append(f'              <LEDGERNAME>{party}</LEDGERNAME>')
			lines.append(f'              <ISDEEMEDPOSITIVE>{is_debit}</ISDEEMEDPOSITIVE>')
			lines.append(f'              <AMOUNT>{abs_amount if ttype == "Purchase" else -abs_amount}</AMOUNT>')
			lines.append('            </ALLLEDGERENTRIES.LIST>')
			lines.append('            <ALLLEDGERENTRIES.LIST>')
			lines.append('              <LEDGERNAME>Purchase Account</LEDGERNAME>')
			lines.append(f'              <ISDEEMEDPOSITIVE>{is_credit}</ISDEEMEDPOSITIVE>')
			lines.append(f'              <AMOUNT>{-abs_amount if ttype == "Purchase" else abs_amount}</AMOUNT>')
			lines.append('            </ALLLEDGERENTRIES.LIST>')

		lines.append('          </VOUCHER>')
		lines.append('        </TALLYMESSAGE>')

	lines.extend([
		'      </REQUESTDATA>',
		'    </IMPORTDATA>',
		'  </BODY>',
		'</ENVELOPE>',
	])
	return "\n".join(lines)


@frappe.whitelist()
def download_tally_export(from_date: str, to_date: str, types: str = None, file_format: str = "xlsx"):
	_require_manager()
	data = get_tally_export_data(from_date, to_date, types)
	company = frappe.defaults.get_user_default("Company") or "Santu Hardware"
	from frappe.utils.file_manager import save_file

	if file_format == "xml":
		xml_content = _generate_tally_xml(data.get("transactions", []), company)
		file_doc = save_file(f"tally-import-{today()}.xml", xml_content.encode("utf-8"), None, None, is_private=0)
		return {"file_url": file_doc.file_url, "count": data.get("count", 0), "format": "xml"}

	headers = ["Date", "Invoice No", "Party", "Transaction Type", "Payment Type", "Amount", "Balance"]
	csv_rows = [headers]
	for r in data.get("transactions", []):
		csv_rows.append([r.get("date"), r.get("invoice_no"), r.get("party"), r.get("type"), r.get("payment_type"), r.get("amount"), r.get("balance")])

	from frappe.utils.xlsxutils import make_xlsx
	xlsx = make_xlsx(csv_rows, "Tally Export")
	file_doc = save_file(f"tally-export-{today()}.xlsx", xlsx.getvalue(), None, None, is_private=0)
	return {"file_url": file_doc.file_url, "count": data.get("count", 0), "format": "xlsx"}


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
		from frappe.utils import get_first_day, today
		from_date, to_date = get_first_day(today()), today()
	from_date, to_date = getdate(from_date), getdate(to_date)

	admin_user = frappe.db.get_value("User", "Administrator", ["name", "full_name"], as_dict=True) or {}
	admin_name = admin_user.get("full_name") or "SANTU HARDWARE"

	# Aggregate all shop sales (Sales Invoice + un-consolidated POS Invoice) for Admin
	si_data = frappe.db.sql(
		"""
		SELECT 
			COUNT(*) as cnt, 
			COALESCE(SUM(grand_total), 0) as total,
			COALESCE(SUM(paid_amount), 0) as paid,
			COALESCE(SUM(outstanding_amount), 0) as outst
		FROM `tabSales Invoice`
		WHERE docstatus = 1 AND is_return = 0 AND posting_date BETWEEN %s AND %s
		""",
		(from_date, to_date),
		as_dict=True,
	)[0]

	pos_data = frappe.db.sql(
		"""
		SELECT 
			COUNT(*) as cnt, 
			COALESCE(SUM(grand_total), 0) as total,
			COALESCE(SUM(paid_amount), 0) as paid,
			COALESCE(SUM(outstanding_amount), 0) as outst
		FROM `tabPOS Invoice`
		WHERE docstatus = 1 AND is_return = 0 AND posting_date BETWEEN %s AND %s
		  AND (consolidated_invoice IS NULL OR consolidated_invoice = '')
		""",
		(from_date, to_date),
		as_dict=True,
	)[0]

	tot_sales = flt(si_data.total) + flt(pos_data.total)
	tot_count = cint(si_data.cnt) + cint(pos_data.cnt)
	tot_paid = flt(si_data.paid) + flt(pos_data.paid)
	tot_outst = flt(si_data.outst) + flt(pos_data.outst)

	rows = [
		{
			"salesman": f"{admin_name} (Administrator)",
			"user_id": "Administrator",
			"total_sales": tot_sales,
			"invoice_count": tot_count,
			"collection": tot_paid,
			"outstanding": tot_outst,
			"role": "Super Admin / Sole Sales Person",
			"rights": "Full Access (All Permissions Granted)",
		}
	]

	return {
		"rows": rows,
		"from_date": str(from_date),
		"to_date": str(to_date),
		"note": "Only Administrator has salesperson access with Full Rights.",
	}


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
		# company_name, not company: `company` here is a Document, and passing
		# a doc where a name is expected produced a MariaDB error about a
		# stored function called "Company".
		"warehouse": default_selling_warehouse(company_name) if company_name else "",
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


# ---------------------------------------------------------------- recycle bin
# Frappe's own restore() is deliberately permissive: it re-inserts whatever
# JSON was stored, and if the document was CANCELLED it quietly re-inserts it
# as a fresh Draft ("Cancelled Document restored as Draft"). For a shop that
# is dangerous rather than helpful — a cancelled bill was cancelled on
# purpose, and bringing it back produces a second document carrying the SAME
# customer-facing bill number as the live one. Found live 2026-08-29: bill
# number 26 existed twice, once submitted (SINV-26-00403) and once as a
# restored draft (SINV-26-00404); submitting that draft would have billed
# Ankit Plumber Rs 1,176.50 twice under one bill number.
#
# The naming series also hands the restored copy a different docname, so the
# operator clicks "restore SINV-26-00401" and silently gets SINV-26-00404.
# This wrapper refuses the cases that cannot end well and reports exactly
# what came back for the ones that can.
SANTU_BILL_DOCTYPES = ("Sales Invoice", "POS Invoice")


def _deleted_doc_label(doctype: str, docname: str, data: str = None) -> str:
	"""How a deleted document should be named back to the operator.

	A deleted bill is gone from its table, so `bill_label`'s live lookup
	finds nothing — the number has to come out of the archived JSON. And a
	bill may never be named by its docname (see api.bill_label), so for
	bills this returns "Bill <number>" and never the SINV name.
	"""
	import json as _json

	if doctype in SANTU_BILL_DOCTYPES:
		from santu_hardware.santu_hardware.api import bill_label

		try:
			bill_no = (_json.loads(data or "{}") or {}).get("santu_bill_no")
		except Exception:
			bill_no = None
		return _("Bill {0}").format(bill_label(bill_no))
	return docname


@frappe.whitelist()
def restore_deleted_document(name: str):
	import json as _json

	frappe.only_for("System Manager")
	deleted = frappe.get_doc("Deleted Document", name)
	if deleted.restored:
		frappe.throw(
			_("{0} pehle hi restore ho chuka hai.").format(
				_deleted_doc_label(deleted.deleted_doctype, deleted.deleted_name, deleted.data)
			)
		)

	data = _json.loads(deleted.data or "{}")
	doctype = deleted.deleted_doctype
	old_name = deleted.deleted_name

	if cint(data.get("docstatus")) == 2:
		frappe.throw(
			_(
				"{0} was cancelled, not lost — cancelled bills are kept for the record and "
				"cannot be brought back. Make a fresh bill instead."
			).format(_deleted_doc_label(doctype, old_name, deleted.data))
		)

	if frappe.db.exists(doctype, old_name):
		frappe.throw(
			_("{0} already maujood hai — restore karne ko kuch nahi.").format(
				_deleted_doc_label(doctype, old_name, deleted.data)
			)
		)

	# Two live documents must never claim the same customer-facing bill number.
	bill_no = cint(data.get("santu_bill_no"))
	if doctype in SANTU_BILL_DOCTYPES and bill_no:
		for dt in SANTU_BILL_DOCTYPES:
			clash = frappe.db.get_value(
				dt, {"santu_bill_no": bill_no, "docstatus": ["<", 2]}, "name"
			)
			if clash:
				frappe.throw(
					_(
						"Bill number {0} is already in use by {1}, so {2} cannot be restored — "
						"there would be two bills with the same number."
					).format(bill_no, clash, old_name)
				)

	from frappe.core.doctype.deleted_document.deleted_document import restore as _restore

	_restore(name, alert=False)
	deleted.reload()

	# What actually came back: the naming series may well have issued a
	# different docname, and the operator deserves to be told which.
	new_name = old_name if frappe.db.exists(doctype, old_name) else None
	if not new_name and bill_no and doctype in SANTU_BILL_DOCTYPES:
		new_name = frappe.db.get_value(
			doctype, {"santu_bill_no": bill_no, "docstatus": ["<", 2]}, "name"
		)
	return {
		"restored": True,
		"doctype": doctype,
		"requested_name": old_name,
		"name": new_name or old_name,
		"renamed": bool(new_name and new_name != old_name),
	}
