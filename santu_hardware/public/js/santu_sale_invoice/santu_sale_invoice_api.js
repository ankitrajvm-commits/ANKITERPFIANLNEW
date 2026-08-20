/* global frappe */
frappe.provide("santu_sale_invoice");

// Shared with both the Sale Invoice and Estimate/Quotation "Add Party"
// dialogs (2026-08-14 direct request: default state Bihar, default
// district Saran, and let the cashier pick any other state/district too).
// Static, well-known reference data — unlike a village + pincode master,
// which needs a real dataset (India Post PIN code data or similar) we
// don't have access to in this environment, so City stayed free text
// rather than guessing village/pincode pairs.
santu_sale_invoice.INDIAN_STATES = [
	"Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
	"Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
	"Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
	"Kerala", "Ladakh", "Lakshadweep Islands", "Madhya Pradesh", "Maharashtra", "Manipur",
	"Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim",
	"Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

santu_sale_invoice.BIHAR_DISTRICTS = [
	// Saran leads the list — it's this shop's own district, so it's the
	// common case and shouldn't need scrolling past 30 alphabetical
	// districts to reach (2026-08-19 direct request).
	"Saran",
	"Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar",
	"Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar",
	"Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur",
	"Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Sheikhpura",
	"Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran",
];

santu_sale_invoice.utils = {
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

	// The one "Add Party" dialog, shared by the Sale Invoice and
	// Estimate/Quotation screens (2026-08-14 rebuild, pixel-matched to a
	// Vyapar reference: Party Name/GSTIN/Phone row, then GST & Address /
	// Credit & Balance / Additional Fields tabs). Built once here instead
	// of duplicated per-screen — the whole reason this needed a rebuild in
	// the first place was the two copies drifting apart.
	//
	// `opts`: { name, phone, on_created(customer_name) }
	//
	// The tab bar (GST & Address / Credit & Balance / Additional Fields) is
	// hand-built inside one HTML field rather than using frappe.ui.Dialog's
	// native "Tab Break" fieldtype — that feature throws
	// (`frappe.scrub` on an undefined label, inside Tab.make) as soon as
	// any field sits before the first Tab Break, which the reference
	// layout requires (Party Name/GSTIN/Phone sit above the tab bar, not
	// inside a tab). Rolling it by hand sidesteps that entirely and gives
	// pixel control over the layout anyway.
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
							${santu_sale_invoice.INDIAN_STATES.map((s) => `<option value="${frappe.utils.escape_html(s)}" ${s === "Bihar" ? "selected" : ""}>${frappe.utils.escape_html(s)}</option>`).join("")}
						</select>
					</div>
					<div class="frappe-control">
						<label class="control-label">${__("Email ID")}</label>
						<input type="text" class="form-control santu-party-email">
					</div>
				</div>
				<div class="santu-party-col santu-party-col-billing">
					<label class="control-label">${__("Billing Address")}</label>
					<textarea class="form-control santu-party-billing-simple" placeholder="${__("Billing Address")}" rows="3"></textarea>
					<a href="#" class="santu-party-show-detailed">${__("Show Detailed Address")}</a>
					<div class="santu-party-detailed" style="display:none;">
						<div class="frappe-control">
							<label class="control-label">${__("District")}</label>
							<select class="form-control santu-party-district">
								<option value="">${__("Auto (from pincode)")}</option>${santu_sale_invoice.BIHAR_DISTRICTS.map((dd) => `<option value="${frappe.utils.escape_html(dd)}">${frappe.utils.escape_html(dd)}</option>`).join("")}
							</select>
						</div>
						<div class="frappe-control">
							<label class="control-label">${__("Address Line 1")}</label>
							<input type="text" class="form-control santu-party-addr1">
						</div>
						<div class="frappe-control">
							<label class="control-label">${__("Address Line 2")}</label>
							<input type="text" class="form-control santu-party-addr2">
						</div>
						<div class="frappe-control santu-party-village-wrap">
							<label class="control-label">${__("City / Village")}</label>
							<input type="text" class="form-control santu-party-village" autocomplete="off">
							<div class="santu-party-village-dropdown" style="display:none;"></div>
						</div>
						<div class="frappe-control">
							<label class="control-label">${__("Pincode")}</label>
							<input type="text" class="form-control santu-party-pincode">
						</div>
						<div class="frappe-control">
							<label class="control-label">${__("Country")}</label>
							<input type="text" class="form-control santu-party-country" value="India">
						</div>
					</div>
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

		$html.find(".santu-party-show-detailed").on("click", (e) => {
			e.preventDefault();
			state.detailed_open = !state.detailed_open;
			$html.find(".santu-party-detailed").toggle(state.detailed_open);
			$(e.currentTarget).text(state.detailed_open ? __("Hide Detailed Address") : __("Show Detailed Address"));
		});

		$html.find(".santu-party-enable-shipping").on("click", (e) => {
			e.preventDefault();
			state.shipping_open = !state.shipping_open;
			$html.find(".santu-party-shipping-block").toggle(state.shipping_open);
			$(e.currentTarget).text(state.shipping_open ? "− " + __("Disable Shipping Address") : "+ " + __("Enable Shipping Address"));
		});

		// City/Village search — same real Bihar village + pincode data as
		// before, just a plain search dropdown here instead of Frappe's
		// Autocomplete control (whose strict re-validation of set_value()
		// fought every attempt to auto-fill the pincode alongside it).
		const $village = $html.find(".santu-party-village");
		const $villageDD = $html.find(".santu-party-village-dropdown");
		const $district = $html.find(".santu-party-district");
		const $pincode = $html.find(".santu-party-pincode");

		// Ticketed lookups: only the newest reply is allowed to paint, and
		// nothing fires on an empty box. The wide "everything" search that
		// ran on focus used to come back after the narrow typed one and
		// replace real matches with an unrelated list (2026-08-18).
		let village_seq = 0;
		const search_village = santu_sale_invoice.utils.debounce((q) => {
			if ((q || "").length < 2) {
				$villageDD.hide().empty();
				return;
			}
			const ticket = ++village_seq;
			santu_sale_invoice.api.search_bihar_villages($district.val(), q).then((rows) => {
				if (ticket !== village_seq) return;
				$villageDD.empty();
				if (!rows.length) {
					$villageDD.append(`<div class="santu-party-village-empty">${__("No matches")}</div>`);
				}
				rows.forEach((r) => {
					$(`<div class="santu-party-village-row">${frappe.utils.escape_html(r.village)} <span>${r.pincode}</span></div>`)
						.on("click", () => {
							state.village = r.village;
							$village.val(r.village);
							if (!$pincode.val()) $pincode.val(r.pincode);
							if (r.district) $district.val(r.district);
							$villageDD.hide();
						})
						.appendTo($villageDD);
				});
				$villageDD.show();
			});
		});
		$village.on("input", (e) => {
			state.village = null;
			search_village(e.target.value.trim());
		});
		$village.on("focus", (e) => search_village(e.target.value.trim()));
		$district.on("change", () => {
			$village.val("");
			state.village = null;
		});
		$(document)
			.off("click.santu-party-village")
			.on("click.santu-party-village", (e) => {
				if (!$(e.target).closest(".santu-party-village-wrap").length) $villageDD.hide();
			});

		d.show();
		return d;
	},

	_save_party_dialog(d, state, opts, save_and_new) {
		const $tabsWrap = d.fields_dict.party_tabs_html.$wrapper;
		const $html = $tabsWrap.find('.santu-party-tab-panel[data-panel="gst_address"]');
		const customer_name = d.get_value("customer_name");
		if (!(customer_name || "").trim()) {
			frappe.msgprint(__("Party Name is required."));
			return;
		}

		const payload = {
			customer_name,
			gstin: d.get_value("gstin"),
			phone: d.get_value("phone"),
			gst_category: $html.find(".santu-party-gst-type").val(),
			state: $html.find(".santu-party-state").val(),
			email: $html.find(".santu-party-email").val(),
			credit_limit: $tabsWrap.find(".santu-party-credit-limit").val(),
		};

		if (state.detailed_open) {
			payload.district = $html.find(".santu-party-district").val();
			payload.address_line1 = $html.find(".santu-party-addr1").val();
			payload.address_line2 = $html.find(".santu-party-addr2").val();
			payload.city = $html.find(".santu-party-village").val();
			payload.pincode = $html.find(".santu-party-pincode").val();
			payload.country = $html.find(".santu-party-country").val() || "India";
		} else {
			const simple = $html.find(".santu-party-billing-simple").val();
			if (simple && simple.trim()) {
				payload.address_line1 = simple.trim();
				// City/village is deliberately not sent here: this simple box
				// only collects a free-text address. Stuffing the district into
				// the City field is what wrote "Saran" onto every party. The
				// server fills City from the village, else the pincode's district.
				payload.country = "India";
			}
		}

		if (state.shipping_open) {
			payload.shipping_address = $html.find(".santu-party-shipping-simple").val();
		}

		santu_sale_invoice.api.create_customer_full(payload).then((customer_name_created) => {
			frappe.show_alert({ message: __("Party added"), indicator: "green" });
			if (opts.on_created) opts.on_created(customer_name_created);
			if (save_and_new) {
				d.hide();
				santu_sale_invoice.utils.open_add_party_dialog({ on_created: opts.on_created });
			} else {
				d.hide();
			}
		});
	},
};

