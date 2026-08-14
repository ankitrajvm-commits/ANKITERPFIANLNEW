import base64
import difflib
import io

import frappe
from frappe import _
from frappe.utils import cint, flt


@frappe.whitelist()
def fix_stock(item_code: str, new_qty: float, reason: str):
	"""Quick stock correction — UX_STRATEGY.md SS4.5.

	Deliberately thin: one item, one warehouse (this shop has exactly one),
	a new quantity, and a reason. Posts as a real Stock Reconciliation under
	the hood (native ERPNext stock-ledger logic, not reinvented here) so the
	accounting/valuation impact is correct — this endpoint only removes the
	multi-item bulk-reconciliation form that a single fix doesn't need.
	"""
	if not item_code or new_qty in (None, "") or not reason:
		frappe.throw(_("Item, new quantity, and reason are all required."))

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")
	if not warehouse:
		frappe.throw(_("No active warehouse found. Set one up in Admin Mode first."))

	company = frappe.defaults.get_user_default("company") or frappe.db.get_value(
		"Warehouse", warehouse, "company"
	)

	doc = frappe.new_doc("Stock Reconciliation")
	doc.company = company
	doc.purpose = "Stock Reconciliation"
	doc.custom_adjustment_reason = reason
	# An item with no prior Stock Ledger Entry gets classified by ERPNext as
	# an "Opening Entry" reconciliation, which requires an Asset/Liability
	# difference account rather than the usual Expense one — "Temporary
	# Opening" is the standard COA account for exactly this. Setting it up
	# front avoids the case entirely rather than reacting to the validation
	# error (same value native new-item setup would use).
	doc.expense_account = frappe.db.get_value(
		"Account", {"company": company, "account_name": "Temporary Opening"}, "name"
	)
	# Real shop items will already have a valuation rate from their purchase
	# history — Bin carries the current one. A genuinely brand-new item
	# (never purchased, first stock ever set through this screen) has none;
	# 0 is the standard ERPNext convention for "value not tracked yet"
	# rather than blocking the correction entirely.
	valuation_rate = frappe.db.get_value(
		"Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate"
	) or 0

	doc.append("items", {
		"item_code": item_code,
		"warehouse": warehouse,
		"qty": float(new_qty),
		"valuation_rate": valuation_rate,
		# ERPNext's own native flag for "this item genuinely has no cost
		# history yet" (e.g. a used/donated item never purchased) — without
		# it, a 0 valuation_rate is rejected outright rather than accepted
		# as a deliberate zero.
		"allow_zero_valuation_rate": 1 if not valuation_rate else 0,
	})
	doc.insert()
	doc.submit()

	return {"name": doc.name}


@frappe.whitelist()
def receive_stock_simple(item_code: str, qty: float, rate: float = None):
	"""'Receive Stock' made simple enough for anyone to use (2026-08-06
	direct request: "class 7 k baachhe ko v samjh aa jaye") — no supplier,
	no invoice, no accounting fields. Just "this many more just arrived."
	Posts a real Stock Entry (Material Receipt) under the hood — native
	ERPNext stock-ledger logic, same "don't reinvent posting, just remove
	the form's complexity" approach fix_stock above already uses.

	Deliberately additive (adds qty to whatever is already there), unlike
	fix_stock which sets an absolute new quantity — "50 more just came in"
	and "we actually have 50 total" are different real-world actions and
	stay two different tools/buttons on purpose.

	The formal supplier-bill path (with GST, payment terms, ledger impact)
	is the existing "Upload Bill" flow — this endpoint is only for getting
	physical stock onto the shelf/into the count right away.
	"""
	if not item_code or not qty or flt(qty) <= 0:
		frappe.throw(_("Item and a quantity greater than zero are required."))

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")
	if not warehouse:
		frappe.throw(_("No active warehouse found. Set one up in Admin Mode first."))

	company = frappe.db.get_value("Warehouse", warehouse, "company")

	basic_rate = flt(rate) if rate not in (None, "") else flt(
		frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate")
	)

	doc = frappe.new_doc("Stock Entry")
	doc.company = company
	doc.stock_entry_type = "Material Receipt"
	doc.purpose = "Material Receipt"
	doc.append(
		"items",
		{
			"item_code": item_code,
			"t_warehouse": warehouse,
			"qty": flt(qty),
			"basic_rate": basic_rate,
			"allow_zero_valuation_rate": 1 if not basic_rate else 0,
		},
	)
	doc.insert()
	doc.submit()

	new_qty = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))
	return {"name": doc.name, "new_qty": new_qty}


# Score tiers for search_products — ranking priority is a direct product
# requirement (2026-07-30): exact item code > barcode > item name > alias/
# synonym > brand > category > common misspelling > partial match. Each
# tier's score is spaced far enough apart that combining several partial
# signals on a weak match can never outrank a single strong one.
_SCORE_CODE_EXACT = 1000
_SCORE_BARCODE_EXACT = 950
_SCORE_NAME_EXACT = 900
_SCORE_NAME_PREFIX = 800
_SCORE_NAME_CONTAINS = 700
_SCORE_KEYWORD_EXACT = 650
_SCORE_KEYWORD_CONTAINS = 600
_SCORE_MULTI_WORD_ALL = 350
_SCORE_BRAND_EXACT = 550
_SCORE_BRAND_CONTAINS = 500
_SCORE_GROUP_EXACT = 450
_SCORE_GROUP_CONTAINS = 400
_SCORE_FUZZY_NAME_MAX = 300
_SCORE_FUZZY_KEYWORD_MAX = 280
_SCORE_DESCRIPTION_CONTAINS = 100
_FUZZY_THRESHOLD = 0.72


def _fuzzy_ratio(a: str, b: str) -> float:
	if not a or not b:
		return 0.0
	return difflib.SequenceMatcher(None, a, b).ratio()


def _score_item(item, query: str, query_words: list, barcode_item_codes: set) -> int:
	"""Weighted relevance score for one Item against one search query.

	Returns 0 if nothing at all matched (caller drops it from results).
	Every signal is additive so an item matching on multiple weaker fields
	(e.g. brand + category) can still surface even without a strong single
	match — but never enough to outrank a real exact/prefix match, since
	tiers are spaced hundreds of points apart.
	"""
	name = (item.item_name or "").lower()
	code = (item.item_code or "").lower()
	keywords = (item.custom_search_keywords or "").lower()
	brand = (item.brand or "").lower()
	group = (item.item_group or "").lower()
	description = (item.description or "").lower()

	score = 0

	if code == query:
		score += _SCORE_CODE_EXACT
	if item.item_code in barcode_item_codes:
		score += _SCORE_BARCODE_EXACT

	if name == query:
		score += _SCORE_NAME_EXACT
	elif name.startswith(query):
		score += _SCORE_NAME_PREFIX
	elif query in name:
		score += _SCORE_NAME_CONTAINS

	if keywords:
		kw_tokens = keywords.split()
		if query in kw_tokens:
			score += _SCORE_KEYWORD_EXACT
		elif query in keywords:
			score += _SCORE_KEYWORD_CONTAINS
		if len(query_words) > 1:
			fuzzy_kw = max((_fuzzy_ratio(query, tok) for tok in kw_tokens), default=0)
			if fuzzy_kw > _FUZZY_THRESHOLD:
				score += int(fuzzy_kw * _SCORE_FUZZY_KEYWORD_MAX)
	else:
		kw_tokens = []

	if brand:
		if brand == query:
			score += _SCORE_BRAND_EXACT
		elif query in brand:
			score += _SCORE_BRAND_CONTAINS

	if group:
		if group == query:
			score += _SCORE_GROUP_EXACT
		elif query in group:
			score += _SCORE_GROUP_CONTAINS

	if len(query_words) > 1:
		combined = f"{name} {keywords} {brand} {group}"
		if all(w in combined for w in query_words):
			score += _SCORE_MULTI_WORD_ALL

	# Typo tolerance: compare the query against individual words in the
	# name, not the whole name string. Found by actually testing "asain"
	# for "Asian" — SequenceMatcher's ratio against a full ~40-character
	# name is dominated by length, so even an obvious 1-letter-transposed
	# typo of the first word scored near zero and returned nothing.
	# Word-by-word comparison is what a human means by "close enough."
	name_ratio = max((_fuzzy_ratio(query, tok) for tok in name.split()), default=0)
	if name_ratio > _FUZZY_THRESHOLD:
		score += int(name_ratio * _SCORE_FUZZY_NAME_MAX)
	for tok in kw_tokens:
		tok_ratio = _fuzzy_ratio(query, tok)
		if tok_ratio > _FUZZY_THRESHOLD:
			score += int(tok_ratio * _SCORE_FUZZY_KEYWORD_MAX)
			break

	if description and query in description:
		score += _SCORE_DESCRIPTION_CONTAINS

	return score


@frappe.whitelist()
def search_products(query: str, limit: int = 20):
	"""Ranked hardware-store product search — not a generic ERP list filter.

	Priority (product requirement, 2026-07-30): exact item code > barcode >
	item name > alias/synonym (`custom_search_keywords`) > brand > category
	> common misspelling (fuzzy match) > partial match. A single shop's
	catalog is small enough (low thousands of items at most) that scoring
	every active item in Python each search is simpler and more correct
	than a pre-filtered SQL query would be, and still comfortably fast —
	no search index needed (Golden Rule: don't build ahead of actual need;
	revisit only if the catalog ever grows far beyond what one shop stocks).

	Returns each result with live-adjusted available stock via the same
	`get_pos_reserved_qty` logic the POS billing screen already uses, so
	this screen never disagrees with POS about what's actually available —
	IMPROVEMENT_LOG.md 2026-07-30 flagged the old generic Item list for
	showing no stock at all; this replaces it.
	"""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty

	query = (query or "").strip().lower()
	if not query:
		return {"results": [], "exact_match": None}

	query_words = query.split()

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	# Barcode fast path: an exact scanned barcode should win over everything
	# regardless of what else it might loosely text-match.
	barcode_item_codes = set(
		frappe.get_all(
			"Item Barcode", filters={"barcode": query}, pluck="parent"
		)
	)

	items = frappe.get_all(
		"Item",
		filters={"disabled": 0},
		fields=[
			"item_code", "item_name", "brand", "item_group", "description",
			"custom_search_keywords", "image", "stock_uom",
		],
	)

	scored = []
	for item in items:
		score = _score_item(item, query, query_words, barcode_item_codes)
		if score > 0:
			scored.append((score, item))

	scored.sort(key=lambda pair: pair[0], reverse=True)
	top = scored[: int(limit)]

	results = []
	for score, item in top:
		price = frappe.db.get_value(
			"Item Price",
			{"item_code": item.item_code, "selling": 1},
			"price_list_rate",
		)
		available_qty = None
		if warehouse:
			from frappe.utils import flt

			actual_qty = flt(
				frappe.db.get_value(
					"Bin", {"item_code": item.item_code, "warehouse": warehouse}, "actual_qty"
				)
			)
			reserved_qty = flt(get_pos_reserved_qty(item.item_code, warehouse))
			available_qty = actual_qty - reserved_qty

		results.append({
			"item_code": item.item_code,
			"item_name": item.item_name,
			"brand": item.brand,
			"item_group": item.item_group,
			"image": item.image,
			"stock_uom": item.stock_uom,
			"price": price,
			"available_qty": available_qty,
			"score": score,
		})

	# "No additional click" for an unambiguous exact match (item code,
	# barcode, or exact name) — the frontend auto-opens this one instead of
	# waiting for a tap when it's clearly the answer, not just the top guess.
	exact_match = None
	if results and results[0]["score"] >= _SCORE_NAME_EXACT:
		if len(results) == 1 or results[1]["score"] < _SCORE_NAME_PREFIX:
			exact_match = results[0]["item_code"]

	return {"results": results, "exact_match": exact_match}


DEFAULT_LOW_STOCK_THRESHOLD = 5


@frappe.whitelist()
def get_dashboard_data():
	"""Everything the real Dashboard needs, in one call.

	ROADMAP.md Phase 2.5 Stage 2 Dashboard redesign (direct 2026-07-30
	instruction): "the dashboard should answer only one question — what do
	I need right now." One round trip, not five separate widget queries —
	speed is part of the design, not an afterthought.

	Today's Sales counts POS Invoice only (docstatus=1, posting_date=today),
	never also Sales Invoice — a POS Invoice stays the authoritative sale
	record even after POS Closing Entry consolidates it into a Sales
	Invoice; counting both would double-count every consolidated sale.
	Returns (is_return=1) already carry negative amounts in ERPNext's own
	convention, so a plain sum nets them out correctly with no special case.
	"""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty
	from frappe.utils import flt, today

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	today_sales = flt(
		frappe.db.sql(
			"select sum(grand_total) from `tabPOS Invoice` where docstatus = 1 and posting_date = %s",
			(today(),),
		)[0][0]
	)

	today_collection = flt(
		frappe.db.sql(
			"""
			select sum(pay.amount)
			from `tabSales Invoice Payment` pay
			inner join `tabPOS Invoice` inv on inv.name = pay.parent
			where inv.docstatus = 1 and inv.posting_date = %s and pay.parenttype = 'POS Invoice'
			""",
			(today(),),
		)[0][0]
	)

	company = frappe.defaults.get_user_default("Company")
	company_sql = " and company = %(company)s" if company else ""
	company_args = {"company": company}

	pending_supplier_payments = 0.0
	payable_party_count = 0
	if frappe.has_permission("Purchase Invoice", "read"):
		pending_supplier_payments = flt(
			frappe.db.sql(
				f"""
				select sum(outstanding_amount) from `tabPurchase Invoice`
				where docstatus = 1 and outstanding_amount > 0 {company_sql}
				""",
				company_args,
			)[0][0]
		)
		payable_party_count = frappe.db.sql(
			f"""
			select count(distinct supplier) from `tabPurchase Invoice`
			where docstatus = 1 and outstanding_amount > 0 {company_sql}
			""",
			company_args,
		)[0][0]

	# Total Receivable — same combined Sales Invoice + un-consolidated POS
	# Invoice outstanding sum get_customer_dues() uses per-customer, just
	# aggregated here instead of grouped, so this card never disagrees with
	# that page's total.
	total_receivable = 0.0
	receivable_party_count = 0
	if frappe.has_permission("Sales Invoice", "read") or frappe.has_permission("POS Invoice", "read"):
		receivable_row = frappe.db.sql(
			f"""
			select sum(outstanding_amount), count(distinct customer) from (
				select customer, outstanding_amount from `tabSales Invoice`
				where docstatus = 1 and outstanding_amount > 0 {company_sql}
				union all
				select customer, outstanding_amount from `tabPOS Invoice`
				where docstatus = 1 and outstanding_amount > 0
					and (consolidated_invoice is null or consolidated_invoice = '')
					{company_sql}
			) t
			""",
			company_args,
		)[0]
		total_receivable = flt(receivable_row[0])
		receivable_party_count = receivable_row[1] or 0

	# Stock alerts — same get_pos_reserved_qty logic Product Search/POS
	# already use, so this screen never disagrees with those about what's
	# actually available. Respects a real reorder level if the item has
	# one set; falls back to a shop-wide default otherwise.
	low_stock_count = 0
	out_of_stock_count = 0
	if warehouse:
		items = frappe.get_all(
			"Item", filters={"disabled": 0, "is_stock_item": 1}, fields=["item_code"]
		)
		for item in items:
			reorder_level = flt(
				frappe.db.get_value(
					"Item Reorder", {"parent": item.item_code, "warehouse": warehouse}, "warehouse_reorder_level"
				)
			) or DEFAULT_LOW_STOCK_THRESHOLD
			actual_qty = flt(
				frappe.db.get_value("Bin", {"item_code": item.item_code, "warehouse": warehouse}, "actual_qty")
			)
			available_qty = actual_qty - flt(get_pos_reserved_qty(item.item_code, warehouse))
			if available_qty <= 0:
				out_of_stock_count += 1
			elif available_qty <= reorder_level:
				low_stock_count += 1

	recent_bills = frappe.get_all(
		"POS Invoice",
		filters={"docstatus": 1},
		fields=["name", "customer", "grand_total", "posting_date", "creation"],
		order_by="creation desc",
		limit_page_length=5,
	)
	recent_purchases = frappe.get_all(
		"Purchase Invoice",
		filters={"docstatus": 1},
		fields=["name", "supplier", "grand_total", "posting_date", "creation"],
		order_by="creation desc",
		limit_page_length=5,
	)

	register_open = bool(
		frappe.get_all(
			"POS Opening Entry",
			filters={"user": frappe.session.user, "pos_closing_entry": ["in", ["", None]], "docstatus": 1},
			limit_page_length=1,
		)
	)

	widget_metrics = {}
	selected_widgets = []
	widget_catalog = []
	try:
		from santu_hardware.santu_hardware.dashboard_api import (
			get_user_widgets,
			get_widget_metrics,
			widget_catalog as build_widget_catalog,
		)

		widget_metrics = get_widget_metrics("This Month")
		selected_widgets = get_user_widgets()
		widget_catalog = build_widget_catalog(widget_metrics, low_stock_count)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Dashboard widget metrics failed")

	# Last 14 days of sales, one point per calendar day (zero-filled so a
	# day with no sales still shows as a gap, not a missing bar) — same
	# POS Invoice source as today_sales above, for the Dashboard's daily
	# sales graph.
	daily_rows = frappe.db.sql(
		"""
		select posting_date, sum(grand_total) as total
		from `tabPOS Invoice`
		where docstatus = 1 and posting_date >= date_sub(%s, interval 13 day)
		group by posting_date
		""",
		(today(),),
		as_dict=True,
	)
	daily_totals = {str(row.posting_date): flt(row.total) for row in daily_rows}
	daily_sales = [
		{"date": d.strftime("%d %b"), "total": daily_totals.get(str(d), 0)}
		for d in (frappe.utils.getdate(frappe.utils.add_days(today(), -offset)) for offset in range(13, -1, -1))
	]

	return {
		"today_sales": today_sales,
		"today_collection": today_collection,
		"pending_supplier_payments": pending_supplier_payments,
		"payable_party_count": payable_party_count,
		"total_receivable": total_receivable,
		"receivable_party_count": receivable_party_count,
		"low_stock_count": low_stock_count,
		"out_of_stock_count": out_of_stock_count,
		"recent_bills": recent_bills,
		"recent_purchases": recent_purchases,
		"register_open": register_open,
		"daily_sales": daily_sales,
		"widget_metrics": widget_metrics,
		"selected_widgets": selected_widgets,
		"widget_catalog": widget_catalog,
	}


