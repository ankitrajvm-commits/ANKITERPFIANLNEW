/* global frappe, santu_purchase_invoice, santu_party_inline */
// Santu Hardware — Purchase Invoice screen (2026-08-15 direct request: reuse
// the exact same quick-entry UI/UX as the Sale Invoice screen, instead of
// ERPNext's native New Purchase Invoice form). Backs onto a real Purchase
// Invoice via santu_hardware.santu_hardware.api.save_purchase_invoice —
// multi-tab shell is purely client-side (localStorage), no draft documents
// are created while a purchase is in progress. Deliberately kept structured
// identically to santu_sale_invoice.js (Customer -> Supplier, selling ->
// buying) — see that file for the fuller design notes this mirrors.
frappe.pages["santu-purchase-invoice"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
			"/assets/santu_hardware/js/santu_party_inline/santu_party_inline.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Purchase", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_purchase_pos.init(page);
		}
	);
};

// "Create Purchase Invoice" (from Purchase Order, santu_purchase_transactions.js)
// hands off the mapped-but-unsaved doc here via frappe.route_options.prefill
// instead of trying to view it — see the matching note in
// santu_sales_order.js for why (get_invoice_view_data only knows real saved
// documents; frappe.model.open_mapped_doc also needs a real frm object,
// which there isn't one of on a plain list row).
frappe.pages["santu-purchase-invoice"].on_page_show = function () {
	const prefill = frappe.route_options && frappe.route_options.prefill;
	const prefill_bills = frappe.route_options && frappe.route_options.prefill_bills;
	if ((prefill || prefill_bills) && window.santu_purchase_pos && santu_purchase_pos.page && santu_purchase_pos.init_data) {
		frappe.route_options = null;
		if (prefill_bills) santu_purchase_pos._apply_prefill_bills(prefill_bills);
		else santu_purchase_pos._apply_prefill(prefill);
		return;
	}
	if (window.santu_purchase_pos && santu_purchase_pos.page) santu_purchase_pos.render();
};

const SANTU_PI2_STORAGE_KEY = "santu_purchase_pos_tabs_v1";

