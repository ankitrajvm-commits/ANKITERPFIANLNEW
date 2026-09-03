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

santu_wa_connect.openQrModal = async function () {
	const d = new frappe.ui.Dialog({
		title: __("Link WhatsApp with QR Code"),
		fields: [
			{ fieldtype: "HTML", fieldname: "qr_html" },
		],
	});
	d.$wrapper.find(".modal-dialog").css({ "max-width": "460px" });
	const $wrap = d.fields_dict.qr_html.$wrapper;
	$wrap.html(`
		<div class="santu-psc-qr-wrap" style="padding:10px 0;">
			<div class="santu-psc-qr-card" style="box-shadow:none;border:none;padding:0;max-width:100%;">
				<div class="santu-psc-qr-title" style="font-size:16px;">Scan QR code</div>
				<div class="santu-psc-qr-box"><div class="santu-psc-qr-wait">QR aa raha hai…</div></div>
				<p class="santu-psc-qr-help" style="font-size:12px;margin-top:12px;">Phone: <b>WhatsApp → Linked devices → Link a device</b>. QR aate hi turant scan karein.</p>
			</div>
		</div>
	`);
	d.show();

	try {
		await santu_wa_connect.api.acceptTerms();
		const st = await santu_wa_connect.api.startSmartConnect();
		applyModalQr(st);
	} catch (e) {}

	function applyModalQr(st) {
		st = st || {};
		const state = (st.state || "").toUpperCase();
		if (state === "CONNECTED") {
			clearInterval(santu_wa_connect._qrModalTimer);
			d.hide();
			frappe.show_alert({ message: __("WhatsApp Connected!"), indicator: "green" });
			santu_wa_connect.render();
			return;
		}
		const $box = $wrap.find(".santu-psc-qr-box");
		if (st.qr) {
			$box.html(`<img src="${st.qr}" alt="WhatsApp QR" style="max-width:240px;height:auto;display:block;margin:0 auto;">`);
		} else if (state === "CONNECTING" || state === "RECONNECTING") {
			$box.html(`<div class="santu-psc-qr-wait">Linking phone… Please wait.</div>`);
		}
	}

	clearInterval(santu_wa_connect._qrModalTimer);
	santu_wa_connect._qrModalTimer = setInterval(async () => {
		try {
			const st = await santu_wa_connect.api.qrStatus();
			applyModalQr(st);
		} catch (e) {}
	}, 1000);

	d.onhide = () => {
		clearInterval(santu_wa_connect._qrModalTimer);
	};
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
	const is_connected = (status.state || "").toUpperCase() === "CONNECTED";
	const status_badge = is_connected
		? `<span class="santu-wa-state-badge connected">🟢 WhatsApp Connected${status.display_phone ? ` — +${frappe.utils.escape_html(status.display_phone)}` : ""}</span>`
		: `<span class="santu-wa-state-badge disconnected" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;cursor:pointer;" title="Click to Connect WhatsApp">🔴 Disconnected — <b style="text-decoration:underline;">Click to Connect</b></span>`;

	const reconnect_banner = !is_connected ? `
		<div class="santu-wa-reconnect-banner" style="background:#fffbeb;border-bottom:1px solid #fde68a;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;color:#92400e;font-size:13px;">
			<div style="display:flex;align-items:center;gap:8px;">
				<span style="font-size:16px;">⚠️</span>
				<span><b>WhatsApp Disconnected.</b> Scan QR code to send and receive real-time messages.</span>
			</div>
			<button class="btn btn-xs btn-primary wa-banner-connect-btn" style="background:#25d366;border:none;font-weight:600;padding:4px 14px;color:#fff;">⚡ Scan QR & Connect</button>
		</div>
	` : "";

	santu_wa_connect.$root.html(`
		<div class="santu-wa-connect-header">
			<h1>WhatsApp Connect</h1>
			${status_badge}
			<button class="btn btn-sm btn-default santu-wa-settings-btn" title="Settings">⚙</button>
		</div>
		${reconnect_banner}
		<div class="santu-wa-workspace">
			<div class="santu-wa-chat-list-panel">
				<div class="santu-wa-chat-list-header">
					<input class="form-control santu-wa-search" placeholder="Search contacts or phone...">
				</div>
				<div class="santu-wa-chat-list"></div>
			</div>
			<div class="santu-wa-chat-panel">
				<div class="santu-wa-chat-empty">
					<div class="santu-wa-empty-art">
						<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21.0007L4.65 17.2007C3.38766 15.4088 2.82267 13.2177 3.06104 11.0388C3.29942 8.85988 4.32479 6.84284 5.94471 5.36622C7.56463 3.8896 9.66775 3.05492 11.8594 3.0188C14.051 2.98269 16.1805 3.74763 17.8482 5.17007C19.5159 6.59252 20.6071 8.57468 20.9172 10.7446C21.2272 12.9145 20.7347 15.1229 19.5321 16.9555C18.3295 18.788 16.4994 20.1187 14.3854 20.6978C12.2713 21.2769 10.0186 21.0646 8.05 20.1007L3 21.0007"/><path d="M9 10C9 10.1326 9.05268 10.2598 9.14645 10.3536C9.24021 10.4473 9.36739 10.5 9.5 10.5C9.63261 10.5 9.75979 10.4473 9.85355 10.3536C9.94732 10.2598 10 10.1326 10 10V9C10 8.86739 9.94732 8.74021 9.85355 8.64645C9.75979 8.55268 9.63261 8.5 9.5 8.5C9.36739 8.5 9.24021 8.55268 9.14645 8.64645C9.05268 8.74021 9 8.86739 9 9V10ZM9 10C9 11.3261 9.52678 12.5979 10.4645 13.5355C11.4021 14.4732 12.6739 15 14 15H15C15.1326 15 15.2598 14.9473 15.3536 14.8536C15.4473 14.7608 15.5 14.6336 15.5 14.5C15.5 14.3684 15.4473 14.2412 15.3536 14.1474C15.2598 14.0537 15.1326 14.001 15 14.001H14C13.8674 14.001 13.7402 14.0537 13.6464 14.1474C13.5527 14.2412 13.5 14.3684 13.5 14.5C13.5 14.6326 13.5527 14.7598 13.6464 14.8536C13.7402 14.9473 13.8674 15 14 15"/></svg>
					</div>
					<h2>WhatsApp for Santu Hardware</h2>
					<p>Send and receive customer messages, invoices, payment receipts, and balance reminders seamlessly.</p>
					<div class="santu-wa-empty-footer">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
						End-to-end encrypted
					</div>
				</div>
			</div>
		</div>
		<div class="santu-wa-settings-drawer" style="display:none"></div>
	`);

	santu_wa_connect.$root.find(".santu-wa-settings-btn").on("click", () => santu_wa_connect.openSettingsDrawer());
	santu_wa_connect.$root.find(".wa-banner-connect-btn, .santu-wa-state-badge.disconnected").on("click", () => santu_wa_connect.openQrModal());
	santu_wa_connect.loadChatList();
	let debounce;
	santu_wa_connect.$root.find(".santu-wa-search").on("input", function () {
		clearTimeout(debounce);
		debounce = setTimeout(() => santu_wa_connect.loadChatList($(this).val()), 300);
	});
};

