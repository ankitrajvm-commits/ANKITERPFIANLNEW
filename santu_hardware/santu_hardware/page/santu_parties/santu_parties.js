// Parties screen — layout/copy from Vyapar landing-page bundle
// (parties-UIComponent_jsx_Parties_…-cfbc95 + constants_ts).
frappe.pages["santu-parties"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Parties",
		single_column: true,
	});
	$(page.wrapper).find(".page-head").hide();
	santu_parties_page.init(page);
};

frappe.pages["santu-parties"].on_page_show = function () {
	// A second route ("santu-parties/customers") reuses this exact same page
	// rather than a duplicate one (2026-08-18 direct request: the counter's
	// day-to-day flow only ever needs customers — "party name, party info ka
	// koi kaam nahi hai [suppliers ke liye]" — while the full Customer+
	// Supplier directory moves to More as "Parties2" for whenever it's
	// actually needed, not deleted). Locking is re-derived from the route on
	// every show, not just page load, since Frappe reuses one page instance
	// across route changes within the same session.
	santu_parties_page.locked_party_type = frappe.get_route()[1] === "customers" ? "Customer" : null;
	santu_parties_page.apply_route_filter();
};

const SANTU_PARTIES_PHONE_ICON = `<svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg" class="santu-parties-detail-icon"><path d="M2.85187 2.19564H5.22229L6.4075 5.1008L4.92599 5.97234C5.56064 7.23407 6.60215 8.25524 7.88902 8.8775L8.77792 7.42492L11.741 8.58698V10.9111C11.741 11.2193 11.6161 11.5149 11.3938 11.7328C11.1715 11.9507 10.8701 12.0732 10.5557 12.0732C8.24414 11.9354 6.06388 10.973 4.42632 9.36741C2.78876 7.76183 1.80713 5.62415 1.66666 3.3577C1.66666 3.0495 1.79153 2.75393 2.0138 2.536C2.23607 2.31807 2.53753 2.19564 2.85187 2.19564" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.77768 3.93871C9.09202 3.93871 9.39348 4.06115 9.61575 4.27908C9.83802 4.497 9.96289 4.79258 9.96289 5.10078" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.77768 1.61458C9.72069 1.61458 10.6251 1.98188 11.2919 2.63566C11.9587 3.28945 12.3333 4.17618 12.3333 5.10077" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SANTU_PARTIES_ADDRESS_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="santu-parties-detail-icon"><g clip-path="url(#santu-pa-clip)"><path d="M2.66667 5.88279V5.13279C2.2752 5.13279 1.94958 5.43387 1.91896 5.82413L2.66667 5.88279ZM2 14.3802L1.2523 14.3215C1.23594 14.53 1.30736 14.7358 1.44932 14.8894C1.59128 15.0429 1.79089 15.1302 2 15.1302V14.3802ZM14 14.3802V15.1302C14.2091 15.1302 14.4087 15.0429 14.5507 14.8894C14.6926 14.7358 14.7641 14.53 14.7477 14.3215L14 14.3802ZM13.3333 5.88279L14.081 5.82413C14.0504 5.43387 13.7248 5.13279 13.3333 5.13279V5.88279ZM5.33333 5.13279H2.66667V6.63279H5.33333V5.13279ZM1.91896 5.82413L1.2523 14.3215L2.7477 14.4389L3.41437 5.94145L1.91896 5.82413ZM2 15.1302H14V13.6302H2V15.1302ZM14.7477 14.3215L14.081 5.82413L12.5856 5.94145L13.2523 14.4389L14.7477 14.3215ZM13.3333 5.13279H5.33333V6.63279H13.3333V5.13279Z" fill="#62B1FF"/><path d="M8.20252 10.1112C8.11216 10.2662 7.88816 10.2662 7.7978 10.1112L5.35234 5.91518C4.1616 3.87208 5.63539 1.30731 8.00016 1.30731C10.3649 1.30731 11.8387 3.87208 10.648 5.91518L8.20252 10.1112Z" fill="white"/><path d="M7.7978 10.1112L8.44579 9.73351L7.7978 10.1112ZM8.44579 9.73351L6.00033 5.53753L4.70436 6.29283L7.14982 10.4888L8.44579 9.73351ZM10 5.53753L7.55454 9.73351L8.8505 10.4888L11.296 6.29283L10 5.53753ZM8.00016 2.05731C9.78622 2.05731 10.8993 3.99442 10 5.53753L11.296 6.29283C12.7781 3.74973 10.9436 0.557311 8.00016 0.557311L8.00016 2.05731ZM6.00033 5.53753C5.10099 3.99442 6.21411 2.05731 8.00016 2.05731L8.00016 0.557311C5.05668 0.557311 3.22222 3.74974 4.70436 6.29283L6.00033 5.53753ZM7.14982 10.4888C7.52953 11.1403 8.4708 11.1403 8.8505 10.4888L7.55454 9.73351C7.75352 9.39209 8.2468 9.39208 8.44579 9.73351L7.14982 10.4888Z" fill="#62B1FF"/></g><defs><clipPath id="santu-pa-clip"><rect width="16" height="15.6875" fill="white"/></clipPath></defs></svg>`;
const SANTU_PARTIES_GSTIN_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="santu-parties-detail-icon"><path d="M1.66675 2.33333C1.66675 1.78105 2.11446 1.33333 2.66675 1.33333H10.6667C11.219 1.33333 11.6667 1.78105 11.6667 2.33333V14.6667H2.66675C2.11446 14.6667 1.66675 14.219 1.66675 13.6667V2.33333Z" fill="white" stroke="#62B1FF" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.6667 8C11.6667 7.6318 11.9652 7.33333 12.3334 7.33333H13.6667C14.0349 7.33333 14.3334 7.6318 14.3334 8V13.6667C14.3334 14.219 13.8857 14.6667 13.3334 14.6667H11.6667V8Z" fill="white" stroke="#62B1FF" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.5 8H8.5" stroke="#62B1FF" stroke-width="0.75" stroke-linecap="round"/><path d="M3.5 10H7.5" stroke="#62B1FF" stroke-width="0.75" stroke-linecap="round"/><path d="M3.5 12H5.5" stroke="#62B1FF" stroke-width="0.75" stroke-linecap="round"/></svg>`;
const SANTU_PARTIES_MAIL_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="santu-parties-detail-icon"><path d="M13.1852 3.92188H2.81483C1.99663 3.92188 1.33334 4.42356 1.33334 5.04241V10.6451C1.33334 11.2639 1.99663 11.7656 2.81483 11.7656H13.1852C14.0034 11.7656 14.6667 11.2639 14.6667 10.6451V5.04241C14.6667 4.42356 14.0034 3.92188 13.1852 3.92188Z" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 4.57552L8.33333 7.84375L14 4.57552" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SANTU_PARTIES_RUPEE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="santu-parties-detail-icon"><path d="M12 3.26823H4.66666H6.66666C7.3739 3.26823 8.05218 3.54369 8.55227 4.03402C9.05237 4.52435 9.33332 5.18938 9.33332 5.88281C9.33332 6.57624 9.05237 7.24127 8.55227 7.7316C8.05218 8.22193 7.3739 8.4974 6.66666 8.4974H4.66666L8.66666 12.4193" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.66666 5.88281H12" stroke="#62B1FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SANTU_PARTIES_MORE_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="4.5" r="1.5" fill="#656672"/><circle cx="10" cy="10" r="1.5" fill="#656672"/><circle cx="10" cy="15.5" r="1.5" fill="#656672"/></svg>`;
const SANTU_PARTIES_WA_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 11.5A8.5 8.5 0 0 1 8.2 19.4L4 20.5l1.2-4A8.5 8.5 0 1 1 20 11.5Z" stroke="#08bd7c" stroke-width="1.5"/><path d="M9.2 9.1c.2-.5.3-.5.6-.5h.5c.2 0 .3.1.4.3l.6 1.4c.1.2 0 .4-.1.5l-.4.4c-.1.1-.1.3 0 .4.3.5.8 1 1.3 1.3.2.1.3.1.4 0l.4-.4c.2-.2.4-.2.5-.1l1.4.6c.2.1.3.2.3.4v.5c0 .3 0 .4-.5.6A6.2 6.2 0 0 1 9.2 9.1Z" fill="#08bd7c"/></svg>`;
const SANTU_PARTIES_SEARCH_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="#656672" stroke-width="1.5"/><path d="M13.5 13.5L17 17" stroke="#656672" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const SANTU_PARTIES_PRINT_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="5" y="2.5" width="10" height="4.5" rx="1" stroke="#656672" stroke-width="1.25"/><rect x="3.5" y="7" width="13" height="7" rx="1.5" stroke="#656672" stroke-width="1.25"/><rect x="6.5" y="12.5" width="7" height="5" rx="1" stroke="#656672" stroke-width="1.25"/></svg>`;
const SANTU_PARTIES_PLUS = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2.5v9M2.5 7h9" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const santu_parties_page = {
	filter: null,

	init(page) {
		this.page = page;
		this.first_load = true;

		const $root = $(`
			<div class="santu-parties-page">
				<div class="santu-parties-page-header">
					<!-- The title used to be a dropdown with a second "Groups"
					     view. That view queried nothing — it rendered a fixed
					     "No Party Group found / Add a party group from + Add
					     Party" panel, and the Add Party dialog has no group
					     field, so following its own instruction was
					     impossible. Removed rather than left as a dead end
					     (2026-08-15 audit). With one view left there is
					     nothing to drop down, so the chevron went too. -->
					<div class="santu-parties-page-title">
						<span class="santu-parties-title-text">Parties</span>
					</div>
					<div class="santu-parties-header-right">
						<button type="button" class="btn btn-primary santu-parties-add-btn"><span class="santu-parties-add-btn-icon">${SANTU_PARTIES_PLUS}</span> <span class="santu-parties-header-add-text">Add Party</span></button>
					</div>
				</div>
				<div class="santu-parties-landing" style="display:none;">
					<img src="/assets/santu_hardware/images/party_landing.svg" alt="" width="209" height="162">
					<div class="santu-parties-landing-text">
						<h2 class="santu-parties-landing-h2">Party Details</h2>
						<p>Add your customers and suppliers to manage your business easily.<br>Track payments and grow your business without any hassle!</p>
					</div>
					<button type="button" class="btn btn-primary santu-parties-add-btn santu-parties-first-add"><span class="santu-parties-add-btn-icon">${SANTU_PARTIES_PLUS}</span> <span class="santu-parties-landing-add-text">Add Your First Party</span></button>
				</div>
				<div class="santu-parties">
					<div class="santu-parties-list-panel">
						<div class="santu-parties-search-wrap">
							<input type="text" class="form-control santu-parties-search" placeholder="Search Party Name">
						</div>
						<!-- Customer AND mahajan live in one list now (2026-09-04
						     direct request: "party me sab aayega naa, jo mera
						     mahajan hai and jise mai baaki deta hu, and jo
						     customer hai?"). The 2026-08-18 customers-only lock
						     is gone; this picker is what narrows the list
						     instead, so nobody has to go hunting in More for the
						     other half of their parties. Hidden entirely while a
						     route still locks the view. -->
						<div class="santu-parties-typebar">
							<button type="button" class="santu-parties-type is-active" data-ptype="">Sab</button>
							<button type="button" class="santu-parties-type" data-ptype="Customer">Customer</button>
							<button type="button" class="santu-parties-type" data-ptype="Supplier">Mahajan</button>
						</div>
						<div class="santu-parties-list-head">
							<span>Party Name</span>
							<span>Amount</span>
						</div>
						<div class="santu-parties-list"></div>
					</div>
					<div class="santu-parties-detail-panel">
						<div class="santu-parties-empty">Select a party to see details.</div>
					</div>
				</div>
			</div>
		`).appendTo(page.body);

		this.$root = $root;
		this.$search = $root.find(".santu-parties-search");
		this.$list = $root.find(".santu-parties-list");
		this.$detail = $root.find(".santu-parties-detail-panel");
		this.$split = $root.find(".santu-parties");
		this.$landing = $root.find(".santu-parties-landing");
		this.$landingText = $root.find(".santu-parties-landing-text p");
		this.$titleText = $root.find(".santu-parties-title-text");
		this.$landingH2 = $root.find(".santu-parties-landing-h2");
		this.$headerAddText = $root.find(".santu-parties-header-add-text");
		this.$landingAddText = $root.find(".santu-parties-landing-add-text");

		let debounce;
		this.$search.on("input", () => {
			this.first_load = false;
			clearTimeout(debounce);
			debounce = setTimeout(() => this.reload_list(), 250);
		});

		this.$typebar = $root.find(".santu-parties-typebar");
		this.$typebar.on("click", ".santu-parties-type", (e) => {
			const $btn = $(e.currentTarget);
			const ptype = $btn.data("ptype") || null;
			this.$typebar.find(".santu-parties-type").removeClass("is-active");
			$btn.addClass("is-active");
			// Keep only_with_balance if something routed us here with it set
			// (Customer Dues links in that way) — this picker only ever
			// changes WHICH kind of party is listed.
			this.filter = { party_type: ptype, only_with_balance: (this.filter && this.filter.only_with_balance) || 0 };
			this.first_load = false;
			this.reload_list();
		});

		// Adding while the Mahajan tab is showing means adding a mahajan —
		// the dialog opens on that type instead of making the operator set
		// a dropdown that contradicts the list they are looking at. This is
		// what removed the need for a separate supplier entry under
		// Purchase & Expense (2026-09-04: "parties and purchase me 2 same
		// hai, use 1 kr de").
		$root.find(".santu-parties-add-btn").on("click", () =>
			this.open_add_party((this.filter && this.filter.party_type) || null)
		);
	},

	// Called once a party is actually created, by either dialog below —
	// refreshes the list and selects the new row, same behaviour either way.
	_on_party_created(name, display_name) {
		this.first_load = false;
		this.show_split();
		load_parties(this.$list, this.$search.val(), this.filter, (row, $row) => {
			this.$list.find(".santu-parties-row").removeClass("santu-parties-row-active");
			$row.addClass("santu-parties-row-active");
			load_party_detail(this.$detail, row);
		}, false).then(() => {
			const $target = this.$list.find(`.santu-parties-row[data-party="${frappe.utils.escape_html(name)}"]`);
			if ($target.length) $target.trigger("click");
		});
		if (display_name) frappe.show_alert({ message: __("Added {0}", [display_name]), indicator: "green" });
	},

	// `default_type` pre-selects the Party Type — passed as "Supplier" by
	// Purchase & Expense's "Mahajan (Suppliers)" quick-add, so adding a
	// mahajan does not start by changing a dropdown that says Customer
	// (2026-09-04). The field stays switchable; only its starting value
	// changes.
	open_add_party(default_type) {
		// Locked to Customer, not just defaulted — this dialog is reached
		// only from the counter's own "Parties" entry, which never shows a
		// supplier, so letting the type still be switched here would be a
		// back door into creating one it can't display or manage.
		const locked = this.locked_party_type === "Customer";

		if (locked) {
			// The same "Vyapar type" Add Party dialog the Sale/Estimate
			// screens already use (2026-08-18 direct request) — pixel-matched
			// tabs (GST & Address / Credit & Balance / Additional Fields)
			// instead of this page's own plainer one-off dialog. Loaded on
			// demand since it's normally only bundled with the Sale Invoice
			// page, not this one.
			frappe.require("/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js", () => {
				santu_sale_invoice.utils.open_add_party_dialog({
					on_created: (customer_name) => this._on_party_created(customer_name),
				});
			});
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Add Party"),
			fields: [
				{
					fieldtype: "Select",
					fieldname: "party_type",
					label: __("Party Type"),
					options: "Customer\nSupplier",
					default: default_type === "Supplier" ? "Supplier" : "Customer",
					reqd: 1,
				},
				{ fieldtype: "Data", fieldname: "customer_name", label: __("Party Name"), reqd: 1 },
				{ fieldtype: "Data", fieldname: "phone", label: __("Phone Number") },
				{ fieldtype: "Data", fieldname: "gstin", label: __("GSTIN") },
				{ fieldtype: "Data", fieldname: "email", label: __("Email") },
				{ fieldtype: "Small Text", fieldname: "address_line1", label: __("Billing Address") },
				{ fieldtype: "Select", fieldname: "state", label: __("State"), options: "Bihar", default: "Bihar" },
				{
					// Only customers can owe money, so this hides itself for a
					// supplier. Without it a customer added from this screen had
					// to be created and then edited again just to set a limit --
					// the Sale/Estimate add-party dialog has always offered it.
					fieldtype: "Currency",
					fieldname: "credit_limit",
					label: __("Udhaar Limit (Credit Limit)"),
					description: __("Khali ya 0 = koi limit nahi."),
					depends_on: "eval:doc.party_type != 'Supplier'",
				},
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				v.customer_name = (v.customer_name || "").toUpperCase().trim();
				if (v.party_type === "Supplier") delete v.credit_limit;
				const method =
					v.party_type === "Supplier"
						? "santu_hardware.santu_hardware.api.create_supplier_full"
						: "santu_hardware.santu_hardware.api.create_customer_full";
				frappe.dom.freeze(__("Saving…"));
				frappe
					.xcall(method, { party: v })
					.then((name) => {
						frappe.dom.unfreeze();
						d.hide();
						this._on_party_created(name, v.customer_name);
					})
					.catch(() => frappe.dom.unfreeze());
			},
		});
		d.$wrapper.addClass("santu-parties-add-dialog");
		d.show();
		const $name = d.fields_dict.customer_name.$input;
		$name.on("input", function () {
			const start = this.selectionStart;
			const end = this.selectionEnd;
			this.value = this.value.toUpperCase();
			this.setSelectionRange(start, end);
		});
	},

	show_split() {
		this.$landing.hide();
		this.$split.show();
	},

	show_landing() {
		this.$split.hide();
		this.$landing.show();
	},

	// Search placeholder + empty-state copy say "customers" instead of the
	// generic "parties" when locked — a hardware-shop operator using the
	// counter's own "Parties" entry should never read a sentence that
	// mentions suppliers on a screen that will never show them one.
	update_locked_copy() {
		const locked = this.locked_party_type === "Customer";
		this.$search.attr("placeholder", locked ? "Search Customer Name" : "Search Party Name");
		this.$titleText.text(locked ? "Customers" : "Parties");
		this.$landingH2.text(locked ? "Customer Details" : "Party Details");
		this.$headerAddText.text(locked ? "Add Customer" : "Add Party");
		this.$landingAddText.text(locked ? "Add Your First Customer" : "Add Your First Party");
		if (this.$landingText.length) {
			this.$landingText.html(
				locked
					? "Add your customers to manage your business easily.<br>Track payments without any hassle!"
					: "Add your customers and suppliers to manage your business easily.<br>Track payments and grow your business without any hassle!"
			);
		}
		// The Sab/Customer/Mahajan picker only makes sense when the view is
		// free to show both — a locked route has no "show everyone" option
		// by definition, so the control is hidden rather than shown doing
		// nothing.
		if (this.$typebar) this.$typebar.toggle(!locked);
	},

	// Keeps the picker showing whichever type is actually being listed, so
	// arriving here from a link that pre-filters (Customer Dues, a supplier
	// drill-down) does not leave "Sab" highlighted over a filtered list.
	sync_typebar() {
		if (!this.$typebar) return;
		const current = (this.filter && this.filter.party_type) || "";
		this.$typebar.find(".santu-parties-type").each((_, el) => {
			$(el).toggleClass("is-active", ($(el).data("ptype") || "") === current);
		});
	},

	apply_route_filter() {
		const opts = frappe.route_options || {};
		if (this.locked_party_type) {
			// A lock always wins over whatever a caller tried to hand in via
			// route_options — this view has no "show everyone" escape hatch.
			this.filter = { party_type: this.locked_party_type, only_with_balance: 0 };
		} else if (opts.party_type || opts.only_with_balance) {
			this.filter = {
				party_type: opts.party_type || null,
				only_with_balance: opts.only_with_balance ? 1 : 0,
			};
		} else {
			this.filter = null;
		}
		this.update_locked_copy();
		this.sync_typebar();
		// A specific party can also be handed in — used where something used
		// to jump to the native Customer/Supplier form.
		const focus = opts.party || null;
		frappe.route_options = null;

		if (!this.$list) return;
		this.first_load = true;
		this.$search.val(focus || "");
		this.reload_list(focus);
	},

	// `select_party` re-opens a specific party once the list has redrawn —
	// used after an edit so the panel follows the party across a rename
	// instead of being left on a name that no longer exists. If not provided,
	// selects the first party in the list.
	async reload_list(select_party) {
		this.show_split();
		await load_parties(
			this.$list,
			this.$search.val(),
			this.filter,
			(row, $row) => {
				this.$list.find(".santu-parties-row").removeClass("santu-parties-row-active");
				$row.addClass("santu-parties-row-active");
				load_party_detail(this.$detail, row);
			},
			!select_party,
			(meta) => {
				if (meta.empty_all && !this.filter) this.show_landing();
			}
		);
		this.first_load = false;
		if (select_party) {
			const $row = this.$list.find(`.santu-parties-row[data-party="${CSS.escape(select_party)}"]`);
			if ($row.length) {
				$row.trigger("click");
			} else {
				const $first = this.$list.find(".santu-parties-row").first();
				if ($first.length) $first.trigger("click");
			}
		}
	},
};

async function load_parties($list, search, filter, on_select, auto_select_first, on_meta) {
	$list.html(`<div class="santu-dash-loading">Loading...</div>`);
	const rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_parties_list", {
		search: search || null,
		party_type: (filter && filter.party_type) || null,
		only_with_balance: (filter && filter.only_with_balance) || 0,
	});

	$list.empty();
	if (!rows.length) {
		if (search) {
			$list.append(
				`<div class="santu-parties-list-empty"><b>No Party found</b><span>We could not find party with this name.<br>Please try again.</span></div>`
			);
		} else {
			$list.append(`<div class="santu-parties-list-empty"><b>No parties to show</b></div>`);
		}
		santu_parties_page.$detail.html(`<div class="santu-parties-empty">Select a party to see details.</div>`);
		if (on_meta) on_meta({ empty_all: !search });
		return rows;
	}

	if (on_meta) on_meta({ empty_all: false });

	rows.forEach((row, idx) => {
		// Same sign-aware direction the detail panel uses — see
		// _balance_direction(). Printing the raw figure here showed a return
		// credit as a bare "-600" in green, which reads as a bigger debt
		// rather than the opposite of one.
		const dir = _balance_direction(row);
		// Money still to be COLLECTED is the one that needs the operator's eye,
		// so it gets the loud colour. It used to be green (money-in = good),
		// which made a pending udhaar look like a settled account at a glance
		// (2026-08-29 direct request: "owes wala red hona tha na"). The shop's
		// own dues stay a distinct amber rather than sharing the red, so the
		// two directions can never be mistaken for each other.
		const tone = dir.settled ? "" : dir.owes_you ? "danger" : "warning";
		// Phone and village under the name. Four Aman Singhs are one name in
		// a list and four different people at the counter; the list has to
		// say which is which without opening each one (2026-09-06 request).
		// Phone first — it is what a shopkeeper actually recognises someone
		// by — then the village, joined by a thin separator so a missing one
		// never leaves a dangling dot.
		const meta = [row.mobile_no, row.address].filter(Boolean);
		const meta_html = meta.length
			? `<div class="santu-parties-row-meta">${meta
					.map((m) => `<span>${frappe.utils.escape_html(m)}</span>`)
					.join('<i class="santu-parties-row-dot"></i>')}</div>`
			: "";
		const $row = $(`
			<div class="santu-parties-row ${meta_html ? "has-meta" : ""}" role="button" tabindex="0" data-party="${frappe.utils.escape_html(row.party)}">
				<div class="santu-parties-row-main">
					<div class="santu-parties-row-name">${frappe.utils.escape_html(row.party_name)}</div>
					${meta_html}
				</div>
				<span class="santu-parties-row-amount santu-figures ${tone ? "santu-tone-" + tone : ""}">${format_currency_plain(dir.amount)}</span>
			</div>
		`)
			.on("click", () => on_select(row, $row))
			.appendTo($list);
		if (auto_select_first && idx === 0) $row.trigger("click");
	});
	return rows;
}

// The list column shows a bare number whose direction is carried only by
// colour (green = they owe you, red = you owe them) — that matches real
// Vyapar, but colour alone is a convention someone has to be taught. The
// detail panel has room to just say it, so it does. Same wording as the
// Party Transfer screen, deliberately.
// Which way the money actually points. The direction comes from the SIGN of
// the balance, not from the party type alone: a customer holding a return
// credit has a NEGATIVE balance, which means the SHOP owes THEM. Reading the
// type only told the counter the exact opposite of the truth in that case
// (2026-08-19 bug report: goods returned and left as khata credit still read
// "Manish owes you 600" when the shop owed Manish 600).
//
// The sign convention is mirrored per type — a customer's positive balance is
// money coming in, a supplier's positive balance is money going out — so the
// same negative case flips a supplier the other way too.
function _balance_direction(row) {
	const raw = Number(row.amount) || 0;
	return {
		amount: Math.abs(raw),
		owes_you: row.party_type === "Customer" ? raw > 0 : raw < 0,
		settled: !raw,
	};
}

// Payment In / Payment Out — the same shared collect-payment screen every
// other entry point in the app already opens (Customer Dues, Sale/Purchase
// pages, the topbar mega-menu), just reachable from a party's own Parties
// panel too (2026-09-06 direct request: "parties ke harek customer me
// payment in payment out daal do"). Direction is fixed by party_type, not
// by who currently owes whom — a Customer is always Payment In (Receive), a
// Supplier always Payment Out (Pay), exactly what create_payment_entry
// itself enforces server-side, same as the sidebar's own Payment-In/
// Payment-Out entries. Shown for EVERY party, settled or not: a shop
// collecting an advance from a customer who owes nothing yet is a normal
// counter moment, not an edge case to hide the button for.
function _payment_btn(row) {
	const is_supplier = row.party_type === "Supplier";
	const label = is_supplier ? __("Payment Out") : __("Payment In");
	return `
		<button type="button" class="santu-parties-payment-btn" title="${label}">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
			${label}
		</button>
	`;
}

function _balance_line(row) {
	const { amount, owes_you, settled } = _balance_direction(row);
	if (settled) {
		return `
			<div class="santu-parties-balance santu-parties-balance-clear">
				<span>All settled — nothing pending</span>
				${_payment_btn(row)}
			</div>
		`;
	}
	const reminder_btn = owes_you ? `
		<button type="button" class="santu-parties-send-reminder-btn" title="${__("Send WhatsApp Reminder")}">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M3 21.0007L4.65 17.2007C3.38766 15.4088 2.82267 13.2177 3.06104 11.0388C3.29942 8.85988 4.32479 6.84284 5.94471 5.36622C7.56463 3.8896 9.66775 3.05492 11.8594 3.0188C14.051 2.98269 16.1805 3.74763 17.8482 5.17007C19.5159 6.59252 20.6071 8.57468 20.9172 10.7446C21.2272 12.9145 20.7347 15.1229 19.5321 16.9555C18.3295 18.788 16.4994 20.1187 14.3854 20.6978C12.2713 21.2769 10.0186 21.0646 8.05 20.1007L3 21.0007"/><path d="M9 10C9 10.1326 9.05268 10.2598 9.14645 10.3536C9.24021 10.4473 9.36739 10.5 9.5 10.5C9.63261 10.5 9.75979 10.4473 9.85355 10.3536C9.94732 10.2598 10 10.1326 10 10V9C10 8.86739 9.94732 8.74021 9.85355 8.64645C9.75979 8.55268 9.63261 8.5 9.5 8.5C9.36739 8.5 9.24021 8.55268 9.14645 8.64645C9.05268 8.74021 9 8.86739 9 9V10ZM9 10C9 11.3261 9.52678 12.5979 10.4645 13.5355C11.4021 14.4732 12.6739 15 14 15H15C15.1326 15 15.2598 14.9473 15.3536 14.8536C15.4473 14.7598 15.5 14.6326 15.5 14.5C15.5 14.3674 15.4473 14.2402 15.3536 14.1464C15.2598 14.0527 15.1326 14 15 14H14C13.8674 14 13.7402 14.0527 13.6464 14.1464C13.5527 14.2402 13.5 14.3674 13.5 14.5C13.5 14.6326 13.5527 14.7598 13.6464 14.8536C13.7402 14.9473 13.8674 15 14 15"/></svg>
			${__("Send Reminder")}
		</button>
	` : "";
	return `
		<div class="santu-parties-balance ${owes_you ? "santu-parties-balance-in" : "santu-parties-balance-out"}">
			<div class="santu-parties-balance-main">
				<span class="santu-parties-balance-label">${owes_you ? "Owes you" : "You owe"}</span>
				<span class="santu-parties-balance-amount santu-figures">₹ ${format_currency_plain(amount)}</span>
			</div>
			<div class="santu-parties-balance-actions">
				${reminder_btn}
				${_payment_btn(row)}
			</div>
		</div>
	`;
}

function info_col(icon, label, value) {
	const text = value || "—";
	return `<div class="santu-parties-detail-info-col">
		<div class="santu-parties-detail-info-label">${icon} ${label}</div>
		<div class="santu-parties-detail-info-value">${frappe.utils.escape_html(text)}</div>
	</div>`;
}

// Customer-wise running khata dialog (2026-08-27 direct request: "har
// customer ka ek complete running account/khata maintain karna hai...
// generate/download/print the complete Customer Account Statement / Ledger
// for a selected date range"). Reads get_customer_khata — Sales Invoice +
// un-consolidated POS Invoice for sales, Payment Entry (Receive) for money
// collected, real ERPNext documents, not a parallel ledger of its own —
// and shows them as one running account with a balance after each row,
// the same shape a paper khata page already has. Date range defaults to
// the last 12 months, same window the WhatsApp statement has always used.
async function open_party_khata_dialog(row) {
	const is_supplier = row.party_type === "Supplier";
	// The khata starts on this party's FIRST bill or payment. It used to
	// default to twelve months back, so a customer whose first sale was last
	// week got a statement starting last September with nothing in it
	// (2026-09-06: "jab se saman jaye 1st sale tab se khata bill hoga naa").
	//
	// Fetched BEFORE the dialog is built rather than filled in afterwards:
	// setting a Date field's value on an open dialog pops its calendar open
	// over the statement, and Print / WhatsApp / Download read this range
	// too, so it has to be right from the first paint.
	const first = await frappe
		.xcall("santu_hardware.santu_hardware.api.party_first_transaction_date", {
			party_type: row.party_type,
			party: row.party,
		})
		.catch(() => null);
	const state = {
		from_date: first || frappe.datetime.get_today(),
		to_date: frappe.datetime.get_today(),
		// Off by default — the full item-by-item breakdown is what a
		// statement has always printed. Compact is something to switch ON
		// for a party with a lot of history, not the new normal (2026-09-06
		// direct request: "isme ek compact version v bana do").
		compact: 0,
	};

	const d = new frappe.ui.Dialog({
		title: __("Account Statement — {0}", [row.party_name]),
		size: "extra-large",
		fields: [
			{ fieldtype: "Date", fieldname: "from_date", label: __("From (pehli sale se)"), default: state.from_date },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Date", fieldname: "to_date", label: __("To"), default: state.to_date },
			{ fieldtype: "Column Break" },
			// Only the PRINT (thermal roll) reads this — the on-screen table
			// above and the A4 Download PDF have room enough that a compact
			// mode buys them nothing, so it never touches those paths.
			{
				fieldtype: "Check",
				fieldname: "compact_print",
				label: __("Compact print (no item list, less paper)"),
				default: 0,
			},
			{ fieldtype: "Section Break" },
			{ fieldtype: "HTML", fieldname: "khata_html", options: `<div class="santu-khata-loading">${__("Loading…")}</div>` },
		],
		// Download/Print/WhatsApp export only exists for the Customer khata so
		// far (2026-09-03: the Supplier side is new — "tracking" was the ask,
		// not yet a statement to hand someone). The on-screen ledger below is
		// identical for both.
		// Both sides get the PDF now (2026-09-04). A mahajan's statement is
		// every bit as much "a statement to hand someone" as a customer's —
		// it is how the shop settles up with them — and the endpoint behind
		// it renders from the same template.
		primary_action_label: __("Download PDF"),
		primary_action: () => {
			const method = is_supplier
				? "santu_hardware.santu_hardware.api.download_supplier_khata"
				: "santu_hardware.santu_hardware.api.download_customer_khata";
			const key = is_supplier ? "supplier" : "customer";
			window.open(
				frappe.urllib.get_full_url(
					`/api/method/${method}?${key}=${encodeURIComponent(row.party)}&from_date=${encodeURIComponent(state.from_date)}&to_date=${encodeURIComponent(state.to_date)}`
				),
				"_blank"
			);
		},
	});

	// The endpoints take `customer` or `supplier` — same three values either
	// way, so the key is decided once here rather than at four call sites.
	const khata_args = () => ({
		[is_supplier ? "supplier" : "customer"]: row.party,
		from_date: state.from_date,
		to_date: state.to_date,
	});

	const render_khata = () => {
		const $wrap = d.fields_dict.khata_html.$wrapper;
		$wrap.html(`<div class="santu-khata-loading">${__("Loading…")}</div>`);
		// Which bill is due on which date, alongside the running khata
		// (2026-09-04 direct request: "ye daal de kis date tak kitna payment
		// dena hai supplier ko"). The khata's Credit column already answers
		// "kab kitna de diya gya"; this is the other half — what is still to
		// come and by when. Fetched for suppliers AND customers: the schedule
		// existed only inside the customer's printed PDF before, never on
		// screen for either side.
		const schedule_promise = frappe
			.xcall("santu_hardware.santu_hardware.api.get_party_payment_schedule", {
				party_type: is_supplier ? "Supplier" : "Customer",
				party: row.party,
			})
			.catch(() => null);
		frappe
			.xcall(
				is_supplier
					? "santu_hardware.santu_hardware.api.get_supplier_khata"
					: "santu_hardware.santu_hardware.api.get_customer_khata",
				is_supplier
					? { supplier: row.party, from_date: state.from_date, to_date: state.to_date }
					: { customer: row.party, from_date: state.from_date, to_date: state.to_date }
			)
			.then(async (data) => {
				const money = (v) => format_currency_plain(v || 0);
				const sched = await schedule_promise;
				const rows_html = data.rows.length
					? data.rows
							.map(
								(r, idx) => `
						<tr>
							<td>${idx + 1}</td>
							<td>${frappe.datetime.str_to_user(r.date)}</td>
							<td>${frappe.utils.escape_html(r.display_number)}</td>
							<td>${frappe.utils.escape_html(r.type)}</td>
							<td class="santu-khata-items">${
								(r.items && r.items.length)
									// Per-piece rate AND that line's own total against
									// each item, not just the quantity (2026-09-04
									// direct request: "uske samne individual ka
									// price", then "individual item ka bill dikhna
									// chahiye"). Same qty x rate = amount shape the
									// printed/WhatsApped copy uses, so what is on
									// screen and what the party receives match.
									? r.items
											.map(
												(it) =>
													`<div class="santu-khata-item-line"><span class="santu-khata-item-name">${frappe.utils.escape_html(it.item_name)}</span><span class="santu-khata-item-calc">${frappe.utils.escape_html(String(it.qty))} x ${money(it.rate)}</span><span class="santu-khata-item-amt">${money(it.amount)}</span></div>`
											)
											.join("")
									: frappe.utils.escape_html(r.items_summary || "")
							}</td>
							<td class="santu-khata-num">${r.debit ? money(r.debit) : ""}</td>
							<td class="santu-khata-num">${r.credit ? money(r.credit) : ""}</td>
							<td class="santu-khata-num santu-khata-balance">${money(r.balance)}</td>
						</tr>`
							)
							.join("")
					: `<tr><td colspan="8" class="santu-khata-empty">${__("Is date range me koi lena-dena nahi hai.")}</td></tr>`;

				// Only when something is actually pending — a party who owes
				// nothing should not be shown an empty "dena hai" box.
				const sched_rows = (sched && sched.rows) || [];
				const sched_html = sched_rows.length
					? `
					<div class="santu-khata-due">
						<div class="santu-khata-due-head">
							<span>${is_supplier ? __("Kab Kitna Dena Hai") : __("Kab Kitna Lena Hai")}</span>
							<b>${money(sched.total)}</b>
						</div>
						<table class="santu-khata-due-table">
							<thead><tr>
								<th>${__("Bill No.")}</th>
								<th>${__("Bill Date")}</th>
								<th>${__("Dene Ki Date")}</th>
								<th class="santu-khata-num">${__("Baaki")}</th>
							</tr></thead>
							<tbody>
								${sched_rows
									.map(
										(r) => `<tr class="${r.overdue ? "santu-khata-due-late" : ""}">
											<td>${frappe.utils.escape_html(r.display_number || "")}</td>
											<td>${r.posting_date ? frappe.datetime.str_to_user(r.posting_date) : ""}</td>
											<td>${r.due_date ? frappe.datetime.str_to_user(r.due_date) : ""}${r.overdue ? ` <span class="santu-khata-due-tag">${__("Date nikal gayi")}</span>` : ""}</td>
											<td class="santu-khata-num">${money(r.pending)}</td>
										</tr>`
									)
									.join("")}
							</tbody>
						</table>
						${sched.overdue ? `<div class="santu-khata-due-foot">${__("Date nikal chuki hai:")} <b>${money(sched.overdue)}</b></div>` : ""}
					</div>`
					: "";

				$wrap.html(`
					${sched_html}
					<div class="santu-khata-table-wrap">
						<table class="santu-khata-table">
							<thead>
								<tr>
									<th>${__("#")}</th>
									<th>${__("Date")}</th>
									<th>${__("Bill No.")}</th>
									<th>${__("Type")}</th>
									<th>${__("Items")}</th>
									<th class="santu-khata-num">${is_supplier ? __("Debit (Purchase)") : __("Debit (Sale)")}</th>
									<th class="santu-khata-num">${__("Credit (Paid)")}</th>
									<th class="santu-khata-num">${__("Balance")}</th>
								</tr>
							</thead>
							<tbody>
								<tr class="santu-khata-opening">
									<td colspan="7">${__("Opening Balance")}</td>
									<td class="santu-khata-num">${money(data.opening_balance)}</td>
								</tr>
								${rows_html}
								<tr class="santu-khata-closing">
									<td colspan="7">${__("Closing Balance")}</td>
									<td class="santu-khata-num">${money(data.closing_balance)}</td>
								</tr>
							</tbody>
						</table>
					</div>
				`);
			})
			.catch(() => {
				$wrap.html(`<div class="santu-khata-empty">${__("Load nahi hua.")}</div>`);
			});
	};

	d.fields_dict.from_date.$input.on("change", () => {
		state.from_date = d.get_value("from_date");
		render_khata();
	});
	d.fields_dict.to_date.$input.on("change", () => {
		state.to_date = d.get_value("to_date");
		render_khata();
	});
	// Only affects Print — the on-screen table never changes, so no
	// render_khata() call here.
	d.fields_dict.compact_print.$input.on("change", () => {
		state.compact = d.get_value("compact_print") ? 1 : 0;
	});

	// Print and WhatsApp, alongside Download PDF — a Dialog only has one
	// built-in primary/secondary pair, so these two are appended to the
	// footer by hand rather than forcing both into that one slot.
	const $footer = d.$wrapper.find(".modal-footer");
	const $print_btn = $(`<button type="button" class="btn btn-default">${__("Print")}</button>`);
	$print_btn.on("click", async () => {
		try {
			frappe.dom.freeze(__("Printing Account Statement…"));
			// Raced against a timeout: the server call talks to the thermal
			// printer, and a printer that is off or busy never answers — the
			// screen then sat frozen on "Printing Account Statement…" with no way
			// out (2026-08-29). After 8s we stop waiting and fall through to
			// the browser print below, which always works.
			const res = await Promise.race([
				frappe.xcall(
					is_supplier
						? "santu_hardware.santu_hardware.print_service.print_supplier_khata"
						: "santu_hardware.santu_hardware.print_service.print_customer_khata",
					{ ...khata_args(), compact: state.compact }
				),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("thermal-print-timeout")), 8000)
				),
			]);
			frappe.dom.unfreeze();
			if (res && res.method && res.method !== "PDF") {
				frappe.show_alert({ message: __("Printed on Thermal Printer"), indicator: "green" });
				return;
			}
		} catch (e) {
			frappe.dom.unfreeze();
		}

		// Fallback to browser print with 80mm thermal layout
		const w = window.open("", "_blank");
		if (!w) {
			frappe.msgprint(__("Please allow pop-ups to print."));
			return;
		}
		w.document.write(`<p style="font-family:sans-serif;padding:24px;">${__("Loading…")}</p>`);
		frappe
			.xcall(
				is_supplier
					? "santu_hardware.santu_hardware.api.get_supplier_khata_print_html"
					: "santu_hardware.santu_hardware.api.get_customer_khata_print_html",
				{ ...khata_args(), compact: state.compact }
			)
			.then((html) => {
				w.document.open();
				w.document.write(html);
				w.document.close();
				w.focus();
				setTimeout(() => w.print(), 250);
			})
			.catch((err) => {
				w.document.open();
				w.document.write(`<p style="font-family:sans-serif;padding:24px;color:#c0392b;">${frappe.utils.escape_html((err && err.message) || String(err))}</p>`);
				w.document.close();
			});
	});
	const $wa_btn = $(`<button type="button" class="btn btn-default">${__("Send on WhatsApp")}</button>`);
	$wa_btn.on("click", () => {
		frappe.require("/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_api.js", () => {
			santu_wa_connect.api.status().then((status) => {
				if (status.state !== "CONNECTED") {
					frappe.set_route("santu-whatsapp-connect");
					return;
				}
				frappe.dom.freeze(__("Sending…"));
				frappe
					.xcall(
						is_supplier
							? "santu_hardware.santu_hardware.whatsapp_connect_api.send_supplier_khata"
							: "santu_hardware.santu_hardware.whatsapp_connect_api.send_customer_khata",
						khata_args()
					)
					.then((r) => {
						frappe.dom.unfreeze();
						if (r && r.ok === false) {
							frappe.msgprint({ title: __("Could not send"), message: frappe.utils.escape_html(r.error || ""), indicator: "red" });
							return;
						}
						frappe.show_alert({ message: __("Account Statement sent on WhatsApp"), indicator: "green" });
					})
					.catch(() => frappe.dom.unfreeze());
			});
		});
	});
	$footer.prepend($wa_btn).prepend($print_btn);

	d.show();
	render_khata();
}

async function load_party_detail($detail, row) {
	$detail.html(`<div class="santu-dash-loading">Loading...</div>`);

	const [contact, bills] = await Promise.all([
		frappe.xcall("santu_hardware.santu_hardware.api.get_party_contact_info", {
			party_type: row.party_type,
			party: row.party,
		}),
		frappe.xcall("santu_hardware.santu_hardware.api.get_party_transactions", {
			party_type: row.party_type,
			party: row.party,
		}),
	]);

	$detail.html(`
		<div class="santu-parties-card">
			<div class="santu-parties-detail-head">
				<div class="santu-parties-detail-name">
					${frappe.utils.escape_html(row.party_name)}
					<div class="santu-parties-more">
						<button type="button" class="santu-parties-more-btn" title="${__("More")}">${SANTU_PARTIES_MORE_ICON}</button>
						<div class="santu-parties-more-menu">
							<button type="button" class="santu-parties-more-item santu-parties-edit-btn">${__("Edit Details")}</button>
							<button type="button" class="santu-parties-more-item santu-parties-more-danger santu-parties-delete-btn">${__("Delete Party")}</button>
						</div>
					</div>
				</div>
				<div class="santu-parties-detail-icons">
					${contact.phone ? `<button type="button" class="santu-parties-icon-btn santu-parties-whatsapp-btn" title="Message on WhatsApp">${SANTU_PARTIES_WA_ICON}</button>` : ""}
				</div>
			</div>
			${_balance_line(row)}
			<div class="santu-parties-detail-info">
				${info_col(SANTU_PARTIES_PHONE_ICON, "Phone Number", contact.phone)}
				${info_col(SANTU_PARTIES_ADDRESS_ICON, "Billing Address", contact.address)}
				${info_col(SANTU_PARTIES_GSTIN_ICON, "GSTIN", contact.gstin)}
				${info_col(SANTU_PARTIES_MAIL_ICON, "Email", contact.email)}
				${info_col(SANTU_PARTIES_RUPEE_ICON, "Credit Limit", contact.credit_limit ? format_currency_plain(contact.credit_limit) : "")}
			</div>
		</div>
		<div class="santu-parties-txn-card">
			<div class="santu-parties-txn-head">
				<div class="santu-parties-detail-section-title">Transactions</div>
				<div class="santu-parties-txn-icons">
					<input type="text" class="santu-parties-txn-search" placeholder="Search">
					<button type="button" class="santu-parties-icon-btn santu-parties-txn-search-btn" title="Search">${SANTU_PARTIES_SEARCH_ICON}</button>
					<button type="button" class="santu-parties-icon-btn santu-parties-txn-print-btn" title="Print">${SANTU_PARTIES_PRINT_ICON}</button>
					<button type="button" class="santu-parties-khata-btn" title="${__("Poora chalta account dekho — date range chuno, download karo")}">${__("Account")}</button>
				</div>
			</div>
			<div class="santu-parties-bills"></div>
		</div>
	`);

	const open_wa_reminder = () => {
		const digits = (contact.phone || "").replace(/\D/g, "");
		if (!digits) {
			frappe.prompt(
				{
					fieldtype: "Data",
					fieldname: "phone",
					label: __("WhatsApp Mobile Number"),
					reqd: 1,
					description: __("Enter 10-digit mobile number for {0}", [row.party_name]),
				},
				(v) => {
					const clean = (v.phone || "").replace(/\D/g, "");
					if (clean.length < 10) {
						frappe.msgprint(__("Please enter a valid 10-digit mobile number."));
						return;
					}
					frappe.xcall("santu_hardware.santu_hardware.api.update_party_phone", {
						party_type: row.party_type,
						party: row.party,
						phone: clean.slice(-10),
					}).then(() => {
						contact.phone = clean.slice(-10);
						open_wa_reminder();
					});
				},
				__("Customer Phone Number")
			);
			return;
		}
		const num = digits.length === 10 ? "91" + digits : digits;
		frappe.require("/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_api.js", () => {
			santu_wa_connect.api.status().then((status) => {
				if (status.state !== "CONNECTED") {
					frappe.set_route("santu-whatsapp-connect");
					return;
				}
				const latest_bill = (bills || [])
					.slice()
					.sort((a, b) => (a.posting_date < b.posting_date ? 1 : -1))[0];

				frappe.dom.freeze(__("Loading…"));
				santu_wa_connect.api
					.reminderPreview(row.party_type, row.party)
					.then((r) => {
						frappe.dom.unfreeze();
						const default_message =
							(Number(row.amount) || 0) > 0
								? r.message
								: `नमस्ते ${row.party_name} जी,\n\nSantu Hardware से खरीदारी करने के लिए धन्यवाद!`;

						const d = new frappe.ui.Dialog({
							title: __("Send Payment Reminder on WhatsApp"),
							fields: [
								{ fieldtype: "Small Text", fieldname: "message", label: __("Message"), reqd: 1, default: default_message },
								{
									fieldtype: "Check",
									fieldname: "attach_summary",
									label: __("Attach running statement (All bills & Ledger balance PDF)"),
									default: 1,
								},
							],
							primary_action_label: __("Send on WhatsApp"),
							primary_action: (v) => {
								frappe.dom.freeze(__("Sending…"));
								const send = v.attach_summary
									? santu_wa_connect.api.sendStatement(row.party_type, row.party, v.message)
									: santu_wa_connect.api.send(num, v.message, row.party_type, row.party);
								send
									.then(() => {
										frappe.dom.unfreeze();
										d.hide();
										frappe.show_alert({ message: __("Reminder sent successfully!"), indicator: "green" });
									})
									.catch(() => frappe.dom.unfreeze());
							},
						});
						if (latest_bill) {
							d.set_secondary_action_label(__("Send Latest Bill ({0})", [latest_bill.name]));
							d.$wrapper.find(".btn-secondary").on("click", () => {
								frappe.dom.freeze(__("Sending…"));
								santu_wa_connect.api
									.sendTxn(latest_bill.doctype, latest_bill.name, d.get_value("message"))
									.then(() => {
										frappe.dom.unfreeze();
										d.hide();
										frappe.show_alert({ message: __("Bill sent successfully!"), indicator: "green" });
									})
									.catch(() => frappe.dom.unfreeze());
							});
						}
						d.show();
					})
					.catch(() => frappe.dom.unfreeze());
			});
		});
	};

	$detail.find(".santu-parties-whatsapp-btn").on("click", open_wa_reminder);
	$detail.find(".santu-parties-send-reminder-btn").on("click", open_wa_reminder);
	$detail.find(".santu-parties-payment-btn").on("click", () => {
		window.santu_open_collect_payment({
			party_type: row.party_type,
			party: row.party,
			// Only worth prefilling when it is actually THIS party owing —
			// a "You owe" balance is a credit sitting the other way, which
			// Payment In/Out (always Receive-for-Customer / Pay-for-
			// Supplier) cannot record, so there is no sane amount to hand
			// over in that case; the collect-payment screen's own blank
			// field is exactly right there.
			amount: _balance_direction(row).owes_you ? _balance_direction(row).amount : null,
		});
	});
	// Edit/Delete live behind a kebab menu: the bare red trash sitting next to
	// the party name read as a hazard on every single view, and it is a rarely
	// used action.
	$detail.find(".santu-parties-more-btn").on("click", (e) => {
		e.stopPropagation();
		const $menu = $detail.find(".santu-parties-more-menu");
		const open = $menu.hasClass("open");
		$(document).trigger("click.santu-parties-more");
		$menu.toggleClass("open", !open);
	});
	$(document).off("click.santu-parties-more").on("click.santu-parties-more", () =>
		$(".santu-parties-more-menu").removeClass("open")
	);
	$detail.find(".santu-parties-more-item").on("click", () =>
		$detail.find(".santu-parties-more-menu").removeClass("open")
	);
	$detail.find(".santu-parties-edit-btn").on("click", () =>
		// Reload the LIST, not just this panel: an edit can change the name
		// shown in the list, and a rename changes the docname the panel was
		// keyed on. Reloading and re-selecting is the only way both stay
		// truthful — previously the dialog said "Saved" while the list went
		// on showing the old name.
		open_edit_party_dialog(row, contact, (new_party) => {
			santu_parties_page.reload_list(new_party);
		})
	);
	$detail.find(".santu-parties-delete-btn").on("click", () => {
		frappe.confirm(__("Are you sure you want to delete {0}?", [frappe.utils.escape_html(row.party_name)]), () => {
			frappe.call({
				method: "santu_hardware.santu_hardware.api.delete_party",
				args: {
					party_type: row.party_type,
					party: row.party
				},
				callback: function(r) {
					if (!r.exc) {
						if (r.message && r.message.disabled) {
							frappe.show_alert({ message: __("Party disabled instead of deleted because of linked transactions."), indicator: "orange" });
						} else {
							frappe.show_alert({ message: __("Party Deleted"), indicator: "green" });
						}
						santu_parties_page.reload_list();
					}
				}
			});
		});
	});
	$detail.find(".santu-parties-txn-search-btn").on("click", () => {
		$detail.find(".santu-parties-txn-search").toggleClass("open").focus();
	});
	$detail.find(".santu-parties-txn-search").on("input", function () {
		const q = (this.value || "").toLowerCase();
		$detail.find(".santu-parties-bill-row").each(function () {
			$(this).toggle($(this).text().toLowerCase().indexOf(q) !== -1);
		});
	});
	$detail.find(".santu-parties-txn-print-btn").on("click", () => {
		if (row.party_type === "Customer") {
			open_party_khata_dialog(row);
		} else {
			window.print();
		}
	});

	// Running khata (2026-08-27 for Customer; 2026-09-03 direct request
	// extended it to Supplier — "kis party ko mujhe kitna paisa dena hai,
	// kab kitna payment de diya gya, tracking ho"): every sale/purchase and
	// every payment for this one party, in date order, with a running
	// balance after each row.
	$detail.find(".santu-parties-khata-btn").on("click", () => open_party_khata_dialog(row));

	const $bills = $detail.find(".santu-parties-bills");

	if (!bills.length) {
		$bills.append(
			`<div class="santu-parties-list-empty"><b>No Transaction found</b><span>We could not find any transaction.<br>Please try again.</span></div>`
		);
		return;
	}

	const $table = $(`
		<table class="santu-parties-table">
			<thead>
				<tr><th>Type</th><th>Number</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th></tr>
			</thead>
			<tbody></tbody>
		</table>
	`);
	const $tbody = $table.find("tbody");

	bills.forEach((b) => {
		// Shows the shop's own running Bill No (100, 101 ... same number
		// printed on the thermal slip), not the document ID (SINV-26-00254) —
		// that ID means nothing to an operator; the Bill No is what they'd
		// actually search or ask a customer for (2026-08-23 direct request).
		// Falls back to the document name when there's no santu_bill_no
		// (Purchase Invoice rows, or a Sales/POS Invoice that predates the
		// counter).
		$(`
			<tr class="santu-parties-bill-row">
				<td>${frappe.utils.escape_html(b.type)}</td>
				<td>${frappe.utils.escape_html(b.display_number || santu_bill_label(b.santu_bill_no))}</td>
				<td>${frappe.datetime.str_to_user(b.posting_date)}</td>
				<td class="num">₹ ${format_currency_plain(b.grand_total)}</td>
				<td class="num">${b.outstanding_amount > 0 ? "₹ " + format_currency_plain(b.outstanding_amount) : "-"}</td>
			</tr>
		`)
			.on("click", () => window.santu_open_invoice_view(b.doctype, b.name))
			.appendTo($tbody);
	});

	$bills.append($table);
}

function open_edit_party_dialog(row, contact, on_saved) {
	// One free-text Address field (2026-08-27 direct request: "district &
	// pin ka concept hata do, only address ka rakho, it can be anything jo
	// bhaiya dale") — no village/pincode/district split or autocomplete.
	const d = new frappe.ui.Dialog({
		title: __("Edit Party"),
		fields: [
			// Name is editable: it wasn't, so a party typed wrong at creation
			// could never be fixed and a duplicate got made instead.
			{ fieldtype: "Data", fieldname: "party_name", label: __("Party Name"), reqd: 1, default: row.party_name || "" },
			{ fieldtype: "Data", fieldname: "phone", label: __("Phone Number"), default: contact.phone || "" },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Data", fieldname: "email", label: __("Email"), default: contact.email || "" },
			{ fieldtype: "Data", fieldname: "gstin", label: __("GSTIN"), default: contact.gstin || "" },
			{ fieldtype: "Button", fieldname: "verify_gstin", label: __("Verify GSTIN") },
			{ fieldtype: "HTML", fieldname: "gstin_status" },
			{ fieldtype: "Section Break" },
			{
				fieldtype: "Currency",
				fieldname: "credit_limit",
				label: __("Udhaar Limit (Credit Limit)"),
				// Only the Add Party dialog ever offered this, so an existing
				// party's limit could never be set or changed and the feature
				// read as dead. Blank = no limit, which is how every party in
				// this shop already behaves.
				description: __("Isse zyada ka udhaar nahi ho payega. Khaali chhodo = koi limit nahi."),
				default: contact.credit_limit || 0,
			},
			{ fieldtype: "Section Break" },
			{
				fieldtype: "Small Text",
				fieldname: "address",
				label: __("Address"),
				// contact.address IS address_line1 — the one and only
				// address field, shown and edited from the exact same
				// source (2026-08-28 direct report: a separately-computed
				// display value here caused Edit and the detail panel to
				// permanently disagree).
				default: contact.address || "",
			},
		],
		primary_action_label: __("Save"),
		primary_action: (v) => {
			const phone = (v.phone || "").trim();
			const address = (v.address || "").trim();
			frappe.dom.freeze(__("Saving…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.update_party_details", {
					party_type: row.party_type,
					party: row.party,
					party_name: v.party_name,
					phone,
					email: v.email || "",
					gstin: v.gstin || "",
					address,
					credit_limit: v.credit_limit || 0,
				})
				.then((r) => {
					frappe.dom.unfreeze();
					d.hide();
					frappe.show_alert({ message: __("Saved"), indicator: "green" });
					// Hand back the name the server ended up with: a rename
					// changes the docname, so the caller's `row` is stale from
					// here on.
					if (on_saved) on_saved((r && r.party) || row.party);
				})
				.catch(() => frappe.dom.unfreeze());
		},
	});
	d.$wrapper.addClass("santu-parties-add-dialog");

	// 2026-09-03 direct request: "gstin ko verify karne ka option laa do ki
	// verified, incorrect name, incorrect gst, etc". This shop has no GSP
	// subscription configured (GST Settings.api_secret is blank, confirmed
	// live) — a real government-database name-match lookup needs that, so
	// this checks format + state-code + checksum only, which was explicitly
	// agreed to as the fallback once the live option's cost/setup was
	// explained.
	const show_gstin_status = (result) => {
		const $wrap = d.fields_dict.gstin_status.$wrapper;
		if (!result) {
			$wrap.empty();
			return;
		}
		$wrap.html(`
			<div class="santu-gstin-status ${result.ok ? "is-ok" : "is-bad"}">
				${result.ok ? "✓" : "✕"} ${frappe.utils.escape_html(result.message)}
			</div>
		`);
	};
	d.fields_dict.verify_gstin.$input.on("click", async (e) => {
		e.preventDefault();
		const gstin = (d.get_value("gstin") || "").trim();
		if (!gstin) {
			show_gstin_status({ ok: false, message: __("Pehle GSTIN type karo.") });
			return;
		}
		d.fields_dict.verify_gstin.$input.prop("disabled", true).text(__("Checking…"));
		try {
			const r = await frappe.xcall("santu_hardware.santu_hardware.api.verify_gstin_format", { gstin });
			show_gstin_status(r);
		} finally {
			d.fields_dict.verify_gstin.$input.prop("disabled", false).text(__("Verify GSTIN"));
		}
	});
	// Typing over an already-checked GSTIN invalidates that check — stale
	// "✓ valid" sitting next to a since-edited number would be a lie.
	d.fields_dict.gstin.$input.on("input", () => show_gstin_status(null));

	d.show();
}

function format_currency_plain(value) {
	return format_currency(value, "INR").replace(/^\D+/, "");
}
