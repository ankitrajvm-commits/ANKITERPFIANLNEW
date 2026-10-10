"""Transaction message generation, sending, and auto-trigger logic."""

from __future__ import annotations

import re
from datetime import datetime

import frappe
from frappe.utils import flt, format_datetime, get_url, now_datetime, today

from santu_hardware.santu_hardware.whatsapp_provider import (
	WhatsAppProviderError,
	get_whatsapp_provider,
	is_whatsapp_configured,
)

TRANSACTION_TYPES = [
	"Sales Transaction",
	"Purchase Transaction",
	"Sales Return",
	"Purchase Return",
	"Payment In",
	"Payment Out",
	"Sales Order",
	"Purchase Order",
	"Estimate / Quotation",
	"Proforma Invoice",
	"Delivery Challan",
	"Cancelled Invoice",
]

DEFAULT_TEMPLATES = {
	# No payment figures here on purpose (2026-09-25): the attached bill already
	# shows the total, what was paid and the account balance, and repeating it
	# in the chat made the message long and easy to misread. The message just
	# says which bill is attached.
	"Sales Transaction": """🧾 *{{ company_name }}*

Hi {{ customer_name }},

*Bill No:* {{ invoice_no }}
*Date:* {{ posting_date }}{{ invoice_link_line }}

We appreciate your business 🙏""",
	"Purchase Transaction": """🧾 *{{ company_name }}*

Hi {{ supplier_name }},

We've recorded a purchase from you.

*Bill No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}

Thank you!""",
	"Sales Return": """🧾 *{{ company_name }}*

Hi {{ customer_name }},

*Credit Note:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}

Thank you!""",
	"Purchase Return": """🧾 *{{ company_name }}*

Hi {{ supplier_name }},

A purchase return has been recorded.

*Debit Note:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}""",
	"Payment In": """✅ *{{ company_name }}*

Hi {{ party_name }},

*Amount Received:* ₹{{ paid_amount }}
*Reference:* {{ invoice_no }}
*Date:* {{ posting_date }}{{ balance_note_line }}""",
	"Payment Out": """*{{ company_name }}*

Hi {{ party_name }},

A payment of ₹{{ paid_amount }} has been processed.

*Reference:* {{ invoice_no }}
*Date:* {{ posting_date }}""",
	"Sales Order": """🧾 *{{ company_name }}*

Hi {{ customer_name }},

Your Sales Order has been created.

*Order No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}{{ invoice_link_line }}

Thank you!""",
	"Purchase Order": """🧾 *{{ company_name }}*

Hi {{ supplier_name }},

A Purchase Order has been created.

*Order No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}""",
	"Estimate / Quotation": """🧾 *{{ company_name }}*

Hi {{ customer_name }},

*Estimate No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}{{ invoice_link_line }}

Let us know if you'd like to go ahead!""",
	"Proforma Invoice": """🧾 *{{ company_name }}*

Hi {{ customer_name }},

*Proforma Invoice:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}{{ invoice_link_line }}""",
	"Delivery Challan": """🚚 *{{ company_name }}*

Hi {{ customer_name }},

*Delivery Challan:* {{ invoice_no }}
*Date:* {{ posting_date }}""",
	"Cancelled Invoice": """*{{ company_name }}*

Hi {{ customer_name }},

Invoice {{ invoice_no }} dated {{ posting_date }} has been cancelled.""",
}

DOCTYPE_TRANSACTION_MAP = [
	("Sales Invoice", lambda d: "Cancelled Invoice" if d.docstatus == 2 else ("Sales Return" if getattr(d, "is_return", 0) else "Sales Transaction")),
	("POS Invoice", lambda d: "Sales Return" if getattr(d, "is_return", 0) else "Sales Transaction"),
	("Purchase Invoice", lambda d: "Purchase Return" if getattr(d, "is_return", 0) else "Purchase Transaction"),
	("Payment Entry", lambda d: "Payment In" if d.payment_type == "Receive" else "Payment Out"),
	("Sales Order", lambda d: "Sales Order"),
	("Purchase Order", lambda d: "Purchase Order"),
	("Quotation", lambda d: "Estimate / Quotation"),
	("Delivery Note", lambda d: "Delivery Challan"),
]


