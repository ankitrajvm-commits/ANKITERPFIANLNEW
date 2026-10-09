/* global frappe, santu_purchase_invoice, santu_purchase_order */
// Santu Hardware — Purchase Order screen (2026-08-15 direct request:
// "purchase order- add ur first purchase order... jo ui hai use delete
// krke vyapaar type ui add kro" — the native Purchase Order creation form
// was still showing). Mirrors santu_sales_order.js exactly (Customer ->
// Supplier, selling -> buying), backed onto a real Purchase Order via
// santu_hardware.santu_hardware.api.save_purchase_order instead of a Sales
// Order. Supplier search, item search/pricing, and the Add Party dialog
// are the exact same calls the Purchase Invoice screen uses
// (santu_purchase_invoice.api), not reimplemented.
frappe.pages["santu-purchase-order"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
			"/assets/santu_hardware/js/santu_purchase_order/santu_purchase_order_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Purchase Order", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_purchase_order_page.init(page);
		}
	);
};

frappe.pages["santu-purchase-order"].on_page_show = function () {
	// "Edit Purchase Order" hands the order's NAME here, claimed through
	// santu_handoff (one reader, whole bag read before anything is cleared).
	const P = window.santu_purchase_order_page;
	if (santu_handoff.claim(P, { edit_purchase_order: P && P._apply_edit })) return;
	if (P && P.page) P.render();
};


const SANTU_PO_STORAGE_KEY = "santu_purchase_order_tabs_v1";

