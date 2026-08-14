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
		frappe.dom.freeze(__("Loading preview…"));
		let preview;
		try {
			preview = await frappe.xcall(
				"santu_hardware.santu_hardware.transaction_message_api.get_send_preview",
				{ doctype: frm.doctype, name: frm.doc.name }
			);
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.msgprint(e.message || __("Failed to load preview"));
			return;
		}
		frappe.dom.unfreeze();

		if (!preview.phone) {
			frappe.msgprint({
				title: __("No WhatsApp Number"),
				message: __("No WhatsApp number found for this party."),
				primary_action: preview.party_link
					? {
						label: __("Add WhatsApp Number"),
						action() {
							frappe.set_route("Form", preview.party_type, preview.party_link);
						},
					}
					: undefined,
			});
			return;
		}

		if (!preview.configured || preview.connected === false) {
			frappe.msgprint({
				title: __("WhatsApp Not Connected"),
				message: __("WhatsApp is not connected. Configure and connect in Parties → WhatsApp Connect."),
				primary_action: {
					label: __("Open WhatsApp Connect"),
					action() { frappe.set_route("santu-whatsapp-connect"); },
				},
			});
			return;
		}

		if (!preview.configured) {
			frappe.msgprint({
				title: __("WhatsApp Not Configured"),
				message: __("WhatsApp integration is not configured. Configure it in Settings → Transaction Message."),
				primary_action: {
					label: __("Open Settings"),
					action() {
						frappe.set_route("santu-transaction-message");
					},
				},
			});
			return;
		}

		let message = preview.message;
		const d = new frappe.ui.Dialog({
			title: __("Send WhatsApp"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "info",
					options: `<p><b>${__("Customer")}:</b> ${frappe.utils.escape_html(preview.party_name)}<br>
						<b>${__("WhatsApp")}:</b> +${frappe.utils.escape_html(preview.phone)}</p>`,
				},
				{
					fieldtype: "HTML",
					fieldname: "preview_html",
					options: `<div class="santu-wa-dialog-preview">${frappe.utils.escape_html(message)}</div>`,
				},
				{
					fieldtype: "Small Text",
					fieldname: "custom_message",
					label: __("Edit Message"),
					default: message,
				},
			],
			primary_action_label: __("Send WhatsApp"),
			primary_action(values) {
				d.hide();
				frappe.dom.freeze(__("Sending…"));
				frappe.xcall("santu_hardware.santu_hardware.transaction_message_api.send_whatsapp_message", {
					doctype: frm.doctype,
					name: frm.doc.name,
					custom_message: values.custom_message,
				}).then((r) => {
					frappe.dom.unfreeze();
					if (r.ok) {
						frappe.show_alert({ message: __("WhatsApp message sent"), indicator: "green" });
						frm.reload_doc();
					} else {
						frappe.msgprint({ title: __("Failed"), message: r.error || __("WhatsApp message failed."), indicator: "red" });
					}
				}).catch((e) => {
					frappe.dom.unfreeze();
					frappe.msgprint(e.message);
				});
			},
		});
		d.show();
	}

	SUPPORTED.forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			refresh(frm) {
				add_whatsapp_button(frm);
			},
		});
	});

	// Global helper for post-sale popup — use API when configured
	window.santu_send_whatsapp_api = async function (doc, customer_mobile) {
		const preview = await frappe.xcall(
			"santu_hardware.santu_hardware.transaction_message_api.get_send_preview",
			{ doctype: doc.doctype, name: doc.name }
		);
		if (preview.configured && preview.phone) {
			const r = await frappe.xcall(
				"santu_hardware.santu_hardware.transaction_message_api.send_whatsapp_message",
				{ doctype: doc.doctype, name: doc.name }
			);
			if (r.ok) {
				frappe.show_alert({ message: __("WhatsApp message sent"), indicator: "green" });
				return true;
			}
			if (r.error) frappe.msgprint(r.error);
			return false;
		}
		return false;
	};
})();
