/* global santu_wa_connect, frappe */
frappe.provide("santu_wa_connect");

santu_wa_connect.state = { activePhone: null, activeChat: null, status: null };

santu_wa_connect.init = async function ($parent) {
	const $root = $(`<div class="santu-wa-connect"></div>`).appendTo($parent);
	santu_wa_connect.$root = $root;
	await santu_wa_connect.render();
};

santu_wa_connect.render = async function () {
	const status = await santu_wa_connect.api.status();
	santu_wa_connect.state.status = status;
	if (status.state === "CONNECTED") {
		santu_wa_connect.renderWorkspace(status);
		return;
	}
	if (status.state === "QR" || status.state === "CONNECTING" || status.state === "RECONNECTING") {
		santu_wa_connect.renderQrScreen(status);
		return;
	}
	santu_wa_connect.renderConnectScreen(status);
};

santu_wa_connect.renderConnectScreen = function (status) {
	const viewed = sessionStorage.getItem("santu_wa_intro_seen") === "1";
	if (!viewed) {
		santu_wa_connect.renderLanding(status);
		return;
	}
	santu_wa_connect.renderIntro(status);
};

santu_wa_connect.renderLanding = function (status) {
	santu_wa_connect.$root.html(`
		<div class="santu-psc">
			<div class="santu-psc-left">
				<img class="santu-psc-hero" src="/assets/santu_hardware/images/whatsapp/whatsapp.svg" alt="">
				<div class="santu-psc-kicker">Party Smart Connect</div>
				<h2>WhatsApp as Usual</h2>
				<p>Phone ka WhatsApp is desktop se <b>linked device</b> ki tarah judta hai — invoice, reminder aur party chat yahin se.</p>
			</div>
			<div class="santu-psc-right">
				<div class="santu-psc-new">NEW</div>
				<h3>Get Started</h3>
				<p class="santu-psc-muted">Open WhatsApp on your phone → <b>Linked devices</b> → scan the QR that appears next.</p>
				${status.last_error ? `<div class="santu-wa-error">${frappe.utils.escape_html(santu_wa_connect.sanitizeBridgeError(status.last_error))}</div>` : ""}
				<label class="santu-wa-terms"><input type="checkbox" class="wa-terms-cb" ${status.terms_accepted ? "checked" : ""}> Proceed with Standard Usage Terms</label>
				<button type="button" class="santu-psc-cta wa-start-btn" ${status.terms_accepted ? "" : "disabled"}>Get Started</button>
			</div>
		</div>
	`);
	santu_wa_connect.$root.find(".wa-terms-cb").on("change", async function () {
		if ($(this).is(":checked")) await santu_wa_connect.api.acceptTerms();
		santu_wa_connect.$root.find(".wa-start-btn").prop("disabled", !$(this).is(":checked"));
	});
	santu_wa_connect.$root.find(".wa-start-btn").on("click", () => {
		sessionStorage.setItem("santu_wa_intro_seen", "1");
		santu_wa_connect.renderIntro(status);
	});
};

santu_wa_connect.renderIntro = function (status) {
	santu_wa_connect.$root.html(`
		<div class="santu-psc santu-psc-intro">
			<div class="santu-psc-intro-card">
				<img src="/assets/santu_hardware/images/whatsapp/whatsappHeaderNav.svg" alt="" class="santu-psc-intro-icon">
				<h2>Connect WhatsApp</h2>
				<ol class="santu-psc-steps">
					<li>Phone pe <b>WhatsApp</b> kholo</li>
					<li><b>Linked devices</b> → <b>Link a device</b></li>
					<li>Jo QR next screen pe aaye, use scan karo</li>
				</ol>
				<button type="button" class="santu-psc-cta wa-qr-btn">Continue</button>
				<button type="button" class="santu-psc-link wa-back-landing">Back</button>
			</div>
		</div>
	`);
	santu_wa_connect.$root.find(".wa-back-landing").on("click", () => {
		sessionStorage.removeItem("santu_wa_intro_seen");
		santu_wa_connect.renderLanding(status);
	});
	santu_wa_connect.$root.find(".wa-qr-btn").on("click", () => santu_wa_connect.beginQrLogin());
};

