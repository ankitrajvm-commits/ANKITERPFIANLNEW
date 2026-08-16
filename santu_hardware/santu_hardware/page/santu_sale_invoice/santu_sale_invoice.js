/* global frappe, santu_sale_invoice, santu_toggle_privacy_mode, santu_is_privacy_mode_active */
// Santu Hardware POS — Sales Invoice screen (2026-08-14 redesign).
// Backs onto a real Sales Invoice (not POS Invoice) via
// santu_hardware.santu_hardware.api.save_sale_invoice — multi-tab shell
// is purely client-side (localStorage), no draft documents are created
// while a sale is in progress. See "Start New Sale" routing in
// santu_dashboard.js / santu_fixed_sidebar.js for entry points.
frappe.pages["santu-sale-invoice"].on_page_load = function (wrapper) {
	frappe.require(
		["/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js"],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Sale", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_sale_pos.init(page);
		}
	);
};

// "Convert to Sales Invoice" (from Quotation or Sales Order,
// santu_sale_transactions.js) hands off the mapped-but-unsaved doc here via
// frappe.route_options.prefill instead of trying to view it — see the
// matching note in santu_sales_order.js for why (get_invoice_view_data only
// knows real saved documents).
frappe.pages["santu-sale-invoice"].on_page_show = function () {
	const prefill = frappe.route_options && frappe.route_options.prefill;
	if (prefill && window.santu_sale_pos && santu_sale_pos.page && santu_sale_pos.init_data) {
		frappe.route_options = null;
		santu_sale_pos._apply_prefill(prefill);
		return;
	}
	if (window.santu_sale_pos && santu_sale_pos.page) santu_sale_pos.render();
};

const SANTU_SI2_STORAGE_KEY = "santu_sale_pos_tabs_v1";
const SANTU_SI2_DEFAULT_TERMS =
	"The goods returned can only be exchanged at store only. Call before making any exchange or return confirmation.";

