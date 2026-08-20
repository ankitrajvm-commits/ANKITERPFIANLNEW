"""WhatsApp Connect — contacts, chats, statements, smart messaging."""

from __future__ import annotations

import random
from datetime import datetime

import frappe
from frappe.utils import flt, get_url, now_datetime, today

from santu_hardware.santu_hardware.transaction_message_service import (
	get_party_outstanding,
	get_party_phone,
	normalize_indian_phone,
	render_template,
	resolve_transaction_type,
)
from santu_hardware.santu_hardware.whatsapp_service import get_connection_state, send_chat_message


SMART_SUGGESTIONS = [
	"Good morning! How can I help?",
	"Hello! What can I do for you?",
	"Hi there! Need anything today?",
	"Namaste! Santu Hardware is here to help.",
	"Thank you for contacting Santu Hardware!",
]


def ensure_contact(phone: str, display_name: str = None, party_type: str = None, party_name: str = None):
	phone = normalize_indian_phone(phone)
	if not phone:
		return None
	name = frappe.db.exists("Santu WhatsApp Contact", phone)
	if name:
		doc = frappe.get_doc("Santu WhatsApp Contact", phone)
		if display_name and not doc.display_name:
			doc.display_name = display_name
		if party_type and party_name and not doc.party_name:
			doc.party_type = party_type
			doc.party_name = party_name
			doc.save(ignore_permissions=True)
		return doc

	doc = frappe.new_doc("Santu WhatsApp Contact")
	doc.phone_number = phone
	doc.display_name = display_name or phone
	doc.party_type = party_type
	doc.party_name = party_name
	doc.insert(ignore_permissions=True)
	return doc


def update_contact_preview(phone: str, preview: str, party_type: str = None, party_name: str = None):
	phone = normalize_indian_phone(phone)
	if not phone:
		return
	ensure_contact(phone, party_type=party_type, party_name=party_name)
	frappe.db.set_value(
		"Santu WhatsApp Contact",
		phone,
		{
			"last_message_preview": (preview or "")[:140],
			"last_message_at": now_datetime(),
		},
		update_modified=True,
	)


def log_chat_message(**kwargs):
	kwargs.setdefault("timestamp", now_datetime())
	chat = frappe.new_doc("Santu WhatsApp Chat Message")
	chat.update(kwargs)
	chat.insert(ignore_permissions=True)
	return chat


def sync_contacts_from_parties():
	"""Index customers/suppliers with phone numbers into WhatsApp contact layer."""
	connect = frappe.get_single("Santu WhatsApp Connect Settings")
	if not connect.sync_personal_contacts:
		return {"synced": 0}

	count = 0
	for cust in frappe.get_all("Customer", filters={"disabled": 0}, fields=["name", "customer_name", "mobile_no", "custom_whatsapp_number"]):
		phone = normalize_indian_phone(cust.custom_whatsapp_number or cust.mobile_no)
		if phone:
			ensure_contact(phone, cust.customer_name or cust.name, "Customer", cust.name)
			count += 1

	for sup in frappe.get_all("Supplier", filters={"disabled": 0}, fields=["name", "supplier_name", "mobile_no", "custom_whatsapp_number"]):
		phone = normalize_indian_phone(sup.custom_whatsapp_number or sup.mobile_no)
		if phone:
			ensure_contact(phone, sup.supplier_name or sup.name, "Supplier", sup.name)
			count += 1

	frappe.db.commit()
	return {"synced": count}


def get_chat_list(search: str = None, page: int = 1, page_size: int = 50) -> dict:
	page, page_size = int(page or 1), min(int(page_size or 50), 100)
	filters = {}
	if search:
		filters["display_name"] = ["like", f"%{search}%"]

	# Also search parties if no direct contact match
	contacts = frappe.get_all(
		"Santu WhatsApp Contact",
		filters=filters,
		fields=["name", "phone_number", "display_name", "party_type", "party_name", "last_message_preview", "last_message_at", "unread_count"],
		order_by="last_message_at desc",
		limit_start=(page - 1) * page_size,
		limit_page_length=page_size,
	)

	if search and len(contacts) < page_size:
		# Search ERPNext parties
		from santu_hardware.santu_hardware.api import get_parties_list

		parties = get_parties_list(search=search)
		existing_phones = {c.phone_number for c in contacts}
		for p in parties[:20]:
			phone = get_party_phone(p["party_type"], p["party"], "mobile")
			if phone and phone not in existing_phones:
				contacts.append({
					"name": phone,
					"phone_number": phone,
					"display_name": p.get("party_name") or p["party"],
					"party_type": p["party_type"],
					"party_name": p["party"],
					"last_message_preview": "",
					"last_message_at": None,
					"unread_count": 0,
					"outstanding": p.get("outstanding_amount", 0),
					"is_new": True,
				})

	for c in contacts:
		if c.get("party_type") and c.get("party_name"):
			c["outstanding"] = get_party_outstanding(c["party_type"], c["party_name"])

	total = frappe.db.count("Santu WhatsApp Contact", filters=filters)
	return {"chats": contacts, "total": total, "page": page}