def ensure_default_templates(settings_doc=None):
	settings_doc = settings_doc or frappe.get_single("Santu Transaction Message Settings")
	existing = {row.transaction_type for row in settings_doc.templates}
	for tx_type, template in DEFAULT_TEMPLATES.items():
		if tx_type not in existing:
			settings_doc.append(
				"templates",
				{"transaction_type": tx_type, "enabled": 1, "auto_send": tx_type in ("Sales Transaction", "Payment In"), "message_template": template},
			)


def normalize_indian_phone(phone: str) -> str | None:
	if not phone:
		return None
	digits = re.sub(r"\D", "", str(phone))
	if len(digits) == 10:
		return "91" + digits
	if len(digits) == 11 and digits.startswith("0"):
		return "91" + digits[1:]
	if len(digits) == 12 and digits.startswith("91"):
		return digits
	if len(digits) >= 10:
		return digits
	return None


def get_party_phone(party_type: str, party_name: str, phone_field: str = "mobile") -> str | None:
	if not party_type or not party_name:
		return None
	if not frappe.db.exists(party_type, party_name):
		return None

	whatsapp = frappe.db.get_value(party_type, party_name, "custom_whatsapp_number")
	if whatsapp:
		return normalize_indian_phone(whatsapp)

	# Customer/Supplier only ever have a "mobile_no" column, never "phone"
	# (that's a Contact/Lead/User field) — querying a column that doesn't
	# exist on the doctype throws a raw SQL error, so only try each field
	# the meta actually has.
	meta = frappe.get_meta(party_type)
	fields_to_try = ["phone", "mobile_no"] if phone_field == "phone" else ["mobile_no", "phone"]
	raw = None
	for f in fields_to_try:
		if meta.has_field(f):
			raw = frappe.db.get_value(party_type, party_name, f)
			if raw:
				break

	if not raw and party_type in ("Customer", "Supplier"):
		contact = frappe.db.sql(
			"""SELECT phone, mobile_no FROM `tabContact` c
			INNER JOIN `tabDynamic Link` dl ON dl.parent = c.name
			WHERE dl.link_doctype = %s AND dl.link_name = %s
			ORDER BY c.modified DESC LIMIT 1""",
			(party_type, party_name),
			as_dict=True,
		)
		if contact:
			raw = contact[0].mobile_no or contact[0].phone

	return normalize_indian_phone(raw)


def resolve_transaction_type(doc) -> str | None:
	for doctype, resolver in DOCTYPE_TRANSACTION_MAP:
		if doc.doctype == doctype:
			return resolver(doc)
	return None


def get_template(transaction_type: str) -> str | None:
	settings = frappe.get_single("Santu Transaction Message Settings")
	for row in settings.templates:
		if row.transaction_type == transaction_type and row.enabled:
			return row.message_template or DEFAULT_TEMPLATES.get(transaction_type)
	return DEFAULT_TEMPLATES.get(transaction_type)


def is_auto_send_enabled(transaction_type: str) -> bool:
	settings = frappe.get_single("Santu Transaction Message Settings")
	if not settings.auto_send_on_submit:
		return False
	for row in settings.templates:
		if row.transaction_type == transaction_type:
			return bool(row.enabled and row.auto_send)
	return False


def render_template(template: str, context: dict) -> str:
	def repl(match):
		key = match.group(1).strip()
		val = context.get(key, "")
		return str(val) if val is not None else ""

	return re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", repl, template or "")


