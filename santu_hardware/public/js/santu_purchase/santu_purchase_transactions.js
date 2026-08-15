/* global frappe, santu_purchase */
frappe.provide("santu_purchase");

santu_purchase.transactions = {
	get_columns(view) {
		if (view === "bills") {
			return [
				{ key: "posting_date", label: "Date", get: (t) => frappe.datetime.str_to_user(t.posting_date) },
				{ key: "invoice_no", label: "Invoice No." },
				{ key: "party_name", label: "Party Name" },
				{ key: "payment_type", label: "Payment Type" },
				{ key: "amount", label: "Amount", num: true, get: (t) => santu_purchase.utils.format_money(t.amount) },
				{ key: "balance", label: "Balance Due", num: true, get: (t) => (t.balance ? santu_purchase.utils.format_money(t.balance) : "—") },
			];
		}
		if (view === "payment_out") {
			return [
				{ key: "posting_date", label: "Date", get: (t) => frappe.datetime.str_to_user(t.posting_date) },
				{ key: "invoice_no", label: "Payment No." },
				{ key: "party_name", label: "Party" },
				{ key: "payment_type", label: "Payment Type" },
				{ key: "amount", label: "Amount", num: true, get: (t) => santu_purchase.utils.format_money(t.amount) },
				{ key: "reference", label: "Reference" },
			];
		}
		if (view === "expenses") {
			return [
				{ key: "posting_date", label: "Date", get: (t) => frappe.datetime.str_to_user(t.posting_date) },
				{ key: "expense_account", label: "Expense Account" },
				{ key: "party_name", label: "Party" },
				{ key: "payment_type", label: "Payment Mode" },
				{ key: "amount", label: "Amount", num: true, get: (t) => santu_purchase.utils.format_money(t.amount) },
				{ key: "reference", label: "Reference" },
			];
		}
		if (view === "purchase_order") {
			return [
				{ key: "posting_date", label: "Date", get: (t) => frappe.datetime.str_to_user(t.posting_date) },
				{ key: "invoice_no", label: "Order No." },
				{ key: "party_name", label: "Supplier" },
				{ key: "amount", label: "Amount", num: true, get: (t) => santu_purchase.utils.format_money(t.amount) },
				{ key: "status", label: "Status" },
				{ key: "per_billed", label: "% Billed", num: true, get: (t) => `${t.per_billed || 0}%` },
			];
		}
		if (view === "purchase_return") {
			return [
				{ key: "idx", label: "#", get: (t, i) => i + 1 },
				{ key: "posting_date", label: "Date", get: (t) => frappe.datetime.str_to_user(t.posting_date) },
				{ key: "ref_no", label: "Ref No." },
				{ key: "party_name", label: "Party Name" },
				{ key: "category_name", label: "Category Name" },
				{ key: "type", label: "Type" },
				{ key: "amount", label: "Total", num: true, get: (t) => santu_purchase.utils.format_money(t.amount) },
				{ key: "paid", label: "Received/Paid", num: true, get: (t) => santu_purchase.utils.format_money(t.paid || 0) },
				{ key: "balance", label: "Balance", num: true, get: (t) => santu_purchase.utils.format_money(t.balance || 0) },
			];
		}
		return [];
	},

	render($wrap, transactions, view, callbacks = {}) {
		$wrap.empty();
		const cols = this.get_columns(view);
		const u = santu_purchase.utils;

		const $card = $(`<div class="santu-purchase-txn-card-inner"></div>`).appendTo($wrap);

		const show_inline_search = view === "bills" || view === "purchase_return";
		const $search_panel = $(`
			<div class="santu-purchase-txn-search-panel" style="${show_inline_search ? "" : "display:none;"}">
				<input type="text" class="form-control santu-purchase-txn-search" placeholder="Search transactions...">
			</div>
		`);

		// Pixel-match reference: for "bills" the filter bar above already has
		// its own Excel/Print icons — a second copy here would be a visible
		// duplicate that the reference screenshot doesn't have, so this
		// header stays to just the title for that view.
		const $header = $(`
			<div class="santu-purchase-txn-header">
				<span class="santu-purchase-txn-title">TRANSACTIONS</span>
				<div class="santu-purchase-txn-toolbar">
					${!show_inline_search ? `<button type="button" class="santu-purchase-icon-btn santu-purchase-txn-search-btn" title="Search">🔍</button>` : ""}
					${view !== "bills" ? `<button type="button" class="santu-purchase-icon-btn santu-purchase-txn-export-btn" title="Export">📗</button>
					<button type="button" class="santu-purchase-icon-btn santu-purchase-txn-print-btn" title="Print">🖨</button>` : ""}
				</div>
			</div>
		`).appendTo($card);

		if (show_inline_search) {
			$search_panel.appendTo($card);
		} else {
			$search_panel.appendTo($card);
		}

		$header.find(".santu-purchase-txn-search-btn").on("click", () => {
			$search_panel.slideToggle(150, () => $search_panel.find("input").focus());
		});
		$header.find(".santu-purchase-txn-export-btn").on("click", () => u.export_csv(transactions, view));
		$header.find(".santu-purchase-txn-print-btn").on("click", () => window.print());

		$search_panel.find(".santu-purchase-txn-search").on(
			"input",
			u.debounce((e) => {
				if (callbacks.on_search) callbacks.on_search($(e.target).val());
			})
		);

		if (!transactions.length) {
			this._render_empty($card, view, callbacks.on_add);
			return;
		}

		const $table_wrap = $(`<div class="santu-purchase-txn-table-wrap"><table class="santu-purchase-txn-table"><thead><tr></tr></thead><tbody></tbody></table></div>`).appendTo($card);
		const $thead = $table_wrap.find("thead tr");
		cols.forEach((c) =>
			$thead.append(
				`<th class="${c.num ? "num" : ""}">${c.label}${view === "bills" ? `<span class="santu-purchase-th-filter" aria-hidden="true">▽</span>` : ""}</th>`
			)
		);
		$thead.append(`<th class="num">Actions</th>`);

		const $tbody = $table_wrap.find("tbody");
		transactions.forEach((t, idx) => {
			const $cells = cols.map((c) => {
				const val = c.get ? c.get(t, idx) : frappe.utils.escape_html(t[c.key] || "—");
				return `<td class="${c.num ? "num" : ""}">${typeof val === "string" && val.includes("₹") ? val : frappe.utils.escape_html(String(val))}</td>`;
			});
			const $row = $(`
				<tr class="santu-purchase-txn-row">
					${$cells.join("")}
					<td class="num santu-purchase-row-actions">
						<button type="button" class="santu-purchase-row-btn" title="Open" data-action="open">📄</button>
						<button type="button" class="santu-purchase-row-btn" title="Print" data-action="print">🖨</button>
						${view === "purchase_return" ? `<button type="button" class="santu-purchase-row-btn" title="Share" data-action="share">↗</button>` : ""}
						<button type="button" class="santu-purchase-row-btn" title="More" data-action="more">⋮</button>
					</td>
				</tr>
			`);
			$row.find(".santu-purchase-row-btn").on("click", (e) => {
				e.stopPropagation();
				this._row_action($(e.currentTarget).data("action"), t, view);
			});
			$row.on("click", () => window.santu_open_invoice_view(t.doctype, t.invoice_no));
			$row.appendTo($tbody);
		});
	},

	_render_empty($card, view, on_add) {
		const meta = santu_purchase.VIEWS[view] || {};
		if (view === "purchase_order") {
			$card.append(`
				<div class="santu-purchase-empty santu-purchase-empty-po">
					<div class="santu-purchase-empty-icon">🛒</div>
					<div class="santu-purchase-empty-text">Make &amp; share purchase orders with your parties &amp; convert them to purchase bills instantly.</div>
					<button type="button" class="btn santu-purchase-add-btn santu-purchase-empty-btn santu-purchase-empty-btn-po">Add Your First Purchase Order</button>
				</div>
			`);
		} else if (view === "purchase_return") {
			$card.append(`
				<div class="santu-purchase-empty">
					<div class="santu-purchase-empty-icon">📋</div>
					<div class="santu-purchase-empty-title">No purchase returns yet.</div>
					<div class="santu-purchase-empty-sub">Use this when you send goods back to a supplier and they owe you money.</div>
					<button type="button" class="btn santu-purchase-add-btn santu-purchase-empty-btn">${frappe.utils.escape_html(meta.addLabel || "+ Add")}</button>
				</div>
			`);
		} else if (view === "bills") {
			// Pixel-match reference: plain centered text, no icon/button.
			$card.append(`
				<div class="santu-purchase-empty santu-purchase-empty-plain">No transactions to show</div>
			`);
		} else {
			$card.append(`
				<div class="santu-purchase-empty">
					<div class="santu-purchase-empty-icon">📄</div>
					<div class="santu-purchase-empty-title">No Transactions to show</div>
					<div class="santu-purchase-empty-sub">You haven't added any transactions yet.</div>
					<button type="button" class="btn santu-purchase-add-btn santu-purchase-empty-btn">${frappe.utils.escape_html(meta.addLabel || "+ Add")}</button>
				</div>
			`);
		}
		$card.find(".santu-purchase-empty-btn").on("click", on_add);
	},

	_row_action(action, t, view) {
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
				{ label: __("Open"), action: () => window.santu_open_invoice_view(t.doctype, t.invoice_no) },
				{ label: __("Print"), action: () => this._row_action("print", t, view) },
			];
			if (view === "purchase_order" && t.doctype === "Purchase Order") {
				items.push({
					label: __("Create Purchase Invoice"),
					action: () => {
						// frappe.model.open_mapped_doc({frm: {...}}) needs a REAL
						// form object (calls frm.get_selected() internally) — a
						// plain stub throws "opts.frm.get_selected is not a
						// function" (confirmed live 2026-08-15). Call the
						// mapped-doc method directly and hand the unsaved result
						// to the Purchase Invoice quick-entry screen's own
						// prefill handler instead.
						frappe.call({
							method: "erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice",
							args: { source_name: t.invoice_no },
							freeze: true,
							callback: (r) => {
								if (!r.message) return;
								frappe.route_options = { prefill: r.message };
								frappe.set_route("santu-purchase-invoice");
							},
						});
					},
				});
			}
			items.push({ label: __("Copy Link"), action: () => this._row_action("share", t, view) });
			const d = new frappe.ui.Dialog({ title: t.invoice_no, fields: [{ fieldtype: "HTML", fieldname: "menu" }] });
			const $menu = $(`<div class="santu-purchase-row-menu"></div>`);
			items.forEach((item) => $menu.append(`<button type="button" class="santu-purchase-row-menu-item">${item.label}</button>`));
			d.fields_dict.menu.$wrapper.html($menu);
			$menu.find("button").each(function (idx) {
				$(this).on("click", () => { d.hide(); items[idx].action(); });
			});
			d.show();
		}
	},
};
