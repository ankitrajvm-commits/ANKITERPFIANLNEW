/* global frappe */
frappe.provide("santu_purchase_invoice");

// Mirrors santu_sale_invoice_api.js's INDIAN_STATES — kept
// as its own copy rather than a cross-file reference since this page's JS
// is lazy-loaded independently of the Sale Invoice screen's.
santu_purchase_invoice.INDIAN_STATES = [
	"Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
	"Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
	"Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
	"Kerala", "Ladakh", "Lakshadweep Islands", "Madhya Pradesh", "Maharashtra", "Manipur",
	"Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim",
	"Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];


santu_purchase_invoice.utils = {
	format_money(v) {
		return `₹ ${format_currency(v || 0, "INR").replace(/^\D+/, "")}`;
	},
	debounce(fn, ms = 250) {
		let t;
		return (...a) => {
			clearTimeout(t);
			t = setTimeout(() => fn(...a), ms);
		};
	},
	uid() {
		return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	},

	// The "Add Party" dialog for Purchase — same layout/classes as the Sale
	// Invoice / Estimate screens' shared dialog (santu-party-* CSS, defined
	// in santu_sale_invoice.css, loaded app-wide), pointed at
	// create_supplier_full instead of create_customer_full. Kept as its own
	// copy (not a cross-file call into santu_sale_invoice.utils) since that
	// file isn't guaranteed loaded on this page.
	//
	// `opts`: { name, phone, on_created(supplier_name) }
	open_add_party_dialog(opts) {
		const state = { detailed_open: false, shipping_open: false, village: null, active_tab: "gst_address" };

		const d = new frappe.ui.Dialog({
			title: __("Add Party"),
			size: "large",
			fields: [
				{ fieldtype: "Data", fieldname: "customer_name", label: "Party Name", reqd: 1, default: opts.name || "" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "gstin", label: "GSTIN" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "phone", label: "Phone Number", default: opts.phone || "" },
				{ fieldtype: "Section Break" },
				{ fieldtype: "HTML", fieldname: "party_tabs_html", options: "" },
			],
			primary_action_label: __("Save"),
			primary_action: () => this._save_party_dialog(d, state, opts, false),
			secondary_action_label: __("Save & New"),
			secondary_action: () => this._save_party_dialog(d, state, opts, true),
		});

		const $tabsWrap = d.fields_dict.party_tabs_html.$wrapper;
		$tabsWrap.html(`
			<div class="santu-party-tabbar">
				<button type="button" class="santu-party-tab-btn is-active" data-tab="gst_address">${__("GST & Address")}</button>
				<button type="button" class="santu-party-tab-btn" data-tab="credit_balance">${__("Credit & Balance")} <span class="santu-party-tab-new">${__("New")}</span></button>
				<button type="button" class="santu-party-tab-btn" data-tab="additional_fields">${__("Additional Fields")}</button>
			</div>
			<div class="santu-party-tab-panel" data-panel="gst_address"></div>
			<div class="santu-party-tab-panel" data-panel="credit_balance" style="display:none;">
				<div class="frappe-control santu-party-credit-limit-wrap">
					<label class="control-label">${__("Credit Limit")}</label>
					<input type="number" min="0" step="any" class="form-control santu-party-credit-limit">
					<span class="santu-party-field-hint">${__("Leave blank for no limit.")}</span>
				</div>
			</div>
			<div class="santu-party-tab-panel" data-panel="additional_fields" style="display:none;">
				<p class="text-muted">${__("No additional fields configured.")}</p>
			</div>
		`);

		$tabsWrap.find(".santu-party-tab-btn").on("click", (e) => {
			const tab = $(e.currentTarget).data("tab");
			state.active_tab = tab;
			$tabsWrap.find(".santu-party-tab-btn").removeClass("is-active");
			$(e.currentTarget).addClass("is-active");
			$tabsWrap.find(".santu-party-tab-panel").hide();
			$tabsWrap.find(`.santu-party-tab-panel[data-panel="${tab}"]`).show();
		});

		const $gstAddressPanel = $tabsWrap.find('.santu-party-tab-panel[data-panel="gst_address"]');
		$gstAddressPanel.html(`
			<div class="santu-party-gst-address">
				<div class="santu-party-col santu-party-col-gst">
					<div class="frappe-control">
						<label class="control-label">${__("GST Type")}</label>
						<select class="form-control santu-party-gst-type">
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
						<select class="form-control santu-party-state">
							${santu_purchase_invoice.INDIAN_STATES.map((s) => `<option value="${frappe.utils.escape_html(s)}" ${s === "Bihar" ? "selected" : ""}>${frappe.utils.escape_html(s)}</option>`).join("")}
						</select>
					</div>
					<div class="frappe-control">
						<label class="control-label">${__("Email ID")}</label>
						<input type="text" class="form-control santu-party-email">
					</div>
				</div>
				<div class="santu-party-col santu-party-col-billing">
					<label class="control-label">${__("Address")}</label>
					<textarea class="form-control santu-party-billing-simple" placeholder="${__("Address — kuch bhi likh sakte hain")}" rows="4"></textarea>
				</div>
				<div class="santu-party-col santu-party-col-shipping">
					<label class="control-label">${__("Shipping Address")}</label>
					<a href="#" class="santu-party-enable-shipping">+ ${__("Enable Shipping Address")}</a>
					<div class="santu-party-shipping-block" style="display:none;">
						<textarea class="form-control santu-party-shipping-simple" placeholder="${__("Shipping Address")}" rows="3"></textarea>
					</div>
				</div>
			</div>
		`);

		const $html = $gstAddressPanel;

		$html.find(".santu-party-enable-shipping").on("click", (e) => {
			e.preventDefault();
			state.shipping_open = !state.shipping_open;
			$html.find(".santu-party-shipping-block").toggle(state.shipping_open);
			$(e.currentTarget).text(state.shipping_open ? "− " + __("Disable Shipping Address") : "+ " + __("Enable Shipping Address"));
		});

		d.show();
		return d;
	},

	_save_party_dialog(d, state, opts, save_and_new) {
		const $tabsWrap = d.fields_dict.party_tabs_html.$wrapper;
		const $html = $tabsWrap.find('.santu-party-tab-panel[data-panel="gst_address"]');
		const supplier_name = d.get_value("customer_name");
		if (!(supplier_name || "").trim()) {
			frappe.msgprint(__("Party Name is required."));
			return;
		}

		const phone = (d.get_value("phone") || "").trim();
		const address = ($html.find(".santu-party-billing-simple").val() || "").trim();
		if (Boolean(phone) !== Boolean(address)) {
			frappe.msgprint(__("Phone number aur address dono do, ya dono chhod do — sirf ek nahi."));
			return;
		}

		const payload = {
			customer_name: supplier_name,
			gstin: d.get_value("gstin"),
			phone,
			gst_category: $html.find(".santu-party-gst-type").val(),
			state: $html.find(".santu-party-state").val(),
			email: $html.find(".santu-party-email").val(),
			address,
		};

		if (state.shipping_open) {
			payload.shipping_address = $html.find(".santu-party-shipping-simple").val();
		}

		santu_purchase_invoice.api.create_supplier_full(payload).then((supplier_name_created) => {
			frappe.show_alert({ message: __("Party added"), indicator: "green" });
			if (opts.on_created) opts.on_created(supplier_name_created);
			if (save_and_new) {
				d.hide();
				santu_purchase_invoice.utils.open_add_party_dialog({ on_created: opts.on_created });
			} else {
				d.hide();
			}
		});
	},
};

santu_purchase_invoice.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_invoice_init");
	},
	search_suppliers(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_suppliers_by_name", { query: q });
	},
	supplier_details(supplier) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_supplier_details_for_purchase", { supplier });
	},
	create_supplier_full(party) {
		return frappe.xcall("santu_hardware.santu_hardware.api.create_supplier_full", { party });
	},
	update_supplier_note(supplier, note) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_supplier_note", { supplier, note });
	},
	update_supplier_inline(party, party_name, phone, address) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_party_details", {
			party_type: "Supplier",
			party,
			party_name: party_name || undefined,
			phone: phone != null ? phone : undefined,
			address: address != null ? address : undefined,
		});
	},
	update_supplier_inline_gstin(party, gstin) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_party_details", {
			party_type: "Supplier",
			party,
			gstin,
		});
	},
	search_items(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_products", { query: q, limit: 15 });
	},
	recent_items() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_recent_purchase_items");
	},
	tax_options() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_tax_options");
	},
	add_uom_conversion(item_code, uom, conversion_factor) {
		return frappe.xcall("santu_hardware.santu_hardware.api.add_item_uom_conversion", {
			item_code,
			uom,
			conversion_factor,
		});
	},
	update_item_field(item_code, fieldname, value) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_item_field", { item_code, fieldname, value });
	},
	item_row(supplier, item_code, warehouse, qty, uom) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_item_row", {
			supplier,
			item_code,
			warehouse,
			qty,
			uom,
		});
	},
	// Third argument is an options bag, matching the sale screen's binding.
	// Purchase Order and Purchase Return call this with two arguments only,
	// so they are unaffected.
	quick_create_item(item_name, purchase_price, opts = {}) {
		return frappe.xcall("santu_hardware.santu_hardware.api.quick_create_item", {
			item_name,
			selling_price: purchase_price,
			item_group: opts.item_group,
			uom: opts.uom,
			barcode: opts.barcode,
			gst_hsn_code: opts.gst_hsn_code,
			buying: 1,
		});
	},
	item_cost_price(item_code, warehouse) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_item_cost_price", { item_code, warehouse });
	},
	save(invoice, submit) {
		// Not a plain xcall: `silent: true` stops frappe.call from popping its
		// own raw-English error dialog before our promise even rejects — the
		// page needs the real message text (from _server_messages, since a
		// frappe.throw()'s title/message never reaches xcall's r.message) so
		// it can recognise known cases (e.g. "Supplier without GSTIN") and
		// hand the operator something they can act on, in Hindi, instead of
		// india_compliance's own wording (2026-08-18 real bill: JANTA CEMENT).
		return new Promise((resolve, reject) => {
			frappe.call({
				method: "santu_hardware.santu_hardware.api.save_purchase_invoice",
				args: { invoice_json: JSON.stringify(invoice), submit: submit ? 1 : 0 },
				silent: true,
				callback: (r) => resolve(r.message),
				error: (r) => {
					let message = "";
					try {
						if (r && r._server_messages) {
							message = JSON.parse(r._server_messages)
								.map((m) => {
									try {
										return JSON.parse(m).message || m;
									} catch (e) {
										return m;
									}
								})
								.join(" ");
						}
					} catch (e) {
						/* fall through with an empty message */
					}
					reject({ message });
				},
			});
		});
	},
	whatsapp_preview(doctype, name) {
		return frappe.xcall("santu_hardware.santu_hardware.transaction_message_api.get_send_preview", {
			doctype,
			name,
		});
	},
	whatsapp_send(doctype, name, custom_message) {
		return frappe.xcall("santu_hardware.santu_hardware.transaction_message_api.send_whatsapp_message", {
			doctype,
			name,
			custom_message,
		});
	},
};