// Explicitly on `window`, not a top-level `const`: a classic script's
// top-level const lives in the global lexical environment, not on window,
// so `window.santu_sale_pos` read undefined everywhere it was checked —
// including on_page_show above, which meant returning to this screen after
// it was already open never re-rendered or applied a prefill.
window.santu_sale_pos = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._save_debounced = santu_sale_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		santu_sale_invoice.api.init().then((data) => {
			this.init_data = data;
			const prefill = frappe.route_options && frappe.route_options.prefill;
			frappe.route_options = null;
			if (prefill) {
				this._apply_prefill(prefill);
				return;
			}
			this._load_from_storage();
			if (!this.tabs.length) this._new_tab();
			this.render();
		});
	},

	// ---------- persistence (localStorage only — see file header) ----------
	_load_from_storage() {
		try {
			const raw = localStorage.getItem(SANTU_SI2_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
				this.tabs = parsed.tabs;
				this.active_id = parsed.active_id && this.tabs.some((t) => t.id === parsed.active_id)
					? parsed.active_id
					: this.tabs[0].id;
			}
		} catch (e) {
			// corrupt storage — start fresh rather than block the screen
			this.tabs = [];
		}
	},
	_persist() {
		try {
			localStorage.setItem(
				SANTU_SI2_STORAGE_KEY,
				JSON.stringify({ tabs: this.tabs, active_id: this.active_id })
			);
		} catch (e) {
			// storage full/unavailable — sale still works, just not refresh-safe
		}
	},

	_default_place_of_supply() {
		// Shop-specific default (direct request) — Bihar, matching whatever
		// exact "NN-Bihar" option string this India Compliance install uses
		// rather than hardcoding a state code that might not match.
		const options = this.init_data.place_of_supply_options || [];
		return options.find((o) => o.toLowerCase().includes("bihar")) || null;
	},

	_blank_tab() {
		return {
			id: santu_sale_invoice.utils.uid(),
			label: null, // auto-numbered by position if null
			customer: null,
			customer_details: null,
			phone: "",
			address: "",
			payment_mode: "credit",
			mode_of_payment: (this.init_data.payment_modes[0] || {}).name || null,
			paid_amount: null, // null = "full amount" (Cash mode); a number less than the total = partial payment, remainder goes to the customer's account
			items: [],
			additional_discount_amount: 0,
			round_off: true,
			place_of_supply: this._default_place_of_supply(),
			posting_date: this.init_data.posting_date,
			terms: SANTU_SI2_DEFAULT_TERMS,
			description: "",
			held: false,
			saved_invoice: null, // {name, grand_total, ...} once saved
		};
	},

	_new_tab(focus) {
		const t = this._blank_tab();
		this.tabs.push(t);
		if (focus !== false) this.active_id = t.id;
		this._save_debounced();
		return t;
	},

	// Builds a fresh tab from a mapped-but-unsaved doc (Quotation's or
	// Sales Order's "Convert to Sales Invoice") — see the matching method
	// in santu_sales_order.js for why items are re-looked-up via item_row()
	// rather than trusting the mapped doc's own shape.
	_apply_prefill(doc) {
		const tab = this._blank_tab();
		tab.customer = doc.customer || doc.party_name || null;
		tab.place_of_supply = doc.place_of_supply || tab.place_of_supply;
		if (doc.terms) tab.terms = doc.terms;
		tab.additional_discount_amount = doc.discount_amount || 0;
		this.tabs.push(tab);
		this.active_id = tab.id;
		this._save_debounced();
		this.render();

		if (tab.customer) {
			santu_sale_invoice.api.customer_details(tab.customer).then((d) => {
				tab.customer_details = d;
				// Same Walk-in-must-be-Cash correction _select_customer applies —
				// a prefilled tab sets tab.customer directly, bypassing it, which
				// let a converted Quotation for Walk-in Customer reach Save still
				// on Credit and fail with "cannot have an outstanding balance"
				// (confirmed live 2026-08-15).
				if ((d.customer_name || "").trim().toLowerCase() === "walk-in customer" && tab.payment_mode === "credit") {
					tab.payment_mode = "cash";
					frappe.show_alert({ message: __("Walk-in Customer must pay in full — switched to Cash."), indicator: "orange" });
					this._save_debounced();
					this._render_body();
					return;
				}
				this._save_debounced();
				this._render_customer_info();
			});
		}

		(doc.items || []).forEach((r) => {
			santu_sale_invoice.api.item_row(tab.customer, r.item_code, this.init_data.warehouse, r.qty).then((row) => {
				tab.items.push({
					id: santu_sale_invoice.utils.uid(),
					item_code: r.item_code,
					item_name: row.item_name || r.item_name || r.item_code,
					qty: r.qty,
					uom: r.uom || row.uom || row.stock_uom,
					uom_options: row.uom ? [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i) : [row.stock_uom],
					rate: row.price_list_rate || row.rate || r.rate || 0,
					discount_percentage: r.discount_percentage || 0,
					discount_amount: r.discount_amount || 0,
					tax_rate: row.tax_rate || 0,
					amount: r.amount || r.qty * (row.price_list_rate || row.rate || r.rate || 0),
				});
				this._save_debounced();
				this._render_items();
			});
		});
	},

	_active_tab() {
		return this.tabs.find((t) => t.id === this.active_id) || this.tabs[0];
	},

	_tab_label(tab, idx) {
		return tab.label || `Sale #${idx + 1}`;
	},

	_tab_is_empty(tab) {
		return !tab.customer && !tab.items.length && !tab.saved_invoice;
	},

	// ---------- top-level render ----------
	render() {
		if (!this.tabs.length) this._new_tab();
		const $body = $(this.page.body);
		$body.html(`
			<div class="santu-si2">
				<div class="santu-si2-tabbar">
					<div class="santu-si2-tabs"></div>
					<div class="santu-si2-toolbar">
						<button type="button" class="santu-si2-icon-btn" data-action="calculator" title="Calculator">🧮</button>
						<button type="button" class="santu-si2-icon-btn" data-action="settings" title="Settings">⚙</button>
					</div>
				</div>
				<div class="santu-si2-body"></div>
			</div>
		`);
		this.$root = $body.find(".santu-si2");
		this._render_tabbar();
		this._render_body();
		this._bind_toolbar();
		this._bind_shortcuts();
	},

	_render_tabbar() {
		const $tabs = this.$root.find(".santu-si2-tabs");
		$tabs.empty();
		this.tabs.forEach((tab, idx) => {
			const active = tab.id === this.active_id;
			const $tab = $(`
				<button type="button" class="santu-si2-tab${active ? " is-active" : ""}${tab.held ? " is-held" : ""}" data-tab="${tab.id}">
					<span class="santu-si2-tab-label">${frappe.utils.escape_html(this._tab_label(tab, idx))}</span>
					<span class="santu-si2-tab-close" data-close="${tab.id}">×</span>
				</button>
			`);
			$tab.on("click", (e) => {
				if ($(e.target).is(".santu-si2-tab-close")) return;
				this.active_id = tab.id;
				this._save_debounced();
				this.render();
			});
			$tab.find(".santu-si2-tab-close").on("click", (e) => {
				e.stopPropagation();
				this._close_tab(tab.id);
			});
			$tabs.append($tab);
		});
		$(`<button type="button" class="santu-si2-tab-add" title="New Sale (Ctrl+N)">+</button>`)
			.on("click", () => {
				this._new_tab();
				this.render();
			})
			.appendTo($tabs);
	},

	_close_tab(id) {
		const tab = this.tabs.find((t) => t.id === id);
		if (!tab) return;
		const finish = () => {
			this.tabs = this.tabs.filter((t) => t.id !== id);
			if (!this.tabs.length) this._new_tab(false);
			if (this.active_id === id) this.active_id = this.tabs[0].id;
			this._save_debounced();
			this.render();
		};
		if (this._tab_is_empty(tab)) {
			finish();
			return;
		}
		frappe.confirm(
			__("This sale has unsaved items. Close anyway? (Tip: use Hold Sale instead to keep it for later.)"),
			finish
		);
	},

	// ---------- body ----------
	_render_body() {
		const tab = this._active_tab();
		const $wrap = this.$root.find(".santu-si2-body");
		$wrap.html(`
			<div class="santu-si2-header">
				<div class="santu-si2-header-title">Sale</div>
				<div class="santu-si2-mode">
					<span class="santu-si2-mode-label${tab.payment_mode === "credit" ? " is-active" : ""}" data-mode="credit">Credit</span>
					<label class="santu-si2-switch">
						<input type="checkbox" class="santu-si2-mode-input" ${tab.payment_mode === "cash" ? "checked" : ""}>
						<span class="santu-si2-slider"></span>
					</label>
					<span class="santu-si2-mode-label${tab.payment_mode === "cash" ? " is-active" : ""}" data-mode="cash">Cash</span>
				</div>
			</div>

			<div class="santu-si2-toprow">
				<div class="santu-si2-customer-col">
					<div class="santu-si2-customer-fields">
						<div class="santu-si2-customer-row1">
							<div class="santu-si2-customer-search-wrap">
								<input type="text" class="santu-si2-customer-search" placeholder="Party Name *" autocomplete="off">
								<div class="santu-si2-customer-dropdown" style="display:none;"></div>
							</div>
							<input type="text" class="santu-si2-phone" placeholder="Phone No.">
						</div>
						<textarea class="santu-si2-address" placeholder="Address" rows="2"></textarea>
						<div class="santu-si2-customer-row2">
							<div class="santu-si2-village-wrap">
								<input type="text" class="santu-si2-village" placeholder="Village / City" autocomplete="off">
								<div class="santu-si2-village-dropdown" style="display:none;"></div>
							</div>
							<input type="text" class="santu-si2-pincode" placeholder="Pincode" maxlength="6" inputmode="numeric">
						</div>
						<a href="#" class="santu-si2-party-advanced">${__("GST & more details…")}</a>
					</div>
				</div>
				<div class="santu-si2-customer-info"></div>
				<div class="santu-si2-invoice-info">
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Invoice Number</span>
						<span class="santu-si2-inv-value">${
							tab.saved_invoice
								? frappe.utils.escape_html(tab.saved_invoice.name)
								: frappe.utils.escape_html((this.init_data.naming_series_default || "").replace(/\.#+.*/, "")) + " (auto)"
						}</span>
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Invoice Date</span>
						<input type="date" class="santu-si2-posting-date" value="${tab.posting_date}">
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">State of supply</span>
						<select class="santu-si2-place-of-supply">
							<option value="">Select</option>
							${(this.init_data.place_of_supply_options || [])
								.map((o) => `<option value="${frappe.utils.escape_html(o)}" ${o === tab.place_of_supply ? "selected" : ""}>${frappe.utils.escape_html(o)}</option>`)
								.join("")}
						</select>
					</div>
				</div>
			</div>

			<div class="santu-si2-table-wrap">
				<table class="santu-si2-table">
					<thead>
						<tr>
							<th class="santu-si2-col-idx">#</th>
							<th class="santu-si2-col-item">ITEM</th>
							<th class="santu-si2-col-qty">QTY</th>
							<th class="santu-si2-col-uom">UNIT</th>
							<th class="santu-si2-col-rate">PRICE/UNIT</th>
							<th class="santu-si2-col-disc">DISCOUNT</th>
							<th class="santu-si2-col-tax">TAX</th>
							<th class="santu-si2-col-amount">AMOUNT</th>
							<th class="santu-si2-col-remove"></th>
						</tr>
					</thead>
					<tbody></tbody>
					<tfoot>
						<tr>
							<td colspan="2"><button type="button" class="santu-si2-add-row">+ ADD ROW</button> <button type="button" class="santu-si2-scan-row" title="Scan a barcode">📷 SCAN BARCODE</button></td>
							<td class="santu-si2-total-qty">0</td>
							<td></td>
							<td></td>
							<td></td>
							<td></td>
							<td class="santu-si2-total-amount santu-si2-figures">₹ 0</td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</div>

			<div class="santu-si2-lowerrow">
				<div class="santu-si2-extras">
					<button type="button" class="santu-si2-extra-btn" data-extra="terms">☰ ADD TERMS &amp; CONDITIONS</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="description">＋ ADD DESCRIPTION</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="image">📷 ADD IMAGE</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="document">📄 ADD DOCUMENT</button>
				</div>
				<div class="santu-si2-summary">
					<div class="santu-si2-summary-row">
						<span>Subtotal</span>
						<span class="santu-si2-figures santu-si2-sum-subtotal">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row">
						<span>Discount (whole bill)</span>
						<input type="number" min="0" step="0.01" class="santu-si2-add-discount" value="${tab.additional_discount_amount || ""}" placeholder="0">
					</div>
					<div class="santu-si2-summary-row">
						<span>Tax</span>
						<span class="santu-si2-figures santu-si2-sum-tax">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row">
						<span><label><input type="checkbox" class="santu-si2-round-off" ${tab.round_off ? "checked" : ""}> Round Off</label></span>
						<span class="santu-si2-figures santu-si2-sum-roundoff">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row santu-si2-summary-total">
						<span>Total</span>
						<span class="santu-si2-figures santu-si2-sum-total">₹ 0</span>
					</div>
					<div class="santu-si2-payment-summary-title">Payment Summary</div>

<div class="santu-si2-summary-row">
    <span>Total This Amount</span>
    <span class="santu-si2-figures santu-si2-payment-total">₹ 0</span>
</div>

<div class="santu-si2-summary-row">
	<span>Mode of Payment</span>
	<select class="santu-si2-mop">${(this.init_data.payment_modes || [])
		.map((m) => `<option value="${frappe.utils.escape_html(m.name)}" ${m.name === tab.mode_of_payment ? "selected" : ""}>${frappe.utils.escape_html(m.name)}</option>`)
		.join("")}</select>
</div>

<div class="santu-si2-summary-row santu-si2-received-row">
    <span>Received Amount</span>
    <input
        type="number"
        class="santu-si2-received-input"
        min="0"
        step="0.01"
        value="${tab.paid_amount != null ? tab.paid_amount : (tab.payment_mode === "cash" ? "" : "0")}"
        placeholder="${tab.payment_mode === "cash" ? "Full amount" : "0"}"
    >
</div>
<div class="santu-si2-remaining-note" style="display:none;"></div>

<div class="santu-si2-summary-row">
    <span>Baaki Amount</span>
    <span class="santu-si2-figures santu-si2-payment-left">₹ 0</span>
</div>
					</div>
				</div>
			</div>

			<div class="santu-si2-actionbar">
				<div class="santu-si2-actionbar-left">
					<button type="button" class="santu-si2-btn santu-si2-btn-hold" data-action="hold">Hold Sale <span class="santu-si2-kbd">F9</span></button>
					${
						tab.saved_invoice
							? `<button type="button" class="santu-si2-btn" data-action="whatsapp">Send on WhatsApp</button>`
							: ""
					}
					<div class="santu-si2-more-wrap">
						<button type="button" class="santu-si2-btn" data-action="more">More ▾</button>
						<div class="santu-si2-more-menu" style="display:none;">
							<button type="button" data-more="payment">Payment</button>
							<button type="button" data-more="sales_return">Sales Return</button>
							<button type="button" data-more="submit_draft">Save as Draft (don't submit)</button>
							<button type="button" data-more="privacy">Show Cost Price</button>
						</div>
					</div>
				</div>
				<div class="santu-si2-actionbar-right">
					<button type="button" class="santu-si2-btn" data-action="share">Share</button>
					<button type="button" class="santu-si2-btn" data-action="save_print">Save &amp; Print</button>
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_items();
		this._render_customer_info();
		this._bind_body_events();
	},

	// ---------- customer ----------
	_get_inline_customer_fields() {
		const tab = this._active_tab();
		const name = (this.$root.find(".santu-si2-customer-search").val() || "").trim();
		const phone = (this.$root.find(".santu-si2-phone").val() || "").trim();
		const address = (this.$root.find(".santu-si2-address").val() || "").trim();
		const city = (this.$root.find(".santu-si2-village").val() || "").trim();
		const pincode = (this.$root.find(".santu-si2-pincode").val() || "").trim();
		tab.phone = phone;
		tab.address = address;
		tab.city = city;
		tab.pincode = pincode;
		return { name, phone, address, city, pincode };
	},

	_sync_inline_customer_fields() {
		const tab = this._active_tab();
		const $search = this.$root.find(".santu-si2-customer-search");
		const $phone = this.$root.find(".santu-si2-phone");
		const $address = this.$root.find(".santu-si2-address");
		const $village = this.$root.find(".santu-si2-village");
		const $pincode = this.$root.find(".santu-si2-pincode");
		const d = tab.customer_details || {};
		$search.val(d.customer_name || tab.customer || "");
		$phone.val(d.mobile_no || tab.phone || "");
		$address.val(d.address_line1 || tab.address || "");
		$village.val(d.city || tab.city || "");
		$pincode.val(d.pincode || tab.pincode || "");
	},

	_render_customer_info() {
		const tab = this._active_tab();
		const $info = this.$root.find(".santu-si2-customer-info");
		this._sync_inline_customer_fields();
		if (!tab.customer) {
			$info.empty();
			return;
		}
		const d = tab.customer_details || {};
		const outstanding = d.outstanding_amount || 0;
		$info.html(`
			<div class="santu-si2-cust-card">
				<div class="santu-si2-cust-name">${frappe.utils.escape_html(d.customer_name || tab.customer)}
					<button type="button" class="santu-si2-cust-clear" title="Change customer">×</button>
				</div>
				${d.village ? `<div class="santu-si2-cust-sub">${frappe.utils.escape_html(d.village)}</div>` : ""}
				<div class="santu-si2-cust-stats">
					<span class="${outstanding > 0 ? "santu-si2-warn-text" : ""}">Outstanding: ₹ ${santu_sale_invoice.utils.format_money(outstanding).replace("₹ ", "")}</span>
					${d.credit_limit ? `<span>Credit Limit: ₹ ${santu_sale_invoice.utils.format_money(d.credit_limit).replace("₹ ", "")}</span>` : ""}
				</div>
			</div>
		`);
		$info.find(".santu-si2-cust-clear").on("click", () => {
			tab.customer = null;
			tab.customer_details = null;
			tab.phone = "";
			tab.address = "";
			this._save_debounced();
			this._render_body();
		});
	},

	_customer_search(q) {
		const $dd = this.$root.find(".santu-si2-customer-dropdown");
		if (!q || q.length < 2) {
			$dd.hide().empty();
			return;
		}
		santu_sale_invoice.api.search_customers(q).then((raw_rows) => {
			$dd.empty();

			// "Walk-in Customer" specifically has genuine duplicate master
			// records left over from before dedup existed — collapse only
			// that name to one row. Two DIFFERENT real people who happen to
			// share a name (the actual case this dropdown needs to handle
			// well) must both stay visible — that's what the expand
			// arrow/village/note below is for, not deduping them away.
			const seen_walkin = new Set();
			const rows = raw_rows.filter((c) => {
				const key = (c.customer_name || "").trim().toLowerCase();
				if (key !== "walk-in customer") return true;
				if (seen_walkin.has(key)) return false;
				seen_walkin.add(key);
				return true;
			});

			const has_walkin = rows.some((c) => (c.customer_name || "").trim().toLowerCase() === "walk-in customer");
			const exact_match = rows.some((c) => (c.customer_name || "").trim().toLowerCase() === q.trim().toLowerCase());

			rows.forEach((c) => {
				const $row = $(`
					<div class="santu-si2-dd-row" data-customer="${frappe.utils.escape_html(c.name)}">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(c.customer_name)}</b>
								${c.mobile_no ? `<span>${frappe.utils.escape_html(c.mobile_no)}</span>` : ""}
							</div>
							<button type="button" class="santu-si2-dd-expand" title="More info">▸</button>
						</div>
						<div class="santu-si2-dd-row-info" style="display:none;">
							<div class="santu-si2-dd-row-village">${c.santu_village ? `📍 ${frappe.utils.escape_html(c.santu_village)}` : "No village on file"}</div>
							<textarea class="santu-si2-dd-row-note" placeholder="Add a note to identify this customer (e.g. house/landmark)">${frappe.utils.escape_html(c.customer_details || "")}</textarea>
							<button type="button" class="santu-si2-dd-row-note-save">Save note</button>
						</div>
					</div>
				`).appendTo($dd);

				$row.find(".santu-si2-dd-row-main").on("click", () => this._select_customer(c.name));

				$row.find(".santu-si2-dd-expand").on("click", (e) => {
					e.stopPropagation();
					$row.find(".santu-si2-dd-row-info").toggle();
				});

				$row.find(".santu-si2-dd-row-note, .santu-si2-dd-row-note-save").on("click", (e) => e.stopPropagation());
				$row.find(".santu-si2-dd-row-note-save").on("click", () => {
					const note = $row.find(".santu-si2-dd-row-note").val();
					santu_sale_invoice.api.update_customer_note(c.name, note).then(() => {
						c.customer_details = note;
						frappe.show_alert({ message: "Note saved", indicator: "green" });
					});
				});
			});

			if (!has_walkin) {
				$(`<div class="santu-si2-dd-row santu-si2-dd-walkin" data-walkin="1">Walk-in Customer</div>`)
					.on("click", () => this._use_walkin_customer())
					.appendTo($dd);
			}

			if (!exact_match) {
				$(`<div class="santu-si2-dd-row santu-si2-dd-add" data-add="1">+ Use "${frappe.utils.escape_html(q)}" as new customer</div>`)
					.on("click", () => this._use_new_customer_name(q))
					.appendTo($dd);
				$(`<div class="santu-si2-dd-row santu-si2-dd-advanced">+ Add with GST &amp; address details</div>`)
					.on("click", () => this._open_add_party_dialog(q))
					.appendTo($dd);
			}

			$dd.show();
		});
	},

	_select_customer(name) {
		const tab = this._active_tab();
		tab.customer = name;
		this.$root.find(".santu-si2-customer-dropdown").hide().empty();
		santu_sale_invoice.api.customer_details(name).then((d) => {
			tab.customer_details = d;
			// Walk-in Customer can't carry a balance — switch out of Credit
			// automatically rather than let the cashier build a whole sale
			// and only find out at Save.
			let mode_changed = false;
			if ((d.customer_name || "").trim().toLowerCase() === "walk-in customer" && tab.payment_mode === "credit") {
				tab.payment_mode = "cash";
				mode_changed = true;
				frappe.show_alert({ message: __("Walk-in Customer must pay in full — switched to Cash."), indicator: "orange" });
			}
			this._save_debounced();
			if (mode_changed) this._render_body();
			else this._render_customer_info();
		});
	},

	_use_walkin_customer() {
		santu_sale_invoice.api.search_customers("Walk-in").then((rows) => {
			const walkin = rows.find((r) => r.customer_name === "Walk-in Customer");
			if (walkin) {
				this._select_customer(walkin.name);
			} else {
				santu_sale_invoice.api.create_customer("Walk-in Customer", null, null).then((customer_name) => {
					this._select_customer(customer_name);
				});
			}
		});
	},

	_use_new_customer_name(name) {
		const tab = this._active_tab();
		tab.customer = null;
		tab.customer_details = null;
		this.$root.find(".santu-si2-customer-search").val(name);
		this.$root.find(".santu-si2-customer-dropdown").hide().empty();
		this._save_debounced();
		this.$root.find(".santu-si2-phone").focus();
	},

	_ensure_customer_before_save(tab) {
		const { name, phone, address, city, pincode } = this._get_inline_customer_fields();

		if (tab.customer) {
			const d = tab.customer_details || {};
			const currentName = (d.customer_name || "").trim();
			const currentPhone = (d.mobile_no || "").trim();
			const currentAddress = (d.address_line1 || "").trim();
			const currentCity = (d.city || "").trim();
			const currentPincode = (d.pincode || "").trim();
			const nameChanged = name && name !== currentName;
			const phoneChanged = phone !== currentPhone;
			const addressChanged = address !== currentAddress;
			const cityChanged = city !== currentCity;
			const pincodeChanged = pincode !== currentPincode;

			if (nameChanged || phoneChanged || addressChanged || cityChanged || pincodeChanged) {
				return santu_sale_invoice.api
					.update_customer_inline(
						tab.customer,
						nameChanged ? name : null,
						phoneChanged ? phone : null,
						addressChanged ? address : null,
						cityChanged ? city : null,
						pincodeChanged ? pincode : null
					)
					.then((r) => {
						if (r.party && r.party !== tab.customer) tab.customer = r.party;
						return santu_sale_invoice.api.customer_details(tab.customer).then((details) => {
							tab.customer_details = details;
							this._save_debounced();
							return tab.customer;
						});
					});
			}
			return Promise.resolve(tab.customer);
		}

		if (!name) {
			frappe.msgprint(__("Please enter a party name or select a customer."));
			return Promise.reject();
		}

		if (!phone && !address && !city && !pincode) {
			frappe.msgprint(__("Add a phone number or an address for {0} — one of the two is needed.", [name]));
			return Promise.reject();
		}

		const payload = { customer_name: name, phone: phone || null };
		if (address || city || pincode) {
			if (address) payload.address_line1 = address;
			if (city) payload.city = city;
			if (pincode) payload.pincode = pincode;
			payload.state = "Bihar";
			payload.country = "India";
		}

		return santu_sale_invoice.api.create_customer_full(payload).then((customer_name) => {
			tab.customer = customer_name;
			return santu_sale_invoice.api.customer_details(customer_name).then((d) => {
				tab.customer_details = d;
				this._save_debounced();
				return customer_name;
			});
		});
	},

	_open_add_party_dialog(name) {
		const { phone } = this._get_inline_customer_fields();
		santu_sale_invoice.utils.open_add_party_dialog({
			name: name || (this.$root.find(".santu-si2-customer-search").val() || "").trim(),
			phone,
			on_created: (customer_name) => this._select_customer(customer_name),
		});
	},

	// ---------- items ----------
	_render_items() {
		const tab = this._active_tab();
		const $tbody = this.$root.find(".santu-si2-table tbody");
		$tbody.empty();

		if (!tab.items.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="9">No items yet — search above or press F4 / scan a barcode.</td></tr>`).appendTo($tbody);
		}

		tab.items.forEach((row, idx) => {
			const $tr = $(`
				<tr data-row="${row.id}">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-si2-col-item">
						<div class="santu-si2-item-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div>
						<div class="santu-si2-item-sub">
							${row.available_qty != null ? `<span class="${row.available_qty <= 0 ? "santu-si2-stock-out" : row.available_qty <= 5 ? "santu-si2-stock-low" : "santu-si2-stock-ok"}">Available: ${row.available_qty} ${frappe.utils.escape_html(row.uom || "")}</span>` : ""}
							${santu_is_privacy_mode_active && santu_is_privacy_mode_active() && row.cost_price != null ? `<span class="santu-si2-cost-price">Cost: ₹ ${santu_sale_invoice.utils.format_money(row.cost_price).replace("₹ ", "")}</span>` : ""}
						</div>
					</td>
					<td class="santu-si2-col-qty">
						<div class="santu-si2-qty-stepper">
							<button type="button" class="santu-si2-qty-dec">−</button>
							<input type="number" class="santu-si2-qty-input" value="${row.qty}" min="0" step="any">
							<button type="button" class="santu-si2-qty-inc">+</button>
						</div>
					</td>
					<td class="santu-si2-col-uom">
						<select class="santu-si2-uom-select">
							${(row.uom_options || [row.uom]).filter(Boolean).map((u) => `<option value="${frappe.utils.escape_html(u)}" ${u === row.uom ? "selected" : ""}>${frappe.utils.escape_html(u)}</option>`).join("")}
						</select>
					</td>
					<td class="santu-si2-col-rate">
						<input type="number" class="santu-si2-rate-input" value="${row.rate}" min="0" step="any" ${row.can_edit_rate === false ? "disabled" : ""}>
					</td>
					<td class="santu-si2-col-disc">
						<input type="number" class="santu-si2-disc-pct-input" value="${row.discount_percentage || ""}" min="0" max="100" step="any" placeholder="%">
						<input type="number" class="santu-si2-disc-amt-input" value="${row.discount_amount || ""}" min="0" step="any" placeholder="₹">
					</td>
					<td class="santu-si2-col-tax santu-si2-tax-display" title="From this item's own GST/tax template — not editable here">
						${row.tax_rate ? row.tax_rate + "%" : "NONE"}
					</td>
					<td class="santu-si2-col-amount santu-si2-figures santu-si2-row-amount">₹ ${santu_sale_invoice.utils.format_money(row.amount || 0).replace("₹ ", "")}</td>
					<td class="santu-si2-col-remove"><button type="button" class="santu-si2-row-remove" title="Remove">🗑</button></td>
				</tr>
			`);
			$tbody.append($tr);
		});

		this._bind_item_row_events();
		this._recalc_totals();
	},

	_item_search(q, $anchor) {
		let $dd = this.$root.find(".santu-si2-item-dropdown");
		if (!$dd.length) {
			$dd = $(`<div class="santu-si2-item-dropdown" style="display:none;"></div>`).appendTo(this.$root.find(".santu-si2-table-wrap"));
		}
		if (!q) {
			santu_sale_invoice.api.recent_items().then((rows) => this._render_item_dropdown($dd, rows, "Recent Items"));
			return;
		}
		santu_sale_invoice.api.search_items(q).then((r) => this._render_item_dropdown($dd, r.results || [], null, q));
	},

	_render_item_dropdown($dd, rows, heading, query) {
		$dd.empty();
		if (heading) $dd.append(`<div class="santu-si2-dd-heading">${heading}</div>`);
		if (!rows.length) {
			$dd.append(`<div class="santu-si2-dd-empty">No items found.</div>`);
		}
		rows.forEach((item) => {
			const out_of_stock = item.available_qty != null && item.available_qty <= 0;
			$(`
				<div class="santu-si2-dd-row santu-si2-item-dd-row">
					<div>
						<b>${frappe.utils.escape_html(item.item_name)}</b>
						<span class="santu-si2-dd-sub">${frappe.utils.escape_html(item.item_code)}${item.brand ? " · " + frappe.utils.escape_html(item.brand) : ""}</span>
					</div>
					<div class="santu-si2-dd-right">
						<span class="${out_of_stock ? "santu-si2-stock-out" : item.available_qty <= 5 ? "santu-si2-stock-low" : "santu-si2-stock-ok"}">${item.available_qty != null ? item.available_qty + " " + (item.stock_uom || "") : ""}</span>
						<span class="santu-si2-figures">₹ ${santu_sale_invoice.utils.format_money(item.price || 0).replace("₹ ", "")}</span>
					</div>
				</div>
			`)
				.on("click", () => this._add_item(item.item_code))
				.appendTo($dd);
		});
		if (query) {
			$(`<div class="santu-si2-dd-row santu-si2-dd-add" data-quick-add="1">+ Quick-create "${frappe.utils.escape_html(query)}"</div>`)
				.on("click", () => this._quick_create_item(query))
				.appendTo($dd);
		}
		$dd.show();
	},

	_quick_create_item(item_name) {
		const d = new frappe.ui.Dialog({
			title: __("Quick Create Item"),
			fields: [
				{ fieldtype: "Data", fieldname: "item_name", label: "Item Name", default: item_name, reqd: 1 },
				{ fieldtype: "Currency", fieldname: "selling_price", label: "Selling Price", reqd: 1 },
			],
			primary_action_label: __("Create & Add"),
			primary_action: (v) => {
				santu_sale_invoice.api.quick_create_item(v.item_name, v.selling_price).then((r) => {
					d.hide();
					this._add_item(r.item_code);
				});
			},
		});
		d.show();
	},

	_add_item(item_code) {
		const tab = this._active_tab();
		this.$root.find(".santu-si2-item-dropdown").hide();
		this.$root.find(".santu-si2-item-search").val("");

		const existing = tab.items.find((r) => r.item_code === item_code);
		if (existing) {
			existing.qty = (Number(existing.qty) || 0) + 1;
			this._recompute_row(existing).then(() => this._render_items());
			return;
		}

		santu_sale_invoice.api.item_row(tab.customer, item_code, this.init_data.warehouse, 1).then((row) => {
			const new_row = {
				id: santu_sale_invoice.utils.uid(),
				item_code,
				item_name: row.item_name || item_code,
				qty: 1,
				uom: row.uom || row.stock_uom,
				uom_options: row.uom ? [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i) : [row.stock_uom],
				rate: row.price_list_rate || row.rate || 0,
				discount_percentage: 0,
				discount_amount: 0,
				tax_rate: row.tax_rate || 0,
				available_qty: row.available_qty,
				// A dedicated Cashier (has the role, not also System Manager —
				// same "is this really just a cashier" check kiosk_mode.js's
				// santu_redirect_cashier_to_billing() already uses) shouldn't
				// be able to override the selling price; anyone else can.
				can_edit_rate: !(frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager")),
				amount: row.price_list_rate || row.rate || 0,
			};
			tab.items.push(new_row);
			this._save_debounced();
			this._render_items();
			if (santu_is_privacy_mode_active && santu_is_privacy_mode_active()) {
				santu_sale_invoice.api.item_cost_price(item_code, this.init_data.warehouse).then((c) => {
					new_row.cost_price = c.cost_price || c;
					this._render_items();
				});
			}
		});
	},

	_recompute_row(row) {
		const tab = this._active_tab();
		return santu_sale_invoice.api.item_row(tab.customer, row.item_code, this.init_data.warehouse, row.qty).then((r) => {
			row.available_qty = r.available_qty;
			this._save_debounced();
		});
	},

	_row_local_recalc(row) {
		const base = (Number(row.qty) || 0) * (Number(row.rate) || 0);
		const pct_disc = base * ((Number(row.discount_percentage) || 0) / 100);
		const amt_disc = Number(row.discount_amount) || 0;
		const after_disc = Math.max(base - pct_disc - amt_disc, 0);
		const tax = after_disc * ((Number(row.tax_rate) || 0) / 100);
		row.amount = after_disc + tax;
		row._tax_amount = tax;
		row._net_amount = after_disc;
	},

	// What was actually received, whatever the Cash/Credit toggle happens to
	// say — used by totals, save-validation and the save payload alike, so
	// the three can't drift out of sync the way they used to. A brand new
	// tab (paid_amount still null) falls back to the toggle's own default:
	// Cash implies "the whole bill, unless typed otherwise", Credit implies
	// "nothing yet". Once the counter types an amount — in EITHER mode —
	// that typed figure is what counts. This is exactly the "₹500 bill,
	// ₹200 handed over, ₹300 to the khata" case: nothing about the toggle
	// needs to change for a partial payment to register.
	_effective_paid_amount(tab) {
		if (tab.paid_amount != null) return Math.max(Number(tab.paid_amount) || 0, 0);
		return tab.payment_mode === "cash" ? tab._computed_total || 0 : 0;
	},

	_recalc_totals() {
		const tab = this._active_tab();
		let qty_total = 0;
		let net_total = 0;
		let tax_total = 0;
		tab.items.forEach((row) => {
			this._row_local_recalc(row);
			qty_total += Number(row.qty) || 0;
			net_total += row._net_amount || 0;
			tax_total += row._tax_amount || 0;
		});
		const additional_discount = Number(tab.additional_discount_amount) || 0;
		const pre_round = Math.max(net_total + tax_total - additional_discount, 0);
		const rounded = tab.round_off ? Math.round(pre_round) : pre_round;
		const round_off_amount = rounded - pre_round;
		tab._computed_total = rounded;

		this.$root.find(".santu-si2-total-qty").text(qty_total);
		this.$root.find(".santu-si2-total-amount").text("₹ " + santu_sale_invoice.utils.format_money(net_total + tax_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-subtotal").text("₹ " + santu_sale_invoice.utils.format_money(net_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-tax").text("₹ " + santu_sale_invoice.utils.format_money(tax_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-roundoff").text("₹ " + santu_sale_invoice.utils.format_money(round_off_amount).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-total").text("₹ " + santu_sale_invoice.utils.format_money(rounded).replace("₹ ", ""));
		tab.items.forEach((row) => {
			this.$root
				.find(`tr[data-row="${row.id}"] .santu-si2-row-amount`)
				.text("₹ " + santu_sale_invoice.utils.format_money(row.amount).replace("₹ ", ""));
		});

		// Update Payment Summary — Baaki now tracks whatever was actually
		// typed into Received Amount, in either Cash or Credit mode. Before
		// this, a partial receipt only ever registered while the Cash
		// toggle was on; typing "200" here while a new sale's default
		// Credit mode was still selected silently did nothing to Baaki.
		const paid = this._effective_paid_amount(tab);
		const left = Math.max(rounded - paid, 0);
		this.$root.find(".santu-si2-payment-total").text(
			"₹ " + santu_sale_invoice.utils.format_money(rounded).replace("₹ ", "")
		);
		this.$root.find(".santu-si2-payment-left").text(
			"₹ " + santu_sale_invoice.utils.format_money(left).replace("₹ ", "")
		);
		this.$root.find(".santu-si2-received-input").attr(
			"placeholder",
			tab.payment_mode === "cash" ? "Full amount: ₹ " + santu_sale_invoice.utils.format_money(rounded).replace("₹ ", "") : "0"
		);

		const $note = this.$root.find(".santu-si2-remaining-note");
		if (tab.paid_amount != null && left > 0) {
			$note
				.text("Remaining ₹ " + santu_sale_invoice.utils.format_money(left).replace("₹ ", "") + " will be added to the customer's account")
				.show();
		} else {
			$note.hide();
		}
	},

	// ---------- events ----------
	_bind_body_events() {
		const tab = this._active_tab();
		const $root = this.$root;

		$root.find(".santu-si2-mode-input").on("change", (e) => {
			tab.payment_mode = e.target.checked ? "cash" : "credit";
			this._save_debounced();
			this._render_body();
		});
		$root.find(".santu-si2-mode-label").on("click", function () {
			tab.payment_mode = $(this).data("mode");
			santu_sale_pos._save_debounced();
			santu_sale_pos._render_body();
		});
		$root.find(".santu-si2-mop").on("change", (e) => {
			tab.mode_of_payment = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-received-input").on(
    "input",
    santu_sale_invoice.utils.debounce((e) => {
        const total = Number(tab._computed_total) || 0;
        let received = Number(e.target.value) || 0;

        // Received amount cannot exceed invoice total
        received = Math.max(0, Math.min(received, total));

        e.target.value = received;
        tab.paid_amount = received;

        this._save_debounced();
        this._recalc_totals();
    })
);

		const $custSearch = $root.find(".santu-si2-customer-search");
		$custSearch.on(
			"input",
			santu_sale_invoice.utils.debounce((e) => this._customer_search(e.target.value))
		);
		$custSearch.on("focus", (e) => {
			if (e.target.value) this._customer_search(e.target.value);
		});
		$(document)
			.off("click.santu-si2-dd")
			.on("click.santu-si2-dd", (e) => {
				if (!$(e.target).closest(".santu-si2-customer-search-wrap, .santu-si2-item-search-wrap, .santu-si2-item-dropdown, .santu-si2-village-wrap").length) {
					$root.find(".santu-si2-customer-dropdown, .santu-si2-item-dropdown, .santu-si2-village-dropdown").hide();
				}
			});
		$root.find(".santu-si2-phone").on("change input", (e) => {
			tab.phone = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-address").on("change input", (e) => {
			tab.address = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-pincode").on("change input", (e) => {
			// Digits only, and stop at 6 — a stray letter here fails Address
			// validation only after Save, when it's a lot more annoying to fix.
			const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
			if (digits !== e.target.value) e.target.value = digits;
			tab.pincode = digits;
			this._save_debounced();
		});

		// Village/City — same real Bihar village + pincode dataset the full
		// "Add Party" dialog uses, so the counter gets the same auto-filled
		// pincode here without needing to open that dialog at all. No
		// district selector in this compact row (that stays a dialog-only
		// field for the rare out-of-district customer); "Saran" is this
		// shop's own district and covers the everyday case.
		const $village = $root.find(".santu-si2-village");
		const $villageDD = $root.find(".santu-si2-village-dropdown");
		const $pincode = $root.find(".santu-si2-pincode");
		const search_village = santu_sale_invoice.utils.debounce((q) => {
			santu_sale_invoice.api.search_bihar_villages("Saran", q).then((rows) => {
				$villageDD.empty();
				if (!rows.length) {
					$villageDD.append(`<div class="santu-si2-village-empty">${__("No matches")}</div>`);
				}
				rows.forEach((r) => {
					$(`<div class="santu-si2-village-row">${frappe.utils.escape_html(r.village)} <span>${frappe.utils.escape_html(r.pincode || "")}</span></div>`)
						.on("click", () => {
							$village.val(r.village);
							tab.city = r.village;
							if (!$pincode.val() && r.pincode) {
								$pincode.val(r.pincode);
								tab.pincode = r.pincode;
							}
							$villageDD.hide();
							this._save_debounced();
						})
						.appendTo($villageDD);
				});
				$villageDD.show();
			});
		}, 250);
		$village.on("input", (e) => {
			tab.city = e.target.value;
			this._save_debounced();
			search_village(e.target.value.trim());
		});
		$village.on("focus", (e) => search_village(e.target.value.trim()));
		$village.on("blur", () => setTimeout(() => $villageDD.hide(), 150));

		$root.find(".santu-si2-party-advanced").on("click", (e) => {
			e.preventDefault();
			const name = (this.$root.find(".santu-si2-customer-search").val() || "").trim();
			this._open_add_party_dialog(name);
		});

		$root.find(".santu-si2-posting-date").on("change", (e) => {
			tab.posting_date = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-place-of-supply").on("change", (e) => {
			tab.place_of_supply = e.target.value;
			this._save_debounced();
		});

		$root.find(".santu-si2-add-row, .santu-si2-scan-row").on("click", () => this._open_item_search_inline());

		$root.find(".santu-si2-add-discount").on(
			"input",
			santu_sale_invoice.utils.debounce((e) => {
				tab.additional_discount_amount = Number(e.target.value) || 0;
				this._save_debounced();
				this._recalc_totals();
			})
		);
		$root.find(".santu-si2-round-off").on("change", (e) => {
			tab.round_off = e.target.checked;
			this._save_debounced();
			this._recalc_totals();
		});

		$root.find("[data-extra]").on("click", (e) => this._open_extra($(e.currentTarget).data("extra")));

		$root.find("[data-action]").on("click", (e) => this._handle_action($(e.currentTarget).data("action")));
		$root.find("[data-more]").on("click", (e) => {
			$root.find(".santu-si2-more-menu").hide();
			this._handle_action($(e.currentTarget).data("more"));
		});
	},

	_open_item_search_inline() {
		const $existing = this.$root.find(".santu-si2-item-search");
		if ($existing.length) {
			$existing.trigger("focus");
			return;
		}
		const $wrap = $(`
			<div class="santu-si2-item-search-wrap">
				<input type="text" class="santu-si2-item-search" placeholder="Search item name, code, barcode, brand… (F4)" autocomplete="off">
			</div>
		`);
		this.$root.find(".santu-si2-table-wrap").prepend($wrap);
		const $input = $wrap.find(".santu-si2-item-search");
		$input.trigger("focus");
		$input.on(
			"input",
			santu_sale_invoice.utils.debounce((e) => this._item_search(e.target.value.trim()))
		);
		$input.on("focus", () => this._item_search($input.val().trim()));
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				const q = $input.val().trim();
				if (!q) return;
				santu_sale_invoice.api.search_items(q).then((r) => {
					if (r.exact_match) this._add_item(r.exact_match);
					else if (r.results && r.results.length) this._add_item(r.results[0].item_code);
				});
			}
			if (e.key === "Escape") {
				this.$root.find(".santu-si2-item-dropdown, .santu-si2-item-search-wrap").remove();
			}
		});
	},

	_bind_item_row_events() {
		const tab = this._active_tab();
		this.$root.find(".santu-si2-table tbody tr[data-row]").each((_, el) => {
			const $tr = $(el);
			const row = tab.items.find((r) => r.id === $tr.data("row"));
			if (!row) return;

			const on_change = () => {
				this._save_debounced();
				this._recalc_totals();
			};

			$tr.find(".santu-si2-qty-input").on("input", (e) => {
				row.qty = Math.max(Number(e.target.value) || 0, 0);
				on_change();
				if (row.available_qty != null && row.qty > row.available_qty) {
					this._flash_stock_warning($tr, row);
				}
			});
			$tr.find(".santu-si2-qty-dec").on("click", () => {
				row.qty = Math.max((Number(row.qty) || 0) - 1, 0);
				$tr.find(".santu-si2-qty-input").val(row.qty);
				on_change();
			});
			$tr.find(".santu-si2-qty-inc").on("click", () => {
				row.qty = (Number(row.qty) || 0) + 1;
				$tr.find(".santu-si2-qty-input").val(row.qty);
				on_change();
				if (row.available_qty != null && row.qty > row.available_qty) this._flash_stock_warning($tr, row);
			});
			$tr.find(".santu-si2-uom-select").on("change", (e) => {
				row.uom = e.target.value;
				on_change();
			});
			$tr.find(".santu-si2-rate-input").on("input", (e) => {
				row.rate = Number(e.target.value) || 0;
				on_change();
			});
			$tr.find(".santu-si2-disc-pct-input").on("input", (e) => {
				row.discount_percentage = Number(e.target.value) || 0;
				row.discount_amount = 0;
				$tr.find(".santu-si2-disc-amt-input").val("");
				on_change();
			});
			$tr.find(".santu-si2-disc-amt-input").on("input", (e) => {
				row.discount_amount = Number(e.target.value) || 0;
				row.discount_percentage = 0;
				$tr.find(".santu-si2-disc-pct-input").val("");
				on_change();
			});
			$tr.find(".santu-si2-row-remove").on("click", () => {
				tab.items = tab.items.filter((r) => r.id !== row.id);
				this._save_debounced();
				this._render_items();
			});
		});
	},

	_flash_stock_warning($tr, row) {
		frappe.show_alert({
			message: __("Only {0} {1} available for {2}", [row.available_qty, row.uom || "", row.item_name]),
			indicator: "orange",
		});
		$tr.addClass("santu-si2-row-warn");
		setTimeout(() => $tr.removeClass("santu-si2-row-warn"), 1200);
	},

	_open_extra(kind) {
		const tab = this._active_tab();
		if (kind === "terms") {
			const d = new frappe.ui.Dialog({
				title: __("Terms & Conditions"),
				fields: [{ fieldtype: "Small Text", fieldname: "terms", default: tab.terms }],
				primary_action_label: __("Save"),
				primary_action: (v) => {
					tab.terms = v.terms;
					this._save_debounced();
					d.hide();
				},
			});
			d.show();
		} else if (kind === "description") {
			const d = new frappe.ui.Dialog({
				title: __("Description"),
				fields: [{ fieldtype: "Small Text", fieldname: "description", default: tab.description }],
				primary_action_label: __("Save"),
				primary_action: (v) => {
					tab.description = v.description;
					this._save_debounced();
					d.hide();
				},
			});
			d.show();
		} else if (kind === "image" || kind === "document") {
			// A brand-new tab has no Sales Invoice to attach a file TO yet —
			// Frappe's uploader needs a real saved document. This used to
			// show the same "available after the first save" message
			// forever, even once the bill genuinely had been saved and
			// tab.saved_invoice was sitting right there — the promise never
			// actually got kept. Now it does.
			if (!tab.saved_invoice) {
				frappe.show_alert({
					message: __("Save the bill first, then add a {0} from here.", [kind === "image" ? __("photo") : __("document")]),
					indicator: "blue",
				});
				return;
			}
			new frappe.ui.FileUploader({
				doctype: "Sales Invoice",
				docname: tab.saved_invoice.name,
				restrictions: kind === "image" ? { allowed_file_types: ["image/*"] } : {},
				on_success: () => {
					frappe.show_alert({ message: __("Attached."), indicator: "green" });
				},
			});
		}
	},

	// ---------- toolbar (calculator / settings) ----------
	_bind_toolbar() {
		this.$root.find('[data-action="calculator"]').on("click", () => this._open_calculator());
		this.$root.find('[data-action="settings"]').on("click", () => this._open_settings());
	},

	_open_calculator() {
		if (!this._calc_value) this._calc_value = "";
		const d = new frappe.ui.Dialog({ title: __("Calculator"), fields: [{ fieldtype: "HTML", fieldname: "calc" }] });
		const $c = $(`
			<div class="santu-si2-calc">
				<input type="text" class="santu-si2-calc-display" readonly value="0">
				<div class="santu-si2-calc-grid">
					${["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "=", "+", "C"]
						.map((k) => `<button type="button" data-key="${k}" class="${["÷", "×", "−", "+", "="].includes(k) ? "santu-si2-calc-op" : ""}">${k}</button>`)
						.join("")}
				</div>
			</div>
		`);
		d.fields_dict.calc.$wrapper.html($c);
		const $display = $c.find(".santu-si2-calc-display");
		let expr = "";
		$c.find("[data-key]").on("click", function () {
			const k = $(this).data("key");
			if (k === "C") {
				expr = "";
			} else if (k === "=") {
				try {
					// eslint-disable-next-line no-eval
					expr = String(eval(expr.replace(/÷/g, "/").replace(/×/g, "*").replace(/−/g, "-")));
				} catch (e) {
					expr = "Error";
				}
			} else {
				expr += k;
			}
			$display.val(expr || "0");
		});
		d.show();
	},

	_open_settings() {
		const d = new frappe.ui.Dialog({
			title: __("Settings"),
			fields: [
				{ fieldtype: "Check", fieldname: "sale_prefix", label: "Sale Prefix", default: 1, read_only: 1 },
				{ fieldtype: "Section Break" },
				{ fieldtype: "HTML", fieldname: "settings_note" },
			],
		});
		d.fields_dict.settings_note.$wrapper.html(`
			<p class="text-muted">Invoice numbering uses ERPNext's own naming series (${frappe.utils.escape_html((this.init_data.naming_series_default || "").replace(/\.#+.*/, ""))}) — change it from
			<a href="/app/sales-invoice/view/report" target="_blank">Sales Invoice Settings</a>.</p>
			<p class="text-muted">Transaction Message (WhatsApp) is configured under Transaction Message in the sidebar.</p>
			<p class="text-muted">Cost price is hidden by default — use the 🔒 Privacy Mode toggle (status bar) to reveal it with your PIN.</p>
		`);
		d.show();
	},

	// ---------- shortcuts ----------
	_bind_shortcuts() {
		$(document).off("keydown.santu-si2").on("keydown.santu-si2", (e) => {
			if (!$("body").find(".santu-si2").length || !$(".santu-si2:visible").length) return;
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key.toLowerCase() === "n") {
				e.preventDefault();
				this._new_tab();
				this.render();
			} else if (mod && e.key.toLowerCase() === "s") {
				e.preventDefault();
				this._handle_action("save");
			} else if (e.key === "F2") {
				e.preventDefault();
				this.$root.find(".santu-si2-customer-search").trigger("focus");
			} else if (e.key === "F4") {
				e.preventDefault();
				if (!this.$root.find(".santu-si2-item-search").length) this._open_item_search_inline();
				else this.$root.find(".santu-si2-item-search").trigger("focus");
			} else if (e.key === "F8") {
				e.preventDefault();
				this._handle_action("payment");
			} else if (e.key === "F9") {
				e.preventDefault();
				this._handle_action("hold");
			} else if (e.key === "Escape") {
				this.$root.find(".santu-si2-customer-dropdown, .santu-si2-item-dropdown").hide();
			}
		});
	},

	// ---------- actions ----------
	_handle_action(action) {
		const tab = this._active_tab();
		if (action === "more") {
			this.$root.find(".santu-si2-more-menu").toggle();
			return;
		}
		if (action === "privacy") {
			// This screen already knew how to render cost price once Privacy
			// Mode was on; nothing anywhere ever turned it on. Same gate as
			// the billing screen's [F11].
			Promise.resolve(window.santu_toggle_privacy_mode()).then(() => this._render_items());
			return;
		}
		if (action === "hold") {
			if (this._tab_is_empty(tab)) {
				frappe.show_alert({ message: __("Nothing to hold."), indicator: "orange" });
				return;
			}
			tab.held = true;
			tab.label = tab.label || this._tab_label(tab, this.tabs.indexOf(tab));
			this._save_debounced();
			frappe.show_alert({ message: __("Sale held — still here whenever you're back."), indicator: "blue" });
			this._render_tabbar();
			return;
		}
		if (action === "sales_return") {
			frappe.set_route("santu-sale", { view: "sales_return" });
			sessionStorage.setItem("santu_sale_view", "sales_return");
			return;
		}
		if (action === "payment") {
			if (!tab.customer) {
				frappe.msgprint(__("Select a customer first."));
				return;
			}
			window.santu_open_collect_payment({ party_type: "Customer", party: tab.customer });
			return;
		}
		if (action === "whatsapp") {
			if (!tab.saved_invoice) return;
			this._send_whatsapp(tab);
			return;
		}
		if (action === "share") {
			if (!tab.saved_invoice) {
				frappe.msgprint(__("Save the sale first."));
				return;
			}
			if (window.santu_whatsapp_share) {
				window.santu_whatsapp_share.send_transaction("Sales Invoice", tab.saved_invoice.name);
			} else {
				frappe.msgprint(__("WhatsApp share is loading — please try again."));
			}
			return;
		}
		if (action === "save" || action === "save_print" || action === "submit_draft") {
			this._save_sale(tab, action);
			return;
		}
	},

	_validate_before_save(tab) {
		const { name, phone, address } = this._get_inline_customer_fields();
		if (!tab.customer && !name) {
			frappe.msgprint(__("Please enter a party name or select a customer."));
			return false;
		}
		if (!tab.items.length) {
			frappe.msgprint(__("Please add at least one item."));
			return false;
		}
		for (const row of tab.items) {
			if (!row.qty || row.qty <= 0) {
				frappe.msgprint(__("Enter a valid quantity for {0}.", [row.item_name]));
				return false;
			}
		}

		// Walk-in Customer can never carry a balance (baaki) — cash-in-full
		// only. Any other customer left with an outstanding balance (credit
		// mode, or Paid Now less than the total) needs phone + address on
		// file. Server re-checks this authoritatively (this screen isn't
		// the only caller of save_sale_invoice) — this is just so the
		// cashier finds out before typing the whole sale, not after.
		const total = tab._computed_total || 0;
		const paid = this._effective_paid_amount(tab);
		const outstanding = Math.max(total - paid, 0);
		if (outstanding > 0) {
			const d = tab.customer_details || {};
			const displayName = (name || d.customer_name || tab.customer || "").trim().toLowerCase();
			if (displayName === "walk-in customer") {
				frappe.msgprint(__("Walk-in Customer cannot have an outstanding balance. Select or add a proper customer for a credit/baaki sale."));
				return false;
			}
			const hasPhone = phone || d.mobile_no || tab.phone;
			const hasAddress = address || d.address_line1 || d.address || tab.address || d.city || tab.city;
			const missing = [];
			if (!hasPhone) missing.push(__("Phone Number"));
			if (!hasAddress) missing.push(__("Address"));
			if (missing.length) {
				frappe.msgprint(__("{0} required for {1} to have an outstanding balance (baaki).", [missing.join(" " + __("and") + " "), name || d.customer_name || tab.customer]));
				return false;
			}
		}
		return true;
	},

	_save_sale(tab, action) {
		if (!this._validate_before_save(tab)) return;
		const submit = action !== "submit_draft" ? 1 : 0;

		frappe.dom.freeze(__("Saving…"));
		this._ensure_customer_before_save(tab)
			.then((customer) => {
				// Sent to the backend, not the raw toggle: the server marks the
				// invoice is_pos=1 whenever payment_mode is "cash", and — this
				// is the part that bites — an empty `payments` array under
				// is_pos=1 makes it default to the FULL grand total being paid
				// (see save_sale_invoice's added_payment fallback). So "cash"
				// may only be sent when there is a real amount to attach to
				// it; a zero/blank receipt must report as "credit" or a
				// partial/no payment would get silently marked paid in full.
				const paid = this._effective_paid_amount(tab);
				const effective_mode = paid > 0 ? "cash" : "credit";
				const payload = {
					customer,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: tab.posting_date,
					selling_price_list: this.init_data.selling_price_list,
					payment_mode: effective_mode,
					place_of_supply: tab.place_of_supply || null,
					additional_discount_amount: tab.additional_discount_amount || 0,
					terms: tab.terms || null,
					description: tab.description || null,
					items: tab.items.map((r) => ({
						item_code: r.item_code,
						qty: r.qty,
						rate: r.rate,
						uom: r.uom,
						discount_percentage: r.discount_percentage || 0,
						discount_amount: r.discount_amount || 0,
					})),
					payments:
						effective_mode === "cash" && tab.mode_of_payment
							? [{ mode_of_payment: tab.mode_of_payment, amount: paid }]
							: [],
				};

				return santu_sale_invoice.api.save(payload, submit);
			})
			.then((r) => {
				frappe.dom.unfreeze();
				if (!r) return;
				tab.saved_invoice = r;
				this._save_debounced();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				this._render_body();
				if (action === "save_print") {
					frappe.set_route("print", "Sales Invoice", r.name);
				}
			})
			.catch(() => frappe.dom.unfreeze());
	},

	_send_whatsapp(tab) {
		if (!tab.saved_invoice) return;
		window.santu_whatsapp_share.send_transaction("Sales Invoice", tab.saved_invoice.name);
	},
};
