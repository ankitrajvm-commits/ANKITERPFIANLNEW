/* global frappe, santu_sale_invoice, santu_sales_order, santu_party_inline */
// Santu Hardware — Sales Order screen (2026-08-15 direct request:
// "selling- sales order- new sale order ka abhi v old ui hai, vyapar ui
// lao" — the native Sales Order creation form was still showing). Mirrors
// santu_estimate.js almost exactly (itself mirroring the Sale Invoice
// screen's UI, santu_sale_invoice.js/css — same classes reused directly,
// no separate stylesheet), backed onto a real Sales Order via
// santu_hardware.santu_hardware.api.save_sales_order instead of a
// Quotation. Customer search, item search/pricing, and the Add Party
// dialog are the exact same calls the Sale Invoice screen uses
// (santu_sale_invoice.api), not reimplemented.
frappe.pages["santu-sales-order"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			"/assets/santu_hardware/js/santu_party_inline/santu_party_inline.js",
			"/assets/santu_hardware/js/santu_sales_order/santu_sales_order_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Sales Order", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_sales_order_page.init(page);
		}
	);
};

// "Convert to Sales Order" (from Quotation, santu_sale_transactions.js)
// hands off the mapped-but-unsaved doc here via frappe.route_options.prefill
// instead of trying to view it — get_invoice_view_data only knows real
// saved documents and threw "not found" for the draft (confirmed live
// 2026-08-15). on_page_show also checks it: on_page_load only ever fires
// once per session, so a second conversion while this page is already open
// needs its own check to not silently no-op.
frappe.pages["santu-sales-order"].on_page_show = function () {
	const prefill = frappe.route_options && frappe.route_options.prefill;
	if (prefill && window.santu_sales_order_page && santu_sales_order_page.page && santu_sales_order_page.init_data) {
		frappe.route_options = null;
		santu_sales_order_page._apply_prefill(prefill);
		return;
	}
	if (window.santu_sales_order_page && santu_sales_order_page.page) santu_sales_order_page.render();
};

const SANTU_SO_STORAGE_KEY = "santu_sales_order_tabs_v1";

