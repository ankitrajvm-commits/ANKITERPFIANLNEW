import base64
import difflib
import io
import re
import time
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate


def default_selling_warehouse(company=None):
	"""The one warehouse this shop sells out of.

	Twenty-odd places used to ask for "the first warehouse that is not a group
	and not disabled". With exactly one warehouse that was harmless. The
	moment a second one exists it stops being harmless and starts being
	dangerous: `frappe.db.get_value` returns whichever row comes first, and
	"Old Shop - SH" sorts before "Stores - SH" — so simply *creating* the old
	shop's warehouse would silently move every sale, every stock check and
	every price lookup onto the wrong stock, with nothing on screen to say so.

	So the answer is pinned in Santu POS Settings instead of guessed. The old
	guess is kept only as a fallback for a fresh site that has not been set up
	yet; Doctor Uncle reports it as a problem to fix rather than leaving it to
	chance.
	"""
	pinned = frappe.db.get_single_value("Santu POS Settings", "selling_warehouse")
	if pinned:
		row = frappe.db.get_value(
			"Warehouse", pinned, ["name", "is_group", "disabled", "company"], as_dict=True
		)
		# A pinned warehouse that has since been disabled, turned into a group
		# or moved to another company is worse than none — fall through rather
		# than sell out of something that no longer exists.
		if row and not row.is_group and not row.disabled and (not company or row.company == company):
			return row.name

	filters = {"is_group": 0, "disabled": 0}
	if company:
		filters["company"] = company
	return frappe.db.get_value("Warehouse", filters, "name", order_by="creation asc")


@frappe.whitelist()
def get_default_selling_warehouse(company=None):
	"""Browser-side callers need the same answer the server uses."""
	return default_selling_warehouse(company)


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

	warehouse = default_selling_warehouse()
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

	row = {
		"item_code": item_code,
		"warehouse": warehouse,
		"qty": float(new_qty),
		"valuation_rate": valuation_rate,
		# ERPNext's own native flag for "this item genuinely has no cost
		# history yet" (e.g. a used/donated item never purchased) — without
		# it, a 0 valuation_rate is rejected outright rather than accepted
		# as a deliberate zero.
		"allow_zero_valuation_rate": 1 if not valuation_rate else 0,
	}
	doc.append("items", row)
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

	No batch concept (removed 2026-08-17: "bath ka concept hata do pura") —
	one purchase rate per item. A rate typed here that differs from what is
	already on file replaces it outright ("jo new rate hai wahi purane ka
	update ho jayega price"), same as walking up to the item and correcting
	its price; it does not try to remember what the old one used to be.

	The formal supplier-bill path (with GST, payment terms, ledger impact)
	is the existing "Upload Bill" flow — this endpoint is only for getting
	physical stock onto the shelf/into the count right away.
	"""
	if not item_code or not qty or flt(qty) <= 0:
		frappe.throw(_("Item and a quantity greater than zero are required."))

	warehouse = default_selling_warehouse()
	if not warehouse:
		frappe.throw(_("No active warehouse found. Set one up in Admin Mode first."))

	company = frappe.db.get_value("Warehouse", warehouse, "company")

	rate_given = rate not in (None, "")
	basic_rate = flt(rate) if rate_given else flt(
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

	if rate_given:
		_set_buying_price(item_code, basic_rate)

	new_qty = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))
	return {"name": doc.name, "new_qty": new_qty}


def _set_buying_price(item_code: str, rate: float):
	"""Update-in-place, not a new row: this item's one purchase price is
	whatever it last cost, not a history of what it used to cost."""
	existing = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "buying": 1, "price_list": "Standard Buying"}, "name"
	)
	if existing:
		frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
	else:
		frappe.get_doc({
			"doctype": "Item Price",
			"item_code": item_code,
			"price_list": "Standard Buying",
			"buying": 1,
			"selling": 0,
			"price_list_rate": rate,
		}).insert(ignore_permissions=True)


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

	warehouse = default_selling_warehouse()

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

	# Which names exist more than once in the whole catalog. Counted over
	# every item, not just the ones on screen, so the warning appears even
	# when only one of the twins made it into the top results — that is the
	# case where picking the wrong one is most likely, because nothing on
	# screen hints that a second one exists.
	#
	# Warn, never block: a hardware shop genuinely stocks "Fevicol SR 200ML"
	# in more than one pack, and refusing to sell would be far worse than
	# saying "there are two of these".
	name_counts = {}
	for item in items:
		key = (item.item_name or "").strip().lower()
		if key:
			name_counts[key] = name_counts.get(key, 0) + 1

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
			"same_name_count": name_counts.get((item.item_name or "").strip().lower(), 1),
		})

	# "No additional click" only for a match that is unambiguous WITHOUT
	# reading — an exact item code or a scanned barcode. Both are numbers
	# a person only "arrives at" by scanning or by typing the exact code on
	# purpose. An exact NAME match doesn't get this: a cashier typing a
	# product name is still reading the dropdown to pick the right one, and
	# auto-dropping the top hit before they finish looks like the screen
	# "randomly choosing" an item for them (2026-08-25 bug report — typing a
	# name was auto-adding the first match with no chance to pick).
	exact_match = None
	if results and results[0]["score"] >= _SCORE_NAME_EXACT:
		top_code = results[0]["item_code"]
		is_code_or_barcode_match = top_code.lower() == query or top_code in barcode_item_codes
		if is_code_or_barcode_match and (len(results) == 1 or results[1]["score"] < _SCORE_NAME_PREFIX):
			exact_match = top_code
	# Never skip the tap when two items share this name. Auto-opening the
	# top one is a convenience everywhere else; here it would quietly choose
	# between two things the cashier cannot tell apart, which is the whole
	# problem with duplicates in the first place.
	if exact_match and results[0].get("same_name_count", 1) > 1:
		exact_match = None

	return {"results": results, "exact_match": exact_match}


DEFAULT_LOW_STOCK_THRESHOLD = 5


def _pending_supplier_payments():
	"""Total outstanding across all suppliers, and how many owe something.

	Factored out of get_dashboard_data() so the Purchase Bills page can show
	the same overall figure (2026-08-18 direct request: Total Payable moved
	off Home onto this page) without a second, possibly-diverging query.
	"""
	company = frappe.defaults.get_user_default("Company")
	company_sql = " and company = %(company)s" if company else ""
	company_args = {"company": company}

	if not frappe.has_permission("Purchase Invoice", "read"):
		return 0.0, 0

	pending = flt(
		frappe.db.sql(
			f"""
			select sum(outstanding_amount) from `tabPurchase Invoice`
			where docstatus = 1 and outstanding_amount > 0 {company_sql}
			""",
			company_args,
		)[0][0]
	)
	party_count = frappe.db.sql(
		f"""
		select count(distinct supplier) from `tabPurchase Invoice`
		where docstatus = 1 and outstanding_amount > 0 {company_sql}
		""",
		company_args,
	)[0][0]
	return pending, party_count


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

	warehouse = default_selling_warehouse()

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

	pending_supplier_payments, payable_party_count = _pending_supplier_payments()

	# Total Receivable — same combined Sales Invoice + un-consolidated POS
	# Invoice outstanding sum get_customer_dues() uses per-customer, just
	# aggregated here instead of grouped, so this card never disagrees with
	# that page's total.
	total_receivable = 0.0
	receivable_party_count = 0
	if frappe.has_permission("Sales Invoice", "read") or frappe.has_permission("POS Invoice", "read"):
		# Netted PER CUSTOMER, not per invoice row. The old version filtered
		# `outstanding_amount > 0` on each row, which silently dropped every
		# credit note (a return carries a NEGATIVE outstanding) — so a
		# customer holding a ₹600 return credit against a ₹600 bill still
		# counted as ₹600 receivable, and this card disagreed with the
		# Customer Dues page it drills into (2026-08-19 bug report: home
		# showed 1220 / 900 while the drill-down showed 922 / 0).
		#
		# `having net > 0` keeps one customer's leftover credit from
		# cancelling out a different customer's real due — money owed by A
		# is not reduced by money owed TO B.
		receivable_row = frappe.db.sql(
			f"""
			select sum(net), count(*) from (
				select customer, sum(outstanding_amount) as net from (
					select customer, outstanding_amount from `tabSales Invoice`
					where docstatus = 1 {company_sql}
					union all
					select customer, outstanding_amount from `tabPOS Invoice`
					where docstatus = 1
						and (consolidated_invoice is null or consolidated_invoice = '')
						{company_sql}
				) rows_
				group by customer
				having net > 0
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
		widget_catalog = build_widget_catalog(widget_metrics, low_stock_count, "This Month")
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
	current_total = sum(p["total"] for p in points)
	span = (end - start).days + 1
	prev_end = add_days(start, -1)
	prev_start = add_days(prev_end, -(span - 1))
	prev_total = flt(
		frappe.db.sql(
			f"""
			select sum(grand_total) from (
				select grand_total from `tabPOS Invoice`
				where docstatus = 1
					and posting_date between %(start)s and %(end)s
					and (consolidated_invoice is null or consolidated_invoice = '')
					{company_clause}
				union all
				select grand_total from `tabSales Invoice`
				where docstatus = 1
					and posting_date between %(start)s and %(end)s
					{company_clause}
			) t
			""",
			{"start": prev_start, "end": prev_end, "company": company},
		)[0][0]
	)
	percent_change = 0.0
	if prev_total:
		percent_change = ((current_total - prev_total) / abs(prev_total)) * 100.0
	elif current_total:
		percent_change = 100.0
	return {
		"total": current_total,
		"prev_total": prev_total,
		"percent_change": percent_change,
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

	warehouse = default_selling_warehouse()
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


def _pdfkit_configuration():
	"""Locate wkhtmltopdf for background/API PDF generation (no shell PATH)."""
	import os
	import shutil

	from pdfkit.configuration import Configuration

	for path in (
		shutil.which("wkhtmltopdf"),
		"/usr/local/bin/wkhtmltopdf",
		"/opt/homebrew/bin/wkhtmltopdf",
	):
		if path and os.path.isfile(path):
			return Configuration(wkhtmltopdf=path)
	return None


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

	# A thermal printer cannot print edge to edge: on an 80mm roll the head
	# only covers about 72mm (576 dots at 203dpi), 58mm rolls about 48mm.
	# Rendering the page at the full paper width pushed the right-hand column
	# past the head, so amounts, the phone number and the bill number came out
	# sliced down the right edge (2026-08-17 bug report). Render to the width
	# that can actually be printed instead.
	printable_width = {80: 72.0, 58: 48.0}.get(int(paper_width), max(paper_width - 8, 40))

	items = frappe.get_cached_doc(doctype, name).get("items") or []
	item_count = len(items)
	# The header logo (43mm wide, ~29mm tall including the wordmark) is
	# roughly 24mm taller than the plain bold company-name line it replaces
	# when Show Logo on Bill is on -- add that back or the extra height
	# pushes the bottom of a long bill (many items + QR) past this page's
	# fixed canvas and gets clipped, same class of bug the printable-width
	# fix above exists for.
	logo_extra = 24 if settings.get("show_logo_on_bill") else 0
	# The 10mm/item budget only covers one line of item name. A name too
	# long to fit `.t-item-name`'s width (11px bold, print format CSS) wraps
	# to a 2nd line in the browser preview, but this fixed-height PDF canvas
	# doesn't grow to match, so that 2nd line got clipped instead of shown
	# (2026-08-26 bug report — Ritik's invoice item name printed incomplete,
	# didn't wrap). Estimate wrapped lines per item from its name length and
	# add the extra height those lines need.
	chars_per_line = max(int(printable_width / 1.6), 10)
	wrap_extra = sum(max(0, -(-len(item.item_name or "") // chars_per_line) - 1) * 4 for item in items)
	page_height = 170 + item_count * 10 + logo_extra + wrap_extra

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
			"page-width": f"{printable_width}mm",
			"page-height": f"{page_height}mm",
			# No side margins at all. The page IS the printable width and the
			# format's own body is exactly that wide, so even a 1mm margin
			# squeezes the content narrower than the page and wkhtmltopdf
			# clips the right-hand column — which is how amounts and the phone
			# number lost their last character.
			"margin-top": "2mm",
			"margin-bottom": "2mm",
			"margin-left": "0mm",
			"margin-right": "0mm",
		}
	)
	options.update(get_cookie_options())

	try:
		return pdfkit.from_string(
			html,
			options=options,
			configuration=_pdfkit_configuration(),
			verbose=True,
		)
	finally:
		cleanup(options)


def _thermal_image_bytes(doctype: str, name: str, print_format: str) -> bytes:
	"""Same thermal HTML _thermal_pdf_bytes renders, but straight to a PNG
	instead of a PDF (2026-08-19 direct request: bills sent on WhatsApp
	should show as a picture in the chat, not a PDF someone has to tap open).

	wkhtmltoimage auto-sizes the image height to the content, unlike the PDF
	path above which has to guess a page-height from the item count — one
	less thing that can be wrong. Width is still pinned to the printer's
	actual printable width so the picture reads like the paper bill, not a
	stretched or cropped one.
	"""
	import os
	import shutil
	import subprocess
	import tempfile

	from frappe.utils.pdf import inline_private_images, scrub_urls

	settings = frappe.get_single("Santu POS Settings")
	paper_width = flt((settings.paper_width or "80mm").replace("mm", "")) or 80
	printable_width_mm = {80: 72.0, 58: 48.0}.get(int(paper_width), max(paper_width - 8, 40))
	# 180dpi: legible when WhatsApp shows/zooms the picture, without the
	# file ballooning the way a print-resolution (300dpi+) render would.
	width_px = int(printable_width_mm * 180 / 25.4)

	html = frappe.get_print(doctype, name, print_format, as_pdf=False)
	html = scrub_urls(html)
	html = inline_private_images(html)

	# frappe.get_print's HTML carries an on-screen "print preview" wrapper —
	# the gray gutter, A4-shaped padding/min-height, and a Print/Get PDF
	# banner — meant to be hidden by @media print once a browser (or
	# wkhtmltopdf, via its --print-media-type flag) actually prints the
	# page. wkhtmltoimage has no such flag in this build (checked:
	# `wkhtmltoimage --help` lists nothing print/media-related), so it was
	# rendering the screen preview verbatim: gray background, a near-A4-tall
	# blank canvas, and the Print/Get PDF links baked into the picture. This
	# neutralizes that wrapper directly rather than depending on a flag that
	# doesn't exist.
	html = html.replace(
		"</head>",
		"<style>"
		".action-banner,.print-hide{display:none !important;}"
		".print-format-gutter{background:#fff !important;padding:0 !important;}"
		".print-format{max-width:none !important;min-height:0 !important;padding:0 !important;margin:0 !important;}"
		"</style></head>",
	)

	wkhtmltoimage = shutil.which("wkhtmltoimage") or "/usr/local/bin/wkhtmltoimage"
	if not (wkhtmltoimage and os.path.isfile(wkhtmltoimage)):
		frappe.throw(_("wkhtmltoimage nahi mila is computer par."))

	src_path = out_path = None
	try:
		with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as fh:
			fh.write(html)
			src_path = fh.name
		out_path = src_path[:-5] + ".png"

		result = subprocess.run(
			[
				wkhtmltoimage,
				"--width", str(width_px),
				"--quality", "90",
				"--disable-smart-width",
				"--quiet",
				src_path,
				out_path,
			],
			capture_output=True,
			text=True,
			timeout=30,
		)
		if result.returncode != 0 or not os.path.isfile(out_path):
			frappe.throw(_("Bill ki image nahi ban payi: {0}").format((result.stderr or "").strip()[:200]))
		with open(out_path, "rb") as f:
			return f.read()
	finally:
		for p in (src_path, out_path):
			if p and os.path.isfile(p):
				try:
					os.unlink(p)
				except OSError:
					pass


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
def get_bill_logo_data_uri() -> str:
	"""The thermal bill's header logo, embedded inline as the thermal QR
	already is — wkhtmltopdf renders these formats with
	`disable-local-file-access` set (see `_thermal_pdf_bytes`), so a plain
	`/assets/...` <img> src would render blank; the bytes have to travel
	inside the HTML itself. Cropped to its real content (the source PNG
	carries a wide white margin) and pre-shrunk to 43mm-wide/203dpi so the
	PDF embeds a few KB instead of the multi-hundred-KB original, and the
	SH icon is pre-compacted to ~70% against the wordmark below it — sizing
	and cropping Ankit approved directly (2026-08-23), not something to
	redo from the source file.
	"""
	path = frappe.get_app_path("santu_hardware", "public", "images", "thermal_bill_logo.png")
	with open(path, "rb") as f:
		encoded = base64.b64encode(f.read()).decode("ascii")
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


@frappe.whitelist()
def format_bill_no(bill_no) -> str:
	"""The bill number as it should be printed and searched for.

	The counter counts 1, 2, 3 — not "SINV-26-00055". `santu_bill_no` already
	stores that plain running count, so this only decides how it reads once
	the shop gets past a thousand bills: rather than growing to 1000, 1001,
	the count rolls into a lettered block — A01, A02 … then B01 … (2026-08-19
	request: "thousand bill hone ke baad A01 dal, 2k ke baad B01"). Four
	characters, always, which is what fits on a thermal slip and what someone
	can read back over the phone.
	"""
	n = cint(bill_no)
	if n <= 0:
		return ""

	BLOCK = 999
	block_index, within = divmod(n - 1, BLOCK)
	within += 1
	if not block_index:
		return str(within)

	# A..Z, then AA.. — the shop will never reach it, but a number that
	# silently collides after 26 blocks is not worth the saved lines.
	letters = ""
	i = block_index
	while i > 0:
		i, rem = divmod(i - 1, 26)
		letters = chr(65 + rem) + letters
	return f"{letters}{within:02d}"


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
	due = frappe.utils.getdate(doc.due_date) if doc.get("due_date") else None
	# Capped 2 days out, and never allowed to fall BEFORE the posting date.
	# ERPNext rejects an earlier due date outright, which is reachable any
	# time the two dates get derived from different reference points — the
	# exact failure a backdated bill hit mid-sale (2026-08-19 bug report).
	if due is None or due > max_due or due < posting:
		doc.due_date = max_due


def title_case_a_name(name: str) -> str:
	"""'manish kumar singh' / 'MANISH KUMAR SINGH' -> 'Manish Kumar Singh'.
	First letter of every word capitalized, everything else lowercase —
	direct request, 2026-08-14. Simple split-on-space title casing;
	deliberately not using Python's str.title() since it also
	uppercases the letter after an apostrophe (e.g. "O'Brien" ->
	"O'Brien" is fine, but "D'souza's" -> "D'Souza'S" is not).
	"""
	if not name:
		return name

	# A name printed entirely in capitals — as bills and GST portals do — says
	# nothing about which words are acronyms, so every word gets normal title
	# casing. Only in a mixed-case name does an all-caps word stand out as a
	# deliberate acronym ("MRF tyres").
	letters_in_name = [c for c in name if c.isalpha()]
	shouting = bool(letters_in_name) and all(c.isupper() for c in letters_in_name)

	def cased(word, keep_acronym=True):
		if not word:
			return word
		# Leave short all-capital runs alone: they are acronyms, not shouting.
		# A supplier really is "Janta Cement Store (JCS)" and a brand really is
		# "MRF" — lowercasing those produced "(jcs)" on a real supplier record.
		letters = [c for c in word if c.isalpha()]
		if keep_acronym and letters and len(letters) <= 4 and all(c.isupper() for c in letters):
			return word
		return word[:1].upper() + word[1:].lower()

	def cased_word(word):
		# A bracketed acronym rides along on the same space-separated word as
		# an ordinary one ("STORE(JCS)"), so the acronym guard above never saw
		# it on its own and produced "Store(jcs)" on a real supplier read off a
		# bill. Case each bracketed group separately. Deliberately only
		# brackets, not every non-letter: splitting on apostrophes too would
		# turn "D'souza's" into "D'Souza'S", which is what the note above is
		# about.
		# Brackets are always trusted as an acronym marker, even inside an
		# all-caps name — "SHREE RAM TRADERS (SRT)" has a real acronym in the
		# brackets and an ordinary short word ("RAM") outside them.
		return "".join(
			cased(part, keep_acronym=part.startswith("(") or not shouting)
			for part in re.split(r"(\([^)]*\))", word)
		)

	return " ".join(cased_word(w) for w in name.split(" "))


def title_case_party_name(doc, method=None):
	"""`doc_events` hook (Customer/Supplier `before_save`) — direct request
	that every party name written anywhere in the system (this quick-sale
	screen's quick-add, POS's customer capture, the standard Customer/
	Supplier form, imports, everywhere) ends up "Manish Kumar Singh", not
	"manish kumar singh" or "MANISH KUMAR SINGH"."""
	field = "customer_name" if doc.doctype == "Customer" else "supplier_name"
	value = doc.get(field)
	if value:
		doc.set(field, title_case_a_name(value))


def title_case_address_fields(doc, method=None):
	"""`doc_events` hook (Address `before_save`) — same request, extended to
	address text (2026-08-14): "ishuapur / saran" typed lowercase on the
	quick-sale screen's Add Party form should land as "Ishuapur / Saran",
	regardless of how the cashier typed it in. Only the free-text line
	fields are touched — `city` is a plain Data field too, but `state`/
	`country` are Link fields tied to real master records (state names,
	country names) and must keep their exact stored value or the link
	breaks."""
	for field in ("address_line1", "address_line2", "city"):
		value = doc.get(field)
		if value:
			doc.set(field, title_case_a_name(value))


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


def update_payment_summary_fields(doc, method=None):
	"""Populate the custom Payment Summary fields on Sales Invoice / POS Invoice.
	
	This onload hook fills in:
	- custom_total_bill_amount: Total invoice amount
	- custom_payment_received: Amount already paid
	- custom_balance_remaining: Balance still due
	
	These fields are read-only and show the payment breakdown clearly to the user.
	"""
	if doc.doctype not in ("Sales Invoice", "POS Invoice"):
		return
	
	doc.custom_total_bill_amount = doc.grand_total or 0
	doc.custom_payment_received = doc.paid_amount or 0
	doc.custom_balance_remaining = doc.outstanding_amount or 0


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
		_archive_invoice_pdf(doc.doctype, doc.name, doc.posting_date)
	except Exception:
		frappe.log_error(title="Auto-save invoice PDF failed", message=frappe.get_traceback())
		# One retry, after this sale's transaction has committed. Most of the
		# 21 recorded failures were transient (a PDF renderer that could not
		# resolve an image URL), and a second attempt a moment later costs
		# nothing. If it fails again the Doctor check below is what catches
		# it — silence was the actual bug here, not the failure.
		try:
			frappe.enqueue(
				"santu_hardware.santu_hardware.api.retry_invoice_pdf_archive",
				queue="short",
				enqueue_after_commit=True,
				doctype=doc.doctype,
				name=doc.name,
				posting_date=str(doc.posting_date),
			)
		except Exception:
			frappe.log_error(
				title="Auto-save invoice PDF retry could not be queued",
				message=frappe.get_traceback(),
			)


def invoice_pdf_is_archived(doctype: str, name: str) -> bool:
	"""Has this bill's PDF already been filed?

	Matched with a prefix, not equality: `save_file` appends a random hash
	to every private file's name, so the archived copy of SINV-26-00043 is
	stored as `SINV-26-000435cf498.pdf`. An exact-name check never matches,
	which would report every invoice as missing and re-file a duplicate on
	every run — caught doing exactly that on 2026-08-17.
	"""
	return bool(
		frappe.db.exists(
			"File",
			{
				"attached_to_doctype": doctype,
				"attached_to_name": name,
				"file_name": ("like", f"{name}%.pdf"),
			},
		)
	)


@contextmanager
def _print_request_context():
	"""Give the print format the HTTP request it assumes it has.

	The shop's bill template calls `frappe.call(...)` from Jinja to pull the
	customer's balance and loyalty points. `frappe.call` needs
	`frappe.local.request`, which exists during a web request and nowhere
	else — so the same template that renders perfectly when a cashier hits
	Print fails with "Error in print format on line 23: request" from a
	background worker, the scheduler, or `bench execute`.

	That is not a theoretical gap: it is why the on_submit retry and the
	Doctor's regeneration both need this. A stub request makes every caller
	behave like the one that works.
	"""
	from frappe.utils import set_request

	had_request = getattr(frappe.local, "request", None)
	if had_request is None:
		set_request(method="GET", path="/api/method/frappe.utils.print_format.download_pdf")
	try:
		yield
	finally:
		if had_request is None:
			frappe.local.request = None


def _archive_invoice_pdf(doctype, name, posting_date):
	"""Render the bill and file it under Invoices / YYYY / Month / date.

	Raises on failure — every caller decides for itself whether that is
	allowed to matter. The on_submit hook swallows it (a sale must never
	fail over a filing job); the retry and the Doctor fix want to know.
	"""
	if invoice_pdf_is_archived(doctype, name):
		return False

	print_format = frappe.db.get_value("DocType", doctype, "default_print_format")
	if not print_format:
		return False

	with _print_request_context():
		pdf_bytes = frappe.get_print(doctype, name, print_format, as_pdf=True)
	folder = _get_dated_invoice_folder(posting_date)

	from frappe.utils.file_manager import save_file

	save_file(
		fname=f"{name}.pdf",
		content=pdf_bytes,
		dt=doctype,
		dn=name,
		folder=folder,
		is_private=1,
	)
	return True


def retry_invoice_pdf_archive(doctype, name, posting_date):
	"""Background retry queued by the on_submit hook after it failed once."""
	try:
		if _archive_invoice_pdf(doctype, name, posting_date):
			frappe.db.commit()
	except Exception:
		frappe.log_error(
			title="Auto-save invoice PDF retry failed",
			message=f"{doctype} {name}\n\n{frappe.get_traceback()}",
		)


def invoices_missing_pdf(days: int = 7):
	"""Submitted bills from the last `days` with no archived PDF."""
	from frappe.utils import add_days, nowdate

	since = add_days(nowdate(), -int(days))
	missing = []
	for doctype in ("Sales Invoice", "POS Invoice"):
		if not frappe.db.exists("DocType", doctype):
			continue
		rows = frappe.get_all(
			doctype,
			filters={"docstatus": 1, "posting_date": (">=", since)},
			fields=["name", "posting_date"],
			limit_page_length=0,
		)
		for row in rows:
			if not invoice_pdf_is_archived(doctype, row.name):
				missing.append({"doctype": doctype, "name": row.name, "posting_date": row.posting_date})
	return missing


def regenerate_missing_invoice_pdfs(days: int = 7):
	"""Doctor fix — file the bills whose PDF never got written."""
	done, failed = [], []
	for row in invoices_missing_pdf(days):
		try:
			if _archive_invoice_pdf(row["doctype"], row["name"], row["posting_date"]):
				done.append(row["name"])
		except Exception as e:
			failed.append({"name": row["name"], "error": str(e)[:300]})
			frappe.log_error(
				title="Invoice PDF regeneration failed",
				message=f"{row['doctype']} {row['name']}\n\n{frappe.get_traceback()}",
			)
	frappe.db.commit()
	return {"regenerated": done, "failed": failed}


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


# Bihar village + pincode lookup for the "Add Party" dialog's City/Village
# field (2026-08-14 direct request). Sourced from India Post's official
# All India Pincode Directory (data.gov.in), filtered to Bihar's 38
# districts — 9,113 real villages/post offices, not invented data.
_SANTU_BIHAR_VILLAGES_CACHE = None


def _load_bihar_villages():
	global _SANTU_BIHAR_VILLAGES_CACHE
	if _SANTU_BIHAR_VILLAGES_CACHE is None:
		import json

		path = frappe.get_app_path("santu_hardware", "santu_hardware", "data", "bihar_villages.json")
		with open(path, encoding="utf-8") as f:
			_SANTU_BIHAR_VILLAGES_CACHE = json.load(f)
	return _SANTU_BIHAR_VILLAGES_CACHE


@frappe.whitelist()
def search_bihar_villages(district: str, search: str = None):
	"""Villages (with pincode) for one Bihar district, for the Add Party
	dialog's City/Village autocomplete.

	No district picked yet (the normal case — village is usually typed
	before district) means every district is searched, not zero of them.
	`district` used to be looked up on its own and returned nothing at all
	when blank (2026-08-18 bug report: "village name list me nh aa rha").
	"""
	data = _load_bihar_villages()
	if district:
		rows = [{**row, "district": district} for row in data.get(district, [])]
	else:
		# Each row carries its own district so picking one can also set the
		# District dropdown — a village implies its district, no need to make
		# the counter pick it separately (2026-08-18: "district nh liya").
		rows = [{**row, "district": d} for d, drows in data.items() for row in drows]
	if search:
		q = search.strip().lower()
		rows = [r for r in rows if q in r["village"].lower()]
	return rows[:300]


_SANTU_PINCODE_DISTRICT_CACHE = None


def _pincode_district_index() -> dict:
	"""pincode -> district, built once from the same village dataset.

	Lets the district be derived instead of asked for: the counter types a
	village, that fills the pincode, and the pincode names the district. No
	district picker, and no hardcoded home district (2026-08-16 direct
	request: "ye saran ko mt likh yaar, yaha pe pin code se auto district
	fetch ho jayega").
	"""
	global _SANTU_PINCODE_DISTRICT_CACHE
	if _SANTU_PINCODE_DISTRICT_CACHE is None:
		index = {}
		for district, rows in _load_bihar_villages().items():
			for row in rows:
				pin = (row.get("pincode") or "").strip()
				# First district wins: a pincode can span a district border in
				# this dataset, and flip-flopping per lookup would be worse
				# than consistently naming one of them.
				if pin and pin not in index:
					index[pin] = district
		_SANTU_PINCODE_DISTRICT_CACHE = index
	return _SANTU_PINCODE_DISTRICT_CACHE


def _district_for_pincode(pincode=None) -> str:
	"""District that a pincode belongs to, or "" when it isn't in the data.

	Deliberately un-whitelisted and un-annotated. Frappe type-checks the
	arguments of whitelisted functions, so the annotated version below blew up
	with FrappeTypeError the moment internal code passed a pincode of None —
	which is every brand new party. That failed the save AFTER the customer
	had already been created, so the counter got a party and no bill.
	"""
	return _pincode_district_index().get((pincode or "").strip(), "")


@frappe.whitelist()
def district_for_pincode(pincode: str = None) -> str:
	"""HTTP wrapper — internal callers should use _district_for_pincode."""
	return _district_for_pincode(pincode)


def _district_names() -> set:
	"""Every Bihar district name, lowercased."""
	return {d.strip().lower() for d in _load_bihar_villages().keys() if d}


def is_district_name(value: str) -> bool:
	"""True when this value is a district, not a village.

	Older party creation wrote the district into Address.city, so parties on
	file literally have "Saran" sitting in the field the Village box reads.
	That is not a village and must not be shown as one — blank is honest and
	prompts someone to type the real one, where "Saran" silently looked
	answered and stopped anyone ever filling it in (2026-08-16 bug report).
	"""
	return (value or "").strip().lower() in _district_names()


def _village_lookup(village: str) -> dict:
	"""First {village, pincode, district} matching this village name."""
	name = (village or "").strip().lower()
	if not name:
		return {}
	for district, rows in _load_bihar_villages().items():
		for row in rows:
			if (row.get("village") or "").strip().lower() == name:
				return {"village": row.get("village"), "pincode": row.get("pincode"), "district": district}
	return {}


@frappe.whitelist()
def search_villages(search: str, limit: int = 20):
	"""Village autocomplete across the whole state, each row carrying its own
	pincode and district.

	The sale screen used to search one hardcoded district, so a customer from
	the next district over simply never appeared. Nothing here is scoped to a
	home district; exact-prefix matches lead so the common case is the first
	row.
	"""
	q = (search or "").strip().lower()
	if len(q) < 2:
		return []
	limit = cint(limit) or 20
	starts, contains = [], []
	for district, rows in _load_bihar_villages().items():
		for row in rows:
			name = row.get("village") or ""
			low = name.lower()
			if low.startswith(q):
				bucket = starts
			elif q in low:
				bucket = contains
			else:
				continue
			bucket.append({"village": name, "pincode": row.get("pincode"), "district": district})
		if len(starts) >= limit:
			break
	return (starts + contains)[:limit]


@frappe.whitelist()
def create_customer_full(party: str):
	"""Full "Add Party" dialog (2026-08-14 direct request, pixel-matched to
	a Vyapar screenshot) — beyond the quick name+phone capture above, this
	covers GSTIN/GST category and a real Billing Address, exactly the
	fields that screenshot's dialog collects. Address title-casing is
	handled by the existing `title_case_address_fields` before_save hook,
	not duplicated here.
	"""
	data = frappe.parse_json(party) if isinstance(party, str) else party
	customer_name = (data.get("customer_name") or "").strip()
	if not customer_name:
		frappe.throw(_("Party Name is required."))

	# A named party needs at least ONE way to be found again — a phone
	# number or a place. Requiring both is friction at a counter; requiring
	# neither leaves a list of bare names nobody can tell apart (2026-08-16
	# direct request: "yaa to city mandatory kr ya phir phone number, dono me
	# se ek"). Anonymous counter sales don't come through here at all — they
	# go to Walk-in Customer without being asked anything.
	has_phone = bool((data.get("phone") or "").strip())
	has_place = any((data.get(f) or "").strip() for f in ("address_line1", "city", "district", "pincode"))
	if not has_phone and not has_place:
		frappe.throw(_("Add a phone number or an address — one of the two is needed to find this party later."))

	customer = frappe.new_doc("Customer")
	customer.customer_name = customer_name
	customer.customer_type = "Individual"
	customer.mobile_no = data.get("phone")
	customer.email_id = data.get("email")
	if data.get("gstin"):
		customer.gstin = data.get("gstin")
	if data.get("gst_category"):
		customer.gst_category = data.get("gst_category")
	customer.customer_group = frappe.db.get_value("Customer Group", {}, "name") or "All Customer Groups"
	customer.territory = frappe.db.get_value("Territory", {}, "name") or "All Territories"
	if flt(data.get("credit_limit")) > 0:
		company = frappe.defaults.get_user_default("Company")
		if company:
			customer.append("credit_limits", {"company": company, "credit_limit": flt(data.get("credit_limit"))})
	# One savepoint around the whole party. Customer used to be inserted
	# first and the Address after; when the Address failed validation the
	# Customer survived, so a retry made "Name - 1", "Name - 2"… (seen live
	# 2026-08-16 while the state/city rules were still tripping).
	savepoint = "santu_create_party"
	frappe.db.savepoint(savepoint)
	try:
		customer.insert(ignore_permissions=True)
		_create_customer_addresses(customer, customer_name, data)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise

	return customer.name


def _create_customer_addresses(customer, customer_name, data):
	"""Billing (and optional shipping) address for a newly created party."""
	# Address doctype has no native "district" field — this app added the
	# picker (default Bihar/Saran) purely to help the cashier find the
	# right village faster; fold the choice into address_line2 rather than
	# silently dropping it, unless the cashier already typed something there.
	# Only a real address field counts. state/country are sent as defaults by
	# callers even when no address was typed, and including them here used to
	# conjure an Address whose line1 was just the customer's name.
	address_fields = ("address_line1", "address_line2", "city", "pincode", "district")
	if any((data.get(f) or "").strip() for f in address_fields):
		# The City/Village picker shows "Village - PIN" (so the pincode is
		# visible right in the option list); split that back apart here
		# rather than on the client, where Frappe's Autocomplete control
		# re-validates set_value() against its own option list and silently
		# blanks anything that isn't an exact match.
		city = (data.get("city") or "").strip()
		pincode = data.get("pincode")
		city_match = re.match(r"^(.*)\s-\s(\d{6})$", city)
		if city_match:
			city = city_match.group(1)
			pincode = pincode or city_match.group(2)

		# Village fills in the pincode, pincode names the district — neither is
		# asked for twice and neither is assumed.
		if city and not pincode:
			pincode = (_village_lookup(city) or {}).get("pincode")
		district = (data.get("district") or "").strip() or _district_for_pincode(pincode)

		address = frappe.new_doc("Address")
		address.address_title = customer_name
		address.address_type = "Billing"
		address.address_line1 = data.get("address_line1") or customer_name
		address.address_line2 = data.get("address_line2") or (f"{district} District" if district else None)
		# City is mandatory on Address. It holds the village here; when no
		# village was typed the district derived from the pincode is the next
		# most accurate thing. Nothing is defaulted to this shop's own district
		# any more — that silently stamped every out-of-district customer as
		# local (2026-08-16 direct request).
		address.city = city or district or (data.get("address_line1") or customer_name)
		address.state = data.get("state") or "Bihar"
		address.pincode = pincode
		address.country = data.get("country") or "India"
		address.append("links", {"link_doctype": "Customer", "link_name": customer.name})
		address.insert(ignore_permissions=True)
		customer.customer_primary_address = address.name
		# Keep santu_village in step with the address. The counter screens read
		# the village off the Customer, not the Address, so a party created
		# through this flow used to show "No village on file" forever even with
		# a perfectly good address on record — the same fact stored in two
		# places, only one of which was ever written.
		if not (customer.get("santu_village") or "").strip():
			customer.santu_village = address.city
		customer.save(ignore_permissions=True)

	if (data.get("shipping_address") or "").strip():
		ship = frappe.new_doc("Address")
		ship.address_title = customer_name
		ship.address_type = "Shipping"
		ship.address_line1 = data.get("shipping_address").strip()
		ship.city = (
			(data.get("city") or "").strip()
			or (data.get("district") or "").strip()
			or _district_for_pincode(data.get("pincode"))
			or data.get("shipping_address").strip()
		)
		ship.state = data.get("state")
		ship.country = data.get("country") or "India"
		ship.append("links", {"link_doctype": "Customer", "link_name": customer.name})
		ship.insert(ignore_permissions=True)


@frappe.whitelist()
def search_transactions_topbar(query: str, limit: int = 10):
	"""Top bar "Search Transactions" box — invoice number or party name,
	across every transaction type a hardware shop actually issues."""
	if not query or len(query) < 2:
		return []

	# ("doctype", party_field, has_santu_bill_no) — only Sales Invoice and POS
	# Invoice carry the shop's own running Bill No (santu_bill_no). Matching
	# only on `name` here meant searching "297" for a bill the operator can
	# see is numbered 297 on the Parties panel and the thermal slip came back
	# "No transactions found", because the real document ID is something like
	# SINV-26-00254 which doesn't contain "297" anywhere (2026-08-23 report).
	specs = [
		("Sales Invoice", "customer", True),
		("POS Invoice", "customer", True),
		("Purchase Invoice", "supplier", False),
		("Sales Order", "customer", False),
		("Purchase Order", "supplier", False),
		("Quotation", "party_name", False),
		("Delivery Note", "customer", False),
	]
	out = []
	for doctype, party_field, has_bill_no in specs:
		or_filters = {"name": ["like", f"%{query}%"], party_field: ["like", f"%{query}%"]}
		if has_bill_no and query.strip().isdigit():
			or_filters["santu_bill_no"] = ["like", f"%{query}%"]
		rows = frappe.get_all(
			doctype,
			filters={"docstatus": ["!=", 2]},
			or_filters=or_filters,
			fields=["name", party_field + " as party"],
			order_by="modified desc",
			limit_page_length=limit,
		)
		for r in rows:
			out.append({"doctype": doctype, "name": r.name, "party": r.party})
	out.sort(key=lambda r: r["name"], reverse=True)
	out = out[: int(limit)]

	# Same running Bill No the Parties panel shows, for the same reason: the
	# document ID means nothing to an operator, the printed Bill No does.
	bill_no_by_name = {}
	for bill_doctype in ("Sales Invoice", "POS Invoice"):
		names = [r["name"] for r in out if r["doctype"] == bill_doctype]
		if not names:
			continue
		for row in frappe.get_all(bill_doctype, filters={"name": ["in", names]}, fields=["name", "santu_bill_no"]):
			bill_no_by_name[row.name] = row.santu_bill_no
	for r in out:
		bill_no = bill_no_by_name.get(r["name"])
		r["display_number"] = format_bill_no(bill_no) if bill_no else r["name"]

	return out


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
	rows = frappe.get_all(
		"Customer",
		filters={"customer_name": ["like", f"%{query}%"]},
		fields=["name", "customer_name", "mobile_no", "santu_village", "customer_details"],
		order_by="modified desc",
		limit_page_length=8,
	)
	# Same resolution the sale screen uses, so the dropdown and the party card
	# can never disagree about where someone is from.
	for row in rows:
		row["santu_village"] = party_village("Customer", row["name"], row.get("santu_village"))
	return rows


@frappe.whitelist()
def search_customers_by_phone(query: str):
	"""Live suggestions for the Phone field, mirroring search_customers_by_name
	(2026-08-16 direct request: "phone no enter krne se party name nh aa raha
	... sab ek dusre se connect ho and wo aa jaye") — typing a phone number
	should surface the matching customer just as typing a name does, so the
	cashier isn't stuck re-typing details for someone already on file."""
	if not query or len(query) < 4:
		return []
	rows = frappe.get_all(
		"Customer",
		filters={"mobile_no": ["like", f"%{query}%"]},
		fields=["name", "customer_name", "mobile_no", "santu_village", "customer_details"],
		order_by="modified desc",
		limit_page_length=8,
	)
	for row in rows:
		row["santu_village"] = party_village("Customer", row["name"], row.get("santu_village"))
	return rows


@frappe.whitelist()
def update_customer_note(customer: str, note: str):
	"""Set the identification note (Customer Details) used to tell apart
	same-name customers in the Sale screen's search dropdown."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} not found").format(customer or ""))
	frappe.db.set_value("Customer", customer, "customer_details", note or "")
	return note or ""


def _default_hsn_code() -> str:
	"""The HSN this shop's catalogue uses most often, or None if it has none."""
	row = frappe.db.sql(
		"""select gst_hsn_code from `tabItem`
		where ifnull(gst_hsn_code, '') != ''
		group by gst_hsn_code order by count(*) desc limit 1"""
	)
	return row[0][0] if row else None


# Units a hardware shop reaches for, in the order it reaches for them.
# ERPNext ships 264 UOMs — Ampere, Hectare, Becquerel — and an alphabetical
# Link field buried "Nos" and "Box" somewhere past the middle, so adding an
# item meant scrolling a list of things this shop will never sell
# (2026-08-17: "yaha pe mujhe more and more me sabse niche khojna pada").
SANTU_HARDWARE_COMMON_UOMS = [
	"Nos",
	"Box",
	"Packet",
	"Kg",
	"Litre",
	"Bundle",
	"Can",
	"Pair",
	"Set",
	"Dozen",
	"Meter",
	"Feet",
	"Roll",
	"Bag",
	"Gram",
	"Ml",
]


# --- Barcode scanning ------------------------------------------------------
#
# The scanner is a plain USB HID device: it "types" the barcode and presses
# Enter. Nothing has to be installed or configured for it — the whole job is
# recognising that burst of keystrokes and turning it into the right item.
# These two endpoints are the entire server side of it.


@frappe.whitelist()
def find_item_by_barcode(barcode: str):
	"""Which item carries this barcode, with what a counter needs to know.

	Returns `found: False` rather than throwing when nothing matches: an
	unrecognised barcode is an ordinary, expected event (new stock arrives
	with codes the shop has never seen), and the screens turn it into an
	offer to attach it, not an error.
	"""
	barcode = (barcode or "").strip()
	if not barcode:
		return {"found": False, "barcode": barcode}

	item_code = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")

	# Some suppliers' codes were typed in as the item code or even the item
	# name before scanning existed — this shop has items literally named
	# "8904144800026". Fall back to those so a scan still lands.
	if not item_code and frappe.db.exists("Item", barcode):
		item_code = barcode
	if not item_code:
		item_code = frappe.db.get_value("Item", {"item_name": barcode, "disabled": 0}, "name")

	if not item_code:
		return {"found": False, "barcode": barcode}

	item = frappe.db.get_value(
		"Item", item_code, ["item_code", "item_name", "stock_uom", "is_stock_item", "disabled"], as_dict=True
	)
	if not item or item.disabled:
		return {"found": False, "barcode": barcode}

	warehouse = default_selling_warehouse()
	item["available_qty"] = (
		flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))
		if warehouse
		else None
	)
	item["price"] = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate"
	)
	item["barcode"] = barcode
	item["found"] = True
	return item


@frappe.whitelist()
def attach_barcode_to_item(item_code: str, barcode: str):
	"""Teach the shop that this code means this item.

	The whole value of a scanner is that it removes typing, and that only
	works once every item carries its code. Attaching happens where the gap
	is noticed — at the counter, mid-scan — rather than in a separate
	data-entry exercise nobody will do.
	"""
	barcode = (barcode or "").strip()
	if not barcode:
		frappe.throw(_("Barcode khaali hai."))
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} nahi mila.").format(item_code))

	owner = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
	if owner and owner != item_code:
		frappe.throw(
			_("Ye barcode pehle se '{0}' par laga hai. Ek barcode ek hi saman ka ho sakta hai.").format(owner)
		)
	if owner == item_code:
		return {"ok": True, "already": True, "item_code": item_code}

	item = frappe.get_doc("Item", item_code)
	item.append("barcodes", {"barcode": barcode})
	item.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "already": False, "item_code": item_code, "item_name": item.item_name}


