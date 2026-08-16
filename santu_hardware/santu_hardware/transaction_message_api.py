"""Whitelisted APIs for Transaction Message / WhatsApp."""

from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from santu_hardware.santu_hardware.transaction_message_service import (
	TRANSACTION_TYPES,
	ensure_default_templates,
	get_whatsapp_status_for_doc,
	preview_message,
	retry_message,
	send_transaction_message,
)
from santu_hardware.santu_hardware.whatsapp_provider import (
	WhatsAppProviderError,
	get_whatsapp_provider,
	is_whatsapp_configured,
)
from santu_hardware.santu_hardware.whatsapp_service import get_connection_state

TEMPLATE_VARIABLES = [
	"customer_name", "supplier_name", "party_name", "invoice_no", "transaction_type",
	"posting_date", "grand_total", "paid_amount", "outstanding_amount", "current_balance",
	"payment_link", "invoice_link", "company_name", "company_phone", "company_address",
]


def _require_access():
	frappe.only_for(
		(
			"System Manager",
			"Administrator",
			"Sales Manager",
			"Accounts Manager",
			"Sales User",
			"Accounts User",
			"Stock User",
		)
	)


def _require_manager():
	frappe.only_for(("System Manager", "Administrator", "Sales Manager", "Accounts Manager"))


@frappe.whitelist()
def get_settings():
	_require_manager()
	wa = frappe.get_single("Santu WhatsApp Settings")
	msg = frappe.get_single("Santu Transaction Message Settings")
	conn = get_connection_state()
	before = len(msg.templates or [])
	ensure_default_templates(msg)
	if len(msg.templates or []) > before:
		msg.save(ignore_permissions=True)

	return {
		"whatsapp": {
			"enabled": wa.enabled,
			"provider": wa.provider,
			"api_url": wa.api_url,
			"phone_number_id": wa.phone_number_id,
			"business_account_id": wa.business_account_id,
			"sender_number": wa.sender_number,
			"connection_status": wa.connection_status or "Not Connected",
			"last_test_on": wa.last_test_on,
			"last_test_error": wa.last_test_error or "",
			"configured": is_whatsapp_configured(),
			"has_token": bool(wa.get_password("access_token", raise_exception=False)),
			"connect_state": conn.get("state"),
			"connected": conn.get("state") == "CONNECTED",
		},
		"message": {
			"send_to_party": msg.send_to_party,
			"send_update_message": msg.send_update_message,
			"send_copy_to_self": msg.send_copy_to_self,
			"owner_whatsapp_number": msg.owner_whatsapp_number,
			"auto_send_on_submit": msg.auto_send_on_submit,
			"attach_invoice_pdf": msg.attach_invoice_pdf,
			"include_web_invoice_link": msg.include_web_invoice_link,
			"include_payment_link": msg.include_payment_link,
			"include_party_balance": msg.include_party_balance,
			"enable_payment_reminder": msg.enable_payment_reminder,
			"reminder_frequency_days": msg.reminder_frequency_days,
			"templates": [
				{
					"transaction_type": t.transaction_type,
					"enabled": t.enabled,
					"auto_send": t.auto_send,
					"message_template": t.message_template,
				}
				for t in msg.templates
			],
		},
		"transaction_types": TRANSACTION_TYPES,
		"template_variables": TEMPLATE_VARIABLES,
	}


@frappe.whitelist()
def save_whatsapp_settings(settings: str = None):
	frappe.only_for("System Manager")
	settings = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})
	wa = frappe.get_single("Santu WhatsApp Settings")
	for field in ("enabled", "provider", "api_url", "phone_number_id", "business_account_id", "sender_number", "webhook_verify_token"):
		if field in settings:
			wa.set(field, settings[field])
	if settings.get("access_token"):
		wa.access_token = settings["access_token"]
	wa.save(ignore_permissions=True)
	frappe.db.commit()
	return get_settings()


@frappe.whitelist()
def save_message_settings(settings: str = None):
	frappe.only_for("System Manager")
	settings = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})
	msg = frappe.get_single("Santu Transaction Message Settings")
	for field in (
		"send_to_party", "send_update_message", "send_copy_to_self", "owner_whatsapp_number",
		"auto_send_on_submit", "attach_invoice_pdf", "include_web_invoice_link",
		"include_payment_link", "include_party_balance", "enable_payment_reminder", "reminder_frequency_days",
	):
		if field in settings:
			msg.set(field, settings[field])
	if "templates" in settings:
		msg.templates = []
		for t in settings["templates"]:
			msg.append("templates", t)
	msg.save(ignore_permissions=True)
	frappe.db.commit()
	return get_settings()


