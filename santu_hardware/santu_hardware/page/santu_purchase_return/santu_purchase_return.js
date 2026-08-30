/* global frappe, santu_purchase_invoice, santu_purchase_return, santu_is_privacy_mode_active, santu_toggle_privacy_mode */
// Santu Hardware — Purchase Return / Debit Note, rebuilt to match Billing
// (POS)'s own UI (2026-08-19 direct request: "return ka dono ui v pos
// billing ki tarah kr"). Buying-side mirror of the Sales Return screen.
// Reuses Billing's CSS classes (santu-bill-*) verbatim. Backed onto a real
// Purchase Invoice with is_return=1 via save_purchase_return — same shape
// as save_sales_return, plus an optional "Return Against" bill, which
// prefills its lines with how much of each is still returnable and caps
// qty there.
//
// Quantities stay POSITIVE on screen ("2 pieces went back"); the negation
// ERPNext needs happens once, server-side, in save_purchase_return.
frappe.pages["santu-purchase-return"].on_page_load = function (wrapper) {
	frappe.require(
		[
			// _render_rows() calls santu_sale_invoice.utils.scroll_row_into_view,
			// so that bundle has to be loaded here too. Without it the screen
			// threw on its first render and showed an EMPTY item table whenever
			// Purchase Return was opened directly rather than after a sale screen
			// had happened to define the global (found 2026-08-30).
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
			"/assets/santu_hardware/js/santu_purchase_return/santu_purchase_return_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Purchase Return", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-bill-page-main");
			santu_purchase_return_page.init(page);
		}
	);
};

frappe.pages["santu-purchase-return"].on_page_show = function () {
	if (window.santu_purchase_return_page && santu_purchase_return_page.page) santu_purchase_return_page.render();
};

const SANTU_PR_KEY = "santu_purchase_return_tabs_v2";
const SANTU_PR_ICON_DIR = "/assets/santu_hardware/images/items";
const santu_pr_icon = (file, cls = "") => `<img class="santu-si2-ico ${cls}" src="${SANTU_PR_ICON_DIR}/${file}" alt="" draggable="false">`;