def get_chat_messages(phone: str, page: int = 1, page_size: int = 50) -> dict:
	phone = normalize_indian_phone(phone)
	if not phone:
		frappe.throw("Invalid phone number")

	# Mark unread as read
	if frappe.db.exists("Santu WhatsApp Contact", phone):
		frappe.db.set_value("Santu WhatsApp Contact", phone, "unread_count", 0)

	page, page_size = int(page or 1), min(int(page_size or 50), 100)
	total = frappe.db.count("Santu WhatsApp Chat Message", {"phone_number": phone})
	messages = frappe.get_all(
		"Santu WhatsApp Chat Message",
		filters={"phone_number": phone},
		fields=["name", "direction", "message_body", "message_type", "status", "timestamp", "attachment", "reference_doctype", "reference_name", "error_message"],
		order_by="timestamp asc",
		limit_start=max(0, total - page * page_size),
		limit_page_length=page_size,
	)
	return {"messages": messages, "total": total, "phone": phone}


def get_smart_suggestions(party_name: str = None) -> list:
	"""Deterministic smart messaging suggestions — no external AI."""
	hour = datetime.now().hour
	suggestions = list(SMART_SUGGESTIONS)
	if hour < 12:
		suggestions[0] = f"Good morning{f', {party_name}' if party_name else ''}! How can I help?"
	elif hour < 17:
		suggestions[1] = f"Hello{f', {party_name}' if party_name else ''}! What can I do for you?"
	random.shuffle(suggestions)
	return suggestions[:3]


def get_party_transactions(party_type: str, party_name: str, limit: int = 20) -> list:
	rows = []
	if party_type == "Customer":
		for dt in ("Sales Invoice", "POS Invoice"):
			f = {"docstatus": 1, "customer": party_name}
			if dt == "Sales Invoice":
				f["is_pos"] = 0
			for r in frappe.get_all(dt, filters=f, fields=["name", "posting_date", "grand_total", "is_return"], order_by="posting_date desc", limit_page_length=limit):
				rows.append({"doctype": dt, "name": r.name, "date": str(r.posting_date), "amount": r.grand_total, "label": "Sales Return" if r.is_return else "Sale"})
		for r in frappe.get_all("Payment Entry", filters={"docstatus": 1, "party_type": "Customer", "party": party_name, "payment_type": "Receive"}, fields=["name", "posting_date", "paid_amount"], order_by="posting_date desc", limit=limit):
			rows.append({"doctype": "Payment Entry", "name": r.name, "date": str(r.posting_date), "amount": r.paid_amount, "label": "Payment In"})
	elif party_type == "Supplier":
		for r in frappe.get_all("Purchase Invoice", filters={"docstatus": 1, "supplier": party_name}, fields=["name", "posting_date", "grand_total", "is_return"], order_by="posting_date desc", limit=limit):
			rows.append({"doctype": "Purchase Invoice", "name": r.name, "date": str(r.posting_date), "amount": r.grand_total, "label": "Purchase Return" if r.is_return else "Purchase"})

	rows.sort(key=lambda x: x.get("date") or "", reverse=True)
	return rows[:limit]


def get_party_statement_data(party_type: str, party_name: str) -> dict:
	"""Real party statement from GL entries."""
	company = frappe.defaults.get_user_default("Company")
	from frappe.utils import getdate, add_months

	from_date = add_months(today(), -12)
	to_date = today()

	filters = {
		"party_type": party_type,
		"party": party_name,
		"company": company,
		"from_date": from_date,
		"to_date": to_date,
	}

	try:
		from erpnext.accounts.report.general_ledger.general_ledger import execute as gl_execute

		columns, data = gl_execute(filters)
		rows = [dict(zip([c.get("fieldname") or c.get("label") for c in columns], row)) for row in data] if data else []
	except Exception:
		rows = []
		if party_type == "Customer":
			for r in frappe.get_all("Sales Invoice", filters={"docstatus": 1, "customer": party_name}, fields=["name", "posting_date", "grand_total", "outstanding_amount"], order_by="posting_date asc"):
				rows.append({"posting_date": r.posting_date, "voucher_type": "Sales Invoice", "voucher_no": r.name, "debit": r.grand_total, "credit": 0, "balance": r.outstanding_amount})

	opening = flt(rows[0].get("balance", 0)) if rows else 0
	closing = get_party_outstanding(party_type, party_name)

	return {
		"party_type": party_type,
		"party_name": party_name,
		"from_date": str(from_date),
		"to_date": str(to_date),
		"opening_balance": opening,
		"closing_balance": closing,
		"rows": rows[:100],
	}