const santu_sales_order_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._save_debounced = santu_sale_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		santu_sales_order.api.init().then((data) => {
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

	_load_from_storage() {
		try {
			const raw = localStorage.getItem(SANTU_SO_STORAGE_KEY);
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
			localStorage.setItem(SANTU_SO_STORAGE_KEY, JSON.stringify({ tabs: this.tabs, active_id: this.active_id }));
		} catch (e) {
			/* storage full/unavailable — screen still works */
		}
	},

	_default_place_of_supply() {
		// Shop-specific default (direct request) — Bihar.
		const options = this.init_data.place_of_supply_options || [];
		return options.find((o) => o.toLowerCase().includes("bihar")) || null;
	},

	_blank_tab() {
		return {
			id: santu_sale_invoice.utils.uid(),
			label: null,
			customer: null,
			customer_details: null,
			phone: "",
			items: [],
			additional_discount_amount: 0,
			round_off: true,
			place_of_supply: this._default_place_of_supply(),
			posting_date: this.init_data.posting_date,
			delivery_date: this.init_data.posting_date,
			terms: "",
			description: "",
			saved_order: null,
		};
	},

	_new_tab(focus) {
		const t = this._blank_tab();
		this.tabs.push(t);
		if (focus !== false) this.active_id = t.id;
		this._save_debounced();
		return t;
	},

	// Builds a fresh tab from a mapped-but-unsaved doc (e.g. Quotation's
	// "Convert to Sales Order") — re-looks-up each item via the normal
	// item_row() pricing/tax call (same one _add_item uses) rather than
	// trusting the mapped doc's own item shape, since the mapped doc has no
	// tax_rate/uom_options for our table, then overrides qty/rate/discount
	// with whatever the source document actually had.
	_apply_prefill(doc) {
		const tab = this._blank_tab();
		tab.customer = doc.customer || doc.party_name || null;
		tab.place_of_supply = doc.place_of_supply || tab.place_of_supply;
		tab.terms = doc.terms || "";
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
		return tab.label || `Order #${idx + 1}`;
	},

	_tab_is_empty(tab) {
		return !tab.customer && !tab.items.length && !tab.saved_order;
	},

	render() {
		if (!this.tabs.length) this._new_tab();
		const $body = $(this.page.body);
		$body.html(`
			<div class="santu-si2">
				<div class="santu-si2-tabbar">
					<div class="santu-si2-tabs"></div>
					<div class="santu-si2-toolbar">
						<button type="button" class="santu-si2-icon-btn" data-action="calculator" title="Calculator">🧮</button>
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
				<button type="button" class="santu-si2-tab${active ? " is-active" : ""}" data-tab="${tab.id}">
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
		$(`<button type="button" class="santu-si2-tab-add" title="New Sales Order (Ctrl+N)">+</button>`)
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
		frappe.confirm(__("This order has unsaved items. Close anyway?"), finish);
	},

	_render_body() {
		const tab = this._active_tab();
		const $wrap = this.$root.find(".santu-si2-body");
		$wrap.html(`
			<div class="santu-si2-header">
				<div class="santu-si2-header-title">Sales Order</div>
			</div>

			<div class="santu-si2-toprow">
				<div class="santu-si2-customer-col">
					${santu_party_inline.fields_html()}
				</div>
				<div class="santu-si2-customer-info"></div>
				<div class="santu-si2-invoice-info">
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Ref No.</span>
						<span class="santu-si2-inv-value">${
							tab.saved_order ? frappe.utils.escape_html(tab.saved_order.name) : "(auto)"
						}</span>
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Order Date</span>
						<input type="date" class="santu-si2-posting-date" value="${tab.posting_date}">
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Delivery Date</span>
						<input type="date" class="santu-si2-delivery-date" value="${tab.delivery_date || tab.posting_date}">
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
				<div class="santu-si2-actionbar-left"></div>
				<div class="santu-si2-actionbar-right">
					<button type="button" class="santu-si2-btn" data-action="share">Share ▾</button>
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_items();
		this._render_customer_info();
		this._bind_body_events();
	},

	// ---------- customer (inline party fields via santu_party_inline) ----------
	_party_ctx() {
		return santu_party_inline.make_ctx(this, santu_party_inline.CUSTOMER, { ddNamespace: "santu-so-dd" });
	},

	_render_customer_info() {
		santu_party_inline.render_info(this._party_ctx());
	},

	_customer_search(q) {
		santu_party_inline.run_search(this._party_ctx(), q);
	},

	_select_customer(name) {
		santu_party_inline.select_party(this._party_ctx(), name);
	},

	_open_add_party_dialog(name) {
		santu_party_inline.open_advanced_dialog(this._party_ctx(), name);
	},

	_ensure_party_before_save(tab) {
		const ctx = this._party_ctx();
		ctx.tab = tab;
		return santu_party_inline.ensure_before_save(ctx);
	},

	// ---------- items (identical UX to Sale Invoice, no stock warnings) ----------
	_render_items() {
		const tab = this._active_tab();
		const $tbody = this.$root.find(".santu-si2-table tbody");
		$tbody.empty();

		if (!tab.items.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="9">No items yet — search above.</td></tr>`).appendTo($tbody);
		}

		tab.items.forEach((row, idx) => {
			const $tr = $(`
				<tr data-row="${row.id}">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-si2-col-item">
						<div class="santu-si2-item-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div>
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
						<input type="number" class="santu-si2-rate-input" value="${row.rate}" min="0" step="any">
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

	_item_search(q) {
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
			$(`
				<div class="santu-si2-dd-row santu-si2-item-dd-row">
					<div>
						<b>${frappe.utils.escape_html(item.item_name)}</b>
						<span class="santu-si2-dd-sub">${frappe.utils.escape_html(item.item_code)}${item.brand ? " · " + frappe.utils.escape_html(item.brand) : ""}</span>
					</div>
					<div class="santu-si2-dd-right">
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
				// Opening stock is mandatory for every item created on the selling
				// side (2026-08-20) — without it the item used to be created as a
				// non-stock Service and vanish from stock counts. See quick_create_item.
				{
					fieldtype: "Float",
					fieldname: "opening_qty",
					label: __("Abhi kitna hai?"),
					description: __("Dukaan me abhi jitna maal hai — bharna zaroori hai."),
					reqd: 1,
				},
			],
			primary_action_label: __("Create & Add"),
			primary_action: (v) => {
				santu_sale_invoice.api
					.quick_create_item(v.item_name, v.selling_price, { opening_qty: v.opening_qty })
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

	_add_item(item_code) {
		const tab = this._active_tab();
		this.$root.find(".santu-si2-item-dropdown").hide();
		this.$root.find(".santu-si2-item-search").val("");

		const existing = tab.items.find((r) => r.item_code === item_code);
		if (existing) {
			existing.qty = (Number(existing.qty) || 0) + 1;
			this._render_items();
			this._save_debounced();
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
				amount: row.price_list_rate || row.rate || 0,
			};
			tab.items.push(new_row);
			this._save_debounced();
			this._render_items();
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
	},

	// ---------- events ----------
	_bind_body_events() {
		const tab = this._active_tab();
		const $root = this.$root;

		santu_party_inline.bind_search_events(this._party_ctx());
		santu_party_inline.bind_field_events(this._party_ctx());

		$root.find(".santu-si2-posting-date").on("change", (e) => {
			tab.posting_date = e.target.value;
			this._save_debounced();
		});
		$root.find(".santu-si2-delivery-date").on("change", (e) => {
			tab.delivery_date = e.target.value;
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
	},

	_open_item_search_inline() {
		const $existing = this.$root.find(".santu-si2-item-search");
		if ($existing.length) {
			$existing.trigger("focus");
			return;
		}
		const $wrap = $(`
			<div class="santu-si2-item-search-wrap">
				<input type="text" class="santu-si2-item-search" placeholder="Search item name, code, brand…" autocomplete="off">
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
			frappe.show_alert({ message: __("Available after the first save, from the order's own attachment panel."), indicator: "blue" });
		}
	},

	_bind_toolbar() {
		this.$root.find('[data-action="calculator"]').on("click", () => this._open_calculator());
	},

	_open_calculator() {
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

	_bind_shortcuts() {
		$(document).off("keydown.santu-so").on("keydown.santu-so", (e) => {
			if (!$(".santu-si2:visible").length) return;
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key.toLowerCase() === "n") {
				e.preventDefault();
				this._new_tab();
				this.render();
			} else if (mod && e.key.toLowerCase() === "s") {
				e.preventDefault();
				this._handle_action("save");
			} else if (e.key === "Escape") {
				this.$root.find(".santu-si2-customer-dropdown, .santu-si2-item-dropdown").hide();
			}
		});
	},

	_handle_action(action) {
		const tab = this._active_tab();
		if (action === "share") {
			if (!tab.saved_order) {
				frappe.msgprint(__("Save the order first."));
				return;
			}
			window.santu_open_invoice_view("Sales Order", tab.saved_order.name);
			return;
		}
		if (action === "save") {
			this._save_order(tab);
			return;
		}
	},

	_validate_before_save(tab) {
		if (!santu_party_inline.has_party_or_name(this.$root, tab, santu_party_inline.CUSTOMER)) {
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
		return true;
	},

	_save_order(tab) {
		if (!this._validate_before_save(tab)) return;

		frappe.dom.freeze(__("Saving…"));
		this._ensure_party_before_save(tab)
			.then((customer) => {
				const payload = {
					customer,
					company: this.init_data.company,
					posting_date: tab.posting_date,
					delivery_date: tab.delivery_date || tab.posting_date,
					selling_price_list: this.init_data.selling_price_list,
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
				};

				return santu_sales_order.api.save(payload, 1);
			})
			.then((r) => {
				if (!r) return;
				frappe.dom.unfreeze();
				tab.saved_order = r;
				this._save_debounced();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				window.santu_open_invoice_view("Sales Order", r.name);
			})
			.catch(() => frappe.dom.unfreeze());
	},
};
