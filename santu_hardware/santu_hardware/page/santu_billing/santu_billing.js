/* global frappe, santu_sale_invoice, santu_sales_return, santu_billing_page, santu_is_privacy_mode_active, santu_toggle_privacy_mode */
// Santu Hardware — counter billing, laid out from Vyapar's own billing
// screen (2026-08-15 screenshots: bill tabs, scan bar, the 9-column item
// grid, the right-hand total/payment rail, the F-key action bar and the
// Full Bill Breakup modal).
//
// This replaces ERPNext's POS, which was unusable anyway: its POS Profile
// had been deleted, so /app/point-of-sale opened on "POS Profile Santu
// Hardware POS not found". Nothing here needs a POS Profile — saving goes
// through api.save_sale_invoice, the same path the Sale Invoice screen
// uses, which deliberately sets ignore_pos_profile because an auto-attached
// profile used to overwrite the screen's own payment rows.
frappe.pages["santu-billing"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			// Return needs its own party-search-free lookup (bill number OR
			// customer, no party pre-picked) — santu_sales_return_api.js
			// already wraps that endpoint, so it's reused as-is rather than
			// duplicated here.
			"/assets/santu_hardware/js/santu_sales_return/santu_sales_return_api.js",
		],
		() => {
		const page = frappe.ui.make_app_page({ parent: wrapper, title: "Billing", single_column: true });
		$(page.wrapper).find(".page-head").hide();
		$(page.main).addClass("santu-bill-page-main");
		santu_billing_page.init(page);
	});
};

// "Convert to Sales Invoice" (Estimate/Quotation and Sales Order,
// santu_sale_transactions.js) hands the mapped-but-unsaved doc here via
// frappe.route_options.prefill rather than trying to view it as a saved
// document — mirrors santu_sale_invoice.js's identical mechanism, since
// Billing is where a sale is actually finished now (2026-08-20: "sare sale
// me pos billing hi khule" — every path that starts or resumes a sale
// should land here, not on the secondary Sale Invoice screen).
frappe.pages["santu-billing"].on_page_show = function () {
	const prefill = frappe.route_options && frappe.route_options.prefill;
	const source_doctype = frappe.route_options && frappe.route_options.source_doctype;
	if (prefill && window.santu_billing_page && santu_billing_page.page && santu_billing_page.init_data) {
		frappe.route_options = null;
		santu_billing_page._apply_prefill(prefill, source_doctype);
		return;
	}
	// A submitted bill sent here from "Edit Bill" on the View Invoice screen
	// (2026-08-27 direct request) — same arrival pattern as prefill above,
	// just carrying an invoice NAME instead of an unsaved doc.
	const edit_invoice = frappe.route_options && frappe.route_options.edit_invoice;
	if (edit_invoice && window.santu_billing_page && santu_billing_page.page && santu_billing_page.init_data) {
		frappe.route_options = null;
		santu_billing_page._apply_edit_invoice(edit_invoice);
		return;
	}
	if (window.santu_billing_page && santu_billing_page.page) {
		const today = frappe.datetime.get_today();
		if (santu_billing_page.tabs) {
			let changed = false;
			santu_billing_page.tabs.forEach((t) => {
				if (!t.editing && !t.saved && t.posting_date && t.posting_date < today) {
					t.posting_date = today;
					changed = true;
				}
			});
			if (changed) santu_billing_page._persist();
		}
		santu_billing_page.render();
	}
};

const SANTU_BILL_KEY = "santu_billing_tabs_v1";

// Same icon convention Sale Invoice uses (santu_sale_invoice.js), kept as a
// local copy so Billing doesn't depend on that page's script being loaded.
//
// Keep this name unique across page scripts. Desk is a single-page app: two
// page scripts open in one session share a global scope, and two top-level
// `const`s of one name is a SyntaxError that kills the second script outright
// — the page then renders blank until a full reload. That was the "3-4 baar
// reload karna padta hai" bug (2026-08-20), when this collided with the Sale
// Invoice screen's `santu_si2_icon`. That screen is gone (2026-08-30
// consolidation to one billing screen) so this particular pair can no longer
// collide, but every other page script still can — so the rule stands.
const SANTU_BILL_ICON_DIR = "/assets/santu_hardware/images/items";
const santu_bill_icon = (file, cls = "") =>
	`<img class="santu-si2-ico ${cls}" src="${SANTU_BILL_ICON_DIR}/${file}" alt="" draggable="false">`;