window.santu_purchase_return_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._persist_soon = santu_purchase_invoice.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-bill-loading">Loading…</div>`);
		santu_purchase_invoice.api.init().then((data) => {
			this.init_data = data;
			this._load();
			if (!this.tabs.length) this._new_ret(false);
			this.render();
		});
	},

	// ---------- state ----------
	_load() {
		try {
			const raw = localStorage.getItem(SANTU_PR_KEY);
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
			localStorage.setItem(SANTU_PR_KEY, JSON.stringify({ tabs: this.tabs, active_id: this.active_id }));
		} catch (e) {
			/* storage unavailable — screen still works */
		}
	},

	_blank_ret() {
		return {
			id: santu_purchase_invoice.utils.uid(),
			posting_date: this.init_data.posting_date,
			supplier: null,
			supplier_label: "",
			return_against: null,
			return_invoices: [],
			reason: "",
			// No default — the operator must actively pick one, matching
			// the same 2026-08-26 fix on Sales Return: a silent "credit"
			// default let a real cash-back-from-supplier go unrecorded,
			// leaving a phantom balance nobody told the system about.
			settlement: null,
			refund_mode: "Cash",
			items: [],
			selected_row: null,
			bill_discount: 0,
			additional_charges: 0,
			saved: null,
		};
	},
	_new_ret(focus = true) {
		const b = this._blank_ret();
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
		const sub = b.items.reduce((a, r) => a + this._row_total(r), 0);
		const total = Math.max(sub + (Number(b.additional_charges) || 0) - (Number(b.bill_discount) || 0), 0);
		return { sub, total, qty: b.items.reduce((a, r) => a + (Number(r.qty) || 0), 0) };
	},

	// ---------- render ----------
	render() {
		if (!this.tabs.length) this._new_ret(false);
		const b = this._bill();
		$(this.page.body).html(`
			<div class="santu-bill">
				<div class="santu-bill-tabbar">
					<div class="santu-bill-tabs"></div>
					<div class="santu-si2-toolbar">
						<button type="button" class="santu-si2-icon-btn" data-action="calculator" title="Calculator">${santu_pr_icon("calculator.svg", "is-on-dark")}</button>
					</div>
					<button type="button" class="santu-bill-newtab">+ New Return <span class="santu-bill-kbd">Ctrl+T</span></button>
				</div>

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
						</div>
						<div class="santu-bill-custwrap">
							<input type="text" class="santu-bill-customer" placeholder="Search for a supplier by name [F11]" value="${frappe.utils.escape_html(b.supplier_label || "")}" autocomplete="off">
							<div class="santu-bill-cust-dropdown" style="display:none;"></div>
						</div>
						<div class="santu-bill-field">
							<label>Return Against</label>
							<select class="santu-bill-return-against">
								<option value="">No bill (direct return)</option>
								${(b.return_invoices || [])
									.map(
										(inv) =>
											`<option value="${frappe.utils.escape_html(inv.name)}" ${inv.name === b.return_against ? "selected" : ""}>${frappe.utils.escape_html(inv.name)} · ₹${format_number(inv.grand_total, null, 2)}</option>`
									)
									.join("")}
							</select>
						</div>

						<div class="santu-bill-field">
							<label>Paisa Kaise Settle Hoga?</label>
							<select class="santu-bill-settlement">
								<option value="" ${!b.settlement ? "selected" : ""} disabled>-- Chuno --</option>
								<option value="credit" ${b.settlement === "credit" ? "selected" : ""}>Khata me credit rahega</option>
								<option value="refund" ${b.settlement === "refund" ? "selected" : ""}>Supplier ne abhi cash/UPI refund diya</option>
							</select>
						</div>
						<div class="santu-bill-field santu-bill-refund-mode-wrap" style="${b.settlement === "refund" ? "" : "display:none;"}">
							<label>Refund Mode</label>
							<select class="santu-bill-refund-mode">
								${["Cash", "UPI", "Card", "Bank Transfer", "Cheque"]
									.map((m) => `<option value="${m}" ${m === (b.refund_mode || "Cash") ? "selected" : ""}>${m}</option>`)
									.join("")}
							</select>
						</div>

						<div class="santu-bill-totalcard">
							<div class="santu-bill-totalcard-left">
								<span class="santu-bill-receipt">↩️</span>
								<div>
									<div class="santu-bill-total-big">Debit ₹ 0.00</div>
									<div class="santu-bill-total-sub">Items: 0 , Quantity: 0</div>
								</div>
							</div>
							<button type="button" class="santu-bill-breakup">Full Breakup<br><span class="santu-bill-kbd-inline">[Ctrl+F]</span> ›</button>
						</div>

						${b.saved ? `<div class="santu-bill-inv-row"><span>Return No.</span><span>${frappe.utils.escape_html(b.saved.name)}</span></div>` : ""}
					</div>
				</div>

				<div class="santu-bill-actions">
					<div class="santu-bill-fkeys">
						<button type="button" data-act="qty">Change Quantity <b>[F2]</b></button>
						<button type="button" data-act="idisc">Item Discount <b>[F3]</b></button>
						<button type="button" data-act="remove">Remove Item <b>[F4]</b></button>
						<button type="button" data-act="rate">Purchase Value <b>[F5]</b></button>
						<button type="button" data-act="unit">Change Unit <b>[F6]</b></button>
						<button type="button" data-act="rename">Item Name <b>[F7]</b></button>
						<button type="button" data-act="charges">Additional Charges <b>[F8]</b></button>
						<button type="button" data-act="bdisc">Bill Discount <b>[F9]</b></button>
						<button type="button" data-act="reason">Reason <b>[F12]</b></button>
					</div>
					<div class="santu-bill-savecol">
						<button type="button" class="santu-bill-save">Save Return <span class="santu-bill-kbd">Ctrl+S</span></button>
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

	_render_tabs() {
		const $t = this.$root.find(".santu-bill-tabs").empty();
		this.tabs.forEach((b, i) => {
			const label = b.saved ? b.saved.name : `Return #${i + 1}`;
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
			if (!this.tabs.length) this._new_ret(false);
			if (this.active_id === id) this.active_id = this.tabs[0].id;
			this._persist_soon();
			this.render();
		};
		if (!b.items.length) return drop();
		frappe.confirm(__("This return has items. Close anyway?"), drop);
	},

	_render_rows() {
		const b = this._bill();
		const privacy_on = typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active();
		const $tb = this.$root.find(".santu-bill-grid tbody").empty();
		b.items.forEach((r, i) => {
			const is_cpvc = santu_is_cpvc_item(r.item_code, r.item_name);
			const $tr = $(`
				<tr class="${r.id === b.selected_row ? "is-selected" : ""} ${is_cpvc ? "santu-cpvc-row" : ""}" data-row="${r.id}">
					<td class="c-idx">${i + 1}</td>
					<td class="c-code">${frappe.utils.escape_html(r.item_code || "-")}</td>
					<td class="c-name santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${frappe.utils.escape_html(r.item_name)}${
						r.max_qty ? `<span class="santu-bill-batch-tag">${__("max")} ${format_number(r.max_qty, null, 2)}</span>` : ""
					}</td>
					<td class="c-qty">
						<span class="santu-bill-qty-stepper">
							<button type="button" class="santu-bill-qty-btn" data-step="-1">−</button>
							<span class="santu-bill-editable santu-bill-qty-val" title="${__("Badalne ke liye dabaiye")}">${format_number(r.qty, null, 2)}</span>
							<button type="button" class="santu-bill-qty-btn" data-step="1">+</button>
						</span>
					</td>
					<td class="c-unit">${frappe.utils.escape_html(r.uom || "-")}</td>
					<td class="c-rate santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.rate, null, 2)}</td>
					<td class="c-disc santu-bill-editable" title="${__("Badalne ke liye dabaiye")}">${format_number(r.discount || 0, null, 2)}</td>
					<td class="c-total">${format_number(this._row_total(r), null, 2)}</td>
				</tr>
			`);
			$tr.on("click", () => {
				b.selected_row = r.id;
				this._render_rows();
			});
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
					r.qty = this._clamp_qty(r, v);
				});
			});
			$tr.find(".santu-bill-qty-btn").on("click", (e) => {
				e.stopPropagation();
				b.selected_row = r.id;
				const step = Number($(e.currentTarget).attr("data-step")) || 0;
				r.qty = this._clamp_qty(r, (Number(r.qty) || 0) + step);
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
		// Newly added rows land at the bottom; bring the selected one back into
		// view so the operator sees it go in without scrolling.
		santu_sale_invoice.utils.scroll_row_into_view(this.$root);
	},

	_clamp_qty(r, v) {
		const n = Math.max(Number(v) || 0, 0);
		if (r.max_qty && n > r.max_qty) {
			frappe.show_alert({ message: __("Only {0} of {1} can be returned.", [r.max_qty, r.item_name]), indicator: "orange" });
			return r.max_qty;
		}
		return n;
	},

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

	_render_totals() {
		const b = this._bill();
		const t = this._totals();
		this.$root.find(".santu-bill-total-big").text(`Debit ₹ ${format_number(t.total, null, 2)}`);
		this.$root.find(".santu-bill-total-sub").text(`Items: ${b.items.length} , Quantity: ${format_number(t.qty, null, 0)}`);
		this.$root.find(".santu-bill-grandrow").text(`₹ ${format_number(t.total, null, 2)}`);
	},

	// ---------- items ----------
	_search(q) {
		const $dd = this.$root.find(".santu-bill-dropdown");
		if (!q || q.length < 2) return $dd.hide().empty();
		santu_purchase_invoice.api.search_items(q).then((res) => {
			const rows = res.results || res || [];
			$dd.empty();
			rows.forEach((it) => {
				$(`
					<div class="santu-bill-dd-row ${santu_cpvc_dd_class(it.item_code, it.item_name)}">
						<div><b>${frappe.utils.escape_html(it.item_name)}</b><span>${frappe.utils.escape_html(it.item_code)}</span></div>
						<div class="santu-bill-dd-right">₹ ${format_number(it.price || 0, null, 2)}</div>
					</div>
				`)
					.on("click", () => this._add_item(it.item_code))
					.appendTo($dd);
			});
			if (res.exact_match) {
				this._add_item(res.exact_match);
				return;
			}
			$dd.show();
		});
	},

	_add_item(item_code) {
		const b = this._bill();
		this.$root.find(".santu-bill-dropdown").hide().empty();
		this.$root.find(".santu-bill-search").val("").focus();
		const existing = b.items.find((r) => r.item_code === item_code);
		if (existing) {
			existing.qty = this._clamp_qty(existing, (Number(existing.qty) || 0) + 1);
			this._persist_soon();
			this._render_rows();
			return;
		}
		santu_purchase_invoice.api.item_row(b.supplier, item_code, this.init_data.warehouse, 1).then((row) => {
			b.items.push({
				id: santu_purchase_invoice.utils.uid(),
				item_code: row.item_code || item_code,
				item_name: row.item_name || item_code,
				qty: 1,
				uom: row.uom || row.stock_uom,
				uom_options: [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i),
				rate: row.price_list_rate || row.rate || 0,
				discount: 0,
			});
			b.selected_row = b.items[b.items.length - 1].id;
			this._persist_soon();
			this._render_rows();
		});
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
			if (r) this._prompt(__("Change Quantity"), __("Quantity"), "Float", r.qty, (v) => (r.qty = this._clamp_qty(r, v)));
		} else if (act === "idisc") {
			const r = this._selected();
			if (r) this._prompt(__("Item Discount"), __("Discount (₹)"), "Currency", r.discount, (v) => (r.discount = Math.max(Number(v) || 0, 0)));
		} else if (act === "rate") {
			const r = this._selected();
			if (r) this._prompt(__("Purchase Value"), __("Price per unit (₹)"), "Currency", r.rate, (v) => (r.rate = Math.max(Number(v) || 0, 0)));
		} else if (act === "rename") {
			const r = this._selected();
			if (r) this._prompt(__("Item Name"), __("Name on this return"), "Data", r.item_name, (v) => (r.item_name = (v || "").trim() || r.item_name));
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
		} else if (act === "reason") {
			this._prompt(__("Reason"), __("Why is this going back?"), "Small Text", b.reason, (v) => (b.reason = v || ""));
		} else if (act === "privacy") {
			Promise.resolve(window.santu_toggle_privacy_mode()).then(() => this._render_rows());
		}
	},

	_breakup() {
		const t = this._totals();
		const b = this._bill();
		const line = (l, v, cls) =>
			`<div class="santu-bill-bk-row ${cls || ""}"><span>${l}</span><span>:</span><span>₹ ${format_number(v, null, 2)}</span></div>`;
		const d = new frappe.ui.Dialog({ title: __("Full Return Breakup"), fields: [{ fieldtype: "HTML", fieldname: "bk" }] });
		d.fields_dict.bk.$wrapper.html(`
			<div class="santu-bill-bk">
				${line("Sub Total", t.sub)}
				${b.additional_charges ? line("Additional Charges", b.additional_charges) : ""}
				${b.bill_discount ? line("Bill Discount", -b.bill_discount) : ""}
				${line("Debit Total", t.total, "is-total")}
			</div>
		`);
		d.show();
	},

	// ---------- supplier ----------
	_pick_supplier(name, label) {
		const b = this._bill();
		b.supplier = name;
		b.supplier_label = label;
		b.return_against = null;
		b.return_invoices = [];
		this.$root.find(".santu-bill-customer").val(label);
		this.$root.find(".santu-bill-cust-dropdown").hide().empty();
		this._persist_soon();
		santu_purchase_return.api.returnable_invoices(name).then((rows) => {
			b.return_invoices = rows || [];
			this._persist_soon();
			this._render_return_against();
		});
	},

	_render_return_against() {
		const b = this._bill();
		const $sel = this.$root.find(".santu-bill-return-against");
		$sel.html(`
			<option value="">No bill (direct return)</option>
			${(b.return_invoices || [])
				.map(
					(inv) =>
						`<option value="${frappe.utils.escape_html(inv.name)}" ${inv.name === b.return_against ? "selected" : ""}>${frappe.utils.escape_html(inv.name)} · ₹${format_number(inv.grand_total, null, 2)}</option>`
				)
				.join("")}
		`);
	},

	_select_return_against(invoice) {
		const b = this._bill();
		b.return_against = invoice;
		this._persist_soon();
		if (!invoice) return;
		santu_purchase_return.api.invoice_items(invoice).then((r) => {
			const rows = (r.items || []).filter((row) => row.returnable_qty > 0);
			if (!rows.length) {
				frappe.show_alert({ message: __("Everything on {0} has already been returned.", [invoice]), indicator: "orange" });
				return;
			}
			b.items = rows.map((row) => ({
				id: santu_purchase_invoice.utils.uid(),
				item_code: row.item_code,
				item_name: row.item_name || row.item_code,
				purchase_invoice_item: row.row_name,
				qty: row.returnable_qty,
				max_qty: row.returnable_qty,
				uom: row.uom || row.stock_uom,
				uom_options: [row.uom, row.stock_uom].filter((v, i, a) => v && a.indexOf(v) === i),
				rate: row.rate,
				discount: 0,
			}));
			this._persist_soon();
			this._render_rows();
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
				$(`
					<div class="santu-bill-cust-row">
						<span>${frappe.utils.escape_html(c.supplier_name || c.name)}</span>
						<span class="santu-bill-cust-phone">${frappe.utils.escape_html(c.mobile_no || "—")}</span>
					</div>
				`)
					.on("click", () => this._pick_supplier(c.name, c.supplier_name || c.name))
					.appendTo($dd);
			});
			$(`<button type="button" class="santu-bill-addcust">Add Supplier <span class="santu-bill-kbd">Ctrl+D</span></button>`)
				.on("click", () => this._add_supplier(this.$root.find(".santu-bill-customer").val()))
				.appendTo($dd);
			$dd.show();
		};
		if (!q || q.length < 2) {
			draw([]);
			return;
		}
		santu_purchase_invoice.api.search_suppliers(q).then((rows) => draw(rows || []));
	},

	_add_supplier(prefill) {
		const self = this;
		$("#santu-bill-addcust-modal").remove();
		const $m = $(`
			<div id="santu-bill-addcust-modal" class="santu-bill-modal-backdrop">
				<div class="santu-bill-modal">
					<div class="santu-bill-modal-head">
						<span>Add Supplier</span>
						<button type="button" class="santu-bill-modal-x">✕ <small>[Esc]</small></button>
					</div>
					<div class="santu-bill-modal-body">
						<div class="santu-bill-modal-grid">
							<div class="santu-bill-modal-field">
								<label>Supplier Name<em>*</em></label>
								<input type="text" class="ac-name" value="${frappe.utils.escape_html(prefill || "")}">
							</div>
							<div class="santu-bill-modal-field">
								<label>Phone Number</label>
								<input type="text" class="ac-phone" placeholder="Phone Number">
							</div>
						</div>
						<div class="santu-bill-modal-field">
							<label>GSTIN<span class="santu-bill-modal-hint">${__("Optional")}</span></label>
							<input type="text" class="ac-gstin" placeholder="GSTIN">
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
			$(document).off("keydown.santu-pr-ac");
		};
		$m.find(".santu-bill-modal-x, .santu-bill-modal-cancel").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-pr-ac", (e) => {
			if (e.key === "Escape") close();
		});

		$m.find(".santu-bill-modal-save").on("click", () => {
			const name = ($m.find(".ac-name").val() || "").trim();
			const phone = ($m.find(".ac-phone").val() || "").trim();
			const gstin = ($m.find(".ac-gstin").val() || "").trim();
			if (!name) {
				frappe.show_alert({ message: __("Enter a supplier name."), indicator: "orange" });
				return;
			}
			frappe.dom.freeze(__("Saving…"));
			santu_purchase_invoice.api
				.create_supplier_full({ customer_name: name, phone, gstin })
				.then((created) => {
					frappe.dom.unfreeze();
					close();
					self._pick_supplier(created, name);
					frappe.show_alert({ message: __("Supplier added"), indicator: "green" });
				})
				.catch(() => frappe.dom.unfreeze());
		});

		setTimeout(() => $m.find(".ac-name").focus().select(), 60);
	},

	// ---------- save ----------
	_save() {
		const b = this._bill();
		if (!b.items.length) {
			frappe.msgprint(__("Add at least one item."));
			return;
		}
		if (!b.supplier) {
			frappe.msgprint(__("Please select or add a supplier."));
			return;
		}
		if (!b.settlement) {
			frappe.msgprint(__("Paisa Kaise Settle Hoga — Khata credit ya Refund, ek chuno."));
			return;
		}

		frappe.dom.freeze(__("Saving…"));
		santu_purchase_return.api
			.save(
				{
					supplier: b.supplier,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: b.posting_date,
					return_against: b.return_against || null,
					reason: b.reason || null,
					buying_price_list: this.init_data.buying_price_list,
					additional_discount_amount: b.bill_discount || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						item_name: r.item_name,
						qty: r.qty,
						rate: r.rate,
						uom: r.uom,
						purchase_invoice_item: r.purchase_invoice_item || null,
						discount_amount: r.discount || 0,
					})),
				},
				1
			)
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				// "Supplier ne abhi cash/UPI refund diya" — settle it with a
				// real Payment Entry right away (2026-08-19, matching the
				// same fix on Sales Return).
				if (b.settlement === "refund") {
					santu_purchase_return.api
						.create_refund_payment("Purchase Invoice", r.name, b.refund_mode || "Cash")
						.then(() => frappe.show_alert({ message: __("Refund recorded"), indicator: "green" }))
						.catch(() =>
							frappe.msgprint({
								title: __("Refund note nahi ban paya"),
								message: __("Return {0} ban gaya, par refund entry banane me dikkat aayi — Payment Entry banake manually is return se link kar dein.", [r.name]),
								indicator: "orange",
							})
						);
				}
				this.tabs = this.tabs.filter((x) => x.id !== b.id);
				if (!this.tabs.length) this._new_ret(false);
				this.active_id = this.tabs[0].id;
				this._persist_soon();
				this.render();
				if (window.santu_open_invoice_view) window.santu_open_invoice_view("Purchase Invoice", r.name);
			})
			.catch(() => frappe.dom.unfreeze());
	},

	// ---------- events ----------
	_bind() {
		const b = this._bill();
		const $r = this.$root;

		$r.find(".santu-bill-newtab").on("click", () => {
			this._new_ret();
			this.render();
		});
		$r.find(".santu-bill-search").on("input", santu_purchase_invoice.utils.debounce((e) => this._search($(e.target).val())));
		$r.find(".santu-bill-customer").on("input", santu_purchase_invoice.utils.debounce((e) => this._cust_search($(e.target).val())));
		$r.find(".santu-bill-customer").on("focus", () => this._cust_search($r.find(".santu-bill-customer").val()));
		$r.find(".santu-bill-date").on("change", (e) => {
			b.posting_date = e.target.value;
			this._persist_soon();
		});
		$r.find(".santu-bill-return-against").on("change", (e) => this._select_return_against(e.target.value || null));
		$r.find(".santu-bill-settlement").on("change", (e) => {
			b.settlement = e.target.value;
			this._persist_soon();
			$r.find(".santu-bill-refund-mode-wrap").toggle(b.settlement === "refund");
		});
		$r.find(".santu-bill-refund-mode").on("change", (e) => {
			b.refund_mode = e.target.value;
			this._persist_soon();
		});
		$r.find(".santu-bill-breakup").on("click", () => this._breakup());
		$r.find(".santu-bill-fkeys button").on("click", (e) => this._action($(e.currentTarget).data("act")));
		$r.find(".santu-bill-save").on("click", () => this._save());

		$(document).off("click.santu-pr").on("click.santu-pr", (e) => {
			if (!$(e.target).closest(".santu-bill-searchwrap").length) $r.find(".santu-bill-dropdown").hide();
			if (!$(e.target).closest(".santu-bill-custwrap").length) $r.find(".santu-bill-cust-dropdown").hide();
		});

		$(document).off("keydown.santu-pr").on("keydown.santu-pr", (ev) => {
			if (frappe.get_route()[0] !== "santu-purchase-return") return;
			const map = { F2: "qty", F3: "idisc", F4: "remove", F5: "rate", F6: "unit", F7: "rename", F8: "charges", F9: "bdisc", F12: "reason" };
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
					this._new_ret();
					this.render();
				} else if (ev.key === "s") {
					ev.preventDefault();
					this._save();
				} else if (ev.key === "f") {
					ev.preventDefault();
					this._breakup();
				} else if (ev.key === "d") {
					ev.preventDefault();
					this._add_supplier($r.find(".santu-bill-customer").val());
				} else if (ev.key === "w") {
					ev.preventDefault();
					this._close_tab(this.active_id);
				}
			}
		});
	},
};
