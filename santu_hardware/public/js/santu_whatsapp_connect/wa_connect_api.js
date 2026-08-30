/* global frappe */
frappe.provide("santu_wa_connect");

const WA_CONNECT_API = "santu_hardware.santu_hardware.whatsapp_connect_api";

santu_wa_connect.api = {
	status() { return frappe.xcall(`${WA_CONNECT_API}.get_connect_status`); },
	settings() { return frappe.xcall(`${WA_CONNECT_API}.get_connect_settings`); },
	saveSettings(s) { return frappe.xcall(`${WA_CONNECT_API}.save_connect_settings`, { settings: s }); },
	acceptTerms() { return frappe.xcall(`${WA_CONNECT_API}.accept_terms`); },
	startSmartConnect() { return frappe.xcall(`${WA_CONNECT_API}.start_smart_connect`); },
	qrStatus() { return frappe.xcall(`${WA_CONNECT_API}.get_qr_status`); },
	connect() { return frappe.xcall(`${WA_CONNECT_API}.connect`); },
	disconnect() { return frappe.xcall(`${WA_CONNECT_API}.disconnect`); },
	refresh() { return frappe.xcall(`${WA_CONNECT_API}.refresh`); },
	chats(search, page) { return frappe.xcall(`${WA_CONNECT_API}.get_chats`, { search, page }); },
	messages(phone, page) { return frappe.xcall(`${WA_CONNECT_API}.get_messages`, { phone, page }); },
	send(phone, message, party_type, party_name) { return frappe.xcall(`${WA_CONNECT_API}.send_message`, { phone, message, party_type, party_name }); },
	retry(chat_name) { return frappe.xcall(`${WA_CONNECT_API}.retry_message`, { chat_name }); },
	suggestions(party_name) { return frappe.xcall(`${WA_CONNECT_API}.get_suggestions`, { party_name }); },
	transactions(party_type, party_name) { return frappe.xcall(`${WA_CONNECT_API}.get_transactions`, { party_type, party_name }); },
	statement(party_type, party_name) { return frappe.xcall(`${WA_CONNECT_API}.get_statement`, { party_type, party_name }); },
	sendStatement(party_type, party_name, custom_message) { return frappe.xcall(`${WA_CONNECT_API}.send_statement`, { party_type, party_name, custom_message }); },
	reminderPreview(party_type, party_name) { return frappe.xcall(`${WA_CONNECT_API}.get_reminder_preview`, { party_type, party_name }); },
	sendReminder(party_type, party_name, custom_message) { return frappe.xcall(`${WA_CONNECT_API}.send_reminder`, { party_type, party_name, custom_message }); },
	previewTxn(doctype, name) { return frappe.xcall(`${WA_CONNECT_API}.preview_transaction`, { doctype, name }); },
	sendTxn(doctype, name, custom_message) { return frappe.xcall(`${WA_CONNECT_API}.send_transaction`, { doctype, name, custom_message }); },
	linkParty(phone, party_type, party_name) { return frappe.xcall(`${WA_CONNECT_API}.link_party`, { phone, party_type, party_name }); },
	createContact(display_name, phone, party_type, create_party) { return frappe.xcall(`${WA_CONNECT_API}.create_contact`, { display_name, phone, party_type, create_party }); },
	syncContacts() { return frappe.xcall(`${WA_CONNECT_API}.sync_contacts`); },
};