window.santu_billing_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._persist_soon = santu_sale_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-bill-loading">Loading…</div>`);
		santu_sale_invoice.api.init().then((data) => {
			this.init_data = data;
			const prefill = frappe.route_options && frappe.route_options.prefill;
			const source_doctype = frappe.route_options && frappe.route_options.source_doctype;
			frappe.route_options = null;
			if (prefill) {
				this._apply_prefill(prefill, source_doctype);
				return;
			}
			const edit_invoice = frappe.route_options && frappe.route_options.edit_invoice;
			if (edit_invoice) {
				frappe.route_options = null;
				this._apply_edit_invoice(edit_invoice);
				return;
			}
			this._load();
			if (!this.tabs.length) this._new_bill(false);
			this.render();
		});
	},

	// A converted Quotation/Sales Order arrives here unsaved (see
	// on_page_show above) — opened as a fresh bill tab rather than merged
	// into whatever the cashier already had open, since the two are
	// unrelated sales.
	async _apply_prefill(doc, source_doctype = null) {
		const b = this._new_bill(true);
		// Not _pick_customer(): it reaches into this.$root, which render()
		// below is what creates in the first place — setting the bill's own
		// fields directly is what render()'s own template already reads
		// (customer_label) to show the right name on first paint.
		if (doc.customer) {
			b.customer = doc.customer;
			b.customer_label = doc.customer_name || doc.customer;
		}
		if (doc.discount_amount) b.bill_discount = doc.discount_amount;
		this._persist_soon();
		this.render();

		const is_quotation = source_doctype === "Quotation";
		const changed_items = [];
		
		frappe.dom.freeze(__("Loading items…"));
		
		try {
			// Fetch all item rows in parallel but preserve order
			const results = await Promise.all((doc.items || []).map(async (r) => {
				const uom = r.uom || null;
				const row = await santu_sale_invoice.api.item_row(b.customer, r.item_code, this.init_data.warehouse, r.qty, uom);
				
				const uom_options = row.uoms && row.uoms.length ? row.uoms : [{ uom: row.uom || row.stock_uom, conversion_factor: 1 }];
				const r_uom = r.uom || row.uom || row.stock_uom;
				
				const current_base_price = Number(row.price_list_rate || row.rate || 0);
				const quotation_base_price = Number(r.price_list_rate || r.rate || 0);
				const quotation_final_rate = Number(r.rate || 0);
				const quotation_discount_amount = Number(r.discount_amount || 0);
				const quotation_discount_percentage = Number(r.discount_percentage || 0);
				
				// Negotiated if final rate < base price, or if explicit discount exists
				const is_negotiated = (quotation_base_price > 0 && quotation_final_rate < quotation_base_price) || quotation_discount_percentage > 0 || quotation_discount_amount > 0;
				
				// Calculate difference based on base price
				const price_diff = current_base_price - quotation_base_price;
				
				const m = {
					r, row, uom_options, r_uom,
					quotation_base_price, quotation_final_rate,
					quotation_discount_amount, quotation_discount_percentage,
					current_base_price, price_diff, is_negotiated,
					// Safe default is to keep original prices
					final_rate: quotation_final_rate,
					final_discount: quotation_discount_amount
				};
				
				if (is_quotation && Math.abs(price_diff) > 0.01) {
					changed_items.push(m);
				}
				return m;
			}));
			frappe.dom.unfreeze();
			
			if (changed_items.length > 0) {
				this._show_price_change_modal(changed_items, results, b);
				return; // Halt prefill; modal will resume it
			}
			
			this._finish_apply_prefill(results, b);
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.msgprint(__("Error loading items: {0}", [(e && e.message) || String(e)]));
		}
	},

	_finish_apply_prefill(mapped_items, b) {
		mapped_items.forEach((m) => {
			const { r, row, uom_options, r_uom, final_rate, final_discount } = m;
			b.items.push({
				id: santu_sale_invoice.utils.uid(),
				item_code: row.item_code || r.item_code,
				item_name: row.item_name || r.item_name || r.item_code,
				qty: r.qty,
				uom: r_uom,
				uom_options: uom_options,
				rate: final_rate,
				discount: final_discount,
				batch_no: null,
				available_qty: row.available_qty,
			});
			b.selected_row = b.items[b.items.length - 1].id;
		});
		this._persist_soon();
		this._render_rows();
	},

	_show_price_change_modal(changed_items, all_items, b) {
		const self = this;
		$("#santu-bill-price-change-modal").remove();
		const $m = $(`
			<div id="santu-bill-price-change-modal" class="santu-bill-modal-backdrop" style="z-index: 1050;">
				<div class="santu-bill-modal" style="max-width: 600px;">
					<div class="santu-bill-modal-head">
						<span>${__("Quotation Price Update")}</span>
						<button type="button" class="santu-bill-modal-x">✕</button>
					</div>
					<div class="santu-bill-modal-body" style="padding: 16px; font-size: 14px;">
						<p style="margin-bottom: 16px; color: #4B5563;">
							${__("Some item prices have changed since this quotation was created. Which price do you want to use?")}
						</p>
						<div class="santu-price-change-list" style="max-height: 350px; overflow-y: auto; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
						</div>
					</div>
					<div class="santu-bill-modal-foot" style="justify-content: flex-end; gap: 10px;">
						<button type="button" class="santu-bill-modal-save" style="background: #2563EB; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 500; cursor: pointer;">
							${__("Keep Quotation Price")}
						</button>
						<button type="button" class="santu-bill-modal-update" style="background: white; color: #2563EB; border: 1px solid #2563EB; padding: 8px 16px; border-radius: 6px; font-weight: 500; cursor: pointer;">
							${__("Update to Current Price")}
						</button>
					</div>
				</div>
			</div>
		`).appendTo("body");

		const $list = $m.find(".santu-price-change-list");
		changed_items.forEach((c) => {
			const diff_pct = c.quotation_base_price > 0 ? (Math.abs(c.price_diff) / c.quotation_base_price) * 100 : 0;
			const diff_sign = c.price_diff > 0 ? "+" : "";
			const diff_color = c.price_diff > 0 ? "#DC2626" : "#16A34A";
			
			$list.append(`
				<div style="border-bottom: 1px solid #F3F4F6; padding-bottom: 12px; margin-bottom: 12px;">
					<div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
						${frappe.utils.escape_html(c.r.item_name || c.r.item_code)}
						${c.is_negotiated ? `<span style="font-size: 11px; background: #FEF3C7; color: #D97706; padding: 2px 6px; border-radius: 4px; font-weight: 500;">Negotiated</span>` : ""}
					</div>
					<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 13px; color: #4B5563;">
						<div>
							<div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">Quotation</div>
							<div style="font-weight: 500;">₹ ${format_number(c.quotation_base_price, null, 2)}</div>
						</div>
						<div>
							<div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">Current</div>
							<div style="font-weight: 500;">₹ ${format_number(c.current_base_price, null, 2)}</div>
						</div>
						<div>
							<div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">Difference</div>
							<div style="font-weight: 500; color: ${diff_color}">${diff_sign}₹ ${format_number(c.price_diff, null, 2)} (${diff_sign}${diff_pct.toFixed(1)}%)</div>
						</div>
					</div>
				</div>
			`);
		});
		$list.children().last().css({"border-bottom": "none", "margin-bottom": "0", "padding-bottom": "0"});

		const close = () => {
			$m.remove();
			$(document).off("keydown.santu-bill-price-change");
			// Abort flow completely, requiring user to start over if they pressed X or Esc
		};

		$m.find(".santu-bill-modal-x").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-bill-price-change", (e) => {
			if (e.key === "Escape") close();
		});

		$m.find(".santu-bill-modal-save").on("click", () => {
			// Keep Quotation Price (Safe Default)
			// all_items already has final_rate = quotation_final_rate
			close();
			self._finish_apply_prefill(all_items, b);
		});

		$m.find(".santu-bill-modal-update").on("click", () => {
			// Update to Current Price
			changed_items.forEach((c) => {
				const m = all_items.find((i) => i.r.item_code === c.r.item_code); // find mapped item ref
				if (!m) return;
				
				// Recalculate rate while preserving discount semantic
				if (c.quotation_discount_percentage > 0) {
					m.final_rate = c.current_base_price * (1 - (c.quotation_discount_percentage / 100));
				} else if (c.quotation_base_price > c.quotation_final_rate) {
					const per_unit_discount = c.quotation_base_price - c.quotation_final_rate;
					m.final_rate = Math.max(c.current_base_price - per_unit_discount, 0);
				} else {
					m.final_rate = c.current_base_price;
				}
				// The final_discount amount (r.discount_amount) remains the same to preserve standard bill discounts if they were mapped
			});
			close();
			self._finish_apply_prefill(all_items, b);
		});
	},

	// A submitted Sales Invoice, reopened for correction (2026-08-27 direct
	// request: "Reopen the Sales Invoice... Edit item quantity/rate...
	// Generate the corrected invoice again"). Opens as its own fresh tab —
	// exactly the bill it was, with every item/price/customer/date it had —
	// tagged `editing` so _save() knows to correct the live invoice instead
	// of creating a new one. The tab title and Save button both say so
	// (render()), so nobody at the counter mistakes it for a fresh sale.
	_apply_edit_invoice(invoice_name) {
		frappe.dom.freeze(__("Loading bill…"));
		santu_sale_invoice.api
			.get_invoice_for_edit(invoice_name)
			.then((inv) => {
				frappe.dom.unfreeze();
				const b = this._new_bill(true);
				b.customer = inv.customer;
				b.customer_label = inv.customer_label;
				b.posting_date = inv.posting_date;
				const orig_payments = inv.payments || [];
				const orig_paid = orig_payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
				const is_fully_paid = (inv.outstanding_amount == null || Number(inv.outstanding_amount) <= 0.01) && (orig_paid > 0 || inv.payment_mode === "cash" || inv.is_pos);
				const first_mode = orig_payments.length && orig_payments[0].mode_of_payment ? orig_payments[0].mode_of_payment : (inv.payment_mode === "cash" ? "Cash" : "Credit");
				b.payment_mode = first_mode;
				// When the bill was fully paid (e.g. UPI / Cash sale), keep in auto mode (null) so adding items keeps Amount Received in sync with new total
				b.amount_received = is_fully_paid ? null : orig_paid;
				b.bill_discount = inv.bill_discount || 0;
				b.remarks = inv.remarks || "";
				b.editing = {
					name: inv.name,
					santu_bill_no: inv.santu_bill_no,
					original_total: inv.grand_total,
					original_paid: orig_paid,
					original_mode: first_mode,
					is_fully_paid: is_fully_paid,
				};
				this._persist_soon();
				this.render();

				// Rows arrive fully formed -- unit options and stock are resolved
				// server-side by get_invoice_for_edit, so reopening a bill is one
				// request rather than one per line, and an item retired from the
				// catalogue since the sale simply loads instead of throwing a
				// dialog for that row.
				(inv.items || []).forEach((r) => {
					b.items.push({
						id: santu_sale_invoice.utils.uid(),
						item_code: r.item_code,
						item_name: r.item_name,
						item_name: r.item_name || r.item_code,
						qty: r.qty,
						uom: r.uom,
						uom_options: r.uom_options && r.uom_options.length ? r.uom_options : [{ uom: r.uom, conversion_factor: 1 }],
						// The bill's OWN rate, not the catalogue's current
						// price — the whole point of this screen is to
						// see and fix exactly what was actually charged.
						rate: r.rate,
						discount: r.discount || 0,
						batch_no: r.batch_no || null,
						available_qty: r.available_qty,
					});
				});
				this._persist_soon();
				this._render_rows();
			})
			.catch(() => frappe.dom.unfreeze());
	},

	// ---------- state ----------
	_load() {
		try {
			const raw = localStorage.getItem(SANTU_BILL_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
				this.tabs = parsed.tabs;
				const today = frappe.datetime.get_today();
				this.tabs.forEach((t) => {
					t.items = t.items || [];
					if (!t.editing && !t.saved && t.posting_date && t.posting_date < today) {
						t.posting_date = today;
					}
				});
				this.active_id =
					parsed.active_id && this.tabs.some((t) => t.id === parsed.active_id) ? parsed.active_id : this.tabs[0].id;
			}
		} catch (e) {
			this.tabs = [];
		}
	},

	_persist() {
		try {
			localStorage.setItem(SANTU_BILL_KEY, JSON.stringify({ tabs: this.tabs, active_id: this.active_id }));
		} catch (e) {
			/* storage unavailable — screen still works */
		}
	},

	_blank_bill() {
		return {
			id: santu_sale_invoice.utils.uid(),
			posting_date: frappe.datetime.get_today(),
			customer: null,
			customer_label: "",
			items: [],
			selected_row: null,
			payment_mode: (this.init_data && (this.init_data.payment_modes || []).length) ? this.init_data.payment_modes[0].name : "Cash",
			// null = "auto": Amount Received defaults to (and live-tracks)
			// the bill's payable total, so saving without touching this
			// field means fully paid, not baaki (2026-08-19 direct request
			// — "ab se billing yahi se hogi", so Billing gets the same fix
			// just made on Sale Invoice: "hamesha baaki hi chala jaa raha
			// hai, dhyaan naa dene pe"). Typing a real number switches this
			// bill out of auto mode for a genuine partial/credit sale.
			amount_received: null,
			bill_discount: 0,
			additional_charges: 0,
			remarks: "",
			redeem_points: 0,
			is_credit: false,
		};
	},
	_new_bill(focus = true) {
		const b = this._blank_bill();
		this.tabs.push(b);
		if (focus) this.active_id = b.id;
		else if (!this.active_id) this.active_id = b.id;
		this._persist_soon();
		return b;
	},
	_bill() {
		return this.tabs.find((t) => t.id === this.active_id) || this.tabs[0];
	},

	// ---------- totals ----------
	_row_total(r) {
		const gross = (Number(r.qty) || 0) * (Number(r.rate) || 0);
		return Math.max(gross - (Number(r.discount) || 0), 0);
	},
	_totals() {
		const b = this._bill();
		// Item rate is already tax-inclusive (2026-08-18 direct request:
		// "all items SP will include taxes... simple rakh") — no separate
		// tax line to add on top. `tax_amount` on a row was never actually
		// set to anything but 0 anyway, so this was dead weight, not a real
		// calculation being removed.
		const sub = b.items.reduce((a, r) => a + this._row_total(r), 0);
		const total = Math.max(sub + (Number(b.additional_charges) || 0) - (Number(b.bill_discount) || 0), 0);
		// Reward points (back on 2026-09-06). `b.redeem_points` already holds
		// a RUPEE amount — chosen and converted in _loyalty() below — never
		// more points-worth than the bill itself, same clamp the server
		// applies again on save so a stale screen can never overspend.
		const redeem = Math.min(Number(b.redeem_points) || 0, total);
		const payable = Math.max(total - redeem, 0);
		// Auto mode (nothing typed yet) means fully paid — see the note on
		// `amount_received` in _blank_bill().
		const received = b.amount_received == null ? payable : Math.max(Number(b.amount_received) || 0, 0);
		const change = Math.max(received - payable, 0);
		// Whatever Amount Received doesn't cover becomes baaki on the
		// customer's account — computed live, no separate "credit mode"
		// needed (2026-08-18 direct request, matching Sale Invoice's single
		// partial-payment flow instead of Billing's old all-or-nothing one).
		const remaining = Math.max(payable - received, 0);
		return { sub, total, redeem, payable, received, change, remaining, qty: b.items.reduce((a, r) => a + (Number(r.qty) || 0), 0) };
	},

	render() {
		if (!this.tabs.length) this._new_bill(false);
		const today = frappe.datetime.get_today();
		const b = this._bill();
		if (!b.editing && !b.saved && b.posting_date && b.posting_date < today) {
			b.posting_date = today;
			this._persist();
		}
		const t = this._totals();
		const modes = this.init_data.payment_modes || [];
		const is_backdated = b.posting_date && b.posting_date < today;
		$(this.page.body).html(`
			<div class="santu-bill">
				<div class="santu-bill-tabbar">
					<div class="santu-bill-tabs"></div>
					<div class="santu-si2-toolbar">
						<button type="button" class="santu-si2-icon-btn santu-si2-cost-toggle" data-toolbar="privacy" title="${__("Show cost price")}">${santu_bill_icon("lock-icon.svg", "is-on-dark")}</button>
						<button type="button" class="santu-si2-icon-btn" data-action="calculator" title="Calculator">${santu_bill_icon("calculator.svg", "is-on-dark")}</button>
						<button type="button" class="santu-si2-icon-btn" data-action="return" title="${__("Sale Return")}">${santu_bill_icon("Sale.svg", "is-on-dark")}</button>
					</div>
					<button type="button" class="santu-bill-newtab">+ New Bill <span class="santu-bill-kbd">Ctrl+T</span></button>
				</div>

				<!-- Bills whose print never came out. Ported from the old Sale
				     Invoice screen: a bill that silently failed to print is
				     one the customer walked away without, and nothing else
				     tells the counter it happened. -->
				<div class="santu-bill-print-alert" style="display:none"></div>

				${
					b.editing
						? `<div class="santu-bill-edit-banner">${__("Sudhaar mode")} — ${__("Bill")} #${frappe.utils.escape_html(santu_bill_label(b.editing.santu_bill_no))} ${__("ko sudhaara ja raha hai. Save karte hi purani bill cancel hokar nayi sahi bill ban jaayegi.")}</div>`
						: ""
				}

				<div class="santu-bill-main">
					<div class="santu-bill-left">
						<div class="santu-bill-searchwrap">
							<input type="text" class="santu-bill-search" placeholder="Scan or search by item code, model no or item name" autocomplete="off">
							<span class="santu-bill-search-icon">🔍</span>
							<div class="santu-bill-dropdown" style="display:none;"></div>
						</div>

						<div class="santu-bill-gridwrap">
							<div class="santu-bill-gridscroll">
								<table class="santu-bill-grid">
									<thead>
										<tr>
											<th class="c-idx">#</th>
											<th class="c-code">ITEM CODE</th>
											<th class="c-name">ITEM NAME</th>
											<th class="c-qty">QTY</th>
											<th class="c-unit">UNIT</th>
											<th class="c-rate">PRICE/UNIT(₹)</th>
											<th class="c-disc">DISCOUNT (₹)</th>
											<th class="c-total">TOTAL(₹)</th>
											<th class="c-del"></th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
							<div class="santu-bill-gridfoot"><span class="santu-bill-grandrow">₹ 0.00</span></div>
						</div>
					</div>

					<div class="santu-bill-right">
						<div class="santu-bill-datewrap">
							<input type="date" class="santu-bill-date" value="${b.posting_date}">
							${
								is_backdated
									? `<div class="santu-bill-date-warn" style="color:#b45309;font-size:11.5px;font-weight:600;margin-top:4px;display:flex;align-items:center;gap:4px;"><span>⚠️ Purani Date (${frappe.datetime.str_to_user(b.posting_date)})</span> <a href="#" class="santu-bill-set-today" style="text-decoration:underline;color:#2563eb;cursor:pointer;">(Aaj ki karein)</a></div>`
									: ""
							}
						</div>
						<div class="santu-bill-custwrap">
							<input type="text" class="santu-bill-customer" placeholder="Search for a customer by name, phone number [F11]" value="${frappe.utils.escape_html(b.customer_label || "")}" autocomplete="off">
							<div class="santu-bill-cust-dropdown" style="display:none;"></div>
						</div>
						<div class="santu-bill-cust-info"></div>

						<div class="santu-bill-totalcard">
							<div class="santu-bill-totalcard-left">
								<span class="santu-bill-receipt">🧾</span>
								<div>
									<div class="santu-bill-total-big">Total ₹ 0.00</div>
									<div class="santu-bill-total-sub">Items: 0 , Quantity: 0</div>
								</div>
							</div>
							<button type="button" class="santu-bill-breakup">Full Breakup<br><span class="santu-bill-kbd-inline">[Ctrl+F]</span> ›</button>
						</div>

						<div class="santu-bill-payrow">
							<div class="santu-bill-field">
								<label>Payment Mode</label>
								<select class="santu-bill-mode">
									${modes.map((m) => `<option ${m.name === b.payment_mode ? "selected" : ""}>${frappe.utils.escape_html(m.name)}</option>`).join("")}
								</select>
							</div>
							<div class="santu-bill-field">
								<label>Amount Received</label>
								<div class="santu-bill-amt-wrap">
									<span class="santu-bill-rs">₹</span>
									<input type="number" min="0" step="any" class="santu-bill-received" value="${b.amount_received != null ? b.amount_received : (t.payable || "")}" placeholder="0.00">
								</div>
							</div>
						</div>

						<div class="santu-bill-loyalty-line" style="display:none"></div>

						<div class="santu-bill-spacer"></div>

						<div class="santu-bill-changerow" style="display:none">
							<span>Change to Return:</span>
							<span class="santu-bill-change">₹ 0.00</span>
						</div>
						<div class="santu-bill-baakirow" style="display:none">
							<span>Baaki Amount:</span>
							<span class="santu-bill-baaki">₹ 0.00</span>
						</div>
						<div class="santu-bill-baaki-note" style="display:none"></div>

						<!-- More / Save / Credit live INSIDE the right column, not in
						     a full-width bar under both columns. That bar used to be
						     half-filled by the F-key button grid; once those moved
						     into the More menu (2026-09-03) it held nothing but this
						     340px column pinned right, so its whole left width
						     rendered as a ~200px band of bare grey directly under
						     the item card -- the card visibly stopped short of the
						     bottom while the buttons carried on past it (2026-09-03
						     bug report + screenshot). This column is exactly as wide
						     as, and aligned with, .santu-bill-right, so it belongs in
						     it; .santu-bill-main is then the last flex child and the
						     item card grows to the true bottom. -->
						<div class="santu-bill-savecol">
						<div class="santu-bill-morewrap">
							<button type="button" class="santu-bill-more">${__("More")} \u25be</button>
							<div class="santu-bill-more-menu" style="display:none">
								<button type="button" data-act="qty">Change Quantity <b>[F2]</b></button>
								<button type="button" data-act="idisc">Item Discount <b>[F3]</b></button>
								<button type="button" data-act="remove">Remove Item <b>[F4]</b></button>
								<button type="button" data-act="rate">Sale Value <b>[F5]</b></button>
								<button type="button" data-act="unit">Change Unit <b>[F6]</b></button>
								<button type="button" data-act="rename">Item Name <b>[F7]</b></button>
								<button type="button" data-act="charges">Additional Charges <b>[F8]</b></button>
								<button type="button" data-act="bdisc">Bill Discount <b>[F9]</b></button>
								<button type="button" data-act="loyalty">Reward Points <b>[F10]</b></button>
								<button type="button" data-act="remarks">Remarks <b>[F12]</b></button>
								<div class="santu-bill-more-sep"></div>
								<button type="button" data-more="draft">${__("Draft save karo (submit nahi)")}</button>
								<button type="button" data-more="estimate" title="${__("Bill puri na karke isi saman ka Estimate bana do")}">${__("Convert to Estimate")}</button>
								<button type="button" data-more="challan" title="${__("Isi bill ke items ka Delivery Challan banao — koi payment nahi lagta")}">${__("Convert to Delivery Challan")}</button>
								<button type="button" data-more="terms">${__("Terms &amp; Conditions")}</button>
								<button type="button" data-more="note">${__("Customer ka note")}</button>
								<button type="button" data-more="photo">${__("Photo lagao")}</button>
								<button type="button" data-more="document">${__("Document lagao")}</button>
								<button type="button" data-more="bug">${__("Kuch gadbad hai? Batao")}</button>
							</div>
						</div>
						<!-- Save & Print is the big one: at a counter it is what
						     gets pressed on nearly every sale, so it should be the
						     button the hand goes to without looking (2026-09-07:
						     "save and print ka bada wale button me rakhna chahiye
						     tha... qk save and print hamesa hi use hoga"). Plain
						     Save and WhatsApp sit under it, same as before. -->
						<button type="button" class="santu-bill-save-print">🖨️ ${b.editing ? __("Update &amp; Print") : __("Save &amp; Print")} <span class="santu-bill-kbd">Ctrl+P</span></button>
						<div class="santu-bill-save-row">
							<button type="button" class="santu-bill-save">${b.editing ? __("Update Bill") : __("Save")}</button>
							<button type="button" class="santu-bill-save-whatsapp">💬 ${__("Send WhatsApp")}</button>
						</div>
						<button type="button" class="santu-bill-credit">Other/Credit Payments <span class="santu-bill-kbd">Ctrl+M</span></button>
						</div>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-bill");
		this._render_tabs();
		this._render_rows();
		this._bind();
		this._bind_toolbar();
		this._refresh_print_alert();
		this.$root.find(".santu-bill-search").focus();
		// Phone + address for whoever's already picked on this tab (reopening
		// a tab, or switching back to it) — 2026-09-03 direct request:
		// "customer select karne ke baad, naam ke neeche village/phone
		// dikhna chahiye". Billing never showed this before; other screens'
		// party widget (santu_party_inline) already does.
		if (b.customer) this._render_customer_info(b.customer);
		// "Full billing wala hi open ho jaye niche tak" — the outer Desk page
		// can scroll past the fold on shorter/native-app windows, hiding the
		// Save button. Bring the whole screen into view on open so nothing
		// below it is cut off.
		setTimeout(() => {
			const el = this.$root && this.$root[0];
			if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
		}, 0);
	},

	// Bound once per render (the whole `.santu-bill` root is rebuilt each
	// render, unlike Sale Invoice's persistent toolbar) — cost-toggle click,
	// calculator, and the current on/off icon state.
	_bind_toolbar() {
		this.$root.find('[data-toolbar="privacy"]').on("click", () => this._action("privacy"));
		this.$root.find('[data-action="calculator"]').on("click", () => this._open_calculator());
		this.$root.find('[data-action="return"]').on("click", () => this._open_return());
		this._render_cost_toggle();
		if (this._on_privacy_change) document.removeEventListener("santu-privacy-mode-change", this._on_privacy_change);
		this._on_privacy_change = () => {
			this._render_rows();
			this._render_cost_toggle();
		};
		document.addEventListener("santu-privacy-mode-change", this._on_privacy_change);
	},

	// Shows whether cost price is currently on, so it reads as a switch
	// rather than a button that seems to do nothing on a bill with no items
	// yet — same pattern as Sale Invoice's toolbar.
	_render_cost_toggle() {
		const on = !!(window.santu_is_privacy_mode_active && santu_is_privacy_mode_active());
		const $btn = this.$root.find(".santu-si2-cost-toggle");
		$btn.toggleClass("is-on", on).attr("title", on ? __("Cost price showing — click to hide") : __("Show cost price"));
		$btn.find(".santu-si2-ico").attr("src", `${SANTU_BILL_ICON_DIR}/${on ? "unlock_icon.svg" : "lock-icon.svg"}`);
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

	// Bill number OR customer, one box (2026-08-18 direct request: "sale
	// return pos billing me nh ho sakta kya" → "both 1 and 2" — search both,
	// since a walk-in cash sale has no useful customer name to search by,
	// and a named customer is usually remembered by name, not bill number).
	// Two steps in one modal: pick the bill, then pick what came back.
	_open_return() {
		const self = this;
		$("#santu-bill-return-modal").remove();
		const $m = $(`
			<div id="santu-bill-return-modal" class="santu-bill-modal-backdrop">
				<div class="santu-bill-modal santu-bill-return-modal">
					<div class="santu-bill-modal-head">
						<span>${__("Sale Return")}</span>
						<button type="button" class="santu-bill-modal-x">✕ <small>[Esc]</small></button>
					</div>
					<div class="santu-bill-modal-body santu-bill-return-body"></div>
				</div>
			</div>
		`).appendTo("body");

		const close = () => {
			$m.remove();
			$(document).off("keydown.santu-bill-ret");
		};
		$m.find(".santu-bill-modal-x").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-bill-ret", (e) => {
			if (e.key === "Escape") close();
		});

		const $body = $m.find(".santu-bill-return-body");

		const render_search_step = () => {
			$body.html(`
				<div class="santu-bill-modal-field">
					<label>${__("Bill No. or Customer Name")}</label>
					<input type="text" class="ret-search" autocomplete="off" placeholder="${__("Search by bill number or customer")}">
				</div>
				<div class="santu-bill-return-list"></div>
			`);
			const $search = $body.find(".ret-search");
			const $list = $body.find(".santu-bill-return-list");

			let seq = 0;
			const run_search = (q) => {
				const ticket = ++seq;
				santu_sales_return.api.search_invoices(q).then((rows) => {
					if (ticket !== seq) return;
					$list.empty();
					if (!rows.length) {
						$list.append(`<div class="santu-bill-modal-village-empty">${__("No bills found.")}</div>`);
						return;
					}
					rows.forEach((r) => {
						$(`
							<div class="santu-bill-return-row" data-invoice="${frappe.utils.escape_html(r.name)}">
								<div>
									<b>${frappe.utils.escape_html(santu_bill_label(r.bill_no))}</b>
									<span class="santu-bill-return-row-cust">${frappe.utils.escape_html(r.customer || "")}</span>
								</div>
								<div class="santu-bill-return-row-right">
									<span>₹${format_number(r.grand_total, null, 2)}</span>
									<span class="santu-bill-return-row-date">${frappe.datetime.str_to_user(r.posting_date)}</span>
								</div>
							</div>
						`)
							.on("click", () => render_items_step(r.name, r.customer))
							.appendTo($list);
					});
				});
			};
			// Every recent bill first — same reasoning as Billing's own
			// customer search: the counter usually wants "the last few
			// sales", not an empty box until they type something.
			run_search("");
			$search.on("input", frappe.utils.debounce((e) => run_search(e.target.value.trim()), 250));
			setTimeout(() => $search.focus(), 60);
		};

		const render_items_step = (invoice, customer) => {
			$body.html(`<div class="santu-bill-return-loading">${__("Loading…")}</div>`);
			santu_sales_return.api.invoice_items(invoice).then((data) => {
				const rows = (data.items || []).filter((r) => r.returnable_qty > 0);
				if (!rows.length) {
					$body.html(`
						<div class="santu-bill-modal-village-empty">${__("Everything on this bill has already been returned.")}</div>
						<div class="santu-bill-modal-foot">
							<button type="button" class="santu-bill-modal-cancel santu-bill-return-back">${__("← Back")}</button>
						</div>
					`);
					$body.find(".santu-bill-return-back").on("click", render_search_step);
					return;
				}
				$body.html(`
					<div class="santu-bill-return-invoice-head">
						<b>${frappe.utils.escape_html(invoice)}</b>
						<span>${frappe.utils.escape_html(customer || "")}</span>
					</div>
					<div class="santu-bill-return-items"></div>
					<div class="santu-bill-modal-field">
						<label>${__("Reason (optional)")}</label>
						<input type="text" class="ret-reason" placeholder="${__("e.g. size galat tha, damaged")}">
					</div>
					<div class="santu-bill-return-total">${__("Refund")}: <b class="ret-total">₹0.00</b></div>
					<div class="santu-bill-modal-foot">
						<button type="button" class="santu-bill-modal-save ret-save">${__("Return & Refund")}</button>
						<button type="button" class="santu-bill-modal-cancel santu-bill-return-back">${__("← Back")}</button>
					</div>
				`);
				const $items = $body.find(".santu-bill-return-items");
				rows.forEach((r) => {
					$(`
						<div class="santu-bill-return-item-row" data-row='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
							<div class="santu-bill-return-item-name">
								${frappe.utils.escape_html(r.item_name)}
								<span>${__("Sold")} ${format_number(r.qty, null, 2)} ${frappe.utils.escape_html(santu_uom.abbr(r.uom) || "")} · ₹${format_number(r.rate, null, 2)}${__("/unit")}</span>
							</div>
							<input type="number" class="ret-qty-input" min="0" max="${r.returnable_qty}" step="any" value="0">
						</div>
					`).appendTo($items);
				});
				$body.find(".santu-bill-return-back").on("click", render_search_step);

				const recalc_total = () => {
					let total = 0;
					$items.find(".santu-bill-return-item-row").each(function () {
						const row = JSON.parse($(this).attr("data-row"));
						const qty = Math.min(Math.max(Number($(this).find(".ret-qty-input").val()) || 0, 0), row.returnable_qty);
						total += qty * (Number(row.rate) || 0);
					});
					$body.find(".ret-total").text(`₹${format_number(total, null, 2)}`);
					return total;
				};
				$items.on("input", ".ret-qty-input", recalc_total);
				recalc_total();

				$body.find(".ret-save").on("click", () => {
					const items = [];
					$items.find(".santu-bill-return-item-row").each(function () {
						const row = JSON.parse($(this).attr("data-row"));
						const qty = Math.min(Math.max(Number($(this).find(".ret-qty-input").val()) || 0, 0), row.returnable_qty);
						if (qty > 0) {
							items.push({
								item_code: row.item_code,
								qty,
								rate: row.rate,
								uom: row.uom,
								sales_invoice_item: row.row_name,
							});
						}
					});
					if (!items.length) {
						frappe.show_alert({ message: __("Enter a return quantity for at least one item."), indicator: "orange" });
						return;
					}
					frappe.dom.freeze(__("Saving…"));
					santu_sales_return.api
						.save(
							{
								customer,
								company: self.init_data.company,
								warehouse: self.init_data.warehouse,
								selling_price_list: self.init_data.selling_price_list,
								return_against: invoice,
								reason: $body.find(".ret-reason").val() || "",
								items,
							},
							1
						)
						.then((r) => {
							frappe.dom.unfreeze();
							close();
							frappe.show_alert({ message: __("Return saved {0}", [r.name || r]), indicator: "green" });
						})
						.catch(() => frappe.dom.unfreeze());
				});
			});
		};

		render_search_step();
	},

	_render_tabs() {
		const $t = this.$root.find(".santu-bill-tabs").empty();
		this.tabs.forEach((b, i) => {
			const label = b.saved ? b.saved.name : `#${String(this.init_data.posting_date || "").slice(0, 4)}/${i + 1}`;
			$(`
				<button type="button" data-tip="Is bill par jaayein" class="santu-bill-tab ${b.id === this.active_id ? "is-active" : ""}">
					<span>${frappe.utils.escape_html(label)}</span>
					<span class="santu-bill-tab-x">×</span>
				</button>
			`)
				.on("click", (e) => {
					if ($(e.target).hasClass("santu-bill-tab-x")) {
						this._close_tab(b.id);
						return;
					}
					this.active_id = b.id;
					this._persist_soon();
					this.render();
				})
				.appendTo($t);
		});
	},

	_close_tab(id) {
		const b = this.tabs.find((t) => t.id === id);
		if (!b) return;
		const drop = () => {
			this.tabs = this.tabs.filter((t) => t.id !== id);
			if (!this.tabs.length) this._new_bill(false);
			if (this.active_id === id) this.active_id = this.tabs[0].id;
			this._persist_soon();
			this.render();
		};
		if (!b.items.length) return drop();
		frappe.confirm(__("This bill has items. Close anyway?"), drop);
	},

	_render_rows({ reveal_row_id = null } = {}) {
		const b = this._bill();
		const privacy_on =
			typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active();
		if (privacy_on) this._fetch_costs(b);
		const $tb = this.$root.find(".santu-bill-grid tbody").empty();
		b.items.forEach((r, i) => {
			const row_hl = santu_item_row_class(r.item_code, r.item_name);
			const $tr = $(`
				<tr class="santu-bill-tr ${r.id === b.selected_row ? "is-selected" : ""} ${r.id === reveal_row_id ? "santu-bill-row-new" : ""} ${row_hl}" data-row="${r.id}">
					<td class="c-idx">
						<span class="santu-bill-idx-num">${i + 1}</span>
						<button type="button" class="santu-bill-idx-del" title="${__("Hatao")}">🗑</button>
					</td>
					<td class="c-code">${frappe.utils.escape_html(r.item_code || "-")}</td>
					<td class="c-name santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${frappe.utils.escape_html(r.item_name)}${
						r.batch_no ? `<span class="santu-bill-batch-tag">${frappe.utils.escape_html(r.batch_no)}</span>` : ""
					}${
						r.available_qty != null
							? `<span class="santu-bill-stock-note ${
									r.available_qty <= 0
										? "santu-bill-stock-out"
										: r.available_qty <= 5
											? "santu-bill-stock-low"
											: "santu-bill-stock-ok"
								}">${__("Available")}: ${format_number(r.available_qty, null, 0)} ${frappe.utils.escape_html(santu_uom.abbr(r.uom) || "")}</span>`
							: ""
					}</td>
					<td class="c-qty">
						<span class="santu-bill-qty-stepper">
							<button type="button" class="santu-bill-qty-btn" data-step="-1">−</button>
							<span class="santu-bill-editable santu-bill-qty-val" title="${__("Badalne ke liye dabaiye")}">${format_number(r.qty, null, 2)}</span>
							<button type="button" class="santu-bill-qty-btn" data-step="1">+</button>
						</span>
					</td>
					<td class="c-unit"><select class="santu-bill-unit-select"><option>${frappe.utils.escape_html(r.uom || "")}</option></select></td>
					<td class="c-rate santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.rate, null, 2)}${
						privacy_on && r.cost_price != null
							? `<span class="santu-bill-cost">${__("cost")} ₹${format_number(r.cost_price, null, 2)}</span>`
							: ""
					}</td>
					<td class="c-disc santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.discount || 0, null, 2)}</td>
					<td class="c-total">${format_number(this._row_total(r), null, 2)}</td>
					<td class="c-del">
						<!-- Push this row's rate to the item's master Selling Price
						     (2026-09-03 direct request, the follow-up once this
						     button actually had a job: "abhi jo price likha hua hai
						     sale me wo master price me update ho jaye"). The ✕ that
						     used to sit next to it is gone (2026-09-03 direct
						     request: "ye cross feature hata do") — deleting a row is
						     the # column's job now, via the hover swap. -->
						<button type="button" class="santu-bill-tick-btn" title="${__("Is row ka rate aur unit item me save karo")}">✓</button>
					</td>
				</tr>
			`);
			$tr.on("click", () => {
				b.selected_row = r.id;
				this._render_rows();
			});
			const remove_this_row = (e) => {
				e.stopPropagation();
				b.items = b.items.filter((x) => x.id !== r.id);
				b.selected_row = b.items.length ? b.items[b.items.length - 1].id : null;
				this._persist_soon();
				this._render_rows();
			};
			$tr.find(".santu-bill-tick-btn").on("click", (e) => {
				e.stopPropagation();
				this._push_rate_to_master(r);
			});
			// Delete lives in the # column now, via the hover swap
			// (2026-09-03 direct request) — the ✕ that used to sit next to
			// the tick was removed the same day ("ye cross feature hata do").
			// Hover swap itself is pure CSS (.santu-bill-idx-num/-del), this
			// just makes the swapped-in button do something.
			$tr.find(".santu-bill-idx-del").on("click", remove_this_row);
			// A real dropdown right in the row — no F6 + separate dialog
			// (2026-09-03 direct request, repeatedly: "item ki unit me
			// dropdown daal do, default uska added unit ho, use change kar
			// saku dropdown se, sare jagah"). santu_uom.convert() still does
			// the qty/rate rescale (2 Kg -> 2000 Gram, not 2 Gram) exactly
			// as the old F6 dialog did — only how the unit gets picked changed.
			const $unitSelect = $tr.find(".santu-bill-unit-select");
			$unitSelect.on("click", (e) => e.stopPropagation());
			santu_uom.fill_select($unitSelect, r.item_code, r.uom);
			$unitSelect.on("change", (e) => {
				b.selected_row = r.id;
				santu_uom.convert(r, e.target.value);
				this._persist_soon();
				this._render_rows();
			});
			// Click straight on the field to edit it in place — same
			// discoverable pattern the rest of this app already uses (Stock
			// Summary, Purchase screen). No dialog box: the cell itself turns
			// into an input (2026-08-18: "click krne p new dialog box open mt
			// karao, bs usi me edit ho jaye" — a popup dialog was one step too
			// many, edit right where the eye already is).
			$tr.find(".c-name").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				this._inline_edit($(e.currentTarget), "text", r.item_name, (v) => {
					r.item_name = (v || "").trim() || r.item_name;
				});
			});
			$tr.find(".santu-bill-qty-val").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				this._inline_edit($(e.currentTarget), "number", r.qty, (v) => {
					r.qty = Math.max(Number(v) || 0, 0);
				});
			});
			$tr.find(".santu-bill-qty-btn").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				const step = Number($(e.currentTarget).attr("data-step")) || 0;
				r.qty = Math.max((Number(r.qty) || 0) + step, 0);
				this._persist_soon();
				this._render_rows();
			});
			$tr.find(".c-rate").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				this._inline_edit($(e.currentTarget), "number", r.rate, (v) => {
					r.rate = Math.max(Number(v) || 0, 0);
				});
			});
			$tr.find(".c-disc").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				this._inline_edit($(e.currentTarget), "number", r.discount || 0, (v) => {
					r.discount = Math.max(Number(v) || 0, 0);
				});
			});
			$tb.append($tr);
		});
		this._render_totals();
		// Preserve scroll position during normal edits/recalculations. Only a
		// successful add asks for its row to be revealed after this render.
		if (reveal_row_id) window.santu_scroll_row_into_view(this.$root, { row_id: reveal_row_id });
	},

	// Swaps a grid cell's text for a plain <input> right where it is, commits
	// on blur/Enter, cancels on Escape — no dialog box (2026-08-18: "usi me
	// edit ho jaye", not a popup).
	_inline_edit($cell, type, current, apply) {
		if ($cell.find("input").length) return;
		const $input = $(
			`<input type="${type === "number" ? "number" : "text"}" class="santu-bill-inline-input" ${
				type === "number" ? 'step="any" min="0"' : ""
			}>`
		).val(current);
		$cell.empty().append($input);
		$input.trigger("focus").trigger("select");
		let done = false;
		const commit = () => {
			if (done) return;
			done = true;
			apply($input.val());
			this._persist_soon();
			this._render_rows();
		};
		const cancel = () => {
			if (done) return;
			done = true;
			this._render_rows();
		};
		$input.on("blur", commit);
		$input.on("keydown", (e) => {
			e.stopPropagation();
			// keyCode as well as key: some keyboards/IMEs (and headless
			// drivers) deliver Enter with an empty `key`, and a bill line
			// that silently refuses to commit is worse than any of this.
			const enter = e.key === "Enter" || e.keyCode === 13 || e.which === 13;
			const escape = e.key === "Escape" || e.keyCode === 27 || e.which === 27;
			if (enter) {
				e.preventDefault();
				commit();
			} else if (escape) {
				e.preventDefault();
				cancel();
			}
		});
		$input.on("click", (e) => e.stopPropagation());
	},

	_fetch_costs(b) {
		// Only asked for while the reveal is actually on, and only once per
		// item — a counter screen should not be pulling cost prices it is
		// not showing.
		b.items.forEach((r) => {
			if (r.cost_price != null || r._cost_pending || !r.item_code) return;
			r._cost_pending = true;
			frappe
				.xcall("santu_hardware.santu_hardware.api.get_item_cost_price", {
					item_code: r.item_code,
					item_name: r.item_name,
					warehouse: this.init_data.warehouse,
				})
				.then((c) => {
					r.cost_price = (c && c.cost_price != null ? c.cost_price : c) || 0;
					r._cost_pending = false;
					if (typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active()) {
						this._render_rows();
					}
				})
				.catch(() => {
					r._cost_pending = false;
				});
		});
	},

	_render_totals() {
		const b = this._bill();
		const t = this._totals();
		this.$root.find(".santu-bill-total-big").text(`Total ₹ ${format_number(t.total, null, 2)}`);
		this.$root.find(".santu-bill-total-sub").text(`Items: ${b.items.length} , Quantity: ${format_number(t.qty, null, 0)}`);
		this.$root.find(".santu-bill-grandrow").text(`₹ ${format_number(t.total, null, 2)}`);
		const $ln = this.$root.find(".santu-bill-loyalty-line");
		if (t.redeem > 0) {
			$ln.show().html(
				`<span>${__("Points used")}</span><span>- ₹ ${format_number(t.redeem, null, 2)} &nbsp;→&nbsp; ${__("To pay")} ₹ ${format_number(t.payable, null, 2)}</span>`
			);
		} else {
			$ln.hide().empty();
		}
		this.$root.find(".santu-bill-change").text(`₹ ${format_number(t.change, null, 2)}`);
		this.$root.find(".santu-bill-baaki").text(`₹ ${format_number(t.remaining, null, 2)}`);
		// Mutually exclusive by construction — received is either ≥ payable
		// (change, possibly ₹0) or < it (baaki), never both at once.
		this.$root.find(".santu-bill-changerow").toggle(t.change > 0);
		this.$root.find(".santu-bill-baakirow").toggle(t.remaining > 0);
		const $note = this.$root.find(".santu-bill-baaki-note");
		if (t.remaining > 0 && b.amount_received != null) {
			// Baaki has to land on somebody. With no party picked the old
			// wording promised it would go "to the customer's account" — which
			// customer? — and the counter only found out at Save, where the
			// bill is refused (2026-09-04). Say it up front instead, while
			// there is still something to do about it.
			$note.show().text(
				b.customer
					? __("Remaining ₹ {0} will be added to the customer's account", [format_number(t.remaining, null, 2)])
					: __("₹ {0} baaki rahega — pehle grahak chuniye, warna bill save nahi hoga.", [format_number(t.remaining, null, 2)])
			);
			$note.toggleClass("is-warning", !b.customer);
		} else {
			$note.hide().empty().removeClass("is-warning");
		}

		// Auto mode (nothing typed yet): keep the field showing the live
		// payable amount as items/discounts change, same fix as Sale
		// Invoice — save without touching this field always means fully
		// paid, not whatever the total happened to be a moment ago.
		const $received = this.$root.find(".santu-bill-received");
		if (b.amount_received == null && document.activeElement !== $received.get(0)) {
			$received.val(t.payable || "");
		}
	},

	// ---------- items ----------
	_search(q) {
		const $dd = this.$root.find(".santu-bill-dropdown");
		if (!q || q.length < 2) return $dd.hide().empty();
		santu_sale_invoice.api.search_items(q).then((res) => {
			const rows = res.results || res || [];
			$dd.empty();
			rows.forEach((it) => {
				$(`
					<div class="santu-bill-dd-row ${santu_item_dd_class(it.item_code, it.item_name)}">
						<div><b>${frappe.utils.escape_html(it.item_name)}</b><span>${frappe.utils.escape_html(it.item_code)}</span></div>
						<div class="santu-bill-dd-right">₹ ${format_number(it.price || 0, null, 2)}${
							it.available_qty != null ? `<span>${format_number(it.available_qty, null, 0)} left</span>` : ""
						}</div>
					</div>
				`)
					.on("click", () => this._add_item(it.item_code))
					.appendTo($dd);
			});
			// An exact barcode/code match is unambiguous — Vyapar drops it
			// straight into the bill rather than making you pick from a list
			// of one, which is the whole point of scanning.
			if (res.exact_match) {
				this._add_item(res.exact_match);
				return;
			}
			// "Add option to add new items jab koi already item list me naa
			// ho" (2026-08-18 direct request) — same Quick-create flow
			// Sale/Purchase already have, ported here rather than
			// duplicated: real Item, real Item Price, straight onto the
			// bill, no leaving this screen.
			$(`<div class="santu-bill-dd-row santu-bill-dd-add">+ Quick-create "${frappe.utils.escape_html(q)}"</div>`)
				.on("click", () => this._quick_create_item(q))
				.appendTo($dd);
			$dd.show();
			// Fill the empty area under the search box rather than stopping
			// at a fixed few rows -- measured, so a taller screen shows more.
			santu_sale_invoice.utils.size_dropdown($dd, this.$root.find(".santu-bill-gridwrap"));
		});
	},

	// Vyapar-style modal (2026-08-18: "isko vyapaar ki tarah banao") —
	// same compact santu-bill-modal look as Add Customer, instead of the
	// generic stacked frappe.ui.Dialog fields this used to be.
	_quick_create_item(item_name, opts = {}) {
		const self = this;
		$("#santu-bill-newitem-modal").remove();
		let uom = "Nos";
		const $m = $(`
			<div id="santu-bill-newitem-modal" class="santu-bill-modal-backdrop">
				<div class="santu-bill-modal">
					<div class="santu-bill-modal-head">
						<span>${__("Naya Saman Jodein")}</span>
						<button type="button" class="santu-bill-modal-x">✕ <small>[Esc]</small></button>
					</div>
					<div class="santu-bill-modal-body">
						<div class="santu-bill-modal-field">
							<label>${__("Saman ka naam")}<em>*</em></label>
							<input type="text" class="ni-name" value="${frappe.utils.escape_html(item_name || "")}">
							<div class="ni-same-name-warning"></div>
						</div>
						<div class="santu-bill-modal-grid">
							<div class="santu-bill-modal-field">
								<label>${__("Barcode")}</label>
								<input type="text" class="ni-barcode" value="${frappe.utils.escape_html(opts.barcode || "")}" ${opts.barcode ? "readonly" : ""} placeholder="${__("Scan karke bhar jayega")}">
							</div>
							<div class="santu-bill-modal-field">
								<label>${__("Abhi kitna hai?")}<em>*</em></label>
								<input type="number" step="any" min="0" class="ni-opening-qty" placeholder="0">
							</div>
						</div>
						<div class="santu-bill-modal-field">
							<label>${__("Unit")}</label>
							<div class="ni-uom-picker">${__("Unit…")}</div>
						</div>
						<div class="santu-bill-modal-grid">
							<div class="santu-bill-modal-field">
								<label>${__("Kharid ka daam")}<span class="santu-bill-modal-hint">${__("Optional")}</span></label>
								<input type="number" step="any" min="0" class="ni-cost-price" placeholder="₹ 0.00">
							</div>
							<div class="santu-bill-modal-field">
								<label>${__("MRP")}<span class="santu-bill-modal-hint">${__("Optional")}</span></label>
								<input type="number" step="any" min="0" class="ni-mrp" placeholder="₹ 0.00">
							</div>
						</div>
						<div class="santu-bill-modal-grid">
							<div class="santu-bill-modal-field">
								<label>${__("Discount %")}<span class="santu-bill-modal-hint">${__("Optional")}</span></label>
								<input type="number" step="any" min="0" max="100" class="ni-discount-pct" placeholder="0">
							</div>
							<div class="santu-bill-modal-field">
								<label>${__("Bechne ka daam")}<em>*</em></label>
								<input type="number" step="any" min="0" class="ni-selling-price" placeholder="₹ 0.00">
							</div>
						</div>
						<div class="santu-bill-modal-field">
							<label>${__("HSN code")}<span class="santu-bill-modal-hint">${__("Optional — pehle se hua to apne aap lag jayega")}</span></label>
							<input type="text" class="ni-hsn" placeholder="${__("HSN code")}">
						</div>
					</div>
					<div class="santu-bill-modal-foot">
						<button type="button" class="santu-bill-modal-save">${__("Banao aur bill me daalo")}</button>
						<button type="button" class="santu-bill-modal-cancel">${__("Cancel")}</button>
					</div>
				</div>
			</div>
		`).appendTo("body");

		const close = () => {
			$m.remove();
			$(document).off("keydown.santu-bill-ni");
		};
		$m.find(".santu-bill-modal-x, .santu-bill-modal-cancel").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-bill-ni", (e) => {
			if (e.key === "Escape") close();
		});

		// The duplicates already in this catalog were not created on
		// purpose — someone typed a name that already existed and nothing
		// said so. Say so, offer the existing item, but never refuse: the
		// same name in two pack sizes is normal in a hardware shop.
		const $warn = $m.find(".ni-same-name-warning");
		const check_name = (name) => {
			if (!name || !name.trim()) return $warn.empty();
			santu_sale_invoice.api
				.items_with_same_name(name)
				.then((matches) => {
					$warn.empty();
					if (!matches || !matches.length) return;
					const list = matches
						.map(
							(m) =>
								`<button type="button" class="santu-si2-dup-existing" data-code="${frappe.utils.escape_html(m.item_code)}">
									${frappe.utils.escape_html(m.item_code)}
									<span>${m.available_qty != null ? m.available_qty + " " + santu_uom.abbr(m.stock_uom || "") : ""}</span>
								</button>`
						)
						.join("");
					$warn.append(
						`<div class="santu-si2-dup-warn">
							<div><b>${__("Is naam ka saman pehle se hai")}</b> — ${__("naya banane ki zaroorat hai kya?")}</div>
							<div class="santu-si2-dup-existing-wrap">${list}</div>
						</div>`
					);
					$warn.find(".santu-si2-dup-existing").on("click", (e) => {
						close();
						self._add_item($(e.currentTarget).data("code"));
					});
				})
				.catch(() => $warn.empty());
		};
		check_name(item_name);
		$m.find(".ni-name").on("input", frappe.utils.debounce((e) => check_name(e.target.value), 400));

		uom = this._render_uom_picker_inline($m.find(".ni-uom-picker"), uom, (v) => (uom = v));

		// MRP - Discount% auto-fills Bechne ka daam; the cashier can still
		// type over it by hand (2026-08-26: "ISME MRP AUR DISCOUNT KA OPTION
		// DEDO; YAH SELLING PRICE AUTO CALCULATE HO JYE").
		const recalc_selling_price = () => {
			const mrp = Number($m.find(".ni-mrp").val());
			const discount_pct = Number($m.find(".ni-discount-pct").val());
			if (!mrp || mrp <= 0) return;
			const selling = mrp - (mrp * (discount_pct || 0)) / 100;
			$m.find(".ni-selling-price").val(selling.toFixed(2));
		};
		$m.find(".ni-mrp, .ni-discount-pct").on("input", recalc_selling_price);

		$m.find(".santu-bill-modal-save").on("click", () => {
			const name = ($m.find(".ni-name").val() || "").trim();
			const selling_price = $m.find(".ni-selling-price").val();
			if (!name) {
				frappe.show_alert({ message: __("Saman ka naam daalein."), indicator: "orange" });
				return;
			}
			if (!selling_price || Number(selling_price) <= 0) {
				frappe.show_alert({ message: __("Bechne ka daam daalein."), indicator: "orange" });
				return;
			}
			const opening_qty = $m.find(".ni-opening-qty").val();
			if (!opening_qty || Number(opening_qty) <= 0) {
				frappe.show_alert({ message: __("Abhi kitna hai — batana zaroori hai."), indicator: "orange" });
				return;
			}
			frappe.dom.freeze(__("Saman ban raha hai…"));
			santu_sale_invoice.api
				.quick_create_item(name, selling_price, {
					uom,
					opening_qty,
					cost_price: $m.find(".ni-cost-price").val() || undefined,
					barcode: $m.find(".ni-barcode").val() || undefined,
					gst_hsn_code: $m.find(".ni-hsn").val() || undefined,
				})
				.then((r) => {
					frappe.dom.unfreeze();
					close();
					if (r.opening_qty) {
						frappe.show_alert({
							message: __("{0} — {1} {2} stock me chadh gaya", [r.item_name, r.opening_qty, r.uom]),
							indicator: "green",
						});
					}
					self._add_item(r.item_code);
				})
				.catch((err) => {
					frappe.dom.unfreeze();
					frappe.msgprint({
						title: __("Saman nahi ban paya"),
						indicator: "red",
						message: (err && err.message) || __("Dobara koshish karein."),
					});
				});
		});

		setTimeout(() => $m.find(".ni-name").focus().select(), 60);
	},

	// Same one-tap-common-units picker Sale Invoice's quick-create uses —
	// ERPNext ships 264 alphabetical units, "Nos"/"Box" sit past Hectare.
	// Plain-HTML variant for the Vyapar-style modal (no frappe.ui.Dialog
	// field wrapper here) — reports the picked unit back through `on_pick`.
	_render_uom_picker_inline($slot, initial, on_pick) {
		$slot.html(`<div class="santu-si2-uom-loading">${__("Unit…")}</div>`);
		santu_sale_invoice.api
			.uom_options()
			.then((rows) => {
				if (!rows || !rows.length) return $slot.empty();
				const quick = rows.filter((r) => r.group !== "baaki");
				const rest = rows.filter((r) => r.group === "baaki");
				$slot.html(`
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
					on_pick(value);
					$slot.find(".santu-si2-uom-chip").each(function () {
						$(this).toggleClass("is-on", $(this).data("uom") === value);
					});
					const in_rest = rest.some((r) => r.name === value);
					$slot.find(".santu-si2-uom-more").val(in_rest ? value : "");
				};

				$slot.find(".santu-si2-uom-chip").on("click", (e) => mark($(e.currentTarget).data("uom")));
				$slot.find(".santu-si2-uom-more").on("change", (e) => {
					if (e.target.value) mark(e.target.value);
				});
				mark(initial || (quick[0] && quick[0].name) || "Nos");
			})
			.catch(() => {
				$slot.html(
					`<input type="text" class="form-control santu-si2-uom-fallback" value="${frappe.utils.escape_html(initial || "Nos")}">`
				);
				$slot.find(".santu-si2-uom-fallback").on("input", (e) => on_pick(e.target.value));
			});
		return initial;
	},

	_add_item(item_code) {
		const b = this._bill();
		this.$root.find(".santu-bill-dropdown").hide().empty();
		this.$root.find(".santu-bill-search").val("").focus();
		santu_sale_invoice.api.item_row(b.customer, item_code, this.init_data.warehouse, 1).then((row) => {
			// A batch-tracked item can't go on a bill without naming a batch —
			// ERPNext refuses the invoice otherwise. Ask which one, showing the
			// stock and price that differ between them, rather than guessing
			// and quietly billing the wrong batch's price (2026-08-18).
			if (row.has_batch_no && (row.batches || []).length) {
				this._pick_batch(row, (batch) => this._push_item(row, item_code, batch));
				return;
			}
			if (row.has_batch_no) {
				frappe.msgprint(__("{0} is batch-tracked but has no batch in stock.", [row.item_name || item_code]));
				return;
			}
			this._push_item(row, item_code, null);
		});
	},

	_push_item(row, item_code, batch) {
		const b = this._bill();
		// Same batch of the same item stacks; a different batch is its own
		// line, because its price and identity are genuinely different.
		const existing = b.items.find(
			(r) => r.item_code === item_code && (r.batch_no || null) === (batch ? batch.batch_no : null)
		);
		if (existing) {
			existing.qty += 1;
			// Duplicate items merge into this line, so reveal the line whose
			// quantity just changed rather than leaving it off-screen.
			b.selected_row = existing.id;
		} else {
			b.items.push({
				id: santu_sale_invoice.utils.uid(),
				item_code: row.item_code || item_code,
				item_name: row.item_name || item_code,
				qty: 1,
				uom: row.uom || row.stock_uom,
				uom_options: row.uoms && row.uoms.length ? row.uoms : [{ uom: row.uom || row.stock_uom, conversion_factor: 1 }],
				// ERPNext's get_item_details leaves `rate` at 0 until a pricing
				// rule or margin applies; the sellable price is price_list_rate.
				// Same order the Sale Invoice screen uses. A batch with its own
				// rate wins, since that is the price this stock was set at.
				rate: batch && batch.rate ? batch.rate : row.price_list_rate || row.rate || 0,
				discount: 0,
				batch_no: batch ? batch.batch_no : null,
				available_qty: row.available_qty,
			});
			b.selected_row = b.items[b.items.length - 1].id;
		}
		this._persist_soon();
		this._render_rows({ reveal_row_id: b.selected_row });
	},

	_pick_batch(row, on_pick) {
		const batches = row.batches || [];
		// One batch and nothing to choose between — don't make the counter
		// tap through a dialog that has a single answer.
		if (batches.length === 1) return on_pick(batches[0]);

		const d = new frappe.ui.Dialog({
			title: __("Which batch? — {0}", [row.item_name || row.item_code]),
			fields: [{ fieldtype: "HTML", fieldname: "list" }],
		});
		const $list = $(`<div class="santu-bill-batchlist"></div>`);
		batches.forEach((batch) => {
			$(`
				<div class="santu-bill-batch-row">
					<div>
						<b>${frappe.utils.escape_html(batch.batch_no)}</b>
						<span class="santu-bill-batch-sub">${__("Stock")}: ${format_number(batch.qty, null, 2)}${
							batch.expiry_date ? ` · ${__("Expiry")}: ${frappe.datetime.str_to_user(batch.expiry_date)}` : ""
						}</span>
					</div>
					<div class="santu-bill-batch-right">
						<span>₹${format_number(batch.rate, null, 2)}</span>
						<span class="santu-bill-batch-sub">${batch.mrp ? `${__("MRP")} ₹${format_number(batch.mrp, null, 2)}` : ""}</span>
					</div>
				</div>
			`)
				.on("click", () => {
					d.hide();
					on_pick(batch);
				})
				.appendTo($list);
		});
		d.fields_dict.list.$wrapper.html($list);
		d.show();
	},

	_selected() {
		const b = this._bill();
		const r = b.items.find((x) => x.id === b.selected_row);
		if (!r) frappe.show_alert({ message: __("Pick a row first."), indicator: "orange" });
		return r;
	},

	_prompt(title, label, fieldtype, current, apply) {
		const d = new frappe.ui.Dialog({
			title,
			fields: [{ fieldtype, fieldname: "v", label, default: current, reqd: 1 }],
			primary_action_label: __("OK"),
			primary_action: (v) => {
				apply(v.v);
				d.hide();
				this._persist_soon();
				this._render_rows();
			},
		});
		d.show();
		setTimeout(() => d.fields_dict.v.$input && d.fields_dict.v.$input.select(), 250);
	},

	_action(act) {
		const b = this._bill();
		if (act === "qty") {
			const r = this._selected();
			if (r) this._prompt(__("Change Quantity"), __("Quantity"), "Float", r.qty, (v) => (r.qty = Math.max(Number(v) || 0, 0)));
		} else if (act === "idisc") {
			const r = this._selected();
			if (r) this._prompt(__("Item Discount"), __("Discount (₹)"), "Currency", r.discount, (v) => (r.discount = Math.max(Number(v) || 0, 0)));
		} else if (act === "rate") {
			// Bill-line only — this changes what THIS bill charges for the
			// item, same scope as Quantity/Discount above it. It does not
			// touch the item's own Selling Price in the catalog (2026-08-18
			// direct request: every row's sale value should be editable).
			const r = this._selected();
			if (r) this._prompt(__("Sale Value"), __("Price per unit (₹)"), "Currency", r.rate, (v) => (r.rate = Math.max(Number(v) || 0, 0)));
		} else if (act === "rename") {
			// Same scope as above — this bill's line only, not a rename of
			// the actual Item master (that stays a deliberate, separate,
			// catalog-wide action elsewhere, not a quick in-bill edit).
			const r = this._selected();
			if (r) this._prompt(__("Item Name"), __("Name on this bill"), "Data", r.item_name, (v) => (r.item_name = (v || "").trim() || r.item_name));
		} else if (act === "remove") {
			const r = this._selected();
			if (r) {
				b.items = b.items.filter((x) => x.id !== r.id);
				b.selected_row = b.items.length ? b.items[b.items.length - 1].id : null;
				this._persist_soon();
				this._render_rows();
			}
		} else if (act === "unit") {
			const r = this._selected();
			if (!r) return;
			// Shared dialog (santu_uom): it offers the item's full unit list
			// and rescales qty/rate together, which this screen's own copy
			// did not -- switching Kg to Gram here used to leave "2" and
			// "1600" untouched, quietly turning a 2 Kg line into 2 grams.
			santu_uom.dialog(r, () => {
				this._persist_soon();
				this._render_rows();
			});
		} else if (act === "charges") {
			this._prompt(__("Additional Charges"), __("Amount (₹)"), "Currency", b.additional_charges, (v) => (b.additional_charges = Math.max(Number(v) || 0, 0)));
		} else if (act === "bdisc") {
			this._prompt(__("Bill Discount"), __("Discount (₹)"), "Currency", b.bill_discount, (v) => (b.bill_discount = Math.max(Number(v) || 0, 0)));
		} else if (act === "remarks") {
			this._prompt(__("Remarks"), __("Note"), "Small Text", b.remarks, (v) => (b.remarks = v || ""));
		} else if (act === "loyalty") {
			this._loyalty();
		} else if (act === "privacy") {
			// Cost price is deliberately absent from the counter screen: the
			// customer is standing on the other side of it. Unlocking is
			// gated by fingerprint or PIN (santu_privacy.js) and switches
			// itself back off after a few seconds.
			Promise.resolve(window.santu_toggle_privacy_mode()).then(() => this._render_rows());
		}
	},

	// Back on (2026-09-06 direct request: "utility me loyality wala add kr
	// de, sara system"). Same shape it had before being switched off
	// 2026-08-18 — nothing rebuilt, only unwound.
	_loyalty() {
		const b = this._bill();
		const t = this._totals();
		if (!b.items.length) {
			frappe.show_alert({ message: __("Add some items first, then use points."), indicator: "orange" });
			return;
		}
		// Points belong to a named person. There is no "Walk-in Customer" in
		// this shop (that record does not exist; counter sales go on "SALES",
		// which earns nothing by design) -- so ask for the customer instead of
		// guessing one that cannot have points.
		if (!b.customer) {
			frappe.show_alert({
				message: __("Pehle grahak chuniye (F11) — reward points naam wale grahak ke hote hain."),
				indicator: "orange",
			});
			this.$root.find(".santu-bill-customer").focus();
			return;
		}
		const customer = b.customer;
		frappe.call({
			method: "santu_hardware.santu_hardware.api.get_loyalty_status",
			args: { customer },
			freeze: true,
			freeze_message: __("Checking points…"),
			callback: (r) => {
				const st = r.message || {};
				if (!st.enrolled) {
					frappe.show_alert({ message: __("{0} is not in the rewards scheme.", [customer]), indicator: "blue" });
					return;
				}
				if (!st.points) {
					frappe.msgprint({
						title: __("No points yet"),
						message: __("{0} has 0 points. Points build up at 1 point for every ₹{1} of billing.", [customer, format_number(st.spend_per_point || 100, null, 0)]),
						indicator: "blue",
					});
					return;
				}
				// Never let a bill be paid entirely by points beyond its own
				// value — ERPNext would reject it and the operator would be
				// left staring at a stack trace mid-sale.
				//
				// Rounded DOWN to 2 decimals, not floored to a whole number:
				// points are earned as real fractions since 2026-09-07 (a
				// ₹460 bill earns 4.6), so flooring stranded the fraction of
				// every balance forever — and a customer holding 0.4 points
				// was told "Can use now: 0" while the screen above it said
				// they had points (2026-09-08 bug report).
				const max_points = Math.floor(Math.min(st.points, t.total / (st.conversion_factor || 1)) * 100) / 100;
				const d = new frappe.ui.Dialog({
					title: __("Use Reward Points"),
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "info",
							options: `<div class="santu-bill-loyalty-info">
								<div><b>${frappe.utils.escape_html(customer)}</b></div>
								<div>${__("Points in account")}: <b>${format_number(st.points, null, 2)}</b> (${__("worth")} ₹ ${format_number(st.value, null, 2)})</div>
								${st.pending_points ? `<div style="color:#d97706;">${__("Pending")}: ${format_number(st.pending_points, null, 2)} ${__("points")} — ${__("udhaar wale bill ka paisa aane par milenge")}</div>` : ""}
								<div>${__("This bill")}: ₹ ${format_number(t.total, null, 2)}</div>
								<div>${__("Can use now")}: <b>${format_number(max_points, null, 2)}</b> ${__("points")}</div>
							</div>`,
						},
						{
							// Float, not Int — a balance of 4.6 must be usable
							// as 4.6, not 4 (see max_points above).
							fieldtype: "Float",
							precision: 2,
							fieldname: "points",
							label: __("Points to use"),
							default: b.redeem_points ? flt(b.redeem_points / (st.conversion_factor || 1), 2) : max_points,
							description: __("1 point = ₹ {0} off. Leave 0 to use none.", [format_number(st.conversion_factor || 1, null, 2)]),
						},
					],
					primary_action_label: __("Apply"),
					primary_action: (v) => {
						const pts = Math.max(Math.min(flt(v.points, 2), max_points), 0);
						b.redeem_points = flt(pts * (st.conversion_factor || 1), 2);
						d.hide();
						this._persist_soon();
						this._render_totals();
						frappe.show_alert({
							message: pts
								? __("{0} points used — ₹ {1} off.", [format_number(pts, null, 2), format_number(b.redeem_points, null, 2)])
								: __("No points used."),
							indicator: "green",
						});
					},
				});
				d.show();
			},
		});
	},

	_breakup() {
		const t = this._totals();
		const b = this._bill();
		const line = (l, v, cls) =>
			`<div class="santu-bill-bk-row ${cls || ""}"><span>${l}</span><span>:</span><span>₹ ${format_number(v, null, 2)}</span></div>`;
		const d = new frappe.ui.Dialog({ title: __("Full Bill Breakup"), fields: [{ fieldtype: "HTML", fieldname: "bk" }] });
		d.fields_dict.bk.$wrapper.html(`
			<div class="santu-bill-bk">
				${line("Sub Total", t.sub)}
				${b.additional_charges ? line("Additional Charges", b.additional_charges) : ""}
				${b.bill_discount ? line("Bill Discount", -b.bill_discount) : ""}
				${t.redeem ? line("Points Used", -t.redeem) : ""}
				${line("Total", t.total, "is-total")}
			</div>
		`);
		d.show();
	},

	// ---------- customer ----------
	_pick_customer(name, label) {
		const b = this._bill();
		b.customer = name;
		b.customer_label = label;
		// Points belong to whoever was on the bill a moment ago; carrying
		// them onto a different customer would spend the wrong person's
		// balance without anyone noticing.
		b.redeem_points = 0;
		this.$root.find(".santu-bill-customer").val(label);
		this.$root.find(".santu-bill-cust-dropdown").hide().empty();
		this._render_customer_info(name);
		// The baaki note reads b.customer ("pehle grahak chuniye..."), so it
		// has to be redrawn the moment a party is picked — otherwise the
		// warning stays on screen after the thing it asks for is done.
		this._render_totals();
		this._persist_soon();
	},

	// Small phone/address line under the customer box, right where it used
	// to just go blank after picking someone (2026-09-03 direct request:
	// "customer select karne ke baad, naam ke neeche village/phone dikhna
	// chahiye, ye gayab ho gaya"). Reuses the same customer_details call
	// santu_party_inline's info card uses elsewhere — no new endpoint.
	_render_customer_info(customer) {
		const $info = this.$root.find(".santu-bill-cust-info");
		if (!customer) {
			$info.empty();
			return;
		}
		santu_sale_invoice.api.customer_details(customer).then((d) => {
			if (!d || !d.name) {
				$info.empty();
				return;
			}
			const bits = [d.address, d.mobile_no].filter(Boolean);
			$info.html(bits.length ? frappe.utils.escape_html(bits.join(" · ")) : `<span class="santu-bill-cust-info-empty">${__("No phone/address on file")}</span>`);
		});
	},

	_cust_search(q) {
		const $dd = this.$root.find(".santu-bill-cust-dropdown");
		const draw = (rows) => {
			$dd.empty();
			if (rows.length) {
				$dd.append(`<div class="santu-bill-cust-head"><span>Name</span><span>Phone Number</span></div>`);
			}
			rows.forEach((c) => {
				const $row = $(`
					<div class="santu-bill-cust-row">
						<span>${frappe.utils.escape_html(c.customer_name)}</span>
						<span class="santu-bill-cust-phone">${frappe.utils.escape_html(c.mobile_no || "—")}</span>
						<button type="button" class="santu-bill-cust-edit" title="${__("Edit customer")}">✏️</button>
					</div>
				`).appendTo($dd);
				$row.on("click", () => this._pick_customer(c.name, c.customer_name));
				// 2026-09-03 direct request: "yaha ek pencil dal do, customer
				// data edit kr sakoon" — stopPropagation so it edits instead
				// of also picking the row it sits on.
				$row.find(".santu-bill-cust-edit").on("click", (e) => {
					e.stopPropagation();
					this._edit_customer(c.name);
				});
			});
			// Always offered, results or not — at a counter the customer in
			// front of you is usually the one who isn't in the list yet.
			$(`<button type="button" class="santu-bill-addcust">Add Customer <span class="santu-bill-kbd">Ctrl+D</span></button>`)
				.on("click", (e) => { e.stopPropagation(); this._add_customer(this.$root.find(".santu-bill-customer").val()); })
				.appendTo($dd);
			$dd.show();
		};

		// An empty box used to show nothing but the Add Customer button, so a
		// cashier who could not recall how a regular's name is spelled had no
		// way to reach them — they could only search for something they
		// already knew. Clicking in now lists everyone, most recently dealt
		// with first, and the dropdown scrolls (2026-08-29 direct request).
		// One call covers both cases: it searches name AND phone when there is
		// a query, and lists all when there isn't.
		santu_sale_invoice.api
			.list_customers_for_picker(q)
			.then((rows) => draw(rows || []))
			.catch(() => draw([]));
	},

	// Pencil on a search row (2026-09-03 direct request: "yaha ek pencil dal
	// do, customer data edit kr sakoon") — same inline-in-dropdown form as
	// _add_customer, pre-filled, saving through update_party_details
	// (rename-safe: a changed name goes through frappe.rename_doc there, so
	// every linked invoice/payment follows rather than pointing at a party
	// that no longer exists).
	_edit_customer(customer_id) {
		const self = this;
		const $dd = this.$root.find(".santu-bill-cust-dropdown");
		santu_sale_invoice.api.customer_details(customer_id).then((d) => {
			$dd.empty().html(`
				<div class="santu-bill-addcust-inline">
					<div class="santu-bill-modal-grid">
						<div class="santu-bill-modal-field">
							<label>Customer Name<em>*</em></label>
							<input type="text" class="ac-name" value="${frappe.utils.escape_html(d.customer_name || "")}">
						</div>
						<div class="santu-bill-modal-field">
							<label>Phone Number</label>
							<input type="text" class="ac-phone" value="${frappe.utils.escape_html(d.mobile_no || "")}" placeholder="Phone Number">
						</div>
					</div>
					<div class="santu-bill-modal-field">
						<label>Address</label>
						<textarea class="ac-address" rows="2" placeholder="Kuch bhi likh sakte hain">${frappe.utils.escape_html(d.address || "")}</textarea>
					</div>
					<div class="santu-bill-addcust-actions">
						<button type="button" class="santu-bill-modal-cancel">Cancel</button>
						<button type="button" class="santu-bill-modal-save">Save</button>
					</div>
				</div>
			`).show();

			const close = () => $dd.hide().empty();
			$dd.find(".santu-bill-modal-cancel").on("click", close);
			$dd.find(".santu-bill-modal-save").on("click", () => {
				const name = ($dd.find(".ac-name").val() || "").trim();
				const phone = ($dd.find(".ac-phone").val() || "").trim();
				const address = ($dd.find(".ac-address").val() || "").trim();
				if (!name) {
					frappe.show_alert({ message: __("Enter a customer name."), indicator: "orange" });
					return;
				}
				const $btn = $dd.find(".santu-bill-modal-save").prop("disabled", true).text(__("Saving…"));
				santu_sale_invoice.api
					.update_customer_inline(customer_id, name, phone, address)
					.then((r) => {
						frappe.show_alert({ message: __("Customer updated"), indicator: "green" });
						close();
						self._pick_customer((r && r.party) || customer_id, name);
					})
					.catch(() => $btn.prop("disabled", false).text(__("Save")));
			});

			setTimeout(() => $dd.find(".ac-name").focus(), 60);
		});
	},

	// Keeps Billing's own compact Vyapar-style modal look (2026-08-18: "jo ui
	// h wo vyapar ka dalo" — the plain frappe.ui.Dialog from Sale Invoice
	// didn't match). One free-text Address field (2026-08-27 direct
	// request: "district & pin ka concept hata do, only address ka rakho,
	// it can be anything jo bhaiya dale") — no village/pincode/district
	// split or autocomplete any more.
	// Renders right inside the existing customer dropdown, in the empty
	// space already there under the search box — not a separate popup
	// (2026-09-03 direct request: "add customer ke liye new window kyun
	// khol rahe ho, same dialog me hi sab kuch ho jaye, niche kaafi space
	// hai"). Was a `.santu-bill-modal-backdrop` appended to <body>.
	_add_customer(prefill) {
		const self = this;
		const $dd = this.$root.find(".santu-bill-cust-dropdown");
		$dd.empty().html(`
			<div class="santu-bill-addcust-inline">
				<div class="santu-bill-modal-grid">
					<div class="santu-bill-modal-field">
						<label>Customer Name<em>*</em></label>
						<input type="text" class="ac-name" value="${frappe.utils.escape_html(prefill || "")}">
					</div>
					<div class="santu-bill-modal-field">
						<label>Phone Number</label>
						<input type="text" class="ac-phone" placeholder="Phone Number">
					</div>
				</div>
				<div class="santu-bill-modal-field">
					<label>Address</label>
					<textarea class="ac-address" rows="2" placeholder="Kuch bhi likh sakte hain"></textarea>
				</div>
				<div class="santu-bill-addcust-actions">
					<button type="button" class="santu-bill-modal-cancel">Cancel</button>
					<button type="button" class="santu-bill-modal-save">Save</button>
				</div>
			</div>
		`).show();

		const close = () => $dd.hide().empty();
		$dd.find(".santu-bill-modal-cancel").on("click", close);

		$dd.find(".santu-bill-modal-save").on("click", () => {
			const name = ($dd.find(".ac-name").val() || "").trim();
			const phone = ($dd.find(".ac-phone").val() || "").trim();
			const address = ($dd.find(".ac-address").val() || "").trim();
			if (!name) {
				frappe.show_alert({ message: __("Enter a customer name."), indicator: "orange" });
				return;
			}
			// Phone and address are a pair — both or neither.
			if (Boolean(phone) !== Boolean(address)) {
				frappe.show_alert({
					message: __("Phone number aur address dono do, ya dono chhod do — sirf ek nahi."),
					indicator: "orange",
				});
				return;
			}
			const payload = { customer_name: name, phone, address };
			frappe.dom.freeze(__("Saving…"));
			santu_sale_invoice.api
				.create_customer_full(payload)
				.then((created) => {
					frappe.dom.unfreeze();
					close();
					self._pick_customer(created, name);
					frappe.show_alert({ message: __("Customer added"), indicator: "green" });
				})
				.catch(() => frappe.dom.unfreeze());
		});

		setTimeout(() => $dd.find(".ac-name").focus().select(), 60);
	},

	// ---------- save ----------
	_check_backdated_warning(b, on_proceed) {
		const today = frappe.datetime.get_today();
		if (b.posting_date && b.posting_date < today && !b.editing) {
			const user_date = frappe.datetime.str_to_user(b.posting_date);
			const today_user = frappe.datetime.str_to_user(today);
			const d = new frappe.ui.Dialog({
				title: `<span style="color:#d97706;font-weight:700;">⚠️ Date Check / Warning</span>`,
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "warn_html",
						options: `
							<div style="font-size:14px;line-height:1.6;color:#374151;padding:6px 0;">
								<p style="margin-bottom:12px;">
									Aap jo bill bana rahe hain uski date <b>${user_date}</b> hai, jo ki <b>purani date (past date)</b> hai.
								</p>
								<p style="margin-bottom:8px;color:#92400e;background:#fef3c7;padding:10px 12px;border-radius:6px;border:1px solid #fde68a;">
									👉 <b>Kya aap date aaj (${today_user}) ki karna chahte hain ya purani date (${user_date}) me hi save karna hai?</b>
								</p>
							</div>
						`,
					},
				],
				primary_action_label: `✅ Aaj Ki Date (${today_user}) Karein`,
				primary_action: () => {
					d.hide();
					b.posting_date = today;
					this._persist_soon();
					this.$root.find(".santu-bill-date").val(today);
					on_proceed(false);
				},
				secondary_action_label: `Purani Date (${user_date}) Me Hi Save Karein`,
			});
			d.get_secondary_btn().on("click", () => {
				d.hide();
				on_proceed(true);
			});
			d.show();
			return;
		}
		on_proceed(false);
	},

	// Single flow now (2026-08-18 direct request) — no separate "credit"
	// mode. Whatever's actually in Amount Received gets paid; anything short
	// of the payable amount is left as baaki on the customer's account,
	// exactly like Sale Invoice's payment summary. The old `credit` boolean
	// made a blank Amount Received field silently pass as "fully paid" even
	// in credit mode (`Number(b.amount_received) || t.payable`) — using the
	// real received figure here fixes that too.
	// as_draft: save the bill WITHOUT submitting it -- nothing posts to stock
	// or the ledger, the bill can be finished later. Ported from the old Sale
	// Invoice screen (2026-08-30 consolidation).
	// ---- ported from the retired Sale Invoice screen (2026-08-30) ---------
	// Everything below used to live only on that second billing screen. It is
	// here so POS Billing is the single place a bill gets made, and it goes
	// through the SAME shared santu_sale_invoice.api the old screen used --
	// no new endpoints, no second copy of the backend wiring.

	_refresh_print_alert() {
		const $alert = this.$root && this.$root.find(".santu-bill-print-alert");
		if (!$alert || !$alert.length) return;
		santu_sale_invoice.api
			.open_print_jobs(24)
			.then((jobs) => {
				if (!jobs || !jobs.length) return $alert.hide().empty();
				// Always the shop's own bill number, never the SINV docname —
				// that internal name must never appear as a bill number. A
				// non-bill job (a customer's khata) carries its own label.
				const list = jobs
					.map((j) => frappe.utils.escape_html(j.display_name || santu_bill_label(j.bill_no)))
					.join(", ");
				$alert
					.html(
						`<span>${__("Ye bill print nahi hue")}: <b>${list}</b></span>
						 <button type="button" class="santu-bill-print-alert-btn">${__("Dobara chhapo")}</button>
						 <button type="button" class="santu-bill-print-alert-close" title="${__("Ab ye bill print nahi karna")}">&times;</button>`
					)
					.show();
				$alert.find(".santu-bill-print-alert-btn").on("click", () => this._retry_stuck_prints(jobs));
				// A bill can be genuinely abandoned — customer left, slip
				// written by hand — and the notice used to have no way out
				// (2026-08-30 request). Confirmed first: this is the only
				// reminder that the bill never printed.
				$alert.find(".santu-bill-print-alert-close").on("click", () => {
					frappe.confirm(
						__("Ye bill ab print nahi karna? Yaad-dilana band ho jayega.<br><b>{0}</b>", [list]),
						() => {
							santu_sale_invoice.api
								.dismiss_print_jobs(jobs.map((j) => j.name))
								.then(() => {
									$alert.hide().empty();
									frappe.show_alert({
										message: __("Theek hai — ab ye yaad nahi dilayenge."),
										indicator: "green",
									});
								})
								.catch(() => frappe.msgprint(__("Band nahi kar paye, dobara koshish karein.")));
						}
					);
				});
			})
			.catch(() => $alert.hide());
	},

	_retry_stuck_prints(jobs) {
		frappe.dom.freeze(__("Dobara chhap rahe hain\u2026"));
		const results = [];
		jobs
			.reduce(
				(chain, j) =>
					chain.then(() =>
						santu_sale_invoice.api
							.retry_print_job(j.name)
							.then(() => results.push([santu_bill_label(j.bill_no), true]))
							.catch(() => results.push([santu_bill_label(j.bill_no), false]))
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
						message: __("Baaki hain: {0}. Utilities \u2192 Doctor Uncle kholkar jaanchein.", [failed.join(", ")]),
					});
				} else {
					frappe.show_alert({ message: __("Sab chhap gaye"), indicator: "green" });
				}
				this._refresh_print_alert();
			});
	},

	_more(kind) {
		this.$root.find(".santu-bill-more-menu").hide();
		const b = this._bill();
		if (kind === "draft") return this._save(true);
		if (kind === "estimate") return this._convert_to_estimate();
		if (kind === "challan") return this._save_as_challan();
		if (kind === "bug") return this._report_bug(b);
		if (kind === "note") return this._customer_note(b);
		if (kind === "terms") {
			const d = new frappe.ui.Dialog({
				title: __("Terms & Conditions"),
				fields: [
					{
						fieldtype: "Small Text",
						fieldname: "terms",
						label: __("Bill ke neeche ye chhapega"),
						default: b.terms || "",
					},
				],
				primary_action_label: __("Save"),
				primary_action: (v) => {
					b.terms = (v.terms || "").trim();
					this._persist_soon();
					d.hide();
					frappe.show_alert({ message: b.terms ? __("Terms lag gaye") : __("Terms hata diye"), indicator: "green" });
				},
			});
			return d.show();
		}
		if (kind === "photo" || kind === "document") {
			// Frappe's uploader attaches to a REAL document, so there has to
			// be a saved bill first. Billing closes its tab on save, so the
			// bill to attach to is the draft one saved from this menu.
			const target = b.saved_draft || (b.editing && b.editing.name);
			if (!target) {
				frappe.msgprint({
					title: __("Pehle bill save karein"),
					indicator: "orange",
					message: __("{0} lagane ke liye bill ka hona zaroori hai. More \u2192 Draft save karo, phir yahin se laga dijiye.", [
						kind === "photo" ? __("Photo") : __("Document"),
					]),
				});
				return;
			}
			new frappe.ui.FileUploader({
				doctype: "Sales Invoice",
				docname: target,
				allow_multiple: false,
				restrictions: kind === "photo" ? { allowed_file_types: ["image/*"] } : {},
				on_success: () => frappe.show_alert({ message: __("Lag gaya"), indicator: "green" }),
			});
			return;
		}
	},

	_report_bug(b) {
		const invoice = (b && b.saved_draft) || (b && b.editing && b.editing.name) || null;
		const d = new frappe.ui.Dialog({
			title: __("Kya gadbad hui?"),
			fields: [
				{
					fieldname: "what_happened",
					fieldtype: "Small Text",
					label: __("Apni bhasha me likh do \u2014 jaisa hua waisa"),
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

	_customer_note(b) {
		if (!b.customer) {
			frappe.msgprint(__("Pehle customer chuniye."));
			return;
		}
		const d = new frappe.ui.Dialog({
			title: __("Note \u2014 {0}", [b.customer_label || b.customer]),
			fields: [
				{
					fieldtype: "Small Text",
					fieldname: "note",
					label: __("Ghar / landmark / pehchaanne ki koi baat"),
					default: b.note || "",
				},
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				const note = (v.note || "").trim();
				b.note = note;
				this._persist_soon();
				d.hide();
				santu_sale_invoice.api
					.update_customer_note(b.customer, note)
					.then(() => frappe.show_alert({ message: __("Note save ho gaya"), indicator: "green" }))
					.catch(() =>
						frappe.show_alert({ message: __("Note is bill par hai, customer par save nahi hua"), indicator: "orange" })
					);
			},
		});
		d.show();
	},

	// `after` is one of undefined/"print"/"whatsapp" -- which of the three
	// Save buttons was pressed. Threaded through to _proceed_save, which
	// fires that action directly (no confirm dialog) once the bill is saved.
	_save(as_draft, after) {
		const b = this._bill();
		if (b.editing) return this._save_edited_invoice(after);
		const t = this._totals();
		if (!b.items.length) {
			frappe.msgprint(__("Add at least one item."));
			return;
		}
		// Every bill needs a real customer — Walk-in Customer removed
		// (2026-08-27 direct request: "walk in customer ka scene hata do,
		// jo v customer hai uska naam hoga hi hoga").
		if (!b.customer) {
			frappe.msgprint(__("Select or add a customer for this bill."));
			this.$root.find(".santu-bill-customer").focus();
			return;
		}
		this._check_backdated_warning(b, (allow_backdate) =>
			this._check_stock_warning(b, () => this._proceed_save(b, t, allow_backdate, as_draft, after))
		);
	},

	// Nothing anywhere used to stop a bill going out for stock the shop does
	// not have: `available_qty` was read only to colour the "Available: N"
	// label, save_sale_invoice never checked it, and Stock Settings has
	// allow_negative_stock ON, so ERPNext raised nothing either -- a 0-qty
	// item sold 2 pcs in silence and the Bin just went to -2 (2026-09-03 bug
	// report: "0 pcs item tha bina warning ke sell ho gya 2 pcs").
	//
	// This warns rather than blocks on purpose: at a counter the goods are
	// often physically on the shelf before anyone enters them, and refusing
	// the sale outright would stop a real customer being billed. The operator
	// has to acknowledge it, which is what was missing -- it can no longer
	// happen without someone seeing it.
	_check_stock_warning(b, on_proceed) {
		// available_qty rides in the row's OWN unit (santu_uom.convert scales
		// it alongside qty), so these are directly comparable. A null means
		// the screen never learned the stock -- don't invent a warning for it.
		const short = (b.items || []).filter(
			(r) => r.available_qty != null && flt(r.qty) > flt(r.available_qty)
		);
		if (!short.length) return on_proceed();

		const rows = short
			.map((r) => {
				const unit = frappe.utils.escape_html(santu_uom.abbr(r.uom) || "");
				const have = format_number(flt(r.available_qty), null, 0);
				const want = format_number(flt(r.qty), null, 0);
				return `<tr>
					<td style="padding:4px 10px 4px 0;">${frappe.utils.escape_html(r.item_name || r.item_code)}</td>
					<td style="padding:4px 10px;text-align:right;color:#b91c1c;font-weight:600;white-space:nowrap;">${have} ${unit}</td>
					<td style="padding:4px 0 4px 10px;text-align:right;font-weight:600;white-space:nowrap;">${want} ${unit}</td>
				</tr>`;
			})
			.join("");

		const d = new frappe.ui.Dialog({
			title: `<span style="color:#b91c1c;font-weight:700;">⚠️ ${__("Stock kam hai")}</span>`,
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "stock_warn",
					options: `
						<div style="font-size:14px;line-height:1.6;color:#374151;padding:6px 0;">
							<p style="margin-bottom:10px;">${__("In saaman ka stock bill se kam hai:")}</p>
							<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
								<tr style="border-bottom:1px solid #e5e7eb;">
									<th style="text-align:left;padding:4px 10px 4px 0;font-size:12px;color:#6b7280;">${__("Saaman")}</th>
									<th style="text-align:right;padding:4px 10px;font-size:12px;color:#6b7280;">${__("Stock me")}</th>
									<th style="text-align:right;padding:4px 0 4px 10px;font-size:12px;color:#6b7280;">${__("Bill me")}</th>
								</tr>
								${rows}
							</table>
							<p style="margin:0;color:#92400e;background:#fef3c7;padding:10px 12px;border-radius:6px;border:1px solid #fde68a;">
								👉 ${__("Phir bhi bill banana hai? Stock minus me chala jayega.")}
							</p>
						</div>
					`,
				},
			],
			primary_action_label: __("Haan, bill banao"),
			primary_action: () => {
				d.hide();
				on_proceed();
			},
			secondary_action_label: __("Nahi, ruko"),
			secondary_action: () => d.hide(),
		});
		d.show();
	},

	// Tick button (2026-09-03 direct request, the follow-up once it had a
	// job): pushes whatever rate is on THIS bill row into the item's real
	// Standard Selling price — update_item_rate is the exact same call
	// Stock Summary's own "Selling Price" edit already uses, so a change
	// here is visible on the very next sale for every screen, not a
	// billing-only fudge.
	//
	// Item Price stores one rate for the item's stock unit, but this row can
	// be sitting in ANY unit the operator switched it to (Box, Dozen, ...).
	// santu_uom.convert() scales rate BY conversion_factor when moving
	// stock-unit -> this unit (1 pc @ 10 -> 1 box of 25 @ 250), so dividing
	// back out gets the stock-unit rate regardless of which unit is showing
	// right now — without this, ticking a row mid-Box would overwrite the
	// per-piece master price with the per-box number.
	_push_rate_to_master(r) {
		const cf = flt(santu_uom.factor(r.uom_options, r.uom)) || flt(r.conversion_factor) || 1;
		const master_rate = flt(r.rate) / cf;
		// The row's unit only counts as a change if it differs from what the
		// item is actually kept in. uom_options[0] is the item's own stock
		// unit (santu_uom.list puts it first), so that is what to compare
		// against -- not the row's starting unit, which the operator may have
		// switched several times.
		const stock_uom = (r.uom_options && r.uom_options.length && r.uom_options[0].uom) || r.uom;
		const unit_changed = !!r.uom && r.uom !== stock_uom;

		const lines = [];
		if (unit_changed) {
			lines.push(
				__("Unit: <b>{0}</b> (abhi <b>{1}</b> hai)", [
					frappe.utils.escape_html(santu_uom.abbr(r.uom) || r.uom),
					frappe.utils.escape_html(santu_uom.abbr(stock_uom) || stock_uom),
				])
			);
		}
		lines.push(
			__("Selling price: <b>₹{0}</b>{1}", [
				format_number(master_rate, null, 2),
				cf !== 1 && !unit_changed ? __(" (har {0} ka)", [frappe.utils.escape_html(santu_uom.abbr(stock_uom) || stock_uom)]) : "",
			])
		);

		frappe.confirm(
			`${frappe.utils.escape_html(r.item_name || r.item_code)}<br><br>${lines.join("<br>")}<br><br>${__(
				"Item me save kar dein?"
			)}`,
			() => {
				frappe.dom.freeze(__("Saving…"));
				frappe
					.xcall("santu_hardware.santu_hardware.api.push_bill_row_to_master", {
						item_code: r.item_code,
						rate: flt(r.rate),
						uom: unit_changed ? r.uom : null,
						conversion_factor: cf,
					})
					.then((res) => {
						frappe.dom.unfreeze();
						res = res || {};
						// The item's unit list may have just gained an entry.
						delete santu_uom._cache[r.item_code];

						const done = [];
						if (res.unit_changed && res.unit_message) done.push(res.unit_message);
						if (res.price_changed) {
							done.push(__("Selling price ab ₹{0} hai.", [format_number(res.new_rate, null, 2)]));
						}

						// A unit that could not be applied is the one thing the
						// operator must actually read, so it gets a dialog --
						// the rest is a toast (2026-09-07).
						if (res.unit_error) {
							frappe.msgprint({
								title: __("Unit nahi badla"),
								message:
									frappe.utils.escape_html(res.unit_error) +
									(done.length ? `<br><br>${frappe.utils.escape_html(done.join(" "))}` : ""),
								indicator: "orange",
							});
							return;
						}
						if (!done.length) {
							frappe.show_alert({ message: __("Kuch badla nahi — pehle se hi yahi hai."), indicator: "blue" });
							return;
						}
						frappe.show_alert({ message: done.join(" "), indicator: "green" }, 7);
					})
					.catch(() => frappe.dom.unfreeze());
			}
		);
	},

	_proceed_save(b, t, allow_backdate, as_draft, after) {
		const customer = b.customer;
		const received = t.received;
		const payments = received > 0 ? [{ mode_of_payment: b.payment_mode, amount: received }] : [];
		// save_sale_invoice reads `payment_mode` as a literal "cash"/"credit"
		// flag (it decides whether to set is_pos=1, which is what actually
		// makes the `payments` table count toward paid_amount at all) — NOT
		// the real Mode of Payment name. That real name still goes through
		// inside each `payments` row above. Sending the actual mode here
		// (e.g. "UPI") used to silently fall through to the `elif payments`
		// branch with no `is_pos`, so a ₹40-received bill saved with
		// paid_amount 0 / outstanding the full total — the received amount
		// was recorded nowhere. Same fix Sale Invoice already has
		// (`effective_mode = paid > 0 ? "cash" : "credit"`).
		const effective_mode = received > 0 ? "cash" : "credit";

		// Key pehli koshish se PEHLE banti hai, baad me nahi: agar ye koshish
		// server tak pahunch gayi aur sirf jawab kho gaya, to retry isi key se
		// purani bill pehchan lega aur grahak ko dobara bill nahi banega.
		const offline_key = window.santu_offline_queue ? window.santu_offline_queue.new_key() : null;
		// Built into a variable, not inline, so the catch below can put the
		// EXACT same bill into the offline queue without rebuilding it.
		const save_payload = {
					offline_key: offline_key,
					customer: customer,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: b.posting_date,
					allow_backdate: allow_backdate ? 1 : 0,
					selling_price_list: this.init_data.selling_price_list,
					payment_mode: effective_mode,
					payments,
					additional_discount_amount: b.bill_discount || 0,
					description: b.remarks || null,
					terms: b.terms || null,
					redeem_points: t.redeem || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						item_name: r.item_name,
						qty: r.qty,
						rate: r.rate,
						// Falls back to the item's own stock unit if the row has none.
						// Only a draft saved back when the unit dropdown still offered
						// "None" can be in that state, and without this the counter
						// just gets "Sales Invoice Item Row #1: Value missing for:
						// UOM" with no way to fix it (2026-09-04).
						uom: r.uom || r.stock_uom,
						// Without this the server has to look the factor up
						// itself; sending what the row actually used keeps the
						// bill and the stock ledger in step even if the item's
						// UOM table is edited between adding the row and saving.
						conversion_factor: santu_uom.factor(r.uom_options, r.uom),
						batch_no: r.batch_no || null,
						discount_amount: r.discount || 0,
					})),
		};

		frappe.dom.freeze(__("Saving…"));
		santu_sale_invoice.api
			.save(save_payload, as_draft ? 0 : 1)
			.then(async (r) => {
				frappe.dom.unfreeze();
				if (typeof santu_set_privacy_mode === "function" && typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active()) {
					santu_set_privacy_mode(false);
				}
				if (as_draft) {
					// A draft has posted nothing -- no stock moved, no ledger
					// entry, no bill number the customer can be given. Printing
					// or WhatsApping it would hand out a document that does not
					// exist yet, so this path stops here and keeps the tab.
					frappe.show_alert({ message: __("Draft save ho gaya: {0}. Baad me kholkar poora kar sakte hain.", [r.name]), indicator: "blue" }, 7);
					b.saved_draft = r.name;
					this._persist_soon();
					return;
				}
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				// Three explicit Save buttons replaced the old "print
				// karein?" confirm + auto-opened WhatsApp dialog (2026-09-06
				// direct request: "no extra popup. same screen pe all kaam
				// ho, baar baar is app ko puchna v nahi padega"). Whichever
				// button the operator pressed already IS their yes, so this
				// fires straight through with no further dialog.
				if (after === "print" && typeof santu_print_thermal_bill === "function") {
					await santu_print_thermal_bill("Sales Invoice", r.name, {
						bill_no: r.santu_bill_no || r.bill_no,
					});
				} else if (after === "whatsapp") {
					if (b.customer && window.santu_whatsapp_share) {
						await window.santu_whatsapp_share.send_transaction("Sales Invoice", r.name, { skip_dialog: true });
					} else {
						frappe.show_alert({ message: __("No WhatsApp number on this bill (no customer selected)."), indicator: "orange" });
					}
				}
				// Bill done: drop this tab and open a clean one, which is how
				// a counter actually works.
				this.tabs = this.tabs.filter((x) => x.id !== b.id);
				if (!this.tabs.length) this._new_bill(false);
				this.active_id = this.tabs[0].id;
				this._persist_soon();
				this.render();
			})
			.catch((e) => {
				frappe.dom.unfreeze();
				// Server ek pal ke liye nahi mila -- bill khoni nahi chahiye.
				// Queue me daal kar tab band kar dete hain taaki counter agla
				// grahak nipta sake; server aate hi ye apne aap chadh jayegi.
				//
				// Ye SIRF connection wali dikkat par hota hai. Galat data
				// (grahak nahi chuna, rate galat) dobara bhejne se bhi theek
				// nahi hoga, wo cashier ko turant dikhna chahiye.
				if (window.santu_offline_queue && window.santu_offline_queue.is_connection_problem(e)) {
					const n = window.santu_offline_queue.add(save_payload, as_draft ? 0 : 1);
					frappe.msgprint({
						title: __("Server abhi nahi mil raha"),
						indicator: "orange",
						message: __(
							"Bill SAFE hai — line me lag gaya ({0} ruke hain). Server aate hi apne aap chadh jayega.<br><br>" +
							"<b>Dhyan rakhiye:</b> jab tak nahi chadhta, is bill ka number nahi banega aur stock bhi nahi katega — " +
							"isliye abhi grahak ko parcha nahi de sakte.",
							[n]
						),
					});
					// Tab band — cashier agla grahak le sakta hai. Bill queue me safe hai.
					this.tabs = this.tabs.filter((x) => x.id !== b.id);
					if (!this.tabs.length) this._new_bill(false);
					this.active_id = this.tabs[0].id;
					this._persist_soon();
					this.render();
					return;
				}
				frappe.msgprint((e && e.message) || __("Could not save bill."));
			});
	},

	// The "Update Bill" path — for a tab opened via _apply_edit_invoice, not
	// a fresh sale. Prompts the operator with clear payment options (Cash,
	// UPI, Baaki/Credit, Split, Custom) so adding new items does not
	// blindly default to Baaki without the operator's choice.
	_save_edited_invoice(after) {
		const b = this._bill();
		if (!b.items.length) {
			frappe.msgprint(__("Add at least one item."));
			return;
		}
		if (!b.customer) {
			frappe.msgprint(__("Select a customer."));
			return;
		}
		const t = this._totals();
		const old_total = Number(b.editing.original_total) || 0;
		const old_paid = Number(b.editing.original_paid != null ? b.editing.original_paid : (b.amount_received || 0));
		const old_mode = b.editing.original_mode || b.payment_mode || "Cash";
		const new_total = t.payable;
		const diff = new_total - old_paid;
		const modes = (this.init_data && this.init_data.payment_modes && this.init_data.payment_modes.length)
			? this.init_data.payment_modes
			: [{ name: "Cash" }, { name: "UPI" }, { name: "Card" }, { name: "Bank Transfer" }];

		const execute_edit = (payments, payment_mode) => {
			const payload = {
				customer: b.customer,
				company: this.init_data.company,
				warehouse: this.init_data.warehouse,
				selling_price_list: this.init_data.selling_price_list,
				payment_mode: payment_mode,
				payments: payments,
				additional_discount_amount: b.bill_discount || 0,
				description: b.remarks || null,
				items: b.items.map((r) => ({
					item_code: r.item_code,
					item_name: r.item_name,
					qty: r.qty,
					rate: r.rate,
					// Falls back to the item's own stock unit if the row has none.
					// Only a draft saved back when the unit dropdown still offered
					// "None" can be in that state, and without this the counter
					// just gets "Sales Invoice Item Row #1: Value missing for:
					// UOM" with no way to fix it (2026-09-04).
					uom: r.uom || r.stock_uom,
					batch_no: r.batch_no || null,
					discount_amount: r.discount || 0,
				})),
			};

			frappe.dom.freeze(__("Updating bill…"));
			santu_sale_invoice.api
				.edit_invoice(b.editing.name, payload)
				.then(async (r) => {
					frappe.dom.unfreeze();
					frappe.msgprint({
						title: __("Bill Corrected"),
						message: `<div style="white-space:pre-wrap">${frappe.utils.escape_html(r.summary || "")}</div>`,
						indicator: "green",
					});
					if (after === "print" && typeof santu_print_thermal_bill === "function") {
						await santu_print_thermal_bill("Sales Invoice", r.name, {
							bill_no: r.santu_bill_no || r.bill_no,
						});
					} else if (after === "whatsapp") {
						if (b.customer && window.santu_whatsapp_share) {
							await window.santu_whatsapp_share.send_transaction("Sales Invoice", r.name, { skip_dialog: true });
						} else {
							frappe.show_alert({ message: __("No WhatsApp number on this bill (no customer selected)."), indicator: "orange" });
						}
					}
					this.tabs = this.tabs.filter((x) => x.id !== b.id);
					if (!this.tabs.length) this._new_bill(false);
					this.active_id = this.tabs[0].id;
					this._persist_soon();
					this.render();
				})
				.catch(() => frappe.dom.unfreeze());
		};

		// If fully paid on screen (e.g. UPI / Cash sale with 0 Baaki), save directly
		if (t.remaining <= 0.01) {
			const payment_mode = "cash";
			const payments = [{ mode_of_payment: b.payment_mode || "Cash", amount: t.payable }];
			frappe.confirm(
				__("Bill #{0} — Purana Total ₹{1}, Naya Total ₹{2} ({3} - Pura Paid). Purani bill cancel hokar nayi corrected bill save hogi. Continue?", [
					santu_bill_label(b.editing.santu_bill_no),
					format_number(old_total, null, 2),
					format_number(new_total, null, 2),
					b.payment_mode || "Cash",
				]),
				() => execute_edit(payments, payment_mode)
			);
			return;
		}

		let options_html = "";
		let default_selected = "";

		if (diff > 0) {
			default_selected = old_paid > 0 ? "extra_cash" : "full_cash";
			options_html = `
				<label class="santu-edit-pay-opt is-selected" data-val="extra_cash">
					<input type="radio" name="santu_edit_pay_choice" value="extra_cash" checked>
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Extra ₹ ${format_number(diff, null, 2)} Cash me mila</span>
							<span class="santu-figures">Pura Paid: ₹ ${format_number(new_total, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Pura bill Cash me settled ho jayega (0 Baaki).</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="extra_upi">
					<input type="radio" name="santu_edit_pay_choice" value="extra_upi">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Extra ₹ ${format_number(diff, null, 2)} UPI / Online me mila</span>
							<span class="santu-figures">Pura Paid: ₹ ${format_number(new_total, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">${old_paid > 0 ? `Pehle ka ₹ ${format_number(old_paid, null, 2)} ${old_mode} + Naya ₹ ${format_number(diff, null, 2)} UPI` : "Pura amount UPI se receive hua."} (0 Baaki).</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="extra_baaki">
					<input type="radio" name="santu_edit_pay_choice" value="extra_baaki">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Extra ₹ ${format_number(diff, null, 2)} Baaki (Account) me daalein</span>
							<span class="santu-figures" style="color:#dc2626;">Baaki: ₹ ${format_number(diff, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Pehle ka ₹ ${format_number(old_paid, null, 2)} paid rahega, badha hua ₹ ${format_number(diff, null, 2)} Customer ke account me judega.</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="full_baaki">
					<input type="radio" name="santu_edit_pay_choice" value="full_baaki">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Pura Bill Baaki (Credit) me daalein</span>
							<span class="santu-figures" style="color:#dc2626;">Pura Baaki: ₹ ${format_number(new_total, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Pura ₹ ${format_number(new_total, null, 2)} Customer ke Udhaar/Account me chala jayega.</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="custom">
					<input type="radio" name="santu_edit_pay_choice" value="custom">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Custom Payment (Apne hisaab se dalein)</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Kitna cash/upi mila aur kitna baaki rakhna hai khud type karein.</div>
					</div>
				</label>
			`;
		} else if (diff < 0) {
			default_selected = "full_settled";
			options_html = `
				<label class="santu-edit-pay-opt is-selected" data-val="full_settled">
					<input type="radio" name="santu_edit_pay_choice" value="full_settled" checked>
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Naya Total Pura Paid (₹ ${format_number(new_total, null, 2)})</span>
							<span class="santu-figures">Wapas: ₹ ${format_number(Math.abs(diff), null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Customer ko ₹ ${format_number(Math.abs(diff), null, 2)} wapas diya, naya bill fully paid (0 Baaki).</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="full_baaki">
					<input type="radio" name="santu_edit_pay_choice" value="full_baaki">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Pura Naya Bill Baaki (Credit) me daalein</span>
							<span class="santu-figures" style="color:#dc2626;">Baaki: ₹ ${format_number(new_total, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Pura ₹ ${format_number(new_total, null, 2)} Customer ke account me baaki rahega.</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="custom">
					<input type="radio" name="santu_edit_pay_choice" value="custom">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Custom Payment (Apne hisaab se dalein)</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Kitna amount received darj karna hai khud select karein.</div>
					</div>
				</label>
			`;
		} else {
			default_selected = old_paid >= new_total ? "full_settled" : "preserve_baaki";
			options_html = `
				<label class="santu-edit-pay-opt is-selected" data-val="full_settled">
					<input type="radio" name="santu_edit_pay_choice" value="full_settled" checked>
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Pura Paid (₹ ${format_number(new_total, null, 2)})</span>
							<span class="santu-figures">0 Baaki</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Bill fully paid rahega.</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="preserve_baaki">
					<input type="radio" name="santu_edit_pay_choice" value="preserve_baaki">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Purana Status waise hi rakhein (Paid: ₹ ${format_number(old_paid, null, 2)})</span>
							<span class="santu-figures" style="color:#dc2626;">Baaki: ₹ ${format_number(new_total - old_paid, null, 2)}</span>
						</div>
						<div class="santu-edit-pay-opt-desc">Pehle jitna paid/baaki tha wahi maintain rahega.</div>
					</div>
				</label>

				<label class="santu-edit-pay-opt" data-val="custom">
					<input type="radio" name="santu_edit_pay_choice" value="custom">
					<div class="santu-edit-pay-opt-info">
						<div class="santu-edit-pay-opt-title">
							<span>Custom Payment</span>
						</div>
					</div>
				</label>
			`;
		}

		const prompt_text = diff > 0
			? __("Naya saman add karne par <b>₹ {0}</b> ka extra bill bana hai. Payment option chunein:", [format_number(diff, null, 2)])
			: (diff < 0
				? __("Bill amount kam hua hai (<b>₹ {0} wapas</b>). Payment option chunein:", [format_number(Math.abs(diff), null, 2)])
				: __("Bill items update ho rahe hain. Payment option confirm karein:"));

		const d = new frappe.ui.Dialog({
			title: __("Bill Sudhaar — Payment Chunao"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "pay_html",
				},
			],
			primary_action_label: __("Update &amp; Save Bill"),
			primary_action: () => {
				const choice = d.$wrapper.find("input[name='santu_edit_pay_choice']:checked").val() || default_selected;
				let payments = [];
				let payment_mode = "cash";

				if (choice === "extra_cash") {
					payment_mode = "cash";
					payments = [{ mode_of_payment: "Cash", amount: new_total }];
				} else if (choice === "extra_upi") {
					payment_mode = "cash";
					if (old_paid > 0 && old_mode && old_mode.toLowerCase() !== "upi") {
						payments = [
							{ mode_of_payment: old_mode, amount: old_paid },
							{ mode_of_payment: "UPI", amount: diff },
						];
					} else {
						payments = [{ mode_of_payment: "UPI", amount: new_total }];
					}
				} else if (choice === "extra_baaki") {
					if (old_paid > 0) {
						payment_mode = "cash";
						payments = [{ mode_of_payment: old_mode || "Cash", amount: old_paid }];
					} else {
						payment_mode = "credit";
						payments = [];
					}
				} else if (choice === "full_baaki") {
					payment_mode = "credit";
					payments = [];
				} else if (choice === "full_settled") {
					payment_mode = "cash";
					payments = [{ mode_of_payment: old_mode || "Cash", amount: new_total }];
				} else if (choice === "preserve_baaki") {
					if (old_paid > 0) {
						payment_mode = "cash";
						payments = [{ mode_of_payment: old_mode || "Cash", amount: Math.min(old_paid, new_total) }];
					} else {
						payment_mode = "credit";
						payments = [];
					}
				} else if (choice === "custom") {
					const c_amt = Math.max(Number(d.$wrapper.find(".santu-edit-custom-amt").val()) || 0, 0);
					const c_mode = d.$wrapper.find(".santu-edit-custom-mode").val() || "Cash";
					if (c_amt > 0) {
						payment_mode = "cash";
						payments = [{ mode_of_payment: c_mode, amount: Math.min(c_amt, new_total) }];
					} else {
						payment_mode = "credit";
						payments = [];
					}
				}
				d.hide();
				execute_edit(payments, payment_mode);
			},
		});

		const html_content = `
			<div class="santu-edit-pay-dialog">
				<div class="santu-edit-pay-summary">
					<div class="santu-edit-pay-card">
						<div class="label">${__("Purana Total")}</div>
						<div class="val">₹ ${format_number(old_total, null, 2)}</div>
					</div>
					<div class="santu-edit-pay-card highlight">
						<div class="label">${__("Naya Total")}</div>
						<div class="val">₹ ${format_number(new_total, null, 2)}</div>
					</div>
					<div class="santu-edit-pay-card ${diff > 0 ? "danger" : (diff < 0 ? "success" : "")}">
						<div class="label">${diff > 0 ? __("Extra Amount") : (diff < 0 ? __("Return Amount") : __("Difference"))}</div>
						<div class="val">₹ ${format_number(Math.abs(diff), null, 2)}</div>
					</div>
				</div>

				<div class="santu-edit-pay-prompt">${prompt_text}</div>

				<div class="santu-edit-pay-options">
					${options_html}
				</div>

				<div class="santu-edit-pay-custom-wrap" style="display:none;">
					<div style="flex:1;">
						<label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">${__("Amount Received (₹)")}</label>
						<input type="number" step="any" min="0" class="form-control santu-edit-custom-amt" value="${diff > 0 ? old_paid : new_total}">
					</div>
					<div style="flex:1;">
						<label style="font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px;">${__("Payment Mode")}</label>
						<select class="form-control santu-edit-custom-mode">
							${modes.map((m) => `<option value="${frappe.utils.escape_html(m.name)}" ${m.name === old_mode ? "selected" : ""}>${frappe.utils.escape_html(m.name)}</option>`).join("")}
						</select>
					</div>
				</div>
			</div>
		`;

		d.fields_dict.pay_html.$wrapper.html(html_content);

		const $wrap = d.fields_dict.pay_html.$wrapper;
		$wrap.find(".santu-edit-pay-opt").on("click", function () {
			$wrap.find(".santu-edit-pay-opt").removeClass("is-selected");
			$(this).addClass("is-selected");
			$(this).find("input[type='radio']").prop("checked", true);
			const val = $(this).data("val");
			$wrap.find(".santu-edit-pay-custom-wrap").toggle(val === "custom");
		});

		d.show();
	},

	// Makes a real Delivery Note straight from the current bill's items,
	// without leaving Billing (2026-08-27 direct request: a Chalan button
	// right here, same tab/close/print behaviour as Save & Print, instead of
	// a separate Delivery Challan screen). No payment/discount fields go
	// along — a challan is just "these goods left the shop", not a sale.
	_save_as_challan() {
		const b = this._bill();
		if (!b.items.length) {
			frappe.msgprint(__("Add at least one item."));
			return;
		}
		// Unlike a cash sale, a challan is always filed against a named
		// customer — "goods left for Walk-in Customer" isn't something
		// anyone can act on later, so this one field billing otherwise
		// treats as optional is required here.
		if (!b.customer) {
			frappe.msgprint(__("Select a customer for the Delivery Challan."));
			this.$root.find(".santu-bill-customer").focus();
			return;
		}
		this._check_backdated_warning(b, (allow_backdate) => this._proceed_save_as_challan(b, allow_backdate));
	},

	_proceed_save_as_challan(b, allow_backdate) {
		frappe.dom.freeze(__("Chalan ban raha hai…"));
		frappe
			.xcall("santu_hardware.santu_hardware.api.save_delivery_note", {
				challan_json: JSON.stringify({
					customer: b.customer,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: b.posting_date,
					allow_backdate: allow_backdate ? 1 : 0,
					selling_price_list: this.init_data.selling_price_list,
					description: b.remarks || null,
					// Same discounts the bill shows — a challan for the same
					// goods must not claim a higher value than the sale does.
					additional_discount_amount: b.bill_discount || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						item_name: r.item_name,
						qty: r.qty,
						rate: r.rate,
						// Falls back to the item's own stock unit if the row has none.
						// Only a draft saved back when the unit dropdown still offered
						// "None" can be in that state, and without this the counter
						// just gets "Sales Invoice Item Row #1: Value missing for:
						// UOM" with no way to fix it (2026-09-04).
						uom: r.uom || r.stock_uom,
						// Without this the server has to look the factor up
						// itself; sending what the row actually used keeps the
						// bill and the stock ledger in step even if the item's
						// UOM table is edited between adding the row and saving.
						conversion_factor: santu_uom.factor(r.uom_options, r.uom),
						batch_no: r.batch_no || null,
						discount_amount: r.discount || 0,
					})),
				}),
				submit: 1,
			})
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Chalan Saved {0}", [r.name]), indicator: "green" });
				if (window.santu_whatsapp_share) {
					window.santu_whatsapp_share.send_transaction("Delivery Note", r.name);
				}
				this.tabs = this.tabs.filter((x) => x.id !== b.id);
				if (!this.tabs.length) this._new_bill(false);
				this.active_id = this.tabs[0].id;
				this._persist_soon();
				this.render();
			})
			.catch((e) => {
				frappe.dom.unfreeze();
				frappe.msgprint((e && e.message) || __("Could not save challan."));
			});
	},

	// "Bill complete na karke Estimate me move karne ka option" (2026-08-30
	// direct request). A customer who is still deciding shouldn't force the
	// counter to either finish a sale that isn't happening or retype every
	// line on the Estimate screen — this hands the open bill over as-is.
	//
	// Nothing is billed, no stock moves and no money is recorded: the tab
	// becomes a real Quotation and closes, exactly like Chalan Banao does.
	_convert_to_estimate() {
		const b = this._bill();
		if (!b.items.length) {
			frappe.msgprint(__("Pehle koi saman daaliye."));
			return;
		}
		// An estimate is always made out to someone — "bhav bata do" for
		// nobody in particular can't be followed up later.
		if (!b.customer) {
			frappe.msgprint(__("Estimate ke liye customer chuniye."));
			this.$root.find(".santu-bill-customer").focus();
			return;
		}
		if (b.editing) {
			frappe.msgprint(__("Ye bill already ban chuki hai — use Estimate me nahi badal sakte."));
			return;
		}
		frappe.confirm(
			__("Is bill ka Estimate bana dein? Bill save nahi hogi — na stock katega, na paisa lagega."),
			() => this._check_backdated_warning(b, (allow_backdate) => this._proceed_convert_to_estimate(b, allow_backdate))
		);
	},

	_proceed_convert_to_estimate(b, allow_backdate) {
		frappe.dom.freeze(__("Estimate ban raha hai…"));
		frappe
			.xcall("santu_hardware.santu_hardware.api.save_quotation", {
				quotation_json: JSON.stringify({
					customer: b.customer,
					company: this.init_data.company,
					posting_date: b.posting_date,
					allow_backdate: allow_backdate ? 1 : 0,
					selling_price_list: this.init_data.selling_price_list,
					description: b.remarks || null,
					terms: b.terms || null,
					additional_discount_amount: b.bill_discount || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						item_name: r.item_name,
						qty: r.qty,
						rate: r.rate,
						// Falls back to the item's own stock unit if the row has none.
						// Only a draft saved back when the unit dropdown still offered
						// "None" can be in that state, and without this the counter
						// just gets "Sales Invoice Item Row #1: Value missing for:
						// UOM" with no way to fix it (2026-09-04).
						uom: r.uom || r.stock_uom,
						// Send the factor the row actually used, same reason
						// Chalan Banao does: the item's UOM table may be edited
						// between adding the row and saving.
						conversion_factor: santu_uom.factor(r.uom_options, r.uom),
						discount_amount: r.discount || 0,
					})),
				}),
				submit: 1,
			})
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({
					message: __("Estimate {0} ban gaya", [santu_bill_label(r.santu_bill_no)]),
					indicator: "green",
				});
				this.tabs = this.tabs.filter((x) => x.id !== b.id);
				if (!this.tabs.length) this._new_bill(false);
				this.active_id = this.tabs[0].id;
				this._persist_soon();
				this.render();
			})
			.catch((e) => {
				frappe.dom.unfreeze();
				frappe.msgprint((e && e.message) || __("Estimate nahi ban paya."));
			});
	},

	// ---------- events ----------
	_bind() {
		const b = this._bill();
		const $r = this.$root;

		$r.find(".santu-bill-newtab").on("click", () => {
			this._new_bill();
			this.render();
		});
		$r.find(".santu-bill-set-today").on("click", (e) => {
			e.preventDefault();
			b.posting_date = frappe.datetime.get_today();
			this._persist_soon();
			this.render();
		});
		$r.find(".santu-bill-search").on("input", santu_sale_invoice.utils.debounce((e) => this._search($(e.target).val())));
		// Typing over the name means whatever's showing below is about a
		// DIFFERENT person now — stale info left on screen is worse than
		// none, so it clears the moment they start typing (own listener,
		// undebounced), not only once a new pick lands.
		$r.find(".santu-bill-customer").on("input", () => this.$root.find(".santu-bill-cust-info").empty());
		$r.find(".santu-bill-customer").on("input", santu_sale_invoice.utils.debounce((e) => this._cust_search($(e.target).val())));
		$r.find(".santu-bill-customer").on("focus", () => this._cust_search($r.find(".santu-bill-customer").val()));

		// Dono girne wali list ↑ ↓ Enter se chalein — counter pe mouse
		// uthana hi na pade (2026-08-27 direct request). Row ka apna click
		// handler hi chalta hai, isliye keyboard aur mouse bilkul ek jaisa
		// kaam karte hain. Quick-create / Add Customer wali aakhri row bhi
		// list ka hissa hai, to wo bhi Enter se ho jaati hai.
		santu_kb_list({
			$input: $r.find(".santu-bill-search"),
			$dropdown: $r.find(".santu-bill-dropdown"),
			rowSelector: ".santu-bill-dd-row",
		});
		santu_kb_list({
			$input: $r.find(".santu-bill-customer"),
			$dropdown: $r.find(".santu-bill-cust-dropdown"),
			rowSelector: ".santu-bill-cust-row, .santu-bill-addcust",
		});
		$r.find(".santu-bill-date").on("change", (e) => {
			b.posting_date = e.target.value;
			this._persist_soon();
		});
		$r.find(".santu-bill-mode").on("change", (e) => {
			b.payment_mode = e.target.value;
			this._persist_soon();
		});
		$r.find(".santu-bill-received").on("input", (e) => {
			b.amount_received = Number(e.target.value) || 0;
			this._persist_soon();
			this._render_totals();
		});
		$r.find(".santu-bill-breakup").on("click", () => this._breakup());
		// The F-key actions live inside the same "More" dropdown as the rest
		// (2026-09-03: had a separate "More Actions" button at first, merged
		// into the one existing menu per direct follow-up request) — closing
		// the menu on click matters here since these, unlike Draft/Convert/
		// etc, open their own dialog right on top of it.
		$r.find(".santu-bill-more-menu [data-act]").on("click", (e) => {
			$r.find(".santu-bill-more-menu").hide();
			this._action($(e.currentTarget).data("act"));
		});
		$r.find(".santu-bill-save").on("click", () => this._save());
		// Three explicit buttons, no post-save "print karein?"/whatsapp popup
		// after either -- clicking "Save & Print" or "Send WhatsApp" already
		// IS the operator's explicit yes (2026-09-06 direct request: "same
		// screen pe all kaam ho, baar baar is app ko puchna v nahi padega").
		// Plain "Save" still does neither, same as before.
		$r.find(".santu-bill-save-print").on("click", () => this._save(false, "print"));
		$r.find(".santu-bill-save-whatsapp").on("click", () => this._save(false, "whatsapp"));
		$r.find(".santu-bill-more").on("click", (e) => {
			e.stopPropagation();
			$r.find(".santu-bill-more-menu").toggle();
		});
		$r.find("[data-more]").on("click", (e) => this._more($(e.currentTarget).data("more")));
		// Click anywhere else and the menu closes -- a menu left open over the
		// item grid swallows the next click on a row.
		$(document).off("click.santu-bill-more").on("click.santu-bill-more", () => $r.find(".santu-bill-more-menu").hide());
		$r.find(".santu-bill-chalan").on("click", () => this._save_as_challan());
		// No longer a separate all-or-nothing credit save — clears Amount
		// Received to 0 (the whole bill becomes baaki, same as before) and
		// hands off to the one normal save flow, which now handles baaki
		// itself via `_save()`'s `t.remaining` check.
		$r.find(".santu-bill-credit").on("click", () => {
			b.amount_received = 0;
			$r.find(".santu-bill-received").val("");
			this._persist_soon();
			this._render_totals();
			frappe.confirm(
				__("Bill print bhi karna hai?"),
				() => this._save(false, "print"),
				() => this._save()
			);
		});

		$(document).off("click.santu-bill").on("click.santu-bill", (e) => {
			// The list now covers the whole item area, so getting OUT of it
			// has to be as easy as getting in: clicking anywhere off the
			// search box closes it and the item grid comes straight back.
			if (!$(e.target).closest(".santu-bill-searchwrap").length) $r.find(".santu-bill-dropdown").hide().empty();
			if (!$(e.target).closest(".santu-bill-custwrap").length) $r.find(".santu-bill-cust-dropdown").hide();
		});

		// The F-keys are the point of a counter screen — a cashier should
		// never have to reach for the mouse mid-bill.
		$r.find(".santu-bill-search").on("keydown", (e) => {
			// Escape gets the grid back without touching the mouse.
			if (e.key === "Escape") {
				$r.find(".santu-bill-dropdown").hide().empty();
				$(e.currentTarget).val("");
			}
		});

		$(document).off("keydown.santu-bill").on("keydown.santu-bill", (ev) => {
			if (frappe.get_route()[0] !== "santu-billing") return;
			const map = { F2: "qty", F3: "idisc", F4: "remove", F5: "rate", F6: "unit", F7: "rename", F8: "charges", F9: "bdisc", F10: "loyalty", F11: "privacy", F12: "remarks" };
			if (map[ev.key]) {
				ev.preventDefault();
				this._action(map[ev.key]);
				return;
			}
			if (ev.key === "F1") {
				ev.preventDefault();
				$r.find(".santu-bill-search").focus().select();
				return;
			}
			if (ev.key === "F11") {
				ev.preventDefault();
				$r.find(".santu-bill-customer").focus().select();
				return;
			}
			if (ev.ctrlKey || ev.metaKey) {
				if (ev.key === "t") {
					ev.preventDefault();
					this._new_bill();
					this.render();
				} else if (ev.key === "p") {
					ev.preventDefault();
					this._save(false, "print");
				} else if (ev.key === "m") {
					ev.preventDefault();
					$r.find(".santu-bill-credit").trigger("click");
				} else if (ev.key === "f") {
					ev.preventDefault();
					this._breakup();
				} else if (ev.key === "d") {
					ev.preventDefault();
					this._add_customer($r.find(".santu-bill-customer").val());
				} else if (ev.key === "w") {
					ev.preventDefault();
					this._close_tab(this.active_id);
				}
			}
		});
	},
};