@frappe.whitelist()
def get_sales_chart(range_key: str = "This Month", from_date: str = None, to_date: str = None):
	"""Total Sale chart data for the Dashboard period dropdown.

	Counts submitted POS Invoices that are not yet consolidated, plus
	submitted Sales Invoices (including those created by POS Closing).
	Drafts and cancelled documents are excluded. Returns already carry
	negative grand_total in ERPNext, so a plain sum nets them out.
	"""
	from frappe.utils import (
		add_days,
		add_months,
		get_first_day,
		get_last_day,
		getdate,
		today,
	)

	today_date = getdate(today())
	granularity = "day"

	if from_date and to_date:
		start, end = getdate(from_date), getdate(to_date)
	elif range_key == "Today":
		start = end = today_date
	elif range_key == "This Week":
		start = add_days(today_date, -today_date.weekday())
		end = add_days(start, 6)
	elif range_key == "Last Month":
		last_month_ref = add_months(today_date, -1)
		start = get_first_day(last_month_ref)
		end = get_last_day(last_month_ref)
	elif range_key == "This Quarter":
		quarter_start_month = ((today_date.month - 1) // 3) * 3 + 1
		start = getdate(f"{today_date.year}-{quarter_start_month:02d}-01")
		end = get_last_day(add_months(start, 2))
	elif range_key in ("This Year", "This year"):
		start = getdate(f"{today_date.year}-01-01")
		end = getdate(f"{today_date.year}-12-31")
		granularity = "month"
	elif range_key == "Half Year":
		start = get_first_day(add_months(today_date, -5))
		end = get_last_day(today_date)
		granularity = "month"
	else:
		start = get_first_day(today_date)
		end = get_last_day(today_date)

	if not frappe.has_permission("Sales Invoice", "read") and not frappe.has_permission(
		"POS Invoice", "read"
	):
		return {
			"total": 0,
			"points": [],
			"from_date": str(start),
			"to_date": str(end),
			"empty": True,
		}

	company = frappe.defaults.get_user_default("Company")
	company_clause = " and company = %(company)s" if company else ""

	rows = frappe.db.sql(
		f"""
		select posting_date, sum(grand_total) as total from (
			select posting_date, grand_total
			from `tabPOS Invoice`
			where docstatus = 1
				and posting_date between %(start)s and %(end)s
				and (consolidated_invoice is null or consolidated_invoice = '')
				{company_clause}
			union all
			select posting_date, grand_total
			from `tabSales Invoice`
			where docstatus = 1
				and posting_date between %(start)s and %(end)s
				{company_clause}
		) t
		group by posting_date
		""",
		{"start": start, "end": end, "company": company},
		as_dict=True,
	)
	totals_by_date = {str(r.posting_date): flt(r.total) for r in rows}

	points = []
	if granularity == "day":
		cursor = start
		while cursor <= end:
			points.append({"date": cursor.strftime("%d %b"), "total": totals_by_date.get(str(cursor), 0)})
			cursor = add_days(cursor, 1)
	else:
		cursor = get_first_day(start)
		while cursor <= end:
			month_end = get_last_day(cursor)
			month_total = sum(
				v for k, v in totals_by_date.items() if cursor <= getdate(k) <= month_end
			)
			points.append({"date": cursor.strftime("%b %Y"), "total": month_total})
			cursor = add_months(cursor, 1)

	has_sales = any(p["total"] for p in points)
	return {
		"total": sum(p["total"] for p in points),
		"points": points if has_sales else [],
		"from_date": str(start),
		"to_date": str(end),
		"empty": not has_sales,
	}


@frappe.whitelist()
def get_low_stock_items():
	"""Full item-level detail behind the Dashboard's Low Stock / Out of
	Stock counts (get_dashboard_data above) — that only ever returned a
	number, with no way to see WHICH items or when they'll actually run
	out (2026-08-06 direct request: "kya khatam hone wala hai, kya hai,
	aur kya khatam ho sakta hai jald hi").

	Three tiers, most urgent first:
	  - "out": available_qty <= 0 right now.
	  - "low": available_qty is at or under its reorder level (same Item
	    Reorder table / DEFAULT_LOW_STOCK_THRESHOLD fallback as
	    get_dashboard_data, so this list never disagrees with that count).
	  - "running_out_soon": still above its reorder level today, but
	    selling fast enough that it will hit zero within a week — an item
	    can look "fine" by the reorder-level check and still vanish by
	    Friday if it's moving 20 units a day. Pace is the last 14 days of
	    POS Invoice Item qty, averaged; nothing else in this app computes
	    a velocity, so this is a new capability, not a re-display of an
	    existing number.
	Healthy items (above reorder level and not projected to run out) are
	left out entirely — same "don't show an answer nobody needs" rule
	already used for the Dashboard's alert cards.
	"""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty
	from frappe.utils import add_days, flt, today

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")
	if not warehouse:
		return []

	items = frappe.get_all(
		"Item", filters={"disabled": 0, "is_stock_item": 1}, fields=["item_code", "item_name", "stock_uom"]
	)
	if not items:
		return []

	item_codes = [i.item_code for i in items]

	# One grouped query for sales pace instead of one query per item —
	# the per-item loop below already hits Item Reorder/Bin per item
	# (unavoidable, different table each), so at least this one is batched.
	sales_rows = frappe.db.sql(
		"""
		select item_code, sum(qty) as total_qty
		from `tabPOS Invoice Item`
		where item_code in %(item_codes)s
			and docstatus = 1
			and creation >= %(since)s
		group by item_code
		""",
		{"item_codes": item_codes, "since": add_days(today(), -14)},
		as_dict=True,
	)
	daily_pace = {r.item_code: flt(r.total_qty) / 14 for r in sales_rows}

	result = []
	for item in items:
		reorder_level = flt(
			frappe.db.get_value(
				"Item Reorder", {"parent": item.item_code, "warehouse": warehouse}, "warehouse_reorder_level"
			)
		) or DEFAULT_LOW_STOCK_THRESHOLD
		actual_qty = flt(
			frappe.db.get_value("Bin", {"item_code": item.item_code, "warehouse": warehouse}, "actual_qty")
		)
		available_qty = actual_qty - flt(get_pos_reserved_qty(item.item_code, warehouse))
		pace = daily_pace.get(item.item_code, 0)
		days_remaining = (available_qty / pace) if pace > 0 else None

		if available_qty <= 0:
			status = "out"
		elif available_qty <= reorder_level:
			status = "low"
		elif days_remaining is not None and days_remaining <= 7:
			status = "running_out_soon"
		else:
			continue

		target_cover = max(pace * 14, reorder_level) if pace > 0 else reorder_level * 2
		suggested_reorder_qty = max(round(target_cover - available_qty), 0)

		result.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"stock_uom": item.stock_uom,
				"available_qty": available_qty,
				"reorder_level": reorder_level,
				"daily_pace": round(pace, 2),
				"days_remaining": round(days_remaining) if days_remaining is not None else None,
				"status": status,
				"suggested_reorder_qty": suggested_reorder_qty,
			}
		)

	status_order = {"out": 0, "low": 1, "running_out_soon": 2}
	result.sort(
		key=lambda r: (
			status_order[r["status"]],
			r["days_remaining"] if r["days_remaining"] is not None else 999,
		)
	)
	return result


@frappe.whitelist()
def get_payments_received_total(filters=None):
	"""Real money the shop has actually taken in from customers.

	Powers the Accounting workspace's "Payments Received" Number Card.
	The native version of this card sums `Payment Entry` (payment_type=
	Receive) only — but this shop's sales are POS Invoices consolidated
	into Sales Invoices, where payment is captured directly on the
	invoice's own `paid_amount` (no separate Payment Entry is created for
	a normal counter sale). That left the native card reading ₹0 despite
	real cash/UPI collected every day (reported live, 2026-07-30).
	Sums both sources — they never overlap: a POS-captured payment lives
	on the invoice's `paid_amount`, a later credit-collection payment
	(if a due invoice is settled afterwards) lives on a `Payment Entry`
	instead, never both.
	"""
	from frappe.utils import flt

	invoice_paid = flt(
		frappe.db.sql("select sum(paid_amount) from `tabSales Invoice` where docstatus = 1")[0][0]
	)
	entry_received = flt(
		frappe.db.sql(
			"select sum(base_received_amount) from `tabPayment Entry` where docstatus = 1 and payment_type = 'Receive'"
		)[0][0]
	)
	return {"value": invoice_paid + entry_received}


@frappe.whitelist()
def get_payments_made_total(filters=None):
	"""Real money the shop has actually paid to suppliers. See
	`get_payments_received_total` — same fix, mirrored for the buying side."""
	from frappe.utils import flt

	invoice_paid = flt(
		frappe.db.sql("select sum(paid_amount) from `tabPurchase Invoice` where docstatus = 1")[0][0]
	)
	entry_paid = flt(
		frappe.db.sql(
			"select sum(base_paid_amount) from `tabPayment Entry` where docstatus = 1 and payment_type = 'Pay'"
		)[0][0]
	)
	return {"value": invoice_paid + entry_paid}


@frappe.whitelist()
def get_pos_confirmation_settings():
	"""Shop-wide thresholds for the POS smart-confirmation system.

	ROADMAP.md Phase 2.5 Stage 2 POS priority: normal sales complete with
	zero popups; large amounts, high manual discounts, and credit sales
	above their configured limit always confirm. Read fresh on every call
	(not cached client-side) so an owner changing a limit in Settings takes
	effect on the very next sale, not after a reload.
	"""
	settings = frappe.get_single("Santu POS Settings")
	return {
		"enable_smart_confirmation": bool(settings.enable_smart_confirmation),
		"large_amount_threshold": settings.large_amount_threshold or 0,
		"discount_limit_percent": settings.discount_limit_percent or 0,
		"credit_sale_limit": settings.credit_sale_limit or 0,
	}


@frappe.whitelist()
def get_invoice_pdf_base64(doctype: str, name: str, print_format: str):
	"""Base64 PDF bytes for a single invoice, for the QZ Tray print path
	(`qz.print` takes a base64 pixel/PDF payload, not a URL — QZ Tray runs
	as a local desktop service, outside the browser, so it can't just
	follow a `/api/method/...` link the way a browser tab would)."""
	import base64

	if print_format.startswith("Santu Hardware Thermal Bill"):
		pdf_bytes = _thermal_pdf_bytes(doctype, name, print_format)
	else:
		pdf_bytes = frappe.get_print(doctype, name, print_format, as_pdf=True)

	return base64.b64encode(pdf_bytes).decode("ascii")


def _thermal_pdf_bytes(doctype: str, name: str, print_format: str) -> bytes:
	"""Renders a thermal-roll PDF sized to match the actual paper width and
	content height, instead of the framework's default A4 page.

	Print Settings' global `pdf_page_size` is "A4" — fine for the A4 bill
	format, but wrong for an 80mm roll: `frappe.get_print(..., as_pdf=True)`
	was silently rendering every receipt onto an A4 (210x297mm) page, which
	the printer's CUPS queue then had to scale/clip onto the actual roll,
	cropping content (short queue page length) or stretching it across a
	mostly-blank long roll (long queue page length) depending on the
	queue's own page-size default.

	`frappe.get_print(..., pdf_options=...)` can't fix this: passing an
	explicit `page-width`/`page-height` still gets silently overridden,
	because `frappe.utils.pdf.prepare_options` *always* sets a `page-size`
	CLI arg from the global default when the caller didn't also pass
	`page-size: "Custom"` — and passing `"Custom"` literally is *also*
	broken, since Frappe only omits `page-size` from the args when that
	value comes from the global setting, not from a caller-supplied
	option; a caller-supplied `"Custom"` leaks straight to wkhtmltopdf's
	CLI, which rejects it (`Invalid argument(s) parsed to --page-size`).
	So this renders the print format's HTML the normal way, then calls
	pdfkit directly with only `page-width`/`page-height` (no `page-size`
	at all), which is the one combination that actually sticks.
	"""
	import pdfkit
	from frappe.utils.pdf import cleanup, get_cookie_options, inline_private_images, read_options_from_html, scrub_urls

	settings = frappe.get_single("Santu POS Settings")
	paper_width = flt((settings.paper_width or "80mm").replace("mm", "")) or 80
	item_count = len(frappe.get_cached_doc(doctype, name).get("items") or [])
	page_height = 170 + item_count * 10

	html = frappe.get_print(doctype, name, print_format, as_pdf=False)
	html = scrub_urls(html)
	html, options = read_options_from_html(html)
	html = inline_private_images(html)

	options.pop("page-size", None)
	options.update(
		{
			"print-media-type": None,
			"background": None,
			"images": None,
			"quiet": None,
			"encoding": "UTF-8",
			"disable-javascript": "",
			"disable-local-file-access": "",
			"disable-smart-shrinking": "",
			"page-width": f"{paper_width}mm",
			"page-height": f"{page_height}mm",
			"margin-top": "2mm",
			"margin-bottom": "2mm",
			"margin-left": "2mm",
			"margin-right": "2mm",
		}
	)
	options.update(get_cookie_options())

	try:
		return pdfkit.from_string(html, options=options, verbose=True)
	finally:
		cleanup(options)


@frappe.whitelist()
def get_qr_code_data_uri(data: str, scale: int = 4, error: str = "M"):
	"""Renders `data` as a QR PNG, inline as a `data:` URI.

	Print formats (server-rendered via wkhtmltopdf, no JS execution of the
	kind a browser gives) can't run a client-side QR library — this
	generates the image server-side instead and embeds the bytes directly,
	the same "no external asset dependency" approach already used for the
	invoice logo. Called from Jinja print formats via `frappe.call(...)`,
	which the (default, unrestricted) print-rendering sandbox exposes.

	`error` is the QR error-correction level ("L"/"M"/"Q"/"H" — 7/15/25/30%
	of the code can be damaged/misread and still decode correctly).
	"""
	import pyqrcode

	if not data:
		return ""
	buffer = io.BytesIO()
	pyqrcode.create(data, error=error).png(buffer, scale=int(scale))
	encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
	return f"data:image/png;base64,{encoded}"


