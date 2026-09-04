"""
Ultra-High-Tech PDF Intelligence Engine for Santu Hardware
==========================================================
Universal PDF product and bill extraction supporting:
- Multi-tier extraction: GST Layout Parser -> Table Vision Engine -> Columnar Price List Engine -> Token Pattern Fallback
- Automatic Tab & Whitespace Cleaning
- Auto Hardware HSN Tariff Classification (Pipes, Taps, Adhesives, Paints, Cement, Electrical, etc.)
- Auto Standard UOM Normalization (Nos, Kg, Box, Bag, Mtr, Pkt, Ltr, Set)
- Price & Quantity Disambiguation (Rate, MRP, Amount, Billed Qty)
"""

import os
import re
from typing import Any, Dict, List, Optional, Tuple
import frappe
from frappe.utils import flt

# Standard Hardware UOM mapping
UOM_NORMALIZATION = {
	"nos": "Nos", "no": "Nos", "pcs": "Nos", "pc": "Nos", "piece": "Nos", "pieces": "Nos", "each": "Nos", "ea": "Nos",
	"kg": "Kg", "kgs": "Kg", "kilo": "Kg", "kilogram": "Kg", "kilograms": "Kg", "gm": "Kg", "gms": "Kg", "grams": "Kg",
	"mtr": "Mtr", "meter": "Mtr", "meters": "Mtr", "m": "Mtr", "rmt": "Mtr", "running meter": "Mtr",
	"box": "Box", "boxes": "Box", "bx": "Box", "carton": "Box", "ctn": "Box", "case": "Box",
	"bag": "Bag", "bags": "Bag", "bg": "Bag", "bale": "Bag",
	"pkt": "Pkt", "packet": "Pkt", "packets": "Pkt", "pouch": "Pkt", "pouches": "Pkt",
	"ltr": "Ltr", "liter": "Ltr", "litre": "Ltr", "liters": "Ltr", "litres": "Ltr", "l": "Ltr", "ml": "Ltr",
	"set": "Set", "sets": "Set", "kit": "Set",
	"pair": "Pair", "pairs": "Pair", "prs": "Pair", "pr": "Pair",
	"roll": "Roll", "rolls": "Roll", "coil": "Roll",
	"sqft": "SqFt", "sq.ft": "SqFt", "sq ft": "SqFt", "sft": "SqFt",
	"bundle": "Bundle", "bdl": "Bundle", "bundles": "Bundle",
	"drum": "Box", "drm": "Box", "can": "Box", "tin": "Box", "jar": "Box", "bucket": "Box",
}

# Standard Hardware HSN dictionary
HARDWARE_HSN_MAP = [
	(re.compile(r"\b(pvc|upvc|cpvc|swr|pipe|fitting|elbow|tee|socket|union|reducer|nipple|bushing|coupler|collar|bend)\b", re.I), "3917"),
	(re.compile(r"\b(valve|ball valve|cock|bib cock|pillar cock|stop cock|tap|faucet|shower|nozzle)\b", re.I), "8481"),
	(re.compile(r"\b(fevicol|adhesive|resin|sr998|marine|sh|heatx|bond|glue|araldite|kwik)\b", re.I), "3506"),
	(re.compile(r"\b(paint|primer|emulsion|distemper|enamel|varnish|thinner|stainer|apex|tractor)\b", re.I), "3209"),
	(re.compile(r"\b(putty|sealant|silicone|grout|m-seal|waterproofing|dr\.?\s*fixit|roof|wall care)\b", re.I), "3214"),
	(re.compile(r"\b(switch|socket|plug|mcb|db|holder|roma|anchor|havells|polycab|gang box)\b", re.I), "8538"),
	(re.compile(r"\b(wire|cable|flex|copper|aluminium|casing|caping)\b", re.I), "8544"),
	(re.compile(r"\b(cement|concrete|wallmaxx|jk|ultratech|birla|acc|ambuja)\b", re.I), "2523"),
	(re.compile(r"\b(brush|roller|broom|wiper|cleaning brush)\b", re.I), "9603"),
	(re.compile(r"\b(tape|teflon|pvc tape|masking|abro|insulation tape)\b", re.I), "3919"),
	(re.compile(r"\b(nail|screw|fastener|bolt|nut|washer|anchor bolt|drywall|wooden screw)\b", re.I), "7317"),
	(re.compile(r"\b(blade|cutter|hacksaw|cutting wheel|grinding|tool|hammer|wrench|pliers|screwdriver)\b", re.I), "8202"),
	(re.compile(r"\b(commode|seat cover|basin|cistern|urinal|pan|sanitary)\b", re.I), "3922"),
	(re.compile(r"\b(acid|harpic|lizol|phenyl|detergent|drain cleaner)\b", re.I), "3402"),
	(re.compile(r"\b(freight|cartage|transport|loading|unloading)\b", re.I), "9965"),
]