def generate_party_statement_pdf(party_type: str, party_name: str) -> tuple[bytes, str]:
	"""Branded statement PDF — same visual language as the Sale Bill print
	format (2026-08-18 direct request: "ek accha ui me daal PDF ko" — this
	was a bare bordered HTML table with no styling at all before)."""
	data = get_party_statement_data(party_type, party_name)
	company = frappe.defaults.get_user_default("Company") or frappe.db.get_value("Company", {}, "name")

	company_addr_name = frappe.db.get_value(
		"Dynamic Link",
		{"link_doctype": "Company", "link_name": company, "parenttype": "Address"},
		"parent",
	)
	company_address = ""
	if company_addr_name:
		caddr = frappe.get_doc("Address", company_addr_name)
		place = caddr.county or caddr.city
		company_address = (
			(caddr.address_line1 + ", " if caddr.address_line1 else "")
			+ (place + ", " if place else "")
			+ (caddr.state or "")
			+ (" " + caddr.pincode if caddr.pincode else "")
		)

	party_phone = get_party_phone(party_type, party_name) or ""
	closing = flt(data["closing_balance"])
	opening = flt(data["opening_balance"])

	rows_html = ""
	for row in data.get("rows", [])[:100]:
		debit = flt(row.get("debit"))
		credit = flt(row.get("credit"))
		rows_html += f"""
		<tr>
			<td>{row.get('posting_date', '')}</td>
			<td>{row.get('voucher_type', '')}<br><span class="voucher-no">{row.get('voucher_no', '')}</span></td>
			<td class="num">{f"₹{debit:,.2f}" if debit else "-"}</td>
			<td class="num">{f"₹{credit:,.2f}" if credit else "-"}</td>
			<td class="num">₹{flt(row.get('balance')):,.2f}</td>
		</tr>"""
	if not rows_html:
		rows_html = '<tr><td colspan="5" class="empty">No transactions in this period.</td></tr>'

	html = f"""
	<html>
	<head>
	<style>
		body {{ font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1f2340; font-size: 12px; }}
		.stmt-header {{ display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2340; padding-bottom: 14px; margin-bottom: 18px; }}
		.stmt-shop-name {{ font-size: 22px; font-weight: 700; color: #1f2340; }}
		.stmt-tagline {{ font-size: 12px; font-style: italic; color: #3730a3; margin: 2px 0 6px; }}
		.stmt-shop-meta {{ font-size: 11px; color: #6b7280; }}
		.stmt-title {{ font-size: 18px; font-weight: 700; color: #3730a3; text-align: right; }}
		.stmt-period {{ font-size: 11px; color: #6b7280; text-align: right; margin-top: 4px; }}
		.stmt-party {{ margin-bottom: 16px; }}
		.stmt-party-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #9ca3af; }}
		.stmt-party-name {{ font-size: 15px; font-weight: 700; }}
		.stmt-party-phone {{ font-size: 11px; color: #6b7280; }}
		.stmt-summary {{ display: flex; gap: 12px; margin-bottom: 20px; }}
		.stmt-summary-box {{ flex: 1; border: 1px solid #e5e8ef; border-radius: 8px; padding: 10px 14px; }}
		.stmt-summary-label {{ font-size: 10px; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.04em; }}
		.stmt-summary-value {{ font-size: 16px; font-weight: 700; margin-top: 2px; }}
		.stmt-summary-box.closing {{ background: #fef2f2; border-color: #fecaca; }}
		.stmt-summary-box.closing .stmt-summary-value {{ color: {"#b91c1c" if closing > 0 else "#15803d"}; }}
		table {{ width: 100%; border-collapse: collapse; }}
		thead th {{ text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f7f8fa; padding: 8px 10px; border-bottom: 1px solid #e5e8ef; }}
		thead th.num, td.num {{ text-align: right; }}
		tbody td {{ padding: 8px 10px; border-bottom: 1px solid #f0f2f6; font-size: 11.5px; }}
		.voucher-no {{ color: #6b7280; font-size: 10.5px; }}
		.empty {{ text-align: center; color: #9ca3af; padding: 20px; }}
		.stmt-footer {{ margin-top: 24px; padding-top: 12px; border-top: 1px dashed #d1d5db; text-align: center; font-size: 10px; color: #9ca3af; }}
	</style>
	</head>
	<body>
		<div class="stmt-header">
			<div>
				<div class="stmt-shop-name">{company or ""}</div>
				<div class="stmt-tagline">Solid Tools. Solid Trust.</div>
				<div class="stmt-shop-meta">{company_address}</div>
			</div>
			<div>
				<div class="stmt-title">ACCOUNT STATEMENT</div>
				<div class="stmt-period">{data['from_date']} to {data['to_date']}</div>
			</div>
		</div>

		<div class="stmt-party">
			<div class="stmt-party-label">Statement For</div>
			<div class="stmt-party-name">{party_name}</div>
			{f'<div class="stmt-party-phone">Phone: {party_phone}</div>' if party_phone else ""}
		</div>

		<div class="stmt-summary">
			<div class="stmt-summary-box">
				<div class="stmt-summary-label">Opening Balance</div>
				<div class="stmt-summary-value">₹{opening:,.2f}</div>
			</div>
			<div class="stmt-summary-box closing">
				<div class="stmt-summary-label">Closing Balance</div>
				<div class="stmt-summary-value">₹{closing:,.2f}</div>
			</div>
		</div>

		<table>
			<thead>
				<tr>
					<th>Date</th>
					<th>Voucher</th>
					<th class="num">Debit</th>
					<th class="num">Credit</th>
					<th class="num">Balance</th>
				</tr>
			</thead>
			<tbody>
				{rows_html}
			</tbody>
		</table>

		<div class="stmt-footer">Generated by {company or "Santu Hardware"} &middot; {frappe.utils.today()}</div>
	</body>
	</html>
	"""
	pdf = frappe.utils.pdf.get_pdf(html)
	return pdf, f"statement-{frappe.scrub(party_name)}.pdf"