@frappe.whitelist()
def test_whatsapp_connection():
	frappe.only_for("System Manager")
	wa = frappe.get_single("Santu WhatsApp Settings")
	try:
		provider = get_whatsapp_provider()
		if not provider:
			frappe.throw("WhatsApp is not enabled or credentials are missing.")
		result = provider.test_connection()
		wa.connection_status = "Connected"
		wa.last_test_on = now_datetime()
		wa.last_test_error = ""
		wa.save(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": True, **result}
	except WhatsAppProviderError as e:
		wa.connection_status = "Failed"
		wa.last_test_on = now_datetime()
		wa.last_test_error = str(e)[:500]
		wa.save(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": False, "error": str(e)}


@frappe.whitelist()
def get_message_preview(transaction_type: str = "Sales Transaction", template: str = None, doctype: str = None, name: str = None):
	_require_manager()
	return preview_message(doctype=doctype, name=name, transaction_type=transaction_type, template=template)


@frappe.whitelist()
def send_whatsapp_message(doctype: str, name: str, custom_message: str = None, phone_field: str = "mobile"):
	_require_access()
	return send_transaction_message(doctype, name, custom_message=custom_message, phone_field=phone_field, force=True)


@frappe.whitelist()
def get_send_preview(doctype: str, name: str, phone_field: str = "mobile"):
	"""Preview before sending — includes party phone and message body."""
	_require_access()
	from santu_hardware.santu_hardware.transaction_message_service import (
		build_message_context,
		get_party_phone,
		get_template,
		render_template,
		resolve_transaction_type,
	)

	doc = frappe.get_doc(doctype, name)
	transaction_type = resolve_transaction_type(doc)
	template = get_template(transaction_type)
	context = build_message_context(doc, transaction_type)
	message = render_template(template, context)
	phone = get_party_phone(context.get("_party_type"), context.get("_party_name"), phone_field)

	from santu_hardware.santu_hardware.smart_connect_bridge import (
		TEST_REDIRECT_ENABLED,
		TEST_REDIRECT_NUMBER,
	)

	return {
		"party_name": context.get("party_name"),
		"phone": phone,
		"phone_display": f"+{phone}" if phone else None,
		"message": message,
		"transaction_type": transaction_type,
		"configured": is_whatsapp_configured(),
		"connected": get_connection_state().get("state") == "CONNECTED",
		"party_type": context.get("_party_type"),
		"party_doctype": context.get("_party_type"),
		"party_link": context.get("_party_name"),
		# Shown so the dialog can say where this will REALLY go — the party's
		# own number above stays visible so it's obvious a redirect is even
		# happening, rather than the two numbers silently disagreeing.
		"test_redirect_active": bool(TEST_REDIRECT_ENABLED),
		"test_redirect_number": TEST_REDIRECT_NUMBER if TEST_REDIRECT_ENABLED else None,
	}


@frappe.whitelist()
def retry_whatsapp_message(log_name: str):
	_require_manager()
	return retry_message(log_name)


@frappe.whitelist()
def get_message_history(page: int = 1, page_size: int = 50, search: str = None):
	_require_manager()
	page, page_size = int(page or 1), min(int(page_size or 50), 200)
	filters = {}
	if search:
		filters["party_name"] = ["like", f"%{search}%"]

	total = frappe.db.count("Santu WhatsApp Message Log", filters=filters)
	rows = frappe.get_all(
		"Santu WhatsApp Message Log",
		filters=filters,
		fields=[
			"name", "sent_at", "party_name", "reference_doctype", "reference_name",
			"transaction_type", "message_type", "phone_number", "status", "sent_by", "error_message",
		],
		order_by="sent_at desc",
		limit_start=(page - 1) * page_size,
		limit_page_length=page_size,
	)
	return {"rows": rows, "total": total, "page": page}


@frappe.whitelist()
def get_message_log_detail(log_name: str):
	_require_manager()
	log = frappe.get_doc("Santu WhatsApp Message Log", log_name)
	return log.as_dict()


@frappe.whitelist()
def get_doc_whatsapp_status(doctype: str, name: str):
	return get_whatsapp_status_for_doc(doctype, name)


@frappe.whitelist(allow_guest=True)
def whatsapp_webhook():
	"""Meta WhatsApp webhook — verify + status updates."""
	settings = frappe.get_single("Santu WhatsApp Settings")
	if frappe.request.method == "GET":
		mode = frappe.form_dict.get("hub.mode")
		token = frappe.form_dict.get("hub.verify_token")
		challenge = frappe.form_dict.get("hub.challenge")
		if mode == "subscribe" and token == settings.webhook_verify_token:
			frappe.response["type"] = "html"
			return challenge
		frappe.throw("Verification failed", frappe.PermissionError)

	data = frappe.request.get_json(silent=True) or {}
	for entry in data.get("entry", []):
		for change in entry.get("changes", []):
			value = change.get("value", {})
			for msg in value.get("messages", []):
				phone = (msg.get("from") or "")
				body = (msg.get("text") or {}).get("body") or ""
				if phone and body:
					from santu_hardware.santu_hardware.whatsapp_connect_service import process_incoming_webhook_message
					process_incoming_webhook_message(phone, body, msg.get("id"))
			for status in value.get("statuses", []):
				msg_id = status.get("id")
				status_val = status.get("status")
				if not msg_id:
					continue
				log_name = frappe.db.get_value("Santu WhatsApp Message Log", {"provider_message_id": msg_id}, "name")
				if log_name:
					status_map = {"sent": "Sent", "delivered": "Delivered", "read": "Read", "failed": "Failed"}
					updates = {"status": status_map.get(status_val, status_val), "delivery_status": status_val}
					if status_val == "delivered":
						updates["delivered_at"] = now_datetime()
					if status_val == "read":
						updates["read_at"] = now_datetime()
					frappe.db.set_value("Santu WhatsApp Message Log", log_name, updates)
					chat_name = frappe.db.get_value("Santu WhatsApp Chat Message", {"provider_message_id": msg_id}, "name")
					if chat_name:
						frappe.db.set_value("Santu WhatsApp Chat Message", chat_name, updates)
	frappe.db.commit()
	return {"ok": True}
