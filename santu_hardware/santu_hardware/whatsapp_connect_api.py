"""WhatsApp Connect API endpoints."""

from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from santu_hardware.santu_hardware.whatsapp_connect_service import (
	add_new_contact,
	generate_party_statement_pdf,
	get_chat_list,
	get_chat_messages,
	get_party_statement_data,
	get_party_transactions,
	get_payment_reminder_message,
	get_smart_suggestions,
	link_contact_to_party,
	send_transaction_from_connect,
	sync_contacts_from_parties,
)
from santu_hardware.santu_hardware.whatsapp_service import (
	connect_whatsapp,
	disconnect_whatsapp,
	get_connection_state,
	refresh_connection,
	retry_chat_message,
	send_chat_message,
)
from santu_hardware.santu_hardware.transaction_message_service import preview_message


def _require_access():
	frappe.only_for(("System Manager", "Administrator", "Sales Manager", "Accounts Manager", "Sales User"))


@frappe.whitelist()
def get_connect_status():
	_require_access()
	return get_connection_state()


@frappe.whitelist()
def accept_terms():
	frappe.only_for("System Manager")
	connect = frappe.get_single("Santu WhatsApp Connect Settings")
	connect.terms_accepted = 1
	connect.terms_accepted_on = now_datetime()
	connect.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True}


@frappe.whitelist()
def connect():
	frappe.only_for("System Manager")
	connect_settings = frappe.get_single("Santu WhatsApp Connect Settings")
	if not connect_settings.terms_accepted:
		frappe.throw("Please accept the Standard Usage Terms first.")
	return start_smart_connect()


def _sync_wa_from_bridge(st: dict):
	wa = frappe.get_single("Santu WhatsApp Settings")
	state = (st.get("state") or "").upper()
	if state == "CONNECTED":
		wa.enabled = 1
		wa.connect_state = "CONNECTED"
		wa.connection_status = "Connected"
		wa.display_phone_number = st.get("phone") or wa.display_phone_number
		wa.last_test_error = ""
	elif state == "QR":
		wa.connect_state = "CONNECTING"
		wa.connection_status = "Not Connected"
	elif state in ("CONNECTING", "RECONNECTING"):
		wa.connect_state = state
	elif state == "ERROR":
		wa.connect_state = "ERROR"
		wa.connection_status = "Failed"
		wa.last_test_error = (st.get("error") or "")[:500]
	wa.save(ignore_permissions=True)
	frappe.db.commit()


@frappe.whitelist()
def start_smart_connect():
	"""Start Party Smart Connect (QR / linked-device login)."""
	frappe.only_for("System Manager")
	from santu_hardware.santu_hardware.smart_connect_bridge import start_bridge

	connect_settings = frappe.get_single("Santu WhatsApp Connect Settings")
	if not connect_settings.terms_accepted:
		frappe.throw("Please accept the Standard Usage Terms first.")
	st = start_bridge(fresh=True)
	_sync_wa_from_bridge(st)
	return {"ok": True, **st}


@frappe.whitelist()
def get_qr_status():
	_require_access()
	from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status

	st = read_bridge_status()
	if (st.get("state") or "").upper() == "CONNECTED":
		_sync_wa_from_bridge(st)
	return st


@frappe.whitelist()
def disconnect():
	_require_access()
	return disconnect_whatsapp()


@frappe.whitelist()
def refresh():
	_require_access()
	return refresh_connection()


@frappe.whitelist()
def get_connect_settings():
	_require_access()
	connect = frappe.get_single("Santu WhatsApp Connect Settings")
	status = get_connection_state()
	return {
		"sync_personal_contacts": connect.sync_personal_contacts,
		"passcode_enabled": connect.passcode_enabled,
		"terms_accepted": connect.terms_accepted,
		"logged_in_as": status.get("display_phone"),
		"connection": status,
	}


@frappe.whitelist()
def save_connect_settings(settings: str = None):
	_require_access()
	settings = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})
	connect = frappe.get_single("Santu WhatsApp Connect Settings")
	for field in ("sync_personal_contacts", "passcode_enabled"):
		if field in settings:
			connect.set(field, settings[field])
	if settings.get("passcode"):
		connect.passcode = settings["passcode"]
	connect.save(ignore_permissions=True)
	if connect.sync_personal_contacts:
		sync_contacts_from_parties()
	frappe.db.commit()
	return get_connect_settings()


@frappe.whitelist()
def get_chats(search: str = None, page: int = 1):
	_require_access()
	return get_chat_list(search=search, page=page)


@frappe.whitelist()
def get_messages(phone: str, page: int = 1):
	_require_access()
	return get_chat_messages(phone, page=page)


@frappe.whitelist()
def send_message(phone: str, message: str, party_type: str = None, party_name: str = None):
	_require_access()
	return send_chat_message(phone, message, party_type=party_type, party_name=party_name)


