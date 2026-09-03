/* global frappe, santu_sale_invoice, santu_purchase_invoice */
frappe.provide("santu_party_inline");

santu_party_inline.CUSTOMER = {
	partyType: "Customer",
	partyKey: "customer",
	detailsKey: "customer_details",
	nameField: "customer_name",
	label: "customer",
};

santu_party_inline.SUPPLIER = {
	partyType: "Supplier",
	partyKey: "supplier",
	detailsKey: "supplier_details",
	nameField: "supplier_name",
	label: "supplier",
};

santu_party_inline.fields_html = function (opts = {}) {
	const placeholder = opts.placeholder || __("Party Name *");
	return `
		<div class="santu-si2-customer-fields">
			<div class="santu-si2-customer-row1">
				<div class="santu-si2-customer-search-wrap">
					<input type="text" class="santu-si2-customer-search" placeholder="${frappe.utils.escape_html(placeholder)}" autocomplete="off">
					<div class="santu-si2-customer-dropdown" style="display:none;"></div>
				</div>
				<input type="text" class="santu-si2-phone" placeholder="${__("Phone No.")}">
			</div>
			<textarea class="santu-si2-address" placeholder="${__("Address")}" rows="2"></textarea>
			<a href="#" class="santu-si2-party-advanced">${__("GST & more details…")}</a>
		</div>`;
};

santu_party_inline.get_api = function (cfg) {
	if (cfg.partyType === "Customer") {
		return {
			search: (q) => santu_sale_invoice.api.search_customers(q),
			details: (name) => santu_sale_invoice.api.customer_details(name),
			create_full: (payload) => santu_sale_invoice.api.create_customer_full(payload),
			update_inline: (party, party_name, phone, address) =>
				santu_sale_invoice.api.update_customer_inline(party, party_name, phone, address),
			update_note: (party, note) => santu_sale_invoice.api.update_customer_note(party, note),
			open_dialog: (opts) => santu_sale_invoice.utils.open_add_party_dialog(opts),
			debounce: santu_sale_invoice.utils.debounce,
		};
	}
	return {
		search: (q) => santu_purchase_invoice.api.search_suppliers(q),
		details: (name) => santu_purchase_invoice.api.supplier_details(name),
		create_full: (payload) => santu_purchase_invoice.api.create_supplier_full(payload),
		update_inline: (party, party_name, phone, address) =>
			santu_purchase_invoice.api.update_supplier_inline(party, party_name, phone, address),
		update_note: (party, note) => santu_purchase_invoice.api.update_supplier_note(party, note),
		open_dialog: (opts) => santu_purchase_invoice.utils.open_add_party_dialog(opts),
		debounce: santu_purchase_invoice.utils.debounce,
	};
};

santu_party_inline.get_fields = function ($root) {
	const name = ($root.find(".santu-si2-customer-search").val() || "").trim();
	const phone = ($root.find(".santu-si2-phone").val() || "").trim();
	const address = ($root.find(".santu-si2-address").val() || "").trim();
	return { name, phone, address };
};

santu_party_inline.persist_fields_to_tab = function ($root, tab) {
	const { phone, address } = santu_party_inline.get_fields($root);
	tab.phone = phone;
	tab.address = address;
};

santu_party_inline.sync_fields = function ($root, tab, cfg) {
	const d = tab[cfg.detailsKey] || {};
	$root.find(".santu-si2-customer-search").val(d[cfg.nameField] || tab[cfg.partyKey] || "");
	$root.find(".santu-si2-phone").val(d.mobile_no || tab.phone || "");
	$root.find(".santu-si2-address").val(d.address_line1 || tab.address || "");
};