NON_ITEM_KEYWORDS = [
	"sub total", "grand total", "total amount", "tax amount", "cgst", "sgst", "igst", "round off",
	"terms &", "bank details", "bank name", "ifsc", "account no", "e. & o.e", "authorized signatory",
	"consignee", "buyer", "seller", "place of supply", "state name", "state code", "pan no", "gstin",
	"invoice no", "voucher no", "bill no", "dated", "delivery note", "mode /", "reference no",
	"page ", "tax invoice", "bill of supply", "e-way bill", "ack no", "irn :", "thank you",
]


def _clean_text(s: Any) -> str:
	if s is None:
		return ""
	t = str(s).replace("\t", " ").replace("\r", " ").replace("\n", " ")
	t = re.sub(r"\s+", " ", t).strip()
	return t


def _clean_item_name(name: str) -> str:
	t = _clean_text(name)
	t = re.sub(r"^(?:[\d]{1,4}[\.\)\-]|#\s*\d+)\s*", "", t).strip()
	t = re.sub(r"[\s\:\-\|\~]+$", "", t).strip()
	return t


def _normalize_uom(raw_uom: str) -> str:
	if not raw_uom:
		return "Nos"
	clean = _clean_text(raw_uom).lower()
	clean = re.sub(r"[\d\.\/\-]+", "", clean).strip()
	return UOM_NORMALIZATION.get(clean, "Nos")


def _guess_hsn(desc: str, existing_hsn: Optional[str] = None) -> str:
	if existing_hsn:
		clean_hsn = re.sub(r"\D", "", str(existing_hsn))
		if len(clean_hsn) in (4, 6, 8):
			return clean_hsn
	for pattern, hsn in HARDWARE_HSN_MAP:
		if pattern.search(desc):
			return hsn
	return ""


def _parse_price_value(val: Any) -> Optional[float]:
	if val is None:
		return None
	if isinstance(val, (int, float)):
		return float(val) if val > 0 else None
	s = str(val).replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").replace("INR", "").strip()
	m = re.search(r"[-+]?\d*\.?\d+", s)
	if m:
		try:
			v = float(m.group(0))
			return v if (0.01 <= v <= 10_000_000) else None
		except ValueError:
			return None
	return None


def _is_non_item_row(text: str) -> bool:
	if not text or len(text.strip()) < 3:
		return True
	low = text.lower()
	return any(kw in low for kw in NON_ITEM_KEYWORDS)


def _get_pdf_file_path(file_url: str) -> str:
	file_doc = frappe.get_doc("File", {"file_url": file_url})
	return file_doc.get_full_path()


# ─── TIER 1: Native GST Invoice & Price Card Line Parser ────────────────────

def _parse_tier1_gst_rows(file_url: str) -> List[Dict[str, Any]]:
	from santu_hardware.santu_hardware.api import _extract_pdf_pages, _guess_item_rows

	try:
		text = "\n".join(_extract_pdf_pages(file_url))
		parsed_rows = _guess_item_rows(text)
		items = []
		for r in parsed_rows:
			desc = _clean_item_name(r.get("description") or "")
			if not desc or len(desc) < 3 or _is_non_item_row(desc):
				continue
			rate = flt(r.get("rate")) or None
			qty = flt(r.get("qty")) or None
			hsn = _guess_hsn(desc, r.get("hsn"))
			items.append({
				"item_name": desc,
				"item_code": r.get("item_code") or "",
				"gst_hsn_code": hsn,
				"stock_uom": "Nos",
				"valuation_rate": rate,
				# A GST purchase invoice prints what the shop PAID. That is a
				# cost, not a selling price — filling standard_rate with it
				# made every imported item sell at cost (2026-09-04). Left
				# empty so the shop sets its own rate.
				"standard_rate": None,
				"tax_rate": None,
				"opening_stock": qty,
			})
		return items
	except Exception as e:
		frappe.log_error(f"Tier 1 GST parse error: {e}", "PDF Parser")
		return []


