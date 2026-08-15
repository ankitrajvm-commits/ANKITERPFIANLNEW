// Vyapar-style Cash & Bank balances (2026-08-15 direct request: "Chart of
// Accounts me kya kaam h? use acche se dekho" — the native Chart of Accounts
// is the full double-entry ledger tree; Vyapar itself never shows a shop
// owner that, just Cash/Bank balances — so this replaces the "Chart of
// Accounts" shortcut with a Parties-style split view of just those
// balances). Reuses the santu-parties-* CSS classes directly — same
// list-left/detail-right layout, no separate stylesheet.
frappe.pages["santu-cash-bank"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Cash & Bank",
		single_column: true,
	});
	$(page.wrapper).find(".page-head .page-actions").hide();
	render_cash_bank(page);
};

function render_cash_bank(page) {
	const $root = $(`
		<div class="santu-parties">
			<div class="santu-parties-list-panel">
				<div class="santu-cashbank-total"></div>
				<div class="santu-parties-list santu-cashbank-list"></div>
			</div>
			<div class="santu-parties-detail-panel">
				<div class="santu-parties-empty">Select an account to see its statement.</div>
			</div>
		</div>
	`).appendTo(page.body);

	const $total = $root.find(".santu-cashbank-total");
	const $list = $root.find(".santu-cashbank-list");
	const $detail = $root.find(".santu-parties-detail-panel");

	load_accounts($total, $list, (row, $row) => {
		$list.find(".santu-parties-row").removeClass("santu-parties-row-active");
		$row.addClass("santu-parties-row-active");
		load_ledger($detail, row);
	});
}

async function load_accounts($total, $list, on_select) {
	$list.html(`<div class="santu-dash-loading">Loading...</div>`);
	const data = await frappe.xcall("santu_hardware.santu_hardware.api.get_cash_bank_accounts");

	$total.html(`
		<div class="santu-cashbank-total-card">
			<div class="santu-cashbank-total-label">Total Cash &amp; Bank Balance</div>
			<div class="santu-cashbank-total-amount santu-figures">${format_currency_plain(data.total || 0)}</div>
		</div>
	`);

	$list.empty();
	if (!data.accounts.length) {
		$list.append(`<div class="santu-dash-recent-empty">No Cash/Bank accounts found.</div>`);
		return;
	}

	data.accounts.forEach((row, idx) => {
		const tone = row.balance < 0 ? "danger" : "";
		const $row = $(`
			<div class="santu-parties-row" role="button" tabindex="0">
				<span class="santu-parties-row-name">${frappe.utils.escape_html(row.account_name)}
					<span class="santu-cashbank-type-pill">${frappe.utils.escape_html(row.account_type)}</span>
				</span>
				<span class="santu-parties-row-amount santu-figures ${tone ? "santu-tone-" + tone : ""}">${format_currency_plain(row.balance || 0)}</span>
			</div>
		`)
			.on("click", () => on_select(row, $row))
			.appendTo($list);
		if (idx === 0) $row.trigger("click");
	});
}

async function load_ledger($detail, row) {
	$detail.html(`<div class="santu-dash-loading">Loading...</div>`);

	const entries = await frappe.xcall("santu_hardware.santu_hardware.api.get_account_ledger", {
		account: row.account,
	});

	$detail.html(`
		<div class="santu-parties-detail-head">
			<div class="santu-parties-detail-name">${frappe.utils.escape_html(row.account_name)}</div>
			<span class="santu-parties-detail-type">${frappe.utils.escape_html(row.account_type)}</span>
		</div>
		<div class="santu-parties-detail-section-title">Recent Entries</div>
		<div class="santu-parties-bills"></div>
	`);

	const $bills = $detail.find(".santu-parties-bills");

	if (!entries.length) {
		$bills.append(`<div class="santu-dash-recent-empty">No transactions yet.</div>`);
		return;
	}

	const $table = $(`
		<table class="santu-parties-table">
			<thead>
				<tr><th>Date</th><th>Type</th><th>Number</th><th>Against</th><th class="num">Debit</th><th class="num">Credit</th></tr>
			</thead>
			<tbody></tbody>
		</table>
	`);
	const $tbody = $table.find("tbody");

	entries.forEach((e) => {
		$(`
			<tr class="santu-parties-bill-row">
				<td>${frappe.datetime.str_to_user(e.posting_date)}</td>
				<td>${frappe.utils.escape_html(e.voucher_type)}</td>
				<td>${frappe.utils.escape_html(e.voucher_no)}</td>
				<td class="santu-parties-bill-items">${frappe.utils.escape_html(e.party || e.against || "—")}</td>
				<td class="num">${e.debit ? "₹ " + format_currency_plain(e.debit) : "-"}</td>
				<td class="num">${e.credit ? "₹ " + format_currency_plain(e.credit) : "-"}</td>
			</tr>
		`)
			.on("click", () => window.santu_open_invoice_view ? window.santu_open_invoice_view(e.voucher_type, e.voucher_no) : frappe.set_route("Form", e.voucher_type, e.voucher_no))
			.appendTo($tbody);
	});

	$bills.append($table);
}

function format_currency_plain(value) {
	return format_currency(value, "INR").replace(/^\D+/, "");
}