santu_sale_invoice.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	search_customers(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_customers_by_name", { query: q });
	},
	search_customers_by_phone(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_customers_by_phone", { query: q });
	},
	district_for_pincode(pincode) {
		return frappe.xcall("santu_hardware.santu_hardware.api.district_for_pincode", { pincode });
	},
	customer_details(customer) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_customer_details_for_sale", { customer });
	},
	create_customer(customer_name, phone, village) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_or_create_customer_by_phone", {
			customer_name,
			phone,
			village,
		});
	},
	create_customer_full(party) {
		return frappe.xcall("santu_hardware.santu_hardware.api.create_customer_full", { party });
	},
	search_bihar_villages(district, search) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_bihar_villages", { district, search });
	},
	// District-free: each row carries its own pincode and district, so the
	// counter never picks a district and an out-of-district customer still
	// turns up.
	search_villages(search) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_villages", { search });
	},
	invoice_pdf_base64(doctype, name, print_format) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_pdf_base64", {
			doctype,
			name,
			print_format,
		});
	},
	// Print ladder (see print_service.py). The job row is written before
	// anything is sent, so a bill that never came out is visible instead of
	// silent — that is the whole point of these four calls.
	create_print_job(invoice_doctype, invoice_name, is_duplicate) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.create_print_job", {
			invoice_doctype,
			invoice_name,
			is_duplicate: is_duplicate ? 1 : 0,
		});
	},
	record_print_attempt(job_name, method, ok, error) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.record_print_attempt", {
			job_name,
			method,
			ok: ok ? 1 : 0,
			error: error || undefined,
		});
	},
	confirm_print_job(job_name, printed) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.confirm_print_job", {
			job_name,
			printed: printed ? 1 : 0,
		});
	},
	print_via_cups(invoice_doctype, invoice_name, is_duplicate) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.print_via_cups", {
			invoice_doctype,
			invoice_name,
			is_duplicate: is_duplicate ? 1 : 0,
		});
	},
	print_via_usb(invoice_doctype, invoice_name, is_duplicate) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.print_via_usb", {
			invoice_doctype,
			invoice_name,
			is_duplicate: is_duplicate ? 1 : 0,
		});
	},
	find_item_by_barcode(barcode) {
		return frappe.xcall("santu_hardware.santu_hardware.api.find_item_by_barcode", { barcode });
	},
	attach_barcode_to_item(item_code, barcode) {
		return frappe.xcall("santu_hardware.santu_hardware.api.attach_barcode_to_item", {
			item_code,
			barcode,
		});
	},
	set_item_stock(item_code, new_qty, reason) {
		return frappe.xcall("santu_hardware.santu_hardware.api.set_item_stock", {
			item_code,
			new_qty,
			reason,
		});
	},
	uom_options() {
		return frappe.xcall("santu_hardware.santu_hardware.api.sale_uom_options");
	},
	items_with_same_name(item_name) {
		return frappe.xcall("santu_hardware.santu_hardware.api.items_with_same_name", { item_name });
	},
	report_bug(what_happened, invoice_name) {
		return frappe.xcall("santu_hardware.santu_hardware.bug_report_service.report_bug_from_user", {
			what_happened,
			route: (frappe.get_route && frappe.get_route().join("/")) || "",
			reference_doctype: invoice_name ? "Sales Invoice" : undefined,
			reference_name: invoice_name || undefined,
		});
	},
	open_print_jobs(hours) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.open_print_jobs", {
			hours: hours || 24,
		});
	},
	retry_print_job(job_name) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.retry_print_job", { job_name });
	},
	update_customer_note(customer, note) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_customer_note", { customer, note });
	},
	update_customer_inline(party, party_name, phone, address, city, pincode) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_party_details", {
			party_type: "Customer",
			party,
			party_name: party_name || undefined,
			phone: phone != null ? phone : undefined,
			address: address != null ? address : undefined,
			city: city != null ? city : undefined,
			pincode: pincode != null ? pincode : undefined,
		});
	},
	search_items(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_products", { query: q, limit: 15 });
	},
	recent_items() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_recent_sale_items");
	},
	item_row(customer, item_code, warehouse, qty) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_item_row", {
			customer,
			item_code,
			warehouse,
			qty,
		});
	},
	// Third argument is an options bag, not a positional list — six other
	// screens call this with just (name, price), and an options object lets
	// the Sale screen ask for unit / opening stock / cost without any of
	// them having to change or accidentally passing a value in the wrong
	// slot.
	quick_create_item(item_name, selling_price, opts = {}) {
		return frappe.xcall("santu_hardware.santu_hardware.api.quick_create_item", {
			item_name,
			selling_price,
			item_group: opts.item_group,
			uom: opts.uom,
			barcode: opts.barcode,
			gst_hsn_code: opts.gst_hsn_code,
			opening_qty: opts.opening_qty || 0,
			cost_price: opts.cost_price || 0,
			// Only Estimate/Quotation passes 0 here — it quotes goods the shop
			// may not stock yet. Everywhere else the count stays mandatory.
			require_opening_qty: opts.require_opening_qty === 0 ? 0 : 1,
		});
	},
	item_cost_price(item_code, warehouse) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_item_cost_price", { item_code, warehouse });
	},
	save(invoice, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_sale_invoice", {
			invoice_json: JSON.stringify(invoice),
			submit: submit ? 1 : 0,
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
