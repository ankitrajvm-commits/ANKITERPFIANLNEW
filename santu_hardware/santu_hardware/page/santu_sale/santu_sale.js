frappe.pages["santu-sale"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sale/santu_sale_utils.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_api.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_summary.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_transactions.js",
		],
		() => {
			const view = santu_sale.utils.get_view();
			const view_meta = santu_sale.VIEWS[view];
			if (view === "pos" || (view_meta && view_meta.redirect)) {
				frappe.set_route(view_meta.redirect || "point-of-sale");
				return;
			}

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: (view_meta && view_meta.title) || "Sale Invoices",
				single_column: true,
			});

			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-sale-page-main");
			santu_sale_page.init(page);
		}
	);
};

const santu_sale_page = {
	init(page) {
		this.page = page;
		this.view = santu_sale.utils.get_view();
		this._syncing_dates = false;
		this.state = {
			period: "This Month",
			from_date: "",
			to_date: "",
			company: "",
			search: "",
		};
		this.render_shell();
		this.bind_events();
		this.load_data();
	},

	render_shell() {
		const view_meta = santu_sale.VIEWS[this.view] || santu_sale.VIEWS.invoices;
		const $root = $(`
			<div class="santu-sale">
				<div class="santu-sale-page-header">
					<div class="santu-sale-page-title">
						<span class="santu-sale-title-text">${frappe.utils.escape_html(view_meta.title)}</span>
						<span class="santu-sale-title-chevron" aria-hidden="true">▾</span>
					</div>
					<button type="button" class="btn btn-primary santu-sale-add-btn">${frappe.utils.escape_html(view_meta.addLabel || "+ Add Sale")}</button>
				</div>

				<div class="santu-sale-filter-bar">
					<span class="santu-sale-filter-label">Filter by:</span>
					<select class="santu-sale-pill santu-sale-period" aria-label="Time period">
						${santu_sale.PERIODS.map((p) => `<option value="${p}">${p}</option>`).join("")}
					</select>
					<div class="santu-sale-date-range">
						<span class="santu-sale-cal-icon" aria-hidden="true">📅</span>
						<input type="date" class="santu-sale-pill santu-sale-from-date" aria-label="From date">
						<span class="santu-sale-date-to">To</span>
						<input type="date" class="santu-sale-pill santu-sale-to-date" aria-label="To date">
					</div>
					<select class="santu-sale-pill santu-sale-company" aria-label="Company"></select>
				</div>

				<div class="santu-sale-summary-wrap"></div>
				<div class="santu-sale-txn-wrap"></div>
			</div>
		`).appendTo(this.page.body);

		this.$root = $root;
		this.$summary = $root.find(".santu-sale-summary-wrap");
		this.$txn = $root.find(".santu-sale-txn-wrap");
		this.$period = $root.find(".santu-sale-period");
		this.$company = $root.find(".santu-sale-company");
		this.$from = $root.find(".santu-sale-from-date");
		this.$to = $root.find(".santu-sale-to-date");
		this.$title = $root.find(".santu-sale-title-text");
		this.$add_btn = $root.find(".santu-sale-add-btn");

		this.$period.val(this.state.period);
	},

	bind_events() {
		this.$root.find(".santu-sale-add-btn").on("click", () => this.add_sale());

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

		$(document).on("santu-sale-view-change", () => {
			this.view = santu_sale.utils.get_view();
			const meta = santu_sale.VIEWS[this.view];
			if (meta && meta.redirect) {
				frappe.set_route(meta.redirect);
				return;
			}
			this.$title.text(meta ? meta.title : "Sale Invoices");
			this.$add_btn.text((meta && meta.addLabel) || "+ Add Sale");
			santu_sale.api.clear_cache();
			this.load_data(true);
		});
	},

	add_sale() {
		const view = this.view;
		if (view === "quotation") return frappe.new_doc("Quotation");
		if (view === "sales_order") return frappe.new_doc("Sales Order");
		if (view === "delivery_challan") return frappe.new_doc("Delivery Note");
		if (view === "payment_in") return frappe.new_doc("Payment Entry", { payment_type: "Receive" });
		if (view === "proforma") return frappe.new_doc("Sales Invoice");
		if (view === "sales_return") return frappe.set_route("point-of-sale", { santu_return: 1 });
		return frappe.set_route("santu-sale-invoice");
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
			this.$company.append(`<option value="__all__">All Firms</option>`);
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
		this.$summary.html(`<div class="santu-sale-loading">Loading…</div>`);
		this.$txn.html(`<div class="santu-sale-loading">Loading…</div>`);

		const params = {
			period: this.state.period,
			from_date: this.state.from_date || null,
			to_date: this.state.to_date || null,
			company: this.state.company || null,
			view: this.view,
			search: this.state.search || null,
		};

		try {
			const data = await santu_sale.api.fetch(params, force);

			if (data.companies && data.companies.length) {
				if (!this.$company.children().length) {
					this._populate_companies(data.companies, data.company);
				}
			}

			this._sync_date_inputs(data.from_date, data.to_date);

			santu_sale.summary.render(this.$summary, data.summary);

			santu_sale.transactions.render(this.$txn, data.transactions, {
				on_refresh: () => {
					santu_sale.api.clear_cache();
					this.load_data(true);
				},
				on_add_sale: () => this.add_sale(),
				on_search: (q) => {
					this.state.search = q;
					this.load_data(true);
				},
				view: this.view,
			});
		} catch (e) {
			this.$summary.html(`<div class="santu-sale-empty">Could not load sale data.</div>`);
			this.$txn.empty();
			console.error(e);
		}
	},
};