@frappe.whitelist()
def get_barcode_data_uri(data: str):
	"""Renders `data` (typically an invoice name) as a Code128 barcode PNG,
	inline as a `data:` URI. See `get_qr_code_data_uri` for why this has
	to happen server-side rather than via a client-side JS library."""
	import barcode
	from barcode.writer import ImageWriter

	if not data:
		return ""
	buffer = io.BytesIO()
	code128 = barcode.get("code128", data, writer=ImageWriter())
	code128.write(
		buffer,
		options={"write_text": False, "module_height": 8.0, "quiet_zone": 2.0},
	)
	encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
	return f"data:image/png;base64,{encoded}"


@frappe.whitelist()
def get_upi_qr_data_uri(amount: float, invoice_name: str = None, scale: int = 4):
	"""UPI "scan to pay" QR for the printed bill, if the shop has a UPI ID
	configured (Settings → Printer Settings). Falls back to an empty string
	(no QR shown) rather than guessing/fabricating a UPI ID — this is real
	payment-routing data, not something to invent a placeholder for."""
	settings = frappe.get_single("Santu POS Settings")
	upi_id = getattr(settings, "upi_id", None)
	if not upi_id:
		return ""

	from urllib.parse import quote

	payee_name = quote(frappe.db.get_default("company") or "Santu Hardware")
	note = quote(f"Invoice {invoice_name}" if invoice_name else "Payment")
	upi_link = f"upi://pay?pa={upi_id}&pn={payee_name}&am={flt(amount):.2f}&cu=INR&tn={note}"
	# "H" (highest, 30% of the code can be damaged/smudged/misprinted and
	# still scan correctly) — 2026-08-04 direct report: the QR sometimes
	# fails to scan on some printed bills. This printer's PPD has no
	# darkness/print-speed option to tune (checked: none exists), so the
	# fix that's actually in reach is making the code itself far more
	# tolerant of thermal print imperfections, rather than a hardware
	# knob that isn't there.
	return get_qr_code_data_uri(upi_link, scale=scale, error="H")


def _get_or_create_folder(file_name, parent_folder):
	"""Get-or-create a File-doctype folder under `parent_folder`, returning
	its name. Frappe's own `create_new_folder` uses `ignore_if_duplicate`,
	which silently no-ops on a repeat call without reliably handing back
	the existing folder's name — every invoice submission calls this, so
	it needs to be safe to call thousands of times, not just once."""
	existing = frappe.db.exists("File", {"file_name": file_name, "folder": parent_folder, "is_folder": 1})
	if existing:
		return existing

	folder = frappe.new_doc("File")
	folder.file_name = file_name
	folder.is_folder = 1
	folder.folder = parent_folder
	folder.insert(ignore_permissions=True)
	return folder.name


def apply_billing_defaults(doc, method=None):
	"""`doc_events` hook (POS Invoice / Sales Invoice `before_submit`) —
	2026-07-30 direct request: a clean numeric bill number (not the full
	"ACC-PSINV-2026-00021"-style docname) and a due date capped at 2 days
	out. Runs in `before_submit` — not `on_submit` — specifically so both
	values are already part of the document by the time
	`save_invoice_pdf_to_dated_folder` (a separate `on_submit` hook)
	renders the PDF that gets auto-saved right after.
	"""
	if not doc.get("santu_bill_no"):
		from frappe.model.naming import getseries

		doc.santu_bill_no = cint(getseries("SANTU-BILL-NO", 0))

	posting = frappe.utils.getdate(doc.posting_date)
	max_due = frappe.utils.add_days(posting, 2)
	if not doc.get("due_date") or frappe.utils.getdate(doc.due_date) > max_due:
		doc.due_date = max_due


def strip_gst_line_items(doc, method=None):
	"""`doc_events` hook (POS Invoice / Sales Invoice `before_validate` +
	`validate`) — 2026-07-30 direct request: no SGST/CGST/IGST lines
	anywhere on the bill, not even as a zero-net "inclusive" breakdown
	(the `included_in_print_rate` fix from earlier the same day kept the
	total correct but still showed the tax split, which is what's being
	asked to go away here).

	india_compliance auto-selects a GST tax template on every POS/Sales
	Invoice via its own `before_validate`/`validate` hooks
	(`gst_india/overrides/transaction.py`), independent of any POS
	Profile or item setting — confirmed earlier the same day when
	tracking down why totals were inflating. `santu_hardware` is the
	last app in `apps.txt`, so its `doc_events` for the same event run
	after india_compliance's — this simply clears what they just set,
	every time, rather than fighting to prevent the selection in the
	first place.
	"""
	doc.taxes_and_charges = None
	doc.set("taxes", [])


def _get_dated_invoice_folder(posting_date):
	"""Invoices / YYYY / Month / YYYY-MM-DD — created on demand, not
	pre-built, so this only ever creates the handful of folders actually
	used."""
	posting_date = frappe.utils.getdate(posting_date)
	year_folder = _get_or_create_folder("Invoices", "Home")
	month_folder = _get_or_create_folder(str(posting_date.year), year_folder)
	day_folder = _get_or_create_folder(posting_date.strftime("%B"), month_folder)
	return _get_or_create_folder(posting_date.strftime("%Y-%m-%d"), day_folder)


def save_invoice_pdf_to_dated_folder(doc, method=None):
	"""`doc_events` hook (POS Invoice / Sales Invoice `on_submit`) — Phase
	2, "every invoice automatically saves, no manual save". Reuses
	whichever print format the doctype's `default_print_format` points at
	(the Santu Hardware thermal/A4 bill), so this never drifts out of
	sync with what the shop actually prints.

	The ENTIRE body is one try/except: this runs inside the same request
	(and DB transaction) as the actual sale being submitted, so a bug
	here — a template error, a folder-naming edge case, anything — must
	never be able to block or roll back a real sale. A missing PDF is
	recoverable (reprint later); a shop owner unable to complete a sale
	because a background nice-to-have threw an exception is not. Caught
	live: an early version only wrapped the `get_print` call, and a
	`posting_date`-as-string edge case in `_get_dated_invoice_folder`
	(uncaught) surfaced as a blocking "Server Error" on the actual POS
	checkout screen.
	"""
	try:
		print_format = frappe.db.get_value("DocType", doc.doctype, "default_print_format")
		if not print_format:
			return

		pdf_bytes = frappe.get_print(doc.doctype, doc.name, print_format, as_pdf=True)
		folder = _get_dated_invoice_folder(doc.posting_date)

		from frappe.utils.file_manager import save_file

		save_file(
			fname=f"{doc.name}.pdf",
			content=pdf_bytes,
			dt=doc.doctype,
			dn=doc.name,
			folder=folder,
			is_private=1,
		)
	except Exception:
		frappe.log_error(title="Auto-save invoice PDF failed", message=frappe.get_traceback())


@frappe.whitelist()
def get_or_create_customer_by_phone(customer_name: str, phone: str = None, village: str = None):
	"""New-sale customer capture (2026-07-30 direct request): asking a
	cashier to search-and-pick from the full customer list is real
	friction for a fast counter sale — this instead takes a name + phone
	typed right on the billing screen and figures out which customer that
	is. If the phone number already belongs to a customer, that existing
	record is reused (no duplicate "Ramesh Verma" x2 from a typo-prone
	manual search); otherwise a new one is created on the spot.
	"""
	if phone:
		existing = frappe.db.get_value("Customer", {"mobile_no": phone}, "name")
		if existing:
			if village:
				# fill in a village if the existing record didn't have one yet;
				# never silently overwrite one that's already on file.
				current_village = frappe.db.get_value("Customer", existing, "santu_village")
				if not current_village:
					frappe.db.set_value("Customer", existing, "santu_village", village)
			return existing

	customer = frappe.new_doc("Customer")
	customer.customer_name = customer_name
	customer.customer_type = "Individual"
	customer.mobile_no = phone
	customer.santu_village = village
	customer.customer_group = frappe.db.get_value("Customer Group", {}, "name") or "All Customer Groups"
	customer.territory = frappe.db.get_value("Territory", {}, "name") or "All Territories"
	customer.insert(ignore_permissions=True)
	return customer.name


@frappe.whitelist()
def search_customers_by_name(query: str):
	"""Live suggestions for the "Who's this sale for?" Name field
	(direct request: typing a name there should surface existing
	customers by name, not just by exact phone match) — a cashier
	typing "chandra" should see "Chandra Prakash" show up so they can
	pick the existing record instead of typing the whole name out and
	risking `get_or_create_customer_by_phone` creating a near-duplicate
	when the phone field is left blank (only phone dedupes today)."""
	if not query or len(query) < 2:
		return []
	return frappe.get_all(
		"Customer",
		filters={"customer_name": ["like", f"%{query}%"]},
		fields=["name", "customer_name", "mobile_no", "santu_village"],
		order_by="modified desc",
		limit_page_length=8,
	)


@frappe.whitelist()
def quick_create_item(
	item_name: str,
	selling_price: float,
	item_group: str = None,
	uom: str = None,
	barcode: str = None,
	gst_hsn_code: str = None,
	price_list: str = None,
):
	"""Inline item creation from the POS billing screen (2026-07-31 direct
	request) — "the cashier should never have to leave the billing screen
	just to add a missing item." Mirrors `get_or_create_customer_by_phone`:
	a minimal, purpose-built create path rather than the full Item quick
	entry dialog (which asks for far more than a counter sale needs).

	Deliberately created as a NON-stock item (`is_stock_item = 0`): this
	shop's `Stock Settings.allow_negative_stock` is off, and a
	freshly-created item has zero stock on hand — if it were stock-tracked,
	adding it straight to the cart and completing the sale (which is the
	whole point of this flow: "should be automatically added to the
	current bill") would fail the same negative-stock check that already
	protects real inventory. The shop owner can upgrade it to stock-tracked
	and enter an opening quantity later via the normal Item master if they
	want it counted in inventory going forward.

	`item_code` isn't asked for on the dialog — Item is named `field:
	item_code` in this system, so one is slugged from the name here,
	de-duplicated with a numeric suffix if needed, keeping the dialog to
	exactly the fields the request asked for.

	`gst_hsn_code` isn't in that original field list either, but this
	shop has india_compliance's HSN validation switched on
	(`GST Settings.validate_hsn_code`, `min_hsn_digits = 6`) — confirmed
	live: item creation failed outright with "HSN/SAC Code is required"
	before this was added. It's optional here (the dialog leaves it
	blank-able) since a cashier quick-adding an item mid-sale often won't
	know it; leaving it blank simply reproduces the same error the shop
	would already get creating this item any other way, rather than this
	flow silently inventing a fake HSN to dodge a real GST requirement.
	"""
	import re

	slug = re.sub(r"[^A-Za-z0-9]+", "-", item_name).strip("-").upper() or "ITEM"
	item_code = slug
	suffix = 1
	while frappe.db.exists("Item", item_code):
		suffix += 1
		item_code = f"{slug}-{suffix}"

	item = frappe.new_doc("Item")
	item.item_code = item_code
	item.item_name = item_name
	item.item_group = item_group or "Products"
	item.stock_uom = uom or "Nos"
	item.is_stock_item = 0
	item.include_item_in_manufacturing = 0
	if gst_hsn_code:
		item.gst_hsn_code = gst_hsn_code
	if barcode:
		item.append("barcodes", {"barcode": barcode})
	item.insert(ignore_permissions=True)

	price_list = price_list or "Standard Selling"
	item_price = frappe.new_doc("Item Price")
	item_price.item_code = item.item_code
	item_price.price_list = price_list
	item_price.selling = 1
	item_price.price_list_rate = flt(selling_price)
	item_price.insert(ignore_permissions=True)

	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"rate": flt(selling_price),
		"uom": item.stock_uom,
	}


@frappe.whitelist()
def get_customer_balance_summary(customer: str, exclude_doctype: str = None, exclude_name: str = None):
	"""Previous/current balance for the printed bill (2026-07-30 direct
	request). "Previous balance" = everything this customer owed BEFORE
	this bill. Reads Sales Invoice (the accounting-authoritative record)
	plus any POS Invoice that hasn't been consolidated into one yet
	(today's not-yet-closed sales) — excluding the invoice currently
	being printed either way, and excluding POS Invoices that ARE already
	consolidated so a bill's dues aren't counted twice (once as the POS
	Invoice, again as its Sales Invoice).
	"""
	if not customer:
		return {"previous_balance": 0}

	si_filters = "customer = %(customer)s and docstatus = 1"
	pos_filters = (
		"customer = %(customer)s and docstatus = 1 and (consolidated_invoice is null or consolidated_invoice = '')"
	)
	params = {"customer": customer}

	if exclude_doctype == "Sales Invoice" and exclude_name:
		si_filters += " and name != %(exclude_name)s"
		params["exclude_name"] = exclude_name
	if exclude_doctype == "POS Invoice" and exclude_name:
		pos_filters += " and name != %(exclude_name)s"
		params["exclude_name"] = exclude_name

	previous_balance = flt(
		frappe.db.sql(
			f"""
			select sum(outstanding_amount) from (
				select outstanding_amount from `tabSales Invoice` where {si_filters}
				union all
				select outstanding_amount from `tabPOS Invoice` where {pos_filters}
			) t
			""",
			params,
		)[0][0]
	)
	return {"previous_balance": previous_balance}


@frappe.whitelist()
def get_customer_loyalty_summary(customer: str, invoice: str = None):
	"""Points earned on this specific bill (from its own Loyalty Point
	Entry, if the sale posted one) and the customer's running total —
	for the "Earned reward points / Total reward points" lines on the
	printed bill (2026-07-30 direct request)."""
	if not customer:
		return {"earned_this_bill": 0, "total_points": 0}

	earned_this_bill = 0
	if invoice:
		earned_this_bill = flt(
			frappe.db.get_value("Loyalty Point Entry", {"invoice": invoice}, "loyalty_points")
		)

	total_points = flt(
		frappe.db.sql(
			"select sum(loyalty_points) from `tabLoyalty Point Entry` where customer = %s and expiry_date >= %s",
			(customer, frappe.utils.today()),
		)[0][0]
	)
	return {"earned_this_bill": earned_this_bill, "total_points": total_points}


@frappe.whitelist()
def get_customer_dues(village: str = None, search: str = None):
	"""Customer Dues by Village (2026-07-30 direct request): "which
	person has how much bill", searchable by name, filterable by
	village. One row per customer with any outstanding balance — reuses
	the exact same Sales Invoice + un-consolidated-POS-Invoice sum as the
	printed bill's "Previous Balance" line, so the two never disagree.
	"""
	customer_filters = {}
	if village:
		customer_filters["santu_village"] = village
	if search:
		customer_filters["customer_name"] = ["like", f"%{search}%"]

	customers = frappe.get_all(
		"Customer",
		filters=customer_filters,
		fields=["name", "customer_name", "santu_village", "mobile_no"],
	)

	rows = []
	for c in customers:
		balance = flt(
			frappe.db.sql(
				"""
				select sum(outstanding_amount) from (
					select outstanding_amount from `tabSales Invoice` where customer = %(customer)s and docstatus = 1
					union all
					select outstanding_amount from `tabPOS Invoice`
					where customer = %(customer)s and docstatus = 1
						and (consolidated_invoice is null or consolidated_invoice = '')
				) t
				""",
				{"customer": c.name},
			)[0][0]
		)
		if balance > 0:
			rows.append(
				{
					"customer": c.name,
					"customer_name": c.customer_name,
					"village": c.santu_village,
					"mobile_no": c.mobile_no,
					"total_due": balance,
				}
			)

	rows.sort(key=lambda r: r["total_due"], reverse=True)
	return rows


@frappe.whitelist()
def get_customer_all_bills(customer: str):
	"""Every bill for one customer — Sales Invoice (accounting-final) and
	any not-yet-consolidated POS Invoice — for the drill-down on the
	Customer Dues page. One combined, date-sorted list rather than two
	separate tables, since a shop owner doesn't care which internal
	doctype a bill happens to be in right now."""
	si_rows = frappe.get_all(
		"Sales Invoice",
		filters={"customer": customer, "docstatus": 1},
		fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"],
	)
	for r in si_rows:
		r["doctype"] = "Sales Invoice"

	pos_rows = frappe.get_all(
		"POS Invoice",
		filters={
			"customer": customer,
			"docstatus": 1,
			"consolidated_invoice": ["in", ["", None]],
		},
		fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"],
	)
	for r in pos_rows:
		r["doctype"] = "POS Invoice"

	rows = list(si_rows) + list(pos_rows)
	rows.sort(key=lambda r: r["posting_date"], reverse=True)
	return rows