santu_wa_connect.beginQrLogin = async function () {
	santu_wa_connect.$root.html(`
		<div class="santu-psc-qr-wrap">
			<div class="santu-psc-qr-card">
				<div class="santu-psc-qr-title">Scan QR code</div>
				<div class="santu-psc-qr-box"><div class="santu-psc-qr-wait">QR aa raha hai…</div></div>
				<p class="santu-psc-qr-help">QR aate hi <b>turant scan</b> karo (20 sec mein expire). Phone: WhatsApp → Linked devices → Link a device. “Couldn’t link” aaye to naya QR wait karo — purana mat scan karo.</p>
			</div>
		</div>
	`);
	try {
		await santu_wa_connect.api.acceptTerms();
		const st = await santu_wa_connect.api.startSmartConnect();
		santu_wa_connect.applyQrStatus(st);
		santu_wa_connect.startQrPoll();
	} catch (e) {
		frappe.msgprint((e && e.message) || "Could not start WhatsApp Connect");
		santu_wa_connect.render();
	}
};

santu_wa_connect.startQrPoll = function () {
	clearInterval(santu_wa_connect._qrTimer);
	santu_wa_connect._qrTimer = setInterval(async () => {
		try {
			const st = await santu_wa_connect.api.qrStatus();
			santu_wa_connect.applyQrStatus(st);
		} catch (e) {}
	}, 1000);
};

santu_wa_connect.sanitizeBridgeError = function (msg) {
	if (!msg) return "";
	const s = String(msg);
	if (/subtle|webcrypto/i.test(s)) return "WhatsApp engine needs a newer Node. Tap Continue again.";
	if (/ERR_REQUIRE_ESM/i.test(s)) return "WhatsApp library failed to load. Tap Continue again.";
	if (/eaddrinuse/i.test(s)) return "WhatsApp bridge is busy. Wait a moment and tap Continue again.";
	const lines = s.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);
	if (lines.some((ln) => ln.startsWith("at ") || ln.startsWith("/") || ln.includes("node:internal"))) {
		const friendly = lines.find((ln) => !ln.startsWith("at ") && !ln.startsWith("/") && !ln.includes("node:internal"));
		return friendly ? friendly.slice(0, 200) : "WhatsApp connection failed. Tap Continue to retry.";
	}
	return s.slice(0, 200);
};

santu_wa_connect.applyQrStatus = function (st) {
	st = st || {};
	const state = (st.state || "").toUpperCase();
	if (state === "CONNECTED") {
		clearInterval(santu_wa_connect._qrTimer);
		frappe.show_alert({ message: "WhatsApp Connected", indicator: "green" });
		santu_wa_connect.render();
		return;
	}
	const $box = santu_wa_connect.$root.find(".santu-psc-qr-box");
	if (!$box.length) return;
	if (st.qr) {
		$box.html(`<img src="${st.qr}" alt="WhatsApp QR">`);
	} else if (state === "ERROR") {
		clearInterval(santu_wa_connect._qrTimer);
		$box.html(`<div class="santu-psc-qr-wait">QR nahi khula</div>`);
	} else if (state === "CONNECTING" || state === "RECONNECTING") {
		$box.html(`<div class="santu-psc-qr-wait">Linking phone… QR scan ho chuka hai, thoda wait karo.</div>`);
	}
	const err = santu_wa_connect.sanitizeBridgeError(st.error);
	const $err = santu_wa_connect.$root.find(".santu-psc-qr-error");
	if (err) {
		if ($err.length) $err.text(err).show();
		else santu_wa_connect.$root.find(".santu-psc-qr-help").after(`<div class="santu-psc-qr-error santu-wa-error">${frappe.utils.escape_html(err)}</div>`);
	} else if ($err.length) {
		$err.hide().text("");
	}
};

