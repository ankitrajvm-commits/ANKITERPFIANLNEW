/* global frappe, santu_sale_invoice, santu_purchase_invoice */
// Santu Hardware — Payment-In / Payment-Out screen (2026-08-15 direct
// request: "payment in me ui vyapaar ke jaisa kro and kuch bugs hai").
// Replaces the cramped `santu_open_collect_payment` frappe.ui.Dialog, which
// asked for a bare amount with nothing on screen about what the party
// actually owed. Reuses the santu-si2-* classes the Sale Invoice / Purchase
// Order screens use, so this is the same visual language, not a new one.
//
// One screen serves both directions (party_type Customer = Payment-In,
// Supplier = Payment-Out) — they're mirror images of the same action, the
// same way santu-sale / santu-purchase mirror each other.
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

// Explicitly on `window`, not a top-level `const`: a classic script's
// top-level const lives in the global lexical environment, not on window, so
// `window.santu_payment_entry_page` would read undefined — and both
// on_page_show and santu_open_collect_payment reach for it by that name.
window.santu_payment_entry_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		this.state = this._blank_state();

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);

		const opts = frappe.route_options || {};
		frappe.route_options = null;
		this.state.party_type = opts.party_type || "Customer";

		this._load_init().then(() => {
			this.render();
			if (opts.party) this._select_party(opts.party);
			if (opts.amount) {
				this.state.amount = flt(opts.amount);
				this._render_body();
			}
		});
	},

	_blank_state() {
		return {
			party_type: "Customer",
			party: null,
			party_details: null,
			amount: 0,
			// null = "follow the invoice table automatically"; a number means
			// the cashier typed their own total and it shouldn't be
			// overwritten when allocations shift.
			amount_touched: false,
			mode_of_payment: null,
			posting_date: frappe.datetime.get_today(),
			reference_no: "",
			remarks: "",
			invoices: [],
			total_outstanding: 0,
			// { invoice_name: allocated_amount }
			allocations: {},
			saved: null,
		};
	},

	_load_init() {
		return frappe
			.xcall("santu_hardware.santu_hardware.api.get_payment_entry_init", {
				party_type: this.state.party_type,
			})
			.then((data) => {
				this.init_data = data;
				this.state.posting_date = data.posting_date;
				this.state.mode_of_payment = data.default_mode;
			});
	},

	apply_route_options(opts) {
		const want_type = opts.party_type || this.state.party_type;
		const switching = want_type !== this.state.party_type;
		// A fresh screen every time it's opened — a stale party/amount left
		// over from the last collection is worse than an empty form.
		this.state = this._blank_state();
		this.state.party_type = want_type;
		this.state.posting_date = this.init_data.posting_date;
		this.state.mode_of_payment = this.init_data.default_mode;

		const proceed = () => {
			this.render();
			if (opts.party) this._select_party(opts.party);
			if (opts.amount) {
				this.state.amount = flt(opts.amount);
				this.state.amount_touched = true;
				this._render_body();
			}
		};
		// Mode-of-payment ordering is party_type-specific, so re-fetch when
		// the direction flips rather than reusing the other side's defaults.
		if (switching) this._load_init().then(proceed);
		else proceed();
	},

	_is_in() {
		return this.state.party_type === "Customer";
	},
	_screen_title() {
		return this._is_in() ? "Payment - In" : "Payment - Out";
	},
	_party_api() {
		return this._is_in() ? santu_sale_invoice : santu_purchase_invoice;
	},

	render() {
		const $body = $(this.page.body);
		$body.html(`
			<div class="santu-si2 santu-pay">
				<div class="santu-si2-body"></div>
			</div>
		`);
		this.$root = $body.find(".santu-si2");
		this._render_body();
	},

	_render_body() {
		const s = this.state;
		const $wrap = this.$root.find(".santu-si2-body");
		$wrap.html(`
			<div class="santu-si2-header">
				<div class="santu-si2-header-title">${this._screen_title()}</div>
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
						<span class="santu-si2-inv-label">Receipt No.</span>
						<span class="santu-si2-inv-value">${s.saved ? frappe.utils.escape_html(s.saved.name) : "(auto)"}</span>
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Date</span>
						<input type="date" class="santu-pay-date" value="${s.posting_date}">
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Payment Type</span>
						<select class="santu-pay-mode">
							${(this.init_data.payment_modes || [])
								.map(
									(m) =>
										`<option value="${frappe.utils.escape_html(m.name)}" ${
											m.name === s.mode_of_payment ? "selected" : ""
										}>${frappe.utils.escape_html(m.name)}</option>`
								)
								.join("")}
						</select>
					</div>
					<div class="santu-si2-inv-row">
						<span class="santu-si2-inv-label">Reference No.</span>
						<input type="text" class="santu-pay-refno" value="${frappe.utils.escape_html(s.reference_no || "")}" placeholder="Optional">
					</div>
				</div>
			</div>

			<div class="santu-pay-duebar"></div>

			<div class="santu-si2-table-wrap">
				<table class="santu-si2-table santu-pay-table">
					<thead>
						<tr>
							<th class="santu-si2-col-idx">#</th>
							<th class="santu-pay-col-inv">INVOICE NO.</th>
							<th class="santu-pay-col-date">DATE</th>
							<th class="santu-pay-col-amt">INVOICE AMOUNT</th>
							<th class="santu-pay-col-due">AMOUNT DUE</th>
							<th class="santu-pay-col-pay">PAYING NOW</th>
						</tr>
					</thead>
					<tbody></tbody>
					<tfoot>
						<tr>
							<td colspan="4"><button type="button" class="santu-pay-settle-all">SETTLE ALL</button> <button type="button" class="santu-pay-clear-all">CLEAR</button></td>
							<td class="santu-si2-figures santu-pay-foot-due">₹ 0</td>
							<td class="santu-si2-figures santu-pay-foot-alloc">₹ 0</td>
						</tr>
					</tfoot>
				</table>
			</div>

			<div class="santu-si2-lowerrow">
				<div class="santu-si2-extras santu-pay-notes-col">
					<label class="santu-pay-notes-label">Notes</label>
					<textarea class="santu-pay-remarks" rows="3" placeholder="Optional note for this receipt">${frappe.utils.escape_html(s.remarks || "")}</textarea>
				</div>
				<div class="santu-si2-summary">
					<div class="santu-si2-summary-row">
						<span>Total Due</span>
						<span class="santu-si2-figures santu-pay-sum-due">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row">
						<span>Settling</span>
						<span class="santu-si2-figures santu-pay-sum-alloc">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row santu-pay-advance-row">
						<span>Advance (unadjusted)</span>
						<span class="santu-si2-figures santu-pay-sum-advance">₹ 0</span>
					</div>
					<div class="santu-si2-summary-row santu-si2-summary-total">
						<span>${this._is_in() ? "Received" : "Paid"}</span>
						<input type="number" min="0" step="0.01" class="santu-pay-amount santu-si2-figures" value="${s.amount || ""}" placeholder="0">
					</div>
				</div>
			</div>

			<div class="santu-si2-actionbar">
				<div class="santu-si2-actionbar-left"></div>
				<div class="santu-si2-actionbar-right">
					<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
				</div>
			</div>
		`);

		this._render_party_info();
		this._render_invoices();
		this._bind_events();
	},

	// ---------- party ----------
	_render_party_info() {
		const s = this.state;
		const $info = this.$root.find(".santu-si2-customer-info");
		const $search = this.$root.find(".santu-si2-customer-search");
		const $phone = this.$root.find(".santu-si2-phone");
		if (!s.party) {
			$info.empty();
			return;
		}
		const d = s.party_details || {};
		const display = d.customer_name || d.supplier_name || s.party;
		$search.val(display);
		$phone.val(d.mobile_no || "");
		$info.html(`
			<div class="santu-si2-cust-card">
				<div class="santu-si2-cust-name">${frappe.utils.escape_html(display)}
					<button type="button" class="santu-si2-cust-clear" title="Change party">×</button>
				</div>
			</div>
		`);
		$info.find(".santu-si2-cust-clear").on("click", () => {
			this.state.party = null;
			this.state.party_details = null;
			this.state.invoices = [];
			this.state.allocations = {};
			this.state.total_outstanding = 0;
			this._render_body();
		});
	},

	_party_search(q) {
		const $dd = this.$root.find(".santu-si2-customer-dropdown");
		if (!q || q.length < 2) {
			$dd.hide().empty();
			return;
		}
		const api = this._party_api().api;
		const search = this._is_in() ? api.search_customers(q) : api.search_suppliers(q);
		search.then((rows) => {
			$dd.empty();
			rows.forEach((p) => {
				const label = p.customer_name || p.supplier_name || p.name;
				$(`
					<div class="santu-si2-dd-row">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(label)}</b>
								${p.mobile_no ? `<span>${frappe.utils.escape_html(p.mobile_no)}</span>` : ""}
							</div>
						</div>
					</div>
				`)
					.on("click", () => this._select_party(p.name))
					.appendTo($dd);
			});
			if (!rows.length) {
				$dd.append(`<div class="santu-si2-dd-row santu-pay-dd-empty">No match. A payment needs an existing party.</div>`);
			}
			$dd.show();
		});
	},

	_select_party(name) {
		const s = this.state;
		s.party = name;
		this.$root.find(".santu-si2-customer-dropdown").hide().empty();

		const api = this._party_api().api;
		const details = this._is_in() ? api.customer_details(name) : api.supplier_details(name);
		details.then((d) => {
			s.party_details = d;
			this._render_party_info();
		});

		return frappe
			.xcall("santu_hardware.santu_hardware.api.get_party_outstanding", {
				party_type: s.party_type,
				party: name,
			})
			.then((r) => {
				s.invoices = r.invoices || [];
				s.total_outstanding = flt(r.total_outstanding);
				// Default to settling everything, oldest-first, capped at the
				// amount already typed if the cashier led with a figure.
				s.allocations = {};
				this._auto_allocate(s.amount_touched ? flt(s.amount) : s.total_outstanding);
				if (!s.amount_touched) s.amount = this._allocated_total();
				this._render_body();
			});
	},

	// ---------- allocations ----------
	_auto_allocate(budget) {
		const s = this.state;
		let remaining = flt(budget);
		s.allocations = {};
		s.invoices.forEach((inv) => {
			if (remaining <= 0) return;
			const alloc = Math.min(flt(inv.outstanding_amount), remaining);
			if (alloc > 0) {
				s.allocations[inv.name] = alloc;
				remaining -= alloc;
			}
		});
	},

	_allocated_total() {
		return Object.values(this.state.allocations).reduce((a, b) => a + flt(b), 0);
	},

	_render_invoices() {
		const s = this.state;
		const $tbody = this.$root.find(".santu-pay-table tbody");
		$tbody.empty();

		if (!s.party) {
			$(`<tr class="santu-si2-empty-row"><td colspan="6">Select a party to see their unpaid bills.</td></tr>`).appendTo($tbody);
		} else if (!s.invoices.length) {
			$(`<tr class="santu-si2-empty-row"><td colspan="6">No unpaid bills — this will be recorded as an advance.</td></tr>`).appendTo($tbody);
		}

		s.invoices.forEach((inv, idx) => {
			const alloc = flt(s.allocations[inv.name] || 0);
			const $tr = $(`
				<tr class="santu-pay-row">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-pay-col-inv">${frappe.utils.escape_html(inv.name)}</td>
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
				if (v > 0) s.allocations[inv.name] = v;
				else delete s.allocations[inv.name];
				// Typing in the table drives the received total, unless the
				// cashier has explicitly overridden it (advance payment).
				if (!s.amount_touched) {
					s.amount = this._allocated_total();
					this.$root.find(".santu-pay-amount").val(s.amount || "");
				}
				this._render_totals();
			});
			$tr.appendTo($tbody);
		});

		this._render_totals();
	},

	_render_totals() {
		const s = this.state;
		const allocated = this._allocated_total();
		const amount = flt(s.amount);
		const advance = Math.max(amount - allocated, 0);

		this.$root.find(".santu-pay-foot-due").text(`₹ ${format_currency_num(s.total_outstanding)}`);
		this.$root.find(".santu-pay-foot-alloc").text(`₹ ${format_currency_num(allocated)}`);
		this.$root.find(".santu-pay-sum-due").text(`₹ ${format_currency_num(s.total_outstanding)}`);
		this.$root.find(".santu-pay-sum-alloc").text(`₹ ${format_currency_num(allocated)}`);
		this.$root.find(".santu-pay-sum-advance").text(`₹ ${format_currency_num(advance)}`);
		// The old dialog silently parked any excess as an unallocated advance
		// with nothing on screen about it — this makes that visible instead.
		this.$root.find(".santu-pay-advance-row").toggleClass("santu-pay-advance-on", advance > 0);

		const $bar = this.$root.find(".santu-pay-duebar");
		if (!s.party) {
			$bar.empty();
			return;
		}
		$bar.html(`
			<div class="santu-pay-duebar-inner ${s.total_outstanding > 0 ? "santu-pay-duebar-owed" : "santu-pay-duebar-clear"}">
				<span class="santu-pay-duebar-label">${this._is_in() ? "This party owes you" : "You owe this party"}</span>
				<span class="santu-pay-duebar-amount santu-si2-figures">₹ ${format_currency_num(s.total_outstanding)}</span>
			</div>
		`);
	},

	// ---------- events ----------
	_bind_events() {
		const s = this.state;
		const $r = this.$root;

		$r.find(".santu-si2-customer-search").on(
			"input",
			frappe.utils.debounce((e) => this._party_search($(e.target).val()), 250)
		);
		$(document).off("click.santu-pay-dd").on("click.santu-pay-dd", (e) => {
			if (!$(e.target).closest(".santu-si2-customer-search-wrap").length) {
				$r.find(".santu-si2-customer-dropdown").hide();
			}
		});

		$r.find(".santu-pay-date").on("change", (e) => (s.posting_date = $(e.target).val()));
		$r.find(".santu-pay-mode").on("change", (e) => (s.mode_of_payment = $(e.target).val()));
		$r.find(".santu-pay-refno").on("input", (e) => (s.reference_no = $(e.target).val()));
		$r.find(".santu-pay-remarks").on("input", (e) => (s.remarks = $(e.target).val()));

		$r.find(".santu-pay-amount").on("input", (e) => {
			s.amount = flt($(e.target).val());
			s.amount_touched = true;
			this._render_totals();
		});

		$r.find(".santu-pay-settle-all").on("click", () => {
			this._auto_allocate(s.total_outstanding);
			s.amount = this._allocated_total();
			s.amount_touched = false;
			this._render_body();
		});
		$r.find(".santu-pay-clear-all").on("click", () => {
			s.allocations = {};
			s.amount = 0;
			s.amount_touched = false;
			this._render_body();
		});

		$r.find("[data-action='save']").on("click", () => this._save());

		$(document).off("keydown.santu-pay").on("keydown.santu-pay", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s" && frappe.get_route()[0] === "santu-payment-entry") {
				e.preventDefault();
				this._save();
			}
		});
	},

	// ---------- save ----------
	_save() {
		const s = this.state;
		if (!s.party) {
			frappe.msgprint(__("Please select a {0}.", [s.party_type]));
			return;
		}
		const amount = flt(s.amount);
		if (amount <= 0) {
			frappe.msgprint(__("Enter an amount greater than zero."));
			return;
		}
		if (!s.mode_of_payment) {
			frappe.msgprint(__("Select a payment type."));
			return;
		}

		const allocations = Object.keys(s.allocations).map((name) => ({
			name,
			allocated_amount: flt(s.allocations[name]),
		}));
		const advance = amount - this._allocated_total();

		const submit = () => {
			frappe.dom.freeze(__("Saving…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.create_payment_entry", {
					party_type: s.party_type,
					party: s.party,
					amount,
					mode_of_payment: s.mode_of_payment,
					posting_date: s.posting_date,
					reference_no: s.reference_no || null,
					remarks: s.remarks || null,
					allocations_json: allocations.length ? JSON.stringify(allocations) : null,
				})
				.then((r) => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
					window.santu_open_invoice_view("Payment Entry", r.name);
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