@frappe.whitelist()
def set_item_stock(item_code: str, new_qty: float, reason: str = "Count Correction"):
	"""Correct one item's stock, from wherever the shopkeeper noticed it.

	Wraps `fix_stock` with the one thing it could not do: an item that was
	never stock-tracked. Items quick-created before 2026-08-17 were made
	non-stock (there was no way to ask "how many do you have?"), so they sit
	on the bill saying "Available: 0" forever and no amount of stock
	correction can change that — the number is not merely wrong, the item
	has no stock at all. Flipping it to stock-tracked first turns a dead end
	into a normal correction.
	"""
	if not item_code:
		frappe.throw(_("Item chahiye."))

	item = frappe.db.get_value("Item", item_code, ["is_stock_item", "stock_uom"], as_dict=True)
	if not item:
		frappe.throw(_("Item {0} nahi mila.").format(item_code))

	converted = False
	if not cint(item.is_stock_item):
		frappe.db.set_value("Item", item_code, "is_stock_item", 1)
		frappe.db.commit()
		converted = True

	result = fix_stock(item_code, new_qty, reason)

	warehouse = default_selling_warehouse()
	actual = flt(
		frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
	)
	return {
		"name": result.get("name"),
		"item_code": item_code,
		"available_qty": actual,
		"uom": item.stock_uom,
		"converted_to_stock_item": converted,
	}


# --- Editable item master fields --------------------------------------------
#
# Stock Summary shows master data (name, category, brand, HSN, rack) next to
# live numbers (rate, stock, batches) — a shopkeeper corrects both from the
# same screen, without a raw Frappe Item form in between (2026-08-17 direct
# request: "sab dynamic rakho... mai edit kr saku").
#
# Only these five fields are reachable, and only through this list — the
# fieldname arrives from the browser, so accepting it unchecked would let a
# request name any field on Item at all (is_stock_item, disabled,
# valuation_rate...). Each entry says what kind of value is allowed and,
# for Link fields, which doctype it must actually exist in.
#
# All three Link fields are auto_create (2026-08-17 direct request: "add new
# category ka v option ho, add new brand, etc etc. all should be dynamic") —
# including HSN, after flagging that an invented HSN code can misstate GST on
# an invoice/return; Ankit chose free-create anyway. create_field is that
# doctype's own autoname field, since it differs per doctype (Brand names
# itself off "brand", Item Group off "item_group_name", GST HSN Code off
# "hsn_code" — using the Link fieldname itself would be wrong for the latter
# two).
EDITABLE_ITEM_FIELDS = {
	"item_name": {"kind": "data", "label": "Naam"},
	"item_group": {
		"kind": "link",
		"doctype": "Item Group",
		"label": "Category",
		"auto_create": True,
		"create_field": "item_group_name",
	},
	"brand": {
		"kind": "link",
		"doctype": "Brand",
		"label": "Brand",
		"auto_create": True,
		"create_field": "brand",
	},
	"gst_hsn_code": {
		"kind": "link",
		"doctype": "GST HSN Code",
		"label": "HSN",
		"auto_create": True,
		"create_field": "hsn_code",
	},
	"custom_rack_number": {"kind": "data", "label": "Rack/Location"},
}


@frappe.whitelist()
def update_item_field(item_code: str, fieldname: str, value=None):
	"""Edit one master-data field on an item, from wherever it is shown.

	Every Link field here may invent a new value on the spot — this shop's
	Category/Brand/HSN lists start out incomplete, and asking someone to go
	create a master record before they can type it on an item is exactly the
	kind of extra step this app exists to remove. A typo becomes a new row
	instead of an error; that is a deliberate trade the owner made.
	"""
	spec = EDITABLE_ITEM_FIELDS.get(fieldname)
	if not spec:
		frappe.throw(_("Ye field yahan se edit nahi ho sakta."))
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} nahi mila.").format(item_code or ""))

	value = (value or "").strip()

	if fieldname == "item_name" and not value:
		frappe.throw(_("Naam khaali nahi ho sakta."))

	if spec["kind"] == "link" and value and not frappe.db.exists(spec["doctype"], value):
		if spec.get("auto_create"):
			frappe.get_doc({"doctype": spec["doctype"], spec["create_field"]: value}).insert(
				ignore_permissions=True
			)
		else:
			frappe.throw(_("'{0}' ek asli {1} nahi hai.").format(value, spec["label"]))

	frappe.db.set_value("Item", item_code, fieldname, value or None)
	frappe.db.commit()
	return {"ok": True, "fieldname": fieldname, "value": value or None}


@frappe.whitelist()
def update_item_rate(item_code: str, kind: str, rate):
	"""Change Purchase Rate or Selling Price straight from Stock Summary.

	"Selling Price" is a plain Item Price edit (Standard Selling) — the same
	record Billing already reads as the default rate, so a change here is
	visible on the very next sale.

	"Purchase Rate" is not that simple: the column shown is a weighted-
	average cost pulled from the stock ledger (Bin.stock_value / qty), not a
	list price, so editing the Item Price alone would not move the number on
	screen for any item that already has stock (which is most of them). The
	correct way to correct a valuation without a new purchase is a real
	Stock Reconciliation at the current quantity — same real-ledger-entry
	principle this app uses everywhere else, not a fudge (2026-08-18 direct
	request: "purchase rate and selling rate change krne ka option do").
	"""
	if kind not in ("purchase", "selling"):
		frappe.throw(_("Ye rate yahan se badli nahi ja sakti."))
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} nahi mila.").format(item_code or ""))
	rate = flt(rate)
	if rate < 0:
		frappe.throw(_("Rate negative nahi ho sakti."))

	price_list = "Standard Buying" if kind == "purchase" else "Standard Selling"
	buying = 1 if kind == "purchase" else 0
	# `batch_no: ["in", ["", None]]` never matches a NULL batch_no — SQL's
	# IN never matches NULL regardless of what is in the list, so this has
	# to be a real IFNULL check. The wrong filter always missed the
	# existing row and fell into the create branch below, leaving two Item
	# Price rows for the same list/item every time a rate was edited an
	# even number of times (found 2026-08-18 while testing this feature).
	existing = frappe.db.sql(
		"""select name from `tabItem Price`
		   where item_code=%s and price_list=%s and ifnull(batch_no,'')=''
		   order by modified desc limit 1""",
		(item_code, price_list),
	)
	existing = existing[0][0] if existing else None
	if existing:
		frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
	elif rate > 0:
		price = frappe.new_doc("Item Price")
		price.item_code = item_code
		price.price_list = price_list
		price.buying = buying
		price.selling = 0 if buying else 1
		price.price_list_rate = rate
		price.insert(ignore_permissions=True)

	cost_rate = None
	if kind == "purchase":
		company = frappe.defaults.get_user_default("Company")
		warehouse = default_selling_warehouse(company)
		qty = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))
		if qty > 0 and warehouse:
			recon = frappe.new_doc("Stock Reconciliation")
			recon.company = company
			recon.purpose = "Stock Reconciliation"
			recon.append(
				"items",
				{
					"item_code": item_code,
					"warehouse": warehouse,
					"qty": qty,
					"valuation_rate": rate,
					"current_qty": qty,
				},
			)
			recon.insert(ignore_permissions=True)
			recon.submit()
			cost_rate = rate
		else:
			# No stock to revalue yet — the Item Price above still sets what
			# the NEXT receipt will suggest as its rate.
			cost_rate = flt(frappe.db.get_value("Item", item_code, "last_purchase_rate")) or rate
			frappe.db.set_value("Item", item_code, "last_purchase_rate", rate)
	frappe.db.commit()
	return {"ok": True, "kind": kind, "rate": rate, "cost_rate": cost_rate}


@frappe.whitelist()
def search_link_values(doctype: str, query: str = "", limit: int = 10):
	"""Autocomplete for the item-master Link fields above.

	Restricted to the same three doctypes editable via update_item_field —
	this is a search endpoint, and letting the browser search an arbitrary
	doctype by name would leak far more than a category list.
	"""
	if doctype not in ("Item Group", "Brand", "GST HSN Code"):
		frappe.throw(_("Ye list yahan se dhoondhi nahi ja sakti."))
	return frappe.get_list(
		doctype,
		filters={"name": ["like", f"%{query}%"]} if query else {},
		pluck="name",
		limit_page_length=cint(limit),
		order_by="name asc",
	)


@frappe.whitelist()
def sale_uom_options():
	"""Units for the new-item dialog, most likely first.

	Ordered by what this shop actually stocks (counted from its own items),
	then the hardware list above, then everything else alphabetically. The
	shop's real usage leads because that is the only ranking that stays
	right as the catalogue changes — today it puts Nos first because 38 of
	39 items are in Nos, and it will keep doing the right thing without
	anyone maintaining a list.
	"""
	existing = {u.lower() for u in frappe.get_all("UOM", pluck="name")}

	used = frappe.db.sql(
		"""select stock_uom, count(*) c from `tabItem`
		    where disabled = 0 and ifnull(stock_uom, '') != ''
		    group by stock_uom order by c desc""",
		as_dict=True,
	)

	ordered, seen = [], set()

	def add(name, group):
		if not name or name.lower() in seen or name.lower() not in existing:
			return
		seen.add(name.lower())
		ordered.append({"name": name, "group": group})

	for row in used:
		add(row.stock_uom, "dukaan")
	for name in SANTU_HARDWARE_COMMON_UOMS:
		add(name, "aam")
	for name in frappe.get_all("UOM", filters={"enabled": 1}, pluck="name", order_by="name asc"):
		add(name, "baaki")

	return ordered


@frappe.whitelist()
def items_with_same_name(item_name):
	"""Existing items that already carry this name.

	Asked before creating a new one. Duplicates in this catalog were not
	created maliciously — someone typed a name that already existed and
	nothing said so. This is the sentence that was missing.
	"""
	key = (item_name or "").strip().lower()
	if not key:
		return []
	rows = frappe.get_all(
		"Item",
		filters={"disabled": 0},
		fields=["item_code", "item_name", "stock_uom"],
		limit_page_length=0,
	)
	matches = [r for r in rows if (r.item_name or "").strip().lower() == key]
	warehouse = default_selling_warehouse()
	for row in matches:
		row["available_qty"] = (
			flt(frappe.db.get_value("Bin", {"item_code": row.item_code, "warehouse": warehouse}, "actual_qty"))
			if warehouse
			else None
		)
	return matches


@frappe.whitelist()
def quick_create_item(
	item_name: str,
	selling_price: float,
	item_group: str = None,
	uom: str = None,
	barcode: str = None,
	gst_hsn_code: str = None,
	price_list: str = None,
	buying: int = 0,
	opening_qty=None,
	cost_price=None,
	require_opening_qty: int = 1,
):
	"""Inline item creation from the POS billing screen (2026-07-31 direct
	request) — "the cashier should never have to leave the billing screen
	just to add a missing item." Mirrors `get_or_create_customer_by_phone`:
	a minimal, purpose-built create path rather than the full Item quick
	entry dialog (which asks for far more than a counter sale needs).

	Opening quantity is mandatory (2026-08-20: leaving it optional let
	cashiers skip it without noticing, and the item silently came out as a
	non-stock Service — invisible to stock counts, low-stock and valuation,
	with nobody going back to fix it later). Every item created here is a
	real stock item; the cashier has to say how many are actually on hand
	before the item can exist at all.

	This does mean a genuinely stock-less one-off (a service, something
	borrowed) can no longer be quick-created from this dialog — the shop
	decided that trade-off is worth it (2026-08-17 request: "total items
	available ka option, and units v" plus the 2026-08-20 follow-up making
	it required) since untracked items were the more common accident.

	`require_opening_qty=0` lifts only that count requirement, for Estimate /
	Quotation, where the shop quotes a price for goods it may not have bought
	yet. The item is STILL created stock-tracked (`is_stock_item = 1`) with
	zero on hand — it simply shows as 0 in Stock Summary instead of vanishing
	into a non-stock Service, which was the original bug.

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

	opening_qty = flt(opening_qty)
	# Selling side (billing screen): opening qty is mandatory — this is where
	# items used to silently come out as non-stock Services when a cashier
	# left it blank. Buying side (purchase screen): the purchase line itself
	# is about to receive the stock, so there is no opening qty to ask for
	# here — the item is still always created stock-tracked below.
	#
	# `require_opening_qty=0` is the one deliberate exemption: Estimate /
	# Quotation quotes goods the shop may not stock yet ("bhav bata do"), so
	# demanding a count there would block a legitimate quote. It stays strict
	# by default so a screen that forgets to think about it gets the safe
	# behaviour rather than the loose one (2026-08-20).
	if not buying and cint(require_opening_qty) and opening_qty <= 0:
		frappe.throw(_("Abhi kitna hai? — stock batana zaroori hai naya saman banane ke liye."))

	item = frappe.new_doc("Item")
	item.item_code = item_code
	item.item_name = item_name
	item.item_group = item_group or "Products"
	item.stock_uom = uom or "Nos"
	item.is_stock_item = 1
	item.include_item_in_manufacturing = 0
	# HSN is genuinely optional for this shop (2026-08-18 direct request:
	# "hsn code is not required, remember that" — GST Settings.validate_hsn_code
	# switched off site-wide for exactly this reason). Still filled in from the
	# quick-create form or the catalogue's own most-used code when given, since
	# it's free to have and useful on a formal GST bill, but creating a new
	# item is never blocked on it being present.
	item.gst_hsn_code = gst_hsn_code or _default_hsn_code()
	if barcode:
		item.append("barcodes", {"barcode": barcode})
	item.insert(ignore_permissions=True)

	price_list = price_list or ("Standard Buying" if buying else "Standard Selling")
	item_price = frappe.new_doc("Item Price")
	item_price.item_code = item.item_code
	item_price.price_list = price_list
	item_price.buying = 1 if buying else 0
	item_price.selling = 0 if buying else 1
	item_price.price_list_rate = flt(selling_price)
	item_price.insert(ignore_permissions=True)

	# Buying price is optional. Without it the opening stock still posts (at
	# zero valuation, via allow_zero_valuation_rate) rather than refusing —
	# a cashier mid-sale may genuinely not know the cost, and blocking the
	# sale over it would be the wrong trade. With it, the shop's cost-price
	# and margin views work on this item from the first day.
	cost_price = flt(cost_price)
	if cost_price > 0:
		buying_price = frappe.new_doc("Item Price")
		buying_price.item_code = item.item_code
		buying_price.price_list = "Standard Buying"
		buying_price.buying = 1
		buying_price.selling = 0
		buying_price.price_list_rate = cost_price
		buying_price.insert(ignore_permissions=True)

	opening_entry = None
	if opening_qty > 0:
		opening_entry = receive_stock_simple(item.item_code, opening_qty, cost_price or None)

	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"rate": flt(selling_price),
		"uom": item.stock_uom,
		"is_stock_item": item.is_stock_item,
		"opening_qty": opening_qty if opening_qty > 0 else 0,
		"stock_entry": opening_entry.get("name") if opening_entry else None,
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


# Switched off (2026-08-18): nothing calls this any more — the printed
# bill/PDF that reaches customers never showed loyalty points to begin
# with, so there was nothing to also strip from print. Kept commented
# rather than deleted for whenever loyalty comes back.
# @frappe.whitelist()
# def get_customer_loyalty_summary(customer: str, invoice: str = None):
# 	"""Points earned on this specific bill (from its own Loyalty Point
# 	Entry, if the sale posted one) and the customer's running total —
# 	for the "Earned reward points / Total reward points" lines on the
# 	printed bill (2026-07-30 direct request)."""
# 	if not customer:
# 		return {"earned_this_bill": 0, "total_points": 0}
#
# 	earned_this_bill = 0
# 	if invoice:
# 		earned_this_bill = flt(
# 			frappe.db.get_value("Loyalty Point Entry", {"invoice": invoice}, "loyalty_points")
# 		)
#
# 	total_points = flt(
# 		frappe.db.sql(
# 			"select sum(loyalty_points) from `tabLoyalty Point Entry` where customer = %s and expiry_date >= %s",
# 			(customer, frappe.utils.today()),
# 		)[0][0]
# 	)
# 	return {"earned_this_bill": earned_this_bill, "total_points": total_points}


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


def _format_qty(qty) -> str:
	qty = flt(qty)
	return str(int(qty)) if qty == int(qty) else str(qty)


def _summarize_items(item_rows, limit: int = 2) -> str:
	"""Short "what did they buy" string for a transaction-list row — e.g.
	"Fevicol SR998 x2, Anchor Roma x1 +3 more" — so a shop owner can see
	what goods actually moved without opening every single bill (2026-08-15
	direct request: "kab kab saman le gaya kitna baaki hai sab dikhna
	chahiye" — the party/dues transaction lists only showed bill totals,
	not what was in them)."""
	if not item_rows:
		return ""
	parts = [f"{r.item_name} x{_format_qty(r.qty)}" for r in item_rows[:limit]]
	summary = ", ".join(parts)
	if len(item_rows) > limit:
		summary += f" +{len(item_rows) - limit} more"
	return summary


def _attach_item_summaries(rows, doctype: str, item_doctype: str):
	"""Batch-fetch and attach an `items_summary` string to each row in
	`rows` (each already carrying its own `name`) — one query per doctype
	instead of one per row."""
	names = [r["name"] for r in rows]
	if not names:
		return
	item_rows = frappe.get_all(
		item_doctype,
		filters={"parent": ["in", names]},
		fields=["parent", "item_name", "qty"],
		order_by="idx asc",
	)
	by_parent = {}
	for it in item_rows:
		by_parent.setdefault(it.parent, []).append(it)
	for r in rows:
		r["items_summary"] = _summarize_items(by_parent.get(r["name"], []))


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
	_attach_item_summaries(si_rows, "Sales Invoice", "Sales Invoice Item")

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
	_attach_item_summaries(pos_rows, "POS Invoice", "POS Invoice Item")

	rows = list(si_rows) + list(pos_rows)
	rows.sort(key=lambda r: r["posting_date"], reverse=True)
	return rows


@frappe.whitelist()
def add_manual_due(customer: str, amount: float, note: str = None):
	"""Let the owner directly add to a customer's outstanding balance from
	the Customer Dues page (2026-08-20 direct request: "customer ka add
	direct more baki amont add kr saku") — for dues that didn't come from a
	sale made in this system (an old udhaar carried over, a loan, etc).

	Books as a real, tiny Sales Invoice against a fixed non-stock
	"Udhaar / Purana Baki" line item, rather than inventing a second
	balance-tracking mechanism. get_customer_dues() and
	get_customer_all_bills() already sum Sales Invoice outstanding_amount,
	so this shows up there for free, and the customer's whole history
	(this due, and whenever it eventually gets paid off) stays in the one
	place every other bill already lives — see [[feedback_one_path_per_task]].
	strip_gst_line_items() (doc_events, before_validate/validate) clears
	tax templates on every Sales Invoice regardless, so grand_total lands
	exactly on `amount` with no GST inflating it.
	"""
	amount = flt(amount)
	if not customer:
		frappe.throw(_("Customer is required."))
	if amount <= 0:
		frappe.throw(_("Please enter a valid amount."))

	item_code = "PURANA-BAKI"
	if not frappe.db.exists("Item", item_code):
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = "Udhaar / Purana Baki"
		item.item_group = "Products"
		item.stock_uom = "Nos"
		# Deliberately NOT stock-tracked (unlike every item quick_create_item
		# makes) — this is a ledger adjustment, not real goods leaving a
		# shelf, so it must never appear in Stock Summary or low-stock counts.
		item.is_stock_item = 0
		item.include_item_in_manufacturing = 0
		item.gst_hsn_code = _default_hsn_code()
		item.insert(ignore_permissions=True)

	company = frappe.defaults.get_user_default("Company")
	doc = frappe.new_doc("Sales Invoice")
	doc.flags.ignore_pos_profile = True
	doc.customer = customer
	doc.company = company
	doc.posting_date = frappe.utils.today()
	doc.set_posting_time = 1
	doc.due_date = doc.posting_date
	doc.selling_price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	doc.update_stock = 0
	doc.remarks = note or _("Purana baki / manual due added")
	doc.append("items", {"item_code": item_code, "qty": 1, "rate": amount})
	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")
	doc.insert(ignore_permissions=True)
	doc.submit()
	return {"name": doc.name, "grand_total": doc.grand_total}


@frappe.whitelist()
def get_parties_list(search: str = None, party_type: str = None, only_with_balance: int = 0):
	"""Combined Customer + Supplier list for the Vyapar-style "Parties"
	screen (2026-08-06 direct request, matching Vyapar's own split-view
	Parties page: one list of every party — customers and suppliers both
	— each showing what's owed, then a detail panel on the right when one
	is selected). ERPNext keeps Customer and Supplier as separate
	doctypes; this merges them into one list only for this screen, same
	balance math get_customer_dues/get_dashboard_data already use.

	party_type/only_with_balance let the Dashboard's "Total Payable" card
	drill down to just the suppliers actually owed money (2026-08-14
	request: "total payable ke time kewaal payable wala hi dikhe" — only
	payable parties should show, not the full mixed directory).
	"""
	customer_filters = {"customer_name": ["like", f"%{search}%"]} if search else {}
	supplier_filters = {"supplier_name": ["like", f"%{search}%"]} if search else {}

	customers = (
		frappe.get_all("Customer", filters=customer_filters, fields=["name", "customer_name"])
		if party_type != "Supplier"
		else []
	)
	suppliers = (
		frappe.get_all("Supplier", filters=supplier_filters, fields=["name", "supplier_name"])
		if party_type != "Customer"
		else []
	)

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

	if only_with_balance:
		rows = [r for r in rows if (r["amount"] or 0) > 0]

	# Parties with money owed either way surface first (largest balance
	# first) — same as the Total Payable dashboard card, which lands here:
	# the point of clicking through is "who do I owe/who owes me the
	# most", not an alphabetical directory.
	rows.sort(key=lambda r: (-(r["amount"] or 0), (r["party_name"] or "").lower()))
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

	warehouse = default_selling_warehouse()

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
def delete_item(item_code: str):
	"""Delete an Item from the catalog (Items screen, 2026-08-25 bug report:
	no way to remove an item that was added by mistake).

	A real hardware-shop item almost always has stock/sales/purchase history
	linked to it — deleting that would break past invoices. So: if nothing
	links to it, delete it outright; if something does, disable it instead
	(hidden from billing/search, history stays intact) and tell the operator
	that's what happened, in plain language, not Frappe's LinkExistsError.
	"""
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} not found").format(item_code or ""))

	try:
		frappe.delete_doc("Item", item_code, ignore_permissions=True)
		return {"deleted": True}
	except Exception:
		frappe.db.rollback()
		frappe.db.set_value("Item", item_code, "disabled", 1)
		frappe.db.commit()
		return {"deleted": False, "disabled": True}