santu_wa_connect.renderQrScreen = function (status) {
	santu_wa_connect.$root.html(`
		<div class="santu-psc-qr-wrap">
			<div class="santu-psc-qr-card">
				<div class="santu-psc-qr-title">Scan QR code</div>
				<div class="santu-psc-qr-box">${
					status.qr
						? `<img src="${status.qr}" alt="WhatsApp QR">`
						: `<div class="santu-psc-qr-wait">QR aa raha hai…</div>`
				}</div>
				<p class="santu-psc-qr-help">QR aate hi <b>turant scan</b> karo (20 sec mein expire). Phone: WhatsApp → Linked devices → Link a device. “Couldn’t link” aaye to naya QR wait karo — purana mat scan karo.</p>
			</div>
		</div>
	`);
	santu_wa_connect.startQrPoll();
};

santu_wa_connect.renderWorkspace = function (status) {
	santu_wa_connect.$root.html(`
		<div class="santu-wa-connect-header">
			<h1>WhatsApp Connect</h1>
			<span class="santu-wa-state-badge connected">🟢 WhatsApp Connected${status.display_phone ? ` — +${frappe.utils.escape_html(status.display_phone)}` : ""}</span>
			<button class="btn btn-sm btn-default santu-wa-settings-btn" title="Settings">⚙</button>
		</div>
		<div class="santu-wa-workspace">
			<div class="santu-wa-chat-list-panel">
				<input class="form-control santu-wa-search" placeholder="Search or start a new chat">
				<div class="santu-wa-chat-list"></div>
			</div>
			<div class="santu-wa-chat-panel">
				<div class="santu-wa-chat-empty">Select a chat to start messaging</div>
			</div>
		</div>
		<div class="santu-wa-settings-drawer" style="display:none"></div>
	`);

	santu_wa_connect.$root.find(".santu-wa-settings-btn").on("click", () => santu_wa_connect.openSettingsDrawer());
	santu_wa_connect.loadChatList();
	let debounce;
	santu_wa_connect.$root.find(".santu-wa-search").on("input", function () {
		clearTimeout(debounce);
		debounce = setTimeout(() => santu_wa_connect.loadChatList($(this).val()), 300);
	});
};

santu_wa_connect.loadChatList = async function (search) {
	const $list = santu_wa_connect.$root.find(".santu-wa-chat-list");
	$list.html(`<div class="santu-wa-loading">Loading…</div>`);
	const data = await santu_wa_connect.api.chats(search || "");
	$list.empty();
	if (!data.chats.length) {
		$list.html(`<div class="santu-wa-empty">No chats yet. Search for a customer to start.</div>`);
		return;
	}
	data.chats.forEach((c) => {
		const time = c.last_message_at ? frappe.datetime.str_to_user(c.last_message_at).slice(-8) : "";
		const $item = $(`
			<div class="santu-wa-chat-item" data-phone="${frappe.utils.escape_html(c.phone_number)}">
				<div class="santu-wa-avatar">${(c.display_name || "?")[0].toUpperCase()}</div>
				<div class="santu-wa-chat-meta">
					<div class="santu-wa-chat-top"><b>${frappe.utils.escape_html(c.display_name || c.phone_number)}</b><span>${time}</span></div>
					<div class="santu-wa-chat-preview">${frappe.utils.escape_html(c.last_message_preview || "")}</div>
				</div>
				${c.unread_count ? `<span class="santu-wa-unread">${c.unread_count}</span>` : ""}
			</div>
		`);
		$item.data("chat", c);
		$list.append($item);
	});
	$list.find(".santu-wa-chat-item").on("click", function () {
		$list.find(".santu-wa-chat-item").removeClass("active");
		$(this).addClass("active");
		santu_wa_connect.openChat($(this).data("chat"));
	});
};

