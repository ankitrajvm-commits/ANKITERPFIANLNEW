/**
 * Unified WhatsApp share — always via Party Smart Connect (linked device).
 * Used by Sale, POS, View Invoice, Purchase, and post-sale popup.
 */
(function () {
	const TXN_API = "santu_hardware.santu_hardware.transaction_message_api";
	const CONN_API = "santu_hardware.santu_hardware.whatsapp_connect_api";

	// The way out when the link is down. Baileys is unofficial, so WhatsApp
	// WILL break it again some day -- and a counter with a customer waiting
	// cannot be told "come back when it is fixed". This saves the very same
	// PDF the send would have carried, so the bill goes out from the phone's
	// own WhatsApp instead (2026-10-02 request).
	async function save_file_instead(doctype, name) {
		frappe.dom.freeze(__("Bill ki file ban rahi hai…"));
		let r;
		try {
			r = await frappe.xcall(`${TXN_API}.save_transaction_pdf`, { doctype, name });
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.msgprint((e && e.message) || __("File nahi ban payi"));
			return { ok: false };
		}
		frappe.dom.unfreeze();
		// A download link, NOT window.open: opening the PDF navigated the whole
		// Desk tab away and took this dialog with it (seen 2026-10-02). The
		// point here is to put the file on the computer, not to read it.
		const $a = $("<a>", { href: r.file_url, download: r.file_name }).appendTo("body");
		$a[0].click();
		$a.remove();
		const d = new frappe.ui.Dialog({
			title: __("Bill Saved"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "body",
					options: `
						<div class="santu-wa-saved">
							<div class="santu-wa-saved-file">${frappe.utils.escape_html(r.file_name)}</div>
							<p>${__("File computer me save ho gayi. Ab apne phone ke WhatsApp se {0} ko bhej dijiye.", [
								frappe.utils.escape_html(r.party_name || "customer"),
							])}</p>
							<textarea class="santu-wa-saved-msg" readonly rows="6">${frappe.utils.escape_html(r.message || "")}</textarea>
							<button type="button" class="santu-wa-copy">${__("Message copy karein")}</button>
						</div>`,
				},
			],
			primary_action_label: __("Close"),
			primary_action: () => d.hide(),
		});
		d.show();
		d.fields_dict.body.$wrapper.find(".santu-wa-copy").on("click", function () {
			const $t = d.fields_dict.body.$wrapper.find(".santu-wa-saved-msg");
			$t.select();
			// navigator.clipboard needs a secure context; this shop runs on
			// plain http://localhost, so the old execCommand is the one that
			// actually works here.
			try {
				document.execCommand("copy");
				frappe.show_alert({ message: __("Message copy ho gaya"), indicator: "green" });
			} catch (e) {
				frappe.show_alert({ message: __("Copy nahi hua — text select karke khud copy karein"), indicator: "orange" });
			}
		});
		return { ok: true, saved: true, file_url: r.file_url };
	}

	function prompt_connect(doctype, name) {
		const can_save = !!(doctype && name);
		frappe.msgprint({
			title: __("WhatsApp Not Connected"),
			message: can_save
				? __("WhatsApp abhi juda nahi hai. Bill ki file save karke apne phone ke WhatsApp se bhej sakte hain, ya pehle WhatsApp jod lijiye.")
				: __("Pehle WhatsApp Smart Connect se link karo — uske baad sale/invoice yahin se share hoga."),
			primary_action: can_save
				? {
					label: __("File save karein"),
					action() {
						save_file_instead(doctype, name);
					},
				}
				: {
					label: __("Open WhatsApp Connect"),
					action() {
						frappe.set_route("santu-whatsapp-connect");
					},
				},
			secondary_action: can_save
				? {
					label: __("WhatsApp jodein"),
					action() {
						frappe.set_route("santu-whatsapp-connect");
					},
				}
				: undefined,
		});
	}

	async function connection_status() {
		try {
			return await frappe.xcall(`${CONN_API}.get_connect_status`);
		} catch (e) {
			return { state: "DISCONNECTED" };
		}
	}

	async function ensure_connected(doctype, name) {
		const st = await connection_status();
		if ((st.state || "").toUpperCase() === "CONNECTED") return true;
		prompt_connect(doctype, name);
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
		// Usable on its own, not only as the fallback -- "save it, I will send
		// it myself" is a reasonable thing to want on any bill.
		save_pdf: save_file_instead,
		// opts.other = true: bill goes to a number the operator types (an
		// accountant, a relative, a driver), not the party's own number.
		async send_transaction(doctype, name, opts = {}) {
			if (!(await ensure_connected(doctype, name))) return { ok: false };
			const other = !!opts.other;

			let preview;
			try {
				preview = await frappe.xcall(`${TXN_API}.get_send_preview`, { doctype, name });
			} catch (e) {
				frappe.msgprint((e && e.message) || __("Failed to load message preview"));
				return { ok: false };
			}

			if (!preview.phone && !other) {
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

			if (opts.skip_dialog && !other) {
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
				let submitted = false;
				const d = new frappe.ui.Dialog({
					title: __("Send on WhatsApp"),
					fields: [
						...(other
							? [
								{
									fieldtype: "Data",
									fieldname: "to_phone",
									label: __("Kis number par bhejna hai (WhatsApp)"),
									description: __("10 digit mobile number"),
									reqd: 1,
								},
								{
									fieldtype: "Data",
									fieldname: "to_name",
									label: __("Naam (optional)"),
									description: __("Khaali chhoda to sirf number dikhega"),
								},
							]
							: []),
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
							}<p><b>${__("Party")}:</b> ${frappe.utils.escape_html(preview.party_name || "")}${
								other ? "" : `<br><b>${__("WhatsApp")}:</b> +${frappe.utils.escape_html(preview.phone)}`
							}</p>`,
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
						let to_phone;
						if (other) {
							to_phone = String(values.to_phone || "").replace(/\D/g, "");
							if (to_phone.length === 12 && to_phone.startsWith("91")) to_phone = to_phone.slice(2);
							if (to_phone.length === 11 && to_phone.startsWith("0")) to_phone = to_phone.slice(1);
							if (!/^[0-9]{10}$/.test(to_phone)) {
								frappe.msgprint(__("Sahi 10 digit WhatsApp number daalo."));
								return;
							}
						}
						submitted = true;
						d.hide();
						frappe.dom.freeze(__("Sending…"));
						frappe
							.xcall(`${TXN_API}.send_whatsapp_message`, {
								doctype,
								name,
								custom_message: values.message,
								to_phone,
								to_name: other ? values.to_name : undefined,
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
				d.onhide = () => {
					if (!submitted) resolve({ ok: false });
				};
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
