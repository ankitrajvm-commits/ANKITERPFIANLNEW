"""Unified WhatsApp service — used by Transaction Message and WhatsApp Connect."""

from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from santu_hardware.santu_hardware.whatsapp_provider import (
	WhatsAppProviderError,
	get_whatsapp_provider,
	is_whatsapp_configured,
)


def get_connection_state() -> dict:
	from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status

	wa = frappe.get_single("Santu WhatsApp Settings")
	connect = frappe.get_single("Santu WhatsApp Connect Settings")
	smart = read_bridge_status()
	smart_state = (smart.get("state") or "").upper()

	if smart_state == "CONNECTED":
		state = "CONNECTED"
	elif smart_state == "QR":
		state = "QR"
	elif smart_state in ("CONNECTING", "RECONNECTING"):
		state = smart_state
	elif smart_state == "LOGGED_OUT":
		state = "LOGGED_OUT"
	elif not wa.enabled:
		state = "DISCONNECTED"
	elif wa.connect_state == "LOGGED_OUT":
		state = "LOGGED_OUT"
	elif not is_whatsapp_configured():
		state = "DISCONNECTED"
	elif wa.connection_status == "Connected" and wa.connect_state == "CONNECTED":
		state = "CONNECTED"
	elif wa.connection_status == "Failed":
		state = "ERROR"
	elif wa.connect_state in ("CONNECTING", "RECONNECTING"):
		state = wa.connect_state
	else:
		state = "DISCONNECTED"

	return {
		"state": state,
		"configured": is_whatsapp_configured() or smart_state in ("QR", "CONNECTING", "CONNECTED"),
		"enabled": bool(wa.enabled) or smart_state == "CONNECTED",
		"display_phone": smart.get("phone") or wa.display_phone_number or wa.sender_number or "",
		"provider": "Smart Connect" if smart_state in ("QR", "CONNECTING", "CONNECTED", "RECONNECTING") else wa.provider,
		"terms_accepted": bool(connect.terms_accepted),
		"last_error": smart.get("error") or wa.last_test_error or "",
		"qr": smart.get("qr") or "",
		"smart_connect": True,
	}


def set_connect_state(state: str, **kwargs):
	wa = frappe.get_single("Santu WhatsApp Settings")
	wa.connect_state = state
	for k, v in kwargs.items():
		if hasattr(wa, k):
			wa.set(k, v)
	wa.save(ignore_permissions=True)


def connect_whatsapp() -> dict:
	"""Test Meta Cloud API credentials and mark as connected."""
	if not is_whatsapp_configured():
		set_connect_state("DISCONNECTED")
		return {"ok": False, "state": "DISCONNECTED", "error": "WhatsApp credentials are not configured."}

	set_connect_state("CONNECTING")
	try:
		provider = get_whatsapp_provider()
		result = provider.test_connection()
		wa = frappe.get_single("Santu WhatsApp Settings")
		wa.connection_status = "Connected"
		wa.connect_state = "CONNECTED"
		wa.last_test_on = now_datetime()
		wa.last_test_error = ""
		wa.display_phone_number = result.get("display_phone_number") or wa.sender_number
		wa.save(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": True, "state": "CONNECTED", "display_phone": wa.display_phone_number, **result}
	except WhatsAppProviderError as e:
		wa = frappe.get_single("Santu WhatsApp Settings")
		wa.connection_status = "Failed"
		wa.connect_state = "ERROR"
		wa.last_test_error = str(e)[:500]
		wa.last_test_on = now_datetime()
		wa.save(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": False, "state": "ERROR", "error": str(e)}


def disconnect_whatsapp() -> dict:
	from santu_hardware.santu_hardware.smart_connect_bridge import stop_bridge

	stop_bridge(logout=True)
	wa = frappe.get_single("Santu WhatsApp Settings")
	wa.enabled = 0
	wa.connect_state = "LOGGED_OUT"
	wa.connection_status = "Not Connected"
	wa.display_phone_number = ""
	wa.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "state": "LOGGED_OUT"}


def refresh_connection() -> dict:
	return connect_whatsapp()


def send_chat_message(
	phone: str,
	body: str,
	*,
	party_type: str = None,
	party_name: str = None,
	message_type: str = "Text",
	reference_doctype: str = None,
	reference_name: str = None,
	attachment_bytes: bytes = None,
	attachment_filename: str = None,
) -> dict:
	"""Send message via provider and log to chat + message log."""
	from santu_hardware.santu_hardware.whatsapp_connect_service import (
		ensure_contact,
		log_chat_message,
		update_contact_preview,
	)

	conn = get_connection_state()
	if conn["state"] != "CONNECTED":
		return {"ok": False, "error": "WhatsApp is not connected.", "state": conn["state"]}

	provider = get_whatsapp_provider()
	if not provider:
		return {"ok": False, "error": "WhatsApp integration is not configured."}

	chat = log_chat_message(
		phone_number=phone,
		direction="Outgoing",
		message_body=body,
		status="Queued",
		party_type=party_type,
		party_name=party_name,
		message_type=message_type,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
		provider=frappe.db.get_single_value("Santu WhatsApp Settings", "provider"),
		sent_by=frappe.session.user,
	)

	try:
		from santu_hardware.santu_hardware.smart_connect_bridge import _resolve_send_phone

		send_phone = _resolve_send_phone(phone)
		if attachment_bytes and attachment_filename:
			result = provider.send_document(send_phone, attachment_bytes, attachment_filename, caption=body[:1024])
		else:
			result = provider.send_text(send_phone, body)

		chat.status = "Sent"
		chat.provider_message_id = result.get("provider_message_id")
		chat.timestamp = now_datetime()
		chat.save(ignore_permissions=True)
		update_contact_preview(phone, body, party_type, party_name)
		frappe.db.commit()
		return {"ok": True, "chat_name": chat.name, "status": "Sent", "provider_message_id": chat.provider_message_id}

	except WhatsAppProviderError as e:
		chat.status = "Failed"
		chat.error_message = str(e)[:500]
		chat.retry_count = (chat.retry_count or 0) + 1
		chat.save(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": False, "chat_name": chat.name, "status": "Failed", "error": str(e)}


def retry_chat_message(chat_name: str) -> dict:
	chat = frappe.get_doc("Santu WhatsApp Chat Message", chat_name)
	if chat.direction != "Outgoing":
		frappe.throw("Only outgoing messages can be retried.")
	return send_chat_message(
		chat.phone_number,
		chat.message_body,
		party_type=chat.party_type,
		party_name=chat.party_name,
		message_type=chat.message_type,
		reference_doctype=chat.reference_doctype,
		reference_name=chat.reference_name,
	)
