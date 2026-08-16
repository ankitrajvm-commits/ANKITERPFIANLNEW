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
	create_stock_adjustment_reason_field()
	create_item_search_keywords_field()
	create_purchase_bill_pdf_field()
	create_transaction_message_fields()
	create_transaction_message_defaults()
	hide_vendor_navbar_items()

	from santu_hardware.santu_hardware.api import ensure_loyalty_setup

	ensure_loyalty_setup()
	enforce_unique_supplier_bill_numbers()


def create_hardware_uoms():
	"""Create the Units of Measure this store actually sells in.

	BUSINESS_RULES.md SS4.1 gives the real conversions this shop needs:
	1 Box = 20 Pieces, 1 Bundle = 10 Pipes, 1 Packet = 50 Pieces, 1 Can = 20 Litre.
	"Nos" and "Litre" are the base units those roll up to; Box/Bundle/Packet/Can
	are the purchase-pack units. The site was set up via bench CLI rather than
	the browser Setup Wizard, so none of ERPNext's default UOMs exist yet.

	must_be_whole_number is False only for Litre — paint is sold in fractional
	litres (e.g. 2.5L custom-mixed), everything else here is counted in whole units.
	"""
	uoms = [
		{"uom_name": "Nos", "must_be_whole_number": 1},
		{"uom_name": "Litre", "must_be_whole_number": 0},
		{"uom_name": "Box", "must_be_whole_number": 1},
		{"uom_name": "Bundle", "must_be_whole_number": 1},
		{"uom_name": "Packet", "must_be_whole_number": 1},
		{"uom_name": "Can", "must_be_whole_number": 1},
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