@frappe.whitelist()
def get_item_detail(item_code: str):
	"""Full item detail for the Items screen's right-hand panel."""
	from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_pos_reserved_qty

	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} not found").format(item_code or ""))

	warehouse = default_selling_warehouse()

	item = frappe.get_doc("Item", item_code)
	selling_rate = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate"
	)
	# Same rule as Stock Summary's cost column: a Kharid Daam the shop typed
	# in beats whatever the last purchase document happened to say. The old
	# order had last_purchase_rate first, so one purchase entry silently
	# buried a hand-set CP here while the bulk screen went on reporting the
	# edit as saved.
	purchase_rate = flt(
		frappe.db.get_value("Item Price", {"item_code": item_code, "buying": 1}, "price_list_rate")
	) or flt(item.last_purchase_rate)

	available_qty = None
	actual_qty = None
	reserved_qty = None
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
		reserved_qty = flt(get_pos_reserved_qty(item_code, warehouse))
		available_qty = actual_qty - reserved_qty
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
		"actual_qty": actual_qty,
		"reserved_qty": reserved_qty,
		"reorder_level": reorder_level,
		"stock_status": stock_status,
		"rack_number": item.get("custom_rack_number"),
		"shelf_number": item.get("custom_shelf_number"),
		"bin_location": item.get("custom_bin_location"),
		"barcodes": barcodes,
		"warehouse": warehouse,
		"stock_value": flt(actual_qty) * flt(valuation_rate or purchase_rate) if item.is_stock_item else 0,
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
			pi.docstatus,
			pii.batch_no AS batch_no,
			bt.custom_mrp AS batch_mrp
		FROM `tabPurchase Invoice Item` pii
		INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		LEFT JOIN `tabBatch` bt ON bt.name = pii.batch_no
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
	"""Item groups for the Category tab. The site's default item group (the
	generic bucket new items land in until someone picks a real category) is
	surfaced separately as "Items not in any Category", matching the
	Vyapar reference — everything else the shop actually created is a real
	category row."""
	default_group = (
		frappe.db.get_single_value("Stock Settings", "item_group")
		or ("Products" if frappe.db.exists("Item Group", "Products") else None)
		or "All Item Groups"
	)

	filters = {"is_group": 0, "name": ["!=", default_group]}
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

	uncategorized_count = frappe.db.count("Item", {"item_group": default_group, "disabled": 0})

	return {
		"uncategorized": {"name": default_group, "item_count": uncategorized_count},
		"categories": groups,
	}


@frappe.whitelist()
def get_category_items(item_group: str, search: str = None):
	"""Items inside one category, for the Category tab's right-hand panel."""
	filters = {"item_group": item_group, "disabled": 0}
	or_filters = None
	if search:
		or_filters = {"item_name": ["like", f"%{search}%"], "item_code": ["like", f"%{search}%"]}
	items = frappe.get_all(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=["item_code", "item_name", "is_stock_item", "stock_uom"],
		order_by="item_name asc",
		limit_page_length=0,
	)
	warehouse = default_selling_warehouse()
	for it in items:
		qty = 0
		value = 0
		if it.is_stock_item and warehouse:
			bin_row = frappe.db.get_value(
				"Bin", {"item_code": it.item_code, "warehouse": warehouse}, ["actual_qty", "valuation_rate"], as_dict=True
			)
			if bin_row:
				qty = flt(bin_row.actual_qty)
				value = flt(bin_row.actual_qty) * flt(bin_row.valuation_rate)
		it["quantity"] = qty
		it["stock_value"] = value
	return items


# Curated shortlist for the Items > Units tab (2026-08-14 direct request:
# "units me bas yahi daal" — show only this list, not ERPNext's full
# 200+ entry scientific UOM master). Each shortname is the real UOM
# document's name (what item forms actually pick); the full name is
# display-only, since standard UOM has no separate "full name" field.
SANTU_UOM_WHITELIST = [
	("Bags", "Bag"),
	("Bottles", "Btl"),
	("Box", "Box"),
	("Bundles", "Bdl"),
	("Cans", "Can"),
	("Cartons", "Ctn"),
	("Cubic Meter", "Mtq"),
	("Day", "Day"),
	("Dozens", "Dzn"),
	("Grammes", "Gm"),
	("Hour", "Hur"),
	("Kilograms", "Kg"),
	("Kilometer", "Kmt"),
	("Litre", "Ltr"),
	("Meters", "Mtr"),
	("Mililitre", "Ml"),
	("Numbers", "Nos"),
	("Packs", "Pac"),
	("Pairs", "Prs"),
	("Pieces", "Pcs"),
	("Quintal", "Qtl"),
	("Rolls", "Rol"),
	("Service", "Ser"),
	("Set", "Set"),
	("Square Feet", "Sqf"),
	("Square Meters", "Sqm"),
	("Tablets", "Tbs"),
	("Ton / Metric Ton", "Ton"),
	("Unit", "Unit"),
]


@frappe.whitelist()
def get_uom_list(search: str = None):
	"""Curated Units tab list — see SANTU_UOM_WHITELIST."""
	q = (search or "").strip().lower()
	rows = []
	for full_name, shortname in SANTU_UOM_WHITELIST:
		if q and q not in full_name.lower() and q not in shortname.lower():
			continue
		if not frappe.db.exists("UOM", shortname):
			frappe.get_doc({
				"doctype": "UOM",
				"uom_name": shortname,
				"must_be_whole_number": 0,
			}).insert(ignore_permissions=True)
		rows.append({"name": shortname, "uom_name": full_name, "shortname": shortname})
	return rows


@frappe.whitelist()
def get_uom_conversions(uom: str):
	"""Conversion rows for the selected unit's sub-panel (UOM Conversion Factor)."""
	rows = frappe.get_all(
		"UOM Conversion Factor",
		filters={"from_uom": uom},
		fields=["name", "from_uom", "to_uom", "value"],
		order_by="to_uom asc",
		limit_page_length=0,
	)
	rows += frappe.get_all(
		"UOM Conversion Factor",
		filters={"to_uom": uom},
		fields=["name", "from_uom", "to_uom", "value"],
		order_by="from_uom asc",
		limit_page_length=0,
	)
	return rows


@frappe.whitelist()
def add_uom_conversion(from_uom: str, to_uom: str, value: float):
	"""Add a conversion row from the Units tab's "Add Conversion" dialog."""
	if not (from_uom and to_uom and value):
		frappe.throw(_("From Unit, To Unit and Value are all required."))
	doc = frappe.get_doc({
		"doctype": "UOM Conversion Factor",
		"from_uom": from_uom,
		"to_uom": to_uom,
		"value": flt(value),
	})
	doc.insert(ignore_permissions=True)
	return doc.name


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


def _sale_view_transactions(view, start, end, company, search=None):
	"""Fetch just the transaction rows for one view + date range, with no
	summary/last-month math — the piece shared by the current period and
	the "vs last month" comparison, kept separate so the comparison can't
	recurse into computing its own "last month" (get_sale_dashboard_data
	itself does that, and calling it again from inside would recurse
	forever)."""
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

	return transactions


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

	transactions = _sale_view_transactions(view, start, end, company, search=search)
	transactions.sort(key=lambda r: (r.get("posting_date") or "", r.get("invoice_no") or ""), reverse=True)

	# Summary — view-specific title/total/breakdown, matching what each
	# view actually represents (e.g. Quotations show Converted/Open, not
	# Received/Balance, which only makes sense for real invoices).
	from frappe.utils import add_months, get_first_day, get_last_day, getdate, today

	CONVERTED_STATUS = {
		"quotation": {"Ordered"},
		"sales_order": {"Completed", "Closed"},
	}
	SUMMARY_TITLE = {
		"quotation": "Total Quotations",
		"sales_order": "Total Sales Orders",
		"delivery_challan": "Total Delivery Challans",
		"payment_in": "Total Payment Received",
		"sales_return": "Total Sales Return",
		"proforma": "Total Proforma Amount",
	}

	if view in CONVERTED_STATUS:
		total_sales = sum(flt(r["amount"]) for r in transactions)
		converted = sum(flt(r["amount"]) for r in transactions if r.get("status") in CONVERTED_STATUS[view])
		open_amt = total_sales - converted
		summary = {
			"title": SUMMARY_TITLE.get(view, "Total Sales Amount"),
			"total_sales": total_sales,
			"label1": "Converted",
			"value1": converted,
			"label2": "Open",
			"value2": open_amt,
			"value2_danger": False,
		}
	elif view == "payment_in":
		total_sales = sum(flt(r["amount"]) for r in transactions)
		summary = {
			"title": SUMMARY_TITLE.get(view, "Total Sales Amount"),
			"total_sales": total_sales,
			"label1": None,
			"value1": None,
			"label2": None,
			"value2": None,
			"value2_danger": False,
		}
	elif view == "delivery_challan":
		total_sales = sum(flt(r["amount"]) for r in transactions)
		summary = {
			"title": SUMMARY_TITLE.get(view, "Total Sales Amount"),
			"total_sales": total_sales,
			"label1": "Challans",
			"value1": len(transactions),
			"label2": None,
			"value2": None,
			"value2_danger": False,
		}
	elif view == "proforma":
		# Proforma lists DRAFT invoices, so its total has to come from those
		# same rows. It used to fall through to the branch below and show the
		# submitted-sales figure instead — a number that flatly contradicted
		# the (often empty) list under it (2026-08-15 audit).
		total_sales = sum(flt(r["amount"]) for r in transactions)
		summary = {
			"title": SUMMARY_TITLE.get(view, "Total Proforma Amount"),
			"total_sales": total_sales,
			"label1": "Proformas",
			"value1": len(transactions),
			"label2": None,
			"value2": None,
			"value2_danger": False,
		}
	else:
		# invoices / sales_return / default: real sales, so
		# Received/Balance from POS + non-POS Sales Invoice (no double-count).
		is_return_view = 1 if view == "sales_return" else 0
		sale_rows = _sale_fetch_pos_rows(start, end, company, is_return=is_return_view)
		sale_rows += _sale_fetch_si_rows(start, end, company, is_return=is_return_view)
		gross_sales = sum(flt(r["amount"]) for r in sale_rows)
		received = sum(flt(r["amount"]) - flt(r["balance"]) for r in sale_rows)
		balance = sum(flt(r["balance"]) for r in sale_rows)

		# Returns net out of the headline figure. Without this, Reports showed
		# GROSS sales while the Home screen's Total Sale showed NET — the same
		# period reading 8112 here and 6232 there, with nothing on either
		# screen explaining the gap (2026-08-19 bug report: "home pe total sale
		# 2996 ... report me sale 4876, aisa q"). Goods that came back are not
		# money the shop kept, so net is the honest headline.
		#
		# The returned amount gets its own summary line rather than being
		# silently subtracted: the invoice rows listed under this card are
		# still the non-return ones, so without it the headline would look
		# like it simply didn't add up.
		returns_total = 0.0
		if not is_return_view:
			return_rows = _sale_fetch_pos_rows(start, end, company, is_return=1)
			return_rows += _sale_fetch_si_rows(start, end, company, is_return=1)
			returns_total = sum(flt(r["amount"]) for r in return_rows)

		# Kept as its own name (not inlined into the dict): the "vs last
		# month" comparison further down reads total_sales too.
		total_sales = gross_sales + returns_total
		summary = {
			"title": SUMMARY_TITLE.get(view, "Total Sales Amount"),
			"total_sales": total_sales,
			"label1": "Received",
			"value1": received,
			"label2": "Balance",
			"value2": balance,
			"value2_danger": balance > 0,
			"label3": "Returns" if returns_total else None,
			"value3": abs(returns_total),
		}

	# vs last month (generic: same view logic, previous calendar month)
	today_date = getdate(today())
	last_month_ref = add_months(today_date, -1)
	lm_start, lm_end = get_first_day(last_month_ref), get_last_day(last_month_ref)
	if view in CONVERTED_STATUS or view in ("payment_in", "delivery_challan"):
		lm_transactions = _sale_view_transactions(view, lm_start, lm_end, company)
		last_month_total = sum(flt(r["amount"]) for r in lm_transactions)
	else:
		lm_rows = _sale_fetch_pos_rows(lm_start, lm_end, company, is_return=(1 if view == "sales_return" else 0))
		lm_rows += _sale_fetch_si_rows(lm_start, lm_end, company, is_return=(1 if view == "sales_return" else 0))
		last_month_total = sum(flt(r["amount"]) for r in lm_rows)
	if last_month_total:
		pct_vs_last_month = round((total_sales - last_month_total) / last_month_total * 100, 1)
	else:
		pct_vs_last_month = 100.0 if total_sales else 0.0

	summary["pct_vs_last_month"] = pct_vs_last_month

	companies = frappe.get_all("Company", fields=["name"], order_by="name asc")

	return {
		"period": period,
		"from_date": str(start),
		"to_date": str(end),
		"company": company,
		"view": view,
		"summary": summary,
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
				"party": r.supplier,
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


# Accounts that sit under Expense but exist for the system's own postings
# rather than for anyone to spend money into: Cost of Goods Sold and Stock
# Adjustment are written by stock entries, Round Off / Exchange Gain-Loss by
# the rounding logic. Offering them as a category invites postings that
# quietly corrupt stock valuation, so the Expense screen hides them. The
# Expenses *list* still shows anything already booked to them — see
# _purchase_fetch_expense_rows.
SYSTEM_OWNED_EXPENSE_ACCOUNTS = {
	"Cost of Goods Sold",
	"Stock Adjustment",
	"Round Off",
	"Exchange Gain/Loss",
	"Expenses Included In Valuation",
	"Expenses Included In Asset Valuation",
	"Gain/Loss on Asset Disposal",
	"Impairment",
	"Depreciation",
}


def _spendable_expense_accounts(company=None):
	"""Leaf Expense accounts a person can actually book spending against."""
	filters = {"root_type": "Expense", "is_group": 0, "disabled": 0}
	if company:
		filters["company"] = company
	return [
		a
		for a in frappe.get_all(
			"Account", filters=filters, fields=["name", "account_name"], order_by="account_name asc"
		)
		if a.account_name not in SYSTEM_OWNED_EXPENSE_ACCOUNTS
	]


def _account_label(account):
	"""Account name without the company abbreviation ERPNext appends.

	Nobody at the counter thinks of the rent account as "Office Rent - SH".
	"""
	if not account:
		return "—"
	return frappe.db.get_value("Account", account, "account_name") or account


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
				"expense_account": _account_label(r.paid_to),
				"payment_type": r.mode_of_payment or "—",
				"amount": flt(r.paid_amount),
				"reference": r.reference_no or r.name,
				"transaction": "Expense",
				"balance": 0,
				"status": "Submitted",
			}
		)

	# Journal Entry lines debiting expense accounts. Deliberately NOT
	# narrowed to _spendable_expense_accounts: stock movements post their
	# Cost of Goods Sold / Stock Adjustment entries straight to the GL, not
	# through Journal Entries, so everything caught here is money a person
	# actually entered. Filtering by category would hide real spending that
	# happened to be filed under the wrong head — the create screen is where
	# the wrong head gets prevented, not the list.
	acc_filters = {"root_type": "Expense", "is_group": 0, "disabled": 0}
	if company:
		acc_filters["company"] = company
	all_expense = frappe.get_all(
		"Account", filters=acc_filters, fields=["name", "account_name"]
	)
	expense_accounts = [a.name for a in all_expense]
	account_labels = {a.name: a.account_name for a in all_expense}
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
						# "Office Rent", not "Office Rent - SH" — the same
						# friendly name the Expense screen offers when picking
						# the category in the first place.
						"expense_account": account_labels.get(ja.account, ja.account),
						# "Journal" is the doctype's name, not anything the
						# person at the counter did. They spent cash or they
						# didn't, and a manual entry doesn't record which.
						"payment_type": "—",
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
		# Overall pending across every supplier, not scoped to this date
		# filter — this is the same figure Home used to show as "Total
		# Payable" before it moved here (2026-08-18 direct request), so a
		# selected date range narrowing the bills list below must not narrow
		# this number too.
		total_payable, payable_party_count = _pending_supplier_payments()
		summary = {
			"paid": paid,
			"unpaid": unpaid,
			"total": total,
			"total_payable": total_payable,
			"payable_party_count": payable_party_count,
			"summary_type": "bills",
		}
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
	fiscal_year = frappe.db.get_value(
		"Fiscal Year",
		{"year_start_date": ("<=", today_date), "year_end_date": (">=", today_date)},
		"name",
	)
	return {
		"company": company,
		"from_date": str(get_first_day(today_date)),
		"to_date": str(today_date),
		"fiscal_year": fiscal_year,
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


# The order money actually comes in over this counter, not the alphabet
# (2026-08-16 direct request: "payment mode ye hoga- upi, cash, card, bank
# transfer, cheque, bank draft ... jo jyada use me aaye"). The first entry is
# what every screen pre-selects, so this list decides the default too.
SANTU_PAYMENT_MODE_ORDER = ["UPI", "Cash", "Card", "Bank Transfer", "Cheque", "Bank Draft"]


def sort_payment_modes(modes, configured=None):
	"""Order modes by real-world use, then by whether they are actually wired
	up to an account for this company (an enabled-but-unconfigured mode fails
	at submit), then alphabetically for anything not on the list."""
	configured = configured or set()
	rank = {name.lower(): i for i, name in enumerate(SANTU_PAYMENT_MODE_ORDER)}
	modes.sort(
		key=lambda m: (
			rank.get((m.get("name") or "").strip().lower(), len(rank)),
			(m.get("name") or "") not in configured,
			m.get("name") or "",
		)
	)
	return modes


@frappe.whitelist()
def get_sale_invoice_init():
	"""Defaults for the quick Sale Invoice screen."""
	company = frappe.defaults.get_user_default("Company")
	warehouse = default_selling_warehouse(company)
	price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	payment_modes = frappe.get_all(
		"Mode of Payment",
		filters={"enabled": 1},
		fields=["name", "type"],
		order_by="name asc",
	)
	# Put modes with a real Cash/Bank Account configured for this company
	# first, same fix already applied to the Purchase Invoice screen — a
	# mode can be enabled without ever being wired up, and the default
	# selection should be one that actually works.
	configured = set(
		frappe.get_all("Mode of Payment Account", filters={"company": company}, pluck="parent")
	)
	sort_payment_modes(payment_modes, configured)
	naming_series = frappe.get_meta("Sales Invoice").get_field("naming_series")
	series_options = (naming_series.options or "").split("\n") if naming_series else []
	place_of_supply_field = frappe.db.get_value(
		"Custom Field", {"dt": "Sales Invoice", "fieldname": "place_of_supply"}, "options"
	)
	place_of_supply_options = [o for o in (place_of_supply_field or "").split("\n") if o]
	return {
		"company": company,
		"warehouse": warehouse,
		"selling_price_list": price_list,
		"posting_date": frappe.utils.today(),
		"payment_modes": payment_modes,
		"naming_series_options": series_options,
		"naming_series_default": naming_series.default if naming_series else None,
		"place_of_supply_options": place_of_supply_options,
	}


def party_village(party_type: str, party_name: str, stored_village: str = None) -> str:
	"""Where this party is from, however it happens to be recorded.

	The village lives on the Customer as `santu_village`, but a party created
	through the address flow only ever got an Address row — so the counter
	screens, which read the Customer field, showed "No village on file" next
	to a party with a perfectly good address. Rather than make every screen
	remember both places, resolve it here: the stored village first, then the
	linked address's city.
	"""
	stored = (stored_village or "").strip()
	if stored and not is_district_name(stored):
		return stored
	if not party_type or not party_name:
		return ""

	city = frappe.db.sql(
		"""SELECT a.city FROM `tabAddress` a
		INNER JOIN `tabDynamic Link` dl ON dl.parent = a.name
		WHERE dl.parenttype = 'Address' AND dl.link_doctype = %s AND dl.link_name = %s
		  AND IFNULL(a.city, '') != ''
		ORDER BY a.address_type = 'Billing' DESC, a.modified DESC
		LIMIT 1""",
		(party_type, party_name),
	)
	found = (city[0][0] if city else "") or ""
	return "" if is_district_name(found) else found


@frappe.whitelist()
def get_customer_details_for_sale(customer: str):
	if not customer or not frappe.db.exists("Customer", customer):
		return {}
	cust = frappe.get_doc("Customer", customer)
	address_line = None
	address_line1 = None
	city = None
	pincode = None
	if cust.customer_primary_address:
		addr = frappe.db.get_value(
			"Address",
			cust.customer_primary_address,
			["address_line1", "city", "state", "pincode"],
			as_dict=True,
		)
		if addr:
			address_line1 = addr.address_line1 or ""
			city = addr.city or ""
			pincode = addr.pincode or ""
			address_line = ", ".join(filter(None, [addr.address_line1, addr.city, addr.state, addr.pincode]))

	company = frappe.defaults.get_user_default("Company")
	outstanding = flt(
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
			{"customer": customer},
		)[0][0]
	)

	credit_limit = 0
	if cust.credit_limits:
		row = next((r for r in cust.credit_limits if r.company == company), None)
		if not row and len(cust.credit_limits) == 1 and not cust.credit_limits[0].company:
			row = cust.credit_limits[0]
		if row:
			credit_limit = flt(row.credit_limit)

	village = party_village("Customer", cust.name, cust.get("santu_village"))

	# Parties created before this chain existed have the DISTRICT sitting in
	# Address.city ("Saran" on everyone). Report that as the district and hand
	# back a blank village, so the Village box asks to be filled in instead of
	# showing a district that was never anybody's village.
	district = _district_for_pincode(pincode)
	if is_district_name(city):
		district = district or city
		city = ""

	# Most parties are created with a village and no Address record at all, so
	# the pincode read off the Address above is blank for them and the sale
	# screen's Pincode box stayed empty even though the village was known
	# (2026-08-16 bug report: "phone no dalne pe pin code nh aa raha"). The
	# village dataset already pairs the two — look it up rather than making
	# someone type a pincode the system can work out. Same for the district.
	# Older records typed the village into the address line instead of the
	# village field. Recover it only on an exact match against the village
	# list — close-but-not-equal text ("Ishuapur gaw" vs "Ishuwapur") is left
	# alone deliberately, since guessing would write a village nobody chose.
	if not village and not city and address_line1 and _village_lookup(address_line1):
		village = _village_lookup(address_line1)["village"]

	if village and not pincode:
		found = _village_lookup(village)
		if found:
			pincode = found.get("pincode") or pincode
			district = district or found.get("district") or ""

	return {
		"name": cust.name,
		"customer_name": cust.customer_name,
		"mobile_no": cust.mobile_no,
		"village": village,
		"district": district,
		"address": address_line,
		"address_line1": address_line1,
		# Raw fields off the Address record itself (not the santu_village
		# fallback "village" above), so the inline quick-edit on the Sale
		# screen can tell "nothing typed yet" from "this is what's on file".
		"city": city,
		"pincode": pincode,
		"note": cust.get("customer_details") or "",
		"outstanding_amount": outstanding,
		"credit_limit": credit_limit,
	}


