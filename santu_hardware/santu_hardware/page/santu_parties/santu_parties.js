frappe.pages["santu-parties"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Parties",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_parties(page);
};

function render_parties(page) {
	const $root = $(`
		<div class="santu-parties">
			<div class="santu-parties-list-panel">
				<input type="text" class="form-control santu-parties-search" placeholder="Search Party Name">
				<div class="santu-parties-list"></div>
			</div>
			<div class="santu-parties-detail-panel">
				<div class="santu-parties-empty">Select a party to see details.</div>
			</div>
		</div>
	`).appendTo(page.body);

	const $search = $root.find(".santu-parties-search");
	const $list = $root.find(".santu-parties-list");
	const $detail = $root.find(".santu-parties-detail-panel");

	let selected_key = null;

	const reload_list = () => load_parties($list, $search.val(), (row, $row) => {
		selected_key = `${row.party_type}:${row.party}`;
		$list.find(".santu-parties-row").removeClass("santu-parties-row-active");
		$row.addClass("santu-parties-row-active");
		load_party_detail($detail, row);
	});

	let debounce;
	$search.on("input", () => {
		clearTimeout(debounce);
		debounce = setTimeout(reload_list, 250);
	});

	reload_list();
}

async function load_parties($list, search, on_select) {
	$list.html(`<div class="santu-dash-loading">Loading...</div>`);
	const rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_parties_list", {
		search: search || null,
	});

	$list.empty();
	if (!rows.length) {
		$list.append(`<div class="santu-dash-recent-empty">No parties found.</div>`);
		return;
	}

	rows.forEach((row) => {
		const tone = row.amount > 0 ? (row.party_type === "Customer" ? "warning" : "danger") : "";
		const $row = $(`
			<div class="santu-parties-row" role="button" tabindex="0">
				<span class="santu-parties-row-name">${frappe.utils.escape_html(row.party_name)}</span>
				<span class="santu-parties-row-amount santu-figures ${tone ? "santu-tone-" + tone : ""}">${format_currency_plain(row.amount || 0)}</span>
			</div>
		`)
			.on("click", () => on_select(row, $row))
			.appendTo($list);
	});
}

async function load_party_detail($detail, row) {
	$detail.html(`<div class="santu-dash-loading">Loading...</div>`);

	const bills = await frappe.xcall("santu_hardware.santu_hardware.api.get_party_transactions", {
		party_type: row.party_type,
		party: row.party,
	});

	$detail.html(`
		<div class="santu-parties-detail-head">
			<div class="santu-parties-detail-name">${frappe.utils.escape_html(row.party_name)}</div>
			<span class="santu-parties-detail-type">${row.party_type}</span>
		</div>
		<div class="santu-parties-detail-section-title">Transactions</div>
		<div class="santu-parties-bills"></div>
	`);

	const $bills = $detail.find(".santu-parties-bills");

	if (!bills.length) {
		$bills.append(`<div class="santu-dash-recent-empty">No transactions yet.</div>`);
		return;
	}

	const $table = $(`
		<table class="santu-parties-table">
			<thead>
				<tr><th>Type</th><th>Number</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th></tr>
			</thead>
			<tbody></tbody>
		</table>
	`);
	const $tbody = $table.find("tbody");

	bills.forEach((b) => {
		$(`
			<tr class="santu-parties-bill-row">
				<td>${b.type}</td>
				<td>${frappe.utils.escape_html(b.name)}</td>
				<td>${frappe.datetime.str_to_user(b.posting_date)}</td>
				<td class="num">₹ ${format_currency_plain(b.grand_total)}</td>
				<td class="num">${b.outstanding_amount > 0 ? "₹ " + format_currency_plain(b.outstanding_amount) : "-"}</td>
			</tr>
		`)
			.on("click", () => {
				const doctype = row.party_type === "Customer" ? (b.name.startsWith("ACC-PSINV") ? "POS Invoice" : "Sales Invoice") : "Purchase Invoice";
				frappe.set_route("Form", doctype, b.name);
			})
			.appendTo($tbody);
	});

	$bills.append($table);
}

function format_currency_plain(value) {
	return format_currency(value, "INR").replace(/^\D+/, "");
}
