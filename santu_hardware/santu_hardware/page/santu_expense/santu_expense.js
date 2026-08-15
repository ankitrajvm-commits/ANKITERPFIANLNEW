/* global frappe, santu_purchase_invoice, santu_expense */
// Santu Hardware — Expense screen (2026-08-15 direct request: "expene- New
// Journal Entry isko vyapaar type banao" — "+ Add Expense" opened ERPNext's
// native Journal Entry form, whose "Accounting Entries" grid asks for
// Account / Party Type / Party / Debit / Credit on every row).
//
// Reuses the santu-si2-* classes the other quick screens use. Modelled on
// the Payment screen rather than the invoice screens: an expense is a
// one-off action, so there's no tab bar to juggle several at once.
//
// The user picks a category and an amount; the debit/credit pair is derived
// server-side in save_expense. Nothing on this screen mentions ledgers.
frappe.pages["santu-expense"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
			"/assets/santu_hardware/js/santu_expense/santu_expense_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "Expense", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_expense_page.init(page);
		}
	);
};

// A fresh form on every visit — a half-typed expense left over from last
// time is worse than an empty one. on_page_load only fires once per session,
// so the reset has to live here.
frappe.pages["santu-expense"].on_page_show = function () {
	if (window.santu_expense_page && santu_expense_page.page) santu_expense_page.reset();
};