santu_party_inline.render_info = function (ctx) {
	const { $root, tab, cfg, saveDebounced, renderBody } = ctx;
	const $info = $root.find(".santu-si2-customer-info");
	santu_party_inline.sync_fields($root, tab, cfg);
	if (!tab[cfg.partyKey]) {
		$info.empty();
		return;
	}
	const d = tab[cfg.detailsKey] || {};
	const outstanding = d.outstanding_amount || 0;
	const stats =
		cfg.partyType === "Customer"
			? `<div class="santu-si2-cust-stats">
					<span class="${outstanding > 0 ? "santu-si2-warn-text" : ""}">Outstanding: ₹ ${santu_sale_invoice.utils.format_money(outstanding).replace("₹ ", "")}</span>
					${d.credit_limit ? `<span>Credit Limit: ₹ ${santu_sale_invoice.utils.format_money(d.credit_limit).replace("₹ ", "")}</span>` : ""}
				</div>`
			: `<div class="santu-si2-cust-stats">
					<span class="${outstanding > 0 ? "santu-si2-warn-text" : ""}">Payable: ₹ ${santu_purchase_invoice.utils.format_money(outstanding).replace("₹ ", "")}</span>
				</div>`;
	$info.html(`
		<div class="santu-si2-cust-card">
			<div class="santu-si2-cust-name">${frappe.utils.escape_html(d[cfg.nameField] || tab[cfg.partyKey])}
				<button type="button" class="santu-si2-cust-clear" title="Change ${cfg.label}">×</button>
			</div>
			${d.address ? `<div class="santu-si2-cust-sub">${frappe.utils.escape_html(d.address)}</div>` : ""}
			${stats}
		</div>
	`);
	$info.find(".santu-si2-cust-clear").on("click", () => {
		tab[cfg.partyKey] = null;
		tab[cfg.detailsKey] = null;
		tab.phone = "";
		tab.address = "";
		saveDebounced();
		renderBody();
	});
};

santu_party_inline.use_new_name = function (ctx, name) {
	const { $root, tab, cfg, saveDebounced } = ctx;
	tab[cfg.partyKey] = null;
	tab[cfg.detailsKey] = null;
	$root.find(".santu-si2-customer-search").val(name);
	$root.find(".santu-si2-customer-dropdown").hide().empty();
	saveDebounced();
	$root.find(".santu-si2-phone").focus();
};

santu_party_inline.select_party = function (ctx, name, opts = {}) {
	const { $root, tab, cfg, api, saveDebounced, renderInfo, renderBody, onSelected } = ctx;
	tab[cfg.partyKey] = name;
	$root.find(".santu-si2-customer-dropdown").hide().empty();
	return api.details(name).then((d) => {
		tab[cfg.detailsKey] = d;
		saveDebounced();
		if (opts.onSelected) opts.onSelected(d);
		else if (onSelected) onSelected(d);
		else if (renderInfo) renderInfo();
	});
};

