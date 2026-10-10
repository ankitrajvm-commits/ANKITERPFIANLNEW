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

	// Keep the row that was just touched visible (2026-08-29 request: a new
	// item lands at the bottom of the list, and past ~10 items the operator
	// had to scroll down every single time to confirm it went in).
	// Shared by every billing-style screen rather than copied per screen —
	// and deliberately not tied to one scroll container: Billing/Estimate
	// scroll inside .santu-bill-gridscroll, while the Sale Invoices screen
	// scrolls the page itself. scrollIntoView({block:"nearest"}) walks
	// whatever chain of scrollable parents each screen actually has, and is
	// a no-op when the row is already on screen, so the list never twitches
	// while someone is just typing a quantity.
	scroll_row_into_view($root, opts = {}) {
		const $row = opts.row_id
			? $root.find(`tr[data-row="${opts.row_id}"]`).first()
			: $root.find("tbody tr.is-selected").first();
		if (!$row.length || !$row[0].isConnected) return;
		$row[0].scrollIntoView({ block: "nearest", inline: "nearest" });
	},

	// Let a search dropdown use the whole empty area under the search box
	// instead of a fixed few rows (2026-08-30: "isme bs 4 5 hi name aa raha
	// hai, aisa kr ki pure niche tak saman show ho").
	//
	// The height is measured, not hard-coded, because it depends on the
	// screen the operator is actually on -- a taller monitor should simply
	// show more items. It stops at the BOTTOM OF THE ITEM GRID, deliberately
	// short of the F-key bar: those keys are the counter's main controls and
	// a list covering them would be worse than a short list. Falls back to
	// the old fixed height if the grid is not on the page yet.
	size_dropdown($dd, $stop_at) {
		if (!$dd || !$dd.length || !$dd.is(":visible")) return;
		const top = $dd.offset().top;
		const stop = $stop_at && $stop_at.length
			? $stop_at.offset().top + $stop_at.outerHeight()
			: null;
		// 8px so the list never sits flush against the edge it stops at.
		const avail = stop ? stop - top - 8 : 0;
		// Below ~180px a "taller" list is worse than the old fixed one, so
		// keep a floor and let it scroll.
		$dd.css("max-height", avail > 180 ? Math.floor(avail) + "px" : "320px");
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
		const customer_name = d.get_value("customer_name");
		if (!(customer_name || "").trim()) {
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
			customer_name,
			gstin: d.get_value("gstin"),
			phone,
			gst_category: $html.find(".santu-party-gst-type").val(),
			state: $html.find(".santu-party-state").val(),
			email: $html.find(".santu-party-email").val(),
			credit_limit: $tabsWrap.find(".santu-party-credit-limit").val(),
			address,
		};

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
	// One call for both "I'm typing a name/phone" and "show me everyone so I
	// can scroll" -- an empty query lists all customers, most recent first.
	list_suppliers_for_picker(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.list_suppliers_for_picker", { query: q || "" });
	},
	list_customers_for_picker(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.list_customers_for_picker", { query: q || "" });
	},
	customer_details(customer) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_customer_details_for_sale", { customer });
	},
	create_customer(customer_name, phone, address) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_or_create_customer_by_phone", {
			customer_name,
			phone,
			address,
		});
	},
	create_customer_full(party) {
		return frappe.xcall("santu_hardware.santu_hardware.api.create_customer_full", { party });
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
	dismiss_print_jobs(job_names) {
		return frappe.xcall("santu_hardware.santu_hardware.print_service.dismiss_print_jobs", {
			job_names: JSON.stringify(job_names),
		});
	},
	update_customer_note(customer, note) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_customer_note", { customer, note });
	},
	update_customer_inline(party, party_name, phone, address) {
		return frappe.xcall("santu_hardware.santu_hardware.api.update_party_details", {
			party_type: "Customer",
			party,
			party_name: party_name || undefined,
			phone: phone != null ? phone : undefined,
			address: address != null ? address : undefined,
		});
	},
	// No small cap: "pipe" has to bring back every pipe, not the best 15
	// (2026-08-29 request). The dropdown scrolls, and the server already
	// ranks them — starting-with first, then word-start, then anywhere.
	search_items(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_products", { query: q, limit: 200 });
	},
	recent_items() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_recent_sale_items");
	},
	item_row(customer, item_code, warehouse, qty, uom) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_item_row", {
			customer: customer || "",
			item_code,
			warehouse,
			qty,
			uom: uom || null,
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
	// Reopening + correcting an already-submitted bill (2026-08-27 direct
	// request). See edit_submitted_sale_invoice's own docstring for how the
	// correction is actually made (cancel + amend, not an in-place edit —
	// ERPNext does not allow changing a submitted document any other way).
	get_invoice_for_edit(invoice_name) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_for_edit", { invoice_name });
	},
	edit_invoice(invoice_name, invoice) {
		return frappe.xcall("santu_hardware.santu_hardware.api.edit_submitted_sale_invoice", {
			invoice_name,
			invoice_json: JSON.stringify(invoice),
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