santu_wa_connect.getAvatarColor = function (name) {
	const colors = [
		"#2563eb", "#7c3aed", "#db2777", "#d97706",
		"#059669", "#0891b2", "#4f46e5", "#ea580c",
		"#0284c7", "#16a34a", "#9333ea", "#0d9488"
	];
	let hash = 0;
	const str = name || "?";
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash);
	}
	const idx = Math.abs(hash) % colors.length;
	return colors[idx];
};

santu_wa_connect.parseDate = function (ts) {
	if (!ts) return null;
	if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
	let s = String(ts).trim();
	if (s.includes(" ") && !s.includes("T")) {
		s = s.replace(" ", "T");
	}
	let d = new Date(s);
	if (!isNaN(d.getTime())) return d;
	if (window.frappe && frappe.datetime && frappe.datetime.str_to_obj) {
		try {
			const fd = frappe.datetime.str_to_obj(ts);
			if (fd && !isNaN(fd.getTime())) return fd;
		} catch (e) {}
	}
	return null;
};

santu_wa_connect.formatListTime = function (ts) {
	const d = santu_wa_connect.parseDate(ts);
	if (!d) return "";
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
	}
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) {
		return "Yesterday";
	}
	const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
	if (diffDays >= 0 && diffDays < 7) {
		return d.toLocaleDateString([], { weekday: "short" });
	}
	return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