// GST/address/shipping fields expand INLINE in the same panel now, not in a
// popup (2026-09-03 direct request: "add customer ke liye new window kyun
// khol rahe ho, same dialog me hi sab kuch ho jaye, niche kaafi space hai") —
// Name/Phone/Address were already inline fields right above this; only
// GSTIN/GST Type/State/Email/Shipping were dialog-only, so this panel adds
// just those, then saves through the same create_full API the old dialog
// used. Kept local to santu_party_inline (Billing/Estimate/Sales Return/
// Purchase Return) — Sales Order, Purchase Order, Delivery Challan and the
// Parties page each open their own separate "Add Party" dialog directly and
// are unaffected by this.
santu_party_inline.open_advanced_dialog = function (ctx, name) {
	const { $root, cfg } = ctx;
	if ($root.find(".santu-si2-adv-inline").length) return;
	$root.find(".santu-si2-customer-dropdown").hide().empty();
	if (name) $root.find(".santu-si2-customer-search").val(name);

	const states = cfg.partyType === "Customer" ? santu_sale_invoice.INDIAN_STATES : santu_purchase_invoice.INDIAN_STATES;
	const $panel = $(`
		<div class="santu-si2-adv-inline">
			<div class="santu-party-gst-address">
				<div class="santu-party-col santu-party-col-gst">
					<div class="frappe-control">
						<label class="control-label">${__("GSTIN")}</label>
						<input type="text" class="form-control santu-si2-adv-gstin">
					</div>
					<div class="frappe-control">
						<label class="control-label">${__("GST Type")}</label>
						<select class="form-control santu-si2-adv-gst-type">
							<option value="Unregistered">Unregistered</option>
							<option value="Registered Regular">Registered Regular</option>
							<option value="Registered Composition">Registered Composition</option>
							<option value="SEZ">SEZ</option>
							<option value="Overseas">Overseas</option>
							<option value="Deemed Export">Deemed Export</option>
							<option value="UIN Holders">UIN Holders</option>
							<option value="Consumer">Consumer</option>
						</select>
					</div>
					<div class="frappe-control">
						<label class="control-label">${__("State")}</label>
						<select class="form-control santu-si2-adv-state">
							${states.map((s) => `<option value="${frappe.utils.escape_html(s)}" ${s === "Bihar" ? "selected" : ""}>${frappe.utils.escape_html(s)}</option>`).join("")}
						</select>
					</div>
					<div class="frappe-control">
						<label class="control-label">${__("Email ID")}</label>
						<input type="text" class="form-control santu-si2-adv-email">
					</div>
				</div>
				<div class="santu-party-col santu-party-col-shipping">
					<label class="control-label">${__("Shipping Address")}</label>
					<a href="#" class="santu-party-enable-shipping">+ ${__("Enable Shipping Address")}</a>
					<div class="santu-party-shipping-block" style="display:none;">
						<textarea class="form-control santu-si2-adv-shipping" placeholder="${__("Shipping Address")}" rows="3"></textarea>
					</div>
				</div>
			</div>
			<div class="santu-si2-adv-actions">
				<button type="button" class="btn btn-xs btn-default santu-si2-adv-cancel">${__("Cancel")}</button>
				<button type="button" class="btn btn-xs btn-primary santu-si2-adv-save">${__("Save Party")}</button>
			</div>
		</div>
	`);
	$panel.insertAfter($root.find(".santu-si2-party-advanced"));

	let shipping_open = false;
	$panel.find(".santu-party-enable-shipping").on("click", (e) => {
		e.preventDefault();
		shipping_open = !shipping_open;
		$panel.find(".santu-party-shipping-block").toggle(shipping_open);
		$(e.currentTarget).text(shipping_open ? "− " + __("Disable Shipping Address") : "+ " + __("Enable Shipping Address"));
	});
	$panel.find(".santu-si2-adv-cancel").on("click", () => $panel.remove());
	$panel.find(".santu-si2-adv-save").on("click", () => {
		const { name: party_name, phone, address } = santu_party_inline.get_fields($root);
		if (!party_name) {
			frappe.msgprint(__("Party Name is required."));
			return;
		}
		if (Boolean(phone) !== Boolean(address)) {
			frappe.msgprint(__("Phone number aur address dono do, ya dono chhod do — sirf ek nahi."));
			return;
		}
		const payload = {
			customer_name: party_name,
			gstin: $panel.find(".santu-si2-adv-gstin").val(),
			phone,
			gst_category: $panel.find(".santu-si2-adv-gst-type").val(),
			state: $panel.find(".santu-si2-adv-state").val(),
			email: $panel.find(".santu-si2-adv-email").val(),
			address,
		};
		if (shipping_open) payload.shipping_address = $panel.find(".santu-si2-adv-shipping").val();

		const $btn = $panel.find(".santu-si2-adv-save").prop("disabled", true).text(__("Saving…"));
		ctx.api
			.create_full(payload)
			.then((created_name) => {
				frappe.show_alert({ message: __("Party added"), indicator: "green" });
				$panel.remove();
				santu_party_inline.select_party(ctx, created_name);
			})
			.catch(() => $btn.prop("disabled", false).text(__("Save Party")));
	});
};