@frappe.whitelist()
def get_sale_item_row(customer: str, item_code: str, warehouse: str = None, qty: float = 1):
	"""Fetch ERPNext item row details for Sales Invoice."""
	from erpnext.stock.get_item_details import get_item_details

	company = frappe.defaults.get_user_default("Company")
	if not warehouse:
		warehouse = default_selling_warehouse(company)
	price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	args = frappe._dict(
		{
			"doctype": "Sales Invoice",
			"item_code": item_code,
			"customer": customer,
			"warehouse": warehouse,
			"qty": flt(qty) or 1,
			"company": company,
			"conversion_rate": 1,
			"price_list": price_list,
			"selling_price_list": price_list,
			"plc_conversion_rate": 1,
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

	# Customer prices here are inclusive of tax and strip_gst_line_items
	# clears every tax row off Sales/POS Invoices before they save, so a
	# sale genuinely carries no separate GST. Showing the item's notional
	# rate in this column would promise a tax line that never appears on
	# the bill or in the total.
	row["tax_rate"] = 0
	if not flt(row.get("rate")) and flt(row.get("price_list_rate")):
		row["rate"] = row["price_list_rate"]
		row["amount"] = flt(row.get("qty") or qty) * flt(row["rate"])

	# Every unit this item can be sold in, with what one of them is worth in
	# stock units. The counter sells the same glue by the piece and by the box;
	# without this the Sale screen's UNIT dropdown had exactly one entry and
	# could not be changed at all (2026-08-17 request). Rate and stock are
	# scaled by the factor on the client, so a Box never goes out at piece
	# price.
	row["uoms"] = item_uoms(item_code)

	# Batch-tracked items cannot be sold without naming a batch — ERPNext
	# rejects the invoice outright. Telling the screen up front is what lets
	# Billing ask for one instead of failing at save (2026-08-18). Items that
	# aren't batch-tracked are completely unaffected: has_batch_no is 0 and
	# `batches` stays empty, so the existing flow is untouched.
	row["has_batch_no"] = cint(frappe.db.get_value("Item", item_code, "has_batch_no"))
	row["batches"] = item_batches(item_code, warehouse) if row["has_batch_no"] else []
	return row


@frappe.whitelist()
def item_batches(item_code: str, warehouse: str = None):
	"""Batches of this item that still have stock, newest first.

	Each carries what the counter needs to choose between them — how many
	are left, what this batch's MRP is, and what it should sell for. The
	selling rate is the batch's own Item Price row when it has one, else
	the item's normal price; the batch's price is never silently ignored
	(2026-08-18 spec: "Do not silently use the wrong batch price").
	"""
	company = frappe.defaults.get_user_default("Company")
	if not warehouse:
		warehouse = default_selling_warehouse(company)

	# ERPNext v15 keeps batch quantities in Serial and Batch Bundle, NOT in
	# Stock Ledger Entry.batch_no (which stays NULL) — reading the ledger
	# directly returned nothing at all even with stock clearly in the batch
	# (found 2026-08-18 in testing). get_batch_qty is ERPNext's own helper
	# and handles both storage models, so it stays correct across versions.
	from erpnext.stock.doctype.batch.batch import get_batch_qty

	batch_names = frappe.get_all("Batch", filters={"item": item_code, "disabled": 0}, pluck="name")
	rows = []
	for name in batch_names:
		qty = flt(get_batch_qty(batch_no=name, warehouse=warehouse, item_code=item_code))
		if qty > 0:
			rows.append(frappe._dict({"batch_no": name, "qty": qty}))
	if not rows:
		return []

	default_rate = flt(
		frappe.db.get_value(
			"Item Price",
			{"item_code": item_code, "selling": 1, "batch_no": ["in", ["", None]]},
			"price_list_rate",
		)
	)

	out = []
	for r in rows:
		batch = frappe.db.get_value(
			"Batch",
			r.batch_no,
			["name", "expiry_date", "custom_mrp", "custom_purchase_rate", "creation"],
			as_dict=True,
		)
		if not batch:
			continue
		batch_rate = flt(
			frappe.db.get_value(
				"Item Price", {"item_code": item_code, "selling": 1, "batch_no": r.batch_no}, "price_list_rate"
			)
		)
		out.append(
			{
				"batch_no": r.batch_no,
				"qty": flt(r.qty),
				"mrp": flt(batch.custom_mrp),
				"purchase_rate": flt(batch.custom_purchase_rate),
				"rate": batch_rate or default_rate,
				"has_own_rate": bool(batch_rate),
				"expiry_date": str(batch.expiry_date) if batch.expiry_date else None,
				"creation": str(batch.creation),
			}
		)
	out.sort(key=lambda b: b["creation"], reverse=True)
	return out


@frappe.whitelist()
def item_uoms(item_code: str):
	"""[{uom, conversion_factor}] for an item — its stock UOM always first."""
	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	rows = frappe.get_all(
		"UOM Conversion Detail",
		filters={"parent": item_code, "parenttype": "Item"},
		fields=["uom", "conversion_factor"],
	)
	out, seen = [], set()
	if stock_uom:
		out.append({"uom": stock_uom, "conversion_factor": 1})
		seen.add(stock_uom)
	for r in rows:
		factor = flt(r.conversion_factor) or 1
		if r.uom in seen:
			continue
		seen.add(r.uom)
		out.append({"uom": r.uom, "conversion_factor": factor})
	return out


def _applicable_purchase_tax_template(supplier, company):
	"""The GST template a purchase from this supplier would actually use.

	Unregistered suppliers charge no GST, so there is no template at all.
	Otherwise it is in-state (CGST+SGST) or out-of-state (IGST) depending on
	whether the supplier sits in the same state as the shop.
	"""
	gst_category = frappe.db.get_value("Supplier", supplier, "gst_category")
	if gst_category in (None, "", "Unregistered"):
		return None

	abbr = frappe.db.get_value("Company", company, "abbr")
	supplier_gstin = frappe.db.get_value("Supplier", supplier, "gstin") or ""
	company_gstin = frappe.db.get_value("Company", company, "gstin") or ""
	# The first two digits of a GSTIN are the state code — same code means
	# the sale happened inside one state, which is what splits GST into
	# CGST+SGST rather than a single IGST line.
	in_state = bool(supplier_gstin and company_gstin and supplier_gstin[:2] == company_gstin[:2])
	name = f"Input GST {'In' if in_state else 'Out'}-state - {abbr}"
	return name if frappe.db.exists("Purchase Taxes and Charges Template", name) else None


def _purchase_tax_template_for_state(company, place_of_supply):
	"""In-state vs out-of-state template decided by place of supply alone.

	Used when the operator explicitly chose a GST slab on the screen but the
	supplier has no GSTIN to compare states with. `place_of_supply` looks like
	"10-Bihar", whose leading digits are the same state code a GSTIN starts with.
	"""
	abbr = frappe.db.get_value("Company", company, "abbr")
	company_gstin = frappe.db.get_value("Company", company, "gstin") or ""
	pos_code = (place_of_supply or "").split("-")[0].strip()
	in_state = bool(company_gstin and pos_code and company_gstin[:2] == pos_code)
	name = f"Input GST {'In' if in_state else 'Out'}-state - {abbr}"
	return name if frappe.db.exists("Purchase Taxes and Charges Template", name) else None


def _purchase_item_tax_rate(item_tax_rate, supplier, company):
	"""Percentage this item is actually taxed at on a purchase from this supplier.

	`item_tax_rate` from get_item_details lists every GST account the item's
	tax template touches — Output and Input, CGST/SGST and IGST, plus RCM and
	Refund variants. Summing all of them (which this used to do) returns 36%
	for an ordinary 18% item, and would have doubled the tax shown on screen
	the moment items were given tax templates. Only the accounts on the
	template that will really be applied count.
	"""
	try:
		tax_map = frappe.parse_json(item_tax_rate or "{}")
	except Exception:
		return 0
	if not tax_map:
		return 0

	template = _applicable_purchase_tax_template(supplier, company)
	if not template:
		return 0
	accounts = {
		r.account_head
		for r in frappe.get_doc("Purchase Taxes and Charges Template", template).taxes
	}
	return flt(sum(flt(v) for k, v in tax_map.items() if k in accounts))


@frappe.whitelist()
def get_recent_sale_items(limit: int = 12):
	"""Most recently billed items (across Sales + POS Invoice), for the
	quick-sale screen's "Recent Items" panel shown when no search is
	active — distinct items, most recent first."""
	rows = frappe.db.sql(
		"""
		select item_code, max(t.created) as last_sold from (
			select sii.item_code as item_code, si.creation as created
			from `tabSales Invoice Item` sii
			inner join `tabSales Invoice` si on si.name = sii.parent
			where si.docstatus = 1
			union all
			select pii.item_code as item_code, pi.creation as created
			from `tabPOS Invoice Item` pii
			inner join `tabPOS Invoice` pi on pi.name = pii.parent
			where pi.docstatus = 1
		) t
		group by item_code
		order by last_sold desc
		limit %(limit)s
		""",
		{"limit": cint(limit)},
		as_dict=True,
	)
	if not rows:
		return []
	item_codes = [r.item_code for r in rows]
	items = {
		i.name: i
		for i in frappe.get_all(
			"Item",
			filters={"item_code": ["in", item_codes], "disabled": 0},
			fields=["name", "item_name", "stock_uom", "brand"],
		)
	}
	out = []
	for r in rows:
		item = items.get(r.item_code)
		if not item:
			continue
		price = frappe.db.get_value("Item Price", {"item_code": r.item_code, "selling": 1}, "price_list_rate")
		out.append({
			"item_code": r.item_code,
			"item_name": item.item_name,
			"stock_uom": item.stock_uom,
			"brand": item.brand,
			"price": price,
		})
	return out


@frappe.whitelist()
def save_sale_invoice(invoice_json: str, submit: int = 0):
	"""Create (and optionally submit) a real Sales Invoice from the quick-sale UI.

	Retried on deadlock. Submitting an invoice writes the naming series counter,
	the customer's ledger and the Bin row for each item; two sales going through
	at the same moment grab those in different orders and MariaDB kills one of
	them. Frappe turns that into "Server failed to process this request because
	of a concurrent conflicting request" and gives up — but a deadlock is
	transient by definition: the other transaction has already gone through, so
	simply doing it again works. Without this the counter sees a scary error and
	has to re-key the whole bill, which is exactly when someone bills twice.
	This is the multi-device case (the shop uses a phone and this Mac); the
	client-side guard stops the double-click case on its own.
	"""
	last_error = None
	for attempt in range(3):
		try:
			return _save_sale_invoice(invoice_json, submit)
		except frappe.QueryDeadlockError as exc:
			last_error = exc
			frappe.db.rollback()
			if attempt < 2:
				time.sleep(0.25 * (attempt + 1))
	raise last_error


WALKIN_CUSTOMER_NAME = "Walk-in Customer"


def _ensure_walkin_customer() -> str:
	"""The counter's anonymous-sale party, recreated if it has gone missing.

	Returns the real docname, which is not always the customer_name: with
	Selling Settings.cust_master_name on a naming series the party is named
	CUST-0001, and checking existence by the literal label would then insert
	a fresh duplicate on every single bill.
	"""
	existing = frappe.db.get_value("Customer", {"customer_name": WALKIN_CUSTOMER_NAME}, "name")
	if existing:
		return existing
	doc = frappe.new_doc("Customer")
	doc.customer_name = WALKIN_CUSTOMER_NAME
	doc.customer_type = "Individual"
	doc.customer_group = frappe.db.get_value("Customer Group", {}, "name") or "All Customer Groups"
	doc.territory = frappe.db.get_value("Territory", {}, "name") or "All Territories"
	doc.insert(ignore_permissions=True)
	return doc.name


def _save_sale_invoice(invoice_json: str, submit: int = 0):
	import json

	data = json.loads(invoice_json) if isinstance(invoice_json, str) else invoice_json
	customer = data.get("customer")
	items = data.get("items") or []
	payments = data.get("payments") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	# The default party every screen falls back to for an anonymous cash
	# sale must actually exist. A wipe, a restore, or a fresh install can
	# leave that name with no Customer behind it, and ERPNext's own
	# set_missing_values() then dies on `customer.payment_terms` with
	# AttributeError: 'NoneType' — a raw 500 on the single most common
	# action in the shop (found 2026-08-18 in testing, after the data reset
	# wiped every Customer). Handled here rather than in one screen so
	# Billing, Sale Invoice and anything added later are all covered.
	if not frappe.db.exists("Customer", customer):
		if customer == WALKIN_CUSTOMER_NAME:
			customer = _ensure_walkin_customer()
		else:
			frappe.throw(_("Customer {0} not found.").format(customer))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	warehouse = data.get("warehouse") or default_selling_warehouse(company)

	payment_mode = (data.get("payment_mode") or "credit").lower()

	doc = frappe.new_doc("Sales Invoice")
	# A default POS Profile auto-attaches itself the moment is_pos=1 and
	# set_missing_values() runs (see set_pos_fields in ERPNext core) — and
	# once attached, update_multi_mode_option() *replaces* whatever this
	# screen appended to `payments` with the POS Profile's OWN configured
	# payment methods, throwing "Missing Account" for any of THOSE that
	# aren't set up, regardless of which mode_of_payment was actually
	# picked here (confirmed live 2026-08-15: failed on "Bank Draft" even
	# though "Cash" was selected). This screen builds its own payments
	# from scratch every time, so no POS Profile should ever be involved.
	doc.flags.ignore_pos_profile = True
	doc.customer = customer
	doc.company = company
	doc.posting_date = data.get("posting_date") or frappe.utils.today()
	# Without this flag ERPNext's validate_posting_time() silently rewrites
	# posting_date back to TODAY (transaction_base.py) — so a backdated bill
	# quietly re-dated itself, and worse, due_date stayed derived from the
	# date the operator actually picked, landing BEFORE the reset posting
	# date and throwing "Due Date cannot be before Posting Date" mid-sale
	# (2026-08-19 bug report).
	doc.set_posting_time = 1
	doc.due_date = data.get("due_date") or frappe.utils.add_days(doc.posting_date, 2)
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	doc.update_stock = 1
	doc.set_warehouse = warehouse
	if data.get("naming_series"):
		doc.naming_series = data.get("naming_series")
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	if data.get("terms"):
		doc.tc_name = None
		doc.terms = data.get("terms")
	if data.get("description"):
		doc.remarks = data.get("description")

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		# Per-line discount, folded into the rate rather than passed through.
		# Both screens show a line discount and send `rate` alongside
		# `discount_percentage`/`discount_amount`, but ERPNext rebuilds the
		# line from `rate` alone and throws the sent discounts away — it even
		# overwrites discount_amount with (price_list_rate - rate). Verified
		# live 2026-08-18: a 5 x Rs.70 line with Rs.50 off billed the full
		# Rs.350, so the customer was charged the discount back. Folding it in
		# here keeps the one number the operator actually saw on the screen,
		# and fixes Billing and Sale Invoice in one place.
		gross = qty * rate
		line_discount = gross * (flt(row.get("discount_percentage")) / 100.0) + flt(
			row.get("discount_amount")
		)
		net_line = max(gross - line_discount, 0.0)
		effective_rate = (net_line / qty) if qty else 0.0

		item_row = {
			"item_code": row.get("item_code"),
			"qty": qty,
			"rate": effective_rate,
			"warehouse": row.get("warehouse") or warehouse,
			"uom": row.get("uom"),
			# Without this a Box sells as one stock unit: ERPNext would take a
			# single piece off the shelf and price it as a piece.
			"conversion_factor": flt(row.get("conversion_factor")) or 1,
		}
		# Only set when the screen actually picked a batch — an empty value
		# on a non-batch item would be a change in behaviour for every
		# existing sale (2026-08-18).
		if row.get("batch_no"):
			item_row["batch_no"] = row.get("batch_no")

		# A line discounted all the way to zero can't be sent as rate 0:
		# ERPNext treats an empty rate as "not priced yet" and refetches the
		# catalogue rate on every recalculation, so giving something away
		# billed it at full MRP instead (verified live 2026-08-18). It does
		# honour discount_percentage == 100 on every recalculation, so that
		# is the one way to say "free" and have it stick.
		if net_line <= 0 and gross > 0:
			item_row["price_list_rate"] = rate
			item_row["discount_percentage"] = 100
		doc.append("items", item_row)

	# Invoice-level ("whole bill") discount, on top of any per-item discount
	# already applied above — ERPNext's own apply_discount_on/discount_amount
	# fields, not a custom calculation.
	invoice_discount = flt(data.get("additional_discount_amount"))
	if invoice_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = invoice_discount

	# Reward points redemption switched off for now (2026-08-18 direct
	# request: "loyalty points ko abhi ke liye commentout kr do harek jagah
	# se" — how it should work isn't decided yet). Both screens already send
	# redeem_points: 0, so this is belt-and-suspenders; left commented
	# rather than deleted so turning it back on is one block, not a rebuild.
	# redeem_value = flt(data.get("redeem_points"))
	applied_redeem = 0.0
	# if redeem_value > 0:
	# 	program = frappe.db.get_value("Customer", customer, "loyalty_program")
	# 	if program:
	# 		lp = frappe.db.get_value(
	# 			"Loyalty Program",
	# 			program,
	# 			["conversion_factor", "expense_account", "cost_center"],
	# 			as_dict=True,
	# 		)
	# 		if not lp.expense_account:
	# 			frappe.throw(
	# 				_("The rewards scheme has no expense account set, so points cannot be used yet.")
	# 			)
	# 		doc.loyalty_program = program
	# 		doc.redeem_loyalty_points = 1
	# 		doc.loyalty_points = cint(redeem_value / (flt(lp.conversion_factor) or 1))
	# 		doc.loyalty_redemption_account = lp.expense_account
	# 		doc.loyalty_redemption_cost_center = lp.cost_center
	# 		applied_redeem = flt(doc.loyalty_points) * (flt(lp.conversion_factor) or 1)

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	# Cash sale: mark as POS so the payment is recorded against the chosen
	# Mode of Payment's real ledger account on submit (standard ERPNext
	# Sales Invoice + Payments flow) — outstanding_amount becomes 0.
	# Credit sale: leave as a normal invoice, nothing paid yet, due_date
	# stands — this *is* "the customer owes the amount", no separate flag
	# needed since that's just what an unpaid Sales Invoice already means.
	if payment_mode == "cash":
		doc.is_pos = 1

		def _payment_account(mode_of_payment):
			# Same fallback already proven for Purchase Invoice's
			# cash_bank_account: a Mode of Payment can be enabled without
			# ever having its account configured for this company — fall
			# back to the company's own default cash account instead of
			# leaving `account` blank (which breaks GL posting on submit).
			account = frappe.db.get_value(
				"Mode of Payment Account", {"parent": mode_of_payment, "company": company}, "default_account"
			) or frappe.db.get_value("Company", company, "default_cash_account")
			if not account:
				frappe.throw(
					_("{0} has no Cash/Bank Account configured for {1}. Set one on the Mode of Payment, or choose a different one.").format(
						mode_of_payment, company
					)
				)
			return account

		added_payment = False
		for p in payments:
			# amount omitted/null from the quick-sale UI means "the full
			# grand total, whatever that resolves to server-side" — the
			# UI doesn't try to duplicate ERPNext's own tax/discount math
			# just to pre-fill this number.
			amt = flt(p.get("amount")) if p.get("amount") not in (None, "") else doc.grand_total
			if amt > 0:
				doc.append("payments", {
					"mode_of_payment": p.get("mode_of_payment"),
					"amount": amt,
					"account": _payment_account(p.get("mode_of_payment")),
				})
				added_payment = True
		if not added_payment and doc.grand_total:
			default_mode = (payments[0].get("mode_of_payment") if payments else None) or frappe.db.get_value(
				"Mode of Payment", {"enabled": 1}, "name"
			)
			if default_mode:
				doc.append("payments", {
					"mode_of_payment": default_mode,
					"amount": doc.grand_total,
					"account": _payment_account(default_mode),
				})
	elif payments:
		for p in payments:
			amt = flt(p.get("amount"))
			if amt > 0:
				doc.append("payments", {"mode_of_payment": p.get("mode_of_payment"), "amount": amt})

	# Redeemed points settle part of the bill just like a payment does, so
	# they must count here — otherwise a fully-paid cash sale that used
	# points looks like credit and trips the credit-limit check.
	would_be_outstanding = (
		flt(doc.grand_total) - applied_redeem - sum(flt(p.amount) for p in doc.payments)
	)
	if would_be_outstanding > 0:
		_validate_credit_customer(customer, would_be_outstanding)

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"outstanding_amount": doc.outstanding_amount,
	}


# ---------------------------------------------------------------------------
# Quick Purchase Invoice screen (2026-08-15 direct request: reuse the exact
# same UI/UX as the quick Sale Invoice screen for Purchase Bills and for
# Proforma Invoice, instead of falling back to ERPNext's native New
# Purchase/Sales Invoice form). Mirrors the Sale Invoice API functions above
# 1:1 — Customer -> Supplier, selling price list -> buying price list.
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_purchase_invoice_init():
	"""Defaults for the quick Purchase Invoice screen."""
	company = frappe.defaults.get_user_default("Company")
	warehouse = default_selling_warehouse(company)
	price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	payment_modes = frappe.get_all(
		"Mode of Payment",
		filters={"enabled": 1},
		fields=["name", "type"],
		order_by="name asc",
	)
	# Cash-mode purchases need a real Cash/Bank Account configured for this
	# company on the chosen Mode of Payment — put configured ones first so
	# the screen's default selection is actually usable, instead of
	# whichever mode happens to sort first alphabetically.
	configured = set(
		frappe.get_all(
			"Mode of Payment Account", filters={"company": company}, pluck="parent"
		)
	)
	# Same real-world ordering as the selling side.
	sort_payment_modes(payment_modes, configured)
	naming_series = frappe.get_meta("Purchase Invoice").get_field("naming_series")
	series_options = (naming_series.options or "").split("\n") if naming_series else []
	place_of_supply_field = frappe.db.get_value(
		"Custom Field", {"dt": "Purchase Invoice", "fieldname": "place_of_supply"}, "options"
	)
	place_of_supply_options = [o for o in (place_of_supply_field or "").split("\n") if o]
	return {
		"company": company,
		"warehouse": warehouse,
		"buying_price_list": price_list,
		"posting_date": frappe.utils.today(),
		"payment_modes": payment_modes,
		"naming_series_options": series_options,
		"naming_series_default": naming_series.default if naming_series else None,
		"place_of_supply_options": place_of_supply_options,
	}


@frappe.whitelist()
def search_suppliers_by_name(query: str):
	"""Live suggestions for the "Who's this purchase from?" Name field —
	mirrors search_customers_by_name for Supplier."""
	if not query or len(query) < 2:
		return []
	return frappe.get_all(
		"Supplier",
		filters={"supplier_name": ["like", f"%{query}%"]},
		fields=["name", "supplier_name", "mobile_no", "supplier_details"],
		order_by="modified desc",
		limit_page_length=8,
	)


@frappe.whitelist()
def get_supplier_details_for_purchase(supplier: str):
	if not supplier or not frappe.db.exists("Supplier", supplier):
		return {}
	sup = frappe.get_doc("Supplier", supplier)
	address_line = None
	address_line1 = None
	if sup.supplier_primary_address:
		addr = frappe.db.get_value(
			"Address",
			sup.supplier_primary_address,
			["address_line1", "city", "state", "pincode"],
			as_dict=True,
		)
		if addr:
			address_line1 = addr.address_line1 or ""
			address_line = ", ".join(filter(None, [addr.address_line1, addr.city, addr.state, addr.pincode]))

	outstanding = flt(
		frappe.db.sql(
			"select sum(outstanding_amount) from `tabPurchase Invoice` where supplier = %(supplier)s and docstatus = 1",
			{"supplier": supplier},
		)[0][0]
	)

	return {
		"name": sup.name,
		"supplier_name": sup.supplier_name,
		"mobile_no": sup.mobile_no,
		"address": address_line,
		"address_line1": address_line1,
		"outstanding_amount": outstanding,
	}


@frappe.whitelist()
def update_supplier_note(supplier: str, note: str):
	"""Set the identification note (Supplier Details) — mirrors
	update_customer_note."""
	if not supplier or not frappe.db.exists("Supplier", supplier):
		frappe.throw(_("Supplier {0} not found").format(supplier or ""))
	frappe.db.set_value("Supplier", supplier, "supplier_details", note or "")
	return note or ""


@frappe.whitelist()
def create_supplier_full(party: str):
	"""Full "Add Party" dialog for the Purchase Invoice screen — mirrors
	create_customer_full. Supplier's mobile_no/email_id are Read Only
	fields fetched from a linked Contact (unlike Customer, where they're
	direct fields) — so phone/email here go through a real Contact
	document instead of being set straight on the Supplier."""
	data = frappe.parse_json(party) if isinstance(party, str) else party
	supplier_name = (data.get("customer_name") or "").strip()
	if not supplier_name:
		frappe.throw(_("Party Name is required."))

	supplier = frappe.new_doc("Supplier")
	supplier.supplier_name = supplier_name
	supplier.supplier_group = frappe.db.get_value("Supplier Group", {}, "name") or "All Supplier Groups"
	supplier.supplier_type = "Company"
	if data.get("gstin"):
		supplier.gstin = data.get("gstin")
	if data.get("gst_category"):
		supplier.gst_category = data.get("gst_category")
	supplier.insert(ignore_permissions=True)

	if data.get("phone") or data.get("email"):
		contact = frappe.new_doc("Contact")
		contact.first_name = supplier_name
		if data.get("phone"):
			contact.append("phone_nos", {"phone": data.get("phone"), "is_primary_mobile_no": 1})
		if data.get("email"):
			contact.append("email_ids", {"email_id": data.get("email"), "is_primary": 1})
		contact.append("links", {"link_doctype": "Supplier", "link_name": supplier.name})
		contact.insert(ignore_permissions=True)
		supplier.supplier_primary_contact = contact.name
		supplier.save(ignore_permissions=True)

	# Only a real address field counts. state/country are sent as defaults by
	# callers even when no address was typed, and including them here used to
	# conjure an Address whose line1 was just the customer's name.
	address_fields = ("address_line1", "address_line2", "city", "pincode", "district")
	if any((data.get(f) or "").strip() for f in address_fields):
		city = (data.get("city") or "").strip()
		pincode = data.get("pincode")
		city_match = re.match(r"^(.*)\s-\s(\d{6})$", city)
		if city_match:
			city = city_match.group(1)
			pincode = pincode or city_match.group(2)

		# Same village -> pincode -> district chain the customer side uses.
		if city and not pincode:
			pincode = (_village_lookup(city) or {}).get("pincode")
		district = (data.get("district") or "").strip() or _district_for_pincode(pincode)

		address = frappe.new_doc("Address")
		address.address_title = supplier_name
		address.address_type = "Billing"
		address.address_line1 = data.get("address_line1") or supplier_name
		address.address_line2 = data.get("address_line2") or (f"{district} District" if district else None)
		# City is mandatory on Address and holds the village here; the district
		# derived from the pincode is the fallback. No hardcoded home district.
		address.city = city or district or (data.get("address_line1") or supplier_name)
		address.state = data.get("state") or "Bihar"
		address.pincode = pincode
		address.country = data.get("country") or "India"
		address.append("links", {"link_doctype": "Supplier", "link_name": supplier.name})
		address.insert(ignore_permissions=True)
		supplier.supplier_primary_address = address.name
		supplier.save(ignore_permissions=True)

	if (data.get("shipping_address") or "").strip():
		ship = frappe.new_doc("Address")
		ship.address_title = supplier_name
		ship.address_type = "Shipping"
		ship.address_line1 = data.get("shipping_address").strip()
		ship.city = (
			(data.get("city") or "").strip()
			or (data.get("district") or "").strip()
			or _district_for_pincode(data.get("pincode"))
			or data.get("shipping_address").strip()
		)
		ship.state = data.get("state")
		ship.country = data.get("country") or "India"
		ship.append("links", {"link_doctype": "Supplier", "link_name": supplier.name})
		ship.insert(ignore_permissions=True)

	return supplier.name


@frappe.whitelist()
def get_purchase_item_row(
	supplier: str = None, item_code: str = None, warehouse: str = None, qty: float = 1, uom: str = None
):
	"""Fetch ERPNext item row details for Purchase Invoice — mirrors
	get_sale_item_row."""
	from erpnext.stock.get_item_details import get_item_details

	company = frappe.defaults.get_user_default("Company")
	if not warehouse:
		warehouse = default_selling_warehouse(company)
	price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	args = frappe._dict(
		{
			"doctype": "Purchase Invoice",
			"item_code": item_code,
			"supplier": supplier,
			"warehouse": warehouse,
			"qty": flt(qty) or 1,
			"company": company,
			"conversion_rate": 1,
			"price_list": price_list,
			"buying_price_list": price_list,
			"plc_conversion_rate": 1,
			"transaction_type": "buying",
			"is_subcontracted": 0,
		}
	)
	# Asking for a specific UOM (e.g. "Box") makes get_item_details compute
	# its real conversion_factor — without this it silently defaults to the
	# item's plain stock_uom, and a bill line read as "3 Box" would land as
	# 3 loose pieces instead of the 3 cartons' worth it actually was
	# (2026-08-17: "200ml ka 24 pcs, same for all").
	if uom:
		args.uom = uom
	row = get_item_details(args)
	available_qty = None
	if warehouse:
		available_qty = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
		)
	row["available_qty"] = available_qty

	row["tax_rate"] = _purchase_item_tax_rate(row.get("item_tax_rate"), supplier, company)
	# The item's own current GST slab, if it has one — the row's tax
	# dropdown starts here rather than blank (2026-08-18: "harek item me tax
	# daalne ka option de de").
	row["item_tax_template"] = frappe.db.get_value("Item Tax", {"parent": item_code}, "item_tax_template")
	# Whether this item can be scanned at all — the thing worth surfacing
	# right on the row, since an item read off a PDF bill (or picked from
	# search) very often has no barcode yet (2026-08-17 direct request:
	# "harek item pe barcode scanner hoga, jaha pehle se added na ho... to
	# barcode se v add kr le").
	row["barcode"] = frappe.db.get_value("Item Barcode", {"parent": item_code}, "barcode")
	# Every unit this item can legally be bought in — usually just its
	# stock_uom, plus "Box" (or whatever else) when a pack conversion has
	# been set up for it. Lets the row's UOM dropdown actually offer Box
	# instead of only ever showing the piece unit.
	other_uoms = frappe.get_all("UOM Conversion Detail", filters={"parent": item_code}, pluck="uom")
	row["uom_options"] = [row.get("stock_uom")] + [u for u in other_uoms if u != row.get("stock_uom")]
	return row


@frappe.whitelist()
def get_purchase_tax_options():
	"""Every GST slab this shop's Item Tax Templates already cover — the
	dropdown both the per-row tax picker and the invoice-wide default use
	(2026-08-18: "top pe default tax ka v option de do jitna v tax bracket
	h"). Reuses india_compliance's own templates rather than inventing a
	parallel rate list, so choosing one here computes CGST/SGST/IGST the
	same correct way any other GST-aware screen in this app already does.
	"""
	company = frappe.defaults.get_user_default("Company")
	abbr = frappe.get_cached_value("Company", company, "abbr") if company else None
	templates = frappe.get_all(
		"Item Tax Template", filters={"company": company} if company else {}, pluck="name"
	)
	# 0% has three real GST meanings (genuinely outside GST, taxed at 0%,
	# or exempted) — kept as separate, correctly-labelled choices rather
	# than collapsed into one "0%" that would pick the wrong one for a GST
	# return.
	order = {
		"Non-GST": 0,
		"Nil-Rated": 1,
		"Exempted": 2,
		"GST 5%": 5,
		"GST 12%": 12,
		"GST 18%": 18,
		"GST 28%": 28,
	}
	options = []
	for name in templates:
		label = name[: -len(f" - {abbr}")] if abbr and name.endswith(f" - {abbr}") else name
		options.append({"value": name, "label": label, "_order": order.get(label, 99)})
	options.sort(key=lambda o: o["_order"])
	for o in options:
		o.pop("_order")
	return options


@frappe.whitelist()
def add_item_uom_conversion(item_code: str, uom: str, conversion_factor: float):
	"""Give an item one more purchasable unit beyond stock_uom (and any
	pack Box) — the Purchase screen's '+ Naya Unit' (2026-08-18 direct
	request: "unit ka v multiple options do"). A shopkeeper buying this
	item in Dozens or Sacks or whatever their supplier calls it shouldn't
	be stuck choosing between only two options that don't match the bill.
	"""
	uom = (uom or "").strip()
	if not uom:
		frappe.throw(_("Unit ka naam chahiye."))
	conversion_factor = flt(conversion_factor)
	if conversion_factor <= 0:
		frappe.throw(_("Conversion sahi number honi chahiye (0 se zyada)."))
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} nahi mila.").format(item_code or ""))

	if not frappe.db.exists("UOM", uom):
		frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)

	existing = frappe.db.exists("UOM Conversion Detail", {"parent": item_code, "uom": uom})
	if existing:
		frappe.db.set_value("UOM Conversion Detail", existing, "conversion_factor", conversion_factor)
	else:
		item = frappe.get_doc("Item", item_code)
		item.append("uoms", {"uom": uom, "conversion_factor": conversion_factor})
		item.save(ignore_permissions=True)

	return {"ok": True, "uom": uom}


@frappe.whitelist()
def get_recent_purchase_items(limit: int = 12):
	"""Most recently purchased items, for the quick-purchase screen's
	"Recent Items" panel — mirrors get_recent_sale_items."""
	rows = frappe.db.sql(
		"""
		select pii.item_code as item_code, max(pi.creation) as last_bought
		from `tabPurchase Invoice Item` pii
		inner join `tabPurchase Invoice` pi on pi.name = pii.parent
		where pi.docstatus = 1
		group by pii.item_code
		order by last_bought desc
		limit %(limit)s
		""",
		{"limit": cint(limit)},
		as_dict=True,
	)
	if not rows:
		return []
	item_codes = [r.item_code for r in rows]
	items = {
		i.name: i
		for i in frappe.get_all(
			"Item",
			filters={"item_code": ["in", item_codes], "disabled": 0},
			fields=["name", "item_name", "stock_uom", "brand"],
		)
	}
	out = []
	for r in rows:
		item = items.get(r.item_code)
		if not item:
			continue
		price = frappe.db.get_value("Item Price", {"item_code": r.item_code, "buying": 1}, "price_list_rate")
		out.append({
			"item_code": r.item_code,
			"item_name": item.item_name,
			"stock_uom": item.stock_uom,
			"brand": item.brand,
			"price": price,
		})
	return out