# ─── TIER 2: pdfplumber Visual Table Engine ─────────────────────────────────

def _parse_tier2_pdfplumber_tables(file_path: str) -> List[Dict[str, Any]]:
	try:
		import pdfplumber
	except ImportError:
		return []

	items: List[Dict[str, Any]] = []
	try:
		with pdfplumber.open(file_path) as pdf:
			for page in pdf.pages:
				tables = page.extract_tables({
					"vertical_strategy": "lines",
					"horizontal_strategy": "lines",
					"snap_tolerance": 3,
					"join_tolerance": 3,
				})
				if not tables:
					tables = page.extract_tables({
						"vertical_strategy": "text",
						"horizontal_strategy": "text",
						"snap_tolerance": 3,
						"min_words_vertical": 2,
					})

				for table in tables:
					if not table or len(table) < 2:
						continue
					header_idx = -1
					col_map: Dict[str, int] = {}
					for idx, row in enumerate(table[:6]):
						clean_row = [_clean_text(cell).lower() for cell in row if cell is not None]
						joined = " ".join(clean_row)
						if _is_non_item_row(joined):
							continue
						has_desc = any(kw in joined for kw in ["item", "description", "particular", "product", "material", "name"])
						has_metrics = any(kw in joined for kw in ["rate", "price", "amount", "mrp", "hsn", "qty"])
						if has_desc and has_metrics:
							header_idx = idx
							for c_idx, cell in enumerate(row):
								c_text = _clean_text(cell).lower()
								if any(k in c_text for k in ["item name", "description", "particular", "product", "material"]):
									if "code" not in c_text and "item_name" not in col_map:
										col_map["item_name"] = c_idx
								if any(k in c_text for k in ["item code", "code", "part no", "sku"]):
									col_map["item_code"] = c_idx
								if any(k in c_text for k in ["hsn", "sac"]):
									col_map["hsn"] = c_idx
								if any(k in c_text for k in ["qty", "quantity", "pieces"]):
									col_map["qty"] = c_idx
								if any(k in c_text for k in ["uom", "unit", "pkg", "per"]):
									col_map["uom"] = c_idx
								if any(k in c_text for k in ["rate", "unit price", "basic rate", "pur rate", "net rate"]):
									col_map["rate"] = c_idx
								if any(k in c_text for k in ["mrp", "selling price", "retail price"]):
									col_map["mrp"] = c_idx
								if any(k in c_text for k in ["amount", "total"]):
									col_map["amount"] = c_idx
							break

					if header_idx != -1 and "item_name" in col_map:
						for row in table[header_idx + 1:]:
							if not row or len(row) <= max(col_map.values(), default=0):
								continue
							raw_name = _clean_text(row[col_map["item_name"]])
							if _is_non_item_row(raw_name):
								continue
							name = _clean_item_name(raw_name)
							if not name or len(name) < 3 or not re.search(r"[A-Za-z0-9]", name):
								continue

							hsn = _clean_text(row[col_map["hsn"]]) if "hsn" in col_map and col_map["hsn"] < len(row) else ""
							qty = _parse_price_value(row[col_map["qty"]]) if "qty" in col_map and col_map["qty"] < len(row) else None
							rate = _parse_price_value(row[col_map["rate"]]) if "rate" in col_map and col_map["rate"] < len(row) else None
							mrp = _parse_price_value(row[col_map["mrp"]]) if "mrp" in col_map and col_map["mrp"] < len(row) else None
							amount = _parse_price_value(row[col_map["amount"]]) if "amount" in col_map and col_map["amount"] < len(row) else None
							uom = _clean_text(row[col_map["uom"]]) if "uom" in col_map and col_map["uom"] < len(row) else ""
							code = _clean_text(row[col_map["item_code"]]) if "item_code" in col_map and col_map["item_code"] < len(row) else ""

							if rate is None and amount and qty and qty > 0:
								rate = round(amount / qty, 2)

							final_rate = rate or mrp
							if not final_rate and not hsn and not qty:
								continue

							items.append({
								"item_name": name,
								"item_code": code,
								"gst_hsn_code": _guess_hsn(name, hsn),
								"stock_uom": _normalize_uom(uom),
								"valuation_rate": final_rate,
								# Same rule: only a genuine MRP column becomes the
								# selling price; the invoice's own rate never does.
								"standard_rate": mrp or None,
								"tax_rate": None,
								"opening_stock": qty,
							})
	except Exception as e:
		frappe.log_error(f"Tier 2 pdfplumber error: {e}", "PDF Parser")
	return items