santu_wa_connect.openChat = async function (chat) {
	santu_wa_connect.state.activeChat = chat;
	santu_wa_connect.state.activePhone = chat.phone_number;
	const $panel = santu_wa_connect.$root.find(".santu-wa-chat-panel");
	$panel.html(`
		<div class="santu-wa-chat-header">
			<div class="santu-wa-avatar">${(chat.display_name || "?")[0].toUpperCase()}</div>
			<div><b>${frappe.utils.escape_html(chat.display_name || chat.phone_number)}</b><br><small>+${frappe.utils.escape_html(chat.phone_number)}</small></div>
			${!chat.party_name ? `<button class="btn btn-xs btn-default wa-link-party">Link to Customer</button>` : ""}
		</div>
		<div class="santu-wa-messages"></div>
		<div class="santu-wa-quick-actions"></div>
		<div class="santu-wa-suggestions"></div>
		<div class="santu-wa-composer">
			<button class="btn btn-sm btn-default wa-attach-btn">+</button>
			<input class="form-control wa-message-input" placeholder="Type a Message">
			<button class="btn btn-sm btn-primary wa-send-btn">➤</button>
		</div>
	`);

	if (!chat.party_name) {
		$panel.find(".wa-link-party").on("click", () => {
			frappe.prompt({ fieldtype: "Link", options: "Customer", fieldname: "customer", label: "Customer", reqd: 1 }, (v) => {
				santu_wa_connect.api.linkParty(chat.phone_number, "Customer", v.customer).then(() => {
					chat.party_type = "Customer"; chat.party_name = v.customer;
					santu_wa_connect.openChat(chat);
				});
			}, "Link to Customer");
		});
	}

	santu_wa_connect.renderQuickActions(chat);
	santu_wa_connect.loadSuggestions(chat);
	santu_wa_connect.loadMessages(chat.phone_number);

	$panel.find(".wa-send-btn").on("click", () => santu_wa_connect.sendCurrentMessage());
	$panel.find(".wa-message-input").on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); santu_wa_connect.sendCurrentMessage(); } });
	$panel.find(".wa-attach-btn").on("click", () => santu_wa_connect.showAttachMenu(chat));
};

santu_wa_connect.loadMessages = async function (phone) {
	const $msgs = santu_wa_connect.$root.find(".santu-wa-messages");
	const data = await santu_wa_connect.api.messages(phone);
	$msgs.empty();
	if (!data.messages.length) {
		$msgs.html(`<div class="santu-wa-date-divider">TODAY</div><div class="santu-wa-empty-chat">No messages yet. Say hello!</div>`);
		return;
	}
	$msgs.append(`<div class="santu-wa-date-divider">TODAY</div>`);
	data.messages.forEach((m) => {
		const cls = m.direction === "Outgoing" ? "outgoing" : "incoming";
		const time = m.timestamp ? frappe.datetime.str_to_user(m.timestamp).slice(-8) : "";
		const ticks = m.direction === "Outgoing" ? santu_wa_connect.statusTicks(m.status) : "";
		const $bubble = $(`<div class="santu-wa-bubble ${cls}"><div class="santu-wa-bubble-body">${frappe.utils.escape_html(m.message_body || "")}</div><div class="santu-wa-bubble-meta">${time} ${ticks}${m.status === "Failed" ? ` <button class="btn btn-xs btn-danger wa-retry" data-chat="${m.name}">Retry</button>` : ""}</div></div>`);
		$msgs.append($bubble);
	});
	$msgs.scrollTop($msgs[0].scrollHeight);
	$msgs.find(".wa-retry").on("click", function () {
		santu_wa_connect.api.retry($(this).data("chat")).then(() => santu_wa_connect.loadMessages(phone));
	});
};

