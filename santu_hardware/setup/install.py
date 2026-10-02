import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def after_install():
	"""Runs once when santu_hardware is installed on a site.

	Order matters: UOMs first (Item custom fields don't depend on them, but
	keeping setup steps in a predictable sequence makes re-running easier to
	reason about if a step is re-triggered manually).
	"""
	create_hardware_uoms()
	create_item_location_fields()
	create_item_pricing_fields()
	create_wholesale_price_list()
	create_stock_adjustment_reason_field()
	create_item_search_keywords_field()
	create_purchase_bill_pdf_field()
	create_batch_pricing_fields()
	create_transaction_message_fields()
	create_transaction_message_defaults()
	hide_vendor_navbar_items()
	apply_santu_branding()
	hide_commission_field()
	set_default_print_format()

	# Back on (2026-09-06 direct request) — see the matching entry in
	# hooks.py's after_migrate list.
	from santu_hardware.santu_hardware.api import ensure_loyalty_setup
	ensure_loyalty_setup()
	enforce_unique_supplier_bill_numbers()
	enable_auto_backup()
	pin_selling_warehouse()


def create_hardware_uoms():
	"""Create the Units of Measure this store actually sells in.

	BUSINESS_RULES.md SS4.1 gives the real conversions this shop needs:
	1 Box = 20 Pieces, 1 Bundle = 10 Pipes, 1 Packet = 50 Pieces, 1 Can = 20 Litre.
	"Nos" and "Litre" are the base units those roll up to; Box/Bundle/Packet/Can
	are the purchase-pack units. The site was set up via bench CLI rather than
	the browser Setup Wizard, so none of ERPNext's default UOMs exist yet.

	must_be_whole_number is off for every UOM -- see allow_fractional_quantities.
	"""
	uoms = [
		{"uom_name": "Nos", "must_be_whole_number": 0},
		{"uom_name": "Litre", "must_be_whole_number": 0},
		{"uom_name": "Box", "must_be_whole_number": 0},
		{"uom_name": "Bundle", "must_be_whole_number": 0},
		{"uom_name": "Packet", "must_be_whole_number": 0},
		{"uom_name": "Can", "must_be_whole_number": 0},
	]

	for uom in uoms:
		if frappe.db.exists("UOM", uom["uom_name"]):
			continue
		doc = frappe.new_doc("UOM")
		doc.update(uom)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()


