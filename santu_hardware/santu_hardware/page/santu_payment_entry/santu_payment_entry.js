/* global frappe, santu_sale_invoice, santu_purchase_invoice */
// Santu Hardware — Payment-In / Payment-Out screen.
//
// Rebuilt 2026-08-28 direct request: "payment in ka ui billing pos ki
// tarah kr" — same tab bar (multiple receipts open at once, persisted like
// Billing's bills), same left/right split panel, same customer search +
// Add Party modal as Billing (POS). Reuses the santu-bill-* classes
// santu_billing.css already defines app-wide, so this needed no new CSS —
// only the markup and the tab/state plumbing changed. The invoice
// allocation logic itself (auto-settle, per-row Paying Now, advance
// handling) is unchanged from the previous single-screen version.
frappe.pages["santu-payment-entry"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Payment In", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_payment_entry_page.init(page);
		}
	);
};

// Callers (Sale/Purchase pages, topbar mega-menu, Customer Dues, the quick
// invoice screens) hand over party_type/party via frappe.route_options.
// on_page_show has to read it too, not just on_page_load: change_to() fires
// "show" right after construction on the very first visit, and on later
// visits on_page_load never runs again at all.
frappe.pages["santu-payment-entry"].on_page_show = function () {
	if (!window.santu_payment_entry_page || !santu_payment_entry_page.page) return;
	const opts = frappe.route_options || {};
	frappe.route_options = null;
	santu_payment_entry_page.apply_route_options(opts);
};

const SANTU_PAY_KEY = "santu_payment_tabs_v1";