santu_wa_connect.statusTicks = function (status) {
	if (status === "Read") return '<span class="ticks read">✓✓</span>';
	if (status === "Delivered") return '<span class="ticks">✓✓</span>';
	if (status === "Sent") return '<span class="ticks">✓</span>';
	return "";
};

santu_wa_connect.sendCurrentMessage = async function () {
	const chat = santu_wa_connect.state.activeChat;
	const $input = santu_wa_connect.$root.find(".wa-message-input");
	const msg = $input.val().trim();
	if (!msg || !chat) return;
	$input.val("");
	const r = await santu_wa_connect.api.send(chat.phone_number, msg, chat.party_type, chat.party_name);
	if (r.ok) {
		santu_wa_connect.loadMessages(chat.phone_number);
		santu_wa_connect.loadChatList();
	} else {
		frappe.msgprint(r.error || "Failed to send");
	}
};

santu_wa_connect.renderQuickActions = function (chat) {
	const $qa = santu_wa_connect.$root.find(".santu-wa-quick-actions");
	if (!chat.party_name) { $qa.hide(); return; }
	$qa.html(`
		<button class="santu-wa-chip smart">✨ Smart Messaging ▾</button>
		<button class="santu-wa-chip statement">📄 Party Statement</button>
		<button class="santu-wa-chip transactions">📗 Send Transactions</button>
		<button class="santu-wa-chip reminder">💳 Payment Reminder</button>
	`);
	$qa.find(".statement").on("click", () => santu_wa_connect.partyStatement(chat));
	$qa.find(".transactions").on("click", () => santu_wa_connect.sendTransactions(chat));
	$qa.find(".reminder").on("click", () => santu_wa_connect.paymentReminder(chat));
};

santu_wa_connect.loadSuggestions = async function (chat) {
	const $s = santu_wa_connect.$root.find(".santu-wa-suggestions");
	const data = await santu_wa_connect.api.suggestions(chat.display_name);
	$s.html(`<div class="santu-wa-sugg-row">${(data.suggestions || []).map((t) => `<button class="santu-wa-sugg">${frappe.utils.escape_html(t)}</button>`).join("")}<button class="santu-wa-regenerate">↻ Regenerate</button></div>`);
	$s.find(".santu-wa-sugg").on("click", function () { santu_wa_connect.$root.find(".wa-message-input").val($(this).text()); });
	$s.find(".santu-wa-regenerate").on("click", () => santu_wa_connect.loadSuggestions(chat));
};

santu_wa_connect.partyStatement = async function (chat) {
	const data = await santu_wa_connect.api.statement(chat.party_type, chat.party_name);
	const msg = `Party Statement\nClosing Balance: ₹${Number(data.closing_balance || 0).toLocaleString("en-IN")}`;
	frappe.confirm(`Send party statement to ${chat.display_name}?<br><pre>${frappe.utils.escape_html(msg)}</pre>`, async () => {
		const r = await santu_wa_connect.api.sendStatement(chat.party_type, chat.party_name);
		if (r.ok) { frappe.show_alert({ message: "Statement sent", indicator: "green" }); santu_wa_connect.loadMessages(chat.phone_number); }
		else frappe.msgprint(r.error);
	});
};

