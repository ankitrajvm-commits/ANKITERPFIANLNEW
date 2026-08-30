frappe.pages["santu-customer-dues"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Customer Dues",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_customer_dues(page);
};

function render_customer_dues(page) {
	const $root = $(`<div class="santu-dues"></div>`).appendTo(page.body);

	$root.html(`
		<div class="santu-dues-filters">
			<input type="text" class="form-control santu-dues-search" placeholder="Search by name...">
			<select class="form-control santu-dues-village">
				<option value="">All Villages</option>
			</select>
			<button type="button" class="btn btn-sm btn-primary santu-dues-add-btn">+ Baki Jodein</button>
		</div>
		<div class="santu-dues-summary"></div>
		<div class="santu-dues-list"></div>
	`);

	const $search = $root.find(".santu-dues-search");
	const $village = $root.find(".santu-dues-village");

	const reload = () => load_dues($root, $search.val(), $village.val());

	let debounce;
	$search.on("input", () => {
		clearTimeout(debounce);
		debounce = setTimeout(reload, 300);
	});
	$village.on("change", reload);
	$root.find(".santu-dues-add-btn").on("click", () => open_add_due_dialog(reload));

	populate_village_filter($village);
	reload();
}

function open_add_due_dialog(on_done) {
	const d = new frappe.ui.Dialog({
		title: __("Baki Jodein — Add Due"),
		fields: [
			{
				fieldtype: "Link",
				fieldname: "customer",
				label: __("Customer"),
				options: "Customer",
				reqd: 1,
			},
			{
				fieldtype: "Currency",
				fieldname: "amount",
				label: __("Kitna Baki Jodna Hai?"),
				reqd: 1,
			},
			{
				fieldtype: "Small Text",
				fieldname: "note",
				label: __("Note (optional)"),
				description: __("e.g. purana udhaar, loan, etc."),
			},
		],
		primary_action_label: __("Add Due"),
		primary_action: (values) => {
			d.set_df_property("customer", "read_only", 1);
			d.get_primary_btn().prop("disabled", true);
			frappe
				.xcall("santu_hardware.santu_hardware.api.add_manual_due", {
					customer: values.customer,
					amount: values.amount,
					note: values.note || null,
				})
				.then(() => {
					d.hide();
					frappe.show_alert({ message: __("Baki add ho gaya."), indicator: "green" });
					if (on_done) on_done();
				})
				.catch(() => {
					d.set_df_property("customer", "read_only", 0);
					d.get_primary_btn().prop("disabled", false);
				});
		},
	});
	d.show();
}

async function populate_village_filter($village) {
	const villages = await frappe.db.get_list("Customer", {
		fields: ["santu_village"],
		filters: [["santu_village", "is", "set"]],
		limit: 500,
	});
	const unique = [...new Set(villages.map((v) => v.santu_village).filter(Boolean))].sort();
	unique.forEach((v) => $village.append(`<option value="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</option>`));
}

async function load_dues($root, search, village) {
	const $list = $root.find(".santu-dues-list");
	const $summary = $root.find(".santu-dues-summary");
	$list.html(`<div class="santu-dash-loading">Loading...</div>`);

	const rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_customer_dues", {
		search: search || null,
		village: village || null,
	});

	const total = rows.reduce((sum, r) => sum + r.total_due, 0);
	$summary.html(`
		<div class="santu-dues-summary-card">
			<div class="santu-dues-summary-label">${rows.length} customer${rows.length === 1 ? "" : "s"} with dues</div>
			<div class="santu-dues-summary-amount">₹ ${format_currency_plain(total)}</div>
		</div>
	`);

	$list.empty();
	if (!rows.length) {
		$list.append(`<div class="santu-dash-recent-empty">No outstanding dues${search || village ? " for this search" : ""}.</div>`);
		return;
	}

	rows.forEach((row) => {
		const $row = $(`
			<div class="santu-dues-row" role="button" tabindex="0">
				<div class="santu-dues-row-main">
					<div class="santu-dues-row-name">${frappe.utils.escape_html(row.customer_name)}</div>
					<div class="santu-dues-row-meta">
						${row.village ? frappe.utils.escape_html(row.village) : "No village on file"}
						${row.mobile_no ? " &middot; " + frappe.utils.escape_html(row.mobile_no) : ""}
					</div>
				</div>
				<div class="santu-dues-row-amount">₹ ${format_currency_plain(row.total_due)}</div>
				<button type="button" class="btn btn-xs btn-primary santu-dues-collect-btn">Collect Payment</button>
			</div>
		`);
		$row.find(".santu-dues-collect-btn").on("click", (e) => {
			e.stopPropagation();
			window.santu_open_collect_payment({
				party_type: "Customer",
				party: row.customer,
				amount: row.total_due,
			});
		});
		$row.on("click", () => show_customer_bills(row));
		$row.appendTo($list);
	});
}

async function show_customer_bills(row) {
	const d = new frappe.ui.Dialog({
		title: __("{0} — All Bills", [row.customer_name]),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "bills" }],
	});
	d.show();
	d.fields_dict.bills.$wrapper.html(`<div class="santu-dash-loading">Loading...</div>`);

	const bills = await frappe.xcall("santu_hardware.santu_hardware.api.get_customer_all_bills", {
		customer: row.customer,
	});

	if (!bills.length) {
		d.fields_dict.bills.$wrapper.html(`<div class="santu-dash-recent-empty">No bills found.</div>`);
		return;
	}

	const $table = $(`
		<table class="santu-dues-bills-table">
			<thead>
				<tr><th>Bill</th><th>Date</th><th>Items</th><th class="num">Amount</th><th class="num">Due</th><th>Status</th></tr>
			</thead>
			<tbody></tbody>
		</table>
	`);
	const $tbody = $table.find("tbody");
	bills.forEach((b) => {
		$(`
			<tr class="santu-dues-bill-row">
				<td>${frappe.utils.escape_html(b.name)}</td>
				<td>${frappe.datetime.str_to_user(b.posting_date)}</td>
				<td class="santu-dues-bill-items">${frappe.utils.escape_html(b.items_summary || "—")}</td>
				<td class="num">₹ ${format_currency_plain(b.grand_total)}</td>
				<td class="num">${b.outstanding_amount > 0 ? "₹ " + format_currency_plain(b.outstanding_amount) : "-"}</td>
				<td><span class="indicator-pill ${b.outstanding_amount > 0 ? "orange" : "green"}">${frappe.utils.escape_html(b.status)}</span></td>
			</tr>
		`)
			.on("click", () => window.santu_open_invoice_view(b.doctype, b.name))
			.appendTo($tbody);
	});
	d.fields_dict.bills.$wrapper.empty().append($table);
}

function format_currency_plain(value) {
	return format_currency(value, "INR").replace(/^\D+/, "");
}