@frappe.whitelist()
def retry_message(chat_name: str):
	_require_access()
	return retry_chat_message(chat_name)


@frappe.whitelist()
def get_suggestions(party_name: str = None):
	_require_access()
	return {"suggestions": get_smart_suggestions(party_name)}


@frappe.whitelist()
def get_transactions(party_type: str, party_name: str):
	_require_access()
	return {"transactions": get_party_transactions(party_type, party_name)}


@frappe.whitelist()
def get_statement(party_type: str, party_name: str):
	_require_access()
	return get_party_statement_data(party_type, party_name)


@frappe.whitelist()
def send_statement(party_type: str, party_name: str, custom_message: str = None):
	_require_access()
	from santu_hardware.santu_hardware.transaction_message_service import get_party_phone

	phone = get_party_phone(party_type, party_name)
	if not phone:
		frappe.throw("No WhatsApp number for this party.")
	pdf_bytes, filename = generate_party_statement_pdf(party_type, party_name)
	body = custom_message or f"Party Statement for {party_name}\n\nPlease find your account statement attached.\n\nSantu Hardware"
	return send_chat_message(phone, body, party_type=party_type, party_name=party_name, message_type="Statement", attachment_bytes=pdf_bytes, attachment_filename=filename)


@frappe.whitelist()
def send_customer_khata(customer: str, from_date: str = None, to_date: str = None, custom_message: str = None):
	"""WhatsApp the date-ranged running khata (2026-08-27 direct request:
	"WhatsApp/share option where the existing application already supports
	WhatsApp") — the same PDF Download PDF produces, sent through the same
	provider/logging path every other WhatsApp document in this app uses
	(send_chat_message), not a separate channel.
	"""
	_require_access()
	from santu_hardware.santu_hardware.api import _customer_khata_pdf_bytes
	from santu_hardware.santu_hardware.transaction_message_service import get_party_phone

	phone = get_party_phone("Customer", customer)
	if not phone:
		frappe.throw("No WhatsApp number for this customer.")
	pdf_bytes, filename, data = _customer_khata_pdf_bytes(customer, from_date, to_date)
	body = custom_message or (
		f"Khata Statement — {data['customer_name']}\n"
		f"{data['from_date']} to {data['to_date']}\n"
		f"Opening: Rs. {data['opening_balance']:.2f}  |  Closing: Rs. {data['closing_balance']:.2f}\n\n"
		f"Santu Hardware"
	)
	return send_chat_message(
		phone,
		body,
		party_type="Customer",
		party_name=customer,
		message_type="Statement",
		attachment_bytes=pdf_bytes,
		attachment_filename=filename,
	)


@frappe.whitelist()
def get_reminder_preview(party_type: str, party_name: str):
	_require_access()
	return {"message": get_payment_reminder_message(party_type, party_name)}


@frappe.whitelist()
def send_reminder(party_type: str, party_name: str, custom_message: str = None):
	_require_access()
	from santu_hardware.santu_hardware.transaction_message_service import get_party_phone

	phone = get_party_phone(party_type, party_name)
	if not phone:
		frappe.throw("No WhatsApp number for this party.")
	body = custom_message or get_payment_reminder_message(party_type, party_name)
	return send_chat_message(phone, body, party_type=party_type, party_name=party_name, message_type="Reminder")


@frappe.whitelist()
def send_transaction(doctype: str, name: str, custom_message: str = None):
	_require_access()
	if custom_message:
		from santu_hardware.santu_hardware.transaction_message_service import (
			build_message_context,
			get_party_phone,
			resolve_transaction_type,
		)

		doc = frappe.get_doc(doctype, name)
		ctx = build_message_context(doc, resolve_transaction_type(doc))
		phone = get_party_phone(ctx.get("_party_type"), ctx.get("_party_name"))
		return send_chat_message(phone, custom_message, party_type=ctx.get("_party_type"), party_name=ctx.get("_party_name"), message_type="Transaction", reference_doctype=doctype, reference_name=name)
	return send_transaction_from_connect(doctype, name, custom_message)


@frappe.whitelist()
def preview_transaction(doctype: str, name: str):
	_require_access()
	return preview_message(doctype=doctype, name=name)


@frappe.whitelist()
def link_party(phone: str, party_type: str, party_name: str):
	_require_access()
	return link_contact_to_party(phone, party_type, party_name)


@frappe.whitelist()
def create_contact(display_name: str, phone: str, party_type: str = None, create_party: int = 1):
	_require_access()
	return add_new_contact(display_name=display_name, phone=phone, party_type=party_type, create_party=bool(int(create_party or 0)))


@frappe.whitelist()
def sync_contacts():
	frappe.only_for("System Manager")
	return sync_contacts_from_parties()