// `window.` par hona zaroori hai: isi file ka on_page_show
// `window.santu_purchase_order_page` dekhkar prefill chalata hai. Bare `const`
// window par nahi aata, isliye Estimate se Order/Bill banane par kuch
// hota hi nahi tha -- chup-chaap khaali screen (2026-10-01).
window.santu_purchase_order_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._save_debounced = santu_purchase_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		santu_purchase_order.api.init().then((data) => {
			this.init_data = data;
			this._load_from_storage();
			if (santu_handoff.claim(this, { edit_purchase_order: this._apply_edit })) return;
			if (!this.tabs.length) this._new_tab();
			this.render();
		});
	},

	_load_from_storage() {
		try {
			const raw = localStorage.getItem(SANTU_PO_STORAGE_KEY);
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
			localStorage.setItem(SANTU_PO_STORAGE_KEY, JSON.stringify({ tabs: this.tabs, active_id: this.active_id }));
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
			id: santu_purchase_invoice.utils.uid(),
			label: null,
			supplier: null,
			supplier_details: null,
			phone: "",
			items: [],
			additional_discount_amount: 0,
			round_off: true,
			place_of_supply: this._default_place_of_supply(),
			posting_date: this.init_data.posting_date,
			schedule_date: this.init_data.posting_date,
			terms: "",
			description: "",
			saved_order: null,
			// Set only when this tab corrects an already-submitted order.
			editing: null,
		};
	},

	_new_tab(focus) {
		const t = this._blank_tab();
		this.tabs.push(t);
		if (focus !== false) this.active_id = t.id;
		this._save_debounced();
		return t;
	},

	// Reopen a submitted Purchase Order on this screen with its own rows already
	// in it, rather than a separate edit form nobody has seen before. Same
	// shape as the Estimate screen's _apply_edit.
	_apply_edit(name) {
		frappe.dom.freeze(__("Purchase Order khol rahe hain…"));
		frappe
			.xcall("santu_hardware.santu_hardware.api.get_document_for_edit", {
				doctype: "Purchase Order",
				name,
			})
			.then((doc) => {
				frappe.dom.unfreeze();
				const t = this._new_tab(true);
				t.supplier = doc.party;
				t.supplier_details = { name: doc.party, supplier_name: doc.party_label };
				t.posting_date = doc.posting_date || t.posting_date;
				t.schedule_date = doc.posting_date || t.schedule_date;
				t.additional_discount_amount = doc.bill_discount || 0;
				t.editing = {
					name: doc.name,
					santu_bill_no: doc.santu_bill_no,
					original_total: doc.grand_total,
				};
				(doc.items || []).forEach((r) => {
					t.items.push({
						id: santu_purchase_invoice.utils.uid(),
						item_code: r.item_code,
						item_name: r.item_name || r.item_code,
						qty: r.qty,
						uom: r.uom || r.stock_uom,
						uom_options:
							r.uom_options && r.uom_options.length
								? r.uom_options
								: [{ uom: r.uom, conversion_factor: 1 }],
						rate: r.rate,
						// The submitted rate is already net of any discount, so
						// re-applying one would take it off twice.
						discount_percentage: 0,
						discount_amount: 0,
						available_qty: r.available_qty,
					});
				});
				this._save_debounced();
				this.render();
			})
			.catch(() => frappe.dom.unfreeze());
	},

	_active_tab() {
		return this.tabs.find((t) => t.id === this.active_id) || this.tabs[0];
	},

	_tab_label(tab, idx) {
		return tab.label || `Order #${idx + 1}`;
	},

	_tab_is_empty(tab) {
		return !tab.supplier && !tab.items.length && !tab.saved_order;
	},

	// A tab left open (or restored from localStorage) from an earlier day
	// kept that day's date, so a sale/payment made today was booked on the
	// old date -- Payment In showed 06/09 on 19/09 (2026-09-19). Billing,
	// Estimate and Returns already roll forward; this does the same, but a
	// date the user picked by hand TODAY (date_set_on) is left alone.
	_roll_dates_forward() {
		const today = frappe.datetime.get_today();
		let changed = false;
		(this.tabs || []).forEach((t) => {
			if (t.saved || t.editing || t.saved_challan || t.saved_doc || t.saved_invoice || t.saved_order) return;
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
		$(`<button type="button" class="santu-si2-tab-add" title="New Purchase Order (Ctrl+N)">+</button>`)
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
			${
				// Sudhaar mode -- the counter must never mistake a correction for
				// a new document. Same banner Billing has shown since 2026-08-27.
				tab.editing
					? `<div class="santu-bill-edit-banner">${__("Sudhaar mode")} — ${__("Purchase Order")} <b>${frappe.utils.escape_html(tab.editing.name)}</b> ${__("ko sudhaara ja raha hai. Save karte hi purana cancel hokar naya sahi ban jayega.")}</div>`
					: ""
			}
			<div class="santu-si2-header">
				<div class="santu-si2-header-title">Purchase Order</div>
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
						<span class="santu-si2-inv-label">Order No.</span>
						<span class="santu-si2-inv-value">${
							tab.saved_order ? frappe.utils.escape_html(tab.saved_order.name) : "(auto)"
						}</span>
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Order Date</span>
						<input type="date" class="santu-si2-posting-date" value="${tab.posting_date}">
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Due Date</span>
						<input type="date" class="santu-si2-delivery-date" value="${tab.schedule_date || tab.posting_date}">
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
				<div class="santu-si2-actionbar-left"></div>
				<div class="santu-si2-actionbar-right">
					<button type="button" class="santu-si2-btn" data-action="share">Share ▾</button>
					<button type="button" class="santu-si2-btn" data-action="save_whatsapp">💬 Send WhatsApp</button>
					<button type="button" class="santu-si2-btn" data-action="save_whatsapp_other">↗ Kisi aur ko</button>
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_items();
		this._render_customer_info();
		this._bind_body_events();
	},

	// ---------- supplier (identical UX to Purchase Invoice) ----------
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
		$info.html(`
			<div class="santu-si2-cust-card">
				<div class="santu-si2-cust-name">${frappe.utils.escape_html(d.supplier_name || tab.supplier)}
					<button type="button" class="santu-si2-cust-clear" title="Change supplier">×</button>
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
		// Khaali box par bhi poore mahajan dikhein, jaise Billing me grahak
		// dikhte hain (2026-09-23 report).
		santu_purchase_invoice.api.list_suppliers_for_picker(q).then((rows) => {
			$dd.empty();
			const exact_match = rows.some((s) => (s.supplier_name || "").trim().toLowerCase() === q.trim().toLowerCase());

			rows.forEach((s) => {
				$(`
					<div class="santu-si2-dd-row" data-supplier="${frappe.utils.escape_html(s.name)}">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(s.supplier_name)}</b>
								${s.mobile_no ? `<span>${frappe.utils.escape_html(s.mobile_no)}</span>` : ""}
							</div>
						</div>
					</div>
				`)
					.on("click", () => this._select_supplier(s.name))
					.appendTo($dd);
			});

			if (!exact_match) {
				$(`<div class="santu-si2-dd-row santu-si2-dd-add" data-add="1">+ Add "${frappe.utils.escape_html(q)}" as new supplier</div>`)
					.on("click", () => this._open_add_party_dialog(q))
					.appendTo($dd);
			}
			$dd.show();
		});
	},

	_select_supplier(name) {
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
			on_created: (supplier_name) => this._select_supplier(supplier_name),
		});
	},

	// ---------- items (identical UX to Purchase Invoice) ----------
	_render_items({ reveal_row_id = null } = {}) {
		const tab = this._active_tab();
		const $tbody = this.$root.find(".santu-si2-table tbody");
		$tbody.empty();

		if (!tab.items.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="9">No items yet — search above.</td></tr>`).appendTo($tbody);
		}

		tab.items.forEach((row, idx) => {
			const row_hl = santu_item_row_class(row.item_code, row.item_name);
			const $tr = $(`
				<tr data-row="${row.id}" class="${row.id === reveal_row_id ? "santu-bill-row-new" : ""} ${row_hl}">
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

	_item_search(q) {
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
		// "5x tee" typed in search -> 5, else 1 (santu_qty_prefix.js)
		const add_qty = santu_qty.take(this);
		const tab = this._active_tab();
		this.$root.find(".santu-si2-item-dropdown").hide();
		this.$root.find(".santu-si2-item-search").val("");

		const existing = tab.items.find((r) => r.item_code === item_code);
		if (existing) {
			existing.qty = (Number(existing.qty) || 0) + add_qty;
			this._render_items({ reveal_row_id: existing.id });
			this._save_debounced();
			return;
		}

		santu_purchase_invoice.api.item_row(tab.supplier, item_code, this.init_data.warehouse, add_qty).then((row) => {
			const new_row = {
				id: santu_purchase_invoice.utils.uid(),
				item_code,
				item_name: row.item_name || item_code,
				qty: add_qty,
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
			this._render_items({ reveal_row_id: new_row.id });
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
	},

	// ---------- events ----------
	_bind_body_events() {
		const tab = this._active_tab();
		const $root = this.$root;

		const $custSearch = $root.find(".santu-si2-customer-search");
		$custSearch.on(
			"input",
			santu_purchase_invoice.utils.debounce((e) => this._customer_search(e.target.value))
		);
		$custSearch.on("focus", (e) => {
			if (e.target.value) this._customer_search(e.target.value);
		});
		$(document)
			.off("click.santu-po-dd")
			.on("click.santu-po-dd", (e) => {
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
			tab.date_set_on = frappe.datetime.get_today();
			this._save_debounced();
		});
		$root.find(".santu-si2-delivery-date").on("change", (e) => {
			tab.schedule_date = e.target.value;
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
			// Full unit list comes from santu_uom (the item's own units plus
			// every unit in the system) -- this select used to be built from
			// [row.uom, row.stock_uom] alone, so a Kg item could never be
			// switched to grams here.
			santu_uom.fill_select($tr.find(".santu-si2-uom-select"), row.item_code, row.uom, {
				on_ready: (opts) => (row.uom_options = opts),
			});
			$tr.find(".santu-si2-uom-select").on("change", (e) => {
				// Rescale rate/qty/stock with the unit so the row still means
				// the same real amount: 1 Kg @ 1600 -> 1000 g @ 1.60.
				santu_uom.convert(row, e.target.value, row.uom_options);
				this._render_items();
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
		$(document).off("keydown.santu-po").on("keydown.santu-po", (e) => {
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
			window.santu_open_invoice_view("Purchase Order", tab.saved_order.name);
			return;
		}
		if (action === "save" || action === "save_whatsapp" || action === "save_whatsapp_other") {
			this._save_order(tab, action === "save_whatsapp" ? "whatsapp" : action === "save_whatsapp_other" ? "whatsapp_other" : null);
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

	_save_order(tab, after) {
		if (!this._validate_before_save(tab)) return;

		const payload = {
			supplier: tab.supplier,
			company: this.init_data.company,
			posting_date: tab.posting_date,
			schedule_date: tab.schedule_date || tab.posting_date,
			buying_price_list: this.init_data.buying_price_list,
			place_of_supply: tab.place_of_supply || null,
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
			})),
		};

		frappe.dom.freeze(__("Saving…"));
		// Correcting a submitted order amends it: the original is cancelled
		// and chained to the correction, keeping its number.
		(tab.editing
			? frappe.xcall("santu_hardware.santu_hardware.api.edit_submitted_document", {
					doctype: "Purchase Order",
					name: tab.editing.name,
					payload_json: JSON.stringify(payload),
			  })
			: santu_purchase_order.api.save(payload, 1)
		)
			.then((r) => {
				frappe.dom.unfreeze();
				tab.saved_order = r;
				this._save_debounced();
				window.santu_save_buttons ? santu_save_buttons.saved_alert("Purchase Order", r) : frappe.show_alert({ message: __("Saved"), indicator: "green" });
				// The WhatsApp dialog has to finish BEFORE this screen jumps to
				// the saved order -- the route change tears the dialog down.
				const open_view = () => window.santu_open_invoice_view("Purchase Order", r.name);
				if (after && window.santu_save_buttons) {
					Promise.resolve(
						santu_save_buttons.after_save("Purchase Order", r.name, after, { has_party: !!(r.supplier || tab.supplier) })
					).then(open_view, open_view);
				} else {
					open_view();
				}
			})
			.catch(() => frappe.dom.unfreeze());
	},
};
