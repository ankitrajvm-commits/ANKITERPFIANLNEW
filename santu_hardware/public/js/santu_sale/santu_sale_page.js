/* global frappe, santu_sale */
frappe.provide("santu_sale");

// The Sale Invoices screen's controller factory. Lives as a static asset
// (rather than inline in the santu-sale Page's own script) so it can be
// frappe.require()'d from elsewhere too — the Reports page embeds this
// exact same screen for its "Sale" report (2026-08-15: "report ko ui aise
// rakho same to same" — Vyapar's own Reports > Sale is literally its Sale
// Invoices screen reused, not a re-skinned generic report). Each caller
// gets its own instance via create_page() so the standalone page and any
// embedded copy never fight over the same $root/$summary/$txn refs.
santu_sale.create_page = function () {
	return {
		init(container, opts = {}) {
			this.$container = container;
			this.opts = Object.assign({ enable_view_switch: true, show_trend: true }, opts);
			this.view = opts.view || santu_sale.utils.get_view();
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
			this.$container.empty();
			const view_meta = santu_sale.VIEWS[this.view] || santu_sale.VIEWS.invoices;
			const menu_html = Object.entries(santu_sale.VIEWS)
				.map(
					([key, meta]) =>
						`<button type="button" data-view="${key}" class="${key === this.view ? "is-active" : ""}">${frappe.utils.escape_html(meta.title)}</button>`
				)
				.join("");
			const $root = $(`
				<div class="santu-sale">
					<div class="santu-sale-page-header">
						<div class="santu-sale-page-title">
							<span class="santu-sale-title-text">${frappe.utils.escape_html(view_meta.title)}</span>
							<span class="santu-sale-title-chevron" aria-hidden="true">▾</span>
							<div class="santu-sale-title-menu">${menu_html}</div>
						</div>
						<div class="santu-sale-header-actions">
							<button type="button" class="btn btn-primary santu-sale-add-btn">+ ${frappe.utils.escape_html((view_meta.addLabel || "+ Add Sale").replace(/^\+\s*/, ""))}</button>
						</div>
					</div>
					<div class="santu-sale-body">
						<div class="santu-sale-filter-bar">
							<span class="santu-sale-filter-label">Filter by :</span>
							<select class="santu-sale-pill santu-sale-period santu-sale-period-strong" aria-label="Time period">
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
				</div>
			`).appendTo(this.$container);

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

			this.$root.find(".santu-sale-page-title").on("click", (e) => {
				e.stopPropagation();
				this.$root.find(".santu-sale-title-menu").toggleClass("open");
			});
			$(document).off("click.santu-sale-title-menu").on("click.santu-sale-title-menu", () => {
				this.$root && this.$root.find(".santu-sale-title-menu").removeClass("open");
			});
			this.$root.find(".santu-sale-title-menu button").on("click", (e) => {
				e.stopPropagation();
				const view = $(e.currentTarget).data("view");
				this.$root.find(".santu-sale-title-menu").removeClass("open");
				if (!view || view === this.view) return;
				santu_sale.utils.set_view(view);
				$(document).trigger("santu-sale-view-change");
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

			if (this.opts.enable_view_switch) {
				$(document).off("santu-sale-view-change.santu-sale-page").on("santu-sale-view-change.santu-sale-page", () => {
					this.view = santu_sale.utils.get_view();
					const meta = santu_sale.VIEWS[this.view];
					if (meta && meta.redirect) {
						frappe.set_route(meta.redirect);
						return;
					}
					this.$title.text(meta ? meta.title : "Sale Invoices");
					this.$add_btn.text("+ " + ((meta && meta.addLabel) || "+ Add Sale").replace(/^\+\s*/, ""));
					this.$root.find(".santu-sale-title-menu button").removeClass("is-active");
					this.$root.find(`.santu-sale-title-menu button[data-view="${this.view}"]`).addClass("is-active");
					santu_sale.api.clear_cache();
					this.load_data(true);
				});
			}
		},

		add_sale() {
			const view = this.view;
			if (view === "quotation") return frappe.set_route("santu-estimate");
			if (view === "sales_order") return frappe.set_route("santu-sales-order");
			if (view === "delivery_challan") return frappe.set_route("santu-delivery-challan");
			if (view === "payment_in") return window.santu_open_collect_payment({ party_type: "Customer" });
			if (view === "proforma") return frappe.set_route("santu-sale-invoice");
			if (view === "sales_return") return frappe.set_route("santu-sales-return");
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

				santu_sale.summary.render(this.$summary, data.summary, { show_trend: this.opts.show_trend });

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
};