def create_item_location_fields():
	"""Add Rack/Shelf/Bin location fields to Item.

	DATABASE_RULES.md SS2 calls these out explicitly as custom fields (not a new
	DocType) because ERPNext's Item has no concept of physical shelf location.
	Grouped under their own section so they read as "where is this in the shop",
	separate from Item's native Inventory section (which is about stock
	accounting, not physical location).
	"""
	custom_fields = {
		"Item": [
			{
				"fieldname": "santu_location_section",
				"label": "Shop Location",
				"fieldtype": "Section Break",
				"insert_after": "brand",
				"collapsible": 1,
			},
			{
				"fieldname": "custom_rack_number",
				"label": "Rack Number",
				"fieldtype": "Data",
				"insert_after": "santu_location_section",
			},
			{
				"fieldname": "custom_shelf_number",
				"label": "Shelf Number",
				"fieldtype": "Data",
				"insert_after": "custom_rack_number",
			},
			{
				"fieldname": "custom_column_break_location",
				"fieldtype": "Column Break",
				"insert_after": "custom_shelf_number",
			},
			{
				"fieldname": "custom_bin_location",
				"label": "Bin Location",
				"fieldtype": "Data",
				"insert_after": "custom_column_break_location",
				"description": "Free-text spot description, e.g. 'Left wall, top row'",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_item_search_keywords_field():
	"""Add a free-text search-keywords field to Item.

	ROADMAP.md Phase 2.5 Product Search: staff search by manufacturer name
	("Pidilite"), generic category words ("switch"), or common misspellings
	that don't appear anywhere in a well-composed item name/brand/category.
	No native ERPNext field covers this — a plain space-separated keyword
	bag, matched as one more (lower-weighted) signal in the ranked search,
	not a structured taxonomy (PRODUCT_MASTER_RULES.md already covers
	structured attributes; this is deliberately unstructured and optional).
	"""
	custom_fields = {
		"Item": [
			{
				"fieldname": "custom_search_keywords",
				"label": "Search Keywords",
				"fieldtype": "Small Text",
				"insert_after": "item_name",
				"description": "Optional. Space-separated alternate names, manufacturer, common misspellings — e.g. 'pidilite fevikwik glue'.",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_item_pricing_fields():
	"""MRP, floor price and the GST on/off switch — the three price facts
	ERPNext has no home for.

	ERPNext keeps rates in Item Price (one row per price list), which covers
	selling, buying and wholesale properly and is reused as-is. But it has
	no concept of a printed MRP, no "never sell below this" floor, and no
	per-item way to say "this one isn't a GST sale at all" — and all three
	are things a hardware counter genuinely works with (2026-08-18 direct
	request: the Add Item screen must carry everything needed later for
	billing, purchase, stock, barcode, GST/non-GST and reporting).

	Deliberately NOT duplicated here, because ERPNext already has them:
	brand, description, disabled (Active/Inactive), item_group (Category),
	stock_uom (Unit), barcodes (multiple, with type), reorder_levels
	(Min Stock), item_defaults.default_supplier, supplier_items (supplier
	item code), last_purchase_rate, has_batch_no, and gst_hsn_code.
	"""
	custom_fields = {
		"Item": [
			{
				"fieldname": "santu_pricing_section",
				"label": "Shop Pricing",
				"fieldtype": "Section Break",
				"insert_after": "custom_bin_location",
				"collapsible": 1,
			},
			{
				"fieldname": "custom_mrp",
				"label": "MRP",
				"fieldtype": "Currency",
				"insert_after": "santu_pricing_section",
				"description": "Printed maximum retail price. A batch can override this with its own MRP.",
			},
			{
				"fieldname": "custom_min_selling_price",
				"label": "Minimum Selling Price",
				"fieldtype": "Currency",
				"insert_after": "custom_mrp",
				"description": "Floor price — the counter should not sell below this.",
			},
			{
				"fieldname": "custom_column_break_pricing",
				"fieldtype": "Column Break",
				"insert_after": "custom_min_selling_price",
			},
			{
				"fieldname": "custom_gst_applicable",
				"label": "GST Applicable",
				"fieldtype": "Check",
				"default": "0",
				"insert_after": "custom_column_break_pricing",
				"description": "Off for a plain non-GST sale — no HSN is forced and no GST is worked out for this item.",
			},
			{
				"fieldname": "custom_no_reward_points",
				"label": "No Reward Points",
				"fieldtype": "Check",
				"default": "0",
				"insert_after": "custom_gst_applicable",
				"description": (
					"On for an item that must not earn reward points — cement, "
					"a Udhaar/Purana Baki adjustment line, anything sold at no "
					"margin. The rest of the bill still earns normally."
				),
			},
			{
				"fieldname": "custom_sub_category",
				"label": "Sub Category",
				"fieldtype": "Link",
				"options": "Item Group",
				"insert_after": "custom_no_reward_points",
				"description": "Optional second level under Category.",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_wholesale_price_list():
	"""A real Price List for wholesale rates.

	The Add Item screen already had a "Wholesale Price" box, but nothing
	ever stored it — save_item dropped it on the floor along with the tax
	rate and discount (found 2026-08-18). Item Price is the right home; it
	just needs the list to exist for the rate to hang off.
	"""
	if frappe.db.exists("Price List", "Wholesale"):
		return
	doc = frappe.get_doc(
		{
			"doctype": "Price List",
			"price_list_name": "Wholesale",
			"selling": 1,
			"buying": 0,
			"enabled": 1,
			"currency": frappe.defaults.get_global_default("currency") or "INR",
		}
	)
	doc.insert(ignore_permissions=True)


def create_stock_adjustment_reason_field():
	"""Add a Reason field to Stock Reconciliation.

	UX_STRATEGY.md SS4.5: a stock correction made with no reason recorded is
	cheap to skip and expensive later (nobody remembers why stock dropped).
	Stock Reconciliation has no native field for this — a plain Select
	keeps it a one-tap choice, not a text field nobody bothers filling in.
	"""
	custom_fields = {
		"Stock Reconciliation": [
			{
				"fieldname": "custom_adjustment_reason",
				"label": "Reason",
				"fieldtype": "Select",
				"options": "\nDamage\nTheft\nCount Correction\nOther",
				"insert_after": "purpose",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_batch_pricing_fields():
	"""Give a batch its own MRP and purchase rate — its identity, not just a number.

	ERPNext's native Batch doctype has no price fields at all; the selling
	side already has one (Item Price carries an optional `batch_no`), but
	nothing records what a batch actually cost or what its MRP was. For a
	shop where the same item can arrive at a different rate every purchase
	(2026-08-17 direct request: "har batch ka alag purchase and selling
	value... mrp ko batch ka hissa bana sakte hai"), that is exactly the
	fact worth keeping — it is why one item can carry several batches with
	different economics instead of one blended average.
	"""
	custom_fields = {
		"Batch": [
			{
				"fieldname": "custom_mrp",
				"label": "MRP",
				"fieldtype": "Currency",
				"insert_after": "batch_qty",
				"description": "Printed maximum retail price for this batch.",
			},
			{
				"fieldname": "custom_purchase_rate",
				"label": "Purchase Rate",
				"fieldtype": "Currency",
				"insert_after": "custom_mrp",
				"description": "What this batch actually cost, per unit.",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_purchase_bill_pdf_field():
	"""Add an Attach field to Purchase Invoice for the original supplier
	bill PDF.

	2026-08-02: the "Upload Supplier Bill (PDF)" feature builds a Purchase
	Invoice from an uploaded bill (santu_hardware.api.get_purchase_invoice_from_bill_pdf)
	— this field is where that source file is linked once the user saves,
	so the original bill stays attached to the record it created for as
	long as the invoice exists (audit trail: "where did these numbers come
	from"), not just sitting in the general Files list disconnected from
	the invoice it produced.
	"""
	custom_fields = {
		"Purchase Invoice": [
			{
				"fieldname": "custom_source_bill_pdf",
				"label": "Source Bill (PDF)",
				"fieldtype": "Attach",
				"insert_after": "bill_no",
				"read_only": 1,
				"description": "Auto-filled when this invoice was created from Upload Supplier Bill (PDF).",
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_transaction_message_fields():
	"""WhatsApp number on parties and status on invoices."""
	custom_fields = {
		"Customer": [
			{
				"fieldname": "custom_whatsapp_number",
				"label": "WhatsApp Number",
				"fieldtype": "Data",
				"insert_after": "mobile_no",
				"description": "Preferred number for WhatsApp transaction messages",
			},
		],
		"Supplier": [
			{
				"fieldname": "custom_whatsapp_number",
				"label": "WhatsApp Number",
				"fieldtype": "Data",
				"insert_after": "mobile_no",
			},
		],
		"Sales Invoice": [
			{
				"fieldname": "custom_whatsapp_status",
				"label": "WhatsApp Status",
				"fieldtype": "Data",
				"insert_after": "status",
				"read_only": 1,
				"no_copy": 1,
			},
			{
				# Set only on a bill that waited in the counter's offline queue.
				# The counter generates the key BEFORE the first attempt, so a
				# retry after a timeout (where the first attempt may actually
				# have succeeded) can be recognised instead of billing twice.
				"fieldname": "custom_offline_key",
				"label": "Offline Key",
				"fieldtype": "Data",
				"insert_after": "custom_whatsapp_status",
				"read_only": 1,
				"no_copy": 1,
				"unique": 1,
			},
			{
				"fieldname": "custom_payment_summary_section",
				"label": "Payment Summary",
				"fieldtype": "Section Break",
				"insert_after": "outstanding_amount",
				"collapsible": 0,
			},
			{
				"fieldname": "custom_total_bill_amount",
				"label": "Total Bill Amount",
				"fieldtype": "Currency",
				"insert_after": "custom_payment_summary_section",
				"read_only": 1,
				"options": "currency",
				"description": "Total amount of the invoice",
			},
			{
				"fieldname": "custom_payment_received",
				"label": "Amount Paid",
				"fieldtype": "Currency",
				"insert_after": "custom_total_bill_amount",
				"read_only": 1,
				"options": "currency",
				"description": "Amount already paid by customer",
			},
			{
				"fieldname": "custom_payment_col_break",
				"fieldtype": "Column Break",
				"insert_after": "custom_payment_received",
			},
			{
				"fieldname": "custom_balance_remaining",
				"label": "Balance Due",
				"fieldtype": "Currency",
				"insert_after": "custom_payment_col_break",
				"read_only": 1,
				"options": "currency",
				"description": "Amount still pending payment",
			},
		],
		"POS Invoice": [
			{
				"fieldname": "custom_whatsapp_status",
				"label": "WhatsApp Status",
				"fieldtype": "Data",
				"insert_after": "status",
				"read_only": 1,
				"no_copy": 1,
			},
		],
		"Purchase Invoice": [
			{
				"fieldname": "custom_whatsapp_status",
				"label": "WhatsApp Status",
				"fieldtype": "Data",
				"insert_after": "status",
				"read_only": 1,
				"no_copy": 1,
			},
		],
	}
	create_custom_fields(custom_fields, ignore_validate=True)


def create_transaction_message_defaults():
	from santu_hardware.santu_hardware.transaction_message_service import ensure_default_templates

	msg = frappe.get_single("Santu Transaction Message Settings")
	ensure_default_templates(msg)
	msg.save(ignore_permissions=True)
	frappe.db.commit()


# Which navbar dropdown entries a hardware shop owner should never be shown.
# All of these are Frappe/ERPNext vendor or developer surface, not shop
# features (2026-08-15 direct request, after auditing the topbar: "if
# hardware shop owner has no use for this then remove it naa, delete it").
#
# Deliberately NOT hidden, and why:
#   My Profile / My Settings — the only place a user can change their own
#     password and notification preferences.
#   Reload — clears the client cache; the honest fix when a screen is stale,
#     which is otherwise a support call.
#   Toggle Theme, Log out — plain preferences a shop owner does use.
SANTU_HIDDEN_NAVBAR_ITEMS = {
	# Help dropdown — every entry points at Frappe's own docs/forum/school/
	# GitHub/paid support. None of it is about this shop's software.
	"Documentation",
	"User Forum",
	"Frappe School",
	"Report an Issue",
	"About",
	"Keyboard Shortcuts",
	"Frappe Support",
	# Settings dropdown — developer/multi-app concepts.
	"Session Defaults",
	"View Website",
	"Apps",
	"Toggle Full Width",
}


def hide_vendor_navbar_items():
	"""Hide Frappe's vendor/developer navbar entries.

	Uses Navbar Settings' own `hidden` flag rather than removing rows or
	patching the DOM, so a Frappe upgrade that re-seeds the table just gets
	re-hidden on the next migrate instead of silently reappearing.
	"""
	settings = frappe.get_single("Navbar Settings")
	changed = False
	for table in ("help_dropdown", "settings_dropdown"):
		for row in settings.get(table) or []:
			should_hide = row.item_label in SANTU_HIDDEN_NAVBAR_ITEMS
			if should_hide and not row.hidden:
				row.hidden = 1
				changed = True
	if changed:
		settings.save(ignore_permissions=True)
		frappe.db.commit()
	return changed


SANTU_LOGO_URL = "/assets/santu_hardware/images/logo.svg"
# wkhtmltopdf (the PDF engine behind Print/WhatsApp document links) can't
# rasterize SVG — any print format or Company logo pointing at the .svg
# renders with a broken image link and the PDF fails outright. A pre-rendered
# PNG (public/images/logo.png, built via `rsvg-convert`) is what anything
# that goes through wkhtmltopdf must use instead; the crisp SVG stays for the
# in-app navbar/website, which render in a real browser.
SANTU_LOGO_PNG_URL = "/assets/santu_hardware/images/logo.png"
SANTU_FAVICON_PNG_URL = "/assets/santu_hardware/images/logo-favicon.png"


def apply_santu_branding():
	"""Put the shop's own logo where Frappe would otherwise show its own.

	hooks.py's `app_logo_url` only wins when Navbar Settings has nothing
	set — a fresh site, or one set up before this app existed, can still
	have Navbar/Website Settings pointing at nothing (falling back to
	Frappe's own framework logo) or at an old value. Setting it here
	directly is what actually guarantees the navbar and the website show
	this shop's mark, rather than depending on hook-resolution order.
	"""
	changed = False

	navbar = frappe.get_single("Navbar Settings")
	if navbar.app_logo != SANTU_LOGO_URL:
		navbar.app_logo = SANTU_LOGO_URL
		navbar.save(ignore_permissions=True)
		changed = True

	website = frappe.get_single("Website Settings")
	website_changed = False
	if website.app_logo != SANTU_LOGO_URL:
		website.app_logo = SANTU_LOGO_URL
		website_changed = True
	if website.favicon != SANTU_FAVICON_PNG_URL:
		website.favicon = SANTU_FAVICON_PNG_URL
		website_changed = True
	if website_changed:
		website.save(ignore_permissions=True)
		changed = True

	# SEED ONLY — never overwrite. The company logo is the one branding
	# field the shop owner edits themselves, on Utilities > Shop Profile.
	# This ran on EVERY `bench migrate` (after_migrate hook) and forced the
	# bundled app logo back, so an uploaded logo silently reverted to "the
	# same old logo" the next time the app was updated (2026-09-05 bug
	# report). Same rule as _save_company_address: a default exists to fill
	# an empty field, not to undo the owner's choice.
	company = frappe.db.get_value("Company", {}, "name")
	if company and not frappe.db.get_value("Company", company, "company_logo"):
		frappe.db.set_value("Company", company, "company_logo", SANTU_LOGO_PNG_URL)
		changed = True

	if changed:
		frappe.db.commit()
	return changed


SANTU_COMMISSION_FIELD_DOCTYPES = ("Sales Invoice", "Sales Order", "POS Invoice", "Delivery Note")


def hide_commission_field():
	"""Hide "Amount Eligible for Commission" everywhere it's native to ERPNext.

	This shop has no Sales Team/commission setup, so the field never carries
	real data — it just sits there confusing whoever opens the native form
	(2026-08-16 direct request: "hata, wo accha sa data carry nh kr paa
	raha"). A Property Setter, not a form-script hide, so it stays hidden
	from every entry point (list view, native form, print) not only the
	desk form JS could reach.
	"""
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	for doctype in SANTU_COMMISSION_FIELD_DOCTYPES:
		make_property_setter(doctype, "amount_eligible_for_commission", "hidden", 1, "Check", validate_fields_for_doctype=False)
	frappe.db.commit()


SANTU_SALES_PRINT_FORMAT = "Santu Hardware Bill (Sales Invoice)"


def set_default_print_format():
	"""Point Sales Invoice printing at this shop's own bill.

	A Property Setter had the default on "GST Tax Invoice", so the print view
	showed a formal tax invoice (HSN/SAC columns, "Generated By: Administrator")
	while the counter's thermal printer produced the shop's own bill — one
	button, two different-looking documents (2026-08-16 bug report: "same print
	nh ho rha"). The shop's format carries GSTIN and the TAX INVOICE heading
	itself, so nothing legally required is lost by defaulting to it.
	"""
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	if not frappe.db.exists("Print Format", SANTU_SALES_PRINT_FORMAT):
		return False
	current = frappe.db.get_value(
		"Property Setter",
		{"doc_type": "Sales Invoice", "property": "default_print_format"},
		"value",
	)
	if current == SANTU_SALES_PRINT_FORMAT:
		return False
	make_property_setter(
		"Sales Invoice", None, "default_print_format", SANTU_SALES_PRINT_FORMAT, "Data",
		for_doctype=True, validate_fields_for_doctype=False,
	)
	frappe.db.commit()
	return True


def pin_selling_warehouse():
	"""Write down which warehouse the shop sells from, before a second exists.

	While there is exactly one warehouse the answer is obvious and this just
	records it. That is the entire point: it has to be recorded *before* the
	old shop's warehouse is created, because after that "the obvious one" is
	whichever row the database happens to return first.
	"""
	current = frappe.db.get_single_value("Santu POS Settings", "selling_warehouse")
	if current and frappe.db.exists("Warehouse", current):
		return False

	candidates = frappe.get_all(
		"Warehouse",
		filters={"is_group": 0, "disabled": 0},
		fields=["name"],
		order_by="creation asc",
	)
	if len(candidates) != 1:
		# Zero: nothing set up yet. More than one: a human must choose, and
		# guessing here is the exact failure this function exists to prevent.
		return False

	frappe.db.set_single_value("Santu POS Settings", "selling_warehouse", candidates[0].name)
	frappe.db.commit()
	return True


def _is_clean_backup_time(value) -> bool:
	try:
		parts = [int(x) for x in str(value or "").split(":")]
	except (ValueError, TypeError):
		return False
	return len(parts) == 3 and 0 <= parts[0] < 24 and 0 <= parts[1] < 60 and 0 <= parts[2] < 60


def enable_auto_backup():
	"""Turn the nightly backup on, and keep it on.

	The whole backup service was already built and working, but
	`auto_backup_enabled` sat at 0 — so the shop had a backup screen, a
	backup log and no backups. Nobody is going to notice a switch that is
	off, which is exactly why this is set here rather than left to the UI.
	"""
	settings = frappe.get_single("Santu Backup Settings")
	changed = False
	if not frappe.utils.cint(settings.auto_backup_enabled):
		settings.auto_backup_enabled = 1
		changed = True
	if not settings.backup_frequency:
		settings.backup_frequency = "Daily"
		changed = True
	# The stored value had drifted to "12:13:49.655113" — whatever clock a
	# manual backup happened to run at, complete with microseconds. It only
	# survived because compute_next_backup_time() falls back to 02:00 when
	# parsing fails. Normalise it so the schedule is what it says it is.
	if not _is_clean_backup_time(settings.backup_time):
		settings.backup_time = "02:00:00"
		changed = True
	if not frappe.utils.cint(settings.retention_count):
		settings.retention_count = 10
		changed = True
	if not settings.next_backup_on:
		changed = True

	if not changed:
		return False

	from santu_hardware.santu_hardware.backup_service import compute_next_backup_time

	settings.next_backup_on = compute_next_backup_time(settings)
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return True


def enforce_unique_supplier_bill_numbers():
	"""Refuse the same supplier bill number twice.

	Purchase bills arrive here as PDFs and get imported, and re-importing
	the same PDF is an easy mistake — the setup already had two drafts of
	supplier bill JCS/2025-26/1220 sitting side by side. With this off,
	both could be submitted and the shop would pay the same bill twice
	with nothing on screen to suggest anything was wrong.
	"""
	if not frappe.db.get_single_value("Accounts Settings", "check_supplier_invoice_uniqueness"):
		frappe.db.set_single_value("Accounts Settings", "check_supplier_invoice_uniqueness", 1)
		frappe.db.commit()
		return True
	return False


def uom_allow_fraction(doc, method=None):
	doc.must_be_whole_number = 0


def allow_fractional_quantities():
	"""Turn the "Must be Whole Number" lock off on every UOM.

	2026-09-18: a counter bill stopped with "Row 7: Quantity (9.5) cannot be
	a fraction ... in UOM Nos". The shop sells loose and cut goods by the
	half, and a bill that cannot be saved is worse than any typo the lock
	might catch. Re-asserted after every migrate, and UOM validate keeps new
	units the same, so it cannot come back.
	"""
	frappe.db.sql("update `tabUOM` set must_be_whole_number = 0 where must_be_whole_number = 1")
	frappe.db.commit()



def create_payment_request_key_field():
	"""Payment Entry.custom_request_key -- one Save on the Payment In/Out
	screen = one payment, even if the click repeats or the network retries
	(2026-09-19). Hidden; never copied to an amended payment."""
	create_custom_fields({
		"Payment Entry": [{
			"fieldname": "custom_request_key", "label": "Request Key", "fieldtype": "Data",
			"hidden": 1, "read_only": 1, "no_copy": 1, "insert_after": "remarks", "search_index": 1,
		}]
	}, ignore_validate=True)