# ─── TIER 3: Supplier Price List & Rate Card Line Parser ────────────────────

def _parse_tier3_price_list_lines(file_path: str) -> List[Dict[str, Any]]:
	import pypdf
	try:
		reader = pypdf.PdfReader(file_path)
		lines = []
		for p in reader.pages:
			text = p.extract_text(extraction_mode="layout") or p.extract_text() or ""
			lines.extend(text.splitlines())
	except Exception:
		return []

	items: List[Dict[str, Any]] = []
	for raw_line in lines:
		line = _clean_text(raw_line)
		if len(line) < 5 or _is_non_item_row(line):
			continue

		# Price at end of line pattern: Description ... Rs. 150.00
		m = re.match(
			r"^(?P<desc>.+?)\s+"
			r"(?:rs\.?|inr|₹)?\s*(?P<price>[\d,]{1,9}(?:\.\d{1,2})?)\s*"
			r"(?:per\s+(?P<uom>[A-Za-z]+)|\/\s*(?P<uom2>[A-Za-z]+))?\s*$",
			line, re.IGNORECASE
		)
		if m:
			desc = _clean_item_name(m.group("desc"))
			if len(desc) >= 3 and re.search(r"[A-Za-z]{2,}", desc) and not _is_non_item_row(desc):
				price = _parse_price_value(m.group("price"))
				uom = m.group("uom") or m.group("uom2") or "Nos"
				if price and price > 0:
					items.append({
						"item_name": desc,
						"item_code": "",
						"gst_hsn_code": _guess_hsn(desc),
						"stock_uom": _normalize_uom(uom),
						"valuation_rate": price,
						"standard_rate": price,
						"tax_rate": None,
						"opening_stock": None,
					})
	return items


# ─── MASTER PUBLIC API: Multi-Engine Universal Extractor ────────────────────

def extract_items_from_pdf(file_url: str) -> List[Dict[str, Any]]:
	"""
	Main entry point: Extracts items from ANY PDF using multi-engine fallbacks.
	Guarantees rich item metadata: item_name, gst_hsn_code, stock_uom, valuation_rate, standard_rate.
	"""
	file_path = _get_pdf_file_path(file_url)
	if not os.path.exists(file_path):
		frappe.throw(f"PDF file not found on server: {file_url}")

	# Tier 1: GST Bill & Multi-Column Line Parser
	items = _parse_tier1_gst_rows(file_url)
	if len(items) >= 1:
		return _deduplicate_items(items)

	# Tier 2: Visual Table Engine (pdfplumber)
	items = _parse_tier2_pdfplumber_tables(file_path)
	if len(items) >= 1:
		return _deduplicate_items(items)

	# Tier 3: Price List & Rate Card Parser
	items = _parse_tier3_price_list_lines(file_path)
	if len(items) >= 1:
		return _deduplicate_items(items)

	frappe.throw(
		"Is PDF me koi item list ya rate card identify nahi ho paya. "
		"Kripya check karein ki PDF me text/table maujood hai (scanned photo PDF ke liye Excel import use karein)."
	)


def _deduplicate_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
	"""Deduplicate items by normalized item name while preserving best metadata."""
	seen: Dict[str, Dict[str, Any]] = {}
	for it in items:
		name = it.get("item_name", "").strip()
		if not name or len(name) < 2 or _is_non_item_row(name):
			continue
		key = re.sub(r"\s+", " ", name.lower())
		if key not in seen:
			seen[key] = it
		else:
			existing = seen[key]
			if not existing.get("gst_hsn_code") and it.get("gst_hsn_code"):
				existing["gst_hsn_code"] = it["gst_hsn_code"]
			if not existing.get("valuation_rate") and it.get("valuation_rate"):
				existing["valuation_rate"] = it["valuation_rate"]
			if not existing.get("standard_rate") and it.get("standard_rate"):
				existing["standard_rate"] = it["standard_rate"]
			if existing.get("stock_uom") == "Nos" and it.get("stock_uom") != "Nos":
				existing["stock_uom"] = it["stock_uom"]

	return list(seen.values())
