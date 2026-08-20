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

frappe.pages["santu-billing"].on_page_show = function () {
	if (window.santu_billing_page && santu_billing_page.page) santu_billing_page.render();
};

const SANTU_BILL_KEY = "santu_billing_tabs_v1";

// Same icon convention Sale Invoice uses (santu_sale_invoice.js), kept as a
// local copy so Billing doesn't depend on that page's script being loaded.
//
// The name MUST stay different from Sale Invoice's `santu_si2_icon`. Desk is a
// single-page app: once you open Sale Invoices and then Billing (or the other
// way round) in the same session, both page scripts are live in the same global
// scope, and two top-level `const`s of one name is a SyntaxError that kills the
// whole second script — the page then renders blank until a full reload drops
// the other script. That was the "3-4 baar reload karna padta hai" bug
// (2026-08-20). The directory consts were already uniquely named; this one
// wasn't.
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
			this._load();
			if (!this.tabs.length) this._new_bill(false);
			this.render();
		});
	},

	// ---------- state ----------
	_load() {
		try {
			const raw = localStorage.getItem(SANTU_BILL_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
				this.tabs = parsed.tabs;
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
			posting_date: this.init_data.posting_date,
			customer: null,
			customer_label: "",
			items: [],
			selected_row: null,
			payment_mode: (this.init_data.payment_modes || []).length ? this.init_data.payment_modes[0].name : "Cash",
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
		// Loyalty points redemption is switched off everywhere for now
		// (2026-08-18 direct request: "loyalty points ko abhi ke liye
		// commentout kr do harek jagah se, baad me decision lenge kaise
		// karna hai" — how it should work isn't decided yet). `redeem` is
		// forced to 0 here rather than deleted, so re-enabling later is one
		// line, not rebuilding the whole payable/change/breakup chain:
		// const redeem = Math.min(Number(b.redeem_points) || 0, total);
		const redeem = 0;
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

	// ---------- render ----------
	render() {
		if (!this.tabs.length) this._new_bill(false);
		const b = this._bill();
		const t = this._totals();
		const modes = this.init_data.payment_modes || [];
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

				<div class="santu-bill-main">
					<div class="santu-bill-left">
						<div class="santu-bill-searchwrap">
							<input type="text" class="santu-bill-search" placeholder="Scan or search by item code, model no or item name" autocomplete="off">
							<span class="santu-bill-search-icon">🔍</span>
							<div class="santu-bill-dropdown" style="display:none;"></div>
						</div>

						<div class="santu-bill-gridwrap">
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
									</tr>
								</thead>
								<tbody></tbody>
							</table>
							<div class="santu-bill-gridfoot"><span class="santu-bill-grandrow">₹ 0.00</span></div>
						</div>
					</div>

					<div class="santu-bill-right">
						<div class="santu-bill-datewrap">
							<input type="date" class="santu-bill-date" value="${b.posting_date}">
						</div>
						<div class="santu-bill-custwrap">
							<input type="text" class="santu-bill-customer" placeholder="Search for a customer by name, phone number [F11]" value="${frappe.utils.escape_html(b.customer_label || "")}" autocomplete="off">
							<div class="santu-bill-cust-dropdown" style="display:none;"></div>
						</div>

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

						<!-- Loyalty points switched off for now (2026-08-18) — see
					     the note at _totals(). <div class="santu-bill-loyalty-line" style="display:none"></div> -->

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
					</div>
				</div>

				<div class="santu-bill-actions">
					<div class="santu-bill-fkeys">
						<button type="button" data-act="qty">Change Quantity <b>[F2]</b></button>
						<button type="button" data-act="idisc">Item Discount <b>[F3]</b></button>
						<button type="button" data-act="remove">Remove Item <b>[F4]</b></button>
						<button type="button" data-act="rate">Sale Value <b>[F5]</b></button>
						<button type="button" data-act="unit">Change Unit <b>[F6]</b></button>
						<button type="button" data-act="rename">Item Name <b>[F7]</b></button>
						<button type="button" data-act="charges">Additional Charges <b>[F8]</b></button>
						<button type="button" data-act="bdisc">Bill Discount <b>[F9]</b></button>
						<!-- Loyalty Points [F10] switched off for now (2026-08-18) —
						     <button type="button" data-act="loyalty">Loyalty Points <b>[F10]</b></button> -->
						<button type="button" data-act="remarks">Remarks <b>[F12]</b></button>
					</div>
					<div class="santu-bill-savecol">
						<button type="button" class="santu-bill-save">Save &amp; Print Bill <span class="santu-bill-kbd">Ctrl+P</span></button>
						<button type="button" class="santu-bill-save-only" title="${__("Saves and prints the bill — no WhatsApp message is sent")}">Save &amp; Print Only <span class="santu-bill-kbd">Ctrl+Shift+P</span></button>
						<button type="button" class="santu-bill-credit">Other/Credit Payments <span class="santu-bill-kbd">Ctrl+M</span></button>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-bill");
		this._render_tabs();
		this._render_rows();
		this._bind();
		this._bind_toolbar();
		this.$root.find(".santu-bill-search").focus();
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
									<b>${frappe.utils.escape_html(r.bill_no || r.name)}</b>
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
								<span>${__("Sold")} ${format_number(r.qty, null, 2)} ${frappe.utils.escape_html(r.uom || "")} · ₹${format_number(r.rate, null, 2)}${__("/unit")}</span>
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
				<button type="button" class="santu-bill-tab ${b.id === this.active_id ? "is-active" : ""}">
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

	_render_rows() {
		const b = this._bill();
		const privacy_on =
			typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active();
		if (privacy_on) this._fetch_costs(b);
		const $tb = this.$root.find(".santu-bill-grid tbody").empty();
		b.items.forEach((r, i) => {
			const $tr = $(`
				<tr class="${r.id === b.selected_row ? "is-selected" : ""}" data-row="${r.id}">
					<td class="c-idx">${i + 1}</td>
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
								}">${__("Available")}: ${format_number(r.available_qty, null, 0)} ${frappe.utils.escape_html(r.uom || "")}</span>`
							: ""
					}</td>
					<td class="c-qty">
						<span class="santu-bill-qty-stepper">
							<button type="button" class="santu-bill-qty-btn" data-step="-1">−</button>
							<span class="santu-bill-editable santu-bill-qty-val" title="${__("Badalne ke liye dabaiye")}">${format_number(r.qty, null, 2)}</span>
							<button type="button" class="santu-bill-qty-btn" data-step="1">+</button>
						</span>
					</td>
					<td class="c-unit">${frappe.utils.escape_html(r.uom || "-")}</td>
					<td class="c-rate santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.rate, null, 2)}${
						privacy_on && r.cost_price != null
							? `<span class="santu-bill-cost">${__("cost")} ₹${format_number(r.cost_price, null, 2)}</span>`
							: ""
					}</td>
					<td class="c-disc santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.discount || 0, null, 2)}</td>
					<td class="c-total">${format_number(this._row_total(r), null, 2)}</td>
				</tr>
			`);
			$tr.on("click", () => {
				b.selected_row = r.id;
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
			$note.show().text(__("Remaining ₹ {0} will be added to the customer's account", [format_number(t.remaining, null, 2)]));
		} else {
			$note.hide().empty();
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
			rows.slice(0, 8).forEach((it) => {
				$(`
					<div class="santu-bill-dd-row">
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
									<span>${m.available_qty != null ? m.available_qty + " " + (m.stock_uom || "") : ""}</span>
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
		} else {
			b.items.push({
				id: santu_sale_invoice.utils.uid(),
				item_code: row.item_code || item_code,
				item_name: row.item_name || item_code,
				qty: 1,
				uom: row.uom || row.stock_uom,
				uom_options: [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i),
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
		this._render_rows();
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
			const d = new frappe.ui.Dialog({
				title: __("Change Unit"),
				fields: [{ fieldtype: "Select", fieldname: "uom", label: __("Unit"), options: (r.uom_options || [r.uom]).join("\n"), default: r.uom }],
				primary_action_label: __("OK"),
				primary_action: (v) => {
					r.uom = v.uom;
					d.hide();
					this._persist_soon();
					this._render_rows();
				},
			});
			d.show();
		} else if (act === "charges") {
			this._prompt(__("Additional Charges"), __("Amount (₹)"), "Currency", b.additional_charges, (v) => (b.additional_charges = Math.max(Number(v) || 0, 0)));
		} else if (act === "bdisc") {
			this._prompt(__("Bill Discount"), __("Discount (₹)"), "Currency", b.bill_discount, (v) => (b.bill_discount = Math.max(Number(v) || 0, 0)));
		} else if (act === "remarks") {
			this._prompt(__("Remarks"), __("Note"), "Small Text", b.remarks, (v) => (b.remarks = v || ""));
		// } else if (act === "loyalty") {
		// 	this._loyalty(); — switched off for now (2026-08-18), see _totals()
		} else if (act === "privacy") {
			// Cost price is deliberately absent from the counter screen: the
			// customer is standing on the other side of it. Unlocking is
			// gated by fingerprint or PIN (santu_privacy.js) and switches
			// itself back off after a few seconds.
			Promise.resolve(window.santu_toggle_privacy_mode()).then(() => this._render_rows());
		}
	},

	// Switched off for now (2026-08-18 direct request: "loyalty points ko
	// abhi ke liye commentout kr do harek jagah se, baad me decision lenge
	// kaise karna hai" — how redemption should work isn't decided yet).
	// Left commented rather than deleted so re-enabling is turning this back
	// on plus the F10 button/map entry, not rebuilding it.
	// _loyalty() {
	// 	const b = this._bill();
	// 	const t = this._totals();
	// 	if (!b.items.length) {
	// 		frappe.show_alert({ message: __("Add some items first, then use points."), indicator: "orange" });
	// 		return;
	// 	}
	// 	// A bill with no customer picked is billed to Walk-in Customer on
	// 	// save, so that is whose points apply here too.
	// 	const customer = b.customer || "Walk-in Customer";
	// 	frappe.call({
	// 		method: "santu_hardware.santu_hardware.api.get_loyalty_status",
	// 		args: { customer },
	// 		freeze: true,
	// 		freeze_message: __("Checking points…"),
	// 		callback: (r) => {
	// 			const st = r.message || {};
	// 			if (!st.enrolled) {
	// 				frappe.show_alert({ message: __("{0} is not in the rewards scheme.", [customer]), indicator: "blue" });
	// 				return;
	// 			}
	// 			if (!st.points) {
	// 				frappe.msgprint({
	// 					title: __("No points yet"),
	// 					message: __("{0} has 0 points. Points build up at 1 point for every ₹100 of billing.", [customer]),
	// 					indicator: "blue",
	// 				});
	// 				return;
	// 			}
	// 			// Never let a bill be paid entirely by points beyond its own
	// 			// value — ERPNext would reject it and the operator would be
	// 			// left staring at a stack trace mid-sale.
	// 			const max_points = Math.floor(Math.min(st.points, t.total / (st.conversion_factor || 1)));
	// 			const d = new frappe.ui.Dialog({
	// 				title: __("Use Reward Points"),
	// 				fields: [
	// 					{
	// 						fieldtype: "HTML",
	// 						fieldname: "info",
	// 						options: `<div class="santu-bill-loyalty-info">
	// 							<div><b>${frappe.utils.escape_html(customer)}</b></div>
	// 							<div>${__("Points in account")}: <b>${st.points}</b> (${__("worth")} ₹ ${format_number(st.value, null, 2)})</div>
	// 							<div>${__("This bill")}: ₹ ${format_number(t.total, null, 2)}</div>
	// 							<div>${__("Can use now")}: <b>${max_points}</b> ${__("points")}</div>
	// 						</div>`,
	// 					},
	// 					{
	// 						fieldtype: "Int",
	// 						fieldname: "points",
	// 						label: __("Points to use"),
	// 						default: b.redeem_points ? Math.round(b.redeem_points / (st.conversion_factor || 1)) : max_points,
	// 						description: __("1 point = ₹ {0} off. Leave 0 to use none.", [format_number(st.conversion_factor || 1, null, 2)]),
	// 					},
	// 				],
	// 				primary_action_label: __("Apply"),
	// 				primary_action: (v) => {
	// 					const pts = Math.max(Math.min(cint(v.points), max_points), 0);
	// 					b.redeem_points = pts * (st.conversion_factor || 1);
	// 					d.hide();
	// 					this._persist_soon();
	// 					this._render_totals();
	// 					frappe.show_alert({
	// 						message: pts
	// 							? __("{0} points used — ₹ {1} off.", [pts, format_number(b.redeem_points, null, 2)])
	// 							: __("No points used."),
	// 						indicator: "green",
	// 					});
	// 				},
	// 			});
	// 			d.show();
	// 		},
	// 	});
	// },

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
		this._persist_soon();
	},

	_cust_search(q) {
		const $dd = this.$root.find(".santu-bill-cust-dropdown");
		const draw = (rows) => {
			$dd.empty();
			if (rows.length) {
				$dd.append(`<div class="santu-bill-cust-head"><span>Name</span><span>Phone Number</span></div>`);
			}
			rows.forEach((c) => {
				$(`
					<div class="santu-bill-cust-row">
						<span>${frappe.utils.escape_html(c.customer_name)}</span>
						<span class="santu-bill-cust-phone">${frappe.utils.escape_html(c.mobile_no || "—")}</span>
					</div>
				`)
					.on("click", () => this._pick_customer(c.name, c.customer_name))
					.appendTo($dd);
			});
			// Always offered, results or not — at a counter the customer in
			// front of you is usually the one who isn't in the list yet.
			$(`<button type="button" class="santu-bill-addcust">Add Customer <span class="santu-bill-kbd">Ctrl+D</span></button>`)
				.on("click", () => this._add_customer(this.$root.find(".santu-bill-customer").val()))
				.appendTo($dd);
			$dd.show();
		};

		if (!q || q.length < 2) {
			draw([]);
			return;
		}
		// Placeholder says "name, phone number" but only name was ever
		// searched — typing a phone number here silently returned nothing.
		// Search both and merge, since a query could match either.
		Promise.all([
			santu_sale_invoice.api.search_customers(q),
			santu_sale_invoice.api.search_customers_by_phone(q),
		]).then(([by_name, by_phone]) => {
			const rows = by_name || [];
			const seen = new Set(rows.map((r) => r.name));
			(by_phone || []).forEach((r) => {
				if (!seen.has(r.name)) {
					seen.add(r.name);
					rows.push(r);
				}
			});
			draw(rows);
		});
	},

	// Keeps Billing's own compact Vyapar-style modal look (2026-08-18: "jo ui
	// h wo vyapar ka dalo" — the plain frappe.ui.Dialog from Sale Invoice
	// didn't match), but now carries the same village-search / auto-pincode /
	// district behaviour Sale Invoice has, wired to the same
	// search_bihar_villages API and sent through the same create_customer_full
	// fields (district/city/pincode) so results match exactly.
	_add_customer(prefill) {
		const self = this;
		$("#santu-bill-addcust-modal").remove();
		const districts = (typeof santu_sale_invoice !== "undefined" && santu_sale_invoice.BIHAR_DISTRICTS) || [];
		const $m = $(`
			<div id="santu-bill-addcust-modal" class="santu-bill-modal-backdrop">
				<div class="santu-bill-modal">
					<div class="santu-bill-modal-head">
						<span>Add Customer</span>
						<button type="button" class="santu-bill-modal-x">✕ <small>[Esc]</small></button>
					</div>
					<div class="santu-bill-modal-body">
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
						<div class="santu-bill-modal-field santu-bill-modal-village-wrap">
							<label>City / Village</label>
							<input type="text" class="ac-village" autocomplete="off" placeholder="Type to search">
							<div class="santu-bill-modal-village-dd" style="display:none;"></div>
						</div>
						<div class="santu-bill-modal-grid">
							<div class="santu-bill-modal-field">
								<label>District</label>
								<select class="ac-district">
									<option value="">Auto (from pincode)</option>
									${districts.map((dd) => `<option value="${frappe.utils.escape_html(dd)}">${frappe.utils.escape_html(dd)}</option>`).join("")}
								</select>
							</div>
							<div class="santu-bill-modal-field">
								<label>Pincode</label>
								<input type="text" class="ac-pincode" placeholder="Pincode">
							</div>
						</div>
						<div class="santu-bill-modal-field">
							<label>Address Line</label>
							<textarea class="ac-address" rows="3" placeholder="House no, street, landmark"></textarea>
						</div>
					</div>
					<div class="santu-bill-modal-foot">
						<button type="button" class="santu-bill-modal-save">Save</button>
						<button type="button" class="santu-bill-modal-cancel">Cancel</button>
					</div>
				</div>
			</div>
		`).appendTo("body");

		const close = () => {
			$m.remove();
			$(document).off("keydown.santu-bill-ac");
			$(document).off("click.santu-bill-ac-village");
		};
		$m.find(".santu-bill-modal-x, .santu-bill-modal-cancel").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-bill-ac", (e) => {
			if (e.key === "Escape") close();
		});

		const $village = $m.find(".ac-village");
		const $villageDD = $m.find(".santu-bill-modal-village-dd");
		const $district = $m.find(".ac-district");
		const $pincode = $m.find(".ac-pincode");
		// Every lookup carries a ticket number and only the newest one is
		// allowed to paint. Without it the wide "everything" search fired on
		// focus came back after the narrow typed one and replaced real
		// matches with an unrelated list — typing a village showed villages
		// from somewhere else entirely (2026-08-18, caught in testing).
		let village_seq = 0;
		const search_village = (q) => {
			if (!santu_sale_invoice || !santu_sale_invoice.api || !santu_sale_invoice.api.search_bihar_villages) return;
			// Nothing useful to search on yet — and searching on empty is
			// what pulled the whole state's list in the first place.
			if ((q || "").length < 2) {
				$villageDD.hide().empty();
				return;
			}
			const ticket = ++village_seq;
			santu_sale_invoice.api.search_bihar_villages($district.val(), q).then((rows) => {
				if (ticket !== village_seq) return;
				$villageDD.empty();
				if (!rows.length) {
					$villageDD.append(`<div class="santu-bill-modal-village-empty">${__("No matches")}</div>`);
				}
				rows.forEach((r) => {
					$(`<div class="santu-bill-modal-village-row">${frappe.utils.escape_html(r.village)} <span>${r.pincode}</span></div>`)
						.on("click", () => {
							$village.val(r.village);
							if (!$pincode.val()) $pincode.val(r.pincode);
							if (r.district) $district.val(r.district);
							$villageDD.hide();
						})
						.appendTo($villageDD);
				});
				$villageDD.show();
			});
		};
		let village_timer = null;
		$village.on("input focus", (e) => {
			clearTimeout(village_timer);
			village_timer = setTimeout(() => search_village((e.target.value || "").trim()), 200);
		});
		$district.on("change", () => $village.val(""));
		// Typing a pincode directly (not picking a village suggestion) never
		// filled District — it only resolved server-side on save, so the
		// dropdown sat on "Auto" until after the customer was created
		// (2026-08-19 bug report). Resolve it live once 6 digits are in.
		$pincode.on(
			"input",
			santu_sale_invoice.utils.debounce((e) => {
				const digits = (e.target.value || "").replace(/\D/g, "");
				if (digits.length !== 6 || $district.val()) return;
				santu_sale_invoice.api.district_for_pincode(digits).then((d) => {
					if (d && !$district.val() && $pincode.val().replace(/\D/g, "") === digits) $district.val(d);
				});
			})
		);
		$(document).on("click.santu-bill-ac-village", (e) => {
			if (!$(e.target).closest(".santu-bill-modal-village-wrap").length) $villageDD.hide();
		});

		$m.find(".santu-bill-modal-save").on("click", () => {
			const name = ($m.find(".ac-name").val() || "").trim();
			const phone = ($m.find(".ac-phone").val() || "").trim();
			const district = $district.val();
			const village = ($village.val() || "").trim();
			const pincode = ($pincode.val() || "").trim();
			const address = ($m.find(".ac-address").val() || "").trim();
			if (!name) {
				frappe.show_alert({ message: __("Enter a customer name."), indicator: "orange" });
				return;
			}
			// One of phone or address, not both — enough to find this person
			// again without holding up the counter. Checked here too so the
			// message lands next to the fields rather than as a server error.
			if (!phone && !address && !village && !pincode) {
				frappe.show_alert({
					message: __("Add a phone number or an address — one of the two."),
					indicator: "orange",
				});
				return;
			}
			const payload = { customer_name: name, phone };
			if (district) payload.district = district;
			if (village) payload.city = village;
			if (pincode) payload.pincode = pincode;
			if (address) payload.address_line1 = address;
			if (address || village || pincode || district) {
				// india_compliance rejects an Indian Address with no state, and
				// city is mandatory on Address — the shop's own default is sent
				// so the counter is never asked for a field this form doesn't
				// show up front.
				payload.state = "Bihar";
				payload.country = "India";
			}
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

		setTimeout(() => $m.find(".ac-name").focus().select(), 60);
	},

	// ---------- save ----------
	// Single flow now (2026-08-18 direct request) — no separate "credit"
	// mode. Whatever's actually in Amount Received gets paid; anything short
	// of the payable amount is left as baaki on the customer's account,
	// exactly like Sale Invoice's payment summary. The old `credit` boolean
	// made a blank Amount Received field silently pass as "fully paid" even
	// in credit mode (`Number(b.amount_received) || t.payable`) — using the
	// real received figure here fixes that too.
	_save(opts = {}) {
		const b = this._bill();
		const t = this._totals();
		if (!b.items.length) {
			frappe.msgprint(__("Add at least one item."));
			return;
		}
		// At a counter nobody asks the name for a ₹40 cash sale, so the
		// customer field is optional here and an unnamed bill goes to the
		// shop's Walk-in Customer — the same party these sales already land
		// under today. save_sale_invoice itself requires a customer.
		const customer = b.customer || "Walk-in Customer";
		// Walk-in Customer can never carry a balance — same rule Sale
		// Invoice enforces. The fuller rule there (also requires phone +
		// village on file for a NAMED customer to carry baaki) is deferred:
		// Billing doesn't collect those fields yet.
		if (t.remaining > 0 && customer === "Walk-in Customer") {
			frappe.msgprint(__("Walk-in Customer cannot have an outstanding balance. Select or add a proper customer for a credit/baaki sale."));
			return;
		}
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

		frappe.dom.freeze(__("Saving…"));
		santu_sale_invoice.api
			.save(
				{
					customer: customer,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: b.posting_date,
					selling_price_list: this.init_data.selling_price_list,
					payment_mode: effective_mode,
					payments,
					additional_discount_amount: b.bill_discount || 0,
					description: b.remarks || null,
					// t.redeem is forced to 0 in _totals() while loyalty points
					// are switched off (2026-08-18), so this always sends 0 —
					// left as-is rather than stripped so it needs no edit here
					// when redemption comes back.
					redeem_points: t.redeem || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						qty: r.qty,
						rate: r.rate,
						uom: r.uom,
						batch_no: r.batch_no || null,
						discount_amount: r.discount || 0,
					})),
				},
				1
			)
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				if (typeof santu_print_thermal_bill === "function") {
					santu_print_thermal_bill("Sales Invoice", r.name);
				}
				// Offer WhatsApp right after saving (2026-08-18 direct
				// request) — Billing closes the tab immediately on save, so
				// there's no "bill stays open, share it from here" moment
				// like Sale Invoice has; this is that moment instead. Only
				// for a real customer — Walk-in never has a phone number on
				// file, and send_transaction would just show "No WhatsApp
				// Number" for no reason on every cash sale.
				// "Save & Print Only" (2026-08-19 direct request) skips this
				// entirely — some bills genuinely shouldn't go out on
				// WhatsApp, and that has to be a choice made before saving,
				// not something to catch and cancel after the message dialog
				// has already popped up.
				if (!opts.skip_whatsapp && b.customer && window.santu_whatsapp_share) {
					window.santu_whatsapp_share.send_transaction("Sales Invoice", r.name);
				}
				// Bill done: drop this tab and open a clean one, which is how
				// a counter actually works.
				this.tabs = this.tabs.filter((x) => x.id !== b.id);
				if (!this.tabs.length) this._new_bill(false);
				this.active_id = this.tabs[0].id;
				this._persist_soon();
				this.render();
			})
			.catch(() => frappe.dom.unfreeze());
	},

	// ---------- events ----------
	_bind() {
		const b = this._bill();
		const $r = this.$root;

		$r.find(".santu-bill-newtab").on("click", () => {
			this._new_bill();
			this.render();
		});
		$r.find(".santu-bill-search").on("input", santu_sale_invoice.utils.debounce((e) => this._search($(e.target).val())));
		$r.find(".santu-bill-customer").on("input", santu_sale_invoice.utils.debounce((e) => this._cust_search($(e.target).val())));
		$r.find(".santu-bill-customer").on("focus", () => this._cust_search($r.find(".santu-bill-customer").val()));
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
		$r.find(".santu-bill-fkeys button").on("click", (e) => this._action($(e.currentTarget).data("act")));
		$r.find(".santu-bill-save").on("click", () => this._save());
		$r.find(".santu-bill-save-only").on("click", () => this._save({ skip_whatsapp: true }));
		// No longer a separate all-or-nothing credit save — clears Amount
		// Received to 0 (the whole bill becomes baaki, same as before) and
		// hands off to the one normal save flow, which now handles baaki
		// itself via `_save()`'s `t.remaining` check.
		$r.find(".santu-bill-credit").on("click", () => {
			b.amount_received = 0;
			$r.find(".santu-bill-received").val("");
			this._persist_soon();
			this._render_totals();
			this._save();
		});

		$(document).off("click.santu-bill").on("click.santu-bill", (e) => {
			if (!$(e.target).closest(".santu-bill-searchwrap").length) $r.find(".santu-bill-dropdown").hide();
			if (!$(e.target).closest(".santu-bill-custwrap").length) $r.find(".santu-bill-cust-dropdown").hide();
		});

		// The F-keys are the point of a counter screen — a cashier should
		// never have to reach for the mouse mid-bill.
		$(document).off("keydown.santu-bill").on("keydown.santu-bill", (ev) => {
			if (frappe.get_route()[0] !== "santu-billing") return;
			// F10 dropped from the map (was "loyalty") — loyalty points
			// switched off for now, 2026-08-18.
			const map = { F2: "qty", F3: "idisc", F4: "remove", F5: "rate", F6: "unit", F7: "rename", F8: "charges", F9: "bdisc", F11: "privacy", F12: "remarks" };
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
					if (ev.shiftKey) this._save({ skip_whatsapp: true });
					else this._save();
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
