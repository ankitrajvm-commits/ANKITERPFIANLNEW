/**
 * Transaction Message — WhatsApp button on forms + send dialog.
 * Replaces wa.me click-to-chat when Meta API is configured.
 */
(function () {
	const SUPPORTED = [
		"Sales Invoice", "POS Invoice", "Purchase Invoice", "Payment Entry",
		"Sales Order", "Purchase Order", "Quotation", "Delivery Note",
	];

	function add_whatsapp_button(frm) {
		if (!SUPPORTED.includes(frm.doctype)) return;
		if (frm.doc.docstatus !== 1 && frm.doctype !== "Quotation") return;

		frm.add_custom_button(__("WhatsApp"), () => open_send_dialog(frm), __("Actions"));

		show_whatsapp_status(frm);
	}

	async function show_whatsapp_status(frm) {
		try {
			const status = await frappe.xcall(
				"santu_hardware.santu_hardware.transaction_message_api.get_doc_whatsapp_status",
				{ doctype: frm.doctype, name: frm.doc.name }
			);
			const s = status.status || "Not Sent";
			const icons = { Sent: "✓", Delivered: "✓", Read: "✓", Failed: "✕", "Not Sent": "○" };
			const indicator = s === "Failed" ? "red" : s === "Not Sent" ? "grey" : "green";

			if (!frm.fields_dict.santu_whatsapp_status_html) {
				frm.dashboard.add_section(
					`<div class="santu-wa-status-indicator">WhatsApp: <b>${icons[s] || ""} ${frappe.utils.escape_html(s)}</b></div>`,
					__("WhatsApp Status")
				);
			}

			if (s === "Failed" && status.name) {
				frm.add_custom_button(__("Retry WhatsApp"), () => {
					frappe.xcall("santu_hardware.santu_hardware.transaction_message_api.retry_whatsapp_message", {
						log_name: status.name,
					}).then((r) => {
						frappe.msgprint(r.ok ? __("Message sent") : (r.error || __("Failed")));
						frm.reload_doc();
					});
				}, __("Actions"));
			}
		} catch (e) {
			// status section optional
		}
	}

	async function open_send_dialog(frm) {
		if (window.santu_whatsapp_share) {
			await window.santu_whatsapp_share.send_transaction(frm.doctype, frm.doc.name);
			return;
		}
		frappe.msgprint(__("WhatsApp share is loading — please try again."));
	}

	SUPPORTED.forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			refresh(frm) {
				add_whatsapp_button(frm);
			},
		});
	});
})();