def get_party_outstanding(party_type: str, party_name: str) -> float:
	if party_type == "Customer":
		return flt(
			frappe.db.sql(
				"""SELECT SUM(outstanding_amount) FROM `tabSales Invoice`
				WHERE docstatus = 1 AND customer = %s AND outstanding_amount > 0""",
				party_name,
			)[0][0]
		)
	if party_type == "Supplier":
		return flt(
			frappe.db.sql(
				"""SELECT SUM(outstanding_amount) FROM `tabPurchase Invoice`
				WHERE docstatus = 1 AND supplier = %s AND outstanding_amount > 0""",
				party_name,
			)[0][0]
		)
	return 0


def get_payment_link(doc) -> str:
	# Only return a link if a real payment request exists — never fake URLs.
	if doc.doctype in ("Sales Invoice", "POS Invoice"):
		pr = frappe.db.get_value("Payment Request", {"reference_doctype": doc.doctype, "reference_name": doc.name, "docstatus": 1}, "payment_url")
		if pr:
			return pr
	return ""


def _public_document_link(doc) -> str:
	"""A link the customer can actually open, or nothing at all.

	This used to hand out get_url("/app/sales_invoice/SINV-...") — broken two
	ways at once. "/app/..." is the internal desk form, so anyone tapping it
	lands on a login screen, and get_url() on this machine returns
	http://site1.local:8000, a development hostname that exists only on this
	Mac. A customer on mobile data could never reach it.

	The bill itself already travels with the message as a PDF attachment, so
	when there is no genuinely reachable address, sending no link is better
	than sending a dead one.
	"""
	from urllib.parse import urlparse

	base = (get_url() or "").rstrip("/")
	host = (urlparse(base).hostname or "").lower()

	# Development / LAN-only hosts a customer's phone cannot resolve.
	unreachable = (
		not host
		or host in ("localhost", "127.0.0.1", "0.0.0.0")
		or host.endswith(".local")
		or host.endswith(".localhost")
		or host.startswith("192.168.")
		or host.startswith("10.")
		or host.startswith("172.16.")
	)
	if unreachable:
		return ""

	# The portal route, not the desk one: /app/* is staff-only by design.
	# These are ERPNext's own registered website_route_rules — they are not
	# derivable from the doctype name (Sales Invoice lives at /invoices, not
	# /sales_invoices), so they are listed rather than guessed. A doctype
	# with no portal page gets no link at all.
	PORTAL_ROUTES = {
		"Sales Invoice": "invoices",
		"Purchase Invoice": "purchase-invoices",
		"Sales Order": "orders",
		"Purchase Order": "purchase-orders",
		"Quotation": "quotations",
		"Supplier Quotation": "supplier-quotations",
	}
	route = PORTAL_ROUTES.get(doc.doctype)
	if not route:
		return ""

	return f"{base}/{route}/{doc.name}"


