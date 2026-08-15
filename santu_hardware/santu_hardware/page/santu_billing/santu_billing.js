/* global frappe, santu_sale_invoice, santu_billing_page, santu_is_privacy_mode_active, santu_toggle_privacy_mode */
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
	frappe.require(["/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js"], () => {
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
			amount_received: 0,
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
		const sub = b.items.reduce((a, r) => a + this._row_total(r), 0);
		const tax = b.items.reduce((a, r) => a + (Number(r.tax_amount) || 0), 0);
		const total = Math.max(sub + tax + (Number(b.additional_charges) || 0) - (Number(b.bill_discount) || 0), 0);
		// Points never reduce the bill itself — the goods still sold for the
		// full amount. They reduce what the customer pays at the counter, so
		// the change calculation works off `payable`, not `total`.
		const redeem = Math.min(Number(b.redeem_points) || 0, total);
		const payable = Math.max(total - redeem, 0);
		const change = Math.max((Number(b.amount_received) || 0) - payable, 0);
		return { sub, tax, total, redeem, payable, change, qty: b.items.reduce((a, r) => a + (Number(r.qty) || 0), 0) };
	},

	// ---------- render ----------
	render() {
		if (!this.tabs.length) this._new_bill(false);
		const b = this._bill();
		const modes = this.init_data.payment_modes || [];
		$(this.page.body).html(`
			<div class="santu-bill">
				<div class="santu-bill-tabbar">
					<div class="santu-bill-tabs"></div>
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
										<th class="c-rate">PRICE/UNIT(₹)<span>Without Tax</span></th>
										<th class="c-disc">DISCOUNT (₹)</th>
										<th class="c-tax">TAX APPLIED(₹)</th>
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
									<input type="number" min="0" step="any" class="santu-bill-received" value="${b.amount_received || ""}" placeholder="0.00">
								</div>
							</div>
						</div>

						<div class="santu-bill-loyalty-line" style="display:none"></div>

						<div class="santu-bill-spacer"></div>

						<div class="santu-bill-changerow">
							<span>Change to Return:</span>
							<span class="santu-bill-change">₹ 0.00</span>
						</div>
					</div>
				</div>

				<div class="santu-bill-actions">
					<div class="santu-bill-fkeys">
						<button type="button" data-act="qty">Change Quantity <b>[F2]</b></button>
						<button type="button" data-act="idisc">Item Discount <b>[F3]</b></button>
						<button type="button" data-act="remove">Remove Item <b>[F4]</b></button>
						<button type="button" data-act="unit">Change Unit <b>[F6]</b></button>
						<button type="button" data-act="charges">Additional Charges <b>[F8]</b></button>
						<button type="button" data-act="bdisc">Bill Discount <b>[F9]</b></button>
						<button type="button" data-act="loyalty">Loyalty Points <b>[F10]</b></button>
						<button type="button" data-act="remarks">Remarks <b>[F12]</b></button>
						<button type="button" data-act="privacy">Show Cost <b>[F11]</b></button>
					</div>
					<div class="santu-bill-savecol">
						<button type="button" class="santu-bill-save">Save &amp; Print Bill <span class="santu-bill-kbd">Ctrl+P</span></button>
						<button type="button" class="santu-bill-credit">Other/Credit Payments <span class="santu-bill-kbd">Ctrl+M</span></button>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-bill");
		this._render_tabs();
		this._render_rows();
		this._bind();
		this.$root.find(".santu-bill-search").focus();
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
					<td class="c-name">${frappe.utils.escape_html(r.item_name)}</td>
					<td class="c-qty">${format_number(r.qty, null, 2)}</td>
					<td class="c-unit">${frappe.utils.escape_html(r.uom || "-")}</td>
					<td class="c-rate">${format_number(r.rate, null, 2)}${
						privacy_on && r.cost_price != null
							? `<span class="santu-bill-cost">${__("cost")} ₹${format_number(r.cost_price, null, 2)}</span>`
							: ""
					}</td>
					<td class="c-disc">${format_number(r.discount || 0, null, 2)}</td>
					<td class="c-tax">${format_number(r.tax_amount || 0, null, 2)}</td>
					<td class="c-total">${format_number(this._row_total(r), null, 2)}</td>
				</tr>
			`);
			$tr.on("click", () => {
				b.selected_row = r.id;
				this._render_rows();
			});
			$tb.append($tr);
		});
		this._render_totals();
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
			$dd.toggle(rows.length > 0);
		});
	},

	_add_item(item_code) {
		const b = this._bill();
		this.$root.find(".santu-bill-dropdown").hide().empty();
		this.$root.find(".santu-bill-search").val("").focus();
		santu_sale_invoice.api.item_row(b.customer, item_code, this.init_data.warehouse, 1).then((row) => {
			const existing = b.items.find((r) => r.item_code === item_code);
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
					// Same order the Sale Invoice screen uses.
					rate: row.price_list_rate || row.rate || 0,
					discount: 0,
					tax_rate: row.tax_rate || 0,
					tax_amount: 0,
				});
				b.selected_row = b.items[b.items.length - 1].id;
			}
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
			if (r) this._prompt(__("Change Quantity"), __("Quantity"), "Float", r.qty, (v) => (r.qty = Math.max(Number(v) || 0, 0)));
		} else if (act === "idisc") {
			const r = this._selected();
			if (r) this._prompt(__("Item Discount"), __("Discount (₹)"), "Currency", r.discount, (v) => (r.discount = Math.max(Number(v) || 0, 0)));
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

	_loyalty() {
		const b = this._bill();
		const t = this._totals();
		if (!b.items.length) {
			frappe.show_alert({ message: __("Add some items first, then use points."), indicator: "orange" });
			return;
		}
		// A bill with no customer picked is billed to Walk-in Customer on
		// save, so that is whose points apply here too.
		const customer = b.customer || "Walk-in Customer";
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
						message: __("{0} has 0 points. Points build up at 1 point for every ₹100 of billing.", [customer]),
						indicator: "blue",
					});
					return;
				}
				// Never let a bill be paid entirely by points beyond its own
				// value — ERPNext would reject it and the operator would be
				// left staring at a stack trace mid-sale.
				const max_points = Math.floor(Math.min(st.points, t.total / (st.conversion_factor || 1)));
				const d = new frappe.ui.Dialog({
					title: __("Use Reward Points"),
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "info",
							options: `<div class="santu-bill-loyalty-info">
								<div><b>${frappe.utils.escape_html(customer)}</b></div>
								<div>${__("Points in account")}: <b>${st.points}</b> (${__("worth")} ₹ ${format_number(st.value, null, 2)})</div>
								<div>${__("This bill")}: ₹ ${format_number(t.total, null, 2)}</div>
								<div>${__("Can use now")}: <b>${max_points}</b> ${__("points")}</div>
							</div>`,
						},
						{
							fieldtype: "Int",
							fieldname: "points",
							label: __("Points to use"),
							default: b.redeem_points ? Math.round(b.redeem_points / (st.conversion_factor || 1)) : max_points,
							description: __("1 point = ₹ {0} off. Leave 0 to use none.", [format_number(st.conversion_factor || 1, null, 2)]),
						},
					],
					primary_action_label: __("Apply"),
					primary_action: (v) => {
						const pts = Math.max(Math.min(cint(v.points), max_points), 0);
						b.redeem_points = pts * (st.conversion_factor || 1);
						d.hide();
						this._persist_soon();
						this._render_totals();
						frappe.show_alert({
							message: pts
								? __("{0} points used — ₹ {1} off.", [pts, format_number(b.redeem_points, null, 2)])
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
				${t.tax ? line("Tax", t.tax) : ""}
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
		santu_sale_invoice.api.search_customers(q).then((rows) => draw(rows || []));
	},

	// Matches Vyapar's own Add Customer modal (2026-08-15 screenshot): name
	// carried over from what was already typed, phone, billing address.
	_add_customer(prefill) {
		const self = this;
		$("#santu-bill-addcust-modal").remove();
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
						<div class="santu-bill-modal-field">
							<label>Billing Address</label>
							<textarea class="ac-address" rows="4" placeholder="Billing Address"></textarea>
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
		};
		$m.find(".santu-bill-modal-x, .santu-bill-modal-cancel").on("click", close);
		$m.on("click", (e) => {
			if (e.target === $m[0]) close();
		});
		$(document).on("keydown.santu-bill-ac", (e) => {
			if (e.key === "Escape") close();
		});

		$m.find(".santu-bill-modal-save").on("click", () => {
			const name = ($m.find(".ac-name").val() || "").trim();
			const phone = ($m.find(".ac-phone").val() || "").trim();
			const address = ($m.find(".ac-address").val() || "").trim();
			if (!name) {
				frappe.show_alert({ message: __("Enter a customer name."), indicator: "orange" });
				return;
			}
			// One of phone or address, not both — enough to find this person
			// again without holding up the counter. Checked here too so the
			// message lands next to the fields rather than as a server error.
			if (!phone && !address) {
				frappe.show_alert({
					message: __("Add a phone number or an address — one of the two."),
					indicator: "orange",
				});
				return;
			}
			const payload = { customer_name: name, phone };
			if (address) {
				payload.address_line1 = address;
				// india_compliance rejects an Indian Address with no state, and
				// city is mandatory on Address — the shop's own are sent so the
				// counter is never asked for fields this form doesn't show.
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
	_save(credit) {
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
		if (credit && !b.customer) {
			// A credit sale has to be owed BY someone. Same rule the Sale
			// Invoice screen enforces when a Walk-in is picked.
			frappe.msgprint(__("Pick a customer before selling on credit — a walk-in bill has to be paid now."));
			return;
		}
		const payments = credit
			? []
			: [{ mode_of_payment: b.payment_mode, amount: Math.min(Number(b.amount_received) || t.payable, t.payable) }];

		frappe.dom.freeze(__("Saving…"));
		santu_sale_invoice.api
			.save(
				{
					customer: customer,
					company: this.init_data.company,
					warehouse: this.init_data.warehouse,
					posting_date: b.posting_date,
					selling_price_list: this.init_data.selling_price_list,
					payment_mode: credit ? "credit" : "cash",
					payments,
					additional_discount_amount: b.bill_discount || 0,
					description: b.remarks || null,
				redeem_points: t.redeem || 0,
					items: b.items.map((r) => ({
						item_code: r.item_code,
						qty: r.qty,
						rate: r.rate,
						uom: r.uom,
						discount_amount: r.discount || 0,
					})),
				},
				1
			)
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				if (!credit && typeof santu_print_thermal_bill === "function") {
					santu_print_thermal_bill("Sales Invoice", r.name);
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
		$r.find(".santu-bill-save").on("click", () => this._save(false));
		$r.find(".santu-bill-credit").on("click", () => this._save(true));

		$(document).off("click.santu-bill").on("click.santu-bill", (e) => {
			if (!$(e.target).closest(".santu-bill-searchwrap").length) $r.find(".santu-bill-dropdown").hide();
			if (!$(e.target).closest(".santu-bill-custwrap").length) $r.find(".santu-bill-cust-dropdown").hide();
		});

		// The F-keys are the point of a counter screen — a cashier should
		// never have to reach for the mouse mid-bill.
		$(document).off("keydown.santu-bill").on("keydown.santu-bill", (ev) => {
			if (frappe.get_route()[0] !== "santu-billing") return;
			const map = { F2: "qty", F3: "idisc", F4: "remove", F6: "unit", F8: "charges", F9: "bdisc", F10: "loyalty", F11: "privacy", F12: "remarks" };
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
					this._save(false);
				} else if (ev.key === "m") {
					ev.preventDefault();
					this._save(true);
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