@frappe.whitelist()
def save_purchase_invoice(invoice_json: str, submit: int = 0):
	"""Create (and optionally submit) a real Purchase Invoice from the
	quick-purchase UI — mirrors save_sale_invoice."""
	import json

	data = json.loads(invoice_json) if isinstance(invoice_json, str) else invoice_json
	supplier = data.get("supplier")
	items = data.get("items") or []
	payments = data.get("payments") or []

	if not supplier:
		frappe.throw(_("Please select a supplier."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	warehouse = data.get("warehouse") or default_selling_warehouse(company)

	payment_mode = (data.get("payment_mode") or "credit").lower()

	doc = frappe.new_doc("Purchase Invoice")
	doc.supplier = supplier
	doc.company = company
	doc.posting_date = data.get("posting_date") or frappe.utils.today()
	# Without this flag ERPNext's validate_posting_time() silently rewrites
	# posting_date back to TODAY (transaction_base.py) — so a backdated bill
	# quietly re-dated itself, and worse, due_date stayed derived from the
	# date the operator actually picked, landing BEFORE the reset posting
	# date and throwing "Due Date cannot be before Posting Date" mid-sale
	# (2026-08-19 bug report).
	doc.set_posting_time = 1
	doc.due_date = data.get("due_date") or frappe.utils.add_days(doc.posting_date, 2)
	doc.buying_price_list = data.get("buying_price_list") or (
		frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	)
	doc.update_stock = 1
	doc.set_warehouse = warehouse
	if data.get("naming_series"):
		doc.naming_series = data.get("naming_series")
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	# The supplier's own bill number. GST Settings makes this mandatory for a
	# registered supplier, so without it the screen simply could not save a
	# purchase from anyone GST-registered. It is also what the duplicate check
	# matches on, and what the shop reads off the paper bill to find it later.
	if data.get("bill_no"):
		doc.bill_no = data.get("bill_no")
		doc.bill_date = data.get("bill_date") or doc.posting_date
	if data.get("terms"):
		doc.tc_name = None
		doc.terms = data.get("terms")
	if data.get("description"):
		doc.remarks = data.get("description")

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
		# Whichever GST slab the row picked (2026-08-18 direct request:
		# "harek item me tax daalne ka option de de") — without this the row
		# could show "18%" on screen and still save with zero tax on the real
		# invoice, since nothing here ever told the document which item tax
		# template each line actually uses.
		if row.get("item_tax_template"):
			item_row["item_tax_template"] = row.get("item_tax_template")
		doc.append("items", item_row)

	invoice_discount = flt(data.get("additional_discount_amount"))
	if invoice_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = invoice_discount

	# The CGST+SGST/IGST template this supplier's state actually calls for.
	# Without this being set before set_missing_values(), the invoice's own
	# `taxes` table stays empty and every item's tax_rate — chosen or not —
	# has nothing to post through to, so the saved bill's tax comes out
	# ₹0 regardless of what the screen showed.
	tax_template = _applicable_purchase_tax_template(supplier, company)
	# The supplier-based lookup returns nothing for an unregistered supplier
	# (one with no GSTIN yet), which is right on its own — but the operator can
	# now pick a GST slab per row on screen. Silently dropping that choice made
	# the screen say ₹1,180 while the saved bill said ₹1,000. If a slab was
	# explicitly chosen, honour it and decide CGST+SGST vs IGST from the place
	# of supply instead of from a GSTIN the supplier doesn't have.
	if not tax_template and any(row.get("item_tax_template") for row in items):
		tax_template = _purchase_tax_template_for_state(company, data.get("place_of_supply"))
	if tax_template:
		doc.taxes_and_charges = tax_template
		doc.set_taxes()

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	# Cash purchase: mark paid immediately via the chosen Mode of Payment.
	# Credit purchase: leave as a normal invoice, nothing paid yet — that's
	# just what an unpaid Purchase Invoice already means (adds to Accounts
	# Payable), no separate flag needed.
	if payment_mode == "cash":
		doc.is_paid = 1
		added_payment = False
		for p in payments:
			amt = flt(p.get("amount")) if p.get("amount") not in (None, "") else doc.grand_total
			if amt > 0:
				doc.mode_of_payment = p.get("mode_of_payment")
				doc.paid_amount = amt
				added_payment = True
				break
		if not added_payment and doc.grand_total:
			default_mode = (payments[0].get("mode_of_payment") if payments else None) or frappe.db.get_value(
				"Mode of Payment", {"enabled": 1}, "name"
			)
			if default_mode:
				doc.mode_of_payment = default_mode
				doc.paid_amount = doc.grand_total

		# The chosen Mode of Payment may be enabled but have no account
		# configured for this company (e.g. "Bank Draft" left enabled without
		# ever being wired up) — fall back to the company's own default cash
		# account rather than letting Purchase Invoice's own validation throw
		# a raw "Cash or Bank Account was not specified" mid-save.
		doc.cash_bank_account = frappe.db.get_value(
			"Mode of Payment Account", {"parent": doc.mode_of_payment, "company": company}, "default_account"
		) or frappe.db.get_value("Company", company, "default_cash_account")
		if not doc.cash_bank_account:
			frappe.throw(
				_("{0} has no Cash/Bank Account configured for {1}. Set one on the Mode of Payment, or choose a different one.").format(
					doc.mode_of_payment, company
				)
			)

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
def get_payment_entry_init(party_type: str = "Customer"):
	"""Defaults for the Vyapar-style Payment-In / Payment-Out screen.

	Mode of Payment ordering matters here for a real reason: the old
	Collect Payment dialog just took `rows[0]` off an alphabetical list,
	which made "Bank Draft" the standing default and quietly mis-recorded
	every counter cash collection (confirmed live 2026-08-15 — real saved
	Payment Entries carry "Bank Draft"). A hardware shop collects in cash
	by default, so Cash leads, then the modes that actually have a
	Cash/Bank Account configured for this company (an unconfigured one
	throws on save), then the rest.
	"""
	company = frappe.defaults.get_user_default("Company")
	modes = frappe.get_all(
		"Mode of Payment", filters={"enabled": 1}, fields=["name", "type"], order_by="name asc"
	)
	configured = set(
		frappe.get_all("Mode of Payment Account", filters={"company": company}, pluck="parent")
	)
	modes.sort(key=lambda m: (m.name != "Cash", m.name not in configured, m.name))
	return {
		"company": company,
		"party_type": party_type,
		"posting_date": frappe.utils.today(),
		"payment_modes": modes,
		"default_mode": modes[0].name if modes else None,
	}


@frappe.whitelist()
def get_party_outstanding(party_type: str, party: str):
	"""The party's unpaid invoices, oldest first, for the Payment screen's
	settlement table.

	The old dialog asked for a bare amount with nothing on screen about
	what was actually owed — the cashier typed blind and the backend
	auto-allocated oldest-first with no way to see or change it. This is
	what makes the amount reviewable before saving.
	"""
	if not party:
		return {"invoices": [], "total_outstanding": 0}

	doctype = "Sales Invoice" if party_type == "Customer" else "Purchase Invoice"
	party_field = "customer" if party_type == "Customer" else "supplier"
	company = frappe.defaults.get_user_default("Company")

	# `!= 0`, not `> 0`: a return/credit note carries a NEGATIVE outstanding,
	# and filtering those out made the settlement table show only the bills
	# while hiding the credit that offsets them — the cashier saw "₹602 due",
	# collected, and the payment settled ₹2, with no explanation on screen
	# (2026-08-19 bug report). Showing the credit row makes the net obvious
	# before any money changes hands.
	filters = {party_field: party, "docstatus": 1, "outstanding_amount": ("!=", 0)}
	if company:
		filters["company"] = company

	rows = frappe.get_all(
		doctype,
		filters=filters,
		fields=["name", "posting_date", "due_date", "grand_total", "outstanding_amount"],
		order_by="posting_date asc, name asc",
	)
	return {
		"invoices": [
			{
				"doctype": doctype,
				"name": r.name,
				"posting_date": str(r.posting_date) if r.posting_date else None,
				"due_date": str(r.due_date) if r.due_date else None,
				"grand_total": flt(r.grand_total),
				"outstanding_amount": flt(r.outstanding_amount),
			}
			for r in rows
		],
		"total_outstanding": sum(flt(r.outstanding_amount) for r in rows),
	}


@frappe.whitelist()
def create_payment_entry(
	party_type: str,
	party: str,
	amount: float,
	mode_of_payment: str,
	posting_date: str = None,
	reference_no: str = None,
	allocations_json: str = None,
	remarks: str = None,
):
	"""Record a real, submitted Payment Entry against a party's outstanding
	invoices — the "Collect Payment" (Customer) / "Payment Out" (Supplier)
	quick action (2026-08-15 direct request: nowhere to actually record
	money received against Total Receivable). Allocates the amount across
	their outstanding Sales/Purchase Invoices oldest-first, same as a
	cashier collecting against the oldest bills first, rather than leaving
	it sitting as an unallocated advance.

	`allocations_json` overrides that auto-split with explicit per-invoice
	amounts, which is what the Payment screen's settlement table sends once
	the cashier has adjusted a row (part-paying one bill while clearing
	another is a real counter situation the oldest-first rule can't
	express). Each allocation is still clamped to that invoice's actual
	outstanding so a stale screen can't over-allocate a bill that was
	settled in another tab meanwhile.

	Doesn't call Payment Entry's own set_missing_values() — that only
	resolves the PARTY's own receivable/payable account, and only once
	setup_party_account_field() has run, which for a brand new document
	only happens inside validate() (see payment_entry.py's __init__ vs
	validate()). The bank/cash side (paid_to for Receive, paid_from for
	Pay) isn't derived from mode_of_payment server-side at all — that's
	normally a client-side JS lookup — so it's set explicitly here, same
	pattern as save_purchase_invoice's cash_bank_account fallback.
	"""
	payment_type = "Receive" if party_type == "Customer" else "Pay"
	company = frappe.defaults.get_user_default("Company")
	posting_date = posting_date or frappe.utils.today()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Enter a valid amount."))

	bank_cash_account = frappe.db.get_value(
		"Mode of Payment Account", {"parent": mode_of_payment, "company": company}, "default_account"
	) or frappe.db.get_value("Company", company, "default_cash_account")
	if not bank_cash_account:
		frappe.throw(
			_("{0} has no Cash/Bank Account configured for {1}. Set one on the Mode of Payment, or choose a different one.").format(
				mode_of_payment, company
			)
		)

	doc = frappe.new_doc("Payment Entry")
	doc.payment_type = payment_type
	doc.party_type = party_type
	doc.party = party
	doc.company = company
	doc.posting_date = posting_date
	doc.mode_of_payment = mode_of_payment
	doc.paid_amount = amount
	doc.received_amount = amount
	if payment_type == "Receive":
		doc.paid_to = bank_cash_account
	else:
		doc.paid_from = bank_cash_account
	if reference_no:
		doc.reference_no = reference_no
		doc.reference_date = posting_date

	if remarks:
		doc.remarks = remarks

	outstanding_doctype = "Sales Invoice" if party_type == "Customer" else "Purchase Invoice"
	party_field = "customer" if party_type == "Customer" else "supplier"
	rows = frappe.get_all(
		outstanding_doctype,
		filters={party_field: party, "docstatus": 1, "outstanding_amount": (">", 0)},
		fields=["name", "outstanding_amount"],
		order_by="posting_date asc",
	)
	outstanding_by_name = {r.name: flt(r.outstanding_amount) for r in rows}

	requested = {}
	if allocations_json:
		import json

		parsed = json.loads(allocations_json) if isinstance(allocations_json, str) else allocations_json
		for entry in parsed or []:
			name = entry.get("name") or entry.get("reference_name")
			alloc = flt(entry.get("allocated_amount") or entry.get("amount"))
			if name and alloc > 0:
				requested[name] = alloc

	remaining = amount
	for row in rows:
		if remaining <= 0:
			break
		# An explicit allocation set means "only these rows, these amounts";
		# rows the cashier zeroed out stay untouched rather than silently
		# soaking up the leftover the way oldest-first would.
		if requested:
			if row.name not in requested:
				continue
			alloc = min(requested[row.name], outstanding_by_name[row.name], remaining)
		else:
			alloc = min(outstanding_by_name[row.name], remaining)
		if alloc <= 0:
			continue
		doc.append(
			"references",
			{
				"reference_doctype": outstanding_doctype,
				"reference_name": row.name,
				"total_amount": outstanding_by_name[row.name],
				"outstanding_amount": outstanding_by_name[row.name],
				"allocated_amount": alloc,
			},
		)
		remaining -= alloc

	doc.insert()
	doc.submit()

	return {
		"name": doc.name,
		"allocated": amount - remaining,
		"unallocated": remaining,
		"party": party,
		"party_type": party_type,
	}


_INVOICE_VIEW_ITEM_DOCTYPES = (
	"Sales Invoice",
	"POS Invoice",
	"Purchase Invoice",
	"Quotation",
	"Sales Order",
	"Purchase Order",
	"Delivery Note",
)


def _invoice_view_status(doc):
	if doc.docstatus == 2:
		return "Cancelled"
	if doc.docstatus == 0:
		return "Draft"
	# Journal Entry (and some other non-invoice doctypes) have no `status`
	# field at all — doc.status would raise AttributeError, confirmed via a
	# live bench console test (2026-08-15).
	return doc.get("status") or "Submitted"


@frappe.whitelist()
def get_invoice_view_data(doctype: str, name: str):
	"""Everything the Vyapar-style "View Invoice" screen needs to display an
	already-saved document — the counterpart to
	save_sale_invoice/save_purchase_invoice/save_quotation's create screens,
	so opening a saved document never has to fall back to ERPNext's native
	Form view (2026-08-15 direct request: "ye koi old wala nh aana
	chahiye... sab jagah sudhar, vyapaar wala sab follow hoga" — the native
	form must never appear anywhere, not even for viewing — then again
	2026-08-15 later the same day, "sabka kr, harek part ka" after a
	Payment Entry still fell through to the native form: every doctype
	reachable via santu_open_invoice_view() needs a real branch here, not
	just the original three).
	"""
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found").format(doctype, name))

	doc = frappe.get_doc(doctype, name)

	if doctype == "Payment Entry":
		allocations = [
			{
				"reference_doctype": r.reference_doctype,
				"reference_name": r.reference_name,
				"allocated_amount": r.allocated_amount,
			}
			for r in (doc.references or [])
		]
		return {
			"doctype": doctype,
			"name": doc.name,
			"kind": "payment",
			"docstatus": doc.docstatus,
			"status": _invoice_view_status(doc),
			"party_type": doc.party_type,
			"party": doc.party,
			"party_name": doc.party_name or doc.party,
			"posting_date": doc.posting_date,
			"payment_type": doc.payment_type,
			"mode_of_payment": doc.mode_of_payment,
			"reference_no": doc.reference_no,
			"reference_date": doc.reference_date,
			"paid_amount": doc.paid_amount,
			"allocations": allocations,
			"grand_total": doc.paid_amount,
		}

	if doctype == "Journal Entry":
		accounts = [
			{
				"account": a.account,
				"party": a.party,
				"debit": a.debit_in_account_currency,
				"credit": a.credit_in_account_currency,
			}
			for a in (doc.accounts or [])
		]
		return {
			"doctype": doctype,
			"name": doc.name,
			"kind": "journal",
			"docstatus": doc.docstatus,
			"status": _invoice_view_status(doc),
			"posting_date": doc.posting_date,
			"user_remark": doc.user_remark,
			"accounts": accounts,
			"grand_total": doc.total_debit,
		}

	if doctype not in _INVOICE_VIEW_ITEM_DOCTYPES:
		frappe.throw(_("Unsupported document type for this view: {0}").format(doctype))

	if doctype in ("Sales Invoice", "POS Invoice", "Sales Order", "Delivery Note"):
		party_name = doc.customer_name or doc.customer
		party_type = "Customer"
		party = doc.customer
	elif doctype == "Purchase Invoice" or doctype == "Purchase Order":
		party_name = doc.supplier_name or doc.supplier
		party_type = "Supplier"
		party = doc.supplier
	else:
		party_name = doc.customer_name or doc.party_name
		party_type = "Customer"
		party = doc.party_name

	items = [
		{
			"item_code": row.item_code,
			"item_name": row.item_name,
			"qty": row.qty,
			"uom": row.uom,
			"rate": row.rate,
			"amount": row.amount,
		}
		for row in doc.items
	]

	payments = []
	if doctype in ("Sales Invoice", "POS Invoice"):
		payments = [{"mode_of_payment": p.mode_of_payment, "amount": p.amount} for p in (doc.payments or [])]
	elif doctype == "Purchase Invoice" and doc.is_paid:
		payments = [{"mode_of_payment": doc.mode_of_payment, "amount": doc.paid_amount}]

	return {
		"doctype": doctype,
		"name": doc.name,
		"kind": "item",
		"docstatus": doc.docstatus,
		"status": _invoice_view_status(doc),
		"party_type": party_type,
		"party": party,
		"party_name": party_name,
		"posting_date": doc.get("posting_date") or doc.get("transaction_date"),
		"due_date": doc.get("due_date"),
		"place_of_supply": doc.get("place_of_supply"),
		"is_return": bool(doc.get("is_return")),
		"is_pos": bool(doc.get("is_pos")),
		"is_paid": bool(doc.get("is_paid")),
		"items": items,
		"payments": payments,
		"subtotal": doc.net_total,
		"tax": doc.total_taxes_and_charges or 0,
		"discount_amount": doc.discount_amount or 0,
		"grand_total": doc.grand_total,
		"outstanding_amount": doc.get("outstanding_amount"),
		"terms": doc.terms,
		"description": doc.get("remarks"),
	}


@frappe.whitelist()
def save_quotation(quotation_json: str, submit: int = 1):
	"""Create (and by default submit) a real Quotation from the quick
	Estimate/Quotation screen — same shape as save_sale_invoice, minus
	payments/POS/credit-limit concerns that don't apply to a quotation."""
	import json

	data = json.loads(quotation_json) if isinstance(quotation_json, str) else quotation_json
	customer = data.get("customer")
	items = data.get("items") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")

	doc = frappe.new_doc("Quotation")
	doc.quotation_to = "Customer"
	doc.party_name = customer
	doc.company = company
	doc.transaction_date = data.get("posting_date") or frappe.utils.today()
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	terms = data.get("terms") or ""
	description = data.get("description") or ""
	# Quotation has no dedicated "description"/remarks field — fold it into
	# Term Details (still shown to the user, just under one heading) rather
	# than silently dropping it.
	combined_terms = "\n\n".join(t for t in (description, terms) if t)
	if combined_terms:
		doc.tc_name = None
		doc.terms = combined_terms

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		doc.append(
			"items",
			{
				"item_code": row.get("item_code"),
				"qty": qty,
				"rate": rate,
				"uom": row.get("uom"),
				"discount_percentage": flt(row.get("discount_percentage")),
				"discount_amount": flt(row.get("discount_amount")),
			},
		)

	invoice_discount = flt(data.get("additional_discount_amount"))
	if invoice_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = invoice_discount

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


@frappe.whitelist()
def save_sales_order(order_json: str, submit: int = 1):
	"""Create (and by default submit) a real Sales Order from the quick
	Sales Order screen — same shape as save_quotation. Sales Order Item
	requires delivery_date; the quick screen doesn't surface a separate
	field for it (Vyapar doesn't either), so it defaults to the order date
	itself (2026-08-15 direct request: "selling- sales order- new sale
	order ka abhi v old ui hai, vyapar ui lao" — this screen replaces the
	native Sales Order creation form)."""
	import json

	data = json.loads(order_json) if isinstance(order_json, str) else order_json
	customer = data.get("customer")
	items = data.get("items") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	transaction_date = data.get("posting_date") or frappe.utils.today()
	delivery_date = data.get("delivery_date") or transaction_date

	doc = frappe.new_doc("Sales Order")
	doc.customer = customer
	doc.company = company
	doc.transaction_date = transaction_date
	doc.delivery_date = delivery_date
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	terms = data.get("terms") or ""
	description = data.get("description") or ""
	combined_terms = "\n\n".join(t for t in (description, terms) if t)
	if combined_terms:
		doc.tc_name = None
		doc.terms = combined_terms

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		doc.append(
			"items",
			{
				"item_code": row.get("item_code"),
				"qty": qty,
				"rate": rate,
				"uom": row.get("uom"),
				"delivery_date": delivery_date,
				"discount_percentage": flt(row.get("discount_percentage")),
				"discount_amount": flt(row.get("discount_amount")),
			},
		)

	invoice_discount = flt(data.get("additional_discount_amount"))
	if invoice_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = invoice_discount

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


@frappe.whitelist()
def get_party_balance(party_type: str, party: str):
	"""One party's current balance, for the Party Transfer screen.

	Returned as a plain positive number plus a direction, because "owes you"
	and "you owe" is what a shopkeeper reads — not a signed figure whose
	meaning flips depending on whether the account is a receivable or a
	payable.
	"""
	if not party_type or not party:
		return {"balance": 0, "direction": None}

	from erpnext.accounts.utils import get_balance_on

	company = frappe.defaults.get_user_default("Company")
	balance = flt(get_balance_on(party_type=party_type, party=party, company=company))
	# Debtors carry a debit balance when a customer owes us; Creditors carry
	# a credit balance (negative here) when we owe a supplier.
	if party_type == "Customer":
		direction = "owes_you" if balance > 0 else ("you_owe" if balance < 0 else None)
	else:
		direction = "you_owe" if balance < 0 else ("owes_you" if balance > 0 else None)
	return {"balance": abs(balance), "direction": direction}


@frappe.whitelist()
def save_party_transfer(transfer_json: str, submit: int = 1):
	"""Move a balance from one party to another as a real Journal Entry
	(2026-08-15: the "+" menu's "Party To Party Transfer" pointed at the raw
	Journal Entry form and, after new-<doctype> routes started redirecting,
	landed on the Expense screen — which a transfer is not).

	Two real cases this covers, both routine in a hardware shop:
	  * one party settles another's dues (a relative pays the bill);
	  * the same person is both customer and supplier, and the receivable
	    needs netting off against the payable.

	The posting is the same either way: CREDIT the "from" party's account
	(their balance in our favour goes down) and DEBIT the "to" party's
	(theirs goes up). For the netting case that reads correctly too —
	debiting Creditors reduces what we owe. Each side's real account comes
	from ERPNext's own get_party_account, so a party with a non-default
	receivable/payable account still posts to the right place.
	"""
	import json

	from erpnext.accounts.party import get_party_account

	data = json.loads(transfer_json) if isinstance(transfer_json, str) else transfer_json
	from_type = data.get("from_party_type")
	from_party = data.get("from_party")
	to_type = data.get("to_party_type")
	to_party = data.get("to_party")
	amount = flt(data.get("amount"))

	if not from_party or not to_party:
		frappe.throw(_("Select both parties."))
	if from_type == to_type and from_party == to_party:
		frappe.throw(_("Pick two different parties — a transfer to the same party does nothing."))
	if amount <= 0:
		frappe.throw(_("Enter an amount greater than zero."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	posting_date = data.get("posting_date") or frappe.utils.today()

	from_account = get_party_account(from_type, from_party, company)
	to_account = get_party_account(to_type, to_party, company)
	if not from_account or not to_account:
		frappe.throw(_("Could not resolve an account for one of the parties."))

	doc = frappe.new_doc("Journal Entry")
	doc.voucher_type = "Journal Entry"
	doc.company = company
	doc.posting_date = posting_date
	if data.get("notes"):
		doc.user_remark = data.get("notes")

	doc.append(
		"accounts",
		{
			"account": from_account,
			"party_type": from_type,
			"party": from_party,
			"credit_in_account_currency": amount,
		},
	)
	doc.append(
		"accounts",
		{
			"account": to_account,
			"party_type": to_type,
			"party": to_party,
			"debit_in_account_currency": amount,
		},
	)

	doc.insert()
	if cint(submit):
		doc.submit()

	return {"name": doc.name, "docstatus": doc.docstatus, "amount": amount}


@frappe.whitelist()
def get_expense_init():
	"""Defaults for the Vyapar-style Expense screen.

	Expense "categories" here are just the company's leaf Expense accounts,
	surfaced by their friendly `account_name` — a shopkeeper picks "Office
	Rent", not "Office Rent - SH". A few accounts under Expense exist for
	the system's own postings rather than for someone to spend money into
	(Cost of Goods Sold and Stock Adjustment are written by stock entries,
	Round Off / Exchange Gain-Loss by the rounding logic); offering them as
	an expense category invites postings that quietly corrupt stock
	valuation or reconciliation, so they're filtered out here — see
	SYSTEM_OWNED_EXPENSE_ACCOUNTS.
	"""
	company = frappe.defaults.get_user_default("Company")

	accounts = [{"name": a.name, "label": a.account_name} for a in _spendable_expense_accounts(company)]

	modes = frappe.get_all(
		"Mode of Payment", filters={"enabled": 1}, fields=["name", "type"], order_by="name asc"
	)
	configured = set(
		frappe.get_all("Mode of Payment Account", filters={"company": company}, pluck="parent")
	)
	# Cash first, then modes that actually have an account wired up for this
	# company — same ordering fix as get_payment_entry_init, for the same
	# reason: an alphabetical default silently mis-records cash spending.
	modes.sort(key=lambda m: (m.name != "Cash", m.name not in configured, m.name))

	return {
		"company": company,
		"posting_date": frappe.utils.today(),
		"expense_accounts": accounts,
		"payment_modes": modes,
		"default_mode": modes[0].name if modes else None,
	}


@frappe.whitelist()
def save_expense(expense_json: str, submit: int = 1):
	"""Record a shop expense as a real, submitted Journal Entry (2026-08-15
	direct request: "expene- New Journal Entry isko vyapaar type banao" —
	"+ Add Expense" opened ERPNext's native Journal Entry form, whose
	"Accounting Entries" grid asks for Account / Party Type / Debit / Credit
	per row).

	The double entry is derived here rather than typed by the user: each
	category row is a debit to that expense account, and one balancing
	credit posts the total against the Cash/Bank account behind the chosen
	payment mode. That's the same Journal Entry the native form would
	produce — the screen just stops asking a shopkeeper to know which side
	of the ledger money leaves from.
	"""
	import json

	data = json.loads(expense_json) if isinstance(expense_json, str) else expense_json
	rows = data.get("rows") or []
	mode_of_payment = data.get("mode_of_payment")

	valid_rows = [r for r in rows if r.get("expense_account") and flt(r.get("amount")) > 0]
	if not valid_rows:
		frappe.throw(_("Add at least one expense category with an amount."))
	if not mode_of_payment:
		frappe.throw(_("Select how this was paid."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	posting_date = data.get("posting_date") or frappe.utils.today()

	paid_from = frappe.db.get_value(
		"Mode of Payment Account", {"parent": mode_of_payment, "company": company}, "default_account"
	) or frappe.db.get_value("Company", company, "default_cash_account")
	if not paid_from:
		frappe.throw(
			_("{0} has no Cash/Bank Account configured for {1}. Set one on the Mode of Payment, or choose a different one.").format(
				mode_of_payment, company
			)
		)

	total = sum(flt(r.get("amount")) for r in valid_rows)

	doc = frappe.new_doc("Journal Entry")
	doc.voucher_type = "Journal Entry"
	doc.company = company
	doc.posting_date = posting_date
	doc.mode_of_payment = mode_of_payment
	if data.get("reference_no"):
		doc.cheque_no = data.get("reference_no")
		doc.cheque_date = posting_date
	if data.get("notes"):
		doc.user_remark = data.get("notes")

	party_type = data.get("party_type")
	party = data.get("party")

	for row in valid_rows:
		line = {
			"account": row.get("expense_account"),
			"debit_in_account_currency": flt(row.get("amount")),
			# The expenses list shows this as the row's Reference, so the
			# per-row note is worth keeping rather than folding into one
			# voucher-level remark.
			"user_remark": row.get("description") or data.get("notes") or None,
		}
		if party_type and party:
			line["party_type"] = party_type
			line["party"] = party
		doc.append("accounts", line)

	doc.append(
		"accounts",
		{"account": paid_from, "credit_in_account_currency": total},
	)

	doc.insert()
	if cint(submit):
		doc.submit()

	return {"name": doc.name, "docstatus": doc.docstatus, "total": total}


@frappe.whitelist()
def get_returnable_purchase_bills(supplier: str):
	"""Submitted Purchase Invoices a debit note can be booked against.
	Buying-side mirror of get_returnable_invoices."""
	if not supplier:
		return []

	company = frappe.defaults.get_user_default("Company")
	filters = {"supplier": supplier, "docstatus": 1, "is_return": 0}
	if company:
		filters["company"] = company

	rows = frappe.get_all(
		"Purchase Invoice",
		filters=filters,
		fields=["name", "posting_date", "grand_total"],
		order_by="posting_date desc, name desc",
		limit_page_length=50,
	)
	return [
		{
			"name": r.name,
			"posting_date": str(r.posting_date) if r.posting_date else None,
			"grand_total": flt(r.grand_total),
		}
		for r in rows
	]


@frappe.whitelist()
def get_purchase_items_for_return(invoice: str):
	"""Line items of one Purchase Invoice with how much of each is still
	returnable. Buying-side mirror of get_invoice_items_for_return."""
	if not invoice or not frappe.db.exists("Purchase Invoice", invoice):
		frappe.throw(_("Bill {0} not found").format(invoice or ""))

	returned = frappe.db.sql(
		"""
		select child.item_code, sum(child.qty) as qty
		from `tabPurchase Invoice Item` child
		inner join `tabPurchase Invoice` parent on parent.name = child.parent
		where parent.docstatus = 1 and parent.is_return = 1 and parent.return_against = %s
		group by child.item_code
		""",
		(invoice,),
		as_dict=True,
	)
	returned_by_item = {r.item_code: abs(flt(r.qty)) for r in returned}

	doc = frappe.get_doc("Purchase Invoice", invoice)
	out = []
	for row in doc.items:
		bought = flt(row.qty)
		already = returned_by_item.get(row.item_code, 0)
		out.append(
			{
				"item_code": row.item_code,
				"item_name": row.item_name,
				"row_name": row.name,
				"qty": bought,
				"already_returned": already,
				"returnable_qty": max(bought - already, 0),
				"rate": flt(row.rate),
				"uom": row.uom,
				"stock_uom": row.stock_uom,
				"discount_percentage": flt(row.discount_percentage),
				"discount_amount": flt(row.discount_amount),
			}
		)
	return {"invoice": invoice, "items": out}


@frappe.whitelist()
def save_purchase_return(return_json: str, submit: int = 1):
	"""Create (and by default submit) a Purchase Return / Debit Note.

	Buying-side mirror of save_sales_return, and the fix for a real
	regression: the three "Purchase Return" entry points all went through
	frappe.new_doc("Purchase Invoice") plus cur_frm.set_value("is_return", 1)
	— a two-step dance needed because is_return is no_copy. Once new-<doctype>
	routes started redirecting to their own quick screens there was no
	cur_frm left to set the flag on, so returns were silently saving as
	ordinary purchase bills (found 2026-08-15 while auditing the topbar).

	Quantities arrive positive from the screen and are negated here, the
	same single boundary save_sales_return uses.
	"""
	import json

	data = json.loads(return_json) if isinstance(return_json, str) else return_json
	supplier = data.get("supplier")
	items = data.get("items") or []

	if not supplier:
		frappe.throw(_("Please select a supplier."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	warehouse = data.get("warehouse") or default_selling_warehouse(company)

	doc = frappe.new_doc("Purchase Invoice")
	doc.supplier = supplier
	doc.company = company
	doc.is_return = 1
	doc.posting_date = data.get("posting_date") or frappe.utils.today()
	# Without this flag ERPNext's validate_posting_time() silently rewrites
	# posting_date back to TODAY (transaction_base.py) — so a backdated bill
	# quietly re-dated itself, and worse, due_date stayed derived from the
	# date the operator actually picked, landing BEFORE the reset posting
	# date and throwing "Due Date cannot be before Posting Date" mid-sale
	# (2026-08-19 bug report).
	doc.set_posting_time = 1
	doc.due_date = doc.posting_date
	doc.buying_price_list = data.get("buying_price_list") or (
		frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	)
	# Goods going back to the supplier leave our shelf.
	doc.update_stock = 1
	doc.set_warehouse = warehouse
	if data.get("return_against"):
		doc.return_against = data.get("return_against")
		# See the matching comment in save_sales_return — ERPNext's default
		# (1) tracks the debit note's own outstanding separately instead of
		# reducing the original purchase bill's, which is what actually
		# applies the credit (2026-08-19 fix, same request/bug applied to
		# the buying side for consistency).
		doc.update_outstanding_for_self = 0
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	if data.get("reason"):
		doc.remarks = data.get("reason")

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		item_row = {
			"item_code": row.get("item_code"),
			"qty": -abs(qty),
			"rate": rate,
			"warehouse": row.get("warehouse") or warehouse,
			"uom": row.get("uom"),
			"discount_percentage": flt(row.get("discount_percentage")),
			"discount_amount": flt(row.get("discount_amount")),
		}
		if row.get("purchase_invoice_item"):
			item_row["purchase_invoice_item"] = row.get("purchase_invoice_item")
		doc.append("items", item_row)

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


@frappe.whitelist()
def get_returnable_invoices(customer: str):
	"""Submitted Sales Invoices a return can be booked against, newest first.

	Deliberately NOT filtered to unpaid invoices the way get_party_outstanding
	is — goods come back just as often from a bill that was paid in cash on
	the spot, and that's exactly the case where a credit note matters.
	Existing returns (is_return=1) are excluded: you can't return a return.
	"""
	if not customer:
		return []

	company = frappe.defaults.get_user_default("Company")
	filters = {"customer": customer, "docstatus": 1, "is_return": 0}
	if company:
		filters["company"] = company

	rows = frappe.get_all(
		"Sales Invoice",
		filters=filters,
		fields=["name", "posting_date", "grand_total", "santu_bill_no"],
		order_by="posting_date desc, name desc",
		limit_page_length=50,
	)
	# `bill_no` is what the customer is holding — the Return Against picker
	# used to list docnames, so the number on screen never matched the number
	# printed on the slip (2026-08-19 bug report).
	return [
		{
			"name": r.name,
			"bill_no": format_bill_no(r.santu_bill_no),
			"posting_date": str(r.posting_date) if r.posting_date else None,
			"grand_total": flt(r.grand_total),
		}
		for r in rows
	]


@frappe.whitelist()
def search_returnable_invoices(query: str = None):
	"""Bills a return can be booked against, found by bill number OR party.

	One box for both (2026-08-18 direct request: "both 1 and 2"). A walk-in
	cash sale has no useful party name to search by, so the bill number is
	the only way back to it; a regular customer is usually remembered by
	name, not by number. Searching both off one box means the counter never
	has to know which kind of sale it was.
	"""
	company = frappe.defaults.get_user_default("Company")
	conditions = ["si.docstatus = 1", "si.is_return = 0"]
	values = {}
	if company:
		conditions.append("si.company = %(company)s")
		values["company"] = company

	q = (query or "").strip()
	if q:
		# santu_bill_no is the number actually PRINTED on the customer's copy,
		# so it is the one they read back at the counter — searching only the
		# docname meant typing "0128" off a real bill found nothing at all
		# (2026-08-19 bug report). Leading zeros are stripped before matching
		# because the slip prints them and the column does not.
		conditions.append(
			"(si.name like %(q)s or si.customer like %(q)s or cast(si.santu_bill_no as char) like %(qnum)s)"
		)
		values["q"] = "%" + q + "%"
		values["qnum"] = "%" + q.lstrip("0") + "%" if q.strip("0") else "%" + q + "%"

	rows = frappe.db.sql(
		"""
		select si.name, si.customer, si.posting_date, si.grand_total, si.santu_bill_no
		from `tabSales Invoice` si
		where {where}
		order by si.posting_date desc, si.name desc
		limit 30
		""".format(where=" and ".join(conditions)),
		values,
		as_dict=True,
	)
	return [
		{
			"name": r.name,
			"bill_no": format_bill_no(r.santu_bill_no),
			"customer": r.customer,
			"posting_date": str(r.posting_date) if r.posting_date else None,
			"grand_total": flt(r.grand_total),
		}
		for r in rows
	]


@frappe.whitelist()
def get_invoice_items_for_return(invoice: str):
	"""The line items of one Sales Invoice, with how much of each is still
	returnable, for the Sale Return screen's "return against" prefill.

	`already_returned` sums the qty on every submitted return already booked
	against this invoice (stored negative in ERPNext, so it's negated back to
	a positive here). Without it, a second partial return would offer the
	full original quantity again and only fail later inside ERPNext's own
	validation.
	"""
	if not invoice or not frappe.db.exists("Sales Invoice", invoice):
		frappe.throw(_("Invoice {0} not found").format(invoice or ""))

	returned = frappe.db.sql(
		"""
		select child.item_code, sum(child.qty) as qty
		from `tabSales Invoice Item` child
		inner join `tabSales Invoice` parent on parent.name = child.parent
		where parent.docstatus = 1 and parent.is_return = 1 and parent.return_against = %s
		group by child.item_code
		""",
		(invoice,),
		as_dict=True,
	)
	returned_by_item = {r.item_code: abs(flt(r.qty)) for r in returned}

	doc = frappe.get_doc("Sales Invoice", invoice)
	out = []
	for row in doc.items:
		sold = flt(row.qty)
		already = returned_by_item.get(row.item_code, 0)
		out.append(
			{
				"item_code": row.item_code,
				"item_name": row.item_name,
				# The source ROW's id, not just the item code. A return has to
				# point at the exact line it reverses (`sales_invoice_item`);
				# without it ERPNext can't tie the credit note back to the
				# original line and warns "Returned Item X does not exist in
				# <invoice>" even though the item plainly does.
				"row_name": row.name,
				"qty": sold,
				"already_returned": already,
				"returnable_qty": max(sold - already, 0),
				"rate": flt(row.rate),
				"uom": row.uom,
				"stock_uom": row.stock_uom,
				"discount_percentage": flt(row.discount_percentage),
				"discount_amount": flt(row.discount_amount),
			}
		)
	return {"invoice": invoice, "items": out}


@frappe.whitelist()
def save_sales_return(return_json: str, submit: int = 1):
	"""Create (and by default submit) a real Sales Return / Credit Note
	(2026-08-15 direct request: "sale return ka v same vyapaar ui kro" —
	this replaces the native Sales Invoice form with Is Return ticked).

	A return IS a Sales Invoice with is_return=1 and NEGATIVE quantities —
	that's ERPNext's own representation, not a choice made here. The screen
	collects plain positive quantities ("2 pieces came back", which is how a
	shopkeeper thinks and how Vyapar asks for it) and this negates them at
	the boundary; asking a counter user to type -2 is a real source of
	mistakes.

	`return_against` is optional but strongly preferred: with it, ERPNext
	validates the return against what was actually sold and links the credit
	note to the original bill. Without it the return still books, which is
	what a shop needs when goods come back with no bill to hand.
	"""
	import json

	data = json.loads(return_json) if isinstance(return_json, str) else return_json
	customer = data.get("customer")
	items = data.get("items") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	warehouse = data.get("warehouse") or default_selling_warehouse(company)

	doc = frappe.new_doc("Sales Invoice")
	# Same reason as save_sale_invoice: a default POS Profile would replace
	# this screen's own payment rows the moment set_missing_values() runs.
	doc.flags.ignore_pos_profile = True
	doc.customer = customer
	doc.company = company
	doc.is_return = 1
	doc.posting_date = data.get("posting_date") or frappe.utils.today()
	# Without this flag ERPNext's validate_posting_time() silently rewrites
	# posting_date back to TODAY (transaction_base.py) — so a backdated bill
	# quietly re-dated itself, and worse, due_date stayed derived from the
	# date the operator actually picked, landing BEFORE the reset posting
	# date and throwing "Due Date cannot be before Posting Date" mid-sale
	# (2026-08-19 bug report).
	doc.set_posting_time = 1
	doc.due_date = doc.posting_date
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	# Returned goods go back on the shelf — same update_stock/warehouse pair
	# the Sale Invoice screen uses, just moving the other way.
	doc.update_stock = 1
	doc.set_warehouse = warehouse
	if data.get("return_against"):
		doc.return_against = data.get("return_against")
		# ERPNext's default here is 1 — the credit note tracks its OWN
		# outstanding separately instead of reducing the original bill's,
		# which is why every return used to pop up "Credit Note is made
		# against SINV-... uncheck 'Update Outstanding for Self'... use
		# Payment Reconciliation to reconcile... later" and then just sit
		# there until someone did that by hand (2026-08-19 bug report:
		# "return me ye msg aa raha hai, bhai refund kr do naa" — the
		# credit should apply itself, not wait for a manual reconciliation
		# step nobody at the counter is going to go looking for).
		doc.update_outstanding_for_self = 0
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	if data.get("reason"):
		doc.remarks = data.get("reason")

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		item_row = {
			"item_code": row.get("item_code"),
			# Negated here, at the one boundary between the screen's
			# plain-language quantities and ERPNext's representation.
			"qty": -abs(qty),
			"rate": rate,
			"warehouse": row.get("warehouse") or warehouse,
			"uom": row.get("uom"),
			"discount_percentage": flt(row.get("discount_percentage")),
			"discount_amount": flt(row.get("discount_amount")),
		}
		# Links this line back to the exact row it reverses on the original
		# bill. Only present for rows prefilled from a return_against
		# invoice; a bill-less return has nothing to point at.
		if row.get("sales_invoice_item"):
			item_row["sales_invoice_item"] = row.get("sales_invoice_item")
		doc.append("items", item_row)

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


@frappe.whitelist()
def create_return_refund_payment(doctype: str, return_name: str, mode_of_payment: str = "Cash"):
	"""Settle a return/credit note that was actually paid back in cash on
	the spot, instead of left as account credit.

	A submitted return with `update_outstanding_for_self=0` nets against
	the original bill automatically (see save_sales_return above), but if
	that original bill was already fully paid there's nothing left to net
	against — the whole credit sits on the return itself as a negative
	outstanding ("shop owes the customer ₹X") until it's actually settled.
	If the counter handed cash back right away, that's real money that
	already moved and needs a real Payment Entry, or Parties keeps showing
	an amount owed that isn't true anymore (2026-08-19 bug report: did a
	real return for a real customer, handed the refund over immediately,
	and Parties still showed the old owed amount — because nothing had
	told the system the refund happened).

	erpnext's own get_payment_entry() figures out the correct direction —
	Pay for a Sales Invoice return (money leaving the shop), Receive for a
	Purchase Invoice return (a supplier owing money back) — so this is a
	thin wrapper around that, not a reimplementation.
	"""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	if doctype not in ("Sales Invoice", "Purchase Invoice"):
		frappe.throw(_("Refund settlement is only supported for Sales/Purchase returns."))
	if not frappe.db.exists(doctype, return_name):
		frappe.throw(_("{0} not found").format(return_name))
	if not frappe.db.get_value(doctype, return_name, "is_return"):
		frappe.throw(_("{0} is not a return.").format(return_name))

	pe = get_payment_entry(doctype, return_name)
	pe.mode_of_payment = mode_of_payment or "Cash"
	pe.reference_no = f"Refund-{return_name}"
	pe.reference_date = frappe.utils.today()
	pe.insert(ignore_permissions=True)
	pe.submit()
	frappe.db.commit()
	return {"name": pe.name, "paid_amount": pe.paid_amount}


@frappe.whitelist()
def save_delivery_note(challan_json: str, submit: int = 1):
	"""Create (and by default submit) a real Delivery Note from the quick
	Delivery Challan screen (2026-08-15 direct request: "make the ui of
	delivery chalan vyapaar like" — this replaces the native Delivery Note
	creation form). Same shape as save_sales_order.

	Unlike Sales Order / Quotation, a Delivery Note is a STOCK document:
	submitting it actually moves goods out of the warehouse. Two things
	follow from that, and neither is optional:

	  * every item row needs a source warehouse — the screen has no
	    per-row warehouse picker (Vyapar's challan doesn't either, a small
	    shop has one godown), so the company's single active warehouse is
	    stamped on each row, same default the Sale Invoice screen uses.
	  * `po_no` carries the customer's own reference/order number, which is
	    what a real challan is filed against at the receiving end.

	Insufficient stock raises ERPNext's own negative-stock error rather
	than being worked around here — a challan for goods that aren't there
	is a real problem to surface, not to paper over.
	"""
	import json

	data = json.loads(challan_json) if isinstance(challan_json, str) else challan_json
	customer = data.get("customer")
	items = data.get("items") or []

	if not customer:
		frappe.throw(_("Please select a customer."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	posting_date = data.get("posting_date") or frappe.utils.today()
	warehouse = data.get("warehouse") or default_selling_warehouse(company)
	if not warehouse:
		frappe.throw(_("No active warehouse found. Set one up in Admin Mode first."))

	doc = frappe.new_doc("Delivery Note")
	doc.customer = customer
	doc.company = company
	doc.posting_date = posting_date
	doc.set_warehouse = warehouse
	doc.selling_price_list = data.get("selling_price_list") or (
		frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	)
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	if data.get("po_no"):
		doc.po_no = data.get("po_no")

	terms = data.get("terms") or ""
	description = data.get("description") or ""
	combined_terms = "\n\n".join(t for t in (description, terms) if t)
	if combined_terms:
		doc.tc_name = None
		doc.terms = combined_terms

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		doc.append(
			"items",
			{
				"item_code": row.get("item_code"),
				"qty": qty,
				"rate": rate,
				"uom": row.get("uom"),
				"warehouse": warehouse,
				"discount_percentage": flt(row.get("discount_percentage")),
				"discount_amount": flt(row.get("discount_amount")),
			},
		)

	challan_discount = flt(data.get("additional_discount_amount"))
	if challan_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = challan_discount

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


@frappe.whitelist()
def save_purchase_order(order_json: str, submit: int = 1):
	"""Create (and by default submit) a real Purchase Order from the quick
	Purchase Order screen — mirrors save_sales_order (Customer -> Supplier,
	selling -> buying). Purchase Order Item requires schedule_date (Sales
	Order's equivalent of delivery_date); the quick screen doesn't surface
	a separate field for it (Vyapar doesn't either), so it defaults to the
	order date itself (2026-08-15 direct request: "purchase order- add ur
	first purchase order... jo ui hai use delete krke vyapaar type ui add
	kro" — this screen replaces the native Purchase Order creation form).
	"""
	import json

	data = json.loads(order_json) if isinstance(order_json, str) else order_json
	supplier = data.get("supplier")
	items = data.get("items") or []

	if not supplier:
		frappe.throw(_("Please select a supplier."))
	if not items:
		frappe.throw(_("Please add at least one item."))

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	transaction_date = data.get("posting_date") or frappe.utils.today()
	schedule_date = data.get("schedule_date") or transaction_date

	doc = frappe.new_doc("Purchase Order")
	doc.supplier = supplier
	doc.company = company
	doc.transaction_date = transaction_date
	doc.schedule_date = schedule_date
	doc.buying_price_list = data.get("buying_price_list") or (
		frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	)
	if data.get("place_of_supply"):
		doc.place_of_supply = data.get("place_of_supply")
	terms = data.get("terms") or ""
	description = data.get("description") or ""
	combined_terms = "\n\n".join(t for t in (description, terms) if t)
	if combined_terms:
		doc.tc_name = None
		doc.terms = combined_terms

	for row in items:
		qty = flt(row.get("qty"))
		if qty <= 0:
			frappe.throw(_("Please enter a valid quantity for {0}.").format(row.get("item_code")))
		rate = flt(row.get("rate"))
		if rate < 0:
			frappe.throw(_("Please enter a valid rate for {0}.").format(row.get("item_code")))

		doc.append(
			"items",
			{
				"item_code": row.get("item_code"),
				"qty": qty,
				"rate": rate,
				"uom": row.get("uom"),
				"schedule_date": schedule_date,
				"discount_percentage": flt(row.get("discount_percentage")),
				"discount_amount": flt(row.get("discount_amount")),
			},
		)

	invoice_discount = flt(data.get("additional_discount_amount"))
	if invoice_discount:
		doc.apply_discount_on = "Grand Total"
		doc.discount_amount = invoice_discount

	doc.run_method("set_missing_values")
	doc.run_method("calculate_taxes_and_totals")

	doc.insert()
	if cint(submit):
		doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"grand_total": doc.grand_total,
		"status": doc.status,
	}


def _validate_credit_customer(customer_name: str, outstanding: float):
	"""2026-08-14 direct request: Walk-in Customer can never carry a
	balance ("baaki") — cash-in-full only, since there's no way to
	actually collect from a walk-in later. Any *other* customer left with
	an outstanding balance (a credit sale, or a partial "Paid Now" less
	than the total) must have some way to be reached for the rest of the
	money — same reasoning, just short of an outright ban.

	A phone number OR an address, not both: that is the same bar party
	creation sets, and demanding more here than creation does produced a
	trap. 17 of 29 existing customers had only one of the two, so they
	could be created happily and then refused at the counter, mid-sale,
	with the customer standing there. For chasing a debt a phone number
	is at least as useful as a street address anyway.

	Checked here, not just client-side, since this quick-sale screen
	isn't the only caller of `save_sale_invoice`."""
	cust = frappe.db.get_value(
		"Customer", customer_name, ["customer_name", "mobile_no", "customer_primary_address"], as_dict=True
	)
	if not cust:
		return

	if (cust.customer_name or "").strip().lower() == "walk-in customer":
		frappe.throw(
			_(
				"Walk-in Customer cannot have an outstanding balance of {0}. "
				"Select or add a proper customer for a credit/baaki sale."
			).format(frappe.utils.fmt_money(outstanding, currency="INR"))
		)

	# A party auto-created from nothing but a phone number ("Customer 6780")
	# is a placeholder — no real name, no village, nobody you could actually
	# go and collect from. Cash sales to them are fine; baaki is not, until
	# someone fills the details in (2026-08-16 direct request).
	if re.match(r"^customer\s+\d+$", (cust.customer_name or "").strip(), re.IGNORECASE):
		frappe.throw(
			_(
				"{0} was created from a phone number alone, so {1} cannot be left as baaki. "
				"Open the party and fill in their name and village first."
			).format(cust.customer_name, frappe.utils.fmt_money(outstanding, currency="INR"))
		)

	if not cust.mobile_no and not cust.customer_primary_address:
		frappe.throw(
			_(
				"{0} has no phone number and no address on file, so {1} cannot be left "
				"as baaki. Open the party and add a phone number or an address, then "
				"make this sale again."
			).format(cust.customer_name, frappe.utils.fmt_money(outstanding, currency="INR"))
		)


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
			fields=["name", "posting_date", "grand_total", "outstanding_amount", "santu_bill_no"],
		)
		for r in si_rows:
			r["type"] = "Sale"
			r["doctype"] = "Sales Invoice"
		_attach_item_summaries(si_rows, "Sales Invoice", "Sales Invoice Item")

		pos_rows = frappe.get_all(
			"POS Invoice",
			filters={"customer": party, "docstatus": 1, "consolidated_invoice": ["in", ["", None]]},
			fields=["name", "posting_date", "grand_total", "outstanding_amount", "santu_bill_no"],
		)
		for r in pos_rows:
			r["type"] = "Sale"
			r["doctype"] = "POS Invoice"
		_attach_item_summaries(pos_rows, "POS Invoice", "POS Invoice Item")

		rows = list(si_rows) + list(pos_rows)
	else:
		rows = frappe.get_all(
			"Purchase Invoice",
			filters={"supplier": party, "docstatus": 1},
			fields=["name", "posting_date", "grand_total", "outstanding_amount"],
		)
		for r in rows:
			r["type"] = "Purchase"
			r["doctype"] = "Purchase Invoice"
		_attach_item_summaries(rows, "Purchase Invoice", "Purchase Invoice Item")

	# The "Number" column on the Parties detail panel should read the way the
	# shop actually numbers its bills -- the running count printed on the
	# thermal slip and the number an operator would search by -- not the
	# document ID (SINV-26-00254). Purchase Invoice has no santu_bill_no (no
	# thermal bill exists for suppliers), so it falls back to its own name.
	for r in rows:
		bill_no = r.get("santu_bill_no")
		r["display_number"] = format_bill_no(bill_no) if bill_no else r["name"]

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


_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b")


def _extract_supplier_from_bill(text: str):
	"""Seller's own name + GSTIN, read off the bill itself.

	A GST invoice always prints both parties' GSTINs; the shop's own is
	known, so whatever is left is the supplier's. This matters beyond
	filling in a name: india_compliance refuses to put GST on a purchase
	from a supplier with no GSTIN on file, so a bill that plainly shows
	the seller is registered would still save with zero tax — and the
	counter would be asked to type a GSTIN that was printed on the paper
	all along (2026-08-18: "SUPPLIER DETAIL NH JAYEGA PURCHASE ME").
	"""
	company_gstin = (
		frappe.db.get_value("Company", frappe.defaults.get_user_default("Company"), "gstin") or ""
	).upper()

	lines = text.splitlines()
	gstin = None
	gstin_line = None
	for idx, line in enumerate(lines):
		for found in _GSTIN_RE.findall(line.upper()):
			if found != company_gstin:
				gstin, gstin_line = found, idx
				break
		if gstin:
			break

	if not gstin:
		return None

	# The seller's block runs from their name down to their GSTIN line, so
	# walk up to the top of that unbroken run. Layout-mode extraction merges
	# the invoice-details column onto the same physical lines, hence the
	# split on runs of 2+ spaces to keep only the left-hand column.
	start = gstin_line
	while start > 0 and lines[start - 1].strip():
		start -= 1

	# Boilerplate that can head the same block on continuation pages, where
	# the seller's name is not reprinted — better to return no name (and let
	# the GSTIN alone identify an existing supplier) than to name a supplier
	# "Tax Invoice".
	skip_prefixes = (
		"gstin",
		"state name",
		"place of supply",
		"tax invoice",
		"consignee",
		"buyer",
		"irn",
		"ack no",
		"ack date",
		"e-way bill",
	)

	name = ""
	for line in lines[start:gstin_line]:
		candidate = re.split(r"\s{2,}", line.strip())[0].strip()
		if not candidate or candidate.lower().startswith(skip_prefixes):
			continue
		# A digit-led line is an address or a number, never the shop's name.
		if candidate[0].isdigit():
			continue
		name = candidate
		break

	return {"supplier_name": name, "gstin": gstin}


def _resolve_bill_supplier(text: str):
	"""The Supplier this bill is from, created or corrected as needed.

	Matching by GSTIN first is what makes this reliable — the same shop can
	be written "JANTA CEMENT STORE(JCS)" on one bill and "Janta Cement" on
	the next, but the GSTIN is the same on both.
	"""
	details = _extract_supplier_from_bill(text)
	if not details:
		return _guess_supplier(text)

	gstin = details["gstin"]
	supplier = frappe.db.get_value("Supplier", {"gstin": gstin}, "name")
	if not supplier:
		supplier = _guess_supplier(text)

	if supplier:
		# Known supplier, but possibly missing the GSTIN that would let GST
		# actually post — fill it in from the bill rather than leaving the
		# purchase to silently save untaxed.
		if not frappe.db.get_value("Supplier", supplier, "gstin"):
			frappe.db.set_value("Supplier", supplier, "gstin", gstin)
			frappe.db.set_value("Supplier", supplier, "gst_category", "Registered Regular")
		return supplier

	# GSTIN present but the name wasn't reprinted on this page (continuation
	# pages do this). Nothing safe to create from — leave it for the operator
	# rather than inventing a supplier called after a page header.
	if not details["supplier_name"]:
		return None

	doc = frappe.new_doc("Supplier")
	doc.supplier_name = title_case_a_name(details["supplier_name"])
	doc.supplier_group = frappe.db.get_value("Supplier Group", {}, "name") or "All Supplier Groups"
	doc.supplier_type = "Company"
	doc.gstin = gstin
	doc.gst_category = "Registered Regular"
	doc.insert(ignore_permissions=True)
	return doc.name


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

	if len(cols) < 6:
		return None

	# Find the HSN column by its pattern (4-8 digits) scanning from the
	# right — some bills insert an extra "18 %" GST Rate column between
	# HSN and Quantity, shifting the fixed-index assumption by one.
	hsn_idx = None
	for i in range(len(cols) - 1, 0, -1):
		if re.fullmatch(r"\d{4,8}", cols[i]):
			hsn_idx = i
			break
	if hsn_idx is None:
		return None

	# Columns to the right of HSN: qty, [rate_incl,] rate, per, amount.
	right = cols[hsn_idx + 1:]
	if len(right) < 3:
		return None

	# Skip any "N %" GST-rate token that may appear right after HSN.
	if right and re.fullmatch(r"\d{1,3}\s*%", right[0]):
		right = right[1:]
	if len(right) < 3:
		return None

	qty_match = re.match(r"([\d.]+)", right[0])
	if not qty_match:
		return None

	try:
		qty = flt(qty_match.group(1))
		# right[-1]=amount, right[-2]=per-unit, right[-3]=net-rate
		amount = flt(right[-1].replace(",", ""))
		rate = flt(right[-3].replace(",", ""))
	except (ValueError, IndexError):
		return None
	if qty <= 0 or rate <= 0:
		return None
	if amount > 0 and not (0.5 <= amount / (qty * rate) <= 2.0):
		return None

	hsn = cols[hsn_idx]
	desc = re.sub(r"^\d+\s*", "", " ".join(cols[:hsn_idx])).strip()
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


# A name like "FEVICOL HEATX NF 24X200ML" packs two facts together: the
# shop counts stock by the individual 200ml bottle, but buys it 24 at a
# time in one carton (2026-08-17 direct request: "iska ye aise add ki
# 200ml ka 24 pcs, aise hi same for all"). Without this, a bill line
# quantity of "3" (three cartons) posted straight to stock as 3 pieces —
# short by a factor of 24 the moment anyone actually counted the shelf.
_PACK_SIZE_RE = re.compile(
	r"\b(\d{1,3})\s*[xX×]\s*\d+(?:\.\d+)?\s*(ML|ml|KG|kg|GM|gm|G|g|L|l|LTR|ltr|GRAM|GRAMS|gram|grams)\b"
)


def _detect_pack_size(text: str):
	"""Pack count from a description like '24X200ML' (24), or None if the
	name doesn't carry one — most items don't, and are left exactly as
	they already work (plain Nos, no Box at all)."""
	if not text:
		return None
	m = _PACK_SIZE_RE.search(text)
	if not m:
		return None
	n = int(m.group(1))
	# 1xSIZE isn't a pack, and anything past ~200 is almost certainly the
	# regex catching a different number in the text, not a real carton size.
	return n if 1 < n <= 200 else None


def _ensure_pack_uom(item_code: str, pack_qty: int):
	"""Give an already-saved Item a 'Box' = pack_qty conversion, if it
	doesn't have one yet. Idempotent — safe to call on every bill line
	that mentions this item, not just the first.
	"""
	if not frappe.db.exists("UOM", "Box"):
		frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert(ignore_permissions=True)

	if frappe.db.exists("UOM Conversion Detail", {"parent": item_code, "uom": "Box"}):
		return

	item = frappe.get_doc("Item", item_code)
	item.append("uoms", {"uom": "Box", "conversion_factor": pack_qty})
	item.save(ignore_permissions=True)


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

	pack_qty = _detect_pack_size(description)

	try:
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = description[:140]
		item.item_group = _guess_item_group(description)
		# The shop counts and sells this by the individual piece — stock_uom
		# stays Nos regardless of whether it was bought one at a time or in
		# a labelled carton (2026-08-17: "200ml ka 24 pcs, same for all").
		item.stock_uom = "Nos"
		item.is_stock_item = 1
		item.gst_hsn_code = hsn
		if pack_qty:
			if not frappe.db.exists("UOM", "Box"):
				frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert(ignore_permissions=True)
			item.append("uoms", {"uom": "Box", "conversion_factor": pack_qty})
		item.insert(ignore_permissions=True)

		item_price = frappe.new_doc("Item Price")
		item_price.item_code = item.item_code
		item_price.price_list = "Standard Buying"
		item_price.buying = 1
		# `rate` is what the bill actually charged for the line — a carton's
		# price when this item is bought by the carton, not one piece's.
		# The Item's own reference price has to stay per-piece to match
		# stock_uom, or it would silently claim a 200ml bottle costs what a
		# 24-bottle case does.
		item_price.price_list_rate = flt(rate) / pack_qty if pack_qty else flt(rate)
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

	# Raw (not whitespace-normalised) text: the seller's name is separated
	# from the invoice-details column by a run of spaces, which normalising
	# would collapse — taking "JANTA CEMENT STORE(JCS)" down with it.
	supplier = _resolve_bill_supplier(text)
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

	# A description like "24X200ML" on a row means the printed qty/rate are
	# per-carton, not per-piece (2026-08-17: "200ml ka 24 pcs, same for
	# all") — the Purchase screen needs to show this row in "Box" so
	# ERPNext's own qty × conversion_factor lands the right piece count in
	# stock. Runs for every row, not just freshly auto-created ones: an
	# item this shop already stocks (matched, not auto-created) gets the
	# same Box conversion backfilled onto it here if it's missing one.
	for row in item_rows:
		if not row["item_code"]:
			continue
		pack_qty = _detect_pack_size(row["description"])
		if not pack_qty:
			row["uom"] = None
			continue
		try:
			_ensure_pack_uom(row["item_code"], pack_qty)
			row["uom"] = "Box"
		except Exception:
			frappe.log_error(title="Upload Supplier Bill: pack UOM backfill failed", message=frappe.get_traceback())
			row["uom"] = None

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
				"uom": row.get("uom"),
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

	warehouse = default_selling_warehouse()

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


@frappe.whitelist()
def get_cash_bank_accounts():
	"""Vyapar-style Cash & Bank balances — every Cash/Bank leaf account for
	the company with its current balance (2026-08-15 direct request:
	"Chart of Accounts me kya kaam h? use acche se dekho" — the native
	Chart of Accounts is the full double-entry ledger tree, which Vyapar
	itself never shows a shop owner; this is the Vyapar-equivalent —
	just the cash/bank balances, same concept as the app's own Cash In
	Hand/Bank Accounts entries under Current Assets).
	"""
	from erpnext.accounts.utils import get_balance_on

	company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	accounts = frappe.get_all(
		"Account",
		filters={"company": company, "account_type": ["in", ["Cash", "Bank"]], "is_group": 0, "disabled": 0},
		fields=["name", "account_name", "account_type"],
		order_by="account_name asc",
	)

	rows = []
	total = 0.0
	for a in accounts:
		balance = flt(get_balance_on(a.name))
		rows.append(
			{
				"account": a.name,
				"account_name": a.account_name,
				"account_type": a.account_type,
				"balance": balance,
			}
		)
		total += balance

	rows.sort(key=lambda r: -r["balance"])
	return {"accounts": rows, "total": total}


@frappe.whitelist()
def get_account_ledger(account: str, limit: int = 50):
	"""Recent GL Entries for one Cash/Bank account — the "statement" behind
	a balance in get_cash_bank_accounts(), same idea as a Party's
	transaction list elsewhere in this app."""
	rows = frappe.get_all(
		"GL Entry",
		filters={"account": account, "is_cancelled": 0},
		fields=["posting_date", "voucher_type", "voucher_no", "against", "party", "party_type", "debit", "credit"],
		order_by="posting_date desc, creation desc",
		limit_page_length=cint(limit) or 50,
	)
	return rows


@frappe.whitelist()
def get_party_contact_info(party_type: str, party: str):
	"""Phone + billing address for the Parties detail panel header
	(2026-08-15 direct request, matching a real Vyapar screenshot pixel for
	pixel: "Phone Number"/"Billing Address" shown right under the party
	name — the panel previously showed a bare Customer/Supplier type pill
	instead)."""
	address_field = "customer_primary_address" if party_type == "Customer" else "supplier_primary_address"
	doc = frappe.get_doc(party_type, party)
	phone = doc.mobile_no
	address_name = doc.get(address_field)

	address_display = None
	if address_name and frappe.db.exists("Address", address_name):
		addr = frappe.get_doc("Address", address_name)
		parts = [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode, addr.country]
		address_display = ", ".join(p for p in parts if p)

	gstin = doc.get("gstin")
	email = doc.get("email_id")
	credit_limit = 0
	if party_type == "Customer":
		for row in doc.get("credit_limits") or []:
			credit_limit = flt(row.credit_limit)
			if credit_limit:
				break
	return {
		"phone": phone,
		"address": address_display,
		"gstin": gstin,
		"email": email,
		"credit_limit": credit_limit,
	}


@frappe.whitelist()
def update_party_phone(party_type: str, party: str, phone: str):
	"""Update a party's phone number from the Parties detail panel's Edit
	dialog. A plain frappe.client.set_value("mobile_no", ...) silently
	no-ops (confirmed live 2026-08-15) — Customer/Supplier auto-link a
	primary Contact the first time a phone is set (create_customer_full/
	create_supplier_full above), and mobile_no reads back from that linked
	Contact afterward rather than staying a plain field, so the Contact's
	own phone row has to be the one that changes.
	"""
	contact_field = "customer_primary_contact" if party_type == "Customer" else "supplier_primary_contact"
	doc = frappe.get_doc(party_type, party)
	contact_name = doc.get(contact_field)

	if contact_name and frappe.db.exists("Contact", contact_name):
		contact = frappe.get_doc("Contact", contact_name)
	else:
		contact = frappe.new_doc("Contact")
		contact.first_name = doc.get("customer_name") or doc.get("supplier_name") or party
		contact.append("links", {"link_doctype": party_type, "link_name": party})

	primary_rows = [p for p in contact.phone_nos if p.is_primary_mobile_no]
	if primary_rows:
		primary_rows[0].phone = phone
	else:
		contact.append("phone_nos", {"phone": phone, "is_primary_mobile_no": 1})
	contact.save(ignore_permissions=True)

	if not contact_name:
		frappe.db.set_value(party_type, party, contact_field, contact.name)
	frappe.db.set_value(party_type, party, "mobile_no", phone)

	return {"phone": phone}


@frappe.whitelist()
def update_party_details(
	party_type: str,
	party: str,
	party_name: str = None,
	phone: str = None,
	email: str = None,
	gstin: str = None,
	address: str = None,
	city: str = None,
	pincode: str = None,
):
	"""Save every field the Parties Edit dialog shows.

	The dialog used to collect Phone, Email and Address but only ever call
	update_party_phone — Email was typed in, accepted, and silently thrown
	away on save, and Address was read-only with a note telling the user to
	"edit the full address from the party's own record", i.e. the native
	form this app deliberately hides. Party Name and GSTIN weren't offered
	at all, so a name typed wrong at creation could never be corrected;
	people just made a second party instead (the duplicate pairs sitting in
	this shop's list — "chandra"/"Chandra Prakash", "ansh babu"/"Ansh Babu"
	— are what that produces).

	Renaming goes through frappe.rename_doc so every linked invoice, payment
	and ledger entry follows the new name rather than pointing at a party
	that no longer exists. Customer/Supplier are named by their own name
	field in this site, so a name change genuinely is a rename.
	"""
	if not frappe.db.exists(party_type, party):
		frappe.throw(_("{0} {1} not found").format(party_type, party))

	name_field = "customer_name" if party_type == "Customer" else "supplier_name"
	current = frappe.get_doc(party_type, party)
	new_name = (party_name or "").strip()

	# Rename first: everything below addresses the party by name.
	if new_name and new_name != current.get(name_field):
		new_name = title_case_a_name(new_name)
		if frappe.db.exists(party_type, new_name) and new_name != party:
			frappe.throw(_("A {0} named {1} already exists.").format(party_type.lower(), new_name))
		frappe.rename_doc(party_type, party, new_name, force=True, show_alert=False)
		party = new_name
		frappe.db.set_value(party_type, party, name_field, new_name)

	if phone is not None:
		update_party_phone(party_type, party, phone)

	if email is not None:
		frappe.db.set_value(party_type, party, "email_id", email or None)

	if gstin is not None:
		# gstin lives on the party in india_compliance; guard so a site
		# without it doesn't blow up the whole save.
		if frappe.get_meta(party_type).has_field("gstin"):
			frappe.db.set_value(party_type, party, "gstin", gstin or None)
			# A GSTIN being entered at all is what makes this party
			# GST-registered — without also flipping gst_category, GST tax
			# templates keep resolving to None for a party still marked
			# "Unregistered" and every purchase from them silently posts
			# with zero tax regardless of the GSTIN now on file.
			if gstin and frappe.get_meta(party_type).has_field("gst_category"):
				current_category = frappe.db.get_value(party_type, party, "gst_category")
				if current_category in (None, "", "Unregistered"):
					frappe.db.set_value(party_type, party, "gst_category", "Registered Regular")

	# address_line1, city and pincode can each arrive independently — the
	# Sale screen's inline Village/Pincode fields are edited separately from
	# the Address textarea, so a village-only edit must not be silently
	# dropped just because `address` itself is None.
	if address is not None or city is not None or pincode is not None:
		address_field = "customer_primary_address" if party_type == "Customer" else "supplier_primary_address"
		address_name = frappe.db.get_value(party_type, party, address_field)

		# A village on its own is enough to know the pincode, and the pincode
		# is enough to know the district — so the counter never types either of
		# those twice, and nothing falls back to this shop's own district.
		if city and not pincode:
			pincode = (_village_lookup(city) or {}).get("pincode") or pincode
		district = _district_for_pincode(pincode)

		if address_name and frappe.db.exists("Address", address_name):
			values = {}
			if address is not None:
				values["address_line1"] = address or None
			if city is not None:
				values["city"] = city or district or party
			if pincode is not None:
				values["pincode"] = pincode or None
			if district:
				values["address_line2"] = f"{district} District"
			if values:
				frappe.db.set_value("Address", address_name, values)
		elif address or city or pincode:
			# No address on file yet: create one from whichever of the three
			# fields the counter actually filled in. address_line1 and city
			# are mandatory on Address, so a village/pincode-only edit still
			# needs a line1 to insert — the party's own name, same fallback
			# create_customer_full already uses when nothing else was typed.
			doc = frappe.new_doc("Address")
			doc.address_title = party
			doc.address_type = "Billing"
			doc.address_line1 = address or party
			doc.city = city or district or party
			doc.address_line2 = f"{district} District" if district else None
			doc.pincode = pincode or None
			doc.country = "India"
			doc.append("links", {"link_doctype": party_type, "link_name": party})
			doc.insert(ignore_permissions=True)
			frappe.db.set_value(party_type, party, address_field, doc.name)

		# Keep santu_village in step with whatever city just got saved, or
		# party_village()'s "prefer the stored value" rule would keep
		# showing a stale village even after the address was corrected.
		if city and party_type == "Customer" and frappe.get_meta("Customer").has_field("santu_village"):
			frappe.db.set_value("Customer", party, "santu_village", city)

	frappe.db.commit()
	return {"party": party}


@frappe.whitelist()
def create_brand(brand_name: str):
	"""Create a new Brand master record and return its name."""
	brand_name = (brand_name or "").strip()
	if not brand_name:
		frappe.throw(_("Brand name cannot be empty."))
	if not frappe.db.exists("Brand", brand_name):
		doc = frappe.get_doc({"doctype": "Brand", "brand": brand_name})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
	return {"name": brand_name, "brand": brand_name}


@frappe.whitelist()
def get_add_item_init():
	"""Defaults for the Add Item screen.

	The full UOM list is offered (2026-08-19 direct request: "yaha units ke
	sare units do") — ERPNext ships 264 of them, so scrolling past all of
	them to find something uncommon is real friction. The fix is ordering,
	not hiding: setup.install.create_hardware_uoms's six real units plus
	anything already used by an existing item lead the list, and everything
	else this shop has never touched follows underneath, alphabetically.
	"""
	company = frappe.defaults.get_user_default("Company")
	preferred = ["Nos", "Litre", "Box", "Bundle", "Packet", "Can"]
	existing = frappe.get_all("UOM", filters={"enabled": 1}, pluck="name")
	in_use = frappe.get_all("Item", filters={"disabled": 0}, pluck="stock_uom", distinct=True)

	uoms = [u for u in preferred if u in existing]
	uoms += sorted({u for u in in_use if u and u not in uoms and u in existing})
	uoms += sorted(u for u in existing if u not in uoms)

	groups = frappe.get_all(
		"Item Group", filters={"is_group": 0}, fields=["name"], order_by="name asc", pluck="name"
	)
	warehouses = frappe.get_all(
		"Warehouse", filters={"is_group": 0, "company": company}, pluck="name", order_by="name asc"
	)
	return {
		"company": company,
		"uoms": uoms,
		"default_uom": "Nos" if "Nos" in uoms else (uoms[0] if uoms else None),
		"item_groups": groups,
		"default_group": "Products" if "Products" in groups else (groups[0] if groups else None),
		# Everything the rebuilt Add Item screen needs to fill its dropdowns
		# in one round trip (2026-08-18) — brands, warehouses and suppliers
		# all already exist as real doctypes, so these are read, never
		# invented, and nothing here creates a duplicate master.
		"brands": frappe.get_all("Brand", pluck="name", order_by="name asc"),
		"warehouses": warehouses,
		"default_warehouse": default_selling_warehouse(company),
		"suppliers": frappe.get_all(
			"Supplier", filters={"disabled": 0}, pluck="name", order_by="name asc", limit_page_length=500
		),
		"gst_rates": ["0", "5", "12", "18", "28"],
	}

@frappe.whitelist()
def save_item(item_json: str):
	"""Create an item from the Vyapar-style Add Item screen.

	Replaces Frappe's native Quick Entry dialog, which required Item Code,
	Item Group and HSN/SAC, offered "Is Fixed Asset" and an "Edit Full Form"
	escape into the raw Item form — and had no field for the sale or purchase
	price, the first thing a shopkeeper wants to set.

	The Product/Service toggle maps to is_stock_item. A Product created here
	IS stock-tracked and its opening quantity posts as a real Material
	Receipt: this screen is where you add something you are holding. (The
	mid-sale POS path, quick_create_item, still makes non-stock items on
	purpose — a brand-new item has to be sellable before any stock exists.)
	"""
	import json
	import re

	data = json.loads(item_json) if isinstance(item_json, str) else item_json
	item_name = (data.get("item_name") or "").strip()
	if not item_name:
		frappe.throw(_("Enter an item name."))

	is_service = cint(data.get("is_service"))

	# Item is named by item_code here. The screen can supply one via "Assign
	# Code"; otherwise it is slugged from the name, de-duplicated on collision.
	# A code typed by hand is NOT silently de-duplicated — that would quietly
	# create "ABC-2" when someone believed they were reusing "ABC" (2026-08-18
	# spec: "Validate duplicate SKU").
	typed_code = (data.get("item_code") or "").strip()
	if typed_code and frappe.db.exists("Item", typed_code):
		frappe.throw(_("Item code {0} is already used. Pick a different one.").format(typed_code))
	item_code = typed_code
	if not item_code:
		item_code = re.sub(r"[^A-Za-z0-9]+", "-", item_name).strip("-").upper() or "ITEM"
		base = item_code
		suffix = 1
		while frappe.db.exists("Item", item_code):
			suffix += 1
			item_code = f"{base}-{suffix}"

	company = data.get("company") or frappe.defaults.get_user_default("Company")
	opening_qty = flt(data.get("opening_qty"))
	sale_price = flt(data.get("sale_price"))
	purchase_price = flt(data.get("purchase_price"))
	mrp = flt(data.get("mrp"))
	wholesale_price = flt(data.get("wholesale_price"))
	min_selling_price = flt(data.get("min_selling_price"))
	gst_applicable = cint(data.get("gst_applicable"))
	track_batches = cint(data.get("track_batches")) and not is_service
	# "At Price" values the opening stock; falls back to the purchase price,
	# which is what that stock actually cost.
	at_price = flt(data.get("at_price")) or purchase_price

	for label, value in (
		(_("Sale Price"), sale_price),
		(_("Purchase Price"), purchase_price),
		(_("MRP"), mrp),
		(_("Wholesale Price"), wholesale_price),
		(_("Minimum Selling Price"), min_selling_price),
		(_("Opening Quantity"), opening_qty),
	):
		if value < 0:
			frappe.throw(_("{0} cannot be negative.").format(label))
	if min_selling_price and sale_price and min_selling_price > sale_price:
		frappe.throw(_("Minimum Selling Price cannot be more than the Sale Price."))

	item = frappe.new_doc("Item")
	item.item_code = item_code
	item.item_name = item_name
	item.item_group = data.get("item_group") or ("Services" if is_service else "Products")
	item.stock_uom = data.get("uom") or "Nos"
	item.is_stock_item = 0 if is_service else 1
	item.include_item_in_manufacturing = 0
	item.disabled = 0 if cint(data.get("is_active", 1)) else 1
	if data.get("brand"):
		brand_val = str(data.get("brand")).strip()
		if brand_val:
			if not frappe.db.exists("Brand", brand_val):
				frappe.get_doc({"doctype": "Brand", "brand": brand_val}).insert(ignore_permissions=True)
			item.brand = brand_val
	if data.get("description"):
		item.description = data.get("description")
	if data.get("sub_category"):
		item.custom_sub_category = data.get("sub_category")
	if data.get("image"):
		item.image = data.get("image")
	item.custom_mrp = mrp
	item.custom_min_selling_price = min_selling_price
	item.custom_gst_applicable = gst_applicable
	if track_batches:
		item.has_batch_no = 1
		item.create_new_batch = 1
	# HSN belongs to GST classification and nothing else. It is only forced
	# when this item is actually sold under GST — a non-GST item is saved
	# with no HSN at all rather than borrowing the catalogue's most-used one
	# (2026-08-18 spec: "Do not force an HSN", "Barcode and HSN are
	# completely different things"). The catalogue fallback is kept for the
	# GST case, where india_compliance does require the field.
	if gst_applicable:
		item.gst_hsn_code = data.get("gst_hsn_code") or _default_hsn_code()
	elif data.get("gst_hsn_code"):
		item.gst_hsn_code = data.get("gst_hsn_code")

	# Barcodes: one primary plus any alternates, each its own row on Item's
	# native child table. Never derived from HSN or the item code.
	seen_barcodes = set()
	for entry in [{"barcode": data.get("barcode"), "barcode_type": data.get("barcode_type")}] + (
		data.get("alternate_barcodes") or []
	):
		code = (entry.get("barcode") or "").strip() if isinstance(entry, dict) else str(entry or "").strip()
		if not code or code in seen_barcodes:
			continue
		existing = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
		if existing:
			frappe.throw(_("Barcode {0} already belongs to item {1}.").format(code, existing))
		seen_barcodes.add(code)
		row = {"barcode": code}
		btype = entry.get("barcode_type") if isinstance(entry, dict) else None
		if btype:
			row["barcode_type"] = btype
		item.append("barcodes", row)
	if data.get("location"):
		item.custom_rack_number = data.get("location")

	# A name like "FEVICOL HEATX NF 24X200ML" says this comes 24 to a
	# carton — same pack detection Upload Bill uses (2026-08-17: "200ml ka
	# 24 pcs, same for all"), so typing that name here also sets up "Box"
	# as a real purchasable unit worth 24 of whatever stock_uom already is.
	pack_qty = _detect_pack_size(item_name) if not is_service else None
	if pack_qty:
		if not frappe.db.exists("UOM", "Box"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert(ignore_permissions=True)
		item.append("uoms", {"uom": "Box", "conversion_factor": pack_qty})

	# Default supplier and this supplier's own code for the item — both
	# ERPNext natives, so an existing Supplier is linked, never duplicated
	# (2026-08-18 spec: "Do not create duplicate suppliers").
	default_supplier = data.get("default_supplier")
	if default_supplier and frappe.db.exists("Supplier", default_supplier):
		item.append("item_defaults", {"company": company, "default_supplier": default_supplier})
		if data.get("supplier_item_code"):
			item.append(
				"supplier_items",
				{"supplier": default_supplier, "supplier_part_no": data.get("supplier_item_code")},
			)

	item.insert(ignore_permissions=True)

	def _add_price(rate, price_list, buying):
		if rate <= 0:
			return
		price = frappe.new_doc("Item Price")
		price.item_code = item.item_code
		price.price_list = price_list
		price.buying = 1 if buying else 0
		price.selling = 0 if buying else 1
		price.price_list_rate = rate
		price.insert(ignore_permissions=True)

	_add_price(sale_price, "Standard Selling", buying=False)
	_add_price(purchase_price, "Standard Buying", buying=True)
	# Wholesale used to be collected by the screen and then dropped on the
	# floor — it had no Price List to live in (fixed 2026-08-18).
	if wholesale_price > 0 and frappe.db.exists("Price List", "Wholesale"):
		_add_price(wholesale_price, "Wholesale", buying=False)

	warehouse = data.get("warehouse") or default_selling_warehouse(company)

	# "Min Stock To Maintain" is ERPNext's reorder level — the same number
	# get_low_stock_items() already reads when deciding what to warn about.
	min_stock = flt(data.get("min_stock"))
	if min_stock > 0 and warehouse and not is_service:
		item.append(
			"reorder_levels",
			{
				"warehouse": warehouse,
				"warehouse_reorder_level": min_stock,
				"warehouse_reorder_qty": min_stock,
				"material_request_type": "Purchase",
			},
		)
		item.save(ignore_permissions=True)

	# A batch-tracked item's opening stock has to land IN a batch, otherwise
	# ERPNext rejects the receipt outright. The batch carries its own MRP and
	# purchase rate so a later delivery at a different cost becomes a second
	# batch rather than overwriting this one (2026-08-18 spec: "Do not
	# overwrite old batch pricing when a new purchase comes in").
	batch_no = None
	if track_batches and opening_qty > 0:
		typed_batch = (data.get("batch_no") or "").strip()
		if typed_batch and frappe.db.exists("Batch", typed_batch):
			frappe.throw(_("Batch {0} already exists.").format(typed_batch))
		batch = frappe.new_doc("Batch")
		batch.item = item.item_code
		if typed_batch:
			batch.batch_id = typed_batch
		if data.get("batch_expiry"):
			batch.expiry_date = data.get("batch_expiry")
		if data.get("supplier_for_batch") and frappe.db.exists("Supplier", data.get("supplier_for_batch")):
			batch.supplier = data.get("supplier_for_batch")
		batch.custom_mrp = flt(data.get("batch_mrp")) or mrp
		batch.custom_purchase_rate = flt(data.get("batch_purchase_rate")) or at_price
		batch.insert(ignore_permissions=True)
		batch_no = batch.name
		# A batch can price itself differently from the item master — that is
		# the whole point of tracking batches. Item Price carries batch_no
		# natively, so this needs no parallel structure.
		batch_selling = flt(data.get("batch_selling_rate"))
		if batch_selling > 0:
			bp = frappe.new_doc("Item Price")
			bp.item_code = item.item_code
			bp.price_list = "Standard Selling"
			bp.selling = 1
			bp.batch_no = batch_no
			bp.price_list_rate = batch_selling
			bp.insert(ignore_permissions=True)

	opening_posted = False
	if opening_qty > 0 and warehouse and not is_service:
		# Same Material Receipt path receive_stock_simple uses — a real stock
		# ledger entry, not a back-dated fudge.
		entry = frappe.new_doc("Stock Entry")
		entry.company = company
		entry.stock_entry_type = "Material Receipt"
		entry.purpose = "Material Receipt"
		if data.get("as_of_date"):
			entry.set_posting_time = 1
			entry.posting_date = data.get("as_of_date")
		row = {
			"item_code": item.item_code,
			"t_warehouse": warehouse,
			"qty": opening_qty,
			"basic_rate": at_price,
			"allow_zero_valuation_rate": 1 if at_price <= 0 else 0,
		}
		if batch_no:
			row["batch_no"] = batch_no
		entry.append("items", row)
		entry.insert(ignore_permissions=True)
		entry.submit()
		opening_posted = True

	# Current stock read back from the ledger rather than assumed, so the
	# confirmation the screen shows is the real figure.
	current_stock = 0
	if warehouse and not is_service:
		current_stock = flt(
			frappe.db.get_value("Bin", {"item_code": item.item_code, "warehouse": warehouse}, "actual_qty")
		)

	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"opening_qty": opening_qty if opening_posted else 0,
		"current_stock": current_stock,
		"uom": item.stock_uom,
		"min_stock": min_stock,
		"batch_no": batch_no,
		"warehouse": warehouse,
	}


@frappe.whitelist()
def create_item_master(doctype: str, name_value: str):
	"""Create an Item Group or UOM from the Items screen's Category / Unit
	tabs.

	Both used to open their native forms, which ask for a parent group, an
	"Is Group" flag and tree placement — none of which mean anything to
	someone naming a category "Paints". A new category is created as a leaf
	under the existing root so it behaves like every other one.
	"""
	if doctype not in ("Item Group", "UOM"):
		frappe.throw(_("Cannot create {0} here.").format(doctype))

	name_value = (name_value or "").strip()
	if not name_value:
		frappe.throw(_("Enter a name."))
	if frappe.db.exists(doctype, name_value):
		frappe.throw(_("{0} already exists.").format(name_value))

	doc = frappe.new_doc(doctype)
	if doctype == "Item Group":
		doc.item_group_name = name_value
		doc.is_group = 0
		parent = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ""}, "name")
		doc.parent_item_group = parent or "All Item Groups"
	else:
		doc.uom_name = name_value
		doc.enabled = 1
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist()
def rename_item_master(doctype: str, old_name: str, new_name: str):
	"""Rename an Item Group or UOM from the Items screen.

	The Category tab's edit action used to open the Item Group tree form,
	which exposes parent group and "Is Group" — neither of which anyone
	renaming "Paints" needs. rename_doc carries every linked item across.
	"""
	if doctype not in ("Item Group", "UOM"):
		frappe.throw(_("Cannot rename {0} here.").format(doctype))

	new_name = (new_name or "").strip()
	if not new_name:
		frappe.throw(_("Enter a name."))
	if new_name == old_name:
		return {"name": old_name}
	if frappe.db.exists(doctype, new_name):
		frappe.throw(_("{0} already exists.").format(new_name))

	frappe.rename_doc(doctype, old_name, new_name, force=True, show_alert=False)
	field = "item_group_name" if doctype == "Item Group" else "uom_name"
	frappe.db.set_value(doctype, new_name, field, new_name)
	frappe.db.commit()
	return {"name": new_name}


@frappe.whitelist()
def create_staff_user(full_name: str, email: str, role: str = "Staff"):
	"""Create a login for a staff member or the shop's accountant.

	Both "Add User" (Sync & Share) and "Add Accountant" (Utilities) opened
	the native User form, which is a developer surface — roles table, API
	keys, module permissions, desk settings. All this shop needs is a name,
	an email to log in with, and which of the two things they are.
	"""
	full_name = (full_name or "").strip()
	email = (email or "").strip().lower()
	if not full_name:
		frappe.throw(_("Enter a name."))
	if not email:
		frappe.throw(_("Enter an email — it is the login id."))
	if frappe.db.exists("User", email):
		frappe.throw(_("A user with {0} already exists.").format(email))

	parts = full_name.split(" ", 1)
	user = frappe.new_doc("User")
	user.email = email
	user.first_name = title_case_a_name(parts[0])
	if len(parts) > 1:
		user.last_name = title_case_a_name(parts[1])
	user.send_welcome_email = 0
	user.user_type = "System User"
	user.insert(ignore_permissions=True)

	# Accountant gets the read-heavy accounting roles; staff get the
	# day-to-day selling ones. Anything finer is a Settings job, not
	# something to decide while adding a person.
	roles = (
		["Accounts User", "Accounts Manager"]
		if role == "Accountant"
		else ["Sales User", "Stock User", "Purchase User"]
	)
	for r in roles:
		if frappe.db.exists("Role", r):
			user.append("roles", {"role": r})
	user.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": user.name, "email": email}


def _company_address_name(company: str):
	return frappe.db.get_value(
		"Dynamic Link",
		{"link_doctype": "Company", "link_name": company, "parenttype": "Address"},
		"parent",
	)


def _company_address_fields(company: str) -> dict:
	name = _company_address_name(company)
	if not name or not frappe.db.exists("Address", name):
		return {
			"address_name": None,
			"address": "",
			"address_line2": "",
			"city": "",
			"state": "Bihar",
			"pincode": "",
		}
	addr = frappe.get_doc("Address", name)
	return {
		"address_name": addr.name,
		"address": addr.address_line1 or "",
		"address_line2": addr.address_line2 or "",
		"city": addr.city or "",
		"state": addr.state or "Bihar",
		"pincode": addr.pincode or "",
	}


def _save_company_address(company: str, data: dict):
	name = _company_address_name(company)
	values = {
		"address_line1": (data.get("address") or "").strip() or company,
		"address_line2": (data.get("address_line2") or "").strip() or None,
		"city": (data.get("city") or "").strip() or "Patna",
		"state": (data.get("state") or "").strip() or "Bihar",
		"pincode": (data.get("pincode") or "").strip() or None,
		"country": "India",
	}
	if name and frappe.db.exists("Address", name):
		for k, v in values.items():
			frappe.db.set_value("Address", name, k, v)
		return name
	addr = frappe.new_doc("Address")
	addr.address_title = company
	addr.address_type = "Billing"
	for k, v in values.items():
		addr.set(k, v)
	addr.append("links", {"link_doctype": "Company", "link_name": company})
	addr.insert(ignore_permissions=True)
	return addr.name


@frappe.whitelist()
def get_shop_profile():
	"""The handful of company fields a shop owner actually maintains."""
	company = frappe.defaults.get_user_default("Company")
	if not company:
		return {}
	doc = frappe.get_doc("Company", company)
	out = {
		"name": doc.name,
		"company_name": doc.company_name,
		"phone_no": doc.get("phone_no") or "",
		"email": doc.get("email") or "",
		"website": doc.get("website") or "",
		"gstin": doc.get("gstin") or "",
		"company_logo": doc.get("company_logo") or "",
	}
	out.update(_company_address_fields(company))
	return out


@frappe.whitelist()
def update_shop_profile(
	company: str,
	company_name: str = None,
	phone_no: str = None,
	email: str = None,
	gstin: str = None,
	website: str = None,
	address: str = None,
	address_line2: str = None,
	city: str = None,
	state: str = None,
	pincode: str = None,
	company_logo: str = None,
):
	"""Save the shop's own details on the Vyapar Shop Profile page."""
	if not frappe.db.exists("Company", company):
		frappe.throw(_("Company {0} not found").format(company))
	updates = {}
	if company_name:
		updates["company_name"] = company_name.strip()
	if phone_no is not None:
		updates["phone_no"] = phone_no.strip() or None
	if email is not None:
		updates["email"] = email.strip() or None
	if website is not None:
		updates["website"] = website.strip() or None
	if gstin is not None and frappe.get_meta("Company").has_field("gstin"):
		updates["gstin"] = gstin.strip() or None
	if company_logo is not None:
		updates["company_logo"] = company_logo.strip() or None
	for k, v in updates.items():
		frappe.db.set_value("Company", company, k, v)
	_save_company_address(
		company,
		{
			"address": address,
			"address_line2": address_line2,
			"city": city,
			"state": state,
			"pincode": pincode,
		},
	)
	frappe.db.commit()
	return {"company": company}


@frappe.whitelist()
def get_payment_modes():
	"""Payment modes with whether each one is usable in this company.

	A Mode of Payment can be enabled yet have no Cash/Bank account wired up
	for the company, in which case saving against it throws at the very end
	of a sale. Surfacing that here is the difference between a setting that
	looks fine and one that actually works.
	"""
	company = frappe.defaults.get_user_default("Company")
	configured = set(
		frappe.get_all("Mode of Payment Account", filters={"company": company}, pluck="parent")
	)
	rows = frappe.get_all(
		"Mode of Payment", fields=["name", "type", "enabled"], order_by="name asc"
	)
	return [
		{
			"name": r.name,
			"type": r.type,
			"enabled": bool(r.enabled),
			"ready": r.name in configured,
		}
		for r in rows
	]


@frappe.whitelist()
def set_payment_mode_enabled(mode: str, enabled: int):
	"""Turn one payment mode on or off."""
	if not frappe.db.exists("Mode of Payment", mode):
		frappe.throw(_("{0} not found").format(mode))
	frappe.db.set_value("Mode of Payment", mode, "enabled", cint(enabled))
	frappe.db.commit()
	return {"mode": mode, "enabled": cint(enabled)}


@frappe.whitelist()
def create_payment_mode(mode_name: str, mode_type: str = "Cash"):
	"""Add a payment mode and point it at the company's default account for
	its kind, so it works the moment it is created rather than failing at
	the end of the first sale that uses it."""
	mode_name = (mode_name or "").strip()
	if not mode_name:
		frappe.throw(_("Enter a name."))
	if frappe.db.exists("Mode of Payment", mode_name):
		frappe.throw(_("{0} already exists.").format(mode_name))

	company = frappe.defaults.get_user_default("Company")
	account = frappe.db.get_value(
		"Company", company, "default_cash_account" if mode_type == "Cash" else "default_bank_account"
	) or frappe.db.get_value("Company", company, "default_cash_account")

	doc = frappe.new_doc("Mode of Payment")
	doc.mode_of_payment = mode_name
	doc.type = mode_type
	doc.enabled = 1
	if account:
		doc.append("accounts", {"company": company, "default_account": account})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


# Only caller (get_loyalty_status) is switched off (2026-08-18), see there.
# def _redeemable_loyalty_points(customer, program, company):
# 	"""Points that a Sales Invoice can actually spend — not just points held.
#
# 	ERPNext will only redeem a point entry against the same doctype that
# 	earned it, and it does NOT fail when it comes up short: it writes off
# 	the full rupee discount while debiting only the points it could find.
# 	So a balance shown from the raw ledger can hand out money that never
# 	gets deducted. This counts what redemption will really consume, which
# 	is the only number safe to offer at the counter.
# 	"""
# 	from erpnext.accounts.doctype.loyalty_point_entry.loyalty_point_entry import (
# 		get_loyalty_point_entries,
# 		get_redemption_details,
# 	)
#
# 	entries = get_loyalty_point_entries(customer, program, company) or []
# 	spent = get_redemption_details(customer, program, company) or {}
# 	total = 0
# 	for entry in entries:
# 		if entry.get("invoice_type") != "Sales Invoice":
# 			continue
# 		# get_redemption_details sums the negative side of the ledger, so the
# 		# amount already spent against this entry arrives as a negative
# 		# number — take its magnitude rather than subtracting it directly.
# 		used = abs(flt(spent.get(entry.get("name"))))
# 		total += flt(entry.get("loyalty_points")) - used
# 	return cint(max(total, 0))


@frappe.whitelist()
def get_loyalty_status(customer: str):
	"""Points a customer has, and what they are worth.

	The programme ("Santu Hardware Rewards": 1 point per ₹100, 1 point = ₹1)
	was already collecting points on every sale — 30 entries existed before
	this screen could show any of them. Redemption additionally needs an
	expense account on the programme, which was never set; ensure_loyalty_setup
	fills that in so redeeming doesn't fail at submit time.
	"""
	# Switched off for now (2026-08-18 direct request: "loyalty points ko
	# abhi ke liye commentout kr do harek jagah se" — how it should work
	# isn't decided yet). Real body kept commented below rather than
	# deleted, so turning it back on is one line, not a rebuild. No caller
	# reaches this today (Billing's own loyalty button is commented out
	# too), but this whitelisted endpoint returning "not enrolled" instead
	# of real balances is a safe default even if something still calls it.
	return {"enrolled": False, "points": 0, "value": 0}
	# if not customer or not frappe.db.exists("Customer", customer):
	# 	return {"enrolled": False, "points": 0, "value": 0}
	#
	# program = frappe.db.get_value("Customer", customer, "loyalty_program")
	# if not program:
	# 	return {"enrolled": False, "points": 0, "value": 0}
	#
	# company = frappe.defaults.get_user_default("Company")
	# points = _redeemable_loyalty_points(customer, program, company)
	# factor = flt(frappe.db.get_value("Loyalty Program", program, "conversion_factor")) or 1
	# return {
	# 	"enrolled": True,
	# 	"program": program,
	# 	"points": points,
	# 	"value": points * factor,
	# 	"conversion_factor": factor,
	# }


LOYALTY_EXPIRY_MONTHS = 24


def ensure_loyalty_setup():
	"""Give the loyalty programme the expense account redemption needs.

	Points were being earned fine, but redeeming posts the rupee value to an
	expense account and the programme had none — so the first redemption
	would have failed at submit. Runs on install and after every migrate so
	it can't quietly drift back.
	"""
	company = frappe.defaults.get_user_default("Company") or frappe.db.get_value("Company", {}, "name")
	if not company:
		return False

	changed = False
	for program in frappe.get_all("Loyalty Program", pluck="name"):
		doc = frappe.get_doc("Loyalty Program", program)
		if not cint(doc.expiry_duration):
			# expiry_duration 0 made ERPNext stamp every point entry with
			# expiry_date = posting_date, so points earned today were already
			# expired today — the balance always read 0 even with a full
			# ledger behind it. Two years is long enough that a customer who
			# comes back seasonally still has their points.
			doc.expiry_duration = LOYALTY_EXPIRY_MONTHS
			doc.save(ignore_permissions=True)
			changed = True
			doc.reload()
		if doc.expense_account and doc.cost_center:
			continue
		if not doc.expense_account:
			# A redeemed point is a discount the shop chose to give — it
			# belongs with selling costs, not with cost of goods.
			doc.expense_account = frappe.db.get_value(
				"Account", {"company": company, "account_name": "Sales Expenses", "is_group": 0}, "name"
			) or frappe.db.get_value(
				"Account", {"company": company, "account_name": "Marketing Expenses", "is_group": 0}, "name"
			)
		if not doc.cost_center:
			doc.cost_center = frappe.db.get_value("Company", company, "cost_center") or frappe.db.get_value(
				"Cost Center", {"company": company, "is_group": 0}, "name"
			)
		if doc.expense_account and doc.cost_center:
			doc.company = doc.company or company
			doc.save(ignore_permissions=True)
			changed = True
	if changed:
		frappe.db.commit()
	return changed


def backfill_loyalty_expiry():
	"""Rescue points already stamped with a same-day expiry_date.

	Entries written while expiry_duration was 0 carry expiry_date =
	posting_date, so they were dead on arrival. Push each one out to the
	programme's real window measured from its own posting date, so a
	customer's existing balance survives the config fix instead of being
	silently written off.
	"""
	from dateutil.relativedelta import relativedelta

	rows = frappe.get_all(
		"Loyalty Point Entry",
		filters={"loyalty_points": [">", 0]},
		fields=["name", "posting_date", "expiry_date"],
	)
	fixed = 0
	for row in rows:
		if not row.posting_date:
			continue
		target = getdate(row.posting_date) + relativedelta(months=LOYALTY_EXPIRY_MONTHS)
		if row.expiry_date and getdate(row.expiry_date) >= target:
			continue
		frappe.db.set_value("Loyalty Point Entry", row.name, "expiry_date", target, update_modified=False)
		fixed += 1
	frappe.db.commit()
	return fixed


@frappe.whitelist()
def get_stock_summary(search: str = None, item_group: str = None, only_low: int = 0, item_type: str = "product"):
	"""One row per product: how much is in stock, what it cost, what it sells for.

	The three numbers a shopkeeper actually wants together lived in three
	different places — quantity in the Items screen, cost only behind
	Privacy Mode, selling price on the item form — and the Reports entry
	for "Stock Summary" opened ERPNext's own Stock Balance report, which
	never shows a selling price at all.

	Cost is the warehouse's weighted-average valuation where there has been
	stock movement, falling back to the last price actually paid and then
	the item master's own rate, so an item that has been bought but not yet
	moved still shows a real number instead of zero.

	item_type ("product" | "service" | "all") absorbs the Items screen's old
	Products/Services tabs (2026-08-17 merge: "items and stock and rates ko
	merge kro") — a service has no stock to count, but still has a name,
	category, brand and a sale rate worth seeing in the same list rather
	than a second screen.
	"""
	company = frappe.defaults.get_user_default("Company")

	conditions = ["i.disabled = 0"]
	if item_type == "service":
		conditions.append("i.is_stock_item = 0")
	elif item_type != "all":
		conditions.append("i.is_stock_item = 1")
	params = {}
	if search:
		# Barcode included on purpose: with a scanner on the counter, the
		# fastest way to answer "how many of these do we have?" is to scan
		# the thing itself rather than remember its name.
		conditions.append(
			"(i.name like %(q)s or i.item_name like %(q)s or i.custom_rack_number like %(q)s"
			" or exists (select 1 from `tabItem Barcode` ib"
			"            where ib.parent = i.name and ib.barcode like %(q)s))"
		)
		params["q"] = f"%{search}%"
	if item_group:
		conditions.append("i.item_group = %(g)s")
		params["g"] = item_group

	rows = frappe.db.sql(
		f"""
		select
			i.name                as item_code,
			i.item_name           as item_name,
			i.item_group          as item_group,
			i.brand               as brand,
			i.gst_hsn_code        as hsn_code,
			i.stock_uom           as uom,
			i.custom_rack_number  as rack,
			i.is_stock_item       as is_stock_item,
			i.last_purchase_rate  as last_purchase_rate,
			i.valuation_rate      as master_valuation_rate,
			(select sum(b.actual_qty) from `tabBin` b where b.item_code = i.name)     as qty,
			(select sum(b.stock_value) from `tabBin` b where b.item_code = i.name)    as stock_value,
			(select max(r.warehouse_reorder_level) from `tabItem Reorder` r
			  where r.parent = i.name)                                               as reorder_level,
			(select ip.price_list_rate from `tabItem Price` ip
			  where ip.item_code = i.name and ip.selling = 1 order by ip.modified desc limit 1) as sale_rate,
			(select ip.price_list_rate from `tabItem Price` ip
			  where ip.item_code = i.name and ip.buying = 1 order by ip.modified desc limit 1) as buy_rate,
			(select group_concat(ib.barcode separator ', ') from `tabItem Barcode` ib
			  where ib.parent = i.name)                                              as barcodes,
			-- This shop's stock almost never arrives via a real Purchase
			-- Invoice — items are stocked through Add Item's opening
			-- quantity or Receive Stock, both plain Material Receipt Stock
			-- Entries. Reading Purchase Invoice alone left "Last Purchase"
			-- blank for every item that actually has one (found 2026-08-18:
			-- "last purchase me koi data q naa aa raha"). Both sources are
			-- read and the newer date wins, so a shop that later starts
			-- using real Purchase Invoices is covered too.
			(select greatest(
			  ifnull((select max(pi.posting_date) from `tabPurchase Invoice Item` pii
			    inner join `tabPurchase Invoice` pi on pi.name = pii.parent
			    where pii.item_code = i.name and pi.docstatus = 1), '1900-01-01'),
			  ifnull((select max(se.posting_date) from `tabStock Entry Detail` sed
			    inner join `tabStock Entry` se on se.name = sed.parent
			    where sed.item_code = i.name and se.docstatus = 1
			      and se.stock_entry_type = 'Material Receipt'), '1900-01-01')
			)) as last_purchase_date_raw
		from `tabItem` i
		where {" and ".join(conditions)}
		order by i.item_name asc
		""",
		params,
		as_dict=True,
	)

	out = []
	for r in rows:
		is_stock_item = cint(r.is_stock_item)
		qty = flt(r.qty)
		# Cost per unit. A Kharid Daam the shop has actually typed in — via
		# Update Items In Bulk, or the item form -- WINS over the warehouse's
		# weighted average, on Ankit's direct instruction (2026-08-23: "jo mai
		# update kr rha hun wo update ho jaye, and sari value v update hogi ye
		# mujhe pata h").
		#
		# Before this, the average won whenever any stock was on hand, so an
		# edited CP silently did nothing until the shelf emptied: CP was set to
		# 900, the screen kept showing 800, and the bulk screen still said
		# "Updated". The edit had in fact saved -- only nothing ever read it.
		#
		# This deliberately moves money figures. STOCK VALUE below is qty *
		# cost, so re-pricing stock that is already on the shelf restates what
		# it is worth, and the profit card moves with it. That trade was made
		# with eyes open: the shopkeeper's own number is treated as the truth
		# about what this item costs.
		manual_cost = flt(r.buy_rate) or flt(r.master_valuation_rate)
		if manual_cost:
			cost = manual_cost
		elif qty and flt(r.stock_value):
			cost = flt(r.stock_value) / qty
		else:
			cost = flt(r.last_purchase_rate)
		sale = flt(r.sale_rate)
		reorder = flt(r.reorder_level)
		# A service has nothing to run low on — "qty <= 0" would otherwise
		# flag every service as low stock, which is meaningless for it.
		low = is_stock_item and (bool(reorder and qty <= reorder) or qty <= 0)
		if cint(only_low) and not low:
			continue
		out.append({
			"item_code": r.item_code,
			"item_name": r.item_name or r.item_code,
			"item_group": r.item_group,
			"brand": r.brand,
			"hsn_code": r.hsn_code,
			"uom": r.uom,
			"rack": r.rack,
			"barcodes": r.barcodes,
			"is_stock_item": is_stock_item,
			"qty": qty,
			"cost_rate": flt(cost, 2),
			"sale_rate": flt(sale, 2),
			# Profit on one piece at today's prices. Also drives the
			# whole-shelf PROFIT IF ALL SOLD summary card further down.
			"margin": flt(sale - cost, 2) if sale and cost else None,
			"margin_pct": flt((sale - cost) / cost * 100, 1) if sale and cost else None,
			"stock_value": flt(qty * cost, 2),
			"sale_value": flt(qty * sale, 2) if sale else 0,
			"last_purchase_date": r.last_purchase_date_raw if r.last_purchase_date_raw != "1900-01-01" else None,
			"reorder_level": reorder,
			"low": low,
		})

	summary = {
		"items": len(out),
		"total_qty": flt(sum(r["qty"] for r in out), 2),
		"stock_value": flt(sum(r["stock_value"] for r in out), 2),
		"sale_value": flt(sum(r["sale_value"] for r in out), 2),
		"low_count": sum(1 for r in out if r["low"]),
	}
	summary["potential_profit"] = flt(summary["sale_value"] - summary["stock_value"], 2)

	groups = frappe.get_all(
		"Item Group", filters={"is_group": 0}, pluck="name", order_by="name asc"
	)
	return {"rows": out, "summary": summary, "item_groups": groups, "company": company}


# ---------------------------------------------------------------------------
# Privacy Mode lock: a PIN the shop chooses, plus Touch ID on Macs that have
# registered it. Cost price is what this guards — the number that tells a
# customer leaning over the counter exactly what margin they are being asked
# to pay. It used to be guarded by the string "7739" written into this file.
# ---------------------------------------------------------------------------

PRIVACY_PIN_ITERATIONS = 200_000
PRIVACY_CHALLENGE_TTL = 120  # seconds; long enough to touch a sensor, short enough to be useless if leaked


def _privacy_settings():
	return frappe.get_single("Santu POS Settings")


def _hash_privacy_pin(pin: str, salt: bytes) -> str:
	import hashlib

	return hashlib.pbkdf2_hmac("sha256", str(pin).encode(), salt, PRIVACY_PIN_ITERATIONS).hex()


def _encode_pin_hash(pin: str) -> str:
	import os

	salt = os.urandom(16)
	return f"pbkdf2${PRIVACY_PIN_ITERATIONS}${salt.hex()}${_hash_privacy_pin(pin, salt)}"


def _verify_pin_hash(pin: str, stored: str) -> bool:
	import hashlib
	import hmac

	try:
		algo, iterations, salt_hex, digest = stored.split("$")
	except (ValueError, AttributeError):
		return False
	if algo != "pbkdf2":
		return False
	calc = hashlib.pbkdf2_hmac("sha256", str(pin).encode(), bytes.fromhex(salt_hex), int(iterations)).hex()
	# Constant-time: a PIN is short enough that timing a comparison is a
	# realistic way to guess it one digit at a time.
	return hmac.compare_digest(calc, digest)


def migrate_privacy_pin():
	"""Move any plaintext PIN into the hash, and stop honouring the built-in one.

	The PIN lived in a plain Data field, readable by anyone who could open
	the settings record, and `check_privacy_mode_pin` fell back to a
	hard-coded "7739" when it was blank — which is to say the lock was open
	by default and the key was in the source code.
	"""
	settings = _privacy_settings()
	if settings.get("privacy_pin_hash"):
		return False
	plain = (settings.get("privacy_mode_pin") or "").strip()
	if not plain:
		return False
	settings.privacy_pin_hash = _encode_pin_hash(plain)
	settings.privacy_mode_pin = ""
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return True


@frappe.whitelist()
def get_privacy_status():
	"""What the unlock screen needs to know before it asks for anything."""
	settings = _privacy_settings()
	creds = frappe.parse_json(settings.get("privacy_touch_id_credentials") or "[]")
	mine = [c for c in creds if c.get("user") == frappe.session.user]
	return {
		"pin_set": bool(settings.get("privacy_pin_hash")),
		"touch_id_devices": len(mine),
		"touch_id_names": [c.get("label") for c in mine],
		"can_manage": "System Manager" in frappe.get_roles(),
	}


@frappe.whitelist()
def set_privacy_pin(new_pin: str, current_pin: str = None):
	"""Set or change the Privacy Mode PIN."""
	new_pin = (new_pin or "").strip()
	if not new_pin.isdigit() or not (4 <= len(new_pin) <= 8):
		frappe.throw(_("The PIN must be 4 to 8 digits."))
	# Rejecting 1234/0000 here rather than in the UI: the UI is not the only
	# caller, and a PIN this guessable is the same as no PIN at all.
	if len(set(new_pin)) == 1 or new_pin in ("1234", "12345", "123456", "4321"):
		frappe.throw(_("Please choose a less obvious PIN — not all the same digit, and not 1234."))

	settings = _privacy_settings()
	existing = settings.get("privacy_pin_hash")
	if existing:
		if "System Manager" not in frappe.get_roles() and not _verify_pin_hash(current_pin or "", existing):
			frappe.throw(_("The current PIN is wrong."))
	settings.privacy_pin_hash = _encode_pin_hash(new_pin)
	settings.privacy_mode_pin = ""
	# Changing the PIN retires every fingerprint too: whoever sets a new PIN
	# is usually doing it because the old one got out, and a Touch ID device
	# registered under the old PIN would still walk straight in.
	settings.privacy_touch_id_credentials = "[]"
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True}


@frappe.whitelist()
def check_privacy_mode_pin(pin: str):
	"""Yes/no for the entered PIN. The stored value never leaves the server."""
	stored = _privacy_settings().get("privacy_pin_hash")
	if not stored:
		# No fallback PIN. An unset lock is reported as unset so the screen
		# can offer to set one, rather than quietly letting anybody in.
		return {"ok": False, "reason": "not_set"}
	return {"ok": bool(_verify_pin_hash(pin, stored))}


# --- Touch ID -------------------------------------------------------------
# WebAuthn with a platform authenticator. The Mac's Secure Enclave holds the
# private key and the fingerprint never leaves the machine — all the server
# ever stores is a public key, and all it ever checks is a signature over a
# challenge it issued moments earlier.
#
# No `webauthn` package is installed, and parsing an attestation object would
# need a CBOR decoder. It is not needed: the browser hands over the public key
# directly via PublicKeyCredential.response.getPublicKey() as SPKI DER, which
# `cryptography` reads natively. Assertions are then plain signature checks.


def _b64url_decode(data: str) -> bytes:
	import base64

	data = str(data or "")
	return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _privacy_challenge_key(purpose: str) -> str:
	return f"santu_privacy_challenge:{purpose}:{frappe.session.user}"


def _issue_challenge(purpose: str) -> str:
	import base64
	import os

	challenge = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
	frappe.cache().set_value(
		_privacy_challenge_key(purpose), challenge, expires_in_sec=PRIVACY_CHALLENGE_TTL
	)
	return challenge


def _take_challenge(purpose: str) -> str:
	"""Read and immediately burn the challenge — one use, never replayable."""
	key = _privacy_challenge_key(purpose)
	value = frappe.cache().get_value(key)
	frappe.cache().delete_value(key)
	return value


def _expected_origin() -> str:
	return frappe.utils.get_url().rstrip("/")


def _relying_party_id() -> str:
	from urllib.parse import urlparse

	# WebAuthn keys are bound to a domain, deliberately: a credential
	# registered here cannot be replayed against any other site.
	return urlparse(_expected_origin()).hostname or "localhost"


def _check_client_data(client_data_json: bytes, purpose: str, expected_type: str):
	import json as _json

	data = _json.loads(client_data_json.decode())
	if data.get("type") != expected_type:
		frappe.throw(_("This request did not come from the fingerprint prompt."))
	expected = _take_challenge(purpose)
	if not expected or data.get("challenge") != expected:
		frappe.throw(_("That fingerprint prompt has expired. Please try again."))
	if data.get("origin", "").rstrip("/") != _expected_origin():
		frappe.throw(_("This request came from an unexpected address."))


@frappe.whitelist()
def touch_id_register_options():
	"""Challenge + parameters for registering this Mac's fingerprint."""
	import base64

	if not _privacy_settings().get("privacy_pin_hash"):
		frappe.throw(_("Set a PIN first — the fingerprint is a shortcut for it, not a replacement."))
	user = frappe.session.user
	return {
		"challenge": _issue_challenge("register"),
		"rp": {"id": _relying_party_id(), "name": "Santu Hardware"},
		"user": {
			"id": base64.urlsafe_b64encode(user.encode()).decode().rstrip("="),
			"name": user,
			"displayName": frappe.db.get_value("User", user, "full_name") or user,
		},
		# -7 is ES256, which is what the Secure Enclave produces.
		"pubKeyCredParams": [{"type": "public-key", "alg": -7}],
		"timeout": PRIVACY_CHALLENGE_TTL * 1000,
	}


@frappe.whitelist()
def touch_id_register_finish(credential_id: str, public_key: str, client_data: str, label: str = None):
	"""Store the public key this Mac just generated, after re-checking the PIN."""
	import json as _json

	_check_client_data(_b64url_decode(client_data), "register", "webauthn.create")

	try:
		from cryptography.hazmat.primitives.serialization import load_der_public_key

		load_der_public_key(_b64url_decode(public_key))
	except Exception:
		frappe.throw(_("This device sent a key we could not read. Try the PIN instead."))

	settings = _privacy_settings()
	creds = frappe.parse_json(settings.get("privacy_touch_id_credentials") or "[]")
	creds = [c for c in creds if c.get("id") != credential_id]
	creds.append({
		"id": credential_id,
		"public_key": public_key,
		"user": frappe.session.user,
		"label": label or "This Mac",
		"added_on": frappe.utils.now(),
	})
	settings.privacy_touch_id_credentials = _json.dumps(creds)
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "devices": len([c for c in creds if c.get("user") == frappe.session.user])}


@frappe.whitelist()
def touch_id_login_options():
	settings = _privacy_settings()
	creds = frappe.parse_json(settings.get("privacy_touch_id_credentials") or "[]")
	mine = [c["id"] for c in creds if c.get("user") == frappe.session.user]
	if not mine:
		return {"available": False}
	return {
		"available": True,
		"challenge": _issue_challenge("login"),
		"rpId": _relying_party_id(),
		"allowCredentials": [{"type": "public-key", "id": cid} for cid in mine],
		"timeout": PRIVACY_CHALLENGE_TTL * 1000,
	}


@frappe.whitelist()
def touch_id_login_finish(credential_id: str, authenticator_data: str, client_data: str, signature: str):
	"""Verify the assertion. Only a real signature over our own challenge passes."""
	import hashlib

	from cryptography.exceptions import InvalidSignature
	from cryptography.hazmat.primitives import hashes
	from cryptography.hazmat.primitives.asymmetric import ec
	from cryptography.hazmat.primitives.serialization import load_der_public_key

	client_data_bytes = _b64url_decode(client_data)
	_check_client_data(client_data_bytes, "login", "webauthn.get")

	settings = _privacy_settings()
	creds = frappe.parse_json(settings.get("privacy_touch_id_credentials") or "[]")
	cred = next(
		(c for c in creds if c.get("id") == credential_id and c.get("user") == frappe.session.user), None
	)
	if not cred:
		frappe.throw(_("This device is not registered for fingerprint unlock."))

	auth_data = _b64url_decode(authenticator_data)
	# The authenticator must say a human was actually present (UP flag) and
	# verified (UV flag) — otherwise a fingerprint unlock could be satisfied
	# by a device that never asked anyone for a fingerprint.
	if len(auth_data) < 33:
		frappe.throw(_("The fingerprint reader sent an incomplete answer."))
	flags = auth_data[32]
	if not (flags & 0x01) or not (flags & 0x04):
		frappe.throw(_("The fingerprint was not confirmed on this device."))
	if auth_data[:32] != hashlib.sha256(_relying_party_id().encode()).digest():
		frappe.throw(_("This request came from an unexpected address."))

	signed = auth_data + hashlib.sha256(client_data_bytes).digest()
	try:
		key = load_der_public_key(_b64url_decode(cred["public_key"]))
		key.verify(_b64url_decode(signature), signed, ec.ECDSA(hashes.SHA256()))
	except InvalidSignature:
		frappe.throw(_("Fingerprint check failed."))
	except Exception:
		frappe.throw(_("Fingerprint check could not be completed. Use the PIN."))

	return {"ok": True}


# ---------------------------------------------------------------------------
# Thermal print density (Epson TM-T82X-II)
#
# The receipt reaches the printer as a PDF rendered to a pixel job through
# QZ Tray -> CUPS -> Epson's `rastertotmtr` driver. That driver exposes only
# PageSize, Resolution, PaperReduction, Buzzer/Drawer and PaperCut (verified
# against /etc/cups/ppd/EPSON_TM_T82X_II.ppd, which contains no density,
# darkness, contrast, intensity or energy keyword anywhere). So darkness
# cannot be reached through the printing path the bill itself takes.
#
# It CAN be reached over the raw ESC/POS channel the same QZ Tray connection
# already uses for the cash-drawer kick. Density on TM printers is a stored
# printer setting rather than a per-job attribute, so it is written once when
# the shop changes it — never with every bill.
#
# Command sequence, taken verbatim from Epson's ESC/POS Command Reference
# (GS ( E, Functions 1/5/2) and the TM-T82II Technical Reference Guide:
#
#   Enter user setting mode   1D 28 45 03 00 01 49 4E        ("IN")
#   Set customized value      1D 28 45 04 00 05 05 nL nH     (a=5 -> density)
#   End user setting mode     1D 28 45 04 00 02 4F 55 54     ("OUT")
#
# TRG page 55: "Print density - Selectable from levels 1 to 7 (85% ~ 115%).
# Initial setting: level 4 (100%)". Nothing outside 1-7 is ever sent.
#
# Two consequences worth knowing:
#   * Function 2 performs a software reset, so this can never be appended to
#     a receipt — it is always its own standalone job.
#   * Epson: the value is "not initialized by power off or ESC @", i.e. it
#     lives in the printer and survives everything on this side.
# ---------------------------------------------------------------------------

# The TM-T82X-II's own Technical Reference Guide, page 31:
#   "Print Density -- Selectable from -3 to +3 (light to dark). Initial
#    setting: 0"
#
# Not the 1-7 / 85%-115% scale documented for the TM-T82II, which is a
# different model. Confirmed against the hardware: writing 6 or 7 was
# silently ignored (out of range) while writing 3 read back as 3.
# Only the 0..+3 half is offered. The guide's range is -3 to +3, but the
# negative half has no working encoding over this command: sending -3 as a
# signed byte (FD 00) is rejected outright, and as 16-bit two's complement
# (FD FF) the printer stores the literal 65533 rather than -3. Since the
# problem being solved is "prints too light", the lighter half is not worth
# writing a number to the printer that it demonstrably misreads. Lighter
# settings remain available from the printer's own Software Setting Mode.
SANTU_DENSITY_MIN_LEVEL = 0
SANTU_DENSITY_MAX_LEVEL = 3
SANTU_DENSITY_DEFAULT_LEVEL = 0

SANTU_DENSITY_LEVELS = {
	0: "Normal (factory setting)",
	1: "Slightly dark",
	2: "Darker",
	3: "Darkest",
}


def _clamp_density_level(level) -> int:
	# `cint(level) or DEFAULT` would be wrong here: 0 is a real level on this
	# printer (the factory setting), not a missing value.
	if level is None or level == "":
		level = SANTU_DENSITY_DEFAULT_LEVEL
	return max(SANTU_DENSITY_MIN_LEVEL, min(SANTU_DENSITY_MAX_LEVEL, cint(level)))


@frappe.whitelist()
def get_density_levels():
	"""The levels this printer actually supports, for the slider to render."""
	return {
		"min": SANTU_DENSITY_MIN_LEVEL,
		"max": SANTU_DENSITY_MAX_LEVEL,
		"default": SANTU_DENSITY_DEFAULT_LEVEL,
		"levels": [
			{"level": lvl, "label": label} for lvl, label in sorted(SANTU_DENSITY_LEVELS.items())
		],
	}


@frappe.whitelist()
def get_printer_density(printer_name: str):
	"""Stored density for one printer, defaulting to Epson's own default."""
	settings = frappe.get_single("Santu POS Settings")
	for row in settings.get("printer_densities") or []:
		if row.printer_name == printer_name:
			level = _clamp_density_level(row.density_level)
			label = SANTU_DENSITY_LEVELS[level]
			return {
				"printer_name": printer_name,
				"level": level,
								"label": label,
				"last_applied_on": row.last_applied_on,
				"configured": True,
			}
	label = SANTU_DENSITY_LEVELS[SANTU_DENSITY_DEFAULT_LEVEL]
	return {
		"printer_name": printer_name,
		"level": SANTU_DENSITY_DEFAULT_LEVEL,
				"label": label,
		"last_applied_on": None,
		"configured": False,
	}


@frappe.whitelist()
def set_printer_density(printer_name: str, level, mark_applied: int = 0):
	"""Persist the density chosen for one printer.

	Stored in the database, not in browser state, so it survives an app
	restart, a bench restart, unplugging the printer, and an app update.
	The printer keeps its own copy too (the ESC/POS write is what actually
	changes printing); this record is what the screen shows and what gets
	re-applied if the printer is ever reset.
	"""
	if not printer_name:
		frappe.throw(_("Pick a printer first."))
	level = _clamp_density_level(level)

	settings = frappe.get_single("Santu POS Settings")
	row = next(
		(r for r in (settings.get("printer_densities") or []) if r.printer_name == printer_name), None
	)
	if not row:
		row = settings.append("printer_densities", {"printer_name": printer_name})
	row.density_level = level
	if cint(mark_applied):
		row.last_applied_on = frappe.utils.now()
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return get_printer_density(printer_name)


@frappe.whitelist()
def get_density_escpos(level):
	"""The exact bytes to send, as \\xNN escapes for QZ Tray's raw channel.

	Returned from the server rather than assembled in JavaScript so the
	1-7 clamp and the command format live in one place — a browser is not
	where a printer's stored settings should be composed.
	"""
	level = _clamp_density_level(level)
	# a = 5 (print density); value = nL + nH * 256, and 1-7 fits in nL alone.
	# Emitted as plain hex rather than "\\xNN" text: whether an escape like
	# that gets decoded depends on how the print bridge chooses to read the
	# string, and a printer command is not a place to leave that to chance.
	n_low, n_high = level, 0
	enter = "1D2845030001494E"
	set_density = f"1D284504000505{n_low:02X}{n_high:02X}"
	leave = "1D28450400024F5554"
	label = SANTU_DENSITY_LEVELS[level]
	return {
		"level": level,
				"label": label,
		# Sent as three separate raw chunks so the printer's own
		# "mode change notice" after Function 1 has a moment to come back
		# before the value is written.
		"enter_user_setting_mode": enter,
		"set_density": set_density,
		"end_user_setting_mode": leave,
		"hex_readable": f"1D 28 45 04 00 05 05 {n_low:02X} {n_high:02X}",
	}


@frappe.whitelist()
def get_printer_diagnostics(printer_name: str = None):
	"""What is actually known about how this shop's receipts reach the printer.

	Everything here is read from the machine rather than assumed: the CUPS
	queue, its device URI, and the driver's own option list from the PPD.
	"""
	import re
	import subprocess

	settings = frappe.get_single("Santu POS Settings")
	printer_name = printer_name or settings.get("printer_name")

	def run(cmd):
		try:
			return subprocess.run(cmd, capture_output=True, text=True, timeout=8).stdout
		except Exception:
			return ""

	queues = []
	for line in run(["lpstat", "-v"]).splitlines():
		m = re.match(r"device for (.+?): (.+)", line.strip())
		if m:
			queues.append({"queue": m.group(1), "uri": m.group(2)})

	# Match the QZ Tray/OS display name back to a CUPS queue. QZ reports the
	# printer's description ("EPSON TM-T82X-II") while CUPS names the queue
	# with every space and hyphen turned into an underscore
	# ("EPSON_TM_T82X_II"), so neither string matches the other directly.
	def _norm(value):
		return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")

	matched = None
	if printer_name:
		target = _norm(printer_name)
		matched = next((q for q in queues if _norm(q["queue"]) == target), None)

	uri = (matched or {}).get("uri", "")
	if uri.startswith("usb:"):
		connection = "USB"
	elif uri.startswith(("socket:", "ipp:", "ipps:", "lpd:", "dnssd:")):
		connection = "Network"
	elif uri:
		connection = uri.split(":")[0]
	else:
		connection = "Unknown"

	driver_options = []
	density_in_driver = False
	if matched:
		raw = run(["lpoptions", "-p", matched["queue"], "-l"])
		for line in raw.splitlines():
			if "/" in line and ":" in line:
				key = line.split("/")[0].strip()
				driver_options.append(key)
		density_in_driver = bool(
			re.search(r"density|darkness|contrast|intensity", raw, re.I)
		)

	density = get_printer_density(printer_name) if printer_name else None

	# Can ESC/POS actually reach this printer on this machine?
	#
	# Two independent walls, both verified on the box rather than assumed:
	#   * macOS no longer supports raw CUPS queues at all -- lpadmin answers
	#     "Raw queues are no longer supported on macOS" -- so every raw job
	#     is handed to the Epson raster filter, which renders it as nothing.
	#     That is why raw test slips came out blank, and it means the
	#     cash-drawer kick on this same path has never worked either.
	#   * QZ Tray's direct USB channel, which would bypass CUPS, answers
	#     "Sorry, this feature is unavailable at this time" without a paid
	#     QZ signing certificate.
	#
	# Until one of those is resolved there is no honest way to change
	# density from inside the app, and the screen says so rather than
	# offering a control that does nothing.
	# Density is written over a direct USB connection, not through CUPS.
	# macOS removed raw queues, so anything raw sent to a driver queue is
	# handed to Epson's raster filter and comes out blank -- which is what
	# every earlier attempt did. Reachability is therefore "can we open the
	# printer's USB endpoint", not "is there a queue".
	raw_blocked_reason = None
	try:
		import usb.core

		if usb.core.find(idVendor=SANTU_EPSON_USB_VENDOR) is None:
			raw_blocked_reason = _("The printer is not connected over USB.")
	except ImportError:
		raw_blocked_reason = _(
			"USB support is not installed on this computer, so density cannot be changed from here."
		)
	try:
		probe = subprocess.run(
			["lpadmin", "-p", "santu_raw_probe", "-m", "raw", "-v", "file:///dev/null"],
			capture_output=True, text=True, timeout=8,
		)
		if "no longer supported" not in (probe.stdout + probe.stderr).lower():
			run(["lpadmin", "-x", "santu_raw_probe"])
	except Exception:
		pass

	density_supported = raw_blocked_reason is None

	return {
		"printer_name": printer_name,
		"cups_queue": (matched or {}).get("queue"),
		"device_uri": uri or None,
		"connection": connection,
		# The bill is a rendered PDF handed to macOS's own print queue by the
		# server (`lp`), with raw USB ESC/POS as the fallback. QZ Tray is not
		# involved in printing a bill any more (2026-08-17).
		"printing_method": "macOS print queue (lp) → Epson driver; fallback: direct USB ESC/POS",
		"density_method": "Direct USB, ESC/POS (GS ( E, Function 5)",
		"driver_options": driver_options,
		"density_in_driver": density_in_driver,
		"density_supported": density_supported,
		"density_support_note": raw_blocked_reason
		or _(
			"The Epson driver exposes no darkness setting, and macOS no longer allows raw print "
			"queues, so density is written straight to the printer over USB and read back to "
			"confirm it took."
		),
		"queues_found": queues,
		"density": density,
	}


@frappe.whitelist()
def get_density_test_receipt(level=None, printer_name: str = None):
	"""A short slip whose only job is to show how dark this printer prints.

	Raw ESC/POS rather than the usual PDF path, so nothing about the real
	bill -- its layout, fonts, margins, paper width, GST or item formatting
	-- is involved or can be disturbed by a density test.

	Returned as hex for the same reason the density command is: whether a
	"\\xNN" escape gets decoded depends on how the print bridge reads the
	string, and that is not a thing to leave to chance.

	Deliberately does not cut the paper (2026-08-16 direct request) -- while
	density is being compared it is easier to hold several slips against
	each other on one continuous strip.
	"""
	if level is None:
		level = (
			get_printer_density(printer_name).get("level")
			if printer_name
			else SANTU_DENSITY_DEFAULT_LEVEL
		)
	level = _clamp_density_level(level)
	label = SANTU_DENSITY_LEVELS[level]

	ESC_INIT = b"\x1b@"
	CENTER = b"\x1b\x61\x01"
	LEFT = b"\x1b\x61\x00"
	BOLD_ON = b"\x1b\x45\x01"
	BOLD_OFF = b"\x1b\x45\x00"
	NL = b"\n"
	rule = b"-" * 32

	out = bytearray()
	out += ESC_INIT
	out += CENTER + BOLD_ON + b"SANTU HARDWARE / SantuERP" + BOLD_OFF + NL
	out += LEFT + rule + NL
	out += b"PRINT DENSITY TEST" + NL
	out += rule + NL + NL
	out += b"ABCDEFGHIJKLMNOPQRSTUVWXYZ" + NL
	out += b"abcdefghijklmnopqrstuvwxyz" + NL
	out += b"0123456789" + NL
	out += b"Rs Rs Rs Rs Rs" + NL + NL
	# A solid bar is the clearest way to judge darkness by eye. 0xDB is the
	# full block in the printer's default code page; built from a character
	# rather than an image so the driver's halftoning cannot muddy it.
	out += b"\xdb" * 24 + NL
	out += rule + NL
	out += f"Density {level} of 3".encode("ascii", "replace") + NL
	out += label.encode("ascii", "replace") + NL
	out += rule + NL
	# Feed clear of the tear bar without cutting.
	out += NL * 5

	return {
		"level": level,
				"label": label,
		"data": out.hex().upper(),
	}


# --- Direct USB transport ---------------------------------------------------
# macOS removed raw CUPS queues, so ESC/POS cannot reach the printer through
# any driver queue -- every raw job is handed to Epson's raster filter and
# comes out as blank paper. Talking to the printer's USB endpoint directly is
# the only route left, and it is the one that works: verified end to end,
# including reading settings back off the printer.
SANTU_EPSON_USB_VENDOR = 0x04B8
SANTU_USB_OUT_ENDPOINT = 0x01
SANTU_USB_IN_ENDPOINT = 0x82


def _usb_printer(retries: int = 10):
	"""Claim the Epson printer's USB interface, waiting out re-enumeration.

	GS ( E Function 2 performs a software reset, which drops the device off
	the bus for a few seconds, so anything that runs after a settings change
	has to wait for it to come back rather than fail.
	"""
	import time

	import usb.core
	import usb.util

	# Not `for _ in range(...)` — `_` is Frappe's translation function, and
	# assigning to it (even as a throwaway loop variable) shadows it for the
	# rest of this function. That turned the friendly message below into a
	# raw "TypeError: 'int' object is not callable" the one time it actually
	# needed to fire (printer genuinely not connected) — confirmed live.
	for _attempt in range(retries):
		dev = usb.core.find(idVendor=SANTU_EPSON_USB_VENDOR)
		if dev is not None:
			try:
				dev.set_configuration()
			except Exception:
				pass
			intf = dev.get_active_configuration()[(0, 0)]
			try:
				usb.util.claim_interface(dev, intf.bInterfaceNumber)
			except Exception:
				pass
			return dev, intf
		time.sleep(1)
	frappe.throw(_("The printer is not connected."))


def _usb_send(payload: bytes):
	import usb.util

	dev, intf = _usb_printer()
	try:
		dev.write(SANTU_USB_OUT_ENDPOINT, payload, timeout=8000)
	finally:
		try:
			usb.util.release_interface(dev, intf.bInterfaceNumber)
			usb.util.dispose_resources(dev)
		except Exception:
			pass


@frappe.whitelist()
def apply_printer_density(printer_name: str, level):
	"""Write the density into the printer, then read it back to prove it took.

	Reading back matters: this printer accepts out-of-range values silently.
	Writing 6 left it on its previous setting and said nothing, which is
	exactly how a density control ends up looking like it works while doing
	nothing at all.
	"""
	import time

	import usb.util

	level = _clamp_density_level(level)
	enter = bytes([0x1D, 0x28, 0x45, 0x03, 0x00, 0x01, 0x49, 0x4E])
	write = bytes([0x1D, 0x28, 0x45, 0x04, 0x00, 0x05, 0x05, level, 0x00])
	leave = bytes([0x1D, 0x28, 0x45, 0x04, 0x00, 0x02, 0x4F, 0x55, 0x54])
	query = bytes([0x1D, 0x28, 0x45, 0x02, 0x00, 0x06, 0x05])

	def drain(dev):
		out = b""
		for _ in range(12):
			try:
				out += bytes(dev.read(SANTU_USB_IN_ENDPOINT, 128, timeout=500))
			except Exception:
				pass
			if out:
				break
			time.sleep(0.25)
		return out

	dev, intf = _usb_printer()
	try:
		dev.write(SANTU_USB_OUT_ENDPOINT, enter, timeout=5000)
		drain(dev)
		time.sleep(0.5)
		dev.write(SANTU_USB_OUT_ENDPOINT, write, timeout=5000)
		time.sleep(0.8)
		# Function 2 is what commits the value -- and resets the printer.
		dev.write(SANTU_USB_OUT_ENDPOINT, leave, timeout=5000)
	finally:
		try:
			usb.util.dispose_resources(dev)
		except Exception:
			pass
	time.sleep(8)

	dev, intf = _usb_printer()
	try:
		dev.write(SANTU_USB_OUT_ENDPOINT, enter, timeout=5000)
		drain(dev)
		time.sleep(0.5)
		dev.write(SANTU_USB_OUT_ENDPOINT, query, timeout=5000)
		time.sleep(0.4)
		reply = drain(dev)
		dev.write(SANTU_USB_OUT_ENDPOINT, leave, timeout=5000)
	finally:
		try:
			usb.util.dispose_resources(dev)
		except Exception:
			pass

	# Reply looks like 37 27 35 1F <digits> 00 -- header, id, "5", separator,
	# the value as ASCII, NUL.
	readback = None
	if reply:
		try:
			readback = cint(reply.decode("latin-1").split("\x1f")[-1].replace("\x00", "").strip())
		except Exception:
			readback = None

	if readback is None or readback != level:
		frappe.throw(
			_("The printer did not accept density {0} — it is still on {1}.").format(
				level, readback if readback is not None else _("its previous setting")
			)
		)

	set_printer_density(printer_name, level, mark_applied=1)
	return {"level": level, "label": SANTU_DENSITY_LEVELS[level], "verified": True}


@frappe.whitelist()
def print_density_test(printer_name: str = None, level=None):
	receipt = get_density_test_receipt(level=level, printer_name=printer_name)
	_usb_send(bytes.fromhex(receipt["data"]))
	return receipt


@frappe.whitelist()
def list_printers():
	"""Printers the OS knows about, read from CUPS.

	Deliberately not via QZ Tray: density is written over USB from the
	server now, so the Printer Settings screen has no other reason to need
	a browser bridge — and waiting on one left the screen stuck on
	"Looking for printers…" whenever QZ had not been allowed yet in that
	browser session.
	"""
	import re
	import subprocess

	names = []
	try:
		out = subprocess.run(["lpstat", "-v"], capture_output=True, text=True, timeout=8).stdout
		for line in out.splitlines():
			m = re.match(r"device for (.+?):", line.strip())
			if m:
				names.append(m.group(1))
	except Exception:
		pass

	# QZ Tray reports a printer by its description ("EPSON TM-T82X-II") while
	# CUPS names the queue with underscores, and the stored setting may hold
	# either. Offer the stored one too so the screen can always select it.
	current = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if current and current not in names:
		names.insert(0, current)
	return names


def clear_district_villages():
	"""Blank out santu_village wherever it actually holds a district.

	Party creation used to put the district ("Saran") into the city/village
	field, and the backfill above then copied that onto the Customer, so every
	party on file claims a village nobody lives in. Reads already ignore a
	district in this field, but leaving the value stored means any screen
	querying the column directly still sees it — and it looks answered, so the
	real village never gets asked for. The Address row itself is left alone:
	city is mandatory there, and the district is at least true.
	"""
	cleared = 0
	for party_type in ("Customer", "Supplier"):
		if not frappe.db.has_column(party_type, "santu_village"):
			continue
		for name, village in frappe.get_all(
			party_type,
			filters={"santu_village": ["not in", [None, ""]]},
			fields=["name", "santu_village"],
			as_list=True,
		):
			if is_district_name(village):
				frappe.db.set_value(party_type, name, "santu_village", "", update_modified=False)
				cleared += 1
	frappe.db.commit()
	return cleared


def backfill_party_villages():
	"""Copy each party's address city into santu_village where it's blank.

	The village and the address were two records of the same fact and only
	one was ever written by the newer party-creation flow, so parties with a
	real address still read "No village on file". Reads now fall back to the
	address, but storing it keeps filtering and reporting (which query the
	column directly) honest too. Only fills blanks — never overwrites a
	village someone typed.
	"""
	filled = 0
	for party_type in ("Customer", "Supplier"):
		field = "santu_village"
		if not frappe.db.has_column(party_type, field):
			continue
		for name in frappe.get_all(
			party_type, filters={field: ["in", [None, ""]]}, pluck="name"
		):
			city = party_village(party_type, name, None)
			if city:
				frappe.db.set_value(party_type, name, field, city, update_modified=False)
				filled += 1
	frappe.db.commit()
	return filled


