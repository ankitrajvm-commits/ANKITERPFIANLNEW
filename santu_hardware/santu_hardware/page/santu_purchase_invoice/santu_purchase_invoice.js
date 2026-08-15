/* global frappe, santu_purchase_invoice */
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
		["/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js"],
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
	if (prefill && window.santu_purchase_pos && santu_purchase_pos.page && santu_purchase_pos.init_data) {
		frappe.route_options = null;
		santu_purchase_pos._apply_prefill(prefill);
		return;
	}
	if (window.santu_purchase_pos && santu_purchase_pos.page) santu_purchase_pos.render();
};

const SANTU_PI2_STORAGE_KEY = "santu_purchase_pos_tabs_v1";

const santu_purchase_pos = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._save_debounced = santu_purchase_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		santu_purchase_invoice.api.init().then((data) => {
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
			payment_mode: "credit",
			mode_of_payment: (this.init_data.payment_modes[0] || {}).name || null,
			paid_amount: null,
			items: [],
			additional_discount_amount: 0,
			round_off: true,
			place_of_supply: this._default_place_of_supply(),
			posting_date: this.init_data.posting_date,
			terms: "",
			description: "",
			held: false,
			saved_invoice: null,
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
	// "Create Purchase Invoice") — see the matching method in
	// santu_sales_order.js for why items are re-looked-up via item_row()
	// rather than trusting the mapped doc's own shape.
	_apply_prefill(doc) {
		const tab = this._blank_tab();
		tab.supplier = doc.supplier || null;
		tab.place_of_supply = doc.place_of_supply || tab.place_of_supply;
		if (doc.terms) tab.terms = doc.terms;
		tab.additional_discount_amount = doc.discount_amount || 0;
		this.tabs.push(tab);
		this.active_id = tab.id;
		this._save_debounced();
		this.render();

		if (tab.supplier) {
			santu_purchase_invoice.api.supplier_details(tab.supplier).then((d) => {
				tab.supplier_details = d;
				this._save_debounced();
				this._render_customer_info();
			});
		}

		(doc.items || []).forEach((r) => {
			santu_purchase_invoice.api.item_row(tab.supplier, r.item_code, this.init_data.warehouse, r.qty).then((row) => {
				tab.items.push({
					id: santu_purchase_invoice.utils.uid(),
					item_code: r.item_code,
					item_name: row.item_name || r.item_name || r.item_code,
					qty: r.qty,
					uom: r.uom || row.uom || row.stock_uom,
					uom_options: row.uom ? [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i) : [row.stock_uom],
					rate: r.rate,
					discount_percentage: r.discount_percentage || 0,
					discount_amount: r.discount_amount || 0,
					tax_rate: row.tax_rate || 0,
					amount: r.amount || r.qty * r.rate,
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
		return tab.label || `Purchase #${idx + 1}`;
	},

	_tab_is_empty(tab) {
		return !tab.supplier && !tab.items.length && !tab.saved_invoice;
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
					<div class="santu-si2-customer-search-wrap">
						<input type="text" class="santu-si2-customer-search" placeholder="Search by Name/Phone *" autocomplete="off">
						<div class="santu-si2-customer-dropdown" style="display:none;"></div>
					</div>
					<input type="text" class="santu-si2-phone" placeholder="Phone No.">
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
					<button type="button" class="santu-si2-btn" data-action="save_print">Save &amp; Print</button>
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_items();
		this._render_customer_info();
		this._bind_body_events();
	},

	// ---------- supplier ----------
	_render_customer_info() {
		const tab = this._active_tab();
		const $info = this.$root.find(".santu-si2-customer-info");
		const $search = this.$root.find(".santu-si2-customer-search");
		const $phone = this.$root.find(".santu-si2-phone");
		if (!tab.supplier) {
			$info.empty();
			return;
		}
		$search.val(tab.supplier_details ? tab.supplier_details.supplier_name : tab.supplier);
		$phone.val((tab.supplier_details && tab.supplier_details.mobile_no) || tab.phone || "");
		const d = tab.supplier_details || {};
		const outstanding = d.outstanding_amount || 0;
		$info.html(`
			<div class="santu-si2-cust-card">
				<div class="santu-si2-cust-name">${frappe.utils.escape_html(d.supplier_name || tab.supplier)}
					<button type="button" class="santu-si2-cust-clear" title="Change supplier">×</button>
				</div>
				${d.address ? `<div class="santu-si2-cust-sub">${frappe.utils.escape_html(d.address)}</div>` : ""}
				<div class="santu-si2-cust-stats">
					<span class="${outstanding > 0 ? "santu-si2-warn-text" : ""}">Payable: ₹ ${santu_purchase_invoice.utils.format_money(outstanding).replace("₹ ", "")}</span>
				</div>
			</div>
		`);
		$info.find(".santu-si2-cust-clear").on("click", () => {
			tab.supplier = null;
			tab.supplier_details = null;
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
		santu_purchase_invoice.api.search_suppliers(q).then((rows) => {
			$dd.empty();

			const exact_match = rows.some((s) => (s.supplier_name || "").trim().toLowerCase() === q.trim().toLowerCase());

			rows.forEach((s) => {
				const $row = $(`
					<div class="santu-si2-dd-row" data-customer="${frappe.utils.escape_html(s.name)}">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(s.supplier_name)}</b>
								${s.mobile_no ? `<span>${frappe.utils.escape_html(s.mobile_no)}</span>` : ""}
							</div>
							<button type="button" class="santu-si2-dd-expand" title="More info">▸</button>
						</div>
						<div class="santu-si2-dd-row-info" style="display:none;">
							<textarea class="santu-si2-dd-row-note" placeholder="Add a note to identify this supplier">${frappe.utils.escape_html(s.supplier_details || "")}</textarea>
							<button type="button" class="santu-si2-dd-row-note-save">Save note</button>
						</div>
					</div>
				`).appendTo($dd);

				$row.find(".santu-si2-dd-row-main").on("click", () => this._select_customer(s.name));

				$row.find(".santu-si2-dd-expand").on("click", (e) => {
					e.stopPropagation();
					$row.find(".santu-si2-dd-row-info").toggle();
				});

				$row.find(".santu-si2-dd-row-note, .santu-si2-dd-row-note-save").on("click", (e) => e.stopPropagation());
				$row.find(".santu-si2-dd-row-note-save").on("click", () => {
					const note = $row.find(".santu-si2-dd-row-note").val();
					santu_purchase_invoice.api.update_supplier_note(s.name, note).then(() => {
						s.supplier_details = note;
						frappe.show_alert({ message: "Note saved", indicator: "green" });
					});
				});
			});

			if (!exact_match) {
				$(`<div class="santu-si2-dd-row santu-si2-dd-add" data-add="1">+ Add "${frappe.utils.escape_html(q)}" as new supplier</div>`)
					.on("click", () => this._open_add_party_dialog(q))
					.appendTo($dd);
			}

			$dd.show();
		});
	},

	_select_customer(name) {
		const tab = this._active_tab();
		tab.supplier = name;
		this.$root.find(".santu-si2-customer-dropdown").hide().empty();
		santu_purchase_invoice.api.supplier_details(name).then((d) => {
			tab.supplier_details = d;
			this._save_debounced();
			this._render_customer_info();
		});
	},

	_open_add_party_dialog(name) {
		const phone = this.$root.find(".santu-si2-phone").val();
		santu_purchase_invoice.utils.open_add_party_dialog({
			name,
			phone,
			on_created: (supplier_name) => this._select_customer(supplier_name),
		});
	},

	// ---------- items ----------
	_render_items() {
		const tab = this._active_tab();
		const $tbody = this.$root.find(".santu-si2-table tbody");
		$tbody.empty();

		if (!tab.items.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="9">No items yet — search above or press F4.</td></tr>`).appendTo($tbody);
		}

		tab.items.forEach((row, idx) => {
			const $tr = $(`
				<tr data-row="${row.id}">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-si2-col-item">
						<div class="santu-si2-item-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div>
						<div class="santu-si2-item-sub">
							${row.available_qty != null ? `<span class="${row.available_qty <= 0 ? "santu-si2-stock-out" : row.available_qty <= 5 ? "santu-si2-stock-low" : "santu-si2-stock-ok"}">In Stock: ${row.available_qty} ${frappe.utils.escape_html(row.uom || "")}</span>` : ""}
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
					<td class="santu-si2-col-amount santu-si2-figures santu-si2-row-amount">₹ ${santu_purchase_invoice.utils.format_money(row.amount || 0).replace("₹ ", "")}</td>
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
			santu_purchase_invoice.api.recent_items().then((rows) => this._render_item_dropdown($dd, rows, "Recent Items"));
			return;
		}
		santu_purchase_invoice.api.search_items(q).then((r) => this._render_item_dropdown($dd, r.results || [], null, q));
	},

	_render_item_dropdown($dd, rows, heading, query) {
		$dd.empty();
		if (heading) $dd.append(`<div class="santu-si2-dd-heading">${heading}</div>`);
		if (!rows.length) {
			$dd.append(`<div class="santu-si2-dd-empty">No items found.</div>`);
		}
		rows.forEach((item) => {
			$(`
				<div class="santu-si2-dd-row santu-si2-item-dd-row">
					<div>
						<b>${frappe.utils.escape_html(item.item_name)}</b>
						<span class="santu-si2-dd-sub">${frappe.utils.escape_html(item.item_code)}${item.brand ? " · " + frappe.utils.escape_html(item.brand) : ""}</span>
					</div>
					<div class="santu-si2-dd-right">
						<span class="santu-si2-stock-ok">${item.available_qty != null ? item.available_qty + " " + (item.stock_uom || "") : ""}</span>
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

	_quick_create_item(item_name) {
		const d = new frappe.ui.Dialog({
			title: __("Quick Create Item"),
			fields: [
				{ fieldtype: "Data", fieldname: "item_name", label: "Item Name", default: item_name, reqd: 1 },
				{ fieldtype: "Currency", fieldname: "purchase_price", label: "Purchase Price", reqd: 1 },
			],
			primary_action_label: __("Create & Add"),
			primary_action: (v) => {
				santu_purchase_invoice.api.quick_create_item(v.item_name, v.purchase_price).then((r) => {
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

		santu_purchase_invoice.api.item_row(tab.supplier, item_code, this.init_data.warehouse, 1).then((row) => {
			const new_row = {
				id: santu_purchase_invoice.utils.uid(),
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
				can_edit_rate: !(frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager")),
				amount: row.price_list_rate || row.rate || 0,
			};
			tab.items.push(new_row);
			this._save_debounced();
			this._render_items();
		});
	},

	_recompute_row(row) {
		const tab = this._active_tab();
		return santu_purchase_invoice.api.item_row(tab.supplier, row.item_code, this.init_data.warehouse, row.qty).then((r) => {
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
				const q = $input.val().trim();
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
		if (action === "save" || action === "save_print" || action === "submit_draft") {
			this._save_purchase(tab, action);
			return;
		}
	},

	_validate_before_save(tab) {
		if (!tab.supplier) {
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
		const submit = action !== "submit_draft" ? 1 : 0;

		const payload = {
			supplier: tab.supplier,
			company: this.init_data.company,
			warehouse: this.init_data.warehouse,
			posting_date: tab.posting_date,
			buying_price_list: this.init_data.buying_price_list,
			payment_mode: tab.payment_mode,
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
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				this._render_body();
				if (action === "save_print") {
					frappe.set_route("print", "Purchase Invoice", r.name);
				}
			})
			.catch(() => frappe.dom.unfreeze());
	},

	_send_whatsapp(tab) {
		santu_purchase_invoice.api.whatsapp_preview("Purchase Invoice", tab.saved_invoice.name).then((preview) => {
			const d = new frappe.ui.Dialog({
				title: __("Send on WhatsApp"),
				fields: [
					{ fieldtype: "Data", fieldname: "phone", label: "Phone", default: preview.phone_display || preview.phone, read_only: 1 },
					{ fieldtype: "Small Text", fieldname: "message", label: "Message", default: preview.message },
				],
				primary_action_label: __("Send"),
				primary_action: (v) => {
					santu_purchase_invoice.api.whatsapp_send("Purchase Invoice", tab.saved_invoice.name, v.message).then(() => {
						frappe.show_alert({ message: __("Sent"), indicator: "green" });
						d.hide();
					});
				},
			});
			d.show();
		});
	},
};