santu_wa_connect.sendTransactions = async function (chat) {
	const data = await santu_wa_connect.api.transactions(chat.party_type, chat.party_name);
	if (!data.transactions.length) { frappe.msgprint("No recent transactions."); return; }
	const d = new frappe.ui.Dialog({ title: "Send Transaction", fields: [{ fieldtype: "HTML", fieldname: "list" }] });
	let html = `<table class="table table-bordered"><tr><th></th><th>Doc</th><th>Date</th><th>Amount</th></tr>`;
	data.transactions.forEach((t) => { html += `<tr><td><input type="radio" name="txn" value="${t.doctype}|${t.name}"></td><td>${t.name}</td><td>${t.date}</td><td>₹${t.amount}</td></tr>`; });
	html += "</table>";
	d.fields_dict.list.$wrapper.html(html);
	d.set_primary_action("Preview & Send", async () => {
		const val = d.$wrapper.find('input[name="txn"]:checked').val();
		if (!val) return;
		const [doctype, name] = val.split("|");
		const preview = await santu_wa_connect.api.previewTxn(doctype, name);
		frappe.confirm(`<pre style="white-space:pre-wrap">${frappe.utils.escape_html(preview.message)}</pre>`, async () => {
			const r = await santu_wa_connect.api.sendTxn(doctype, name);
			if (r.ok) { d.hide(); santu_wa_connect.loadMessages(chat.phone_number); frappe.show_alert({ message: "Sent", indicator: "green" }); }
			else frappe.msgprint(r.error);
		});
	});
	d.show();
};

santu_wa_connect.paymentReminder = async function (chat) {
	const data = await santu_wa_connect.api.reminderPreview(chat.party_type, chat.party_name);
	frappe.confirm(`<pre style="white-space:pre-wrap">${frappe.utils.escape_html(data.message)}</pre>`, async () => {
		const r = await santu_wa_connect.api.sendReminder(chat.party_type, chat.party_name);
		if (r.ok) { frappe.show_alert({ message: "Reminder sent", indicator: "green" }); santu_wa_connect.loadMessages(chat.phone_number); }
		else frappe.msgprint(r.error);
	});
};

santu_wa_connect.showAttachMenu = function (chat) {
	frappe.msgprint({ title: "Attachments", message: "Use Send Transactions or Party Statement for document attachments. Free-text messages can be typed below." });
};

santu_wa_connect.openSettingsDrawer = async function () {
	const data = await santu_wa_connect.api.settings();
	const $drawer = santu_wa_connect.$root.find(".santu-wa-settings-drawer");
	$drawer.show().html(`
		<div class="santu-wa-drawer-overlay"></div>
		<div class="santu-wa-drawer-panel">
			<div class="santu-wa-drawer-header"><h3>WhatsApp Connect Settings</h3><button class="btn btn-sm wa-drawer-close">✕</button></div>
			<div class="santu-wa-drawer-body">
				<h4>Account Settings</h4>
				<p>Logged in as:<br><b>+${frappe.utils.escape_html(data.logged_in_as || "—")}</b></p>
				<hr>
				<label><input type="checkbox" class="wa-sync-contacts" ${data.sync_personal_contacts ? "checked" : ""}> Sync Personal Contacts</label><br>
				<label><input type="checkbox" class="wa-passcode" ${data.passcode_enabled ? "checked" : ""}> Set Passcode</label>
				<hr>
				<button class="btn btn-default btn-block wa-refresh">↻ Refresh WhatsApp Connect</button>
				<button class="btn btn-default btn-block wa-disable">⏻ Disable WhatsApp Smart Connect</button>
				<button class="btn btn-danger btn-block wa-logout">🚪 Logout from WhatsApp</button>
			</div>
		</div>
	`);
	$drawer.find(".wa-drawer-close, .santu-wa-drawer-overlay").on("click", () => $drawer.hide());
	$drawer.find(".wa-sync-contacts, .wa-passcode").on("change", async () => {
		await santu_wa_connect.api.saveSettings({ sync_personal_contacts: $drawer.find(".wa-sync-contacts").is(":checked") ? 1 : 0, passcode_enabled: $drawer.find(".wa-passcode").is(":checked") ? 1 : 0 });
	});
	$drawer.find(".wa-refresh").on("click", async () => { await santu_wa_connect.api.refresh(); frappe.show_alert({ message: "Refreshed", indicator: "green" }); santu_wa_connect.render(); });
	$drawer.find(".wa-logout").on("click", async () => {
		frappe.confirm("Logout from WhatsApp?", async () => { await santu_wa_connect.api.disconnect(); $drawer.hide(); santu_wa_connect.render(); });
	});
};
