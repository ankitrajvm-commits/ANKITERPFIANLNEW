frappe.pages["santu-purchase"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_utils.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_api.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_summary.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_transactions.js",
		],
		() => {
			const view = santu_purchase.utils.get_view();
			const view_meta = santu_purchase.VIEWS[view] || santu_purchase.VIEWS.bills;

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: view_meta.title,
				single_column: true,
			});

			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-purchase-page-main");
			santu_purchase_page.init(page);
		}
	);
};

const santu_purchase_page = {
	init(page) {
		this.page = page;
		this.view = santu_purchase.utils.get_view();
		this._syncing_dates = false;
		this.state = {
			period: "This Month",
			from_date: "",
			to_date: "",
			company: "",
			search: "",
			return_type: "debit_note",
		};
		this.render_shell();
		this.bind_events();
		this.load_data();
	},

	render_shell() {
		const view_meta = santu_purchase.VIEWS[this.view] || santu_purchase.VIEWS.bills;
		const is_bills = this.view === "bills";
		const is_return = this.view === "purchase_return";

		const $root = $(`
			<div class="santu-purchase">
				<div class="santu-purchase-page-header">
					<div class="santu-purchase-page-title">
						<span class="santu-purchase-title-text">${frappe.utils.escape_html(view_meta.title)}</span>
						<span class="santu-purchase-title-chevron" aria-hidden="true">▾</span>
					</div>
					<div class="santu-purchase-header-actions">
						${is_bills ? `
							<div class="santu-purchase-upload-wrap">
								<button type="button" class="btn btn-default santu-purchase-upload-btn">Upload Purchase Bills ▾</button>
								<div class="santu-purchase-upload-menu" style="display:none;">
									<button type="button" data-route="santu-upload-bill">Upload PDF Bill</button>
									<button type="button" data-route="santu-receive-stock">Receive Stock (Quick)</button>
								</div>
							</div>
						` : ""}
						${is_return ? `<select class="santu-purchase-pill santu-purchase-return-type" aria-label="Return type"><option value="debit_note">Debit Note</option></select>` : ""}
						<button type="button" class="btn btn-primary santu-purchase-add-btn">${frappe.utils.escape_html(view_meta.addLabel)}</button>
					</div>
				</div>

				<div class="santu-purchase-filter-bar">
					<select class="santu-purchase-pill santu-purchase-period" aria-label="Time period">
						${santu_purchase.PERIODS.map((p) => `<option value="${p}">${p}</option>`).join("")}
					</select>
					<span class="santu-purchase-between-label">Between</span>
					<div class="santu-purchase-date-range">
						<span class="santu-purchase-cal-icon" aria-hidden="true">📅</span>
						<input type="date" class="santu-purchase-pill santu-purchase-from-date" aria-label="From date">
						<span class="santu-purchase-date-to">To</span>
						<input type="date" class="santu-purchase-pill santu-purchase-to-date" aria-label="To date">
					</div>
					<select class="santu-purchase-pill santu-purchase-company" aria-label="Company"></select>
					<div class="santu-purchase-filter-actions">
						<button type="button" class="santu-purchase-filter-link santu-purchase-excel-btn" title="Excel Report">📗 Excel Report</button>
						<button type="button" class="santu-purchase-filter-link santu-purchase-print-btn" title="Print">🖨 Print</button>
					</div>
				</div>

				<div class="santu-purchase-summary-wrap"></div>
				<div class="santu-purchase-txn-wrap"></div>
				${is_return ? `<div class="santu-purchase-summary-bottom"></div>` : ""}
			</div>
		`).appendTo(this.page.body);

		this.$root = $root;
		this.$summary = $root.find(".santu-purchase-summary-wrap");
		this.$summary_bottom = $root.find(".santu-purchase-summary-bottom");
		this.$txn = $root.find(".santu-purchase-txn-wrap");
		this.$period = $root.find(".santu-purchase-period");
		this.$company = $root.find(".santu-purchase-company");
		this.$from = $root.find(".santu-purchase-from-date");
		this.$to = $root.find(".santu-purchase-to-date");
		this.$title = $root.find(".santu-purchase-title-text");
		this.$add_btn = $root.find(".santu-purchase-add-btn");

		this.$period.val(this.state.period);
	},

	bind_events() {
		this.$add_btn.on("click", () => this.add_record());

		this.$root.find(".santu-purchase-upload-btn").on("click", (e) => {
			e.stopPropagation();
			this.$root.find(".santu-purchase-upload-menu").toggle();
		});
		this.$root.find(".santu-purchase-upload-menu button").on("click", (e) => {
			frappe.set_route($(e.currentTarget).data("route"));
		});
		$(document).off("click.santu-purchase-upload").on("click.santu-purchase-upload", () => {
			this.$root.find(".santu-purchase-upload-menu").hide();
		});

		this.$period.on("change", () => {
			this.state.period = this.$period.val();
			if (this.state.period !== "Custom") {
				this.state.from_date = "";
				this.state.to_date = "";
			}
			this.load_data();
		});

		this.$from.add(this.$to).on("change", () => {
			if (this._syncing_dates) return;
			this.state.from_date = this.$from.val();
			this.state.to_date = this.$to.val();
			if (this.state.from_date && this.state.to_date) {
				if (this.state.period !== "Custom") {
					this.state.period = "Custom";
					this.$period.val("Custom");
				}
				this.load_data();
			}
		});

		this.$company.on("change", () => {
			this.state.company = this.$company.val();
			this.load_data();
		});

		this.$root.find(".santu-purchase-return-type").on("change", (e) => {
			this.state.return_type = $(e.target).val();
			this.load_data();
		});

		this.$root.find(".santu-purchase-excel-btn").on("click", () => {
			if (this._last_data) santu_purchase.utils.export_csv(this._last_data.transactions, this.view);
		});
		this.$root.find(".santu-purchase-print-btn").on("click", () => window.print());

		$(document).off("santu-purchase-view-change.santu-purchase-page").on("santu-purchase-view-change.santu-purchase-page", () => {
			this.view = santu_purchase.utils.get_view();
			$(this.page.body).empty();
			this.render_shell();
			this.bind_events();
			santu_purchase.api.clear_cache();
			this.load_data(true);
		});
	},

	add_record() {
		const view = this.view;
		if (view === "payment_out") {
			return frappe.new_doc("Payment Entry", { payment_type: "Pay", party_type: "Supplier" });
		}
		if (view === "expenses") {
			return frappe.new_doc("Journal Entry");
		}
		if (view === "purchase_order") {
			return frappe.new_doc("Purchase Order");
		}
		if (view === "purchase_return") {
			return frappe.new_doc("Purchase Invoice", { is_return: 1 });
		}
		return frappe.new_doc("Purchase Invoice");
	},

	_sync_date_inputs(from_date, to_date) {
		this._syncing_dates = true;
		if (from_date) this.$from.val(from_date);
		if (to_date) this.$to.val(to_date);
		this.state.from_date = from_date || "";
		this.state.to_date = to_date || "";
		this._syncing_dates = false;
	},

	_populate_companies(companies, selected) {
		this.$company.empty();
		if (companies.length > 1) {
			this.$company.append(`<option value="__all__">ALL FIRMS</option>`);
		}
		companies.forEach((c) =>
			this.$company.append(`<option value="${frappe.utils.escape_html(c)}">${frappe.utils.escape_html(c)}</option>`)
		);
		if (selected === "__all__" && companies.length > 1) {
			this.$company.val("__all__");
		} else if (selected && companies.includes(selected)) {
			this.$company.val(selected);
		} else {
			this.$company.val(companies[0]);
		}
		this.state.company = this.$company.val();
	},

	async load_data(force = false) {
		this.$summary.html(`<div class="santu-purchase-loading">Loading…</div>`);
		this.$txn.html(`<div class="santu-purchase-loading">Loading…</div>`);
		if (this.$summary_bottom.length) this.$summary_bottom.empty();

		const params = {
			period: this.state.period,
			from_date: this.state.from_date || null,
			to_date: this.state.to_date || null,
			company: this.state.company || null,
			view: this.view,
			search: this.state.search || null,
			return_type: this.state.return_type || "debit_note",
		};

		try {
			const data = await santu_purchase.api.fetch(params, force);
			this._last_data = data;

			if (data.companies && data.companies.length && !this.$company.children().length) {
				this._populate_companies(data.companies, data.company);
			}

			this._sync_date_inputs(data.from_date, data.to_date);

			if (this.view === "purchase_order") {
				this.$summary.empty();
			} else if (this.view === "purchase_return") {
				this.$summary.empty();
				santu_purchase.summary.render(this.$summary_bottom, data.summary, this.view);
			} else {
				santu_purchase.summary.render(this.$summary, data.summary, this.view);
			}

			santu_purchase.transactions.render(this.$txn, data.transactions, this.view, {
				on_add: () => this.add_record(),
				on_search: (q) => {
					this.state.search = q;
					this.load_data(true);
				},
			});
		} catch (e) {
			this.$summary.html(`<div class="santu-purchase-empty">Could not load purchase data.</div>`);
			this.$txn.empty();
			console.error(e);
		}
	},
};
