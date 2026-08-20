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
const SANTU_PARTIES_EDIT_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.166 2.5a1.667 1.667 0 0 1 2.357 2.357L6.25 15.13l-3.334.834.834-3.334L14.166 2.5Z" stroke="#0075E8" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

		$root.find(".santu-parties-add-btn").on("click", () => this.open_add_party());
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

	open_add_party() {
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
					default: "Customer",
					reqd: 1,
				},
				{ fieldtype: "Data", fieldname: "customer_name", label: __("Party Name"), reqd: 1 },
				{ fieldtype: "Data", fieldname: "phone", label: __("Phone Number") },
				{ fieldtype: "Data", fieldname: "gstin", label: __("GSTIN") },
				{ fieldtype: "Data", fieldname: "email", label: __("Email") },
				{ fieldtype: "Small Text", fieldname: "address_line1", label: __("Billing Address") },
				{ fieldtype: "Select", fieldname: "state", label: __("State"), options: "Bihar", default: "Bihar" },
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				v.customer_name = (v.customer_name || "").toUpperCase().trim();
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
	// instead of being left on a name that no longer exists.
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
			this.first_load && !select_party,
			(meta) => {
				if (meta.empty_all && !this.filter) this.show_landing();
			}
		);
		this.first_load = false;
		if (select_party) {
			const $row = this.$list.find(`.santu-parties-row[data-party="${CSS.escape(select_party)}"]`);
			if ($row.length) $row.trigger("click");
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
		const tone = dir.settled ? "" : dir.owes_you ? "success" : "danger";
		const $row = $(`
			<div class="santu-parties-row" role="button" tabindex="0" data-party="${frappe.utils.escape_html(row.party)}">
				<span class="santu-parties-row-name">${frappe.utils.escape_html(row.party_name)}</span>
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

function _balance_line(row) {
	const { amount, owes_you, settled } = _balance_direction(row);
	if (settled) {
		return `<div class="santu-parties-balance santu-parties-balance-clear">All settled — nothing pending</div>`;
	}
	return `
		<div class="santu-parties-balance ${owes_you ? "santu-parties-balance-in" : "santu-parties-balance-out"}">
			<span class="santu-parties-balance-label">${owes_you ? "Owes you" : "You owe"}</span>
			<span class="santu-parties-balance-amount santu-figures">₹ ${format_currency_plain(amount)}</span>
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
					<button type="button" class="santu-parties-edit-btn" title="View/Edit">${SANTU_PARTIES_EDIT_ICON}</button>
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
				</div>
			</div>
			<div class="santu-parties-bills"></div>
		</div>
	`);

	// Sends through the same WhatsApp Connect (Meta bridge) integration the
	// bills already go out on — not wa.me / web.whatsapp.com, and not a
	// whatsapp:// deep link either (2026-08-18: tried the app-scheme link
	// first, but WhatsApp Desktop on Mac doesn't register it at all —
	// "bilkul kuch nahi hota" — then direct request: "ye santuhardware app
	// me whatsapp already hai jaha pe bill jata hai, wahi map kr do").
	$detail.find(".santu-parties-whatsapp-btn").on("click", () => {
		const digits = (contact.phone || "").replace(/\D/g, "");
		if (!digits) return;
		const num = digits.length === 10 ? "91" + digits : digits;
		frappe.require("/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_api.js", () => {
			santu_wa_connect.api.status().then((status) => {
				if (status.state !== "CONNECTED") {
					// Not linked yet — send the counter to the same connect
					// screen the bill-sharing flow already relies on, instead
					// of failing silently on a send that can't go anywhere.
					frappe.set_route("santu-whatsapp-connect");
					return;
				}
				// The latest bill, for the "send with bill" action below — same
				// `bills` list already loaded for this panel's own Transactions
				// table, just picked for its newest posting_date.
				const latest_bill = (bills || [])
					.slice()
					.sort((a, b) => (a.posting_date < b.posting_date ? 1 : -1))[0];

				frappe.dom.freeze(__("Loading…"));
				santu_wa_connect.api
					.reminderPreview(row.party_type, row.party)
					.then((r) => {
						frappe.dom.unfreeze();
						// A blank/undue message reads oddly — the reminder text
						// only makes sense when something is actually owed
						// (2026-08-18 direct request: "kitna baaki hai, ya kya
						// bill hai" — balance due, or the bill itself).
						const default_message =
							(Number(row.amount) || 0) > 0
								? r.message
								: `Hi ${row.party_name},\n\nThank you for shopping with Santu Hardware!`;

						const d = new frappe.ui.Dialog({
							title: __("Message on WhatsApp"),
							fields: [
								{ fieldtype: "Small Text", fieldname: "message", label: __("Message"), reqd: 1, default: default_message },
								{
									fieldtype: "Check",
									fieldname: "attach_summary",
									label: __("Attach full bill summary (all bills, running balance)"),
									// On by default — a bare balance figure with nothing
									// backing it up is what prompted this in the first
									// place (2026-08-18: "sara bill summary v attach kr
									// do" — the numbers should come with the bills that
									// add up to them, not just the one latest bill).
									default: 1,
								},
							],
							primary_action_label: __("Send"),
							primary_action: (v) => {
								frappe.dom.freeze(__("Sending…"));
								const send = v.attach_summary
									? santu_wa_connect.api.sendStatement(row.party_type, row.party, v.message)
									: santu_wa_connect.api.send(num, v.message, row.party_type, row.party);
								send
									.then(() => {
										frappe.dom.unfreeze();
										d.hide();
										frappe.show_alert({ message: __("Sent"), indicator: "green" });
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
										frappe.show_alert({ message: __("Sent"), indicator: "green" });
									})
									.catch(() => frappe.dom.unfreeze());
							});
						}
						d.show();
					})
					.catch(() => frappe.dom.unfreeze());
			});
		});
	});
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
	$detail.find(".santu-parties-txn-search-btn").on("click", () => {
		$detail.find(".santu-parties-txn-search").toggleClass("open").focus();
	});
	$detail.find(".santu-parties-txn-search").on("input", function () {
		const q = (this.value || "").toLowerCase();
		$detail.find(".santu-parties-bill-row").each(function () {
			$(this).toggle($(this).text().toLowerCase().indexOf(q) !== -1);
		});
	});
	$detail.find(".santu-parties-txn-print-btn").on("click", () => window.print());

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
		$(`
			<tr class="santu-parties-bill-row">
				<td>${frappe.utils.escape_html(b.type)}</td>
				<td>${frappe.utils.escape_html(b.name)}</td>
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
	const d = new frappe.ui.Dialog({
		title: __("Edit Party"),
		fields: [
			// Name is editable: it wasn't, so a party typed wrong at creation
			// could never be fixed and a duplicate got made instead.
			{ fieldtype: "Data", fieldname: "party_name", label: __("Party Name"), reqd: 1, default: row.party_name || "" },
			{ fieldtype: "Data", fieldname: "phone", label: __("Phone Number"), default: contact.phone || "" },
			{ fieldtype: "Data", fieldname: "email", label: __("Email"), default: contact.email || "" },
			{ fieldtype: "Data", fieldname: "gstin", label: __("GSTIN"), default: contact.gstin || "" },
			{
				fieldtype: "Small Text",
				fieldname: "address",
				label: __("Billing Address"),
				default: contact.address || "",
			},
		],
		primary_action_label: __("Save"),
		primary_action: (v) => {
			frappe.dom.freeze(__("Saving…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.update_party_details", {
					party_type: row.party_type,
					party: row.party,
					party_name: v.party_name,
					phone: v.phone || "",
					email: v.email || "",
					gstin: v.gstin || "",
					address: v.address || "",
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
	d.show();
}

function format_currency_plain(value) {
	return format_currency(value, "INR").replace(/^\D+/, "");
}