@frappe.whitelist()
def get_parties_list(search: str = None):
	"""Combined Customer + Supplier list for the Vyapar-style "Parties"
	screen (2026-08-06 direct request, matching Vyapar's own split-view
	Parties page: one list of every party — customers and suppliers both
	— each showing what's owed, then a detail panel on the right when one
	is selected). ERPNext keeps Customer and Supplier as separate
	doctypes; this merges them into one list only for this screen, same
	balance math get_customer_dues/get_dashboard_data already use.
	"""
	customer_filters = {"customer_name": ["like", f"%{search}%"]} if search else {}
	supplier_filters = {"supplier_name": ["like", f"%{search}%"]} if search else {}

	customers = frappe.get_all("Customer", filters=customer_filters, fields=["name", "customer_name"])
	suppliers = frappe.get_all("Supplier", filters=supplier_filters, fields=["name", "supplier_name"])

	rows = []
	for c in customers:
		balance = flt(
			frappe.db.sql(
				"""
				select sum(outstanding_amount) from (
					select outstanding_amount from `tabSales Invoice` where customer = %(p)s and docstatus = 1
					union all
					select outstanding_amount from `tabPOS Invoice`
					where customer = %(p)s and docstatus = 1
						and (consolidated_invoice is null or consolidated_invoice = '')
				) t
				""",
				{"p": c.name},
			)[0][0]
		)
		rows.append(
			{"party_type": "Customer", "party": c.name, "party_name": c.customer_name, "amount": balance}
		)

	for s in suppliers:
		balance = flt(
			frappe.db.sql(
				"select sum(outstanding_amount) from `tabPurchase Invoice` where supplier = %s and docstatus = 1",
				(s.name,),
			)[0][0]
		)
		rows.append(
			{"party_type": "Supplier", "party": s.name, "party_name": s.supplier_name, "amount": balance}
		)

	rows.sort(key=lambda r: (r["party_name"] or "").lower())
	return rows


@frappe.whitelist()
def get_vyapar_items_list(
	search: str = None,
	item_group: str = None,
	stock_status: str = None,
	item_type: str = None,
	limit: int = 200,
):
	"""Combined products + services list for the Vyapar-style Items screen.

	Returns one row per active Item with live available stock (same
	`get_pos_reserved_qty` logic Product Search / POS already use), selling
	rate from Standard Selling, and a simple stock_status tag for the
	filter chips (ok / low / out / na for non-stock services).
	"""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	filters = {"disabled": 0}
	if item_group:
		filters["item_group"] = item_group
	if item_type == "product":
		filters["is_stock_item"] = 1
	elif item_type == "service":
		filters["is_stock_item"] = 0

	or_filters = None
	if search:
		or_filters = {
			"item_name": ["like", f"%{search}%"],
			"item_code": ["like", f"%{search}%"],
			"brand": ["like", f"%{search}%"],
		}

	items = frappe.get_all(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"item_code",
			"item_name",
			"item_group",
			"brand",
			"is_stock_item",
			"stock_uom",
			"image",
		],
		order_by="item_name asc",
		limit_page_length=int(limit),
	)

	if not items:
		return []

	item_codes = [i.item_code for i in items]
	price_rows = frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", item_codes], "selling": 1},
		fields=["item_code", "price_list_rate"],
	)
	price_map = {r.item_code: flt(r.price_list_rate) for r in price_rows}

	rows = []
	for item in items:
		available_qty = None
		reorder_level = None
		status = "na"

		if item.is_stock_item and warehouse:
			reorder_level = flt(
				frappe.db.get_value(
					"Item Reorder",
					{"parent": item.item_code, "warehouse": warehouse},
					"warehouse_reorder_level",
				)
			) or DEFAULT_LOW_STOCK_THRESHOLD
			actual_qty = flt(
				frappe.db.get_value(
					"Bin", {"item_code": item.item_code, "warehouse": warehouse}, "actual_qty"
				)
			)
			available_qty = actual_qty - flt(get_pos_reserved_qty(item.item_code, warehouse))
			if available_qty <= 0:
				status = "out"
			elif available_qty <= reorder_level:
				status = "low"
			else:
				status = "ok"

		if stock_status and stock_status != "all":
			if stock_status == "low" and status != "low":
				continue
			if stock_status == "out" and status != "out":
				continue

		rows.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"item_group": item.item_group,
				"brand": item.brand,
				"is_stock_item": item.is_stock_item,
				"stock_uom": item.stock_uom,
				"image": item.image,
				"selling_rate": price_map.get(item.item_code),
				"available_qty": available_qty,
				"reorder_level": reorder_level,
				"stock_status": status,
			}
		)

	return rows


@frappe.whitelist()
def get_item_detail(item_code: str):
	"""Full item detail for the Items screen's right-hand panel."""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty

	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} not found").format(item_code or ""))

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	item = frappe.get_doc("Item", item_code)
	selling_rate = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate"
	)
	purchase_rate = flt(item.last_purchase_rate) or flt(
		frappe.db.get_value("Item Price", {"item_code": item_code, "buying": 1}, "price_list_rate")
	)

	available_qty = None
	reorder_level = None
	valuation_rate = None
	stock_status = "na"

	if item.is_stock_item and warehouse:
		reorder_level = flt(
			frappe.db.get_value(
				"Item Reorder", {"parent": item_code, "warehouse": warehouse}, "warehouse_reorder_level"
			)
		) or DEFAULT_LOW_STOCK_THRESHOLD
		actual_qty = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
		)
		valuation_rate = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate")
		)
		available_qty = actual_qty - flt(get_pos_reserved_qty(item_code, warehouse))
		if available_qty <= 0:
			stock_status = "out"
		elif available_qty <= reorder_level:
			stock_status = "low"
		else:
			stock_status = "ok"

	barcodes = frappe.get_all("Item Barcode", filters={"parent": item_code}, pluck="barcode")

	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"brand": item.brand,
		"description": item.description,
		"is_stock_item": item.is_stock_item,
		"stock_uom": item.stock_uom,
		"image": item.image,
		"disabled": item.disabled,
		"selling_rate": flt(selling_rate),
		"purchase_rate": purchase_rate,
		"valuation_rate": valuation_rate,
		"available_qty": available_qty,
		"reorder_level": reorder_level,
		"stock_status": stock_status,
		"rack_number": item.get("custom_rack_number"),
		"shelf_number": item.get("custom_shelf_number"),
		"bin_location": item.get("custom_bin_location"),
		"barcodes": barcodes,
		"warehouse": warehouse,
		"stock_value": flt(available_qty) * flt(valuation_rate or purchase_rate) if item.is_stock_item else 0,
	}


@frappe.whitelist()
def get_item_transactions(item_code: str, limit: int = 100):
	"""Purchase, sale, and stock-entry history for one item."""
	if not item_code or not frappe.db.exists("Item", item_code):
		return []

	limit = int(limit)
	rows = []

	# Purchases
	pi_items = frappe.db.sql(
		"""
		SELECT
			'Purchase' AS type,
			'Purchase Invoice' AS doctype,
			pi.name AS invoice_no,
			pi.supplier AS party_name,
			pi.posting_date AS txn_date,
			pii.qty AS quantity,
			pii.rate AS rate,
			pi.outstanding_amount,
			pi.grand_total,
			pi.docstatus
		FROM `tabPurchase Invoice Item` pii
		INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pii.item_code = %s AND pi.docstatus = 1
		""",
		item_code,
		as_dict=True,
	)
	for r in pi_items:
		r["status"] = "Unpaid" if flt(r.outstanding_amount) > 0 else "Paid"
		rows.append(r)

	# Sales (Sales Invoice)
	si_items = frappe.db.sql(
		"""
		SELECT
			'Sale' AS type,
			'Sales Invoice' AS doctype,
			si.name AS invoice_no,
			si.customer AS party_name,
			si.posting_date AS txn_date,
			sii.qty AS quantity,
			sii.rate AS rate,
			si.outstanding_amount,
			si.grand_total,
			si.docstatus
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.item_code = %s AND si.docstatus = 1
		""",
		item_code,
		as_dict=True,
	)
	for r in si_items:
		r["status"] = "Unpaid" if flt(r.outstanding_amount) > 0 else "Paid"
		rows.append(r)

	# POS Sales
	pos_items = frappe.db.sql(
		"""
		SELECT
			'Sale' AS type,
			'POS Invoice' AS doctype,
			pi.name AS invoice_no,
			pi.customer AS party_name,
			pi.posting_date AS txn_date,
			pii.qty AS quantity,
			pii.rate AS rate,
			pi.outstanding_amount,
			pi.grand_total,
			pi.docstatus
		FROM `tabPOS Invoice Item` pii
		INNER JOIN `tabPOS Invoice` pi ON pi.name = pii.parent
		WHERE pii.item_code = %s AND pi.docstatus = 1
		""",
		item_code,
		as_dict=True,
	)
	for r in pos_items:
		r["status"] = "Unpaid" if flt(r.outstanding_amount) > 0 else "Paid"
		rows.append(r)

	# Stock movements (receipts, issues, transfers, reconciliation via Stock Entry)
	stock_items = frappe.db.sql(
		"""
		SELECT
			se.stock_entry_type AS type,
			'Stock Entry' AS doctype,
			se.name AS invoice_no,
			COALESCE(se.from_warehouse, se.to_warehouse, '') AS party_name,
			se.posting_date AS txn_date,
			sed.qty AS quantity,
			sed.basic_rate AS rate,
			0 AS outstanding_amount,
			0 AS grand_total,
			se.docstatus
		FROM `tabStock Entry Detail` sed
		INNER JOIN `tabStock Entry` se ON se.name = sed.parent
		WHERE sed.item_code = %s AND se.docstatus = 1
		""",
		item_code,
		as_dict=True,
	)
	for r in stock_items:
		r["status"] = "Completed"
		rows.append(r)

	rows.sort(key=lambda r: (r.txn_date or "", r.invoice_no or ""), reverse=True)
	return rows[:limit]


@frappe.whitelist()
def get_item_groups_list(search: str = None):
	"""Item groups for the Category tab."""
	filters = {"is_group": 0}
	or_filters = None
	if search:
		or_filters = {"name": ["like", f"%{search}%"]}
	groups = frappe.get_all(
		"Item Group",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "parent_item_group"],
		order_by="name asc",
		limit_page_length=0,
	)
	for g in groups:
		g["item_count"] = frappe.db.count("Item", {"item_group": g.name, "disabled": 0})
	return groups


@frappe.whitelist()
def get_uom_list(search: str = None):
	"""UOM list for the Units tab."""
	or_filters = None
	if search:
		or_filters = {"uom_name": ["like", f"%{search}%"]}
	return frappe.get_all(
		"UOM",
		or_filters=or_filters,
		fields=["name", "uom_name", "must_be_whole_number"],
		order_by="name asc",
		limit_page_length=0,
	)


def _sale_resolve_date_range(period: str = "This Month", from_date=None, to_date=None):
	from frappe.utils import add_days, add_months, get_first_day, get_last_day, getdate, today

	if from_date and to_date:
		return getdate(from_date), getdate(to_date)

	today_date = getdate(today())
	period = period or "This Month"

	if period == "Today":
		return today_date, today_date
	if period == "This Week":
		start = add_days(today_date, -today_date.weekday())
		return start, add_days(start, 6)
	if period == "Last Month":
		ref = add_months(today_date, -1)
		return get_first_day(ref), get_last_day(ref)
	if period == "This Year":
		return getdate(f"{today_date.year}-01-01"), getdate(f"{today_date.year}-12-31")
	if period == "This Quarter":
		quarter_start_month = ((today_date.month - 1) // 3) * 3 + 1
		start = getdate(f"{today_date.year}-{quarter_start_month:02d}-01")
		return start, get_last_day(add_months(start, 2))

	return get_first_day(today_date), get_last_day(today_date)


def _sale_company_filter(company: str = None):
	if company in ("", "__all__", "All Firms"):
		return None
	return company or frappe.defaults.get_user_default("Company")


def _sale_payment_modes(doctype: str, parent_names: list):
	if not parent_names:
		return {}
	# POS Invoice and Sales Invoice both use the "Sales Invoice Payment" child table.
	child = "Sales Invoice Payment"
	rows = frappe.get_all(
		child,
		filters={"parent": ["in", parent_names], "parenttype": doctype},
		fields=["parent", "mode_of_payment", "amount"],
	)
	modes = {}
	for r in rows:
		modes.setdefault(r.parent, []).append(r.mode_of_payment)
	return {k: ", ".join(sorted(set(v))) for k, v in modes.items()}


def _sale_fetch_pos_rows(start, end, company, is_return=None, search=None):
	filters = {"docstatus": 1, "posting_date": ["between", [start, end]]}
	if company:
		filters["company"] = company
	if is_return is not None:
		filters["is_return"] = 1 if is_return else 0

	or_filters = None
	if search:
		or_filters = {
			"name": ["like", f"%{search}%"],
			"customer": ["like", f"%{search}%"],
		}

	rows = frappe.get_all(
		"POS Invoice",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "posting_date", "customer", "grand_total", "outstanding_amount", "is_return"],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)
	modes = _sale_payment_modes("POS Invoice", [r.name for r in rows])
	out = []
	for r in rows:
		out.append(
			{
				"doctype": "POS Invoice",
				"invoice_no": r.name,
				"posting_date": r.posting_date,
				"party_name": r.customer,
				"transaction": "Return" if r.is_return else "Sale",
				"payment_type": modes.get(r.name) or "—",
				"amount": flt(r.grand_total),
				"balance": flt(r.outstanding_amount),
				"status": "Unpaid" if flt(r.outstanding_amount) > 0 else "Paid",
			}
		)
	return out


def _sale_fetch_si_rows(start, end, company, is_return=None, drafts_only=False, search=None):
	filters = {"posting_date": ["between", [start, end]]}
	if drafts_only:
		filters["docstatus"] = 0
	else:
		filters["docstatus"] = 1
	if company:
		filters["company"] = company
	if is_return is not None:
		filters["is_return"] = 1 if is_return else 0
	else:
		filters["is_pos"] = 0

	or_filters = None
	if search:
		or_filters = {
			"name": ["like", f"%{search}%"],
			"customer": ["like", f"%{search}%"],
		}

	rows = frappe.get_all(
		"Sales Invoice",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "posting_date", "customer", "grand_total", "outstanding_amount", "is_return", "docstatus"],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)
	modes = _sale_payment_modes("Sales Invoice", [r.name for r in rows])
	out = []
	for r in rows:
		txn = "Return" if r.is_return else ("Proforma" if drafts_only else "Sale")
		out.append(
			{
				"doctype": "Sales Invoice",
				"invoice_no": r.name,
				"posting_date": r.posting_date,
				"party_name": r.customer,
				"transaction": txn,
				"payment_type": modes.get(r.name) or "—",
				"amount": flt(r.grand_total),
				"balance": flt(r.outstanding_amount),
				"status": "Draft" if r.docstatus == 0 else ("Unpaid" if flt(r.outstanding_amount) > 0 else "Paid"),
			}
		)
	return out