santu_party_inline.run_search = function (ctx, q) {
	const { $root, cfg, api } = ctx;
	const $dd = $root.find(".santu-si2-customer-dropdown");
	if (!q || q.length < 2) {
		$dd.hide().empty();
		return;
	}
	api.search(q).then((rows) => {
		$dd.empty();
		const exact_match = rows.some(
			(r) => (r[cfg.nameField] || "").trim().toLowerCase() === q.trim().toLowerCase()
		);
		const noteField = cfg.partyType === "Customer" ? "customer_details" : "supplier_details";

		rows.forEach((r) => {
			const $row = $(`
				<div class="santu-si2-dd-row" data-party="${frappe.utils.escape_html(r.name)}">
					<div class="santu-si2-dd-row-main">
						<div class="santu-si2-dd-row-text">
							<b>${frappe.utils.escape_html(r[cfg.nameField])}</b>
							${r.mobile_no ? `<span>${frappe.utils.escape_html(r.mobile_no)}</span>` : ""}
						</div>
						<button type="button" class="santu-si2-dd-expand" title="More info">▸</button>
					</div>
					<div class="santu-si2-dd-row-info" style="display:none;">
						${
							cfg.partyType === "Customer"
								? `<div class="santu-si2-dd-row-village">${r.santu_village ? `📍 ${frappe.utils.escape_html(r.santu_village)}` : __("No address on file")}</div>`
								: ""
						}
						<textarea class="santu-si2-dd-row-note" placeholder="${__("Add a note to identify this {0}", [cfg.label])}">${frappe.utils.escape_html(r[noteField] || "")}</textarea>
						<button type="button" class="santu-si2-dd-row-note-save">${__("Save note")}</button>
					</div>
				</div>
			`).appendTo($dd);

			$row.find(".santu-si2-dd-row-main").on("click", () => santu_party_inline.select_party(ctx, r.name));
			$row.find(".santu-si2-dd-expand").on("click", (e) => {
				e.stopPropagation();
				$row.find(".santu-si2-dd-row-info").toggle();
			});
			$row.find(".santu-si2-dd-row-note, .santu-si2-dd-row-note-save").on("click", (e) => e.stopPropagation());
			$row.find(".santu-si2-dd-row-note-save").on("click", () => {
				const note = $row.find(".santu-si2-dd-row-note").val();
				api.update_note(r.name, note).then(() => {
					r[noteField] = note;
					frappe.show_alert({ message: __("Note saved"), indicator: "green" });
				});
			});
		});

		if (!exact_match) {
			const addLabel =
				cfg.partyType === "Customer"
					? __('+ Use "{0}" as new customer', [q])
					: __('+ Use "{0}" as new supplier', [q]);
			$(`<div class="santu-si2-dd-row santu-si2-dd-add" data-add="1">${frappe.utils.escape_html(addLabel)}</div>`)
				.on("click", () => santu_party_inline.use_new_name(ctx, q))
				.appendTo($dd);
			$(`<div class="santu-si2-dd-row santu-si2-dd-advanced">${__("+ Add with GST & address details")}</div>`)
				.on("click", () => santu_party_inline.open_advanced_dialog(ctx, q))
				.appendTo($dd);
		}

		$dd.show();
	});
};

santu_party_inline.bind_field_events = function (ctx) {
	const { $root, tab, saveDebounced } = ctx;
	$root.find(".santu-si2-phone").on("change input", (e) => {
		tab.phone = e.target.value;
		saveDebounced();
	});
	$root.find(".santu-si2-address").on("change input", (e) => {
		tab.address = e.target.value;
		saveDebounced();
	});
	$root.find(".santu-si2-party-advanced").on("click", (e) => {
		e.preventDefault();
		santu_party_inline.open_advanced_dialog(ctx, santu_party_inline.get_fields($root).name);
	});
};