def build_message_context(doc, transaction_type: str) -> dict:
	company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	company_doc = frappe.get_doc("Company", company) if company else None

	party_type, party_name = None, None
	customer_name, supplier_name = "", ""

	if doc.doctype == "Quotation":
		# Quotation has no `customer` field — its party is a Dynamic Link
		# (`party_name`, pointing at Customer or Lead per `quotation_to`),
		# with `customer_name` as the separate display-name field.
		party_type, party_name = "Customer", doc.party_name
		customer_name = doc.customer_name or doc.party_name
	elif doc.doctype in ("Sales Invoice", "POS Invoice", "Sales Order", "Delivery Note"):
		party_type, party_name = "Customer", doc.customer
		customer_name = doc.customer_name or doc.customer
	elif doc.doctype in ("Purchase Invoice", "Purchase Order"):
		party_type, party_name = "Supplier", doc.supplier
		supplier_name = doc.supplier_name or doc.supplier
	elif doc.doctype == "Payment Entry":
		party_type = doc.party_type
		party_name = doc.party
		if party_type == "Customer":
			customer_name = doc.party_name or doc.party
		elif party_type == "Supplier":
			supplier_name = doc.party_name or doc.party

	grand_total = flt(getattr(doc, "grand_total", None) or getattr(doc, "paid_amount", None) or getattr(doc, "total", 0))
	outstanding = flt(getattr(doc, "outstanding_amount", 0))
	paid_amount = grand_total - outstanding if grand_total and outstanding is not None else flt(getattr(doc, "paid_amount", grand_total))

	invoice_link = ""
	msg_settings = frappe.get_single("Santu Transaction Message Settings")
	if msg_settings.include_web_invoice_link:
		invoice_link = _public_document_link(doc)

	payment_link = ""
	if msg_settings.include_payment_link:
		payment_link = get_payment_link(doc)
		if not payment_link and msg_settings.include_payment_link:
			payment_link = ""  # caller may append note

	current_balance = ""
	current_balance_amount = 0
	if msg_settings.include_party_balance and party_type and party_name:
		current_balance_amount = get_party_outstanding(party_type, party_name)
		current_balance = f"{current_balance_amount:,.2f}"

	# The template engine is plain {{ var }} substitution with no {% if %} —
	# so "paid in full" vs "still owes money" is decided here, once, rather
	# than every template showing a "Balance: ₹0.00" line on a fully paid
	# bill (confusing on a receipt that just said "thank you").
	if outstanding > 0:
		payment_status_block = f"Paid: ₹{paid_amount:,.2f}\nBalance Due: ₹{outstanding:,.2f}"
	else:
		payment_status_block = "Status: Paid in full ✅"

	invoice_link_line = f"\nView bill: {invoice_link}" if invoice_link else ""
	payment_link_line = f"\nPay online: {payment_link}" if payment_link else ""
	# Phone number message me nahi jata (2026-09-25 bug report): kagaz par
	# aur PDF me dukaan ka number pehle se hai, chat me dobara bhejna
	# sirf message lamba karta tha.
	footer_contact_line = ""
	# What the party owes IN TOTAL, not just on this bill. A credit customer
	# reading "Balance Due: ₹370" assumed that was everything they owed, while
	# their account actually stood at ₹455 (2026-08-17 report). Only shown when
	# the account owes more than this one bill, so a customer with a single
	# unpaid bill doesn't see the same number printed twice.
	balance_note_line = (
		f"\n*Total Account Balance:* ₹{current_balance}"
		if current_balance_amount > flt(outstanding) + 0.01
		else ""
	)

	try:
		posting_date_display = frappe.utils.formatdate(getattr(doc, "posting_date", None) or today(), "dd-MMM-yyyy")
	except Exception:
		posting_date_display = str(getattr(doc, "posting_date", today()))

	from santu_hardware.santu_hardware.api import bill_label

	bill_no_val = bill_label(doc.get("santu_bill_no"))

	return {
		"customer_name": customer_name,
		"supplier_name": supplier_name,
		"party_name": customer_name or supplier_name or party_name or "",
		"invoice_no": bill_no_val,
		"transaction_type": transaction_type,
		"posting_date": posting_date_display,
		"grand_total": f"{grand_total:,.2f}",
		"paid_amount": f"{paid_amount:,.2f}",
		"outstanding_amount": f"{outstanding:,.2f}",
		"current_balance": current_balance,
		"payment_link": payment_link,
		"invoice_link": invoice_link,
		"payment_status_block": payment_status_block,
		"invoice_link_line": invoice_link_line,
		"payment_link_line": payment_link_line,
		"footer_contact_line": footer_contact_line,
		"balance_note_line": balance_note_line,
		"company_name": company_doc.company_name if company_doc else "Santu Hardware",
		"company_phone": company_doc.phone_no if company_doc else "",
		"company_address": (company_doc.company_description or "") if company_doc else "",
		"_party_type": party_type,
		"_party_name": party_name,
	}


