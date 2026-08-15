/* global frappe, santu_items */
frappe.provide("santu_items");

santu_items.transactions = {
	filter_rows({ txns, type_filter, search }) {
		return txns.filter((t) => {
			if (type_filter) {
				if (type_filter === "Stock") {
					if (t.type === "Purchase" || t.type === "Sale") return false;
				} else if (t.type !== type_filter) {
					return false;
				}
			}
			if (search) {
				const hay = [t.type, t.invoice_no, t.party_name, t.status, t.txn_date]
					.map((v) => String(v || "").toLowerCase())
					.join(" ");
				if (!hay.includes(search)) return false;
			}
			return true;
		});
	},

	sort_rows(rows, sort_key, sort_dir) {
		const dir = sort_dir === "asc" ? 1 : -1;
		return [...rows].sort((a, b) => {
			let av = a[sort_key];
			let bv = b[sort_key];
			if (sort_key === "txn_date") {
				av = av || "";
				bv = bv || "";
				return av < bv ? -dir : av > bv ? dir : 0;
			}
			if (sort_key === "quantity" || sort_key === "rate") {
				av = parseFloat(av) || 0;
				bv = parseFloat(bv) || 0;
				return av < bv ? -dir : av > bv ? dir : 0;
			}
			av = String(av || "").toLowerCase();
			bv = String(bv || "").toLowerCase();
			return av < bv ? -dir : av > bv ? dir : 0;
		});
	},

	render($wrap, txns, item, { on_sort, sort_key, sort_dir } = {}) {
		$wrap.empty();
		if (!txns.length) {
			$wrap.html(`<div class="santu-dash-recent-empty">No transactions yet.</div>`);
			return;
		}

		const u = santu_items.utils;
		const sort_icon = (key) => {
			const active = sort_key === key ? " is-active" : "";
			return `<span class="santu-items-col-filter${active}">▾</span>`;
		};

		const $table = $(`
			<table class="santu-items-txn-table">
				<thead>
					<tr>
						<th data-sort="type" class="sortable">TYPE ${sort_icon("type")}</th>
						<th data-sort="invoice_no">INVOICE/REF. NO.</th>
						<th data-sort="party_name" class="sortable">NAME ${sort_icon("party_name")}</th>
						<th data-sort="txn_date" class="sortable">DATE ${sort_icon("txn_date")}</th>
						<th data-sort="quantity" class="num sortable">QUANTITY ${sort_icon("quantity")}</th>
						<th data-sort="rate" class="num sortable">PRICE/UNIT ${sort_icon("rate")}</th>
						<th data-sort="status" class="sortable">STATUS ${sort_icon("status")}</th>
						<th class="santu-items-txn-kebab-col"></th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);

		if (on_sort) {
			$table.find("th.sortable").on("click", function () {
				on_sort($(this).data("sort"));
			});
		}

		const $tbody = $table.find("tbody");
		txns.forEach((t) => {
			const rate = t.rate ? u.format_money(t.rate) : "—";
			const status_class =
				t.status === "Unpaid"
					? "santu-items-status-unpaid"
					: t.status === "Paid"
						? "santu-items-status-paid"
						: "santu-items-status-done";
			const type_dot = t.type === "Sale" ? "santu-items-type-sale" : t.type === "Purchase" ? "santu-items-type-purchase" : "santu-items-type-other";
			$(`
				<tr class="santu-items-txn-row">
					<td><span class="santu-items-type-dot ${type_dot}"></span>${frappe.utils.escape_html(t.type)}</td>
					<td>${frappe.utils.escape_html(t.invoice_no)}</td>
					<td>${frappe.utils.escape_html(t.party_name || "—")}</td>
					<td>${frappe.datetime.str_to_user(t.txn_date)}</td>
					<td class="num santu-figures">${u.format_qty_short(t.quantity)}</td>
					<td class="num santu-figures">${rate}</td>
					<td class="${status_class}">${frappe.utils.escape_html(t.status)}</td>
					<td class="santu-items-txn-kebab-col"><button type="button" class="santu-items-row-menu" title="More">⋮</button></td>
				</tr>
			`)
				.on("click", () => window.santu_open_invoice_view(t.doctype, t.invoice_no))
				.appendTo($tbody);
		});

		$wrap.append($table);
	},
};
