frappe.pages["santu-sale-invoice"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sale Invoice",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();
	$(page.main).addClass("santu-sale-invoice-page-main");

	frappe.require(
		["/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js"],
		() => santu_sale_invoice_page.init(page)
	);
};

const santu_sale_invoice_page = {
	async init(page) {
		this.page = page;
		this.state = {
			customer: null,
			customer_name: "",
			items: [],
			payments: [],
			warehouse: null,
			company: null,
			selling_price_list: null,
			payment_modes: [],
			paid_amount: 0,
			payment_mode: "Cash",
		};
		this.render_shell();
		await this.load_init();
		this.bind_events();
		this.focus_item_search();
	},

	render_shell() {
		const $root = $(`
			<div class="santu-si">
				<div class="santu-si-header">
					<h1 class="santu-si-title">Sale Invoice</h1>
					<div class="santu-si-header-actions">
						<button type="button" class="btn btn-default santu-si-back">← Back</button>
					</div>
				</div>
				<div class="santu-si-body">
					<div class="santu-si-main">
						<div class="santu-si-card santu-si-customer-card">
							<label class="santu-si-label">Customer</label>
							<div class="santu-si-customer-row">
								<div class="santu-si-search-wrap">
									<input type="text" class="form-control santu-si-customer-search" placeholder="Search customer name or phone" autocomplete="off">
									<div class="santu-si-suggest santu-si-customer-suggest"></div>
								</div>
								<button type="button" class="btn btn-default santu-si-new-customer">+ New</button>
							</div>
							<div class="santu-si-customer-info"></div>
						</div>
						<div class="santu-si-card santu-si-item-entry-card">
							<label class="santu-si-label">Add Item</label>
							<div class="santu-si-item-entry-row">
								<div class="santu-si-search-wrap santu-si-item-search-wrap">
									<input type="text" class="form-control santu-si-item-search" placeholder="Search item name, code or barcode" autocomplete="off">
									<div class="santu-si-suggest santu-si-item-suggest"></div>
								</div>
								<input type="number" class="form-control santu-si-item-qty" value="1" min="0.01" step="any" title="Qty">
								<button type="button" class="btn btn-primary santu-si-add-item-btn">Add</button>
							</div>
						</div>
						<div class="santu-si-card santu-si-table-card">
							<div class="santu-si-table-wrap">
								<table class="santu-si-table">
									<thead>
										<tr>
											<th>Item</th>
											<th>Code</th>
											<th class="num">Qty</th>
											<th>UOM</th>
											<th class="num">Rate</th>
											<th class="num">Disc %</th>
											<th class="num">Amount</th>
											<th></th>
										</tr>
									</thead>
									<tbody class="santu-si-items-body"></tbody>
								</table>
							</div>
							<div class="santu-si-empty-items">No items added yet. Search and add items above.</div>
						</div>
					</div>
					<div class="santu-si-side">
						<div class="santu-si-card santu-si-totals-card">
							<div class="santu-si-total-row"><span>Subtotal</span><span class="santu-si-subtotal santu-figures">₹ 0.00</span></div>
							<div class="santu-si-total-row"><span>Discount</span><span class="santu-si-discount santu-figures">₹ 0.00</span></div>
							<div class="santu-si-total-row santu-si-grand-row"><span>Grand Total</span><span class="santu-si-grand santu-figures">₹ 0.00</span></div>
						</div>
						<div class="santu-si-card santu-si-payment-card">
							<label class="santu-si-label">Payment Mode</label>
							<select class="form-control santu-si-payment-mode"></select>
							<label class="santu-si-label">Amount Received</label>
							<input type="number" class="form-control santu-si-paid-amount" min="0" step="0.01" value="0">
							<div class="santu-si-total-row"><span>Balance</span><span class="santu-si-balance santu-figures">₹ 0.00</span></div>
						</div>
						<div class="santu-si-actions">
							<button type="button" class="btn btn-default santu-si-save-draft">Save Draft</button>
							<button type="button" class="btn btn-primary santu-si-save-submit">Save & Submit</button>
							<button type="button" class="btn btn-default santu-si-save-print">Save & Print</button>
							<button type="button" class="btn btn-default santu-si-save-new">Save & New Sale</button>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.body);

		this.$root = $root;
		this.$customer_search = $root.find(".santu-si-customer-search");
		this.$customer_suggest = $root.find(".santu-si-customer-suggest");
		this.$customer_info = $root.find(".santu-si-customer-info");
		this.$item_search = $root.find(".santu-si-item-search");
		this.$item_suggest = $root.find(".santu-si-item-suggest");
		this.$item_qty = $root.find(".santu-si-item-qty");
		this.$items_body = $root.find(".santu-si-items-body");
		this.$empty_items = $root.find(".santu-si-empty-items");
		this.$payment_mode = $root.find(".santu-si-payment-mode");
		this.$paid_amount = $root.find(".santu-si-paid-amount");
	},

	async load_init() {
		const data = await santu_sale_invoice.api.init();
		this.state.company = data.company;
		this.state.warehouse = data.warehouse;
		this.state.selling_price_list = data.selling_price_list;
		this.state.payment_modes = data.payment_modes || [];
		this.$payment_mode.empty();
		this.state.payment_modes.forEach((m) => {
			this.$payment_mode.append(`<option value="${frappe.utils.escape_html(m.name)}">${frappe.utils.escape_html(m.name)}</option>`);
		});
		if (this.state.payment_modes.length) {
			this.state.payment_mode = this.state.payment_modes[0].name;
		}
	},

	bind_events() {
		const u = santu_sale_invoice.utils;

		this.$root.find(".santu-si-back").on("click", () => frappe.set_route("santu-sale"));

		this.$customer_search.on(
			"input",
			u.debounce(async () => {
				const q = this.$customer_search.val().trim();
				if (q.length < 2) return this.$customer_suggest.hide().empty();
				const rows = await santu_sale_invoice.api.search_customers(q);
				this.render_customer_suggest(rows);
			})
		);

		this.$item_search.on(
			"input",
			u.debounce(async () => {
				const q = this.$item_search.val().trim();
				if (q.length < 1) return this.$item_suggest.hide().empty();
				const res = await santu_sale_invoice.api.search_items(q);
				this.render_item_suggest(res.results || []);
			})
		);

		this.$item_search.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const $first = this.$item_suggest.find(".santu-si-suggest-row").first();
				if ($first.length) $first.trigger("click");
				else this.add_item_from_search();
			}
		});

		this.$root.find(".santu-si-add-item-btn").on("click", () => this.add_item_from_search());
		this.$root.find(".santu-si-new-customer").on("click", () => this.quick_new_customer());
		this.$paid_amount.on("input", () => this.recalc_totals());
		this.$payment_mode.on("change", () => {
			this.state.payment_mode = this.$payment_mode.val();
		});

		this.$root.find(".santu-si-save-draft").on("click", () => this.save_invoice(0, false));
		this.$root.find(".santu-si-save-submit").on("click", () => this.save_invoice(1, false));
		this.$root.find(".santu-si-save-print").on("click", () => this.save_invoice(1, true));
		this.$root.find(".santu-si-save-new").on("click", () => this.save_invoice(1, false, true));

		$(document).on("click.santu_si", (e) => {
			if (!$(e.target).closest(".santu-si-search-wrap").length) {
				this.$customer_suggest.hide();
				this.$item_suggest.hide();
			}
		});
	},

	render_customer_suggest(rows) {
		this.$customer_suggest.empty();
		if (!rows.length) return this.$customer_suggest.hide();
		rows.forEach((r) => {
			$(`<div class="santu-si-suggest-row" role="button">
				<strong>${frappe.utils.escape_html(r.customer_name)}</strong>
				<span>${frappe.utils.escape_html(r.mobile_no || "")} ${frappe.utils.escape_html(r.santu_village || "")}</span>
			</div>`)
				.on("click", () => this.select_customer(r))
				.appendTo(this.$customer_suggest);
		});
		this.$customer_suggest.show();
	},

	render_item_suggest(rows) {
		this.$item_suggest.empty();
		if (!rows.length) return this.$item_suggest.hide();
		rows.forEach((r) => {
			const stock = r.available_qty !== null ? `Stock: ${r.available_qty}` : "";
			$(`<div class="santu-si-suggest-row" role="button" data-code="${frappe.utils.escape_html(r.item_code)}">
				<strong>${frappe.utils.escape_html(r.item_name)}</strong>
				<span>${frappe.utils.escape_html(r.item_code)} · ${santu_sale_invoice.utils.format_money(r.price)} · ${stock}</span>
			</div>`)
				.on("click", () => {
					this.$item_search.val(r.item_code);
					this.$item_suggest.hide();
					this.add_item(r.item_code);
				})
				.appendTo(this.$item_suggest);
		});
		this.$item_suggest.show();
	},

	async select_customer(row) {
		this.state.customer = row.name;
		this.state.customer_name = row.customer_name;
		this.$customer_search.val(row.customer_name);
		this.$customer_suggest.hide();
		const details = await santu_sale_invoice.api.customer_details(row.name);
		this.$customer_info.html(`
			<div class="santu-si-customer-selected">
				<strong>${frappe.utils.escape_html(details.customer_name)}</strong>
				${details.mobile_no ? `<span>📞 ${frappe.utils.escape_html(details.mobile_no)}</span>` : ""}
				${details.village ? `<span>📍 ${frappe.utils.escape_html(details.village)}</span>` : ""}
				${details.address ? `<span>${frappe.utils.escape_html(details.address)}</span>` : ""}
			</div>
		`);
		this.focus_item_search();
	},

	quick_new_customer() {
		const d = new frappe.ui.Dialog({
			title: "New Customer",
			fields: [
				{ fieldname: "customer_name", label: "Name", fieldtype: "Data", reqd: 1 },
				{ fieldname: "mobile_no", label: "Phone", fieldtype: "Data" },
				{ fieldname: "santu_village", label: "Village", fieldtype: "Data" },
			],
			primary_action_label: "Create",
			primary_action: async (values) => {
				const name = await frappe.xcall("santu_hardware.santu_hardware.api.get_or_create_customer_by_phone", {
					customer_name: values.customer_name,
					phone: values.mobile_no || "",
					village: values.santu_village || "",
				});
				d.hide();
				await this.select_customer({ name, customer_name: values.customer_name, mobile_no: values.mobile_no });
			},
		});
		d.show();
	},

	add_item_from_search() {
		const code = this.$item_search.val().trim();
		if (!code) return;
		this.add_item(code);
	},

	async add_item(item_code) {
		if (!this.state.customer) {
			frappe.msgprint(__("Please select a customer first."));
			this.$customer_search.focus();
			return;
		}
		const qty = parseFloat(this.$item_qty.val()) || 1;
		if (qty <= 0) {
			frappe.msgprint(__("Please enter a valid quantity."));
			return;
		}

		try {
			const row = await santu_sale_invoice.api.item_row(
				this.state.customer,
				item_code,
				this.state.warehouse,
				qty
			);

			if (row.is_stock_item && row.available_qty !== null && qty > row.available_qty) {
				frappe.msgprint({
					title: __("Low Stock"),
					message: __("Insufficient stock for {0}. Available: {1}", [row.item_name, row.available_qty]),
					indicator: "orange",
				});
			}

			const amount = flt(row.qty) * flt(row.rate) - flt(row.discount_amount);
			this.state.items.push({
				item_code: row.item_code,
				item_name: row.item_name,
				qty: flt(row.qty),
				uom: row.uom || row.stock_uom,
				rate: flt(row.rate),
				discount_percentage: flt(row.discount_percentage),
				discount_amount: flt(row.discount_amount),
				amount: amount,
				warehouse: row.warehouse || this.state.warehouse,
				available_qty: row.available_qty,
			});

			this.render_items();
			this.$item_search.val("").focus();
			this.$item_qty.val(1);
			this.$item_suggest.hide();
			this.recalc_totals();
		} catch (e) {
			frappe.msgprint(__("Could not add item. Please check item code."));
			console.error(e);
		}
	},

	render_items() {
		this.$items_body.empty();
		const has = this.state.items.length > 0;
		this.$empty_items.toggle(!has);
		this.$root.find(".santu-si-table").toggle(has);

		this.state.items.forEach((row, idx) => {
			const stock_warn =
				row.available_qty !== null && row.qty > row.available_qty
					? `<span class="santu-si-stock-warn">Low stock (${row.available_qty})</span>`
					: row.available_qty !== null
						? `<span class="santu-si-stock-ok">Stock: ${row.available_qty}</span>`
						: "";
			const $tr = $(`
				<tr data-idx="${idx}">
					<td>${frappe.utils.escape_html(row.item_name)} ${stock_warn}</td>
					<td>${frappe.utils.escape_html(row.item_code)}</td>
					<td class="num"><input type="number" class="form-control input-xs santu-si-inline-qty" value="${row.qty}" min="0.01" step="any"></td>
					<td>${frappe.utils.escape_html(row.uom || "")}</td>
					<td class="num"><input type="number" class="form-control input-xs santu-si-inline-rate" value="${row.rate}" min="0" step="0.01"></td>
					<td class="num"><input type="number" class="form-control input-xs santu-si-inline-disc" value="${row.discount_percentage || 0}" min="0" max="100" step="0.01"></td>
					<td class="num santu-figures">${santu_sale_invoice.utils.format_money(row.amount)}</td>
					<td><button type="button" class="btn btn-xs btn-danger santu-si-remove">✕</button></td>
				</tr>
			`);
			$tr.find(".santu-si-inline-qty, .santu-si-inline-rate, .santu-si-inline-disc").on("change input", () => {
				row.qty = parseFloat($tr.find(".santu-si-inline-qty").val()) || 0;
				row.rate = parseFloat($tr.find(".santu-si-inline-rate").val()) || 0;
				row.discount_percentage = parseFloat($tr.find(".santu-si-inline-disc").val()) || 0;
				row.discount_amount = (row.qty * row.rate * row.discount_percentage) / 100;
				row.amount = row.qty * row.rate - row.discount_amount;
				$tr.find("td.num.santu-figures").last().text(santu_sale_invoice.utils.format_money(row.amount));
				this.recalc_totals();
			});
			$tr.find(".santu-si-remove").on("click", () => {
				this.state.items.splice(idx, 1);
				this.render_items();
				this.recalc_totals();
				this.focus_item_search();
			});
			this.$items_body.append($tr);
		});
	},

	recalc_totals() {
		const u = santu_sale_invoice.utils;
		let subtotal = 0;
		let discount = 0;
		this.state.items.forEach((r) => {
			subtotal += r.qty * r.rate;
			discount += r.discount_amount || 0;
		});
		const grand = subtotal - discount;
		this.$root.find(".santu-si-subtotal").text(u.format_money(subtotal));
		this.$root.find(".santu-si-discount").text(u.format_money(discount));
		this.$root.find(".santu-si-grand").text(u.format_money(grand));

		const paid = parseFloat(this.$paid_amount.val()) || 0;
		const balance = Math.max(grand - paid, 0);
		this.$root.find(".santu-si-balance").text(u.format_money(balance));
		this.state.paid_amount = paid;
	},

	focus_item_search() {
		setTimeout(() => this.$item_search.focus(), 100);
	},

	build_payload() {
		return {
			customer: this.state.customer,
			company: this.state.company,
			warehouse: this.state.warehouse,
			selling_price_list: this.state.selling_price_list,
			items: this.state.items.map((r) => ({
				item_code: r.item_code,
				qty: r.qty,
				rate: r.rate,
				uom: r.uom,
				warehouse: r.warehouse,
				discount_percentage: r.discount_percentage,
				discount_amount: r.discount_amount,
			})),
			payments:
				this.state.paid_amount > 0
					? [{ mode_of_payment: this.state.payment_mode, amount: this.state.paid_amount }]
					: [],
		};
	},

	async save_invoice(submit, print_after, new_after) {
		if (!this.state.customer) {
			frappe.msgprint(__("Please select a customer."));
			return;
		}
		if (!this.state.items.length) {
			frappe.msgprint(__("Please add at least one item."));
			return;
		}

		const grand = this.state.items.reduce((s, r) => s + (r.amount || 0), 0);
		if (!this.state.paid_amount && submit) {
			this.$paid_amount.val(grand);
			this.state.paid_amount = grand;
		}

		frappe.dom.freeze(__("Saving..."));
		try {
			const result = await santu_sale_invoice.api.save(this.build_payload(), submit);
			frappe.dom.unfreeze();
			frappe.show_alert({ message: __("Sale saved: {0}", [result.name]), indicator: "green" });

			if (print_after) {
				if (typeof santu_print_thermal_bill === "function") {
					await santu_print_thermal_bill("Sales Invoice", result.name);
				}
				frappe.set_route("Form", "Sales Invoice", result.name);
			} else if (!new_after) {
				frappe.set_route("Form", "Sales Invoice", result.name);
			}

			if (new_after) {
				this.reset_form();
			}
		} catch (e) {
			frappe.dom.unfreeze();
			const msg = (e.message || e._server_messages || "Could not save invoice").toString();
			frappe.msgprint({ title: __("Error"), message: msg, indicator: "red" });
		}
	},

	reset_form() {
		this.state.customer = null;
		this.state.items = [];
		this.state.paid_amount = 0;
		this.$customer_search.val("");
		this.$customer_info.empty();
		this.$paid_amount.val(0);
		this.render_items();
		this.recalc_totals();
		this.$customer_search.focus();
	},
};

function flt(v) {
	return parseFloat(v) || 0;
}