def _ensure_print_request():
	"""Print formats call frappe.call() which needs an HTTP request context."""
	if getattr(frappe.local, "request", None):
		return
	from werkzeug.test import EnvironBuilder
	from werkzeug.wrappers import Request

	frappe.local.request = Request(EnvironBuilder(method="GET").get_environ())


# WhatsApp Library me har document ka apna naam hai; format ka naam uske
# prefix se banta hai ("Santu A4 - Estimate - Standard A4"). Return ka apna
# document type hai kyunki wo bill nahi, wapsi hai (2026-09-23).
_A4_PREFIX = {
	("Sales Invoice", False): ("Sales Invoice", ""),
	("Sales Invoice", True): ("Sales Return", "Return"),
	("Purchase Invoice", False): ("Purchase Invoice", "Purchase"),
	("Purchase Invoice", True): ("Purchase Return", "Purchase Return"),
	("Quotation", False): ("Quotation", "Estimate"),
	("Sales Order", False): ("Sales Order", "Order"),
	("Delivery Note", False): ("Delivery Note", "Challan"),
	("Purchase Order", False): ("Purchase Order", "Purchase Order"),
	("Payment Entry", False): ("Payment Entry", "Receipt"),
	("Stock Entry", False): ("Stock Entry", "Goods Received"),
}


def _chosen_a4_format(doctype: str, name: str = None):
	"""Invoice Settings > WhatsApp Library ka chuna hua A4 roop, agar wo sach
	me ek Print Format hai. Kuch bhi gadbad ho to None -- bhejna kabhi ruke
	nahi, bas purane layout par chala jaye."""
	try:
		is_return = False
		if name and frappe.db.has_column(doctype, "is_return"):
			is_return = bool(frappe.db.get_value(doctype, name, "is_return"))
		doc_key, prefix = _A4_PREFIX.get((doctype, is_return), (doctype, ""))
		settings = frappe.get_cached_doc("Santu POS Settings")
		chosen = None
		for row in settings.get("document_templates") or []:
			if row.library == "WhatsApp Library" and row.document_type == doc_key:
				chosen = row.template_name
				break
		for style in (chosen, "Standard A4"):
			if not style:
				continue
			candidate = f"Santu A4 - {prefix} - {style}" if prefix else f"Santu A4 - {style}"
			if frappe.db.exists("Print Format", {"name": candidate, "doc_type": doctype}):
				return candidate
	except Exception:
		pass
	return None


#: What each kind of document is called when the customer sees the file name.
_ATTACHMENT_LABELS = {
	"Sales Invoice": "Bill",
	"POS Invoice": "Bill",
	"Purchase Invoice": "Purchase Bill",
	"Quotation": "Estimate",
	"Delivery Note": "Chalan",
	"Payment Entry": "Payment",
	"Sales Order": "Order",
	"Purchase Order": "Purchase Order",
}