@frappe.whitelist()
def get_sale_dashboard_data(
	period: str = "This Month",
	from_date: str = None,
	to_date: str = None,
	company: str = None,
	view: str = "invoices",
	search: str = None,
):
	"""Sale dashboard summary + transactions for the Santu Sale page."""
	start, end = _sale_resolve_date_range(period, from_date, to_date)
	company = _sale_company_filter(company)

	transactions = []
	if view in ("invoices", "dashboard", ""):
		transactions = _sale_fetch_pos_rows(start, end, company, is_return=0, search=search)
		transactions += _sale_fetch_si_rows(start, end, company, is_return=0, search=search)
	elif view == "quotation":
		filters = {"transaction_date": ["between", [start, end]], "docstatus": ["!=", 2]}
		if company:
			filters["company"] = company
		or_filters = None
		if search:
			or_filters = {"name": ["like", f"%{search}%"], "party_name": ["like", f"%{search}%"]}
		rows = frappe.get_all(
			"Quotation",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "transaction_date", "party_name", "grand_total", "status", "docstatus"],
			order_by="transaction_date desc, creation desc",
			limit_page_length=200,
		)
		for r in rows:
			transactions.append(
				{
					"doctype": "Quotation",
					"invoice_no": r.name,
					"posting_date": r.transaction_date,
					"party_name": r.party_name,
					"transaction": "Estimate",
					"payment_type": "—",
					"amount": flt(r.grand_total),
					"balance": 0,
					"status": r.status or ("Draft" if r.docstatus == 0 else "Submitted"),
				}
			)
	elif view == "proforma":
		transactions = _sale_fetch_si_rows(start, end, company, drafts_only=True, search=search)
	elif view == "payment_in":
		filters = {
			"docstatus": 1,
			"payment_type": "Receive",
			"posting_date": ["between", [start, end]],
		}
		if company:
			filters["company"] = company
		or_filters = None
		if search:
			or_filters = {"name": ["like", f"%{search}%"], "party": ["like", f"%{search}%"]}
		rows = frappe.get_all(
			"Payment Entry",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "posting_date", "party", "paid_amount", "mode_of_payment", "status"],
			order_by="posting_date desc, creation desc",
			limit_page_length=200,
		)
		for r in rows:
			transactions.append(
				{
					"doctype": "Payment Entry",
					"invoice_no": r.name,
					"posting_date": r.posting_date,
					"party_name": r.party,
					"transaction": "Payment In",
					"payment_type": r.mode_of_payment or "—",
					"amount": flt(r.paid_amount),
					"balance": 0,
					"status": r.status or "Submitted",
				}
			)
	elif view == "sales_order":
		filters = {"transaction_date": ["between", [start, end]], "docstatus": ["!=", 2]}
		if company:
			filters["company"] = company
		or_filters = None
		if search:
			or_filters = {"name": ["like", f"%{search}%"], "customer": ["like", f"%{search}%"]}
		rows = frappe.get_all(
			"Sales Order",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "transaction_date", "customer", "grand_total", "status", "docstatus"],
			order_by="transaction_date desc, creation desc",
			limit_page_length=200,
		)
		for r in rows:
			transactions.append(
				{
					"doctype": "Sales Order",
					"invoice_no": r.name,
					"posting_date": r.transaction_date,
					"party_name": r.customer,
					"transaction": "Sales Order",
					"payment_type": "—",
					"amount": flt(r.grand_total),
					"balance": 0,
					"status": r.status or ("Draft" if r.docstatus == 0 else "Submitted"),
				}
			)
	elif view == "delivery_challan":
		filters = {"posting_date": ["between", [start, end]], "docstatus": ["!=", 2]}
		if company:
			filters["company"] = company
		or_filters = None
		if search:
			or_filters = {"name": ["like", f"%{search}%"], "customer": ["like", f"%{search}%"]}
		rows = frappe.get_all(
			"Delivery Note",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "posting_date", "customer", "grand_total", "status", "docstatus"],
			order_by="posting_date desc, creation desc",
			limit_page_length=200,
		)
		for r in rows:
			transactions.append(
				{
					"doctype": "Delivery Note",
					"invoice_no": r.name,
					"posting_date": r.posting_date,
					"party_name": r.customer,
					"transaction": "Delivery Challan",
					"payment_type": "—",
					"amount": flt(r.grand_total),
					"balance": 0,
					"status": r.status or ("Draft" if r.docstatus == 0 else "Submitted"),
				}
			)
	elif view == "sales_return":
		transactions = _sale_fetch_pos_rows(start, end, company, is_return=1, search=search)
		transactions += _sale_fetch_si_rows(start, end, company, is_return=1, search=search)

	transactions.sort(key=lambda r: (r.get("posting_date") or "", r.get("invoice_no") or ""), reverse=True)

	# Summary — POS + non-POS Sales Invoice only (no double-count)
	sale_rows = _sale_fetch_pos_rows(start, end, company, is_return=0)
	sale_rows += _sale_fetch_si_rows(start, end, company, is_return=0)
	total_sales = sum(flt(r["amount"]) for r in sale_rows)
	received = sum(flt(r["amount"]) - flt(r["balance"]) for r in sale_rows)
	balance = sum(flt(r["balance"]) for r in sale_rows)

	# vs last month
	from frappe.utils import add_months, get_first_day, get_last_day, getdate, today

	today_date = getdate(today())
	last_month_ref = add_months(today_date, -1)
	lm_start, lm_end = get_first_day(last_month_ref), get_last_day(last_month_ref)
	lm_rows = _sale_fetch_pos_rows(lm_start, lm_end, company, is_return=0)
	lm_rows += _sale_fetch_si_rows(lm_start, lm_end, company, is_return=0)
	last_month_total = sum(flt(r["amount"]) for r in lm_rows)
	if last_month_total:
		pct_vs_last_month = round((total_sales - last_month_total) / last_month_total * 100, 1)
	else:
		pct_vs_last_month = 100.0 if total_sales else 0.0

	companies = frappe.get_all("Company", fields=["name"], order_by="name asc")

	return {
		"period": period,
		"from_date": str(start),
		"to_date": str(end),
		"company": company,
		"view": view,
		"summary": {
			"total_sales": total_sales,
			"received": received,
			"balance": balance,
			"pct_vs_last_month": pct_vs_last_month,
		},
		"transactions": transactions,
		"companies": [c.name for c in companies],
	}


def _purchase_payment_modes(parent_names: list):
	if not parent_names:
		return {}
	refs = frappe.get_all(
		"Payment Entry Reference",
		filters={"reference_doctype": "Purchase Invoice", "reference_name": ["in", parent_names]},
		fields=["reference_name", "parent"],
	)
	if not refs:
		return {}
	pe_names = list({r.parent for r in refs})
	pes = frappe.get_all(
		"Payment Entry",
		filters={"name": ["in", pe_names], "docstatus": 1},
		fields=["name", "mode_of_payment"],
	)
	pe_map = {p.name: p.mode_of_payment for p in pes}
	modes = {}
	for r in refs:
		mop = pe_map.get(r.parent)
		if mop:
			modes.setdefault(r.reference_name, set()).add(mop)
	return {k: ", ".join(sorted(v)) for k, v in modes.items()}


def _purchase_fetch_pi_rows(start, end, company, is_return=None, search=None):
	filters = {"docstatus": 1, "posting_date": ["between", [start, end]]}
	if company:
		filters["company"] = company
	if is_return is not None:
		filters["is_return"] = 1 if is_return else 0

	or_filters = None
	if search:
		or_filters = {
			"name": ["like", f"%{search}%"],
			"supplier": ["like", f"%{search}%"],
			"supplier_name": ["like", f"%{search}%"],
		}

	rows = frappe.get_all(
		"Purchase Invoice",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"posting_date",
			"supplier",
			"supplier_name",
			"grand_total",
			"outstanding_amount",
			"is_return",
			"bill_no",
			"status",
		],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)
	modes = _purchase_payment_modes([r.name for r in rows])
	out = []
	for r in rows:
		bal = flt(r.outstanding_amount)
		paid = flt(r.grand_total) - bal
		out.append(
			{
				"doctype": "Purchase Invoice",
				"invoice_no": r.name,
				"ref_no": r.bill_no or r.name,
				"posting_date": r.posting_date,
				"party_name": r.supplier_name or r.supplier,
				"transaction": "Debit Note" if r.is_return else "Purchase",
				"payment_type": modes.get(r.name) or ("Credit" if bal > 0 else "Paid"),
				"amount": flt(r.grand_total),
				"balance": bal,
				"paid": paid,
				"status": r.status or ("Unpaid" if bal > 0 else "Paid"),
				"type": "Debit Note" if r.is_return else "Purchase Bill",
				"category_name": "—",
			}
		)
	return out


def _purchase_fetch_payment_out_rows(start, end, company, search=None):
	filters = {
		"docstatus": 1,
		"payment_type": "Pay",
		"party_type": "Supplier",
		"posting_date": ["between", [start, end]],
	}
	if company:
		filters["company"] = company
	or_filters = None
	if search:
		or_filters = {"name": ["like", f"%{search}%"], "party": ["like", f"%{search}%"]}
	rows = frappe.get_all(
		"Payment Entry",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "posting_date", "party", "paid_amount", "mode_of_payment", "status", "reference_no"],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)
	out = []
	for r in rows:
		out.append(
			{
				"doctype": "Payment Entry",
				"invoice_no": r.name,
				"posting_date": r.posting_date,
				"party_name": r.party,
				"transaction": "Payment Out",
				"payment_type": r.mode_of_payment or "—",
				"amount": flt(r.paid_amount),
				"balance": 0,
				"paid": flt(r.paid_amount),
				"reference": r.reference_no or r.name,
				"status": r.status or "Submitted",
			}
		)
	return out


def _purchase_fetch_expense_rows(start, end, company, search=None):
	out = []
	seen = set()

	# Payment Entry Pay that is not a supplier payment
	pe_filters = {
		"docstatus": 1,
		"payment_type": "Pay",
		"posting_date": ["between", [start, end]],
	}
	if company:
		pe_filters["company"] = company
	or_filters = None
	if search:
		or_filters = {"name": ["like", f"%{search}%"], "party": ["like", f"%{search}%"]}
	pe_rows = frappe.get_all(
		"Payment Entry",
		filters=pe_filters,
		or_filters=or_filters,
		fields=["name", "posting_date", "party", "party_type", "paid_amount", "mode_of_payment", "reference_no", "paid_to"],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)
	for r in pe_rows:
		if r.party_type == "Supplier":
			continue
		key = ("Payment Entry", r.name)
		if key in seen:
			continue
		seen.add(key)
		out.append(
			{
				"doctype": "Payment Entry",
				"invoice_no": r.name,
				"posting_date": r.posting_date,
				"party_name": r.party or "—",
				"expense_account": r.paid_to or "—",
				"payment_type": r.mode_of_payment or "—",
				"amount": flt(r.paid_amount),
				"reference": r.reference_no or r.name,
				"transaction": "Expense",
				"balance": 0,
				"status": "Submitted",
			}
		)

	# Journal Entry lines debiting expense accounts
	expense_accounts = frappe.get_all(
		"Account",
		filters={"root_type": "Expense", "is_group": 0, "disabled": 0},
		pluck="name",
	)
	if expense_accounts:
		je_filters = {"docstatus": 1, "posting_date": ["between", [start, end]]}
		if company:
			je_filters["company"] = company
		je_names = frappe.get_all("Journal Entry", filters=je_filters, pluck="name")
		if je_names:
			ja_filters = {
				"parent": ["in", je_names],
				"parenttype": "Journal Entry",
				"account": ["in", expense_accounts],
				"debit_in_account_currency": [">", 0],
			}
			ja_rows = frappe.get_all(
				"Journal Entry Account",
				filters=ja_filters,
				fields=["parent", "account", "debit_in_account_currency", "party", "user_remark"],
			)
			je_meta = {
				j.name: j
				for j in frappe.get_all(
					"Journal Entry",
					filters={"name": ["in", list({a.parent for a in ja_rows})]},
					fields=["name", "posting_date", "cheque_no", "user_remark"],
				)
			}
			for ja in ja_rows:
				je = je_meta.get(ja.parent)
				if not je:
					continue
				key = ("Journal Entry", f"{ja.parent}:{ja.account}")
				if key in seen:
					continue
				if search:
					q = search.lower()
					if q not in ja.parent.lower() and q not in (ja.account or "").lower() and q not in (ja.party or "").lower():
						continue
				seen.add(key)
				out.append(
					{
						"doctype": "Journal Entry",
						"invoice_no": ja.parent,
						"posting_date": je.posting_date,
						"party_name": ja.party or "—",
						"expense_account": ja.account,
						"payment_type": "Journal",
						"amount": flt(ja.debit_in_account_currency),
						"reference": ja.user_remark or je.cheque_no or ja.parent,
						"transaction": "Expense",
						"balance": 0,
						"status": "Submitted",
					}
				)

	out.sort(key=lambda r: (r.get("posting_date") or "", r.get("invoice_no") or ""), reverse=True)
	return out[:200]


def _purchase_fetch_po_rows(start, end, company, search=None):
	filters = {"transaction_date": ["between", [start, end]], "docstatus": ["!=", 2]}
	if company:
		filters["company"] = company
	or_filters = None
	if search:
		or_filters = {"name": ["like", f"%{search}%"], "supplier": ["like", f"%{search}%"], "supplier_name": ["like", f"%{search}%"]}
	rows = frappe.get_all(
		"Purchase Order",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "transaction_date", "supplier", "supplier_name", "grand_total", "status", "docstatus", "per_billed"],
		order_by="transaction_date desc, creation desc",
		limit_page_length=200,
	)
	out = []
	for r in rows:
		out.append(
			{
				"doctype": "Purchase Order",
				"invoice_no": r.name,
				"posting_date": r.transaction_date,
				"party_name": r.supplier_name or r.supplier,
				"transaction": "Purchase Order",
				"payment_type": "—",
				"amount": flt(r.grand_total),
				"balance": 0,
				"status": r.status or ("Draft" if r.docstatus == 0 else "Submitted"),
				"per_billed": flt(r.per_billed),
			}
		)
	return out


@frappe.whitelist()
def get_purchase_dashboard_data(
	period: str = "This Month",
	from_date: str = None,
	to_date: str = None,
	company: str = None,
	view: str = "bills",
	search: str = None,
	return_type: str = "debit_note",
):
	"""Purchase & Expense dashboard summary + transactions."""
	start, end = _sale_resolve_date_range(period, from_date, to_date)
	company = _sale_company_filter(company)

	transactions = []
	if view in ("bills", "dashboard", ""):
		transactions = _purchase_fetch_pi_rows(start, end, company, is_return=0, search=search)
	elif view == "payment_out":
		transactions = _purchase_fetch_payment_out_rows(start, end, company, search=search)
	elif view == "expenses":
		transactions = _purchase_fetch_expense_rows(start, end, company, search=search)
	elif view == "purchase_order":
		transactions = _purchase_fetch_po_rows(start, end, company, search=search)
	elif view == "purchase_return":
		transactions = _purchase_fetch_pi_rows(start, end, company, is_return=1, search=search)

	transactions.sort(key=lambda r: (r.get("posting_date") or "", r.get("invoice_no") or ""), reverse=True)

	# Summary per view
	summary = {}
	if view in ("bills", "dashboard", ""):
		bill_rows = _purchase_fetch_pi_rows(start, end, company, is_return=0)
		total = sum(flt(r["amount"]) for r in bill_rows)
		unpaid = sum(flt(r["balance"]) for r in bill_rows)
		paid = sum(flt(r.get("paid", flt(r["amount"]) - flt(r["balance"]))) for r in bill_rows)
		summary = {"paid": paid, "unpaid": unpaid, "total": total, "summary_type": "bills"}
	elif view == "payment_out":
		pay_rows = _purchase_fetch_payment_out_rows(start, end, company)
		total = sum(flt(r["amount"]) for r in pay_rows)
		from frappe.utils import add_months, get_first_day, get_last_day, getdate, today

		today_date = getdate(today())
		lm_ref = add_months(today_date, -1)
		lm_rows = _purchase_fetch_payment_out_rows(get_first_day(lm_ref), get_last_day(lm_ref), company)
		lm_total = sum(flt(r["amount"]) for r in lm_rows)
		if lm_total:
			pct = round((total - lm_total) / lm_total * 100, 1)
		else:
			pct = 100.0 if total else 0.0
		summary = {"total_amount": total, "paid": total, "pct_vs_last_month": pct, "summary_type": "payment_out"}
	elif view == "expenses":
		exp_rows = _purchase_fetch_expense_rows(start, end, company)
		summary = {"total_expenses": sum(flt(r["amount"]) for r in exp_rows), "summary_type": "expenses"}
	elif view == "purchase_order":
		summary = {"count": len(transactions), "summary_type": "purchase_order"}
	elif view == "purchase_return":
		ret_rows = transactions
		summary = {
			"total_amount": sum(flt(r["amount"]) for r in ret_rows),
			"balance": sum(flt(r["balance"]) for r in ret_rows),
			"paid": sum(flt(r.get("paid", 0)) for r in ret_rows),
			"summary_type": "purchase_return",
			"return_type": return_type,
		}

	companies = frappe.get_all("Company", fields=["name"], order_by="name asc")

	return {
		"period": period,
		"from_date": str(start),
		"to_date": str(end),
		"company": company,
		"view": view,
		"return_type": return_type,
		"summary": summary,
		"transactions": transactions,
		"companies": [c.name for c in companies],
	}