def get_payment_reminder_message(party_type: str, party_name: str) -> str:
	outstanding = get_party_outstanding(party_type, party_name)
	party_label = party_name
	return f"""Dear {party_label},

This is a reminder regarding your outstanding amount of ₹{outstanding:,.2f} with Santu Hardware.

Please clear the outstanding amount at your earliest convenience.

Thank you,
Santu Hardware"""


def send_transaction_from_connect(doctype: str, name: str, custom_message: str = None) -> dict:
	"""Send transaction message via unified WhatsApp service."""
	from santu_hardware.santu_hardware.transaction_message_service import (
		build_message_context,
		get_invoice_pdf_bytes,
		get_template,
	)

	doc = frappe.get_doc(doctype, name)
	transaction_type = resolve_transaction_type(doc)
	template = custom_message or get_template(transaction_type)
	context = build_message_context(doc, transaction_type)
	body = render_template(template, context)
	phone = get_party_phone(context.get("_party_type"), context.get("_party_name"))

	if not phone:
		return {"ok": False, "error": "No WhatsApp number found for this party."}

	attachment_bytes, filename = None, None
	msg_settings = frappe.get_single("Santu Transaction Message Settings")
	# Payment Entry added 2026-08-19 (bug report: "payment in ka pdf nh jaa
	# raha send on whatsapp krne se") — it was never in this list, so
	# get_invoice_pdf_bytes was never even called for a Payment In/Out
	# receipt; only the text message went out.
	if msg_settings.attach_invoice_pdf and doctype in (
		"Sales Invoice",
		"POS Invoice",
		"Purchase Invoice",
		"Quotation",
		"Delivery Note",
		"Payment Entry",
	):
		try:
			attachment_bytes, filename = get_invoice_pdf_bytes(doc)
		except Exception as e:
			frappe.log_error(title="WhatsApp PDF attach failed", message=frappe.get_traceback())

	return send_chat_message(
		phone,
		body,
		party_type=context.get("_party_type"),
		party_name=context.get("_party_name"),
		message_type="Transaction",
		reference_doctype=doctype,
		reference_name=name,
		attachment_bytes=attachment_bytes,
		attachment_filename=filename,
	)


def link_contact_to_party(phone: str, party_type: str, party_name: str) -> dict:
	phone = normalize_indian_phone(phone)
	if not party_type or not party_name:
		frappe.throw("Party type and name are required.")
	ensure_contact(phone, party_name=party_name, party_type=party_type)
	frappe.db.set_value("Santu WhatsApp Contact", phone, {"party_type": party_type, "party_name": party_name, "display_name": party_name})
	frappe.db.commit()
	return {"ok": True}


def process_incoming_webhook_message(phone: str, body: str, provider_message_id: str = None):
	"""Store inbound message from Meta webhook."""
	phone = normalize_indian_phone(phone)
	if not phone:
		return

	contact = ensure_contact(phone)
	log_chat_message(
		phone_number=phone,
		direction="Incoming",
		message_body=body,
		status="Delivered",
		message_type="Text",
		party_type=contact.party_type if contact else None,
		party_name=contact.party_name if contact else None,
		provider_message_id=provider_message_id,
		provider=frappe.db.get_single_value("Santu WhatsApp Settings", "provider"),
	)
	update_contact_preview(phone, body)
	frappe.db.set_value("Santu WhatsApp Contact", phone, "unread_count", frappe.db.get_value("Santu WhatsApp Contact", phone, "unread_count") + 1)
	frappe.db.commit()