def attachment_file_name(doc, ext: str) -> str:
	"""Name the WhatsApp attachment after the PARTY, not the docname.

	The customer used to receive "SINV-26-01109-1.pdf" -- an internal code that
	means nothing to them, and that looks identical to every other bill in
	their chat (2026-09-25). It is now "<Party> - Bill <no>.<ext>".

	The number on the end is what keeps several bills for the same customer
	apart, so their WhatsApp does not end up holding three files with one
	name. It is the shop's own bill number where the doctype has one
	(santu_bill_no), otherwise the docname.
	"""
	from santu_hardware.santu_hardware.api import bill_label

	party = (
		doc.get("customer_name")
		or doc.get("supplier_name")
		or doc.get("party_name")
		or doc.get("customer")
		or doc.get("supplier")
		or doc.get("party")
		or ""
	)
	label = _ATTACHMENT_LABELS.get(doc.doctype, doc.doctype)
	if doc.doctype in ("Sales Invoice", "POS Invoice") and doc.get("is_return"):
		label = "Return"
	elif doc.doctype == "Purchase Invoice" and doc.get("is_return"):
		label = "Purchase Return"

	# The docname must NEVER stand in for a bill number anywhere the shop or a
	# customer can see it -- that is an absolute rule (see bill_label, and it
	# applies to a file name just as much as to a slip). bill_label gives "—"
	# when there is no number, and doctypes like Delivery Note and Payment
	# Entry never have one, so those are told apart by date + time instead.
	number = bill_label(doc.get("santu_bill_no")) or ""
	if not number.strip() or number.strip() == "—":
		stamp = doc.get("posting_date") or doc.get("transaction_date") or today()
		try:
			number = frappe.utils.formatdate(stamp, "dd-MM-yyyy")
		except Exception:
			number = str(stamp)
		clock = str(doc.get("posting_time") or "")[:5].replace(":", "")
		if clock:
			number = f"{number} {clock}"

	def clean(part):
		# Only what a file system or WhatsApp actually chokes on. A character
		# class of \w would have shredded Hindi names -- the matras are not
		# word characters, so "श्याम" came out as "श य म".
		part = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", str(part or ""))
		return re.sub(r"\s+", " ", part).strip(" .-")

	# Trim the PARTY, never the tail: the number on the end is the whole point
	# of the name, so it must survive a long shop name.
	party = clean(party)[:45].strip(" .-")
	stem = " - ".join(p for p in (party, f"{clean(label)} {clean(number)}".strip()) if p)
	return f"{(stem or clean(label) or 'Bill')}.{ext}"


def get_invoice_pdf_bytes(doc) -> tuple[bytes, str]:
	"""Thermal bill for WhatsApp attachment.

	Sales Invoice deliberately NOT in thermal_formats below: what the
	customer receives on WhatsApp is the full shop bill (the one with
	BILLED TO, the item table and the Account Summary showing previous
	balance / received today / current balance), not the 80mm counter
	slip. A phone shows a proper page fine, and the balance block is the
	part a customer actually refers back to (2026-08-17 request). It falls
	through to the doctype's own default print format below, which is
	that bill.

	(2026-08-19: briefly switched Sales Invoice to the thermal slip as a
	picture — "jo invoice whatsapp pe jaa raha hai use change kr ke
	thermal invoice bhejo in picture format" — then reverted the same day:
	"wo pdf jo jata tha pahle whatsapp pe wahi same jane de. wo sahi tha.
	ye thermal image jo jaa raha wo thoda thik naa hai". Sales Invoice is
	back on the A4 PDF path above; the picture-sending machinery this
	added — _thermal_image_bytes, send_image/send-image on both WhatsApp
	providers — is left in place since it's real infrastructure, just
	unused by this doctype for now.)
	"""
	from santu_hardware.santu_hardware.api import _thermal_image_bytes

	# PICTURE is only ever for the 80mm counter slip. Everything else -- above
	# all the A4 bill -- goes as a PDF.
	#
	# This used to be one `print_format` variable for both paths, with the PDF
	# return nested inside `if not print_format`. That held only while nothing
	# filled the variable. The moment the WhatsApp A4 Library landed
	# (2026-09-23) and the shop picked a layout, _chosen_a4_format() started
	# returning "Santu A4 - Standard A4" -- so the PDF branch was skipped and
	# the A4 bill fell through to the thermal-image renderer. Customers began
	# getting a 2 MB PNG of an A4 page instead of the PDF, which is exactly
	# what was reverted once before on 2026-08-19 ("wo pdf jo jata tha pahle
	# whatsapp pe wahi same jane de... ye thermal image thoda thik naa hai").
	# Kept as two separate variables so the two paths can never merge again.
	thermal_formats = {
		"POS Invoice": "Santu Hardware Thermal Bill",
	}
	thermal_format = thermal_formats.get(doc.doctype)
	if thermal_format:
		_ensure_print_request()
		image_bytes = _thermal_image_bytes(doc.doctype, doc.name, thermal_format)
		return image_bytes, attachment_file_name(doc, "png")

	# Jo A4 roop shop ne Invoice Settings > WhatsApp Library me chuna hai,
	# wahi bheja bhi jaye. Pehle ye chunav sirf preview badalta tha aur
	# WhatsApp par hamesha wahi purana layout jata tha (2026-09-23).
	pdf_format = _chosen_a4_format(doc.doctype, doc.name)
	if not pdf_format:
		pdf_format = frappe.db.get_value("DocType", doc.doctype, "default_print_format")
	if not pdf_format:
		pdf_format = frappe.db.get_value(
			"Property Setter",
			{"doc_type": doc.doctype, "property": "default_print_format"},
			"value",
		)
	# No custom format saved is not an error — frappe.get_print(...,
	# print_format=None, ...) renders Frappe's own standard layout for
	# the doctype fine (Payment Entry has never had a custom one, and
	# that's exactly the doctype this was blocking — 2026-08-19 bug
	# report: "payment in ka pdf nh jaa raha"). Only throw for real
	# failures, not "nobody customized this one yet".
	_ensure_print_request()
	pdf_bytes = frappe.get_print(doc.doctype, doc.name, pdf_format, as_pdf=True)
	return pdf_bytes, attachment_file_name(doc, "pdf")