def _report_columns(fields):
	return [{"fieldname": f[0], "label": f[1], "fieldtype": f[2] if len(f) > 2 else "Data", "width": f[3] if len(f) > 3 else 120} for f in fields]


def _report_date_filters(filters):
	start, end = _sale_resolve_date_range("Custom", filters.get("from_date"), filters.get("to_date"))
	company = _sale_company_filter(filters.get("company"))
	return start, end, company


def _report_sale_purchase_by_party(filters):
	start, end, company = _report_date_filters(filters)
	cols = _report_columns([
		("party_name", "Party", "Data", 180),
		("party_type", "Type", "Data", 100),
		("sale_amount", "Sale Amount", "Currency", 120),
		("purchase_amount", "Purchase Amount", "Currency", 120),
		("net", "Net", "Currency", 120),
	])
	parties = {}

	def add_rows(fetch_fn, key):
		for r in fetch_fn(start, end, company, is_return=0):
			p = r.get("party_name") or "—"
			parties.setdefault(p, {"party_name": p, "party_type": "Customer" if key == "sale" else "Supplier", "sale_amount": 0, "purchase_amount": 0})
			parties[p][f"{key}_amount"] += flt(r.get("amount"))

	add_rows(_sale_fetch_pos_rows, "sale")
	add_rows(_sale_fetch_si_rows, "sale")
	add_rows(_purchase_fetch_pi_rows, "purchase")

	result = []
	for p in sorted(parties.values(), key=lambda x: x["party_name"]):
		p["net"] = flt(p["sale_amount"]) - flt(p["purchase_amount"])
		result.append(p)
	return {"columns": cols, "result": result}


def _report_sale_purchase_party_group(filters):
	start, end, company = _report_date_filters(filters)
	cols = _report_columns([
		("group_name", "Party Group", "Data", 180),
		("sale_amount", "Sale Amount", "Currency", 120),
		("purchase_amount", "Purchase Amount", "Currency", 120),
	])
	groups = {}

	def add_sale(customer, amount):
		grp = frappe.db.get_value("Customer", customer, "customer_group") or "—"
		groups.setdefault(grp, {"group_name": grp, "sale_amount": 0, "purchase_amount": 0})
		groups[grp]["sale_amount"] += flt(amount)

	def add_purchase(supplier, amount):
		grp = frappe.db.get_value("Supplier", supplier, "supplier_group") or "—"
		groups.setdefault(grp, {"group_name": grp, "sale_amount": 0, "purchase_amount": 0})
		groups[grp]["purchase_amount"] += flt(amount)

	for r in _sale_fetch_pos_rows(start, end, company, is_return=0):
		add_sale(r.get("party_name"), r.get("amount"))
	for r in _sale_fetch_si_rows(start, end, company, is_return=0):
		add_sale(r.get("party_name"), r.get("amount"))
	for r in _purchase_fetch_pi_rows(start, end, company, is_return=0):
		add_purchase(r.get("party_name"), r.get("amount"))

	return {"columns": cols, "result": sorted(groups.values(), key=lambda x: x["group_name"])}


def _report_all_parties(filters):
	company = _sale_company_filter(filters.get("company"))
	cols = _report_columns([
		("party_name", "Party", "Data", 180),
		("party_type", "Type", "Data", 100),
		("outstanding", "Outstanding", "Currency", 120),
	])
	result = []
	si_filters = {"docstatus": 1, "outstanding_amount": [">", 0]}
	pi_filters = {"docstatus": 1, "outstanding_amount": [">", 0]}
	if company:
		si_filters["company"] = company
		pi_filters["company"] = company

	cust_out = {}
	for r in frappe.get_all("Sales Invoice", filters=si_filters, fields=["customer", "outstanding_amount"]):
		cust_out[r.customer] = cust_out.get(r.customer, 0) + flt(r.outstanding_amount)
	for cust in frappe.get_all("Customer", fields=["name", "customer_name"], order_by="name asc"):
		result.append({
			"party_name": cust.customer_name or cust.name,
			"party_type": "Customer",
			"outstanding": cust_out.get(cust.name, 0),
		})

	sup_out = {}
	for r in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["supplier", "outstanding_amount"]):
		sup_out[r.supplier] = sup_out.get(r.supplier, 0) + flt(r.outstanding_amount)
	for sup in frappe.get_all("Supplier", fields=["name", "supplier_name"], order_by="name asc"):
		result.append({
			"party_name": sup.supplier_name or sup.name,
			"party_type": "Supplier",
			"outstanding": sup_out.get(sup.name, 0),
		})
	return {"columns": cols, "result": result}


def _report_item_detail(filters):
	item = filters.get("item") or filters.get("item_code")
	if not item:
		return {"columns": _report_columns([("message", "Message", "Data", 300)]), "result": [{"message": "Please select an Item in filters."}]}
	cols = _report_columns([
		("field", "Field", "Data", 160),
		("value", "Value", "Data", 240),
	])
	item_doc = frappe.get_doc("Item", item)
	fields = [
		("Item Code", item_doc.name),
		("Item Name", item_doc.item_name),
		("Item Group", item_doc.item_group),
		("Stock UOM", item_doc.stock_uom),
		("Standard Rate", item_doc.standard_rate),
		("Valuation Rate", frappe.db.get_value("Item", item, "valuation_rate") or 0),
	]
	bin = frappe.db.get_value("Bin", {"item_code": item}, ["actual_qty", "stock_value"], as_dict=True) or {}
	fields.append(("Stock Qty", bin.get("actual_qty") or 0))
	fields.append(("Stock Value", bin.get("stock_value") or 0))
	return {"columns": cols, "result": [{"field": f[0], "value": f[1]} for f in fields]}


def _report_discount(filters):
	start, end, company = _report_date_filters(filters)
	cols = _report_columns([
		("posting_date", "Date", "Date", 100),
		("invoice_no", "Invoice", "Data", 140),
		("item_code", "Item", "Data", 140),
		("party_name", "Party", "Data", 140),
		("qty", "Qty", "Float", 80),
		("discount_amount", "Discount", "Currency", 100),
		("amount", "Amount", "Currency", 100),
	])
	result = []
	si_filters = {"docstatus": 1, "posting_date": ["between", [start, end]], "is_return": 0}
	if company:
		si_filters["company"] = company
	for parent in frappe.get_all("Sales Invoice", filters=si_filters, pluck="name"):
		for row in frappe.get_all(
			"Sales Invoice Item",
			filters={"parent": parent, "discount_amount": [">", 0]},
			fields=["item_code", "qty", "discount_amount", "amount"],
		):
			result.append({
				"posting_date": frappe.db.get_value("Sales Invoice", parent, "posting_date"),
				"invoice_no": parent,
				"item_code": row.item_code,
				"party_name": frappe.db.get_value("Sales Invoice", parent, "customer"),
				"qty": row.qty,
				"discount_amount": row.discount_amount,
				"amount": row.amount,
			})
	pos_filters = {"docstatus": 1, "posting_date": ["between", [start, end]], "is_return": 0}
	if company:
		pos_filters["company"] = company
	for parent in frappe.get_all("POS Invoice", filters=pos_filters, pluck="name"):
		for row in frappe.get_all(
			"POS Invoice Item",
			filters={"parent": parent, "discount_amount": [">", 0]},
			fields=["item_code", "qty", "discount_amount", "amount"],
		):
			result.append({
				"posting_date": frappe.db.get_value("POS Invoice", parent, "posting_date"),
				"invoice_no": parent,
				"item_code": row.item_code,
				"party_name": frappe.db.get_value("POS Invoice", parent, "customer"),
				"qty": row.qty,
				"discount_amount": row.discount_amount,
				"amount": row.amount,
			})
	result.sort(key=lambda r: (str(r.get("posting_date") or ""), r.get("invoice_no") or ""), reverse=True)
	return {"columns": cols, "result": result}


def _report_expense(filters):
	start, end, company = _report_date_filters(filters)
	rows = _purchase_fetch_expense_rows(start, end, company)
	cols = _report_columns([
		("posting_date", "Date", "Date", 100),
		("expense_account", "Expense Account", "Data", 180),
		("party_name", "Party", "Data", 140),
		("payment_type", "Payment Mode", "Data", 120),
		("amount", "Amount", "Currency", 100),
		("reference", "Reference", "Data", 140),
	])
	return {"columns": cols, "result": rows}


def _report_expense_category(filters):
	start, end, company = _report_date_filters(filters)
	rows = _purchase_fetch_expense_rows(start, end, company)
	cats = {}
	for r in rows:
		acct = r.get("expense_account") or "—"
		cats.setdefault(acct, {"expense_account": acct, "amount": 0, "count": 0})
		cats[acct]["amount"] += flt(r.get("amount"))
		cats[acct]["count"] += 1
	cols = _report_columns([
		("expense_account", "Expense Category", "Data", 200),
		("count", "Transactions", "Int", 100),
		("amount", "Total Amount", "Currency", 120),
	])
	result = sorted(cats.values(), key=lambda x: x["amount"], reverse=True)
	return {"columns": cols, "result": result}


def _report_expense_item(filters):
	start, end, company = _report_date_filters(filters)
	je_filters = {"docstatus": 1, "posting_date": ["between", [start, end]]}
	if company:
		je_filters["company"] = company
	expense_accounts = frappe.get_all("Account", filters={"root_type": "Expense", "is_group": 0}, pluck="name")
	cols = _report_columns([
		("posting_date", "Date", "Date", 100),
		("account", "Expense Account", "Data", 180),
		("party", "Party", "Data", 140),
		("amount", "Amount", "Currency", 100),
		("reference", "Reference", "Data", 140),
	])
	result = []
	if expense_accounts:
		je_names = frappe.get_all("Journal Entry", filters=je_filters, pluck="name")
		if je_names:
			for ja in frappe.get_all(
				"Journal Entry Account",
				filters={"parent": ["in", je_names], "account": ["in", expense_accounts], "debit_in_account_currency": [">", 0]},
				fields=["parent", "account", "party", "debit_in_account_currency", "user_remark"],
			):
				result.append({
					"posting_date": frappe.db.get_value("Journal Entry", ja.parent, "posting_date"),
					"account": ja.account,
					"party": ja.party or "—",
					"amount": ja.debit_in_account_currency,
					"reference": ja.user_remark or ja.parent,
				})
	return {"columns": cols, "result": result}


_SANTU_REPORT_HANDLERS = {
	"sale_purchase_by_party": _report_sale_purchase_by_party,
	"sale_purchase_party_group": _report_sale_purchase_party_group,
	"all_parties": _report_all_parties,
	"item_detail": _report_item_detail,
	"discount_report": _report_discount,
	"expense": _report_expense,
	"expense_category": _report_expense_category,
	"expense_item": _report_expense_item,
}


@frappe.whitelist()
def get_reports_init():
	company = frappe.defaults.get_user_default("Company")
	from frappe.utils import get_first_day, today

	today_date = today()
	return {
		"company": company,
		"from_date": str(get_first_day(today_date)),
		"to_date": str(today_date),
		"companies": [c.name for c in frappe.get_all("Company", fields=["name"], order_by="name asc")],
	}


@frappe.whitelist()
def run_santu_report(report_id, filters=None):
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)
	filters = filters or {}
	handler = _SANTU_REPORT_HANDLERS.get(report_id)
	if not handler:
		frappe.throw(f"Unknown custom report: {report_id}")
	return handler(filters)


@frappe.whitelist()
def export_santu_report(report_id, filters=None):
	import csv
	import os
	import tempfile

	from frappe.utils.file_manager import save_file

	data = run_santu_report(report_id, filters)
	cols = data.get("columns") or []
	rows = data.get("result") or []
	headers = [c.get("label") or c.get("fieldname") for c in cols]
	csv_rows = [headers]
	for row in rows:
		if isinstance(row, dict):
			csv_rows.append([row.get(c.get("fieldname")) for c in cols])
		else:
			csv_rows.append(list(row))

	fd, path = tempfile.mkstemp(suffix=".csv")
	os.close(fd)
	with open(path, "w", newline="", encoding="utf-8") as f:
		writer = csv.writer(f)
		writer.writerows(csv_rows)
	with open(path, "rb") as f:
		file_doc = save_file(f"{report_id}-{frappe.utils.today()}.csv", f.read(), None, None, is_private=0)
	try:
		os.unlink(path)
	except OSError:
		pass
	return file_doc.file_url


@frappe.whitelist()
def get_sale_invoice_init():
	"""Defaults for the quick Sale Invoice screen."""
	company = frappe.defaults.get_user_default("Company")
	warehouse = frappe.db.get_value(
		"Warehouse", {"is_group": 0, "disabled": 0, "company": company}, "name"
	)
	price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	payment_modes = frappe.get_all(
		"Mode of Payment",
		filters={"enabled": 1},
		fields=["name", "type"],
		order_by="name asc",
	)
	return {
		"company": company,
		"warehouse": warehouse,
		"selling_price_list": price_list,
		"posting_date": frappe.utils.today(),
		"payment_modes": payment_modes,
	}


@frappe.whitelist()
def get_customer_details_for_sale(customer: str):
	if not customer or not frappe.db.exists("Customer", customer):
		return {}
	cust = frappe.get_doc("Customer", customer)
	address_line = None
	if cust.customer_primary_address:
		addr = frappe.db.get_value(
			"Address",
			cust.customer_primary_address,
			["address_line1", "city", "state", "pincode"],
			as_dict=True,
		)
		if addr:
			address_line = ", ".join(filter(None, [addr.address_line1, addr.city, addr.state, addr.pincode]))
	return {
		"name": cust.name,
		"customer_name": cust.customer_name,
		"mobile_no": cust.mobile_no,
		"village": cust.get("santu_village"),
		"address": address_line,
	}


@frappe.whitelist()
def get_sale_item_row(customer: str, item_code: str, warehouse: str = None, qty: float = 1):
	"""Fetch ERPNext item row details for Sales Invoice."""
	from erpnext.stock.get_item_details import get_item_details

	company = frappe.defaults.get_user_default("Company")
	if not warehouse:
		warehouse = frappe.db.get_value(
			"Warehouse", {"is_group": 0, "disabled": 0, "company": company}, "name"
		)
	args = frappe._dict(
		{
			"doctype": "Sales Invoice",
			"item_code": item_code,
			"customer": customer,
			"warehouse": warehouse,
			"qty": flt(qty) or 1,
			"company": company,
			"conversion_rate": 1,
		}
	)
	row = get_item_details(args)
	available_qty = None
	if warehouse:
		from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty

		actual_qty = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
		)
		available_qty = actual_qty - flt(get_pos_reserved_qty(item_code, warehouse))
	row["available_qty"] = available_qty
	return row


@frappe.whitelist()
def save_sale_invoice(invoice_json: str, submit: int = 0):
	"""Create (and optionally submit) a real Sales Invoice from the quick-sale UI."""
	import json

	data = json.loads(invoice_json) if isinstance(invoice_json, str) else invoice_json
	customer = data.get("customer")
	items = data.get("items") or []
	payments = data.get("payments") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	warehouse = data.get("warehouse") or frappe.db.get_value(
		"Warehouse", {"is_group": 0, "disabled": 0, "company": company}, "name"
	)

	doc = frappe.new_doc("Sales Invoice")
	doc.customer = customer
	doc.company = company
	doc.posting_date = data.get("posting_date") or frappe.utils.today()
	doc.due_date = data.get("due_date") or frappe.utils.add_days(doc.posting_date, 2)
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	doc.update_stock = 1
	doc.set_warehouse = warehouse

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		item_row = {
			"item_code": row.get("item_code"),
			"qty": qty,
			"rate": rate,
			"warehouse": row.get("warehouse") or warehouse,
			"uom": row.get("uom"),
			"discount_percentage": flt(row.get("discount_percentage")),
			"discount_amount": flt(row.get("discount_amount")),
		}
		doc.append("items", item_row)

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	if payments:
		for p in payments:
			amt = flt(p.get("amount"))
			if amt > 0:
				doc.append("payments", {"mode_of_payment": p.get("mode_of_payment"), "amount": amt})

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"outstanding_amount": doc.outstanding_amount,
	}


