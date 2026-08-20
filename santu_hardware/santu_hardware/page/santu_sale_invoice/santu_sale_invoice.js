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

// Shape of the placeholder name given to a party auto-created from a bare
// phone number ("Customer 6780"). Recognising it again is what lets the
// screen refuse to leave baaki on someone whose details were never filled in.
const SANTU_SI2_AUTO_NAME_RE = /^customer\s+\d+$/i;

const flt_factor = (v) => (Number(v) > 0 ? Number(v) : 1);

// Real icons instead of emoji. Emoji render differently on every OS (and the
// shop is used from both this Mac and a phone), and several of the ones this
// screen used — 🧮 ＋ ☰ — read as decoration rather than as buttons.
const SANTU_SI2_ICON_DIR = "/assets/santu_hardware/images/items";

const santu_si2_icon = (file, cls = "") =>
	`<img class="santu-si2-ico ${cls}" src="${SANTU_SI2_ICON_DIR}/${file}" alt="" draggable="false">`;

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
			note: "", // free-text identification note (e.g. house/landmark) — NOT a postal address; Village/Pincode carry the actual place
			mode_of_payment: (this.init_data.payment_modes[0] || {}).name || null,
			// null = "auto": Received Amount defaults to (and live-tracks) the
			// bill's full total, so an operator who saves without touching
			// this field gets a fully-paid bill, not a silent baaki (2026-08-19
			// direct request: "hamesha baaki hi chala jaa raha hai, dhyaan
			// naa dene pe"). Typing a real number here switches the tab out
			// of auto mode for a genuine partial/credit sale.
			paid_amount: null,
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
						<button type="button" class="santu-si2-icon-btn santu-si2-cost-toggle" data-toolbar="privacy" title="${__("Show cost price")}">${santu_si2_icon("lock-icon.svg", "is-on-dark")}</button>
						<button type="button" class="santu-si2-icon-btn" data-action="calculator" title="Calculator">${santu_si2_icon("calculator.svg", "is-on-dark")}</button>
						<button type="button" class="santu-si2-icon-btn" data-action="settings" title="Settings">${santu_si2_icon("setting_black.svg", "is-on-dark")}</button>
					</div>
				</div>
				<div class="santu-si2-print-alert" style="display:none"></div>
				<div class="santu-si2-body"></div>
			</div>
		`);
		this.$root = $body.find(".santu-si2");
		this._render_tabbar();
		this._render_body();
		this._bind_toolbar();
		this._bind_shortcuts();
		this._refresh_print_alert();
		this._listen_for_scans();
	},

	// Scan a barcode anywhere on this screen and the item lands on the bill.
	// No box to click into first: the operator has one hand on the scanner
	// and one on the goods, and the focus is wherever the last tap left it.
	_listen_for_scans() {
		if (!window.santu_barcode) return;
		window.santu_barcode.listen((code) => this._handle_scan(code), "santu-sale-invoice");
	},

	_handle_scan(code) {
		santu_sale_invoice.api
			.find_item_by_barcode(code)
			.then((r) => {
				if (r && r.found) {
					this._add_item(r.item_code);
					frappe.show_alert({
						message: __("{0} jud gaya", [r.item_name || r.item_code]),
						indicator: "green",
					});
					return;
				}
				this._unknown_barcode(code);
			})
			.catch(() => this._unknown_barcode(code));
	},

	// An unrecognised code is normal, not an error — new stock arrives with
	// codes the shop has never seen. Offer the two things that actually
	// resolve it, and keep the sale moving.
	_unknown_barcode(code) {
		const d = new frappe.ui.Dialog({
			title: __("Ye barcode kisi saman par nahi laga hai"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "code",
					options: `<div style="font-size:15px;margin-bottom:10px">
						${__("Barcode")}: <b>${frappe.utils.escape_html(code)}</b></div>`,
				},
				{
					fieldtype: "Link",
					fieldname: "item_code",
					label: __("Kis saman par lagana hai?"),
					options: "Item",
					description: __("Saman dhoondhkar chunein — agli baar scan karte hi wahi aa jayega."),
				},
			],
			primary_action_label: __("Is saman par laga do"),
			primary_action: (v) => {
				if (!v.item_code) {
					frappe.msgprint(__("Pehle saman chunein."));
					return;
				}
				santu_sale_invoice.api
					.attach_barcode_to_item(v.item_code, code)
					.then(() => {
						d.hide();
						this._add_item(v.item_code);
						frappe.show_alert({ message: __("Barcode laga diya — aur bill me jud gaya"), indicator: "green" });
					})
					.catch((err) =>
						frappe.msgprint({
							title: __("Barcode nahi laga"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						})
					);
			},
			secondary_action_label: __("Naya saman banao"),
			secondary_action: () => {
				d.hide();
				// Carry the scanned code into the new item, so the very first
				// scan of a new product is also the moment it gets its code.
				this._quick_create_item("", { barcode: code });
			},
		});
		d.show();
	},

	// A bill that never came out on paper must not be able to sit there
	// unnoticed while the counter carries on selling. The job rows already
	// know; this is the part that says so out loud, on the one screen the
	// shop actually looks at.
	_refresh_print_alert() {
		const $alert = this.$root && this.$root.find(".santu-si2-print-alert");
		if (!$alert || !$alert.length) return;
		santu_sale_invoice.api
			.open_print_jobs(24)
			.then((jobs) => {
				if (!jobs || !jobs.length) return $alert.hide().empty();
				const list = jobs
					.map((j) => frappe.utils.escape_html(j.invoice_name))
					.join(", ");
				$alert
					.html(
						`<span>${__("Ye bill print nahi hue")}: <b>${list}</b></span>
						 <button type="button" class="santu-si2-print-alert-btn" data-action="retry-prints">${__("Dobara chhapo")}</button>`
					)
					.show();
				$alert.find('[data-action="retry-prints"]').on("click", () => this._retry_stuck_prints(jobs));
			})
			.catch(() => $alert.hide());
	},

	_retry_stuck_prints(jobs) {
		frappe.dom.freeze(__("Dobara chhap rahe hain…"));
		const results = [];
		jobs
			.reduce(
				(chain, j) =>
					chain.then(() =>
						santu_sale_invoice.api
							.retry_print_job(j.name)
							.then(() => results.push([j.invoice_name, true]))
							.catch(() => results.push([j.invoice_name, false]))
					),
				Promise.resolve()
			)
			.finally(() => {
				frappe.dom.unfreeze();
				const failed = results.filter((r) => !r[1]).map((r) => r[0]);
				if (failed.length) {
					frappe.msgprint({
						title: __("Kuch bill ab bhi nahi chhape"),
						indicator: "red",
						message: __("Baaki hain: {0}. Utilities → Doctor Uncle kholkar jaanchein.", [failed.join(", ")]),
					});
				} else {
					frappe.show_alert({ message: __("Sab chhap gaye"), indicator: "green" });
				}
				this._refresh_print_alert();
			});
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
			</div>

			<div class="santu-si2-toprow">
				<div class="santu-si2-customer-col">
					<div class="santu-si2-customer-fields">
						<div class="santu-si2-customer-row1">
							<div class="santu-si2-customer-search-wrap">
								<input type="text" class="santu-si2-customer-search" placeholder="Party Name *" name="santu-party-name" autocomplete="new-password" data-lpignore="true" data-form-type="other">
								<div class="santu-si2-customer-dropdown" style="display:none;"></div>
							</div>
							<div class="santu-si2-phone-wrap">
								<input type="text" class="santu-si2-phone" placeholder="Phone No." name="santu-party-phone" autocomplete="new-password" data-lpignore="true" data-form-type="other">
								<div class="santu-si2-phone-dropdown" style="display:none;"></div>
							</div>
							<button type="button" class="santu-si2-chip santu-si2-chip-note" title="${__("Notes & customer info")}">${santu_si2_icon("iconInfo.svg")}</button>
							<button type="button" class="santu-si2-chip santu-si2-chip-more" title="${__("GST & more details")}">${santu_si2_icon("GST_Entry_Point.svg")}</button>
						</div>
						<div class="santu-si2-customer-row2">
							<div class="santu-si2-village-wrap">
								<input type="text" class="santu-si2-village" placeholder="Village / City" name="santu-party-village" autocomplete="new-password" data-lpignore="true" data-form-type="other">
								<div class="santu-si2-village-dropdown" style="display:none;"></div>
							</div>
							<input type="text" class="santu-si2-pincode" placeholder="Pincode" maxlength="6" inputmode="numeric" name="santu-party-pincode" autocomplete="new-password" data-lpignore="true" data-form-type="other">
						</div>
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
				<div class="santu-si2-table-scroll">
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
							<td colspan="2"><button type="button" class="santu-si2-add-row">+ ADD ROW</button> <button type="button" class="santu-si2-scan-row" title="Scan a barcode">${santu_si2_icon("barcode_icon.webp")} SCAN BARCODE</button></td>
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
			</div>

			<div class="santu-si2-lowerrow">
				<div class="santu-si2-extras">
					<button type="button" class="santu-si2-extra-btn" data-extra="terms">${santu_si2_icon("checklist-icon.svg")} ADD TERMS &amp; CONDITIONS</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="description">${santu_si2_icon("baseline-edit.svg")} ADD DESCRIPTION</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="image">${santu_si2_icon("baseline-add_a_photo.svg")} ADD IMAGE</button>
					<button type="button" class="santu-si2-extra-btn" data-extra="document">${santu_si2_icon("documentIcon.svg")} ADD DOCUMENT</button>
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
        value="${tab.paid_amount != null ? tab.paid_amount : (tab._computed_total || "")}"
        placeholder="0"
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
							<button type="button" data-more="report_bug">Kuch gadbad hai? Batao</button>
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
		// Notes live behind the 📝 chip, not an inline field — read them off
		// the tab, which the chip's dialog is what writes to.
		const note = (tab.note || "").trim();
		const city = (this.$root.find(".santu-si2-village").val() || "").trim();
		const pincode = (this.$root.find(".santu-si2-pincode").val() || "").trim();
		tab.phone = phone;
		tab.city = city;
		tab.pincode = pincode;
		return { name, phone, note, city, pincode };
	},

	_sync_inline_customer_fields() {
		const tab = this._active_tab();
		const $search = this.$root.find(".santu-si2-customer-search");
		const $phone = this.$root.find(".santu-si2-phone");
		const $village = this.$root.find(".santu-si2-village");
		const $pincode = this.$root.find(".santu-si2-pincode");
		const d = tab.customer_details || {};
		$search.val(d.customer_name || tab.customer || "");
		$phone.val(d.mobile_no || tab.phone || "");
		if (d.note != null) tab.note = d.note;
		// d.city is the Address record's city and is blank for anyone created
		// without a full address — santu_village (returned as d.village) is
		// where the place actually lives for those parties, so fall back to it
		// or picking a customer by phone leaves Village blank even though the
		// party card right beside it shows the village fine.
		$village.val(d.city || d.village || tab.city || "");
		$pincode.val(d.pincode || tab.pincode || "");

		// Chrome refills a blank Phone/Village from its own saved contact and
		// address data a moment after the fields render, ignoring
		// autocomplete="off" on address-shaped inputs. The tab really is empty
		// — the app never carried anything over — but the counter sees the last
		// customer's number and village sitting in a brand new sale and can
		// bill the wrong person (2026-08-17 bug report). Re-assert empty once
		// the browser has had its turn, and only while the tab is still
		// untouched, so nothing typed in the meantime is wiped.
		const blank = !tab.customer && !(tab.phone || "").trim() && !(tab.city || "").trim() && !(tab.pincode || "").trim();
		if (blank) {
			clearTimeout(this._autofill_timer);
			this._autofill_timer = setTimeout(() => {
				const t = this._active_tab();
				if (!t || t.id !== tab.id) return;
				if (t.customer || (t.phone || "").trim() || (t.city || "").trim() || (t.pincode || "").trim()) return;
				this.$root.find(".santu-si2-customer-search, .santu-si2-phone, .santu-si2-village, .santu-si2-pincode")
					.each((_, el) => {
						if (el.value) el.value = "";
					});
			}, 400);
		}
	},

	_render_customer_info() {
		const tab = this._active_tab();
		const $info = this.$root.find(".santu-si2-customer-info");
		this._sync_inline_customer_fields();
		this._render_customer_chips();
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
			tab.note = "";
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

	// Mirrors _customer_search but keyed off the Phone field — typing a
	// number that's already on file should surface the matching party the
	// same way typing their name does, so name/village/notes all come along
	// together instead of being typed twice (2026-08-16 direct request).
	_phone_search(q) {
		const $dd = this.$root.find(".santu-si2-phone-dropdown");
		const digits = (q || "").replace(/\D/g, "");
		if (digits.length < 4) {
			$dd.hide().empty();
			return;
		}
		santu_sale_invoice.api.search_customers_by_phone(digits).then((rows) => {
			$dd.empty();
			if (!rows.length) {
				$dd.hide();
				return;
			}

			// Typed the whole number and exactly one party has it: that IS the
			// customer — pull them in without making anyone click a one-row
			// dropdown. Everything (name, village, notes) fills from here.
			const exact = rows.filter((c) => (c.mobile_no || "").replace(/\D/g, "") === digits);
			if (digits.length >= 10 && exact.length === 1) {
				$dd.hide();
				if (this._active_tab().customer !== exact[0].name) this._select_customer(exact[0].name);
				return;
			}

			rows.forEach((c) => {
				$(`
					<div class="santu-si2-dd-row" data-customer="${frappe.utils.escape_html(c.name)}">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(c.customer_name)}</b>
								<span>${frappe.utils.escape_html(c.mobile_no || "")}</span>
							</div>
						</div>
					</div>
				`)
					.on("click", () => {
						$dd.hide().empty();
						this._select_customer(c.name);
					})
					.appendTo($dd);
			});
			$dd.show();
		});
	},

	// The 📝 chip beside the phone field. Notes used to sit inline as a
	// permanent two-line textarea taking up space on every sale, while the
	// thing a counter actually wants mid-sale — "who is this, what do they
	// already owe" — wasn't shown at all. Now one tap gives both.
	_open_customer_note_dialog() {
		const tab = this._active_tab();
		const d = tab.customer_details || {};
		const money = (v) => santu_sale_invoice.utils.format_money(v || 0);
		const info = tab.customer
			? `
				<div class="santu-si2-note-info">
					<div><b>${frappe.utils.escape_html(d.customer_name || tab.customer)}</b></div>
					${d.mobile_no ? `<div>📞 ${frappe.utils.escape_html(d.mobile_no)}</div>` : ""}
					${d.city || d.village ? `<div>📍 ${frappe.utils.escape_html(d.city || d.village)}</div>` : ""}
					<div>${__("Outstanding")}: <b>${money(d.outstanding_amount)}</b></div>
				</div>`
			: `<div class="santu-si2-note-info">${__("New party — the note is saved along with the sale.")}</div>`;

		const dialog = new frappe.ui.Dialog({
			title: __("Notes & customer info"),
			fields: [
				{ fieldtype: "HTML", fieldname: "info", options: info },
				{
					fieldtype: "Small Text",
					fieldname: "note",
					label: __("Note (house / landmark / anything to recognise them)"),
					default: tab.note || "",
				},
			],
			primary_action_label: __("Save"),
			primary_action: (values) => {
				const note = (values.note || "").trim();
				tab.note = note;
				this._save_debounced();
				this._render_customer_chips();
				dialog.hide();
				// An existing party's note is written through immediately — the
				// same thing the search dropdown's "Save note" does — so it
				// isn't lost if this sale is never saved.
				if (tab.customer) {
					santu_sale_invoice.api.update_customer_note(tab.customer, note).then(() => {
						if (tab.customer_details) tab.customer_details.note = note;
						frappe.show_alert({ message: __("Note saved"), indicator: "green" });
					});
				}
			},
		});
		dialog.show();
	},

	// Chips carry a dot when they hold something, so a note that's already on
	// file isn't invisible just because it lives behind a tap.
	_render_customer_chips() {
		const tab = this._active_tab();
		this.$root.find(".santu-si2-chip-note").toggleClass("has-value", !!(tab.note || "").trim());
	},

	_select_customer(name) {
		const tab = this._active_tab();
		tab.customer = name;
		this.$root.find(".santu-si2-customer-dropdown").hide().empty();
		santu_sale_invoice.api.customer_details(name).then((d) => {
			tab.customer_details = d;
			this._save_debounced();
			this._render_customer_info();
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

	// A phone number is, on its own, enough to find someone again — Party
	// Name isn't required if a phone was given. "Customer 7048" (last 4
	// digits) is what goes on record and into the WhatsApp greeting when
	// nobody typed a real name; it beats a blank "Namaste, !" message.
	_default_customer_name(phone) {
		const digits = (phone || "").replace(/\D/g, "");
		return "Customer " + (digits.slice(-4) || digits);
	},

	_ensure_customer_before_save(tab) {
		const { name, phone, note, city, pincode } = this._get_inline_customer_fields();

		if (tab.customer) {
			const d = tab.customer_details || {};
			const currentName = (d.customer_name || "").trim();
			const currentPhone = (d.mobile_no || "").trim();
			const currentNote = (d.note || "").trim();
			const currentCity = (d.city || "").trim();
			const currentPincode = (d.pincode || "").trim();
			const nameChanged = name && name !== currentName;
			const phoneChanged = phone !== currentPhone;
			const noteChanged = note !== currentNote;
			const cityChanged = city !== currentCity;
			const pincodeChanged = pincode !== currentPincode;

			const steps = [];
			if (nameChanged || phoneChanged || cityChanged || pincodeChanged) {
				steps.push(() =>
					santu_sale_invoice.api.update_customer_inline(
						tab.customer,
						nameChanged ? name : null,
						phoneChanged ? phone : null,
						null,
						cityChanged ? city : null,
						pincodeChanged ? pincode : null
					)
				);
			}
			if (noteChanged) {
				steps.push(() => santu_sale_invoice.api.update_customer_note(tab.customer, note));
			}

			if (steps.length) {
				return steps
					.reduce((p, step) => p.then((r) => step().then((r2) => r2 || r)), Promise.resolve(null))
					.then((r) => {
						if (r && r.party && r.party !== tab.customer) tab.customer = r.party;
						return santu_sale_invoice.api.customer_details(tab.customer).then((details) => {
							tab.customer_details = details;
							this._save_debounced();
							return tab.customer;
						});
					});
			}
			return Promise.resolve(tab.customer);
		}

		if (!name && !phone) {
			frappe.msgprint(__("Please enter a party name or a phone number."));
			return Promise.reject({ santu_handled: true });
		}

		const finalName = name || this._default_customer_name(phone);

		if (!phone && !city && !pincode) {
			frappe.msgprint(__("Add a phone number or a village for {0} — one of the two is needed.", [finalName]));
			return Promise.reject({ santu_handled: true });
		}

		const payload = { customer_name: finalName, phone: phone || null };
		if (city || pincode) {
			if (city) payload.city = city;
			if (pincode) payload.pincode = pincode;
			payload.state = "Bihar";
			payload.country = "India";
		}

		return santu_sale_invoice.api.create_customer_full(payload).then((customer_name) => {
			tab.customer = customer_name;
			const afterNote = note ? santu_sale_invoice.api.update_customer_note(customer_name, note) : Promise.resolve();
			return afterNote.then(() =>
				santu_sale_invoice.api.customer_details(customer_name).then((d) => {
					tab.customer_details = d;
					this._save_debounced();
					return customer_name;
				})
			);
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
							${row.available_qty != null ? `<span class="santu-si2-stock-edit ${row.available_qty <= 0 ? "santu-si2-stock-out" : row.available_qty <= 5 ? "santu-si2-stock-low" : "santu-si2-stock-ok"}" data-stock-edit="${row.id}" title="${__("Galat hai? Yahin theek karein")}">Available: ${row.available_qty} ${frappe.utils.escape_html(row.uom || "")}</span>` : ""}
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
							${(row.uom_options || []).map((o) => { const u = o.uom || o; return `<option value="${frappe.utils.escape_html(u)}" ${u === row.uom ? "selected" : ""}>${frappe.utils.escape_html(u)}</option>`; }).join("")}
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
			// Two items with the same name look identical in this list, and the
			// cashier picks one in a second flat. Say so, and show the code —
			// the code is the only thing that actually tells them apart.
			const twins = item.same_name_count > 1
				? `<span class="santu-si2-dup-chip" title="${__("Is naam ke {0} saman hain — code dekh kar chunein", [item.same_name_count])}">${__("{0} same naam", [item.same_name_count])}</span>`
				: "";
			$(`
				<div class="santu-si2-dd-row santu-si2-item-dd-row">
					<div>
						<b>${frappe.utils.escape_html(item.item_name)}</b>${twins}
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

	_quick_create_item(item_name, opts = {}) {
		const d = new frappe.ui.Dialog({
			title: __("Naya saman jodein"),
			fields: [
				{ fieldtype: "Data", fieldname: "item_name", label: __("Saman ka naam"), default: item_name, reqd: 1 },
				{ fieldtype: "HTML", fieldname: "same_name_warning" },
				{
					fieldtype: "Data",
					fieldname: "barcode",
					label: __("Barcode"),
					default: opts.barcode || "",
					description: __("Scan kiya hua code — agli baar scan karte hi ye saman aa jayega."),
					read_only: opts.barcode ? 1 : 0,
				},
				{ fieldtype: "Section Break" },
				{ fieldtype: "Data", fieldname: "uom", label: __("Unit"), default: "Nos", hidden: 1 },
				{ fieldtype: "HTML", fieldname: "uom_picker", label: __("Unit") },
				{
					fieldtype: "Float",
					fieldname: "opening_qty",
					label: __("Abhi kitna hai?"),
					description: __("Dukaan me abhi jitna maal hai — bharna zaroori hai."),
					reqd: 1,
				},
				{ fieldtype: "Column Break" },
				{ fieldtype: "Currency", fieldname: "cost_price", label: __("Kharid ka daam"), description: __("Optional") },
				{ fieldtype: "Currency", fieldname: "selling_price", label: __("Bechne ka daam"), reqd: 1 },
				{ fieldtype: "Section Break" },
				{
					fieldtype: "Link",
					fieldname: "gst_hsn_code",
					options: "GST HSN Code",
					label: __("HSN code"),
					description: __("Pehle se koi saman ho to khali chhod sakte hain — wahi HSN apne aap lag jayega."),
				},
			],
			primary_action_label: __("Banao aur bill me daalo"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Saman ban raha hai…"));
				santu_sale_invoice.api
					.quick_create_item(v.item_name, v.selling_price, {
						uom: v.uom,
						opening_qty: v.opening_qty,
						cost_price: v.cost_price,
						barcode: v.barcode || undefined,
						gst_hsn_code: v.gst_hsn_code || undefined,
					})
					.then((r) => {
						frappe.dom.unfreeze();
						d.hide();
						if (r.opening_qty) {
							frappe.show_alert({
								message: __("{0} — {1} {2} stock me chadh gaya", [r.item_name, r.opening_qty, r.uom]),
								indicator: "green",
							});
						}
						this._add_item(r.item_code);
					})
					.catch((err) => {
						frappe.dom.unfreeze();
						// Say what went wrong instead of leaving the dialog
						// sitting there looking like nothing happened.
						frappe.msgprint({
							title: __("Saman nahi ban paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						});
					});
			},
		});
		d.show();

		// The duplicates already in this catalog were not created on purpose —
		// someone typed a name that already existed and nothing said so. Say
		// so, offer the existing item, but never refuse: the same name in two
		// pack sizes is normal in a hardware shop.
		const check_name = (name) => {
			const $slot = d.fields_dict.same_name_warning.$wrapper;
			if (!name || !name.trim()) return $slot.empty();
			santu_sale_invoice.api
				.items_with_same_name(name)
				.then((matches) => {
					$slot.empty();
					if (!matches || !matches.length) return;
					const list = matches
						.map(
							(m) =>
								`<button type="button" class="santu-si2-dup-existing" data-code="${frappe.utils.escape_html(m.item_code)}">
									${frappe.utils.escape_html(m.item_code)}
									<span>${m.available_qty != null ? m.available_qty + " " + (m.stock_uom || "") : ""}</span>
								</button>`
						)
						.join("");
					$slot.append(
						`<div class="santu-si2-dup-warn">
							<div><b>${__("Is naam ka saman pehle se hai")}</b> — ${__("naya banane ki zaroorat hai kya?")}</div>
							<div class="santu-si2-dup-existing-wrap">${list}</div>
						</div>`
					);
					$slot.find(".santu-si2-dup-existing").on("click", (e) => {
						d.hide();
						this._add_item($(e.currentTarget).data("code"));
					});
				})
				.catch(() => $slot.empty());
		};

		check_name(item_name);
		d.fields_dict.item_name.$input.on(
			"input",
			frappe.utils.debounce(() => check_name(d.get_value("item_name")), 400)
		);

		this._render_uom_picker(d);
	},

	// ERPNext ships 264 units. In an alphabetical list "Nos" and "Box" sit
	// somewhere past Hectare and Kilopascal, so adding an item meant hunting
	// to the bottom of a list of things a hardware shop will never sell
	// (2026-08-17 feedback). The units this shop actually stocks become
	// one-tap buttons; everything else stays reachable behind "Aur…".
	_render_uom_picker(d) {
		const $slot = d.fields_dict.uom_picker.$wrapper;
		$slot.html(`<div class="santu-si2-uom-loading">${__("Unit…")}</div>`);
		santu_sale_invoice.api
			.uom_options()
			.then((rows) => {
				if (!rows || !rows.length) return $slot.empty();
				const quick = rows.filter((r) => r.group !== "baaki");
				const rest = rows.filter((r) => r.group === "baaki");
				$slot.html(`
					<label class="control-label">${__("Unit")}</label>
					<div class="santu-si2-uom-chips">
						${quick
							.map(
								(r) =>
									`<button type="button" class="santu-si2-uom-chip" data-uom="${frappe.utils.escape_html(r.name)}">${frappe.utils.escape_html(r.name)}</button>`
							)
							.join("")}
					</div>
					<select class="santu-si2-uom-more form-control">
						<option value="">${__("Aur koi unit…")}</option>
						${rest
							.map(
								(r) =>
									`<option value="${frappe.utils.escape_html(r.name)}">${frappe.utils.escape_html(r.name)}</option>`
							)
							.join("")}
					</select>
				`);

				const mark = (value) => {
					d.set_value("uom", value);
					$slot.find(".santu-si2-uom-chip").each(function () {
						$(this).toggleClass("is-on", $(this).data("uom") === value);
					});
					// Keep the dropdown showing the value only when it is the
					// one that supplied it, so the chips stay the visible truth.
					const in_rest = rest.some((r) => r.name === value);
					$slot.find(".santu-si2-uom-more").val(in_rest ? value : "");
				};

				$slot.find(".santu-si2-uom-chip").on("click", (e) => mark($(e.currentTarget).data("uom")));
				$slot.find(".santu-si2-uom-more").on("change", (e) => {
					if (e.target.value) mark(e.target.value);
				});
				mark(d.get_value("uom") || (quick[0] && quick[0].name) || "Nos");
			})
			.catch(() => {
				// Never leave the dialog without a way to set a unit.
				$slot.html(
					`<label class="control-label">${__("Unit")}</label>
					 <input type="text" class="form-control santu-si2-uom-fallback" value="${frappe.utils.escape_html(d.get_value("uom") || "Nos")}">`
				);
				$slot.find(".santu-si2-uom-fallback").on("input", (e) => d.set_value("uom", e.target.value));
			});
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
				// Real unit list from the item, plus the rate and stock held in
				// STOCK units, so switching Nos <-> Box just multiplies.
				uom_options: (row.uoms && row.uoms.length ? row.uoms : [{ uom: row.uom || row.stock_uom, conversion_factor: 1 }]),
				conversion_factor: 1,
				base_rate: row.price_list_rate || row.rate || 0,
				base_available_qty: row.available_qty,
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
				this._load_cost_prices(tab).then(() => this._render_items());
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

	// What was actually received — used by totals, save-validation and the
	// save payload alike. `null` (auto mode, untouched) means the full bill
	// total — a bill nobody edits Received Amount on saves as fully paid,
	// not baaki. Typing a real amount here is what makes it a genuine
	// partial/credit sale — the "₹500 bill, ₹200 handed over, ₹300 to the
	// khata" case.
	_effective_paid_amount(tab) {
		if (tab.paid_amount == null) return Math.max(Number(tab._computed_total) || 0, 0);
		return Math.max(Number(tab.paid_amount) || 0, 0);
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
		const $received = this.$root.find(".santu-si2-received-input");
		$received.attr("placeholder", "0");
		// Auto mode (nothing typed yet): keep the field showing the live
		// total as items/discounts change, so "save without touching this"
		// always means "fully paid" — not whatever the total happened to be
		// a moment ago.
		if (tab.paid_amount == null && document.activeElement !== $received.get(0)) {
			$received.val(rounded || "");
		}

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
				if (!$(e.target).closest(".santu-si2-customer-search-wrap, .santu-si2-phone-wrap, .santu-si2-item-search-wrap, .santu-si2-item-dropdown, .santu-si2-village-wrap").length) {
					$root.find(".santu-si2-customer-dropdown, .santu-si2-phone-dropdown, .santu-si2-item-dropdown, .santu-si2-village-dropdown").hide();
				}
			});
		const $phone = $root.find(".santu-si2-phone");
		$phone.on(
			"input",
			santu_sale_invoice.utils.debounce((e) => this._phone_search(e.target.value))
		);
		$phone.on("focus", (e) => {
			if (e.target.value) this._phone_search(e.target.value);
		});
		$phone.on("change input", (e) => {
			tab.phone = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-chip-note").on("click", () => this._open_customer_note_dialog());
		$root.find(".santu-si2-pincode").on("change input", (e) => {
			// Digits only, and stop at 6 — a stray letter here fails Address
			// validation only after Save, when it's a lot more annoying to fix.
			const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
			if (digits !== e.target.value) e.target.value = digits;
			tab.pincode = digits;
			this._save_debounced();
		});

		// Village/City. Searched across the whole state, not one hardcoded
		// district — picking a village fills its pincode, and the pincode is
		// what the server turns into a district. So the counter types one
		// thing and the other two follow, and a customer from the next
		// district over is no longer invisible (2026-08-16 direct request).
		const $village = $root.find(".santu-si2-village");
		const $villageDD = $root.find(".santu-si2-village-dropdown");
		const $pincode = $root.find(".santu-si2-pincode");
		const search_village = santu_sale_invoice.utils.debounce((q) => {
			santu_sale_invoice.api.search_villages(q).then((rows) => {
				$villageDD.empty();
				if (!rows.length) {
					$villageDD.append(`<div class="santu-si2-village-empty">${__("No matches")}</div>`);
				}
				rows.forEach((r) => {
					const meta = [r.pincode, r.district].filter(Boolean).join(" · ");
					$(`<div class="santu-si2-village-row">${frappe.utils.escape_html(r.village)} <span>${frappe.utils.escape_html(meta)}</span></div>`)
						.on("click", () => {
							$village.val(r.village);
							tab.city = r.village;
							// Picking a village is an explicit choice, so its
							// pincode replaces whatever was there — the old
							// "only if empty" rule left a stale pincode behind
							// after correcting the village.
							if (r.pincode) {
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

		$root.find(".santu-si2-chip-more").on("click", () => {
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

	// Same dialog as the Items screen's "Adjust Stock", brought to the bill.
	// Posts a real Stock Reconciliation with a reason underneath — this is a
	// correction to the shop's books, not a display tweak, and it is recorded
	// as one.
	_edit_row_stock(row, $tr) {
		const current = Number(row.available_qty) || 0;
		const d = new frappe.ui.Dialog({
			title: __("Stock theek karein"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "head",
					options: `<div style="font-size:15px;margin-bottom:4px">
							<b>${frappe.utils.escape_html(row.item_name || row.item_code)}</b>
						</div>
						<div style="color:var(--text-muted)">${__("Abhi system me")}: ${current} ${frappe.utils.escape_html(row.uom || "")}</div>`,
				},
				{
					fieldtype: "Float",
					fieldname: "new_qty",
					label: __("Dukaan me sach me kitna hai?"),
					reqd: 1,
					default: current,
				},
				{
					fieldtype: "Select",
					fieldname: "reason",
					label: __("Kyun badla?"),
					reqd: 1,
					options: ["Count Correction", "Damage", "Theft", "Other"].join("\n"),
					default: "Count Correction",
				},
			],
			primary_action_label: __("Theek karein"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Stock theek kar rahe hain…"));
				santu_sale_invoice.api
					.set_item_stock(row.item_code, v.new_qty, v.reason)
					.then((r) => {
						frappe.dom.unfreeze();
						d.hide();
						row.available_qty = r.available_qty;
						this._render_body();
						frappe.show_alert({
							message: r.converted_to_stock_item
								? __("{0} ab stock me ginega — {1} {2}", [row.item_name || row.item_code, r.available_qty, r.uom || ""])
								: __("Stock theek kar diya — {0} {1}", [r.available_qty, r.uom || ""]),
							indicator: "green",
						});
					})
					.catch((err) => {
						frappe.dom.unfreeze();
						frappe.msgprint({
							title: __("Stock theek nahi ho paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						});
					});
			},
		});
		d.show();
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

			// "Available: 0" is where the shopkeeper NOTICES the stock is
			// wrong — mid-sale, customer waiting. Sending them to another
			// screen to fix it means abandoning the bill, so it is fixed
			// right here, the same way the Items screen does it.
			$tr.find("[data-stock-edit]").on("click", () => this._edit_row_stock(row, $tr));

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
				const opt = (row.uom_options || []).find((o) => (o.uom || o) === row.uom);
				const factor = (opt && flt_factor(opt.conversion_factor)) || 1;
				row.conversion_factor = factor;
				// One Box is `factor` pieces: it costs that much more, and the
				// shelf holds that many fewer of them.
				if (row.base_rate) row.rate = Math.round(row.base_rate * factor * 100) / 100;
				if (row.base_available_qty != null) row.available_qty = Math.floor((row.base_available_qty / factor) * 100) / 100;
				this._render_items();
				this._recalc_totals();
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
		// Bound here, once, and keyed off data-toolbar rather than data-action:
		// _bind_body_events re-binds every [data-action] on each body render, so
		// a button that lives in the persistent toolbar would collect one more
		// handler per render and toggle itself several times per click.
		this.$root.find('[data-toolbar="privacy"]').on("click", () => this._handle_action("privacy"));
		this._render_cost_toggle();
		// Privacy Mode switches itself back off on a shared timer owned by
		// kiosk_mode.js. Repaint when that happens, or the flag goes off behind
		// cost figures that stay on screen — which is what "auto cp show krna
		// band naa hua" was.
		if (this._on_privacy_change) document.removeEventListener("santu-privacy-mode-change", this._on_privacy_change);
		this._on_privacy_change = () => {
			this._render_items();
			this._render_cost_toggle();
		};
		document.addEventListener("santu-privacy-mode-change", this._on_privacy_change);
	},

	// Shows whether cost price is currently on, so it reads as a switch rather
	// than a button that seems to do nothing on a bill with no items yet.
	_render_cost_toggle() {
		const on = !!(window.santu_is_privacy_mode_active && santu_is_privacy_mode_active());
		const $btn = this.$root.find(".santu-si2-cost-toggle");
		$btn.toggleClass("is-on", on).attr(
			"title",
			on ? __("Cost price showing — click to hide") : __("Show cost price")
		);
		$btn.find(".santu-si2-ico").attr(
			"src",
			`${SANTU_SI2_ICON_DIR}/${on ? "unlock_icon.svg" : "lock-icon.svg"}`
		);
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
			Promise.resolve(window.santu_toggle_privacy_mode())
				.then(() => {
					this._render_items();
					this._render_cost_toggle();
					if (santu_is_privacy_mode_active && santu_is_privacy_mode_active()) {
						return this._load_cost_prices(tab).then(() => this._render_items());
					}
				});
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
		if (action === "report_bug") {
			this._report_bug(tab);
			return;
		}
	},

	// One line of text is all that is asked for. Which screen, which bill,
	// which version and the recent server errors are attached automatically —
	// a shop owner should never have to know what a "route" or a "traceback"
	// is in order to say that something is broken.
	_report_bug(tab) {
		const invoice = tab && tab.saved_invoice ? tab.saved_invoice.name : null;
		const d = new frappe.ui.Dialog({
			title: __("Kya gadbad hui?"),
			fields: [
				{
					fieldname: "what_happened",
					fieldtype: "Small Text",
					label: __("Apni bhasha me likh do — jaisa hua waisa"),
					reqd: 1,
				},
			],
			primary_action_label: __("Bhej do"),
			primary_action: (values) => {
				d.hide();
				santu_sale_invoice.api
					.report_bug(values.what_happened, invoice)
					.then(() =>
						frappe.msgprint({
							title: __("Mil gaya"),
							indicator: "green",
							message: __("Shukriya. Ye baat likh li gayi hai."),
						})
					)
					.catch(() =>
						frappe.msgprint({
							title: __("Bhej nahi paye"),
							indicator: "red",
							message: __("Ye baat abhi save nahi ho payi. Thodi der baad phir bataiye."),
						})
					);
			},
		});
		d.show();
	},

	_validate_before_save(tab) {
		const { name, phone } = this._get_inline_customer_fields();
		if (!tab.customer && !name && !phone) {
			frappe.msgprint(__("Please enter a party name or a phone number."));
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
			// Nothing typed and nobody selected means _ensure_customer_before_save
			// is about to invent a "Customer NNNN" placeholder — judge that name,
			// not the empty box, or the rule below never fires on the very case
			// it exists for.
			const displayName = (
				name ||
				d.customer_name ||
				tab.customer ||
				(phone ? this._default_customer_name(phone) : "")
			)
				.trim()
				.toLowerCase();
			if (displayName === "walk-in customer") {
				frappe.msgprint(__("Walk-in Customer cannot have an outstanding balance. Select or add a proper customer for a credit/baaki sale."));
				return false;
			}
			// A party auto-created from nothing but a phone number is a
			// placeholder, not someone you can chase for money — no real name,
			// no village. Selling to them for cash is fine; leaving baaki on
			// them is not, until the details are actually filled in
			// (2026-08-16 direct request).
			if (SANTU_SI2_AUTO_NAME_RE.test(displayName)) {
				frappe.msgprint(
					__("Fill in this customer's name and village before giving them baaki — right now only a phone number is on file.")
				);
				return false;
			}
			const hasPhone = phone || d.mobile_no || tab.phone;
			const hasVillage = d.city || tab.city;
			const missing = [];
			if (!hasPhone) missing.push(__("Phone Number"));
			if (!hasVillage) missing.push(__("Village / City"));
			if (missing.length) {
				frappe.msgprint(__("{0} required for {1} to have an outstanding balance (baaki).", [missing.join(" " + __("and") + " "), name || d.customer_name || tab.customer]));
				return false;
			}
		}
		return true;
	},

	// "Save & Print" used to open Frappe's print view, whose default format a
	// Property Setter had pointed at "GST Tax Invoice" — so the screen showed a
	// formal tax invoice while the counter's Epson printed the shop's thermal
	// bill. Two different documents from one button (2026-08-16 bug report:
	// "same print nh ho rha"). Send it to the very same thermal bill the
	// printer produces, so what is pressed is what comes out. If QZ Tray isn't
	// running, fall back to the print view rather than losing the print.
	_print_saved_bill(name, opts = {}) {
		const is_duplicate = opts.is_duplicate ? 1 : 0;

		// The ladder itself lives in thermal_print.js, shared by every screen
		// that prints a bill. It used to be duplicated here, and the copy was
		// the only one that got fixed when QZ Tray was dropped — leaving the
		// other six printing routes still going through the thing that lies
		// about having printed. One implementation, one behaviour.
		if (typeof window.santu_print_bill_ladder !== "function") {
			frappe.msgprint({
				title: __("Print nahi ho paya"),
				indicator: "red",
				message: __("Printing ka hissa load nahi hua. Page refresh karke dobara koshish karein."),
			});
			return Promise.resolve();
		}

		return window
			.santu_print_bill_ladder("Sales Invoice", name, { is_duplicate: is_duplicate })
			.then(({ method, job }) => {
				frappe.show_alert({ message: __("Printed"), indicator: "green" });
				this._ask_print_confirmation(job, name, method);
			})
			.catch(() => {
				// Every rung failed. Normally the bill itself is safe — it is
				// saved before any of this runs — and saying so is the most
				// useful thing here.
				//
				// But it must be CHECKED, never assumed. On 2026-08-17 this
				// message told the operator "bill save ho gaya hai, paisa aur
				// stock sab sahi hai" about an invoice that did not exist, on
				// a sale that had never been recorded. A wrong reassurance
				// about money is worse than no message at all.
				frappe.db
					.get_value("Sales Invoice", name, "docstatus")
					.then((r) => {
						const doc = r && r.message;
						const saved = doc && cint(doc.docstatus) === 1;
						frappe.msgprint({
							title: saved ? __("Print nahi ho paya") : __("Bill save NAHI hua"),
							indicator: "red",
							message: saved
								? __(
										"Bill {0} save ho gaya hai — paisa aur stock sab sahi hai. Sirf parchi nahi nikli. Utilities → Doctor Uncle kholkar jaanchein.",
										[name]
								  )
								: __(
										"Bill {0} kahin nahi mila — ye bikri abhi tak likhi NAHI gayi hai. Bill dobara banaiye. Paisa lene se pehle screen par bill number aana zaroori hai.",
										[name]
								  ),
						});
					})
					.catch(() => {
						frappe.msgprint({
							title: __("Print nahi ho paya"),
							indicator: "red",
							message: __(
								"Parchi nahi nikli, aur bill {0} ki jaanch bhi nahi ho payi. Sale Invoices list me dekh lijiye ki bill bana ya nahi.",
								[name]
							),
						});
					});
			});
	},

	// The printer reports a job as successful with an empty roll, so the only
	// reliable paper-out detector at this counter is the person standing at
	// it. One tap, and a bill that never came out stops being invisible.
	_ask_print_confirmation(job_name, invoice_name, method) {
		if (!job_name) return;
		const d = new frappe.ui.Dialog({
			title: __("Bill chhap gaya?"),
			primary_action_label: __("Haan, nikal gaya"),
			secondary_action_label: __("Nahi — dobara"),
			primary_action: () => {
				santu_sale_invoice.api.confirm_print_job(job_name, 1);
				d.hide();
			},
			secondary_action: () => {
				d.hide();
				santu_sale_invoice.api.confirm_print_job(job_name, 0);
				this._print_saved_bill(invoice_name, { is_duplicate: true });
			},
		});
		d.$body.append(
			`<div style="font-size:15px;line-height:1.7">
				<div>${__("Bill")}: <b>${frappe.utils.escape_html(invoice_name)}</b></div>
				<div style="color:var(--text-muted)">${__("Bheja gaya")}: ${frappe.utils.escape_html(method || "")}</div>
			</div>`
		);
		d.show();
		// Nobody should have to answer this to carry on selling. If the slip
		// came out — the normal case — the dialog gets out of the way on its
		// own and the job stays merely "Printed", not "Confirmed".
		setTimeout(() => {
			if (d.$wrapper && d.$wrapper.is(":visible")) d.hide();
		}, 20000);
	},

	// Cost price is fetched per row, and used to be fetched ONLY at the moment
	// an item was added and only if Privacy Mode happened to already be on. So
	// the normal order of work — ring up the items, then hit "Show Cost Price"
	// to check the margin — re-rendered rows that carried no cost at all and
	// showed nothing (2026-08-17 bug report). Fill in whatever is missing.
	_load_cost_prices(tab) {
		const rows = (tab.items || []).filter((r) => r.cost_price == null && r.item_code);
		if (!rows.length) return Promise.resolve();
		return Promise.all(
			rows.map((row) =>
				santu_sale_invoice.api
					.item_cost_price(row.item_code, this.init_data.warehouse)
					.then((c) => {
						row.cost_price = (c && c.cost_price != null) ? c.cost_price : c;
					})
					.catch(() => {})
			)
		);
	},

	// Grand total for any tab, not just the visible one. `_recalc_totals`
	// only ever computes the active tab and writes into the DOM, so it
	// cannot answer this question for a tab being checked in the background.
	_tab_grand_total(tab) {
		let net_total = 0;
		let tax_total = 0;
		(tab.items || []).forEach((row) => {
			this._row_local_recalc(row);
			net_total += row._net_amount || 0;
			tax_total += row._tax_amount || 0;
		});
		const pre_round = Math.max(net_total + tax_total - (Number(tab.additional_discount_amount) || 0), 0);
		return tab.round_off ? Math.round(pre_round) : pre_round;
	},

	// Is the bill this tab thinks it already saved still real, and still the
	// bill that is on screen? Answers "ok" | "gone" | "changed".
	//
	// "changed" is the one that actually cost a sale: the tab held a saved
	// bill for one amount while the operator had gone on adding items, so
	// Save & Print reprinted the old bill and the new items were never
	// recorded. Comparing the totals catches that.
	_check_saved_invoice(tab) {
		const saved = tab.saved_invoice;
		if (!saved || !saved.name) return Promise.resolve("gone");
		return frappe.db
			.get_value("Sales Invoice", saved.name, ["docstatus", "grand_total"])
			.then((r) => {
				const doc = r && r.message;
				if (!doc || !doc.docstatus || cint(doc.docstatus) === 2) return "gone";
				const on_screen = flt(this._tab_grand_total(tab));
				// Paise-level rounding differences are not a changed bill.
				if (Math.abs(flt(doc.grand_total) - on_screen) > 0.5) return "changed";
				return "ok";
			})
			.catch(() => {
				// Cannot tell — treat as still valid rather than risk cutting a
				// duplicate bill. Losing a reprint is recoverable; billing the
				// customer twice is not.
				return "ok";
			});
	},

	_save_sale(tab, action) {
		// Saving a tab that already produced a bill used to quietly cut a
		// SECOND one — same customer, same items, stock deducted twice and the
		// party billed twice. The Save button stays on screen after a save (so
		// does Ctrl+S), so this is one stray keypress at a busy counter.
		//
		// But the guard must not be taken on trust. It fired on 2026-08-17 for
		// a bill that had since been deleted AND whose items had changed on
		// screen: Save & Print skipped saving, tried to print a bill that no
		// longer existed, and the operator was told the sale was recorded when
		// nothing had been. A guard against double-billing must never become a
		// reason a real sale is lost — so check that the bill it is protecting
		// actually still exists and still matches what is on screen.
		if (tab.saved_invoice) {
			this._check_saved_invoice(tab).then((state) => {
				if (state === "gone" || state === "changed") {
					// Either way this tab is holding a bill it should not:
					// nothing to protect, so let the sale save normally.
					tab.saved_invoice = null;
					this._save_debounced();
					this._render_body();
					if (state === "changed") {
						frappe.show_alert({
							message: __("Bill badal gaya tha — naya bill banaya ja raha hai."),
							indicator: "orange",
						});
					}
					this._save_sale(tab, action);
					return;
				}
				if (action === "save_print") {
					this._print_saved_bill(tab.saved_invoice.name);
					return;
				}
				frappe.msgprint({
					title: __("Already saved"),
					indicator: "blue",
					message: __("This bill is already saved as {0}. Open a new tab (+) to start the next sale.", [
						tab.saved_invoice.name,
					]),
				});
			});
			return;
		}
		// frappe.dom.freeze() only puts an overlay on screen; it does not stop a
		// second save from being started (a fast double-click, Ctrl+S twice, or
		// an impatient tap on a phone all get through). Two submits landing
		// together deadlock on the naming series / ledger / Bin rows, which the
		// counter sees as "concurrent conflicting request".
		if (tab._saving) return;
		if (!this._validate_before_save(tab)) return;
		const submit = action !== "submit_draft" ? 1 : 0;

		tab._saving = true;
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
						conversion_factor: r.conversion_factor || 1,
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
				tab._saving = false;
				frappe.dom.unfreeze();
				if (!r) return;
				tab.saved_invoice = r;
				this._save_debounced();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				this._render_body();
				if (action === "save_print") {
					this._print_saved_bill(r.name);
				}
			})
			.catch((err) => {
				tab._saving = false;
				frappe.dom.unfreeze();
				// Anything that already told the counter what was wrong (the
				// validation paths above) just unfreezes. Everything else used
				// to vanish here: the screen unfroze, no bill was created and
				// nothing was said, so a counter could hand over goods against
				// a sale that never saved. Say it out loud instead.
				if (err && err.santu_handled) return;
				const detail = (err && (err.message || err._error_message)) || "";
				frappe.msgprint({
					title: __("Sale not saved"),
					indicator: "red",
					message: detail
						? __("The bill was not saved: {0}", [detail])
						: __("The bill was not saved. Please try again."),
				});
				console.error("santu: save failed", err);
			});
	},

	_send_whatsapp(tab) {
		if (!tab.saved_invoice) return;
		window.santu_whatsapp_share.send_transaction("Sales Invoice", tab.saved_invoice.name);
	},
};