def create_message_log(**kwargs):
	log = frappe.new_doc("Santu WhatsApp Message Log")
	log.update(kwargs)
	log.insert(ignore_permissions=True)
	return log


def update_doc_whatsapp_status(doctype: str, name: str, status: str):
	if frappe.db.has_column(doctype, "custom_whatsapp_status"):
		frappe.db.set_value(doctype, name, "custom_whatsapp_status", status, update_modified=False)


def send_transaction_message(
	doctype: str,
	name: str,
	*,
	custom_message: str = None,
	phone_field: str = "mobile",
	message_type: str = "Transaction",
	force: bool = False,
	to_phone: str = None,
	to_name: str = None,
) -> dict:
	settings = frappe.get_single("Santu Transaction Message Settings")
	doc = frappe.get_doc(doctype, name)
	transaction_type = resolve_transaction_type(doc)

	if not transaction_type:
		frappe.throw(f"Transaction type not supported for {doctype}")

	if not settings.send_to_party and not force:
		frappe.throw("Send Message to Party is disabled in settings.")

	template = custom_message or get_template(transaction_type)
	if not template:
		frappe.throw(f"No message template configured for {transaction_type}")

	context = build_message_context(doc, transaction_type)
	message_body = render_template(template, context)

	party_type = context.get("_party_type")
	party_name = context.get("_party_name")
	if to_phone:
		phone = normalize_indian_phone(to_phone)
		if not phone or len(phone) < 12:
			frappe.throw("Sahi 10 digit WhatsApp number daalo.")
	else:
		phone = get_party_phone(party_type, party_name, phone_field)

	if not phone:
		frappe.throw("No WhatsApp number found for this party.")

	from santu_hardware.santu_hardware.whatsapp_service import get_connection_state

	conn = get_connection_state()
	if conn["state"] != "CONNECTED":
		return {
			"ok": False,
			"configured": conn.get("configured"),
			"connected": False,
			"error": "WhatsApp is not connected. Open Grow Your Business → WhatsApp Connect.",
			"message": "WhatsApp is not connected. Open Grow Your Business → WhatsApp Connect.",
			"preview": message_body,
			"phone": phone,
			"party_name": context.get("party_name"),
		}

	# Use unified WhatsApp Connect send path
	from santu_hardware.santu_hardware.whatsapp_connect_service import send_transaction_from_connect

	result = send_transaction_from_connect(doctype, name, custom_message=custom_message, to_phone=to_phone, to_name=to_name)
	if result.get("ok"):
		create_message_log(
			reference_doctype=doctype,
			reference_name=name,
			transaction_type=transaction_type,
			message_type=message_type,
			party_type=None if to_phone else party_type,
			party_name=None if to_phone else party_name,
			phone_number=phone,
			message_body=message_body,
			message_template_used=template,
			status="Sent",
			provider=frappe.db.get_single_value("Santu WhatsApp Settings", "provider"),
			provider_message_id=result.get("provider_message_id"),
			sent_by=frappe.session.user,
			sent_at=now_datetime(),
		)
		# A share to some other number says nothing about whether the PARTY got
		# their bill, so it must not flip the document's own WhatsApp status --
		# that badge is read as "the customer has it".
		if not to_phone:
			update_doc_whatsapp_status(doctype, name, "Sent")
		frappe.db.commit()
	else:
		if not to_phone:
			update_doc_whatsapp_status(doctype, name, "Failed")
		frappe.db.commit()
	return result