santu_party_inline.bind_search_events = function (ctx) {
	const { $root, api, ddNamespace } = ctx;
	const $custSearch = $root.find(".santu-si2-customer-search");
	$custSearch.on("input", api.debounce((e) => santu_party_inline.run_search(ctx, e.target.value)));
	$custSearch.on("focus", (e) => {
		if (e.target.value) santu_party_inline.run_search(ctx, e.target.value);
	});
	$(document)
		.off(`click.${ddNamespace}`)
		.on(`click.${ddNamespace}`, (e) => {
			if (!$(e.target).closest(".santu-si2-customer-search-wrap, .santu-si2-item-search-wrap, .santu-si2-item-dropdown").length) {
				$root.find(".santu-si2-customer-dropdown, .santu-si2-item-dropdown").hide();
			}
		});
};

santu_party_inline.ensure_before_save = function (ctx) {
	const { $root, tab, cfg, api, saveDebounced } = ctx;
	const { name, phone, address } = santu_party_inline.get_fields($root);
	santu_party_inline.persist_fields_to_tab($root, tab);

	if (tab[cfg.partyKey]) {
		const d = tab[cfg.detailsKey] || {};
		const currentName = (d[cfg.nameField] || "").trim();
		const currentPhone = (d.mobile_no || "").trim();
		const currentAddress = (d.address_line1 || "").trim();
		// Case-only differences are not a rename. ERPNext title-cases the stored
		// party name, so a typed "ZZTraders" against a stored "Zztraders" used to
		// look like a rename and then collide with the very party being renamed
		// ("A supplier named … already exists").
		const nameChanged = name && name.toLowerCase() !== currentName.toLowerCase();
		const phoneChanged = phone !== currentPhone;
		const addressChanged = address !== currentAddress;

		if (nameChanged || phoneChanged || addressChanged) {
			return api
				.update_inline(
					tab[cfg.partyKey],
					nameChanged ? name : null,
					phoneChanged ? phone : null,
					addressChanged ? address : null
				)
				.then((r) => {
					if (r.party && r.party !== tab[cfg.partyKey]) tab[cfg.partyKey] = r.party;
					return api.details(tab[cfg.partyKey]).then((details) => {
						tab[cfg.detailsKey] = details;
						saveDebounced();
						return tab[cfg.partyKey];
					});
				});
		}
		return Promise.resolve(tab[cfg.partyKey]);
	}

	if (!name) {
		frappe.msgprint(__("Please enter a party name or select a {0}.", [cfg.label]));
		return Promise.reject();
	}

	const adopt = (party_name) => {
		tab[cfg.partyKey] = party_name;
		return api.details(party_name).then((d) => {
			tab[cfg.detailsKey] = d;
			saveDebounced();
			return party_name;
		});
	};

	// Typing the name of someone already on file — without picking them off
	// the dropdown — used to fail with "Duplicate Name" instead of just using
	// them. Match an existing party by name first; only create when there is
	// genuinely no such party yet.
	const lower = name.toLowerCase();
	return Promise.resolve(api.search(name)).then((matches) => {
		const exact = (matches || []).find(
			(m) =>
				(m.name || "").toLowerCase() === lower ||
				(m[cfg.nameField] || "").toLowerCase() === lower
		);
		if (exact) return adopt(exact.name);

		if (!phone && !address) {
			frappe.msgprint(__("Add a phone number or an address for {0} — one of the two is needed.", [name]));
			return Promise.reject();
		}

		const payload = { customer_name: name, phone: phone || null };
		if (address) {
			payload.address_line1 = address;
			payload.state = "Bihar";
			payload.country = "India";
		}

		return api.create_full(payload).then(adopt);
	});
};

santu_party_inline.has_party_or_name = function ($root, tab, cfg) {
	return tab[cfg.partyKey] || santu_party_inline.get_fields($root).name;
};

santu_party_inline.make_ctx = function (page, cfg, opts = {}) {
	const api = santu_party_inline.get_api(cfg);
	return {
		$root: page.$root,
		tab: page._active_tab(),
		cfg,
		api,
		saveDebounced: () => page._save_debounced(),
		renderBody: () => page._render_body(),
		renderInfo: () => page._render_customer_info(),
		ddNamespace: opts.ddNamespace || "santu-party-dd",
	};
};
