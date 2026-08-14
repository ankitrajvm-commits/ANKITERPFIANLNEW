/* global frappe, santu_sale */
frappe.provide("santu_sale");

santu_sale.transactions = {
	render($wrap, transactions, { on_refresh, on_add_sale, on_search, view } = {}) {
		$wrap.empty();

		const $card = $(`<div class="santu-sale-txn-card-inner"></div>`).appendTo($wrap);

		const $search_panel = $(`
			<div class="santu-sale-txn-search-panel" style="display:none;">
				<input type="text" class="form-control santu-sale-txn-search" placeholder="Search transactions...">
			</div>
		`);

		const $header = $(`
			<div class="santu-sale-txn-header">
				<span class="santu-sale-txn-title">Transactions</span>
				<div class="santu-sale-txn-toolbar">
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-search-btn" title="Search">🔍</button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-chart-btn" title="Sales Report">📊</button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-export-btn" title="Export Excel">📗</button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-print-btn" title="Print">🖨</button>
				</div>
			</div>
		`).appendTo($card);

		$search_panel.appendTo($card);

		$header.find(".santu-sale-txn-search-btn").on("click", () => {
			$search_panel.slideToggle(150, () => $search_panel.find("input").focus());
		});
		$header.find(".santu-sale-txn-chart-btn").on("click", () => frappe.set_route("query-report", "Sales Register"));
		$header.find(".santu-sale-txn-export-btn").on("click", () => santu_sale.utils.export_csv(transactions));
		$header.find(".santu-sale-txn-print-btn").on("click", () => window.print());

		$search_panel.find(".santu-sale-txn-search").on(
			"input",
			santu_sale.utils.debounce((e) => {
				if (on_search) on_search($(e.target).val());
			})
		);

		if (!transactions.length) {
			this._render_empty($card, view, on_add_sale);
			return $header;
		}

		const $table_wrap = $(`
			<div class="santu-sale-txn-table-wrap">
				<table class="santu-sale-txn-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Invoice No</th>
							<th>Party Name</th>
							<th>Transaction</th>
							<th>Payment Type</th>
							<th class="num">Amount</th>
							<th class="num">Balance</th>
							<th class="num">Actions</th>
						</tr>
					</thead>
					<tbody></tbody>
				</table>
			</div>
		`).appendTo($card);

		const $tbody = $table_wrap.find("tbody");
		const u = santu_sale.utils;

		transactions.forEach((t) => {
			const bal = t.balance ? u.format_money(t.balance) : "—";
			const $row = $(`
				<tr class="santu-sale-txn-row">
					<td>${frappe.datetime.str_to_user(t.posting_date)}</td>
					<td class="santu-sale-inv-no">${frappe.utils.escape_html(t.invoice_no)}</td>
					<td>${frappe.utils.escape_html(t.party_name || "—")}</td>
					<td>${frappe.utils.escape_html(t.transaction)}</td>
					<td>${frappe.utils.escape_html(t.payment_type || "—")}</td>
					<td class="num santu-figures">${u.format_money(t.amount)}</td>
					<td class="num santu-figures ${t.balance > 0 ? "santu-sale-balance-due" : ""}">${bal}</td>
					<td class="num santu-sale-row-actions">
						<button type="button" class="santu-sale-row-btn" title="Open" data-action="open">📄</button>
						<button type="button" class="santu-sale-row-btn" title="Print" data-action="print">🖨</button>
						<button type="button" class="santu-sale-row-btn" title="Share" data-action="share">↗</button>
						<button type="button" class="santu-sale-row-btn" title="More" data-action="more">⋮</button>
					</td>
				</tr>
			`);

			$row.find(".santu-sale-row-btn").on("click", (e) => {
				e.stopPropagation();
				const action = $(e.currentTarget).data("action");
				this._row_action(action, t);
			});
			$row.on("click", () => frappe.set_route("Form", t.doctype, t.invoice_no));
			$row.appendTo($tbody);
		});

		return $header;
	},

	_render_empty($card, view, on_add_sale) {
		const meta = santu_sale.VIEWS[view] || {};
		const add_label = meta.addLabel || "+ Add Sale";

		if (view === "sales_order") {
			$card.append(`
				<div class="santu-sale-empty santu-sale-empty-so">
					<div class="santu-sale-empty-icon">🧾</div>
					<div class="santu-sale-empty-text">Make &amp; share sales orders with your parties &amp; convert them to sale invoices instantly.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn santu-sale-empty-btn-so">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		} else if (view === "sales_return") {
			$card.append(`
				<div class="santu-sale-empty">
					<div class="santu-sale-empty-icon">📋</div>
					<div class="santu-sale-empty-title">No data is available for Sales Return.</div>
					<div class="santu-sale-empty-sub">Please try again after making relevant changes.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		} else {
			$card.append(`
				<div class="santu-sale-empty">
					<div class="santu-sale-empty-icon">📄</div>
					<div class="santu-sale-empty-title">No Transactions to show</div>
					<div class="santu-sale-empty-sub">You haven't added any transactions yet.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		}
		$card.find(".santu-sale-empty-btn").on("click", on_add_sale);
	},

	_row_action(action, t) {
		if (action === "open") {
			frappe.set_route("Form", t.doctype, t.invoice_no);
			return;
		}
		if (action === "print") {
			if (typeof santu_print_thermal_bill === "function") {
				santu_print_thermal_bill(t.doctype, t.invoice_no);
			} else {
				frappe.set_route("print", t.doctype, t.invoice_no);
			}
			return;
		}
		if (action === "share") {
			const url = `${window.location.origin}/app/${frappe.router.slug(t.doctype)}/${encodeURIComponent(t.invoice_no)}`;
			if (navigator.clipboard) {
				navigator.clipboard.writeText(url).then(() => frappe.show_alert({ message: "Link copied", indicator: "green" }));
			} else {
				frappe.msgprint(url);
			}
			return;
		}
		if (action === "more") {
			const items = [
				{ label: __("Open"), action: () => frappe.set_route("Form", t.doctype, t.invoice_no) },
				{ label: __("Print"), action: () => this._row_action("print", t) },
			];
			if (t.doctype === "Sales Order") {
				items.push({
					label: __("Create Sales Invoice"),
					action: () => {
						frappe.model.open_mapped_doc({
							method: "erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice",
							frm: { doc: { doctype: t.doctype, name: t.invoice_no } },
						});
					},
				});
			}
			items.push({ label: __("Copy Link"), action: () => this._row_action("share", t) });
			const d = new frappe.ui.Dialog({ title: t.invoice_no, fields: [{ fieldtype: "HTML", fieldname: "menu" }] });
			const $menu = $(`<div class="santu-sale-row-menu"></div>`);
			items.forEach((item) => {
				$menu.append(`<button type="button" class="santu-sale-row-menu-item">${item.label}</button>`);
			});
			d.fields_dict.menu.$wrapper.html($menu);
			$menu.find("button").each(function (idx) {
				$(this).on("click", () => {
					d.hide();
					items[idx].action();
				});
			});
			d.show();
		}
	},
};