@frappe.whitelist()
def get_party_transactions(party_type: str, party: str):
	"""Transaction history for one party on the Parties detail panel — the
	Customer side reuses the exact same combined Sales Invoice + un-
	consolidated POS Invoice source get_customer_all_bills already uses;
	the Supplier side is Purchase Invoice, the only doctype a supplier's
	bills live in.
	"""
	if party_type == "Customer":
		si_rows = frappe.get_all(
			"Sales Invoice",
			filters={"customer": party, "docstatus": 1},
			fields=["name", "posting_date", "grand_total", "outstanding_amount"],
		)
		for r in si_rows:
			r["type"] = "Sale"
		pos_rows = frappe.get_all(
			"POS Invoice",
			filters={"customer": party, "docstatus": 1, "consolidated_invoice": ["in", ["", None]]},
			fields=["name", "posting_date", "grand_total", "outstanding_amount"],
		)
		for r in pos_rows:
			r["type"] = "Sale"
		rows = list(si_rows) + list(pos_rows)
	else:
		rows = frappe.get_all(
			"Purchase Invoice",
			filters={"supplier": party, "docstatus": 1},
			fields=["name", "posting_date", "grand_total", "outstanding_amount"],
		)
		for r in rows:
			r["type"] = "Purchase"

	rows.sort(key=lambda r: r["posting_date"], reverse=True)
	return rows


@frappe.whitelist()
def get_past_order_list_with_phone_village(search_term, status, limit=20):
	"""Drop-in override for ERPNext core's own
	`erpnext.selling.page.point_of_sale.point_of_sale.get_past_order_list`
	(wired via `override_whitelisted_methods` in hooks.py) — same
	signature, same return shape, so the existing "Recent Orders" panel
	and its built-in Return button need no UI changes at all.

	Core only matches invoice name / customer id / customer_name. A
	walk-in return needs phone and village too (2026-07-31 direct
	request) — neither lives on POS Invoice itself (confirmed: no
	`contact_mobile` is reliably populated by this app's own
	customer-capture flow, and `santu_village` only exists on Customer),
	so matching customers first and folding their names into the same
	`or_filters` customer-name branch core already uses is simpler than
	a parallel query path.
	"""
	fields = ["name", "grand_total", "currency", "customer", "customer_name", "posting_time", "posting_date"]
	invoice_list = []

	if search_term and status:
		matching_customers = frappe.get_all(
			"Customer",
			or_filters={
				"mobile_no": ["like", f"%{search_term}%"],
				"santu_village": ["like", f"%{search_term}%"],
			},
			pluck="name",
		)

		or_filters = {
			"customer_name": ["like", f"%{search_term}%"],
			"customer": ["like", f"%{search_term}%"],
		}
		if matching_customers:
			or_filters["customer"] = ["in", matching_customers]

		invoices_by_customer = frappe.db.get_list(
			"POS Invoice",
			filters={"status": status},
			or_filters=or_filters,
			fields=fields,
			page_length=limit,
		)
		invoices_by_name = frappe.db.get_list(
			"POS Invoice",
			filters={"name": ["like", f"%{search_term}%"], "status": status},
			fields=fields,
			page_length=limit,
		)

		seen = set()
		for row in invoices_by_customer + invoices_by_name:
			if row.name not in seen:
				seen.add(row.name)
				invoice_list.append(row)
	elif status:
		invoice_list = frappe.db.get_list("POS Invoice", filters={"status": status}, fields=fields, page_length=limit)

	return invoice_list


@frappe.whitelist()
def check_privacy_mode_pin(pin: str):
	"""PIN check for the billing screen's "Privacy Mode" toggle (2026-08-01
	direct request: cost price should stay hidden from customers by
	default, but a cashier deciding how much discount still leaves a
	profit needs a quick, gated way to see it). The real PIN never
	reaches the client until it's actually matched server-side — the
	button only ever gets back a yes/no.
	"""
	real_pin = frappe.db.get_single_value("Santu POS Settings", "privacy_mode_pin") or "7739"
	return str(pin) == str(real_pin)


@frappe.whitelist()
def get_item_cost_price(item_code: str, warehouse: str = None):
	"""Cost price for one item, for Privacy Mode's reveal. Prefers the
	warehouse's own moving-average cost (`Bin.valuation_rate` — the
	actual weighted-average purchase cost, most accurate for "would this
	discount still be profitable"), falling back to the last price
	actually paid (`Item.last_purchase_rate`) for items with no stock
	movement yet, and finally the Item master's own `valuation_rate`
	(usually 0 under per-warehouse/perpetual valuation, but a real value
	on some older/manually-set items) — never silently show ₹0 as "cost"
	when a better number is available.
	"""
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} not found").format(item_code))

	cost = None
	if warehouse:
		cost = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate")
	if not cost:
		cost = frappe.db.get_value("Item", item_code, "last_purchase_rate")
	if not cost:
		cost = frappe.db.get_value("Item", item_code, "valuation_rate")

	return flt(cost)


# ---------------------------------------------------------------------------
# Upload Supplier Bill (PDF) — 2026-08-02 direct request: "upload bill in pdf
# then it auto read and store all the goods... update in inventory". Direct
# follow-up questions to the user settled two things: (1) local text parsing
# only, no internet/paid AI service, keeping this in line with the rest of
# the app being offline-first; (2) always land on a review screen before
# anything touches stock/accounts — never auto-commit a guess.
#
# The "review screen" (santu_upload_bill.js, santu_show_bill_editor) is a
# purpose-built one, not ERPNext's native Purchase Invoice form — a second
# direct request settled that too: "mujhe ek hi screen pe dono table saath
# dikhna chahiye... items bhi isi screen pe edit karna chahiye" (when one
# PDF turns out to contain more than one real invoice, both need to be
# visible and editable together, on one screen, not opened one at a time
# in Desk's native form — Desk can only show one document's form per tab
# at all, a hard limit of the doctype/view architecture this works around
# rather than fights). This function only returns plain parsed data —
# supplier/bill_no/bill_date/items, matched against existing Items where
# confident, auto-created as new stock Items where not (see
# `_auto_create_stock_item` below), every row included even when nothing
# matched — the review screen renders it, lets the user fix anything
# (search-and-pick a different Item on any row, correct a qty/rate, add or
# remove rows, fix the Supplier), and only then calls
# `create_purchase_invoices_from_bills` to actually create the record(s) —
# as drafts, never submitted here, so there's still one more deliberate
# stop (opening the created invoice to do a final check and Submit)
# before anything touches stock/accounts.
#
# Text-only parsing is inherently a best-effort guess against whatever
# layout a given supplier's bill happens to use — column spacing varies,
# scanned/photographed bills have no extractable text at all (pypdf can only
# read real text, not run OCR), and item descriptions on the bill rarely
# match this shop's own Item names word-for-word. A line that can't be
# matched AND can't be auto-created (no HSN/SAC code to satisfy this site's
# GST compliance requirement — see `_auto_create_stock_item`) still comes
# back as a row, just with no Item chosen yet — the review screen's own
# validation is what actually requires the user to fill it in before
# creating the invoice, not a guess made here.
_ITEM_MATCH_THRESHOLD = 0.55
_SUPPLIER_MATCH_THRESHOLD = 0.6

# Lines containing any of these (case-insensitive) are almost always a
# totals/tax/footer row, not a line item — even when they happen to end in
# three numbers (e.g. "Total Amount   12   2,463.00   2,463.00" from a
# quantity-total column). Skipped outright rather than risk creating a fake
# "Total" item.
_BILL_NON_ITEM_KEYWORDS = (
	"total", "subtotal", "sub total", "grand total", "amount in words",
	"cgst", "sgst", "igst", "gst", "tax", "discount", "round off",
	"terms", "declaration", "bank", "ifsc", "account no", "signature",
	"page ", "e. & o.e", "freight", "delivery charge",
)


def _extract_pdf_pages(file_url: str) -> list:
	"""Per-page raw text, column spacing intact — confirmed live against a
	real multi-page GST invoice (accounting-software-generated, e.g. Tally)
	that pypdf's *default* extraction mode ran completely together with
	zero spaces between columns ("FEVICOL MARINE NF 5KG2,365.64CASE..."),
	because that PDF's own content stream never placed a literal space
	character between table cells — it only positions them apart on the
	page. `extraction_mode="layout"` reconstructs spacing from those X/Y
	positions instead of trusting the stream's own whitespace, which
	turned that same page into a properly column-aligned table.

	Returned per-page (not joined) so callers can group pages into
	separate bills — see `_split_pdf_into_bills` — rather than assuming
	one PDF is always one invoice; this is the raw form, column spacing
	and all, since item-row parsing depends on it staying intact.
	"""
	import pypdf

	file_doc = frappe.get_doc("File", {"file_url": file_url})
	file_path = file_doc.get_full_path()

	reader = pypdf.PdfReader(file_path)
	return [page.extract_text(extraction_mode="layout") or "" for page in reader.pages]


def _normalize_whitespace(text: str) -> str:
	import re

	return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines())


# Same shape used by _guess_bill_no below — Indian GST invoice numbers are
# near-universally "prefix/fiscal-year/serial" (e.g. "JCS/2025-26/1220").
# Reused here to tell apart genuinely different invoices bundled into one
# PDF from the same invoice's own continuation/e-Way-bill pages.
_GST_INVOICE_NO_PATTERN = r"\b[A-Za-z]{2,10}/\d{2,4}[\-/]\d{2,4}/\d{1,6}\b"


def _split_pdf_into_bills(file_url: str) -> list:
	"""Group a PDF's pages into one or more separate bills.

	2026-08-02 direct request, after testing against a real 4-page PDF
	that turned out to contain a genuine second, separate invoice on its
	last page: "check and verify if all pages are same then exclude one,
	and if one has diff product then add" — i.e. don't double-count a
	page that's really just supplementary material for a bill already
	captured, but don't silently drop a page that's actually a different
	invoice either.

	Two page types get excluded from item-row parsing entirely rather
	than grouped as their own bill: pages headed "e-Way Bill" (confirmed
	live — this shop's real supplier bill includes an e-Way Bill page
	that lists the exact same goods a second time in a differently-shaped
	table; parsing it too would double the quantities) and blank/near-
	empty pages. Every remaining page is grouped by the GST-style invoice
	number found on it — a page with no number of its own (a "(Page 2)"
	continuation, e.g.) joins whichever invoice group is currently open,
	since it's continuing that invoice, not starting a new one. A PDF
	with no GST-style numbers at all (a simpler, non-GST bill) still
	works exactly as before — everything just lands in one group.
	"""
	import re

	pages = _extract_pdf_pages(file_url)

	groups = []  # list of {"bill_no": str|None, "pages": [text, ...]}
	for page_text in pages:
		normalized = _normalize_whitespace(page_text)
		if not normalized.strip():
			continue
		if re.match(r"^e-way bill\b", normalized, re.IGNORECASE):
			continue

		match = re.search(_GST_INVOICE_NO_PATTERN, normalized)
		page_bill_no = match.group(0) if match else None

		if page_bill_no and (not groups or groups[-1]["bill_no"] != page_bill_no):
			# A genuinely new invoice number that hasn't been the
			# "current" one — but it may have appeared earlier in the
			# document too (e.g. this shop's own e-Way Bill page repeats
			# the invoice's own number — already excluded above, but
			# other layouts might reference it elsewhere without a full
			# "e-Way Bill" heading). Reuse that earlier group instead of
			# starting a duplicate one for the same invoice.
			existing = next((g for g in groups if g["bill_no"] == page_bill_no), None)
			if existing:
				existing["pages"].append(page_text)
				continue
			groups.append({"bill_no": page_bill_no, "pages": [page_text]})
		elif groups:
			groups[-1]["pages"].append(page_text)
		else:
			groups.append({"bill_no": page_bill_no, "pages": [page_text]})

	return ["\n".join(g["pages"]) for g in groups] or [""]


def _guess_supplier(text: str):
	"""Prefer an exact (substring) match — a supplier's own name printed on
	their own letterhead is almost always verbatim, so this is checked
	first and trusted outright. Fuzzy matching is only a fallback for
	near-misses (extra "Pvt Ltd", OCR-ish spacing, etc.), and only above
	`_SUPPLIER_MATCH_THRESHOLD` — anything weaker is left blank rather than
	guessed, since a wrong supplier on a purchase is a real accounting
	mistake, not a cosmetic one.
	"""
	suppliers = frappe.get_all("Supplier", filters={"disabled": 0}, fields=["name", "supplier_name"])
	if not suppliers:
		return None

	text_lower = text.lower()
	for supplier in suppliers:
		if supplier.supplier_name and supplier.supplier_name.lower() in text_lower:
			return supplier.name

	lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
	best_name, best_score = None, 0.0
	for supplier in suppliers:
		for line in lines[:20]:
			score = _fuzzy_ratio(supplier.supplier_name.lower(), line.lower())
			if score > best_score:
				best_name, best_score = supplier.name, score

	return best_name if best_score >= _SUPPLIER_MATCH_THRESHOLD else None


def _guess_bill_no(text: str):
	"""Two-column invoice layouts (confirmed live on a real GST invoice)
	put the label ("Invoice No.") and its value on the SAME line only
	when the whole document is single-column — otherwise the value ends
	up on a different physical line (the label sits beside the supplier's
	own address block, which pushes the invoice-detail column's value
	down a row), and a label-adjacent regex either grabs nothing or, worse,
	grabs the NEXT label instead ("Invoice No. e-Way Bill No." matched
	"e-Way" as the "value" before this guard existed).

	Tries a content-shaped pattern FIRST, not label-adjacency: Indian GST
	invoice numbers are near-universally "prefix/fiscal-year/serial"
	(e.g. "JCS/2025-26/1220") — a shape nothing else on the page shares,
	confirmed live to correctly skip right past the (also present, also
	numeric, also near a "Bill No" label) e-Way Bill number, which has no
	slashes. Only falls back to the label-adjacent same-line guess — which
	needs the digit-must-be-present guard for the reason above — when
	that shaped pattern isn't found at all.
	"""
	import re

	gst_style = re.search(_GST_INVOICE_NO_PATTERN, text)
	if gst_style:
		return gst_style.group(0)

	patterns = [
		r"invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,24})",
		r"(?:bill|inv)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,24})",
	]
	for pattern in patterns:
		for match in re.finditer(pattern, text, re.IGNORECASE):
			candidate = match.group(1).strip()
			if re.search(r"\d", candidate) and "way" not in text[max(0, match.start() - 10):match.start()].lower():
				return candidate
	return None


def _guess_bill_date(text: str):
	"""GST e-invoices print an "Ack Date" (when the e-invoice portal
	acknowledged/registered the document) ABOVE the invoice's own real
	"Dated" field — confirmed live, that Ack Date is textually first, so
	matching the first date-shaped string in the whole document picked it
	up instead of the real invoice date on one of two bills bundled in
	the same PDF. Any match whose nearby context says "ack" is skipped in
	favour of the next one, same guard shape as the "way" exclusion in
	`_guess_bill_no` above.
	"""
	import re

	from frappe.utils import getdate

	patterns = [
		# "Date: 31-01-2026" / "Dated 31/01/26" — numeric month.
		r"(?:date[d]?)\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})",
		# "31-Jan-26" — month name, common on GST e-invoices; checked
		# even without a preceding "Date" label since (confirmed live)
		# the label and the value can land on different physical lines
		# in a two-column layout.
		r"(\d{1,2}[\-/][A-Za-z]{3,9}[\-/]\d{2,4})",
		r"(\d{1,2}[\-/]\d{1,2}[\-/]\d{4})",
	]
	for pattern in patterns:
		for match in re.finditer(pattern, text, re.IGNORECASE):
			if "ack" in text[max(0, match.start() - 20):match.start()].lower():
				continue
			try:
				return getdate(match.group(1))
			except Exception:
				continue
	return None


_SIMPLE_ITEM_LINE = None  # compiled lazily, see _parse_simple_row


