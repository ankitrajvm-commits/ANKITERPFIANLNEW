/* global frappe, santu_sale */
frappe.provide("santu_sale");

santu_sale.transactions = {
	// `frappe.model.open_mapped_doc({frm: {...}})` needs a REAL form object
	// (it calls frm.get_selected() internally) — passing a plain stub throws
	// "opts.frm.get_selected is not a function". There's no open form here
	// (these actions fire from a plain list row), so call the mapped-doc
	// method directly and route to the result instead — the same pattern
	// Frappe's own list-view bulk actions use when there's no frm either.
	//
	// The mapped doc comes back UNSAVED (no real name yet) — routing it
	// through santu_open_invoice_view (a read-only view of an already-saved
	// document) threw "Sales Order new-sales-order-xxx not found" (confirmed
	// live 2026-08-15: "Convert to Sales Order" from an Estimate). It is
	// handed to the destination screen's own _apply_prefill instead, so the
	// user reviews and edits before anything is actually saved.
	//
	// Every conversion lands on Billing (POS) — 2026-08-20 direct request,
	// "sare billing me billing pos ka hi landing daal do". There is no
	// per-target routing any more; the old `target` argument (which chose
	// santu-sales-order vs santu-sale-invoice) is gone.
	_convert_via_mapped_doc(method, source_name) {
		frappe.call({
			method,
			args: { source_name },
			freeze: true,
			callback: (r) => {
				if (!r.message) return;
				frappe.route_options = { prefill: r.message };
				frappe.set_route("santu-billing");
			},
		});
	},

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
				<span class="santu-sale-txn-title"></span>
				<div class="santu-sale-txn-toolbar">
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-search-btn" title="Search">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="#656672" stroke-width="1.5"/><path d="M13.5 13.5L17 17" stroke="#656672" stroke-width="1.5" stroke-linecap="round"/></svg>
					</button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-chart-btn" title="Sales Report">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 16V9M10 16V5M16 16v-4" stroke="#656672" stroke-width="1.6" stroke-linecap="round"/></svg>
					</button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-export-btn" title="Export Excel"><span class="santu-sale-xls-badge">xls</span></button>
					<button type="button" class="santu-sale-icon-btn santu-sale-txn-print-btn" title="Print">
						<img src="/assets/santu_hardware/images/sale/print-invoice-blue.svg" alt="" width="18" height="18">
					</button>
				</div>
			</div>
		`).appendTo($card);

		$search_panel.appendTo($card);

		$header.find(".santu-sale-txn-search-btn").on("click", () => {
			$search_panel.slideToggle(150, () => $search_panel.find("input").focus());
		});
		$header.find(".santu-sale-txn-chart-btn").on("click", () => {
			if (window.santu_open_report) window.santu_open_report("sale");
			else frappe.set_route("santu-reports");
		});
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

		const f = `<span class="santu-sale-th-filter">▽</span>`;
		const is_quotation = view === "quotation";
		const $table_wrap = $(`
			<div class="santu-sale-txn-table-wrap">
				<table class="santu-sale-txn-table">
					<thead>
						<tr>
							${
								is_quotation
									? `
								<th>Date ${f}</th>
								<th>Reference no ${f}</th>
								<th>Party Name ${f}</th>
								<th class="num">Amount ${f}</th>
								<th class="num">Balance ${f}</th>
								<th>Status ${f}</th>
								<th class="num">Actions</th>
							`
									: `
								<th>Date ${f}</th>
								<th>Invoice no ${f}</th>
								<th>Party Name ${f}</th>
								<th>Transaction ${f}</th>
								<th>Payment Type ${f}</th>
								<th class="num">Amount ${f}</th>
								<th class="num">Balance ${f}</th>
								<th class="num">Actions</th>
							`
							}
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
			const $row = is_quotation ? this._build_quotation_row(t, u) : $(`
				<tr class="santu-sale-txn-row">
					<td>${frappe.datetime.str_to_user(t.posting_date)}</td>
					<td class="santu-sale-inv-no">${frappe.utils.escape_html(t.invoice_no)}</td>
					<td>${frappe.utils.escape_html(t.party_name || "—")}</td>
					<td>${frappe.utils.escape_html(t.transaction)}</td>
					<td>${frappe.utils.escape_html(t.payment_type || "—")}</td>
					<td class="num santu-figures">${u.format_money(t.amount)}</td>
					<td class="num santu-figures ${t.balance > 0 ? "santu-sale-balance-due" : ""}">${bal}</td>
					<td class="num santu-sale-row-actions">
						<button type="button" class="santu-sale-row-btn" title="Print" data-action="print">
							<img src="/assets/santu_hardware/images/sale/print-invoice-blue.svg" alt="" width="16" height="16">
						</button>
						<button type="button" class="santu-sale-row-btn" title="Share" data-action="share">
							<img src="/assets/santu_hardware/images/items/shareOnlineStoreItem.svg" alt="" width="16" height="16">
						</button>
						<button type="button" class="santu-sale-row-btn" title="More" data-action="more">⋮</button>
					</td>
				</tr>
			`);

			if (!is_quotation) {
				$row.find(".santu-sale-row-btn").on("click", (e) => {
					e.stopPropagation();
					const action = $(e.currentTarget).data("action");
					this._row_action(action, t);
				});
				$row.on("click", () => window.santu_open_invoice_view(t.doctype, t.invoice_no));
			}
			$row.appendTo($tbody);
		});

		return $header;
	},

	_quotation_status_class(status) {
		if (status === "Ordered") return "santu-sale-status-ordered";
		if (status === "Lost" || status === "Expired") return "santu-sale-status-lost";
		if (status === "Draft") return "santu-sale-status-draft";
		return "santu-sale-status-open";
	},

	_build_quotation_row(t, u) {
		const bal = t.balance ? u.format_money(t.balance) : "—";
		const already_converted = t.status === "Ordered";
		const $row = $(`
			<tr class="santu-sale-txn-row">
				<td>${frappe.datetime.str_to_user(t.posting_date)}</td>
				<td class="santu-sale-inv-no">${frappe.utils.escape_html(t.invoice_no)}</td>
				<td>${frappe.utils.escape_html(t.party_name || "—")}</td>
				<td class="num santu-figures">${u.format_money(t.amount)}</td>
				<td class="num santu-figures ${t.balance > 0 ? "santu-sale-balance-due" : ""}">${bal}</td>
				<td><span class="santu-sale-status-pill ${this._quotation_status_class(t.status)}">${frappe.utils.escape_html(t.status)}</span></td>
				<td class="num santu-sale-row-actions">
					${
						already_converted
							? `<span class="santu-sale-converted-label">Converted</span>`
							: `<button type="button" class="santu-sale-convert-btn" data-action="convert">${__("Convert to Bill")}</button>`
					}
					<button type="button" class="santu-sale-row-btn" title="More" data-action="more">⋮</button>
				</td>
			</tr>
		`);

		// One direct action, no dropdown (2026-08-20). Once every conversion
		// started landing on Billing, "Convert to Sales Order" and "Convert to
		// Sales Invoice" both just opened a prefilled bill — two menu entries
		// doing the identical thing. Neither creates a Sales Order any more,
		// so the honest label is simply "Convert to Bill", and a one-item
		// dropdown is a click for nothing.
		$row.find("[data-action='convert']").on("click", (e) => {
			e.stopPropagation();
			this._convert_via_mapped_doc(
				"erpnext.selling.doctype.quotation.quotation.make_sales_invoice",
				t.invoice_no
			);
		});
		$row.find("[data-action='more']").on("click", (e) => {
			e.stopPropagation();
			this._row_action("more", t);
		});
		$row.on("click", () => window.santu_open_invoice_view(t.doctype, t.invoice_no));
		return $row;
	},

	_render_empty($card, view, on_add_sale) {
		const meta = santu_sale.VIEWS[view] || {};
		const add_label = "+ " + (meta.addLabel || "+ Add Sale").replace(/^\+\s*/, "");
		const art = {
			quotation: "/assets/santu_hardware/images/sale/first-screens/estimate.svg",
			proforma: "/assets/santu_hardware/images/sale/first-screens/estimate.svg",
			delivery_challan: "/assets/santu_hardware/images/sale/first-screens/delivery-challan.svg",
			sales_return: "/assets/santu_hardware/images/sale/first-screens/sale-return.svg",
			payment_in: "/assets/santu_hardware/images/sale/first-screens/payment.svg",
			sales_order: "/assets/santu_hardware/images/sale/first-screens/sale.svg",
		};
		const src = art[view] || "/assets/santu_hardware/images/sale/first-screens/sale.svg";
		const illustration = `<div class="santu-sale-empty-illustration"><img src="${src}" alt=""></div>`;

		if (view === "sales_order") {
			$card.append(`
				<div class="santu-sale-empty santu-sale-empty-so">
					${illustration}
					<div class="santu-sale-empty-text">Make &amp; share sales orders with your parties &amp; convert them to sale invoices instantly.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		} else if (view === "sales_return") {
			$card.append(`
				<div class="santu-sale-empty">
					${illustration}
					<div class="santu-sale-empty-title">No Transaction Found.</div>
					<div class="santu-sale-empty-sub">Please try again after making relevant changes.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		} else {
			$card.append(`
				<div class="santu-sale-empty">
					${illustration}
					<div class="santu-sale-empty-title">No Transaction Found.</div>
					<div class="santu-sale-empty-sub">You haven't added any transactions yet.</div>
					<button type="button" class="btn santu-sale-add-btn santu-sale-empty-btn">${frappe.utils.escape_html(add_label)}</button>
				</div>
			`);
		}
		$card.find(".santu-sale-empty-btn").on("click", on_add_sale);
	},

	_row_action(action, t) {
		if (action === "open") {
			window.santu_open_invoice_view(t.doctype, t.invoice_no);
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
			if (!t.doctype || !t.invoice_no) return;
			if (window.santu_whatsapp_share) {
				window.santu_whatsapp_share.send_transaction(t.doctype, t.invoice_no);
			} else {
				frappe.msgprint(__("WhatsApp share is loading — please try again."));
			}
			return;
		}
		if (action === "more") {
			const items = [
				{ label: __("Open"), action: () => window.santu_open_invoice_view(t.doctype, t.invoice_no) },
				{ label: __("Print"), action: () => this._row_action("print", t) },
			];
			if (t.doctype === "Sales Order") {
				items.push({
					label: __("Create Sales Invoice"),
					action: () => {
						this._convert_via_mapped_doc(
							"erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice",
							t.invoice_no
						);
					},
				});
			}
			items.push({ label: __("Send on WhatsApp"), action: () => this._row_action("share", t) });
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