// On `window` rather than a top-level const: a classic script's top-level
// const isn't a window property, and on_page_show reaches for it by name.
window.santu_expense_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);
		santu_expense.api.init().then((data) => {
			this.init_data = data;
			this.reset();
		});
	},

	reset() {
		if (!this.init_data) return;
		this.state = {
			posting_date: this.init_data.posting_date,
			mode_of_payment: this.init_data.default_mode,
			reference_no: "",
			notes: "",
			party: null,
			party_name: null,
			rows: [this._blank_row()],
			saved: null,
		};
		this.render();
	},

	_blank_row() {
		return { id: frappe.utils.get_random(8), expense_account: null, description: "", amount: 0 };
	},

	render() {
		const s = this.state;
		$(this.page.body).html(`
			<div class="santu-si2 santu-exp">
				<div class="santu-si2-body">
					<div class="santu-si2-header">
						<div class="santu-si2-header-title">Expense</div>
					</div>

					<div class="santu-si2-toprow">
						<div class="santu-si2-customer-col">
							<div class="santu-si2-customer-search-wrap">
								<input type="text" class="santu-si2-customer-search santu-exp-party" placeholder="Paid to (optional)" autocomplete="off" value="${frappe.utils.escape_html(s.party_name || "")}">
								<div class="santu-si2-customer-dropdown" style="display:none;"></div>
							</div>
						</div>
						<div class="santu-si2-customer-info"></div>
						<div class="santu-si2-invoice-info">
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Expense No.</span>
								<span class="santu-si2-inv-value">${s.saved ? frappe.utils.escape_html(s.saved.name) : "(auto)"}</span>
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Date</span>
								<input type="date" class="santu-exp-date" value="${s.posting_date}">
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Paid By</span>
								<select class="santu-exp-mode">
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
								<input type="text" class="santu-exp-refno" value="${frappe.utils.escape_html(s.reference_no || "")}" placeholder="Optional">
							</div>
						</div>
					</div>

					<div class="santu-si2-table-wrap">
						<table class="santu-si2-table santu-exp-table">
							<thead>
								<tr>
									<th class="santu-si2-col-idx">#</th>
									<th class="santu-exp-col-cat">CATEGORY</th>
									<th class="santu-exp-col-desc">DESCRIPTION</th>
									<th class="santu-exp-col-amt">AMOUNT</th>
									<th class="santu-si2-col-remove"></th>
								</tr>
							</thead>
							<tbody></tbody>
							<tfoot>
								<tr>
									<td colspan="3"><button type="button" class="santu-si2-add-row santu-exp-add-row">+ ADD ROW</button></td>
									<td class="santu-si2-figures santu-exp-foot-total">₹ 0</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					</div>

					<div class="santu-si2-lowerrow">
						<div class="santu-si2-extras santu-pay-notes-col">
							<label class="santu-pay-notes-label">Notes</label>
							<textarea class="santu-exp-notes" rows="3" placeholder="What was this for?">${frappe.utils.escape_html(s.notes || "")}</textarea>
						</div>
						<div class="santu-si2-summary">
							<div class="santu-si2-summary-row santu-si2-summary-total">
								<span>Total</span>
								<span class="santu-si2-figures santu-exp-sum-total">₹ 0</span>
							</div>
						</div>
					</div>

					<div class="santu-si2-actionbar">
						<div class="santu-si2-actionbar-left"></div>
						<div class="santu-si2-actionbar-right">
							<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
						</div>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-si2");
		this._render_rows();
		this._bind();
	},

	_render_rows() {
		const s = this.state;
		const $tbody = this.$root.find(".santu-exp-table tbody");
		$tbody.empty();

		const options = (this.init_data.expense_accounts || [])
			.map((a) => `<option value="${frappe.utils.escape_html(a.name)}">${frappe.utils.escape_html(a.label)}</option>`)
			.join("");

		s.rows.forEach((row, idx) => {
			const $tr = $(`
				<tr class="santu-exp-row">
					<td class="santu-si2-col-idx">${idx + 1}</td>
					<td class="santu-exp-col-cat">
						<select class="santu-exp-cat">
							<option value="">Select category</option>
							${options}
						</select>
					</td>
					<td class="santu-exp-col-desc">
						<input type="text" class="santu-exp-desc" value="${frappe.utils.escape_html(row.description || "")}" placeholder="Optional">
					</td>
					<td class="santu-exp-col-amt">
						<input type="number" min="0" step="0.01" class="santu-exp-amt" value="${row.amount || ""}" placeholder="0">
					</td>
					<td class="santu-si2-col-remove">
						<button type="button" class="santu-si2-row-remove santu-exp-remove" title="Remove">🗑</button>
					</td>
				</tr>
			`);
			$tr.find(".santu-exp-cat").val(row.expense_account || "");

			$tr.find(".santu-exp-cat").on("change", (e) => {
				row.expense_account = $(e.target).val() || null;
			});
			$tr.find(".santu-exp-desc").on("input", (e) => {
				row.description = $(e.target).val();
			});
			$tr.find(".santu-exp-amt").on("input", (e) => {
				row.amount = Math.max(Number($(e.target).val()) || 0, 0);
				this._render_totals();
			});
			$tr.find(".santu-exp-remove").on("click", () => {
				// Always leave one row standing — an empty table with no way
				// back to a row is a dead end.
				s.rows = s.rows.filter((r) => r.id !== row.id);
				if (!s.rows.length) s.rows.push(this._blank_row());
				this._render_rows();
				this._render_totals();
			});

			$tr.appendTo($tbody);
		});

		this._render_totals();
	},

	_total() {
		return this.state.rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
	},

	_render_totals() {
		const t = this._total();
		const text = `₹ ${format_number(t, null, 2)}`;
		this.$root.find(".santu-exp-foot-total").text(text);
		this.$root.find(".santu-exp-sum-total").text(text);
	},

	_bind() {
		const s = this.state;
		const $r = this.$root;

		$r.find(".santu-exp-date").on("change", (e) => (s.posting_date = e.target.value));
		$r.find(".santu-exp-mode").on("change", (e) => (s.mode_of_payment = e.target.value));
		$r.find(".santu-exp-refno").on("input", (e) => (s.reference_no = e.target.value));
		$r.find(".santu-exp-notes").on("input", (e) => (s.notes = e.target.value));

		$r.find(".santu-exp-add-row").on("click", () => {
			s.rows.push(this._blank_row());
			this._render_rows();
		});

		// "Paid to" is optional and supplier-only: an expense paid to a
		// customer isn't a thing this screen needs to express.
		$r.find(".santu-exp-party").on(
			"input",
			frappe.utils.debounce((e) => this._party_search($(e.target).val()), 250)
		);
		$(document).off("click.santu-exp-dd").on("click.santu-exp-dd", (e) => {
			if (!$(e.target).closest(".santu-si2-customer-search-wrap").length) {
				$r.find(".santu-si2-customer-dropdown").hide();
			}
		});

		$r.find("[data-action='save']").on("click", () => this._save());
		$(document).off("keydown.santu-exp").on("keydown.santu-exp", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s" && frappe.get_route()[0] === "santu-expense") {
				e.preventDefault();
				this._save();
			}
		});
	},

	_party_search(q) {
		const s = this.state;
		const $dd = this.$root.find(".santu-si2-customer-dropdown");
		if (!q || q.length < 2) {
			s.party = null;
			s.party_name = null;
			$dd.hide().empty();
			return;
		}
		santu_purchase_invoice.api.search_suppliers(q).then((rows) => {
			$dd.empty();
			(rows || []).forEach((p) => {
				$(`
					<div class="santu-si2-dd-row">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(p.supplier_name || p.name)}</b>
								${p.mobile_no ? `<span>${frappe.utils.escape_html(p.mobile_no)}</span>` : ""}
							</div>
						</div>
					</div>
				`)
					.on("click", () => {
						s.party = p.name;
						s.party_name = p.supplier_name || p.name;
						this.$root.find(".santu-exp-party").val(s.party_name);
						$dd.hide().empty();
					})
					.appendTo($dd);
			});
			if (!(rows || []).length) {
				$dd.append(`<div class="santu-si2-dd-row santu-pay-dd-empty">No match — leave blank if it wasn't a supplier.</div>`);
			}
			$dd.show();
		});
	},

	_save() {
		const s = this.state;
		const rows = s.rows.filter((r) => r.expense_account && Number(r.amount) > 0);
		if (!rows.length) {
			frappe.msgprint(__("Add at least one expense category with an amount."));
			return;
		}
		if (!s.mode_of_payment) {
			frappe.msgprint(__("Select how this was paid."));
			return;
		}

		frappe.dom.freeze(__("Saving…"));
		santu_expense.api
			.save(
				{
					company: this.init_data.company,
					posting_date: s.posting_date,
					mode_of_payment: s.mode_of_payment,
					reference_no: s.reference_no || null,
					notes: s.notes || null,
					party_type: s.party ? "Supplier" : null,
					party: s.party || null,
					rows: rows.map((r) => ({
						expense_account: r.expense_account,
						description: r.description || null,
						amount: Number(r.amount),
					})),
				},
				1
			)
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				window.santu_open_invoice_view("Journal Entry", r.name);
			})
			.catch(() => frappe.dom.unfreeze());
	},
};