santu_wa_connect.formatMsgTime = function (ts) {
	const d = santu_wa_connect.parseDate(ts);
	if (!d) return "";
	return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
};

santu_wa_connect.formatDateDivider = function (d) {
	if (!d) return "TODAY";
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return "TODAY";
	}
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) {
		return "YESTERDAY";
	}
	return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
};

santu_wa_connect.loadChatList = async function (search) {
	const $list = santu_wa_connect.$root.find(".santu-wa-chat-list");
	$list.html(`<div class="santu-wa-loading">Loading contacts…</div>`);
	const data = await santu_wa_connect.api.chats(search || "");
	$list.empty();
	if (!data.chats.length) {
		$list.html(`<div class="santu-wa-empty">No contacts found.</div>`);
		return;
	}
	data.chats.forEach((c) => {
		const time = santu_wa_connect.formatListTime(c.last_message_at);
		const party_tag = c.party_type ? `<span class="santu-wa-party-tag ${c.party_type.toLowerCase()}">${c.party_type}</span>` : "";
		const phone_display = c.phone_number ? `+${c.phone_number}` : "";
		const initial = (c.display_name || "?")[0].toUpperCase();
		const avatar_color = santu_wa_connect.getAvatarColor(c.display_name || c.phone_number);
		let preview_raw = c.last_message_preview ? c.last_message_preview.replace(/\*/g, "") : (c.outstanding ? `Balance: ₹${c.outstanding}` : "Tap to open chat");
		const preview = frappe.utils.escape_html(preview_raw);
		const $item = $(`
			<div class="santu-wa-chat-item" data-phone="${frappe.utils.escape_html(c.phone_number)}">
				<div class="santu-wa-avatar" style="background:${avatar_color};color:#ffffff;">${initial}</div>
				<div class="santu-wa-chat-meta">
					<div class="santu-wa-chat-top">
						<b>${frappe.utils.escape_html(c.display_name || c.phone_number)}</b>
						<span>${time}</span>
					</div>
					<div class="santu-wa-chat-sub">
						<span class="santu-wa-chat-phone">${phone_display}</span>
						${party_tag}
					</div>
					<div class="santu-wa-chat-preview">${preview}</div>
				</div>
				${c.unread_count ? `<span class="santu-wa-unread">${c.unread_count}</span>` : ""}
			</div>
		`);
		// The row was being built and then dropped on the floor -- created, never
		// appended -- so the panel stayed blank however many contacts came back
		// from get_chats. The click handler below reads the chat off the element,
		// so the object has to ride along on it too.
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
	const avatar_color = santu_wa_connect.getAvatarColor(chat.display_name || chat.phone_number);
	const initial = (chat.display_name || "?")[0].toUpperCase();
	const $panel = santu_wa_connect.$root.find(".santu-wa-chat-panel");
	$panel.html(`
		<div class="santu-wa-chat-header">
			<div class="santu-wa-avatar" style="background:${avatar_color};color:#ffffff;">${initial}</div>
			<div><b>${frappe.utils.escape_html(chat.display_name || chat.phone_number)}</b><br><small>+${frappe.utils.escape_html(chat.phone_number)}</small></div>
			<button class="btn btn-xs btn-default wa-link-party">${chat.party_name ? "Change Customer" : "Link to Customer"}</button>
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

	$panel.find(".wa-link-party").on("click", () => {
		frappe.prompt(
			{ fieldtype: "Link", options: "Customer", fieldname: "customer", label: "Customer", reqd: 1, default: chat.party_name || undefined },
			(v) => {
				santu_wa_connect.api.linkParty(chat.phone_number, "Customer", v.customer).then(() => {
					chat.party_type = "Customer"; chat.party_name = v.customer; chat.display_name = v.customer;
					santu_wa_connect.openChat(chat);
				});
			},
			chat.party_name ? "Change Customer" : "Link to Customer"
		);
	});

	santu_wa_connect.renderQuickActions(chat);
	santu_wa_connect.loadSuggestions(chat);
	santu_wa_connect.loadMessages(chat.phone_number);

	$panel.find(".wa-send-btn").on("click", () => santu_wa_connect.sendCurrentMessage());
	$panel.find(".wa-message-input").on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); santu_wa_connect.sendCurrentMessage(); } });
	$panel.find(".wa-attach-btn").on("click", () => santu_wa_connect.showAttachMenu(chat));
};

santu_wa_connect.previewDocument = function (url, title, download_url, ref_doctype, ref_name) {
	const d = new frappe.ui.Dialog({
		title: `<div style="display:flex;align-items:center;gap:8px;"><span style="background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;">PDF</span> <b>${frappe.utils.escape_html(title || "Document Preview")}</b></div>`,
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "preview_html",
			},
		],
	});
	d.$wrapper.find(".modal-dialog").css({ "max-width": "920px", "width": "92vw" });
	d.$wrapper.find(".modal-body").css({ "padding": "0", "background": "#525659" });
	
	const $wrap = d.fields_dict.preview_html.$wrapper;
	$wrap.html(`
		<div class="santu-wa-modal-preview-bar" style="background:#202124;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;color:#fff;">
			<span style="font-size:13px;color:#e8eaed;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%;">${frappe.utils.escape_html(title || "Document Preview")}</span>
			<div style="display:flex;align-items:center;gap:8px;">
				<button type="button" class="btn btn-xs btn-default wa-preview-print-btn" style="background:#3c4043;color:#fff;border:none;">🖨 Print</button>
				<button type="button" class="btn btn-xs btn-default wa-preview-tab-btn" style="background:#3c4043;color:#fff;border:none;">↗ Open in Tab</button>
				${download_url ? `<a class="btn btn-xs btn-primary wa-preview-dl-btn" href="${download_url}" target="_blank" download style="background:#25d366;border:none;color:#fff;text-decoration:none;">📥 Download</a>` : ""}
			</div>
		</div>
		<iframe id="santu_wa_doc_iframe" src="${url}" style="width:100%;height:75vh;border:none;background:#fff;display:block;"></iframe>
	`);

	$wrap.find(".wa-preview-print-btn").on("click", () => {
		if (!ref_doctype || !ref_name) {
			try {
				const u = new URL(url, window.location.origin);
				ref_doctype = u.searchParams.get("doctype") || ref_doctype;
				ref_name = u.searchParams.get("name") || ref_name;
			} catch(e) {}
		}

		if (ref_doctype && ref_name && typeof window.santu_print_thermal_bill === "function") {
			window.santu_print_thermal_bill(ref_doctype, ref_name);
		} else if (ref_doctype && ref_name && typeof santu_print_thermal_bill === "function") {
			santu_print_thermal_bill(ref_doctype, ref_name);
		} else {
			frappe.show_alert({message: "System could not find thermal print function. Falling back to A4.", indicator: "orange"});
			const iframe = document.getElementById("santu_wa_doc_iframe");
			if (iframe && iframe.contentWindow) {
				iframe.contentWindow.focus();
				iframe.contentWindow.print();
			}
		}
	});

	$wrap.find(".wa-preview-tab-btn").on("click", () => {
		window.open(url, "_blank");
	});

	d.show();
};

santu_wa_connect.loadMessages = async function (phone) {
	const $msgs = santu_wa_connect.$root.find(".santu-wa-messages");
	const data = await santu_wa_connect.api.messages(phone);
	$msgs.empty();
	if (!data.messages.length) {
		$msgs.html(`<div class="santu-wa-date-divider">TODAY</div><div class="santu-wa-empty-chat">No messages yet. Say hello!</div>`);
		return;
	}
	let lastDateKey = null;
	data.messages.forEach((m) => {
		const rawTs = m.timestamp || m.creation;
		const d = santu_wa_connect.parseDate(rawTs) || new Date();
		const dateKey = d.toDateString();

		if (dateKey !== lastDateKey) {
			const dividerText = santu_wa_connect.formatDateDivider(d);
			$msgs.append(`<div class="santu-wa-date-divider">${dividerText}</div>`);
			lastDateKey = dateKey;
		}

		const cls = m.direction === "Outgoing" ? "outgoing" : "incoming";
		const time = santu_wa_connect.formatMsgTime(rawTs);
		const ticks = m.direction === "Outgoing" ? santu_wa_connect.statusTicks(m.status) : "";

		let attachment_html = "";
		if (m.attachment) {
			const is_img = m.attachment.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
			const fname = m.attachment.split("/").pop() || "Document.pdf";
			if (is_img) {
				attachment_html = `<div class="santu-wa-img-preview"><a href="${m.attachment}" target="_blank"><img src="${m.attachment}" alt="Attachment"></a></div>`;
			} else {
				attachment_html = `
					<div class="santu-wa-pdf-card" data-url="${m.attachment}" data-title="${frappe.utils.escape_html(fname)}" data-download="${m.attachment}">
						<div class="santu-wa-pdf-card-icon">PDF</div>
						<div class="santu-wa-pdf-card-details">
							<div class="santu-wa-pdf-card-title">${frappe.utils.escape_html(fname)}</div>
							<div class="santu-wa-pdf-card-sub">PDF Document • Tap to view directly</div>
						</div>
						<a class="santu-wa-pdf-card-dl" href="${m.attachment}" target="_blank" download="${fname}" title="Download file">📥</a>
					</div>
				`;
			}
		} else if (m.reference_doctype && m.reference_name) {
			const doctype_label = m.reference_doctype === "Sales Invoice" ? "Bill" : m.reference_doctype;
			const preview_url = `/printview?doctype=${encodeURIComponent(m.reference_doctype)}&name=${encodeURIComponent(m.reference_name)}&no_letterhead=0`;
			const dl_url = `/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(m.reference_doctype)}&name=${encodeURIComponent(m.reference_name)}&no_letterhead=0`;
			const card_title = `${m.reference_name} (${doctype_label})`;
			attachment_html = `
				<div class="santu-wa-pdf-card" data-url="${preview_url}" data-title="${frappe.utils.escape_html(card_title)}" data-download="${dl_url}" data-doctype="${m.reference_doctype}" data-docname="${m.reference_name}">
					<div class="santu-wa-pdf-card-icon">PDF</div>
					<div class="santu-wa-pdf-card-details">
						<div class="santu-wa-pdf-card-title">${frappe.utils.escape_html(card_title)}</div>
						<div class="santu-wa-pdf-card-sub">PDF Document • Tap to view directly</div>
					</div>
					<a class="santu-wa-pdf-card-dl" href="${dl_url}" target="_blank" download="${m.reference_name}.pdf" title="Download file">📥</a>
				</div>
			`;
		}

		const body_html = m.message_body ? `<div class="santu-wa-bubble-body">${frappe.utils.escape_html(m.message_body)}</div>` : "";
		const $bubble = $(`
			<div class="santu-wa-bubble ${cls}">
				${attachment_html}
				${body_html}
				<div class="santu-wa-bubble-meta">
					<span class="santu-wa-msg-time">${time}</span>
					${ticks}
					${m.status === "Failed" ? ` <button class="btn btn-xs btn-danger wa-retry" data-chat="${m.name}">Retry</button>` : ""}
				</div>
			</div>
		`);
		$msgs.append($bubble);
	});

	$msgs.find(".santu-wa-pdf-card").on("click", function (e) {
		if ($(e.target).closest(".santu-wa-pdf-card-dl").length) return; // allow explicit download link
		const url = $(this).data("url");
		const title = $(this).data("title");
		const download_url = $(this).data("download");
		const ref_doctype = $(this).data("doctype");
		const ref_name = $(this).data("docname");
		if (url) {
			santu_wa_connect.previewDocument(url, title, download_url, ref_doctype, ref_name);
		}
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
	$qa.find(".smart").on("click", () => santu_wa_connect.smartMessaging(chat));
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

santu_wa_connect.smartMessaging = async function (chat) {
	const $btn = santu_wa_connect.$root.find(".santu-wa-chip.smart");
	$btn.prop("disabled", true).text("✨ Soch raha hoon…");
	try {
		const data = await santu_wa_connect.api.suggestions(chat.display_name);
		const suggestions = data.suggestions || [];
		if (!suggestions.length) { frappe.msgprint("Koi suggestion nahi mila."); return; }
		const d = new frappe.ui.Dialog({
			title: "✨ Smart Message",
			fields: [{ fieldtype: "HTML", fieldname: "sugg_html" }],
		});
		let html = `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">`;
		suggestions.forEach((s, i) => {
			html += `<button class="btn btn-default btn-sm santu-smart-pick" data-idx="${i}" style="text-align:left;white-space:normal">${frappe.utils.escape_html(s)}</button>`;
		});
		html += `</div>`;
		d.fields_dict.sugg_html.$wrapper.html(html);
		d.fields_dict.sugg_html.$wrapper.find(".santu-smart-pick").on("click", function () {
			santu_wa_connect.$root.find(".wa-message-input").val(suggestions[$(this).data("idx")]).focus();
			d.hide();
		});
		d.show();
	} catch (e) {
		frappe.show_alert({ message: "Suggestion load nahi hua", indicator: "red" });
	} finally {
		$btn.prop("disabled", false).text("✨ Smart Messaging ▾");
	}
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
				<button class="btn btn-default btn-block wa-sync-now" style="margin-top:8px">🔄 Sync Contacts Now</button>
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
	$drawer.find(".wa-sync-now").on("click", async function () {
		$(this).prop("disabled", true).text("Syncing…");
		try {
			const r = await santu_wa_connect.api.syncContacts();
			frappe.show_alert({ message: `Contacts synced: ${r.synced || 0} added/updated`, indicator: "green" });
		} catch (e) {
			frappe.show_alert({ message: "Sync failed: " + (e.message || e), indicator: "red" });
		} finally {
			$(this).prop("disabled", false).text("🔄 Sync Contacts Now");
		}
	});
	$drawer.find(".wa-refresh").on("click", async () => {
		frappe.dom.freeze(__("Refreshing WhatsApp…"));
		try {
			await santu_wa_connect.api.refresh();
			frappe.dom.unfreeze();
			frappe.show_alert({ message: __("Refreshed"), indicator: "green" });
			santu_wa_connect.render();
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.msgprint((e && e.message) || __("Could not refresh WhatsApp."));
		}
	});
	$drawer.find(".wa-disable").on("click", async () => {
		frappe.confirm(__("Disable WhatsApp Smart Connect? WhatsApp connection will be disconnected and stopped."), async () => {
			frappe.dom.freeze(__("Disabling WhatsApp Connect…"));
			try {
				await santu_wa_connect.api.disconnect();
				$drawer.hide();
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("WhatsApp Connect has been disabled"), indicator: "orange" });
				santu_wa_connect.render();
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint((e && e.message) || __("Could not disconnect WhatsApp."));
			}
		});
	});
	$drawer.find(".wa-logout").on("click", async () => {
		frappe.confirm(__("Logout from WhatsApp? You will need to scan QR code again to reconnect."), async () => {
			frappe.dom.freeze(__("Logging out from WhatsApp…"));
			try {
				await santu_wa_connect.api.disconnect();
				$drawer.hide();
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Logged out from WhatsApp"), indicator: "orange" });
				santu_wa_connect.render();
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint((e && e.message) || __("Could not logout from WhatsApp."));
			}
		});
	});
};
