/* global frappe, santu_txn_msg */
frappe.provide("santu_txn_msg");

const TXN_MSG_API = "santu_hardware.santu_hardware.transaction_message_api";

santu_txn_msg.api = {
	getSettings() {
		return frappe.xcall(`${TXN_MSG_API}.get_settings`);
	},
	saveWhatsapp(s) {
		return frappe.xcall(`${TXN_MSG_API}.save_whatsapp_settings`, { settings: s });
	},
	saveMessage(s) {
		return frappe.xcall(`${TXN_MSG_API}.save_message_settings`, { settings: s });
	},
	testConnection() {
		return frappe.xcall(`${TXN_MSG_API}.test_whatsapp_connection`);
	},
	getPreview(transaction_type, template, doctype, name) {
		return frappe.xcall(`${TXN_MSG_API}.get_message_preview`, { transaction_type, template, doctype, name });
	},
	sendMessage(doctype, name, custom_message, phone_field) {
		return frappe.xcall(`${TXN_MSG_API}.send_whatsapp_message`, { doctype, name, custom_message, phone_field });
	},
	getSendPreview(doctype, name, phone_field) {
		return frappe.xcall(`${TXN_MSG_API}.get_send_preview`, { doctype, name, phone_field });
	},
	getHistory(page, search) {
		return frappe.xcall(`${TXN_MSG_API}.get_message_history`, { page, search });
	},
	getLogDetail(name) {
		return frappe.xcall(`${TXN_MSG_API}.get_message_log_detail`, { log_name: name });
	},
	retry(name) {
		return frappe.xcall(`${TXN_MSG_API}.retry_whatsapp_message`, { log_name: name });
	},
	getDocStatus(doctype, name) {
		return frappe.xcall(`${TXN_MSG_API}.get_doc_whatsapp_status`, { doctype, name });
	},
};