// Explicitly on `window`, not a top-level `const`: a classic script's
// top-level const lives in the global lexical environment, not on window, so
// `window.santu_payment_entry_page` would read undefined — and both
// on_page_show and santu_open_collect_payment reach for it by that name.
window.santu_payment_entry_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.tabs = [];
		this.active_id = null;
		this._persist_soon = frappe.utils.debounce(() => this._persist(), 400);

		$(page.body).html(`<div class="santu-bill-loading">Loading…</div>`);

		const opts = frappe.route_options || {};
		frappe.route_options = null;

		this._load_init(opts.party_type || "Customer").then(() => {
			this._load();
			if (opts.party) {
				const b = this._new_bill(true);
				b.party_type = opts.party_type || "Customer";
				this.render();
				this._select_party(opts.party);
			} else {
				if (!this.tabs.length) this._new_bill(false);
				this.render();
			}
			if (opts.amount) {
				const b = this._payment();
				b.amount = flt(opts.amount);
				b.amount_touched = true;
				this._render_body();
			}
		});
	},

	apply_route_options(opts) {
		if (!opts || (!opts.party && !opts.party_type)) return;
		const b = this._new_bill(true);
		b.party_type = opts.party_type || "Customer";
		this.render();
		if (opts.party) this._select_party(opts.party);
		if (opts.amount) {
			b.amount = flt(opts.amount);
			b.amount_touched = true;
			this._render_body();
		}
	},

	_is_in(b) {
		return (b || this._payment()).party_type === "Customer";
	},
	_screen_title() {
		return this._is_in() ? "Payment - In" : "Payment - Out";
	},
	_party_api(b) {
		return this._is_in(b) ? santu_sale_invoice : santu_purchase_invoice;
	},

	_load_init(party_type) {
		return frappe
			.xcall("santu_hardware.santu_hardware.api.get_payment_entry_init", { party_type })
			.then((data) => {
				this.init_data = data;
			});
	},

	// ---------- tab state (same shape as Billing's tabs array) ----------
	_load() {
		try {
			const raw = localStorage.getItem(SANTU_PAY_KEY);
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
			localStorage.setItem(SANTU_PAY_KEY, JSON.stringify({ tabs: this.tabs, active_id: this.active_id }));
		} catch (e) {
			/* storage unavailable — screen still works */
		}
	},

	_blank_payment(party_type) {
		return {
			id: santu_sale_invoice.utils.uid(),
			party_type: party_type || "Customer",
			party: null,
			party_label: "",
			party_details: null,
			posting_date: frappe.datetime.get_today(),
			mode_of_payment: (this.init_data && (this.init_data.payment_modes || []).length) ? this.init_data.payment_modes[0].name : null,
			reference_no: "",
			remarks: "",
			invoices: [],
			total_outstanding: 0,
			amount: 0,
			// null/false = "auto": Amount follows the allocation table until
			// the counter types their own figure (an advance).
			amount_touched: false,
			// { invoice_name: allocated_amount }
			allocations: {},
			saved: null,
		};
	},
	_new_bill(focus = true) {
		const b = this._blank_payment(this.tabs.length ? this._payment().party_type : "Customer");
		this.tabs.push(b);
		if (focus) this.active_id = b.id;
		else if (!this.active_id) this.active_id = b.id;
		this._persist_soon();
		return b;
	},
	_payment() {
		return this.tabs.find((t) => t.id === this.active_id) || this.tabs[0];
	},

	render() {
		if (!this.tabs.length) this._new_bill(false);
		const b = this._payment();
		if (this.page && this.page.set_title) this.page.set_title(this._screen_title());
		$(this.page.body).html(`
			<div class="santu-bill santu-pay">
				<div class="santu-bill-tabbar">
					<div class="santu-bill-tabs"></div>
					<div class="santu-si2-toolbar santu-pay-dirtoggle">
						<button type="button" class="santu-pay-dir-btn ${this._is_in(b) ? "is-active" : ""}" data-dir="Customer">Payment In</button>
						<button type="button" class="santu-pay-dir-btn ${!this._is_in(b) ? "is-active" : ""}" data-dir="Supplier">Payment Out</button>
					</div>
					<button type="button" class="santu-bill-newtab">+ New Payment <span class="santu-bill-kbd">Ctrl+T</span></button>
				</div>

				<div class="santu-bill-main">
					<div class="santu-bill-left">
						<div class="santu-bill-gridwrap">
							<div class="santu-bill-gridscroll">
								<table class="santu-bill-grid santu-pay-table">
									<thead>
										<tr>
											<th class="c-idx">#</th>
											<th class="santu-pay-col-inv">INVOICE NO.</th>
											<th class="santu-pay-col-date">DATE</th>
											<th class="santu-pay-col-amt">INVOICE AMOUNT</th>
											<th class="santu-pay-col-due">AMOUNT DUE</th>
											<th class="santu-pay-col-pay">PAYING NOW</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
							<div class="santu-bill-gridfoot">
								<button type="button" class="santu-pay-settle-all">SETTLE ALL</button>
								<button type="button" class="santu-pay-clear-all">CLEAR</button>
								<span class="santu-bill-grandrow santu-pay-foot-alloc">₹ 0.00</span>
							</div>
						</div>
					</div>

					<div class="santu-bill-right">
						<div class="santu-bill-datewrap">
							<input type="date" class="santu-pay-date" value="${b.posting_date}">
						</div>
						<div class="santu-bill-custwrap">
							<input type="text" class="santu-bill-customer santu-pay-party-search" placeholder="Search by Name/Phone *" value="${frappe.utils.escape_html(b.party_label || "")}" autocomplete="off">
							<div class="santu-bill-cust-dropdown" style="display:none;"></div>
						</div>

						<div class="santu-pay-duebar"></div>

						<div class="santu-bill-totalcard">
							<div class="santu-bill-totalcard-left">
								<span class="santu-bill-receipt">🧾</span>
								<div>
									<div class="santu-bill-total-big santu-pay-sum-due">Total Due ₹ 0.00</div>
									<div class="santu-bill-total-sub">${b.saved ? frappe.utils.escape_html(b.saved.name) : "(auto receipt no.)"}</div>
								</div>
							</div>
						</div>

						<div class="santu-bill-payrow">
							<div class="santu-bill-field">
								<label>Payment Type</label>
								<select class="santu-pay-mode">
									${(this.init_data.payment_modes || [])
										.map(
											(m) =>
												`<option value="${frappe.utils.escape_html(m.name)}" ${
													m.name === b.mode_of_payment ? "selected" : ""
												}>${frappe.utils.escape_html(m.name)}</option>`
										)
										.join("")}
								</select>
							</div>
							<div class="santu-bill-field">
								<label>Reference No.</label>
								<input type="text" class="santu-pay-refno" value="${frappe.utils.escape_html(b.reference_no || "")}" placeholder="Optional">
							</div>
						</div>

						<div class="santu-bill-payrow">
							<div class="santu-bill-field">
								<label>${this._is_in(b) ? "Received" : "Paid"}</label>
								<div class="santu-bill-amt-wrap">
									<span class="santu-bill-rs">₹</span>
									<input type="number" min="0" step="0.01" class="santu-pay-amount santu-si2-figures" value="${b.amount || ""}" placeholder="0.00">
								</div>
							</div>
						</div>

						<div class="santu-si2-summary">
							<div class="santu-si2-summary-row">
								<span>Settling</span>
								<span class="santu-si2-figures santu-pay-sum-alloc">₹ 0.00</span>
							</div>
							<div class="santu-si2-summary-row santu-pay-advance-row">
								<span>Advance (unadjusted)</span>
								<span class="santu-si2-figures santu-pay-sum-advance">₹ 0.00</span>
							</div>
						</div>

						<div class="santu-bill-spacer"></div>
					</div>
				</div>

				<div class="santu-bill-actions">
					<div class="santu-bill-fkeys santu-pay-notes-col">
						<textarea class="santu-pay-remarks" rows="1" placeholder="Optional note for this receipt">${frappe.utils.escape_html(b.remarks || "")}</textarea>
					</div>
					<div class="santu-bill-savecol">
						<button type="button" class="santu-bill-save santu-pay-save-btn">Save <span class="santu-bill-kbd">Ctrl+S</span></button>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-bill");
		this._render_tabs();
		this._render_party_info();
		this._render_invoices();
		this._bind_events();
	},

	_render_tabs() {
		const $t = this.$root.find(".santu-bill-tabs").empty();
		this.tabs.forEach((b, i) => {
			const label = b.saved ? b.saved.name : `#${i + 1}`;
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
		if (!b.party) return drop();
		frappe.confirm(__("Close this receipt?"), drop);
	},

	// ---------- party ----------
	_render_party_info() {
		// The Billing-style right rail shows the picked party's name right
		// in the search box (like Billing does) — nothing extra to render
		// here beyond what the input's own value already carries.
	},

	_pick_party(name, label) {
		const b = this._payment();
		b.party = name;
		b.party_label = label;
		this.$root.find(".santu-bill-customer").val(label);
		this.$root.find(".santu-bill-cust-dropdown").hide().empty();
		this._persist_soon();
		this._select_party(name);
	},

	_cust_search(q) {
		const $dd = this.$root.find(".santu-bill-cust-dropdown");
		const b = this._payment();
		const is_in = this._is_in(b);
		const draw = (rows) => {
			$dd.empty();
			if (rows.length) {
				$dd.append(`<div class="santu-bill-cust-head"><span>Name</span><span>Phone Number</span></div>`);
			}
			rows.forEach((p) => {
				const label = p.customer_name || p.supplier_name || p.name;
				$(`
					<div class="santu-bill-cust-row">
						<span>${frappe.utils.escape_html(label)}</span>
						<span class="santu-bill-cust-phone">${frappe.utils.escape_html(p.mobile_no || "—")}</span>
					</div>
				`)
					.on("click", () => this._pick_party(p.name, label))
					.appendTo($dd);
			});
			// A payment needs an existing party — no "Add Party" shortcut
			// here the way Billing has one for a brand-new sale; someone to
			// collect money from or pay out to has to already be on file.
			if (!rows.length) {
				$dd.append(`<div class="santu-bill-cust-row santu-pay-dd-empty">No match — a payment needs an existing party.</div>`);
			}
			$dd.show();
		};

		if (!q || q.length < 2) {
			draw([]);
			return;
		}
		const api = this._party_api(b).api;
		if (is_in) {
			Promise.all([api.search_customers(q), api.search_customers_by_phone(q)]).then(([by_name, by_phone]) => {
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
		} else {
			api.search_suppliers(q).then((rows) => draw(rows || []));
		}
	},

	_select_party(name) {
		const b = this._payment();
		b.party = name;
		this.$root.find(".santu-bill-cust-dropdown").hide().empty();

		const api = this._party_api(b).api;
		const details = this._is_in(b) ? api.customer_details(name) : api.supplier_details(name);
		details.then((d) => {
			b.party_details = d;
			this._persist_soon();
		});

		return frappe
			.xcall("santu_hardware.santu_hardware.api.get_party_outstanding", {
				party_type: b.party_type,
				party: name,
			})
			.then((r) => {
				b.invoices = r.invoices || [];
				b.total_outstanding = flt(r.total_outstanding);
				// Default to settling everything, oldest-first, capped at the
				// amount already typed if the cashier led with a figure.
				b.allocations = {};
				this._auto_allocate(b, b.amount_touched ? flt(b.amount) : b.total_outstanding);
				if (!b.amount_touched) b.amount = this._allocated_total(b);
				this._persist_soon();
				this.$root.find(".santu-pay-amount").val(b.amount || "");
				this._render_invoices();
			});
	},

	// ---------- allocations ----------
	_auto_allocate(b, budget) {
		let remaining = flt(budget);
		b.allocations = {};
		b.invoices.forEach((inv) => {
			if (remaining <= 0) return;
			const alloc = Math.min(flt(inv.outstanding_amount), remaining);
			if (alloc > 0) {
				b.allocations[inv.name] = alloc;
				remaining -= alloc;
			}
		});
	},

	_allocated_total(b) {
		return Object.values((b || this._payment()).allocations).reduce((a, v) => a + flt(v), 0);
	},

	_render_invoices() {
		const b = this._payment();
		const $tbody = this.$root.find(".santu-pay-table tbody");
		$tbody.empty();

		if (!b.party) {
			$(`<tr class="santu-si2-empty-row"><td colspan="6">Select a party to see their unpaid bills.</td></tr>`).appendTo($tbody);
		} else if (!b.invoices.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="6">No unpaid bills — this will be recorded as an advance.</td></tr>`).appendTo($tbody);
		}

		b.invoices.forEach((inv, idx) => {
			const alloc = flt(b.allocations[inv.name] || 0);
			const $tr = $(`
				<tr class="santu-pay-row">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-pay-col-inv">${frappe.utils.escape_html(inv.display_number || santu_bill_label(inv.santu_bill_no))}</td>
					<td class="santu-pay-col-date">${inv.posting_date ? frappe.datetime.str_to_user(inv.posting_date) : "—"}</td>
					<td class="santu-pay-col-amt santu-si2-figures">₹ ${format_currency_num(inv.grand_total)}</td>
					<td class="santu-pay-col-due santu-si2-figures">₹ ${format_currency_num(inv.outstanding_amount)}</td>
					<td class="santu-pay-col-pay">
						<input type="number" min="0" step="0.01" class="santu-pay-alloc" value="${alloc || ""}" placeholder="0">
					</td>
				</tr>
			`);
			$tr.find(".santu-pay-alloc").on("input", (e) => {
				let v = flt($(e.target).val());
				const cap = flt(inv.outstanding_amount);
				if (v > cap) {
					v = cap;
					$(e.target).val(cap);
				}
				if (v > 0) b.allocations[inv.name] = v;
				else delete b.allocations[inv.name];
				// Typing in the table drives the received total, unless the
				// cashier has explicitly overridden it (advance payment).
				if (!b.amount_touched) {
					b.amount = this._allocated_total(b);
					this.$root.find(".santu-pay-amount").val(b.amount || "");
				}
				this._persist_soon();
				this._render_totals();
			});
			$tr.appendTo($tbody);
		});

		this._render_totals();
	},

	_render_totals() {
		const b = this._payment();
		const allocated = this._allocated_total(b);
		const amount = flt(b.amount);
		const advance = Math.max(amount - allocated, 0);

		this.$root.find(".santu-pay-foot-alloc").text(`₹ ${format_currency_num(allocated)}`);
		this.$root.find(".santu-pay-sum-due").text(`Total Due ₹ ${format_currency_num(b.total_outstanding)}`);
		this.$root.find(".santu-pay-sum-alloc").text(`₹ ${format_currency_num(allocated)}`);
		this.$root.find(".santu-pay-sum-advance").text(`₹ ${format_currency_num(advance)}`);
		// The old dialog silently parked any excess as an unallocated advance
		// with nothing on screen about it — this makes that visible instead.
		this.$root.find(".santu-pay-advance-row").toggleClass("santu-pay-advance-on", advance > 0);

		const $bar = this.$root.find(".santu-pay-duebar");
		if (!b.party) {
			$bar.empty();
			return;
		}
		// Direction from the SIGN, not from which screen this is. The
		// settlement table now includes return credits (negative
		// outstanding), so a customer can genuinely net out to "shop owes
		// them" — labelling that "This party owes you ₹-600" was the exact
		// opposite of the truth.
		const due = Number(b.total_outstanding) || 0;
		const owes_you = this._is_in(b) ? due > 0 : due < 0;
		const due_label = !due
			? __("All settled — nothing pending")
			: owes_you
				? __("This party owes you")
				: __("You owe this party");
		$bar.html(`
			<div class="santu-pay-duebar-inner ${due ? "santu-pay-duebar-owed" : "santu-pay-duebar-clear"}">
				<span class="santu-pay-duebar-label">${due_label}</span>
				${due ? `<span class="santu-pay-duebar-amount santu-si2-figures">₹ ${format_currency_num(Math.abs(due))}</span>` : ""}
			</div>
		`);
	},

	// ---------- events ----------
	_bind_events() {
		const $r = this.$root;

		$r.find(".santu-bill-newtab").on("click", () => {
			this._new_bill(true);
			this.render();
		});

		$r.find(".santu-pay-dir-btn").on("click", (e) => {
			const b = this._payment();
			// Switching direction only makes sense before a party is picked
			// on this receipt — once one's on file the two sides use
			// different search APIs and outstanding data entirely.
			if (b.party) {
				frappe.msgprint(__("Close this receipt and start a new one to switch direction."));
				return;
			}
			const dir = $(e.currentTarget).data("dir");
			if (dir === b.party_type) return;
			b.party_type = dir;
			this._load_init(dir).then(() => {
				b.mode_of_payment = (this.init_data.payment_modes || []).length ? this.init_data.payment_modes[0].name : null;
				this._persist_soon();
				this.render();
			});
		});

		$r.find(".santu-bill-customer").on(
			"input",
			frappe.utils.debounce((e) => this._cust_search($(e.target).val()), 250)
		);
		$r.find(".santu-bill-customer").on("focus", () => this._cust_search($r.find(".santu-bill-customer").val()));
		$(document).off("click.santu-pay-dd").on("click.santu-pay-dd", (e) => {
			if (!$(e.target).closest(".santu-bill-custwrap").length) {
				$r.find(".santu-bill-cust-dropdown").hide();
			}
		});

		$r.find(".santu-pay-date").on("change", (e) => {
			this._payment().posting_date = $(e.target).val();
			this._persist_soon();
		});
		$r.find(".santu-pay-mode").on("change", (e) => {
			this._payment().mode_of_payment = $(e.target).val();
			this._persist_soon();
		});
		$r.find(".santu-pay-refno").on("input", (e) => {
			this._payment().reference_no = $(e.target).val();
			this._persist_soon();
		});
		$r.find(".santu-pay-remarks").on("input", (e) => {
			this._payment().remarks = $(e.target).val();
			this._persist_soon();
		});

		$r.find(".santu-pay-amount").on("input", (e) => {
			const b = this._payment();
			b.amount = flt($(e.target).val());
			b.amount_touched = true;
			this._persist_soon();
			this._render_totals();
		});

		$r.find(".santu-pay-settle-all").on("click", () => {
			const b = this._payment();
			this._auto_allocate(b, b.total_outstanding);
			b.amount = this._allocated_total(b);
			b.amount_touched = false;
			this._persist_soon();
			this.render();
		});
		$r.find(".santu-pay-clear-all").on("click", () => {
			const b = this._payment();
			b.allocations = {};
			b.amount = 0;
			b.amount_touched = false;
			this._persist_soon();
			this.render();
		});

		$r.find(".santu-pay-save-btn").on("click", () => this._save());

		$(document).off("keydown.santu-pay").on("keydown.santu-pay", (e) => {
			if (frappe.get_route()[0] !== "santu-payment-entry") return;
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				this._save();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "t") {
				e.preventDefault();
				this._new_bill(true);
				this.render();
			}
		});
	},

	// ---------- save ----------
	_save() {
		const b = this._payment();
		if (!b.party) {
			frappe.msgprint(__("Please select a {0}.", [b.party_type]));
			return;
		}
		const amount = flt(b.amount);
		if (amount <= 0) {
			frappe.msgprint(__("Enter an amount greater than zero."));
			return;
		}
		if (!b.mode_of_payment) {
			frappe.msgprint(__("Select a payment type."));
			return;
		}

		const allocations = Object.keys(b.allocations).map((name) => ({
			name,
			allocated_amount: flt(b.allocations[name]),
		}));
		const advance = amount - this._allocated_total(b);

		const submit = () => {
			frappe.dom.freeze(__("Saving…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.create_payment_entry", {
					party_type: b.party_type,
					party: b.party,
					amount,
					mode_of_payment: b.mode_of_payment,
					posting_date: b.posting_date,
					reference_no: b.reference_no || null,
					remarks: b.remarks || null,
					allocations_json: allocations.length ? JSON.stringify(allocations) : null,
				})
				.then((r) => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
					b.saved = { name: r.name };
					// Receipt done: drop this tab and open a clean one, the
					// same way Billing moves on after Save & Print.
					this.tabs = this.tabs.filter((t) => t.id !== b.id);
					if (!this.tabs.length) this._new_bill(false);
					this.active_id = this.tabs[0].id;
					this._persist_soon();
					this.render();
				})
				.catch(() => frappe.dom.unfreeze());
		};

		if (advance > 0.005) {
			frappe.confirm(
				__("₹ {0} is more than the bills being settled. The extra will be kept as an advance. Continue?", [
					format_currency_num(advance),
				]),
				submit
			);
			return;
		}
		submit();
	},
};

function flt(v) {
	const n = parseFloat(v);
	return isNaN(n) ? 0 : n;
}

function format_currency_num(value) {
	return format_currency(flt(value), "INR").replace(/^\D+/, "");
}