// `window.` par hona zaroori hai: isi file ka on_page_show
// `window.santu_purchase_pos` dekhkar prefill chalata hai. Bare `const`
// window par nahi aata, isliye Estimate se Order/Bill banane par kuch
// hota hi nahi tha -- chup-chaap khaali screen (2026-10-01).
window.santu_purchase_pos = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._save_debounced = santu_purchase_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		Promise.all([santu_purchase_invoice.api.init(), santu_purchase_invoice.api.tax_options()]).then(([data, tax_options]) => {
			this.init_data = data;
			this.tax_options = tax_options || [];
			const prefill = frappe.route_options && frappe.route_options.prefill;
			const prefill_bills = frappe.route_options && frappe.route_options.prefill_bills;
			frappe.route_options = null;
			if (prefill_bills) {
				this._apply_prefill_bills(prefill_bills);
				return;
			}
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
			const raw = localStorage.getItem(SANTU_PI2_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
				this.tabs = parsed.tabs;
				this.active_id = parsed.active_id && this.tabs.some((t) => t.id === parsed.active_id)
					? parsed.active_id
					: this.tabs[0].id;
			}
		} catch (e) {
			this.tabs = [];
		}
	},
	_persist() {
		try {
			localStorage.setItem(
				SANTU_PI2_STORAGE_KEY,
				JSON.stringify({ tabs: this.tabs, active_id: this.active_id })
			);
		} catch (e) {
			// storage full/unavailable — purchase still works, just not refresh-safe
		}
	},

	_default_place_of_supply() {
		const options = this.init_data.place_of_supply_options || [];
		return options.find((o) => o.toLowerCase().includes("bihar")) || null;
	},

	_blank_tab() {
		return {
			id: santu_purchase_invoice.utils.uid(),
			label: null,
			supplier: null,
			supplier_details: null,
			phone: "",
			address: "",
			payment_mode: "credit",
			mode_of_payment: (this.init_data.payment_modes[0] || {}).name || null,
			paid_amount: null,
			items: [],
			additional_discount_amount: 0,
			round_off: true,
			place_of_supply: this._default_place_of_supply(),
			bill_no: "",
			posting_date: this.init_data.posting_date,
			terms: "",
			description: "",
			held: false,
			saved_invoice: null,
			// Applied to every new row added after this is changed — the
			// "whatever bracket most of this bill is" shortcut (2026-08-18:
			// "top pe default tax ka v option de do jitna v tax bracket h").
			// A row can still be set to something else individually.
			default_tax_template: null,
		};
	},

	_new_tab(focus) {
		const t = this._blank_tab();
		this.tabs.push(t);
		if (focus !== false) this.active_id = t.id;
		this._save_debounced();
		return t;
	},

	// Builds a fresh tab from a mapped-but-unsaved doc (Purchase Order's
	// "Create Purchase Invoice", or a PDF bill read by Upload Bill) — see
	// the matching method in santu_sales_order.js for why items are
	// re-looked-up via item_row() rather than trusting the mapped doc's
	// own shape. Shared by both the single-bill (route prefill) and
	// multi-bill (Upload Bill, several invoices in one PDF) entry points
	// below — each just decides what to do with the finished tab.
	_build_tab_from_prefill(doc) {
		const tab = this._blank_tab();
		tab.supplier = doc.supplier || null;
		tab.place_of_supply = doc.place_of_supply || tab.place_of_supply;
		if (doc.terms) tab.terms = doc.terms;
		if (doc.bill_no) tab.bill_no = doc.bill_no;
		if (doc.bill_date) {
			tab.posting_date = doc.bill_date;
			tab.date_set_on = frappe.datetime.get_today(); // supplier's own bill date: keep it
		}
		tab.additional_discount_amount = doc.discount_amount || 0;

		const item_promises = (doc.items || []).map((r) =>
			santu_purchase_invoice.api.item_row(tab.supplier, r.item_code, this.init_data.warehouse, r.qty, r.uom).then((row) => {
				tab.items.push({
					id: santu_purchase_invoice.utils.uid(),
					item_code: r.item_code,
					// `description` is what the bill itself printed, and for a row
					// that matched nothing in the catalog it is the only name there
					// is (2026-09-04) — without it such a row rendered blank, throwing
					// away the one thing the PDF was read for. A matched row still
					// prefers the catalog's own name. (The duplicate `item_name` key
					// this replaces was dead — the second silently won.)
					item_name: row.item_name || r.item_name || r.description || r.item_code,
					// Size as the bill printed it ("24X200ML", "5KG"), carried as
					// its own field rather than left buried inside the name.
					size: r.size || null,
					qty: r.qty,
					// Box for a pack-sized item read off a bill (2026-08-17:
					// "200ml ka 24 pcs, same for all") — this is what makes
					// qty × conversion_factor land the right piece count in
					// stock, not the printed carton count.
					uom: r.uom || row.uom || row.stock_uom,
					uom_options: row.uom_options || [row.uom || row.stock_uom],
					// ERPNext ka `rate` discount ke BAAD ka hota hai (price_list_rate
					// minus discount). Purchase Order se aaye row me rate ke saath
					// discount bhi copy karne par wo dobara ghat jata tha -- wahi
					// galti Billing me mili thi (2026-10-01). PDF se padhi bill me
					// price_list_rate hota hi nahi, wahan discount jaisa tha waisa
					// rehta hai.
					rate: r.rate,
					discount_percentage: r.price_list_rate ? 0 : (r.discount_percentage || 0),
					discount_amount: r.price_list_rate ? 0 : (r.discount_amount || 0),
					item_tax_template: row.item_tax_template || tab.default_tax_template || null,
					tax_rate: row.tax_rate || this._tax_rate_for_template(row.item_tax_template || tab.default_tax_template),
					barcode: row.barcode || null,
					amount: r.amount || r.qty * r.rate,
				});
			})
		);

		const supplier_promise = tab.supplier
			? santu_purchase_invoice.api.supplier_details(tab.supplier).then((d) => {
					tab.supplier_details = d;
			  })
			: Promise.resolve();

		return Promise.all([supplier_promise, ...item_promises]).then(() => tab);
	},

	_apply_prefill(doc) {
		this._build_tab_from_prefill(doc).then((tab) => {
			this.tabs.push(tab);
			this.active_id = tab.id;
			this._save_debounced();
			this.render();
		});
	},

	// One tab per bill a scanned PDF turned out to contain (2026-08-17
	// direct request: "upload pdf bill me jo ui aata hia, us ui ko vyapaar
	// type bana do") — the review-and-edit screen after a bill scan is now
	// this exact same Purchase screen, not a separate dialog with its own
	// look. Usually one tab (one bill); a PDF bundling several invoices
	// opens all of them at once, switchable the same way any other
	// multi-tab purchase already is.
	_apply_prefill_bills(bills) {
		Promise.all(bills.map((doc) => this._build_tab_from_prefill(doc))).then((tabs) => {
			this.tabs.push(...tabs);
			this.active_id = tabs[0].id;
			this._save_debounced();
			this.render();
		});
	},

	_active_tab() {
		return this.tabs.find((t) => t.id === this.active_id) || this.tabs[0];
	},

	_tab_label(tab, idx) {
		return tab.label || `Purchase #${idx + 1}`;
	},

	_tab_is_empty(tab) {
		return !tab.supplier && !tab.items.length && !tab.saved_invoice;
	},

	// ---------- top-level render ----------
	// A tab left open (or restored from localStorage) from an earlier day
	// kept that day's date, so a sale/payment made today was booked on the
	// old date -- Payment In showed 06/09 on 19/09 (2026-09-19). Billing,
	// Estimate and Returns already roll forward; this does the same, but a
	// date the user picked by hand TODAY (date_set_on) is left alone.
	_roll_dates_forward() {
		const today = frappe.datetime.get_today();
		let changed = false;
		(this.tabs || []).forEach((t) => {
			if (t.saved || t.editing || t.saved_challan || t.saved_doc || t.saved_invoice) return;
			if (t.posting_date && t.posting_date < today && (t.date_set_on || "") < today) {
				t.posting_date = today;
				changed = true;
			}
		});
		if (changed && this._persist) this._persist();
	},

	render() {
		if (!this.tabs.length) this._new_tab();
		this._roll_dates_forward();
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
		this._listen_for_scans();
	},

	// Scanning matters more on a purchase than on a sale: goods arrive in a
	// carton, and every one of them has to be found in the catalogue and
	// typed in. Scanning is also where a barcode gets ATTACHED — the box is
	// in your hand, which is the only moment the code and the item are
	// unambiguously the same thing.
	_listen_for_scans() {
		if (!window.santu_barcode) return;
		window.santu_barcode.listen((code) => this._handle_scan(code), "santu-purchase-invoice");
	},

	_handle_scan(code) {
		frappe
			.xcall("santu_hardware.santu_hardware.api.find_item_by_barcode", { barcode: code })
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
				frappe
					.xcall("santu_hardware.santu_hardware.api.attach_barcode_to_item", {
						item_code: v.item_code,
						barcode: code,
					})
					.then(() => {
						d.hide();
						this._add_item(v.item_code);
						frappe.show_alert({
							message: __("Barcode laga diya — aur bill me jud gaya"),
							indicator: "green",
						});
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
				this._quick_create_item("", { barcode: code });
			},
		});
		d.show();
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
		$(`<button type="button" class="santu-si2-tab-add" title="New Purchase (Ctrl+N)">+</button>`)
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
			__("This purchase has unsaved items. Close anyway?"),
			finish
		);
	},

	// ---------- body ----------
	_render_body() {
		const tab = this._active_tab();
		const $wrap = this.$root.find(".santu-si2-body");
		$wrap.html(`
			<div class="santu-si2-header">
				<div class="santu-si2-header-title">Purchase</div>
				<div class="santu-si2-mode">
					<span class="santu-si2-mode-label${tab.payment_mode === "credit" ? " is-active" : ""}" data-mode="credit">Credit</span>
					<label class="santu-si2-switch">
						<input type="checkbox" class="santu-si2-mode-input" ${tab.payment_mode === "cash" ? "checked" : ""}>
						<span class="santu-si2-slider"></span>
					</label>
					<span class="santu-si2-mode-label${tab.payment_mode === "cash" ? " is-active" : ""}" data-mode="cash">Cash</span>
				</div>
				${
					tab.payment_mode === "cash"
						? `<select class="santu-si2-mop">${(this.init_data.payment_modes || [])
								.map((m) => `<option value="${frappe.utils.escape_html(m.name)}" ${m.name === tab.mode_of_payment ? "selected" : ""}>${frappe.utils.escape_html(m.name)}</option>`)
								.join("")}</select>
							<label class="santu-si2-paid-now-label">Paid Now
								<input type="number" class="santu-si2-paid-now" min="0" step="any" placeholder="Full amount" value="${tab.paid_amount != null ? tab.paid_amount : ""}">
							</label>
							<span class="santu-si2-remaining-note" style="display:none;"></span>`
						: ""
				}
			</div>

			<div class="santu-si2-toprow">
				<div class="santu-si2-customer-col">
					${santu_party_inline.fields_html({ placeholder: "Party Name *" })}
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
						<span class="santu-si2-inv-label">Supplier Bill No.</span>
						<input type="text" class="santu-si2-bill-no" placeholder="As printed on their bill" value="${frappe.utils.escape_html(tab.bill_no || "")}">
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
					<!-- Applied to every row added from here on, not a retroactive
					     bulk-edit — a row someone already picked a different bracket
					     for keeps it (2026-08-18: "top pe default tax ka v option de
					     do jitna v tax bracket h"). -->
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Default Tax</span>
						<select class="santu-si2-default-tax">
							<option value="">${__("None")}</option>
							${(this.tax_options || [])
								.map((o) => `<option value="${frappe.utils.escape_html(o.value)}" ${o.value === tab.default_tax_template ? "selected" : ""}>${frappe.utils.escape_html(o.label)}</option>`)
								.join("")}
						</select>
					</div>
				</div>
			</div>

			<div class="santu-si2-table-wrap">
				<!-- Only the table scrolls sideways: the item-search dropdown is a
				     child of the WRAP, so it must stay outside this box or it gets
				     clipped (that bug made searching look like it found nothing). -->
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
				</div>
			</div>

			<div class="santu-si2-actionbar">
				<div class="santu-si2-actionbar-left">
					<button type="button" class="santu-si2-btn santu-si2-btn-hold" data-action="hold">Hold Purchase <span class="santu-si2-kbd">F9</span></button>
					${
						tab.saved_invoice
							? `<button type="button" class="santu-si2-btn" data-action="whatsapp">Send on WhatsApp</button>`
							: ""
					}
					<div class="santu-si2-more-wrap">
						<button type="button" class="santu-si2-btn" data-action="more">More ▾</button>
						<div class="santu-si2-more-menu" style="display:none;">
							<button type="button" data-more="payment">Payment</button>
							<button type="button" data-more="purchase_return">Purchase Return</button>
							<button type="button" data-more="submit_draft">Save as Draft (don't submit)</button>
						</div>
					</div>
				</div>
				<div class="santu-si2-actionbar-right">
					<button type="button" class="santu-si2-btn" data-action="share">Share ▾</button>
					<!-- Same three actions every other document screen has, and
					     the same rule: pressing one IS the answer, nothing asks
					     again afterwards (2026-09-07). -->
					<button type="button" class="santu-si2-btn" data-action="save_whatsapp">💬 Send WhatsApp</button>
					<button type="button" class="santu-si2-btn" data-action="save_whatsapp_other">↗ Kisi aur ko</button>
					<button type="button" class="santu-si2-btn" data-action="save_print">🖨️ Save &amp; Print</button>
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_items();
		this._render_customer_info();
		this._bind_body_events();
	},

	// ---------- supplier (inline party fields via santu_party_inline) ----------
	_party_ctx() {
		return santu_party_inline.make_ctx(this, santu_party_inline.SUPPLIER, {
			ddNamespace: "santu-pi-dd",
		});
	},

	_render_customer_info() {
		santu_party_inline.render_info(this._party_ctx());
	},

	_customer_search(q) {
		santu_party_inline.run_search(this._party_ctx(), q);
	},

	_select_customer(name) {
		const tab = this._active_tab();
		const supplier_changed = tab.supplier !== name;
		santu_party_inline.select_party(this._party_ctx(), name, {
			onSelected: () => {
				if (supplier_changed && tab.items.length) this._refresh_row_taxes();
				else this._render_customer_info();
			},
		});
	},

	_open_add_party_dialog(name) {
		santu_party_inline.open_advanced_dialog(this._party_ctx(), name);
	},

	// Editing an EXISTING supplier's GSTIN, not creating a new one — a
	// separate small dialog rather than routing through open_add_party_dialog,
	// which always calls create_supplier_full and would collide with
	// "A supplier named … already exists" for the very supplier being fixed.
	_open_gstin_dialog(supplier) {
		const d = new frappe.ui.Dialog({
			title: __("{0} ka GSTIN", [supplier]),
			fields: [
				{
					fieldtype: "Data",
					fieldname: "gstin",
					label: "GSTIN",
					description: __("15 akshar ka GST number, bill ke upar likha rehta hai."),
				},
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				const gstin = (v.gstin || "").trim();
				if (!gstin) {
					frappe.msgprint(__("GSTIN daalein."));
					return;
				}
				santu_purchase_invoice.api.update_supplier_inline_gstin(supplier, gstin).then(() => {
					d.hide();
					frappe.show_alert({ message: __("GSTIN save ho gaya"), indicator: "green" });
					this._render_customer_info();
				});
			},
		});
		d.show();
	},

	_ensure_party_before_save(tab) {
		const ctx = this._party_ctx();
		ctx.tab = tab;
		return santu_party_inline.ensure_before_save(ctx);
	},

	_refresh_row_taxes() {
		const tab = this._active_tab();
		const rows = tab.items.filter((r) => r.item_code);
		if (!rows.length) return Promise.resolve();
		return Promise.all(
			rows.map((row) =>
				santu_purchase_invoice.api
					.item_row(tab.supplier, row.item_code, this.init_data.warehouse, row.qty)
					.then((r) => {
						row.tax_rate = r.tax_rate || 0;
					})
					.catch(() => {})
			)
		).then(() => {
			this._save_debounced();
			this._render_items();
		});
	},

	// ---------- items ----------
	_render_items({ reveal_row_id = null } = {}) {
		const tab = this._active_tab();
		const $tbody = this.$root.find(".santu-si2-table tbody");
		$tbody.empty();

		if (!tab.items.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="9">No items yet — search above or press F4.</td></tr>`).appendTo($tbody);
		}

		tab.items.forEach((row, idx) => {
			const row_hl = santu_item_row_class(row.item_code, row.item_name);
			const $tr = $(`
				<tr data-row="${row.id}" class="${row.id === reveal_row_id ? "santu-bill-row-new" : ""} ${row_hl}">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-si2-col-item">
						<div class="santu-si2-item-name">
							${frappe.utils.escape_html(row.item_name || row.item_code)}
							<button type="button" class="santu-si2-item-edit" title="${__("Naam, category, HSN edit karein")}">✎</button>
						</div>
						<div class="santu-si2-item-sub">
							<!-- Size exactly as the supplier's bill printed it (2026-09-04
							     direct request: "size kya hia, qty kya hia md all"). Shown
							     only when the PDF actually carried one — never guessed. -->
							${row.size ? `<span class="santu-si2-item-size">${frappe.utils.escape_html(row.size)}</span>` : ""}
							${row.available_qty != null ? `<span class="${row.available_qty <= 0 ? "santu-si2-stock-out" : row.available_qty <= 5 ? "santu-si2-stock-low" : "santu-si2-stock-ok"}">In Stock: ${row.available_qty} ${frappe.utils.escape_html(santu_uom.abbr(row.uom) || "")}</span>` : ""}
							<!-- Per-row, not just the page-wide scanner: an item read
							     off a PDF bill or picked from search very often has no
							     barcode yet, and the whole point of scanning is that
							     it works next time (2026-08-17 direct request: "harek
							     item pe barcode scanner hoga... jaha pehle se added na
							     ho... to barcode se v add kr le"). edit_row_barcode()
							     replaces this span with an input, in place. -->
							<span class="santu-si2-row-barcode" title="${__("Barcode lagane ya badalne ke liye dabaiye")}">${
								row.barcode
									? `▮▯▮ ${frappe.utils.escape_html(row.barcode)}`
									: `<span class="santu-si2-row-no-barcode">${__("+ barcode")}</span>`
							}</span>
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
							<option value="__new__">${__("+ Naya Unit")}</option>
						</select>
					</td>
					<td class="santu-si2-col-rate">
						<input type="number" class="santu-si2-rate-input" value="${row.rate}" min="0" step="any" ${row.can_edit_rate === false ? "disabled" : ""}>
					</td>
					<td class="santu-si2-col-disc">
						<input type="number" class="santu-si2-disc-pct-input" value="${row.discount_percentage || ""}" min="0" max="100" step="any" placeholder="%">
						<input type="number" class="santu-si2-disc-amt-input" value="${row.discount_amount || ""}" min="0" step="any" placeholder="₹">
					</td>
					<!-- A real dropdown of this shop's own GST slabs, not a
					     read-only estimate (2026-08-18 direct request: "harek
					     item me tax daalne ka option de de") — save now sends
					     item_tax_template through, so this actually posts to
					     the invoice's real tax lines. -->
					<td class="santu-si2-col-tax">
						<select class="santu-si2-tax-select">
							<option value="">${__("NONE")}</option>
							${(this.tax_options || [])
								.map((o) => `<option value="${frappe.utils.escape_html(o.value)}" ${o.value === row.item_tax_template ? "selected" : ""}>${frappe.utils.escape_html(o.label)}</option>`)
								.join("")}
						</select>
					</td>
					<td class="santu-si2-col-amount santu-si2-figures santu-si2-row-amount">₹ ${santu_purchase_invoice.utils.format_money(row.amount || 0).replace("₹ ", "")}</td>
					<td class="santu-si2-col-remove"><button type="button" class="santu-si2-row-remove" title="Remove">🗑</button></td>
				</tr>
			`);
			$tbody.append($tr);
		});

		this._bind_item_row_events();
		this._recalc_totals();
		// Naya row apne aap dikhe -- niche se dhoondhna na pade. In screens
		// ka grid apne scroll box me nahi hai, isliye helper khud page ko
		// scroll karta hai (santu_scroll_row_into_view ka fallback).
		if (reveal_row_id) window.santu_scroll_row_into_view(this.$root, { row_id: reveal_row_id });
	},

	_item_search(q, $anchor) {
		// "5x tee" / "5* tee" -> 5 tee (santu_qty_prefix.js)
		const parsed = santu_qty.split(q);
		this._pending_qty = parsed.qty;
		if (parsed.qty) q = parsed.text;
		let $dd = this.$root.find(".santu-si2-item-dropdown");
		if (!$dd.length) {
			$dd = $(`<div class="santu-si2-item-dropdown" style="display:none;"></div>`).appendTo(this.$root.find(".santu-si2-table-wrap"));
		}
		if (!q) {
			santu_purchase_invoice.api.recent_items().then((rows) => this._render_item_dropdown($dd, rows, "Recent Items"));
			return;
		}
		santu_purchase_invoice.api.search_items(q).then((r) => this._render_item_dropdown($dd, r.results || [], null, q));
	},

	_render_item_dropdown($dd, rows, heading, query) {
		$dd.empty();
		if (this._pending_qty) $dd.append(santu_qty.hint_html(this._pending_qty, "santu-si2-dd-row"));
		if (heading) $dd.append(`<div class="santu-si2-dd-heading">${heading}</div>`);
		if (!rows.length) {
			$dd.append(`<div class="santu-si2-dd-empty">No items found.</div>`);
		}
		rows.forEach((item) => {
			$(`
				<div class="santu-si2-dd-row santu-si2-item-dd-row ${santu_item_dd_class(item.item_code, item.item_name)}">
					<div>
						<b>${frappe.utils.escape_html(item.item_name)}</b>
						<span class="santu-si2-dd-sub">${frappe.utils.escape_html(item.item_code)}${item.brand ? " · " + frappe.utils.escape_html(item.brand) : ""}</span>
					</div>
					<div class="santu-si2-dd-right">
						<span class="santu-si2-stock-ok">${item.available_qty != null ? item.available_qty + " " + santu_uom.abbr(item.stock_uom || "") : ""}</span>
						<span class="santu-si2-figures">₹ ${santu_purchase_invoice.utils.format_money(item.price || 0).replace("₹ ", "")}</span>
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
				{
					fieldtype: "Data",
					fieldname: "barcode",
					label: __("Barcode"),
					default: opts.barcode || "",
					description: __("Scan kiya hua code — agli baar scan karte hi ye saman aa jayega."),
					read_only: opts.barcode ? 1 : 0,
				},
				{ fieldtype: "Currency", fieldname: "purchase_price", label: __("Kharid ka daam"), reqd: 1 },
				{
					fieldtype: "Link",
					fieldname: "gst_hsn_code",
					options: "GST HSN Code",
					label: __("HSN code"),
					description: __("Bill pe likha rehta hai. Pehle se koi saman ho to khali chhod sakte hain."),
				},
			],
			primary_action_label: __("Banao aur bill me daalo"),
			primary_action: (v) => {
				santu_purchase_invoice.api
					.quick_create_item(v.item_name, v.purchase_price, {
						barcode: v.barcode || undefined,
						gst_hsn_code: v.gst_hsn_code || undefined,
					})
					.then((r) => {
						d.hide();
						this._add_item(r.item_code);
					})
					.catch((err) =>
						frappe.msgprint({
							title: __("Saman nahi ban paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						})
					);
			},
		});
		d.show();
	},

	_tax_rate_for_template(template) {
		if (!template) return 0;
		const opt = (this.tax_options || []).find((o) => o.value === template);
		const m = opt && opt.label.match(/(\d+(?:\.\d+)?)%/);
		return m ? Number(m[1]) : 0;
	},

	_add_item(item_code) {
		// "5x tee" typed in search -> 5, else 1 (santu_qty_prefix.js)
		const add_qty = santu_qty.take(this);
		const tab = this._active_tab();
		this.$root.find(".santu-si2-item-dropdown").hide();
		this.$root.find(".santu-si2-item-search").val("");

		const existing = tab.items.find((r) => r.item_code === item_code);
		if (existing) {
			existing.qty = (Number(existing.qty) || 0) + add_qty;
			this._recompute_row(existing).then(() => this._render_items({ reveal_row_id: existing.id }));
			return;
		}

		santu_purchase_invoice.api.item_row(tab.supplier, item_code, this.init_data.warehouse, add_qty).then((row) => {
			const new_row = {
				id: santu_purchase_invoice.utils.uid(),
				item_code,
				item_name: row.item_name || item_code,
				qty: add_qty,
				uom: row.uom || row.stock_uom,
				uom_options: row.uom_options || [row.uom || row.stock_uom],
				rate: row.price_list_rate || row.rate || 0,
				discount_percentage: 0,
				discount_amount: 0,
				// The item's own tax slab if it has one; otherwise whatever
				// this invoice's Default Tax is currently set to (2026-08-18:
				// "top pe default tax ka v option de do") — a fresh row
				// should not silently start at "no tax" just because nobody
				// has told this particular item its GST rate yet.
				item_tax_template: row.item_tax_template || tab.default_tax_template || null,
				tax_rate: row.tax_rate || this._tax_rate_for_template(row.item_tax_template || tab.default_tax_template),
				available_qty: row.available_qty,
				barcode: row.barcode || null,
				can_edit_rate: !(frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager")),
				amount: row.price_list_rate || row.rate || 0,
			};
		tab.items.push(new_row);
			this._save_debounced();
			this._render_items({ reveal_row_id: new_row.id });
		});
	},

	_recompute_row(row) {
		const tab = this._active_tab();
		return santu_purchase_invoice.api.item_row(tab.supplier, row.item_code, this.init_data.warehouse, row.qty, row.uom).then((r) => {
			row.available_qty = r.available_qty;
			row.barcode = r.barcode || null;
			// uom_options is owned by santu_uom (the full list); the server's
			// shorter reply must not shrink it back to one or two units.
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
		this.$root.find(".santu-si2-total-amount").text("₹ " + santu_purchase_invoice.utils.format_money(net_total + tax_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-subtotal").text("₹ " + santu_purchase_invoice.utils.format_money(net_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-tax").text("₹ " + santu_purchase_invoice.utils.format_money(tax_total).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-roundoff").text("₹ " + santu_purchase_invoice.utils.format_money(round_off_amount).replace("₹ ", ""));
		this.$root.find(".santu-si2-sum-total").text("₹ " + santu_purchase_invoice.utils.format_money(rounded).replace("₹ ", ""));
		tab.items.forEach((row) => {
			this.$root
				.find(`tr[data-row="${row.id}"] .santu-si2-row-amount`)
				.text("₹ " + santu_purchase_invoice.utils.format_money(row.amount).replace("₹ ", ""));
		});

		if (tab.payment_mode === "cash") {
			const $paidInput = this.$root.find(".santu-si2-paid-now");
			$paidInput.attr("placeholder", "Full amount: ₹ " + santu_purchase_invoice.utils.format_money(rounded).replace("₹ ", ""));
			const $note = this.$root.find(".santu-si2-remaining-note");
			const paid = tab.paid_amount == null ? rounded : Number(tab.paid_amount) || 0;
			const remaining = Math.max(rounded - paid, 0);
			if (tab.paid_amount != null && remaining > 0) {
				$note
					.text("Remaining ₹ " + santu_purchase_invoice.utils.format_money(remaining).replace("₹ ", "") + " will be added to the supplier's account")
					.show();
			} else {
				$note.hide();
			}
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
			santu_purchase_pos._save_debounced();
			santu_purchase_pos._render_body();
		});
		$root.find(".santu-si2-mop").on("change", (e) => {
			tab.mode_of_payment = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-paid-now").on(
			"input",
			santu_purchase_invoice.utils.debounce((e) => {
				const v = e.target.value;
				tab.paid_amount = v === "" ? null : Math.max(Number(v) || 0, 0);
				this._save_debounced();
				this._recalc_totals();
			})
		);

		const $custSearch = $root.find(".santu-si2-customer-search");
		$custSearch.on(
			"input",
			santu_purchase_invoice.utils.debounce((e) => this._customer_search(e.target.value))
		);
		$custSearch.on("focus", (e) => {
			if (e.target.value) this._customer_search(e.target.value);
		});
		$(document)
			.off("click.santu-pi2-dd")
			.on("click.santu-pi2-dd", (e) => {
				if (!$(e.target).closest(".santu-si2-customer-search-wrap, .santu-si2-item-search-wrap, .santu-si2-item-dropdown").length) {
					$root.find(".santu-si2-customer-dropdown, .santu-si2-item-dropdown").hide();
				}
			});
		$root.find(".santu-si2-phone").on("change", (e) => {
			tab.phone = e.target.value;
			this._save_debounced();
		});

		$root.find(".santu-si2-bill-no").on("input", (e) => {
			tab.bill_no = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-posting-date").on("change", (e) => {
			tab.posting_date = e.target.value;
			tab.date_set_on = frappe.datetime.get_today();
			this._save_debounced();
		});
		$root.find(".santu-si2-place-of-supply").on("change", (e) => {
			tab.place_of_supply = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-default-tax").on("change", (e) => {
			tab.default_tax_template = e.target.value || null;
			// Applies to the whole bill in one shot — every existing row
			// gets this tax so the operator doesn't have to set each row
			// individually. Per-row selects still work fine after this,
			// for the odd item that needs a different rate.
			const opt = (this.tax_options || []).find((o) => o.value === tab.default_tax_template);
			const m = opt && opt.label.match(/(\d+(?:\.\d+)?)%/);
			const tax_rate = m ? Number(m[1]) : 0;
			(tab.items || []).forEach((row) => {
				row.item_tax_template = tab.default_tax_template;
				row.tax_rate = tax_rate;
			});
			this._save_debounced();
			this._render_items();
			this._recalc_totals();
		});

		$root.find(".santu-si2-add-row, .santu-si2-scan-row").on("click", () => this._open_item_search_inline());

		$root.find(".santu-si2-add-discount").on(
			"input",
			santu_purchase_invoice.utils.debounce((e) => {
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
				<input type="text" class="santu-si2-item-search" placeholder="Search item name, code, brand… (F4)" autocomplete="off">
			</div>
		`);
		this.$root.find(".santu-si2-table-wrap").prepend($wrap);
		const $input = $wrap.find(".santu-si2-item-search");
		$input.trigger("focus");
		$input.on(
			"input",
			santu_purchase_invoice.utils.debounce((e) => this._item_search(e.target.value.trim()))
		);
		$input.on("focus", () => this._item_search($input.val().trim()));
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				const typed = santu_qty.split($input.val().trim());
				this._pending_qty = typed.qty;
				const q = typed.qty ? typed.text : $input.val().trim();
				if (!q) return;
				santu_purchase_invoice.api.search_items(q).then((r) => {
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
			});
			santu_uom.fill_select($tr.find(".santu-si2-uom-select"), row.item_code, row.uom, {
				extra_html: `<option value="__new__">${__("+ Naya Unit")}</option>`,
				on_ready: (opts) => (row.uom_options = opts),
			});
			$tr.find(".santu-si2-uom-select").on("change", (e) => {
				if (e.target.value === "__new__") {
					// Reset the visible select back to the current unit while
					// the dialog is open — otherwise it's left showing "+ Naya
					// Unit" as if that were now the row's actual unit.
					e.target.value = row.uom;
					this._add_custom_uom(row, $tr);
					return;
				}
				// Rescale qty/rate with the unit (santu_uom) -- switching a
				// 2 Kg line to Gram used to leave it as "2", i.e. 2 grams.
				santu_uom.convert(row, e.target.value, row.uom_options);
				this._recompute_row(row).then(() => {
					this._render_items();
					this._recalc_totals();
					on_change();
				});
			});
			$tr.find(".santu-si2-tax-select").on("change", (e) => {
				row.item_tax_template = e.target.value || null;
				const opt = (this.tax_options || []).find((o) => o.value === row.item_tax_template);
				const m = opt && opt.label.match(/(\d+(?:\.\d+)?)%/);
				row.tax_rate = m ? Number(m[1]) : 0;
				on_change();
			});
			$tr.find(".santu-si2-item-edit").on("click", (e) => {
				e.stopPropagation();
				this._edit_item_master(row, $tr);
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
			$tr.find(".santu-si2-row-barcode").on("click", (e) => {
				e.stopPropagation();
				this._edit_row_barcode($(e.currentTarget), row);
			});
		});
	},

	// Attach (or replace) one row's barcode without leaving this screen —
	// same dialog-free, click-to-edit pattern as the Stock Summary barcode
	// editor. The page-wide scanner (_listen_for_scans) is what adds a new
	// row when scanning; this is the counterpart for "this row's item
	// specifically doesn't have one yet."
	_edit_row_barcode($cell, row) {
		if ($cell.data("editing")) return;
		$cell.data("editing", true);
		const existing = row.barcode || "";

		$cell.html(`
			<span class="santu-si2-barcode-inline">
				<input type="text" class="santu-si2-barcode-input" value="${frappe.utils.escape_html(existing)}" placeholder="${__("Scan karein ya type karein")}">
				<button type="button" class="santu-si2-barcode-save" title="${__("Save")}">✓</button>
				<button type="button" class="santu-si2-barcode-cancel" title="${__("Cancel")}">✕</button>
			</span>
		`);
		const $input = $cell.find(".santu-si2-barcode-input");
		$input.trigger("focus").trigger("select");

		// The page-wide scanner points here while this box is open, same as
		// every other inline barcode editor in this app.
		const previous_listener_active = window.santu_barcode && window.santu_barcode.is_listening();
		const release_scanner = () => {
			if (!window.santu_barcode) return;
			window.santu_barcode.stop("santu-si2-row-barcode");
			if (previous_listener_active) this._listen_for_scans();
		};
		if (window.santu_barcode) {
			window.santu_barcode.listen((code) => {
				$input.val(code);
				save();
			}, "santu-si2-row-barcode");
		}

		const render_resting = () => {
			$cell.html(
				row.barcode
					? `▮▯▮ ${frappe.utils.escape_html(row.barcode)}`
					: `<span class="santu-si2-row-no-barcode">${__("+ barcode")}</span>`
			);
		};

		const close = () => {
			release_scanner();
			$cell.data("editing", false);
			render_resting();
		};

		// Save-button click and the input's own blur/change both call save()
		// — without this guard the two race and send the request twice
		// (confirmed live: a second concurrent write hit the same Item
		// Barcode row and MySQL reported a deadlock).
		let saving = false;
		const save = () => {
			if (saving) return;
			const code = $input.val().trim();
			if (!code || code === existing) return close();
			saving = true;
			frappe
				.xcall("santu_hardware.santu_hardware.api.attach_barcode_to_item", {
					item_code: row.item_code,
					barcode: code,
				})
				.then(() => {
					row.barcode = code;
					this._save_debounced();
					frappe.show_alert({
						message: __("{0} par barcode lag gaya", [row.item_name || row.item_code]),
						indicator: "green",
					});
					close();
				})
				.catch((err) => {
					saving = false;
					frappe.show_alert({
						message: (err && err.message) || __("Ye barcode shayad kisi aur saman par laga hai."),
						indicator: "red",
					});
					$input.trigger("focus").trigger("select");
				});
		};

		$cell.find(".santu-si2-barcode-save").on("click", (e) => {
			e.stopPropagation();
			save();
		});
		$cell.find(".santu-si2-barcode-cancel").on("click", (e) => {
			e.stopPropagation();
			close();
		});
		$input.on("click", (e) => e.stopPropagation());
		$input.on("change", () => save());
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				save();
			}
			if (e.key === "Escape") close();
		});
	},

	// The row's UOM dropdown only ever offered stock_uom and a pack "Box"
	// — this is the escape hatch when the supplier's bill says something
	// else entirely, like Dozen or Sack (2026-08-18 direct request: "unit
	// ka v multiple options do"). Saved onto the Item itself, not just this
	// one row, so it's there to pick again next time without re-adding it.
	_add_custom_uom(row, $tr) {
		const d = new frappe.ui.Dialog({
			title: __("Naya Unit"),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "uom",
					label: __("Unit ka naam"),
					options: "UOM",
					reqd: 1,
					description: __("Jo naam pehle se nahi hai wo bhi type kar sakte hain — naya ban jayega."),
				},
				{
					fieldtype: "Float",
					fieldname: "conversion_factor",
					label: __("1 {0} me kitne {1}?", [row.item_name || row.item_code, row.uom || "Nos"]),
					reqd: 1,
					default: 1,
				},
			],
			primary_action_label: __("Jodein"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Saving…"));
				santu_purchase_invoice.api
					.add_uom_conversion(row.item_code, v.uom, v.conversion_factor)
					.then(() => {
						frappe.dom.unfreeze();
						d.hide();
						row.uom = v.uom;
						this._recompute_row(row).then(() => {
							this._save_debounced();
							this._render_items();
						});
					})
					.catch((err) => {
						frappe.dom.unfreeze();
						frappe.msgprint({
							title: __("Save nahi ho paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						});
					});
			},
		});
		d.show();
	},

	// Naam/Category/HSN correctable right from this bill (2026-08-18 direct
	// request: "aur item edit krne ka option do") — reuses the exact same
	// endpoint and allow-list Stock Summary's inline editors already use,
	// so an item corrected mid-purchase and one corrected from Stock
	// Summary go through the identical validation either way.
	_edit_item_master(row, $tr) {
		const d = new frappe.ui.Dialog({
			title: row.item_name || row.item_code,
			fields: [
				{ fieldtype: "Data", fieldname: "item_name", label: __("Naam"), default: row.item_name, reqd: 1 },
				{ fieldtype: "Link", fieldname: "item_group", label: __("Category"), options: "Item Group" },
				{ fieldtype: "Link", fieldname: "gst_hsn_code", label: __("HSN"), options: "GST HSN Code" },
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Saving…"));
				const updates = [
					["item_name", v.item_name],
					["item_group", v.item_group],
					["gst_hsn_code", v.gst_hsn_code],
				].filter(([, value]) => value);
				Promise.all(
					updates.map(([fieldname, value]) =>
						santu_purchase_invoice.api.update_item_field(row.item_code, fieldname, value)
					)
				)
					.then(() => {
						frappe.dom.unfreeze();
						d.hide();
						row.item_name = v.item_name;
						this._save_debounced();
						this._render_items();
						frappe.show_alert({ message: __("Item update ho gaya"), indicator: "green" });
					})
					.catch((err) => {
						frappe.dom.unfreeze();
						frappe.msgprint({
							title: __("Save nahi ho paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						});
					});
			},
		});
		d.show();
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
		} else {
			frappe.show_alert({ message: __("Available after the first save, from the invoice's own attachment panel."), indicator: "blue" });
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
			fields: [{ fieldtype: "HTML", fieldname: "settings_note" }],
		});
		d.fields_dict.settings_note.$wrapper.html(`
			<p class="text-muted">Invoice numbering uses ERPNext's own naming series (${frappe.utils.escape_html((this.init_data.naming_series_default || "").replace(/\.#+.*/, ""))}) — change it from
			<a href="/app/purchase-invoice/view/report" target="_blank">Purchase Invoice Settings</a>.</p>
		`);
		d.show();
	},

	// ---------- shortcuts ----------
	_bind_shortcuts() {
		$(document).off("keydown.santu-pi2").on("keydown.santu-pi2", (e) => {
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
		if (action === "hold") {
			if (this._tab_is_empty(tab)) {
				frappe.show_alert({ message: __("Nothing to hold."), indicator: "orange" });
				return;
			}
			tab.held = true;
			tab.label = tab.label || this._tab_label(tab, this.tabs.indexOf(tab));
			this._save_debounced();
			frappe.show_alert({ message: __("Purchase held — still here whenever you're back."), indicator: "blue" });
			this._render_tabbar();
			return;
		}
		if (action === "purchase_return") {
			frappe.set_route("santu-purchase", { view: "purchase_return" });
			sessionStorage.setItem("santu_purchase_view", "purchase_return");
			return;
		}
		if (action === "payment") {
			if (!tab.supplier) {
				frappe.msgprint(__("Select a supplier first."));
				return;
			}
			window.santu_open_collect_payment({ party_type: "Supplier", party: tab.supplier });
			return;
		}
		if (action === "whatsapp") {
			if (!tab.saved_invoice) return;
			this._send_whatsapp(tab);
			return;
		}
		if (action === "share") {
			if (!tab.saved_invoice) {
				frappe.msgprint(__("Save the purchase first."));
				return;
			}
			window.santu_open_invoice_view("Purchase Invoice", tab.saved_invoice.name);
			return;
		}
		if (action === "save" || action === "save_print" || action === "save_whatsapp" || action === "save_whatsapp_other" || action === "submit_draft") {
			this._save_purchase(tab, action);
			return;
		}
	},

	_validate_before_save(tab) {
		// A typed-but-not-picked name is enough — _ensure_party_before_save
		// creates the supplier from it. Only a genuinely empty box is an error.
		if (!santu_party_inline.has_party_or_name(this.$root, tab, santu_party_inline.SUPPLIER)) {
			frappe.msgprint(__("Please select a supplier."));
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
		return true;
	},

	_save_purchase(tab, action) {
		if (!this._validate_before_save(tab)) return;
		// Resolve the party first: the operator may have typed a supplier name
		// without picking it from the dropdown. This creates it from the typed
		// name/phone/address, so tab.supplier is always set by the time we post.
		this._ensure_party_before_save(tab)
			.then(() => this._post_purchase(tab, action))
			.catch(() => {});
	},

	_post_purchase(tab, action) {
		const submit = action !== "submit_draft" ? 1 : 0;

		const payload = {
			supplier: tab.supplier,
			company: this.init_data.company,
			warehouse: this.init_data.warehouse,
			posting_date: tab.posting_date,
			buying_price_list: this.init_data.buying_price_list,
			payment_mode: tab.payment_mode,
			place_of_supply: tab.place_of_supply || null,
			bill_no: (tab.bill_no || "").trim() || null,
			additional_discount_amount: tab.additional_discount_amount || 0,
			terms: tab.terms || null,
			description: tab.description || null,
			items: tab.items.map((r) => ({
				item_code: r.item_code,
				item_name: r.item_name,
				qty: r.qty,
				rate: r.rate,
				// Falls back to the item's own stock unit if the row has none —
				// only a draft saved while the unit dropdown still offered "None"
				// can be, and without it the screen shows raw ERPNext jargon
				// ("Row #1: Value missing for: UOM") with no way to fix it.
				uom: r.uom || r.stock_uom,
				discount_percentage: r.discount_percentage || 0,
				discount_amount: r.discount_amount || 0,
				item_tax_template: r.item_tax_template || null,
			})),
			payments:
				tab.payment_mode === "cash" && tab.mode_of_payment
					? [{ mode_of_payment: tab.mode_of_payment, amount: tab.paid_amount != null ? tab.paid_amount : null }]
					: [],
		};

		frappe.dom.freeze(__("Saving…"));
		santu_purchase_invoice.api
			.save(payload, submit)
			.then((r) => {
				frappe.dom.unfreeze();
				tab.saved_invoice = r;
				this._save_debounced();
				window.santu_save_buttons ? santu_save_buttons.saved_alert("Purchase Invoice", r) : frappe.show_alert({ message: __("Saved"), indicator: "green" });
				this._render_body();
				// One shared path with Billing/Estimate/the returns: prints
				// straight away, sends straight away, and a plain Save does
				// neither. Purchase Invoice has no thermal layout, so the
				// print falls through to the normal print view exactly as it
				// did before -- just via the one helper now.
				santu_save_buttons.after_save(
					"Purchase Invoice",
					r.name,
					action === "save_print" ? "print" : action === "save_whatsapp" ? "whatsapp" : action === "save_whatsapp_other" ? "whatsapp_other" : null,
					{ has_party: !!tab.supplier }
				);
			})
			.catch((err) => {
				frappe.dom.unfreeze();
				// A GST slab was picked (per-row or Default Tax) but this
				// supplier has no GSTIN on file — india_compliance correctly
				// refuses to charge GST to an unregistered party, but its own
				// message ("Invalid GST Account… Supplier without GSTIN") is
				// English/technical and leaves the operator stuck not knowing
				// what to do. Most real suppliers (like a cement dealer) are
				// GST-registered; the GSTIN just hasn't been added yet — so
				// point straight at the existing "GST & more details" dialog
				// instead of a dead end (2026-08-18 real bill: JANTA CEMENT).
				const msg = (err && err.message) || "";
				if (msg.includes("without GSTIN") || msg.includes("Invalid GST Account")) {
					frappe.msgprint({
						title: __("Supplier ka GSTIN nahi mila"),
						indicator: "orange",
						message: __(
							"{0} ke liye GST tax lagane se pehle unka GSTIN daalna hoga. Agar unke paas GSTIN nahi hai to Default Tax ko \"None\" kar dein.",
							[tab.supplier || __("Is supplier")]
						),
						primary_action: {
							label: __("GSTIN daalein"),
							action: () => this._open_gstin_dialog(tab.supplier),
						},
					});
					return;
				}
				// `save()` now calls with `silent: true`, so frappe.call no
				// longer shows its own error dialog for anything — every other
				// failure must be surfaced here too, or it fails with nothing
				// on screen at all.
				frappe.msgprint({
					title: __("Save nahi ho paya"),
					indicator: "red",
					message: msg || __("Kuch galat ho gaya. Dobara koshish karein."),
				});
			});
	},

	_send_whatsapp(tab) {
		if (!tab.saved_invoice) return;
		window.santu_whatsapp_share.send_transaction("Purchase Invoice", tab.saved_invoice.name);
	},
};
