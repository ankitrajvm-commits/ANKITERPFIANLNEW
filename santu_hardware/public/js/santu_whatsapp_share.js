/**
 * Unified WhatsApp share — always via Party Smart Connect (linked device).
 * Used by Sale, POS, View Invoice, Purchase, and post-sale popup.
 */
(function () {
	const TXN_API = "santu_hardware.santu_hardware.transaction_message_api";
	const CONN_API = "santu_hardware.santu_hardware.whatsapp_connect_api";

	function prompt_connect() {
		frappe.msgprint({
			title: __("WhatsApp Not Connected"),
			message: __("Pehle WhatsApp Smart Connect se link karo — uske baad sale/invoice yahin se share hoga."),
			primary_action: {
				label: __("Open WhatsApp Connect"),
				action() {
					frappe.set_route("santu-whatsapp-connect");
				},
			},
		});
	}

	async function connection_status() {
		try {
			return await frappe.xcall(`${CONN_API}.get_connect_status`);
		} catch (e) {
			return { state: "DISCONNECTED" };
		}
	}

	async function ensure_connected() {
		const st = await connection_status();
		if ((st.state || "").toUpperCase() === "CONNECTED") return true;
		prompt_connect();
		return false;
	}

	function show_send_result(r) {
		if (r && r.ok) {
			frappe.show_alert({ message: __("WhatsApp message sent"), indicator: "green" });
			return true;
		}
		const err = (r && (r.error || r.message)) || __("WhatsApp message failed.");
		frappe.msgprint({ title: __("Failed"), message: err, indicator: "red" });
		return false;
	}

	window.santu_whatsapp_share = {
		async send_transaction(doctype, name, opts = {}) {
			if (!(await ensure_connected())) return { ok: false };

			let preview;
			try {
				preview = await frappe.xcall(`${TXN_API}.get_send_preview`, { doctype, name });
			} catch (e) {
				frappe.msgprint((e && e.message) || __("Failed to load message preview"));
				return { ok: false };
			}

			if (!preview.phone) {
				frappe.msgprint({
					title: __("No WhatsApp Number"),
					message: __("Party ka WhatsApp number nahi mila. Parties screen mein number add karo."),
					primary_action: preview.party_link
						? {
							label: __("Open Parties"),
							action() {
								frappe.route_options = { party_type: preview.party_type, party: preview.party_link };
								frappe.set_route("santu-parties");
							},
						}
						: undefined,
				});
				return { ok: false };
			}

			if (opts.skip_dialog) {
				frappe.dom.freeze(__("Sending…"));
				try {
					const r = await frappe.xcall(`${TXN_API}.send_whatsapp_message`, {
						doctype,
						name,
						custom_message: opts.custom_message || preview.message,
					});
					frappe.dom.unfreeze();
					show_send_result(r);
					return r;
				} catch (e) {
					frappe.dom.unfreeze();
					frappe.msgprint((e && e.message) || __("Send failed"));
					return { ok: false };
				}
			}

			return new Promise((resolve) => {
				const d = new frappe.ui.Dialog({
					title: __("Send on WhatsApp"),
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "info",
							options: `${
								preview.test_redirect_active
									? `<div style="background:#fff3cd;border:1px solid #ffe69c;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12.5px;">
											${__("TEST MODE — this will actually go to")} <b>+${frappe.utils.escape_html(preview.test_redirect_number)}</b>,
											${__("not the party's own number below.")}
										</div>`
									: ""
							}<p><b>${__("Party")}:</b> ${frappe.utils.escape_html(preview.party_name || "")}<br>
								<b>${__("WhatsApp")}:</b> +${frappe.utils.escape_html(preview.phone)}</p>`,
						},
						{
							fieldtype: "Small Text",
							fieldname: "message",
							label: __("Message"),
							default: preview.message,
						},
					],
					primary_action_label: __("Send"),
					primary_action(values) {
						d.hide();
						frappe.dom.freeze(__("Sending…"));
						frappe
							.xcall(`${TXN_API}.send_whatsapp_message`, {
								doctype,
								name,
								custom_message: values.message,
							})
							.then((r) => {
								frappe.dom.unfreeze();
								show_send_result(r);
								resolve(r);
							})
							.catch((e) => {
								frappe.dom.unfreeze();
								// frappe.xcall rejects with undefined when the
								// call fails before a response body exists (a
								// dropped request, a server restart mid-send).
								// Reading .message off that threw its own error
								// on top of the real one, and THAT is what got
								// reported (BUG-20260830-00389) — the operator
								// never saw "Send failed" at all.
								frappe.msgprint((e && e.message) || __("Send failed"));
								resolve({ ok: false });
							});
					},
				});
				d.show();
			});
		},
	};

	// Backward-compatible helper used by post_sale_popup / POS review
	window.santu_send_whatsapp_api = async function (doc) {
		if (!doc || !doc.doctype || !doc.name) return false;
		const r = await window.santu_whatsapp_share.send_transaction(doc.doctype, doc.name, { skip_dialog: true });
		return !!(r && r.ok);
	};
})();