def _parse_simple_row(line: str):
	"""Simple "description ... qty ... rate ... amount" layout — a plain
	bill with no HSN/SAC column, one rate, one tax-free total per line.
	Tried second, after the GST-layout parser below, since it's the more
	permissive of the two (a bare 3-trailing-numbers match) and more
	likely to misfire on a line that isn't really an item row.
	"""
	import re

	global _SIMPLE_ITEM_LINE
	if _SIMPLE_ITEM_LINE is None:
		_SIMPLE_ITEM_LINE = re.compile(
			r"^(?P<desc>.+?)\s+"
			r"(?P<qty>\d{1,6}(?:\.\d{1,3})?)\s+"
			r"(?:x\s+|@\s*)?(?:rs\.?|inr|₹)?\s*(?P<rate>[\d,]+(?:\.\d{1,2})?)\s+"
			r"(?:rs\.?|inr|₹)?\s*(?P<amount>[\d,]+(?:\.\d{1,2})?)\s*$",
			re.IGNORECASE,
		)

	match = _SIMPLE_ITEM_LINE.match(line)
	if not match:
		return None

	desc = re.sub(r"^\d+[\.\)]\s*", "", match.group("desc")).strip()
	if len(desc) < 3 or not re.search(r"[A-Za-z]{3,}", desc):
		return None

	try:
		qty = flt(match.group("qty"))
		rate = flt(match.group("rate").replace(",", ""))
		amount = flt(match.group("amount").replace(",", ""))
	except ValueError:
		return None
	if qty <= 0 or rate <= 0:
		return None
	if amount > 0 and not (0.5 <= amount / (qty * rate) <= 2.0):
		return None

	return desc, qty, rate, None


def _parse_gst_layout_row(line: str):
	"""GST tax-invoice layout — confirmed live against a real supplier
	bill: `Sl | Description | HSN/SAC | Quantity (e.g. "1 CASE") |
	Rate (Incl. of Tax) | Rate | per | Amount`. `extraction_mode="layout"`
	(see `_extract_pdf_text`) preserves each column as a run of 2+ spaces,
	so splitting on that reliably recovers the columns regardless of how
	many leading columns (Sl No, sometimes the Sl No fuses onto the
	description when it's a 2-digit number) end up merged — everything is
	read from the RIGHT instead, since the last 6 columns are always
	HSN/qty/rate-incl-tax/rate/per/amount in that fixed order, no matter
	what happened further left.

	Uses the plain "Rate" column (excl. tax), not "Rate (Incl. of Tax)" —
	ERPNext's Purchase Invoice itemizes GST as separate tax rows on top of
	a tax-exclusive rate, so the incl.-tax figure would double-count tax
	if used here. Confirmed against the real bill: qty × net rate equals
	the printed Amount column exactly; qty × incl.-tax rate does not.
	"""
	import re

	cols = re.split(r"\s{2,}", line.strip())
	# Confirmed live: on some pages of the SAME real bill, the "Rate" and
	# "per" (unit) columns render with LESS than the normal 2+-space gap
	# between them — sometimes zero gap ("1,224.52CASE"), sometimes
	# exactly one space ("748.12 DRM", which `\s{2,}` doesn't split on
	# at all). The layout-mode spacing reconstruction is sensitive to
	# exact column pixel widths, and apparently some tables on this
	# document were drawn a hair narrower than others. `\s?` here matches
	# either case; splitting that fused token back into its number and
	# its trailing unit letters recovers the normal column count either
	# way, rather than silently losing (or misaligning — confirmed live,
	# the one-space case didn't drop the row outright, it shifted every
	# later index by one and picked the wrong rate column instead) the
	# row.
	fixed_cols = []
	for col in cols:
		fused = re.match(r"^([\d,]+\.\d{1,2})\s?([A-Za-z]{2,10})$", col)
		if fused:
			fixed_cols.extend([fused.group(1), fused.group(2)])
		else:
			fixed_cols.append(col)
	cols = fixed_cols

	if len(cols) < 7:
		return None

	hsn = cols[-6]
	if not re.fullmatch(r"\d{4,8}", hsn):
		return None

	qty_match = re.match(r"([\d.]+)", cols[-5])
	if not qty_match:
		return None

	try:
		qty = flt(qty_match.group(1))
		rate = flt(cols[-3].replace(",", ""))
		amount = flt(cols[-1].replace(",", ""))
	except ValueError:
		return None
	if qty <= 0 or rate <= 0:
		return None
	if amount > 0 and not (0.5 <= amount / (qty * rate) <= 2.0):
		return None

	desc = re.sub(r"^\d+\s*", "", " ".join(cols[:-6])).strip()
	if len(desc) < 3 or not re.search(r"[A-Za-z]{3,}", desc):
		return None

	return desc, qty, rate, hsn


def _guess_item_rows(text: str):
	"""Heuristic line-item extraction, two layouts tried per line (GST
	tax-invoice column layout first, then a plain description/qty/rate/
	amount layout) — everything else (headers, totals, addresses, GST
	breakdowns) is silently skipped. Better to miss a row the user adds
	by hand than invent one.
	"""
	items = frappe.get_all("Item", filters={"disabled": 0}, fields=["item_code", "item_name", "stock_uom"])
	items_by_code = {item.item_code: item for item in items}

	rows = []
	for raw_line in text.splitlines():
		line = raw_line.rstrip()
		if len(line.strip()) < 6:
			continue
		lowered = line.lower()
		if any(keyword in lowered for keyword in _BILL_NON_ITEM_KEYWORDS):
			continue

		parsed = _parse_gst_layout_row(line) or _parse_simple_row(line.strip())
		if not parsed:
			continue
		desc, qty, rate, hsn = parsed

		best_code, best_score = None, 0.0
		for item in items:
			score = _fuzzy_ratio(desc.lower(), item.item_name.lower())
			if score > best_score:
				best_code, best_score = item.item_code, score

		matched_code = best_code if best_score >= _ITEM_MATCH_THRESHOLD else None
		rows.append({
			"description": desc,
			"item_code": matched_code,
			"stock_uom": items_by_code[matched_code].stock_uom if matched_code else None,
			"qty": qty,
			"rate": rate,
			"hsn": hsn,
		})

	return rows


# Keyword -> Item Group, tried in order (first match wins) — this shop's
# own existing groups (BUSINESS_RULES.md / Item Group master), reused
# rather than inventing a new taxonomy just for auto-created items. Falls
# back to "Products" (the same generic default `quick_create_item` already
# uses) when nothing matches.
_ITEM_GROUP_KEYWORDS = (
	("Adhesives", ("fevicol", "adhesive", "gum", "fevi", "glue", "sealant", "m-seal", "araldite")),
	("Paints", ("paint", "enamel", "primer", "distemper", "emulsion", "putty", "tint")),
	("Plumbing", ("pipe", "tap", "valve", "cpvc", "pvc", "faucet", "flush", "cistern")),
	("Fasteners", ("screw", "bolt", "nut", "nail", "anchor", "rivet", "washer")),
	("Switches and Sockets", ("switch", "socket", "mcb", "wire", "cable", "holder", "bulb", "led")),
)


def _guess_item_group(description: str) -> str:
	lowered = description.lower()
	for group, keywords in _ITEM_GROUP_KEYWORDS:
		if any(keyword in lowered for keyword in keywords):
			if frappe.db.exists("Item Group", group):
				return group
	return "Products" if frappe.db.exists("Item Group", "Products") else frappe.db.get_single_value(
		"Stock Settings", "item_group"
	)


def _auto_create_stock_item(description: str, hsn: str, rate: float):
	"""Create a real, stock-tracked Item for a bill line that didn't match
	anything already in the catalog — 2026-08-02 direct request: "agar new
	koi product ho to use new stock me add kr na" (if it's a genuinely new
	product, add it to stock automatically) rather than always stopping to
	ask. Unlike `quick_create_item` (the POS quick-add, deliberately
	NON-stock so an instant same-sale checkout can't trip the negative-
	stock guard), this is the receiving side of a purchase — stock should
	increase, so `is_stock_item = 1` is correct and intended here.

	Requires an HSN/SAC code (this site has `GST Settings.validate_hsn_code`
	on, confirmed live: creating an Item without one raises `MandatoryError`
	outright) — the GST-layout bill parser extracts one per line; the
	plainer layout doesn't, so those lines fall back to manual entry
	instead of a guaranteed-to-fail insert. Returns the new item_code, or
	None if creation failed for any reason (caller falls back to manual
	entry for that line rather than losing the whole request).
	"""
	import re

	if not hsn:
		return None

	slug = re.sub(r"[^A-Za-z0-9]+", "-", description).strip("-").upper() or "ITEM"
	item_code = slug[:120]
	suffix = 1
	while frappe.db.exists("Item", item_code):
		suffix += 1
		item_code = f"{slug[:115]}-{suffix}"

	try:
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = description[:140]
		item.item_group = _guess_item_group(description)
		item.stock_uom = "Nos"
		item.is_stock_item = 1
		item.gst_hsn_code = hsn
		item.insert(ignore_permissions=True)

		item_price = frappe.new_doc("Item Price")
		item_price.item_code = item.item_code
		item_price.price_list = "Standard Buying"
		item_price.buying = 1
		item_price.price_list_rate = flt(rate)
		item_price.insert(ignore_permissions=True)

		return item.item_code
	except Exception:
		frappe.log_error(
			title="Upload Supplier Bill: auto-create item failed",
			message=frappe.get_traceback(),
		)
		frappe.db.rollback()
		return None


def _parse_one_bill(text: str) -> dict:
	"""Everything from raw page text to one bill's worth of parsed data —
	factored out of `get_purchase_invoice_from_bill_pdf` so it can run once
	per detected invoice when a single PDF turns out to contain more than
	one (see `_split_pdf_into_bills`), not just once for the whole file.
	"""
	label_text = _normalize_whitespace(text)

	supplier = _guess_supplier(label_text)
	bill_no = _guess_bill_no(label_text)
	bill_date = _guess_bill_date(label_text)
	item_rows = _guess_item_rows(text)

	# A line that doesn't match anything already in the catalog isn't
	# necessarily wrong — this shop may just never have stocked it before
	# (2026-08-02 direct request: "agar new koi product ho to use new
	# stock me add kr na" — if it's genuinely new, add it to stock
	# automatically rather than always stopping to ask). Auto-create a
	# real stock Item for it instead of leaving the row for hand entry.
	# The row still lands on a completely ordinary, editable Item field in
	# the review screen afterward — if this auto-created item turns out to
	# actually be a duplicate under a different supplier's naming (the
	# same direct request: "2-3 supplier alag alag name use krte honge" —
	# different suppliers may name the same product differently), the user
	# can search and repoint that one cell at the real existing item, same
	# as correcting any other grid cell; nothing here forecloses that.
	#
	# Every row — matched, auto-created, or still genuinely unresolved —
	# stays IN `items` (unlike an earlier version, which dropped unmatched
	# rows entirely and only mentioned them in a message): the review
	# screen now edits everything inline itself rather than handing off to
	# ERPNext's native form, so a row with no item_code yet is just a row
	# whose Item field the user still needs to search and fill in — no
	# longer the "breaks the whole form" case it was when this got synced
	# into a real native Purchase Invoice (see the long comment on
	# `get_purchase_invoice_from_bill_pdf` below).
	auto_created = []
	for row in item_rows:
		if row["item_code"]:
			continue
		new_item_code = _auto_create_stock_item(row["description"], row.get("hsn"), row["rate"])
		if new_item_code:
			row["item_code"] = new_item_code
			auto_created.append(row)

	matched_count = sum(1 for row in item_rows if row["item_code"]) - len(auto_created)

	return {
		"supplier": supplier,
		"bill_no": bill_no,
		"bill_date": bill_date,
		# HSN/SAC per row, straight from the bill itself where the layout
		# has one (2026-08-02 direct request: "add hsn codes also if
		# available") — set on the Purchase Invoice Item row directly
		# rather than touched on the Item master for an already-matched
		# item, since a shared master's HSN shouldn't get silently
		# overwritten by whatever one particular bill happened to print.
		"items": [
			{
				"item_code": row["item_code"],
				"description": row["description"],
				"qty": row["qty"],
				"rate": row["rate"],
				"hsn": row.get("hsn"),
			}
			for row in item_rows
		],
		"matched_count": matched_count,
		"auto_created_items": [
			{"item_code": row["item_code"], "description": row["description"]}
			for row in auto_created
		],
		"total_lines_found": len(item_rows),
	}


@frappe.whitelist()
def get_purchase_invoice_from_bill_pdf(file_url: str):
	"""Parse an uploaded supplier bill (PDF) and return plain data for one
	or more unsaved Purchase Invoices, pre-filled as best as local text
	extraction can manage, for the user to review/correct/complete in
	ERPNext's own native form. Nothing is saved here — see the module
	comment above.

	Usually one PDF is one bill, but confirmed live against a real
	4-page supplier PDF that isn't always true — page 4 turned out to be
	a second, completely separate invoice with its own number, date, and
	items bundled into the same file. `_split_pdf_into_bills` groups pages
	by which invoice they actually belong to (and drops pages that are
	just a duplicate re-listing of a bill already captured, like an
	e-Way Bill page), so this always returns one entry per DISTINCT
	invoice actually found — one entry for the common case, more only
	when the PDF genuinely contains more than one bill.
	"""
	bill_texts = _split_pdf_into_bills(file_url)
	if not any(text.strip() for text in bill_texts):
		frappe.throw(
			_(
				"Couldn't read any text from this PDF — it may be a scanned "
				"image rather than a real PDF. Please create the Purchase "
				"Invoice by hand for this bill."
			)
		)

	bills = [_parse_one_bill(text) for text in bill_texts if text.strip()]
	for bill in bills:
		bill["source_bill_pdf"] = file_url

	return {"bills": bills}


@frappe.whitelist()
def create_purchase_invoices_from_bills(bills):
	"""Create one real (draft, unsubmitted) Purchase Invoice per bill,
	directly from the review screen — 2026-08-02 direct request, after the
	previous version routed through ERPNext's own native Purchase Invoice
	form one bill at a time: "mujhe ek hi screen pe dono table saath
	dikhna chahiye... items bhi isi screen pe edit karna chahiye" (both
	bills' tables together on one screen, items editable right there too).
	Frappe's Form view can only ever show one document at a time in a
	single tab — a hard limit of the doctype/view architecture, not a
	choice made here — so "both visible together, fully editable, single
	tab" only works if this review screen IS the editor and creates the
	real records directly, rather than handing off to a native form the
	user would have to navigate to/from.

	`bills` is a list of {supplier, bill_no, bill_date, source_bill_pdf,
	items: [{item_code, qty, rate, hsn}]} — the SAME shape
	`get_purchase_invoice_from_bill_pdf` returns, but the field values may
	have been edited by the user in the review screen (a different
	Supplier picked, an item swapped, a qty/rate corrected) before this is
	called, so nothing here re-derives anything from the PDF — it only
	trusts what's given.

	Draft, not submitted: still one more deliberate stop before anything
	touches stock/accounts (the same "always land on a review screen"
	principle from the top of this file) — the user opens each created
	invoice from the result list to do a final check and Submit
	themselves, same as any other purchase in this shop.
	"""
	import json

	if isinstance(bills, str):
		bills = json.loads(bills)

	warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	results = []
	for bill in bills:
		if not bill.get("supplier"):
			frappe.throw(_("Supplier is required for every bill before creating invoices."))
		if not bill.get("items"):
			frappe.throw(_("At least one item row is required for every bill."))

		doc = frappe.new_doc("Purchase Invoice")
		doc.supplier = bill["supplier"]
		doc.update_stock = 1
		if warehouse:
			doc.set_warehouse = warehouse
		if bill.get("bill_no"):
			doc.bill_no = bill["bill_no"]
		if bill.get("bill_date"):
			doc.bill_date = bill["bill_date"]
		if bill.get("source_bill_pdf"):
			doc.custom_source_bill_pdf = bill["source_bill_pdf"]

		for row in bill["items"]:
			if not row.get("item_code"):
				continue
			doc.append("items", {
				"item_code": row["item_code"],
				"qty": flt(row.get("qty") or 1),
				"rate": flt(row.get("rate") or 0),
				"gst_hsn_code": row.get("hsn") or None,
			})

		if not doc.items:
			frappe.throw(_("At least one item row is required for every bill."))

		doc.insert(ignore_permissions=True)
		# ERPNext's own Purchase Invoice validation calls frappe.msgprint()
		# for a routine, harmless accounting detail — confirmed live,
		# creating 36 rows across 2 bills queued 36 "Row N: Expense Head
		# changed to Stock In Hand..." messages that buried this
		# function's own actual result. It's an informational aside, not
		# an error (the insert already succeeded by this point) — cleared
		# per invoice so only the real result below reaches the client.
		frappe.clear_messages()
		results.append({
			"name": doc.name,
			"bill_no": doc.bill_no,
			"grand_total": doc.grand_total,
		})

	return results