def preview_message(doctype: str = None, name: str = None, transaction_type: str = "Sales Transaction", template: str = None) -> dict:
	if doctype and name and frappe.db.exists(doctype, name):
		doc = frappe.get_doc(doctype, name)
		transaction_type = resolve_transaction_type(doc) or transaction_type
		template = template or get_template(transaction_type)
		context = build_message_context(doc, transaction_type)
	else:
		template = template or get_template(transaction_type) or DEFAULT_TEMPLATES["Sales Transaction"]
		context = {
			"customer_name": "Chandra Prakash",
			"supplier_name": "ABC Suppliers",
			"party_name": "Chandra Prakash",
			"invoice_no": "INV-0001",
			"transaction_type": transaction_type,
			"posting_date": str(today()),
			"grand_total": "7,920.00",
			"paid_amount": "3,000.00",
			"outstanding_amount": "4,920.00",
			"current_balance": "24,500.00",
			"payment_link": "https://pay.example.com/inv-0001",
			"invoice_link": get_url("/app/sales-invoice/INV-0001"),
			"company_name": "Santu Hardware",
			"company_phone": "+91 98765 43210",
			"company_address": "Main Road, Patna",
		}

	body = render_template(template, context)
	return {
		"message": body,
		"transaction_type": transaction_type,
		"configured": is_whatsapp_configured(),
		"context": {k: v for k, v in context.items() if not k.startswith("_")},
	}


def retry_message(log_name: str) -> dict:
	log = frappe.get_doc("Santu WhatsApp Message Log", log_name)
	if not log.reference_doctype or not log.reference_name:
		frappe.throw("Cannot retry — no linked transaction.")
	return send_transaction_message(
		log.reference_doctype,
		log.reference_name,
		custom_message=log.message_body,
		force=True,
	)


def on_transaction_submit(doc, method=None):
	transaction_type = resolve_transaction_type(doc)
	if not transaction_type:
		return
	if not is_auto_send_enabled(transaction_type):
		return
	frappe.enqueue(
		"santu_hardware.santu_hardware.transaction_message_service._auto_send_job",
		queue="short",
		doctype=doc.doctype,
		name=doc.name,
		now=frappe.flags.in_test,
	)


def _auto_send_job(doctype: str, name: str):
	try:
		result = send_transaction_message(doctype, name)
		if not result.get("ok") and not result.get("configured"):
			frappe.logger().info(f"WhatsApp auto-send skipped for {doctype} {name}: not configured")
	except Exception as e:
		frappe.log_error(f"WhatsApp auto-send failed for {doctype} {name}: {e}")


def get_whatsapp_status_for_doc(doctype: str, name: str) -> dict:
	log = frappe.get_all(
		"Santu WhatsApp Message Log",
		filters={"reference_doctype": doctype, "reference_name": name},
		fields=["name", "status", "sent_at", "error_message", "provider_message_id"],
		order_by="creation desc",
		limit=1,
	)
	if log:
		return log[0]
	status = frappe.db.get_value(doctype, name, "custom_whatsapp_status") if frappe.db.has_column(doctype, "custom_whatsapp_status") else None
	return {"status": status or "Not Sent"}
