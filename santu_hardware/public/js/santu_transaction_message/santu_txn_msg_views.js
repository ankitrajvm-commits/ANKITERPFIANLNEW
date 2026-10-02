/* global santu_txn_msg, frappe */
frappe.provide("santu_txn_msg");

santu_txn_msg.views = {
	async render($wrap, view) {
		$wrap.html(`<div class="santu-txn-msg-loading">Loading…</div>`);
		try {
			if (view === "whatsapp") await this.render_whatsapp($wrap);
			else if (view === "history") await this.render_history($wrap);
			else await this.render_message($wrap);
		} catch (e) {
			$wrap.html(`<div class="santu-txn-msg-error">${frappe.utils.escape_html((e && e.message) || "Failed to load")}</div>`);
		}
	},

	async render_message($wrap) {
		const data = await santu_txn_msg.api.getSettings();
		const state = {
			transaction_type: "Sales Transaction",
			template: "",
			settings: data,
		};
		const tpl = (data.message.templates || []).find((t) => t.transaction_type === state.transaction_type);
		state.template = tpl ? tpl.message_template : "";

		const render = async () => {
			const msg = state.settings.message;
			const wa = state.settings.whatsapp;
			const typeOptions = santu_txn_msg.TRANSACTION_TYPES.map(
				(t) => `<option value="${t}" ${t === state.transaction_type ? "selected" : ""}>${t}</option>`
			).join("");

			$wrap.html(`
				<div class="santu-txn-msg-grid">
					<div class="santu-txn-msg-config">
						${!wa.configured ? `<div class="santu-txn-msg-banner warn">WhatsApp integration is not configured. <a href="#" class="santu-goto-wa">Configure WhatsApp →</a></div>` : ""}
						${wa.configured && !wa.connected ? `<div class="santu-txn-msg-banner warn">🔴 WhatsApp Not Connected. <a href="#" class="santu-goto-connect">Open WhatsApp Connect →</a></div>` : ""}
						${wa.connected ? `<div class="santu-txn-msg-banner ok">🟢 WhatsApp Connected${wa.display_phone ? ` — +${frappe.utils.escape_html(wa.display_phone)}` : ""}</div>` : ""}
						<div class="santu-txn-msg-card">
							<h3>Message Recipient Settings</h3>
							<div class="santu-txn-msg-checks">
								<label><input type="checkbox" class="cfg-send-party" ${msg.send_to_party ? "checked" : ""}> Send Message to Party</label>
								<label><input type="checkbox" class="cfg-send-update" ${msg.send_update_message ? "checked" : ""}> Send Transaction Update Message</label>
								<label><input type="checkbox" class="cfg-send-copy" ${msg.send_copy_to_self ? "checked" : ""}> Send Message Copy to Self</label>
								<label><input type="checkbox" class="cfg-auto-send" ${msg.auto_send_on_submit ? "checked" : ""}> Auto Send Invoice on Transaction Submit</label>
								<label><input type="checkbox" class="cfg-attach-pdf" ${msg.attach_invoice_pdf ? "checked" : ""}> Attach Invoice PDF</label>
								<label><input type="checkbox" class="cfg-invoice-link" ${msg.include_web_invoice_link ? "checked" : ""}> Include Web Invoice Link</label>
								<label><input type="checkbox" class="cfg-payment-link" ${msg.include_payment_link ? "checked" : ""}> Include Payment Link</label>
								<label><input type="checkbox" class="cfg-party-balance" ${msg.include_party_balance ? "checked" : ""}> Include Current Party Balance</label>
								<label><input type="checkbox" class="cfg-reminder" ${msg.enable_payment_reminder ? "checked" : ""}> Enable Payment Reminder</label>
							</div>
							<label class="santu-txn-msg-field">Owner WhatsApp Number
								<input class="form-control cfg-owner-phone" value="${frappe.utils.escape_html(msg.owner_whatsapp_number || "")}" placeholder="+91XXXXXXXXXX">
							</label>
						</div>
						<div class="santu-txn-msg-card">
							<h3>Send Automatic Message for</h3>
							<div class="santu-txn-msg-auto-grid" id="auto-send-grid"></div>
						</div>
						<div class="santu-txn-msg-card">
							<h3>Edit Message</h3>
							<label>Transaction Type
								<select class="form-control cfg-tx-type">${typeOptions}</select>
							</label>
							<div class="santu-txn-msg-vars">
								<span class="vars-label">Variables:</span>
								${(state.settings.template_variables || []).map((v) => `<button type="button" class="btn btn-xs btn-default var-btn" data-var="${v}">{{ ${v} }}</button>`).join(" ")}
							</div>
							<textarea class="form-control cfg-template" rows="12">${frappe.utils.escape_html(state.template)}</textarea>
						</div>
						<div class="santu-txn-msg-footer">
							<button class="btn btn-primary santu-txn-msg-save">Save Settings</button>
						</div>
					</div>
					<div class="santu-txn-msg-preview-col">
						<h3>Message Preview</h3>
						<div class="santu-wa-preview-bubble">
							<div class="wa-company">Santu Hardware</div>
							<div class="wa-body santu-preview-body"></div>
							<div class="wa-time">${frappe.datetime.now_datetime().slice(11, 16)}</div>
						</div>
					</div>
				</div>
			`);

			const autoGrid = $wrap.find("#auto-send-grid");
			(msg.templates || []).forEach((t, i) => {
				autoGrid.append(`
					<label><input type="checkbox" class="auto-tx" data-idx="${i}" data-type="${frappe.utils.escape_html(t.transaction_type)}" ${t.auto_send && t.enabled ? "checked" : ""}>
					${frappe.utils.escape_html(t.transaction_type)}</label>
				`);
			});

			const updatePreview = santu_txn_msg.utils.debounce_preview || (santu_txn_msg.utils.debounce_preview = (() => {
				let t;
				return (fn) => { clearTimeout(t); t = setTimeout(fn, 300); };
			})());

			const refreshPreview = () => {
				santu_txn_msg.api.getPreview(state.transaction_type, state.template).then((r) => {
					$wrap.find(".santu-preview-body").text(r.message || "");
				});
			};

			$wrap.find(".cfg-tx-type").on("change", function () {
				state.transaction_type = $(this).val();
				const row = (msg.templates || []).find((t) => t.transaction_type === state.transaction_type);
				state.template = row ? row.message_template : "";
				$wrap.find(".cfg-template").val(state.template);
				refreshPreview();
			});

			$wrap.find(".cfg-template").on("input", function () {
				state.template = $(this).val();
				updatePreview(refreshPreview);
			});

			$wrap.find(".var-btn").on("click", function () {
				const v = `{{ ${$(this).data("var")} }}`;
				const $ta = $wrap.find(".cfg-template");
				const el = $ta[0];
				const start = el.selectionStart;
				const end = el.selectionEnd;
				const text = $ta.val();
				$ta.val(text.slice(0, start) + v + text.slice(end));
				state.template = $ta.val();
				refreshPreview();
			});

			$wrap.find(".santu-goto-wa").on("click", (e) => {
				e.preventDefault();
				sessionStorage.setItem("santu_txn_msg_view", "whatsapp");
				$(document).trigger("santu-txn-msg-view-change");
			});
			$wrap.find(".santu-goto-connect").on("click", (e) => {
				e.preventDefault();
				frappe.set_route("santu-whatsapp-connect");
			});

			$wrap.find(".santu-txn-msg-save").on("click", async () => {
				const templates = [...(msg.templates || [])];
				const idx = templates.findIndex((t) => t.transaction_type === state.transaction_type);
				if (idx >= 0) templates[idx].message_template = state.template;
				$wrap.find(".auto-tx").each(function () {
					const i = $(this).data("idx");
					if (templates[i]) {
						templates[i].auto_send = $(this).is(":checked") ? 1 : 0;
						templates[i].enabled = $(this).is(":checked") ? 1 : templates[i].enabled;
					}
				});
				await santu_txn_msg.api.saveMessage({
					send_to_party: $wrap.find(".cfg-send-party").is(":checked") ? 1 : 0,
					send_update_message: $wrap.find(".cfg-send-update").is(":checked") ? 1 : 0,
					send_copy_to_self: $wrap.find(".cfg-send-copy").is(":checked") ? 1 : 0,
					owner_whatsapp_number: $wrap.find(".cfg-owner-phone").val(),
					auto_send_on_submit: $wrap.find(".cfg-auto-send").is(":checked") ? 1 : 0,
					attach_invoice_pdf: $wrap.find(".cfg-attach-pdf").is(":checked") ? 1 : 0,
					include_web_invoice_link: $wrap.find(".cfg-invoice-link").is(":checked") ? 1 : 0,
					include_payment_link: $wrap.find(".cfg-payment-link").is(":checked") ? 1 : 0,
					include_party_balance: $wrap.find(".cfg-party-balance").is(":checked") ? 1 : 0,
					enable_payment_reminder: $wrap.find(".cfg-reminder").is(":checked") ? 1 : 0,
					templates,
				});
				frappe.show_alert({ message: "Settings saved", indicator: "green" });
				state.settings = await santu_txn_msg.api.getSettings();
			});

			refreshPreview();
		};
		render();
	},

	async render_whatsapp($wrap) {
		const data = await santu_txn_msg.api.getSettings();
		const wa = data.whatsapp;
		const connected = wa.connection_status === "Connected";
		$wrap.html(`
			<div class="santu-txn-msg-card santu-wa-config">
				<div class="santu-wa-status-row">
					<h3>WhatsApp Integration</h3>
					<span class="santu-wa-status ${connected ? "connected" : "disconnected"}">
						${connected ? "● Connected" : "● Not Connected"}
					</span>
				</div>
				${wa.last_test_error ? `<div class="santu-txn-msg-banner error">${frappe.utils.escape_html(wa.last_test_error)}</div>` : ""}
				<div class="santu-txn-msg-form-grid">
					<label><input type="checkbox" class="wa-enabled" ${wa.enabled ? "checked" : ""}> Enable WhatsApp</label>
					<label>Provider<select class="form-control wa-provider"><option>Meta Cloud API</option></select></label>
					<label>API URL<input class="form-control wa-api-url" value="${frappe.utils.escape_html(wa.api_url || "")}"></label>
					<label>Access Token<input type="password" class="form-control wa-token" placeholder="${wa.has_token ? "•••••••• (saved)" : "Enter token"}"></label>
					<label>Phone Number ID<input class="form-control wa-phone-id" value="${frappe.utils.escape_html(wa.phone_number_id || "")}"></label>
					<label>Business Account ID<input class="form-control wa-biz-id" value="${frappe.utils.escape_html(wa.business_account_id || "")}"></label>
					<label>Sender Number<input class="form-control wa-sender" value="${frappe.utils.escape_html(wa.sender_number || "")}"></label>
					<label>Webhook Verify Token<input class="form-control wa-webhook" value="${frappe.utils.escape_html(data.webhook_verify_token || "")}"></label>
				</div>
				<div class="santu-txn-msg-footer">
					<button class="btn btn-primary wa-save">Save Configuration</button>
					<button class="btn btn-default wa-test">Test Connection</button>
				</div>
				<p class="santu-txn-msg-muted">Webhook URL: <code>${window.location.origin}/api/method/santu_hardware.santu_hardware.transaction_message_api.whatsapp_webhook</code></p>
			</div>
		`);

		$wrap.find(".wa-save").on("click", async () => {
			const payload = {
				enabled: $wrap.find(".wa-enabled").is(":checked") ? 1 : 0,
				provider: $wrap.find(".wa-provider").val(),
				api_url: $wrap.find(".wa-api-url").val(),
				phone_number_id: $wrap.find(".wa-phone-id").val(),
				business_account_id: $wrap.find(".wa-biz-id").val(),
				sender_number: $wrap.find(".wa-sender").val(),
			};
			const token = $wrap.find(".wa-token").val();
			if (token) payload.access_token = token;
			await santu_txn_msg.api.saveWhatsapp(payload);
			frappe.show_alert({ message: "WhatsApp settings saved", indicator: "green" });
			this.render_whatsapp($wrap);
		});

		$wrap.find(".wa-test").on("click", async () => {
			const $btn = $wrap.find(".wa-test");
			$btn.prop("disabled", true).text("Testing…");
			try {
				const r = await santu_txn_msg.api.testConnection();
				if (r.ok) frappe.msgprint({ title: "Connected", message: `✓ WhatsApp connected${r.verified_name ? ` — ${r.verified_name}` : ""}`, indicator: "green" });
				else frappe.msgprint({ title: "Failed", message: r.error || "Connection failed", indicator: "red" });
			} finally {
				$btn.prop("disabled", false).text("Test Connection");
				this.render_whatsapp($wrap);
			}
		});
	},

	async render_history($wrap, page = 1, search = "") {
		const data = await santu_txn_msg.api.getHistory(page, search);
		$wrap.html(`
			<div class="santu-txn-msg-toolbar">
				<input class="form-control santu-hist-search" placeholder="Search party…" value="${frappe.utils.escape_html(search)}">
			</div>
			<table class="santu-txn-msg-table">
				<thead><tr><th>Date</th><th>Party</th><th>Transaction</th><th>Type</th><th>WhatsApp</th><th>Status</th><th>Sent By</th><th>Actions</th></tr></thead>
				<tbody></tbody>
			</table>
			<div class="santu-txn-msg-pagination">
				<button class="btn btn-sm btn-default hist-prev" ${page <= 1 ? "disabled" : ""}>Prev</button>
				<span>Page ${page}</span>
				<button class="btn btn-sm btn-default hist-next" ${page * 50 >= data.total ? "disabled" : ""}>Next</button>
			</div>
		`);
		const $tb = $wrap.find("tbody");
		(data.rows || []).forEach((r) => {
			const $tr = $(`<tr>
				<td>${r.sent_at ? frappe.datetime.str_to_user(r.sent_at) : "—"}</td>
				<td>${frappe.utils.escape_html(r.party_name || "")}</td>
				<td>${frappe.utils.escape_html(r.reference_name || "")}</td>
				<td>${frappe.utils.escape_html(r.transaction_type || "")}</td>
				<td>${frappe.utils.escape_html(r.phone_number || "")}</td>
				<td><span class="status-badge ${santu_txn_msg.utils.status_class(r.status)}">${r.status}</span></td>
				<td>${frappe.utils.escape_html(r.sent_by || "")}</td>
				<td class="hist-actions"></td>
			</tr>`);
			$tr.find(".hist-actions").append(`<button class="btn btn-xs btn-default" data-view="${r.name}">View</button>`);
			if (r.status === "Failed") {
				$tr.find(".hist-actions").append(`<button class="btn btn-xs btn-primary" data-retry="${r.name}">Retry</button>`);
			}
			$tb.append($tr);
		});
		$wrap.find("[data-view]").on("click", async function () {
			const d = await santu_txn_msg.api.getLogDetail($(this).data("view"));
			frappe.msgprint({ title: "Message", message: `<pre style="white-space:pre-wrap">${frappe.utils.escape_html(d.message_body || "")}</pre><p>Status: ${d.status}<br>Error: ${frappe.utils.escape_html(d.error_message || "—")}</p>`, wide: true });
		});
		$wrap.find("[data-retry]").on("click", async function () {
			const r = await santu_txn_msg.api.retry($(this).data("retry"));
			frappe.msgprint(r.ok ? "Message sent" : (r.error || "Failed"));
			santu_txn_msg.views.render_history($wrap, page, search);
		});
		$wrap.find(".hist-prev").on("click", () => santu_txn_msg.views.render_history($wrap, page - 1, search));
		$wrap.find(".hist-next").on("click", () => santu_txn_msg.views.render_history($wrap, page + 1, search));
		let st;
		$wrap.find(".santu-hist-search").on("input", function () {
			clearTimeout(st);
			st = setTimeout(() => santu_txn_msg.views.render_history($wrap, 1, $(this).val()), 400);
		});
	},
};
