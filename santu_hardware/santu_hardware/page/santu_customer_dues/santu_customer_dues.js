frappe.pages["santu-customer-dues"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Dues",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_customer_dues(page);
};

function render_customer_dues(page) {
	const $root = $(`<div class="santu-dues"></div>`).appendTo(page.body);
	// party_type toggle -- "kis party ko mujhe kitna paisa dena hai" (2026-
	// 09-03 direct request): the payable side never had a screen of its
	// own before, only the receivable (Customer) one. Same page, same list
	// markup, just pointed at the Supplier API/fields when toggled.
	const state = { party_type: "Customer" };

	$root.html(`
		<div class="santu-dues-tabs">
			<button type="button" class="btn btn-sm santu-dues-tab" data-party-type="Customer">${__("Customers owe me")}</button>
			<button type="button" class="btn btn-sm santu-dues-tab" data-party-type="Supplier">${__("I owe suppliers")}</button>
		</div>
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
	const $tabs = $root.find(".santu-dues-tab");

	const reload = () => load_dues($root, state.party_type, $search.val(), $village.val());

	let debounce;
	$search.on("input", () => {
		clearTimeout(debounce);
		debounce = setTimeout(reload, 300);
	});
	$village.on("change", reload);
	$root.find(".santu-dues-add-btn").on("click", () => open_add_due_dialog(reload));

	$tabs.on("click", function () {
		const party_type = $(this).data("party-type");
		if (party_type === state.party_type) return;
		state.party_type = party_type;
		$tabs.toggleClass("is-active", false);
		$(this).toggleClass("is-active", true);
		// Village is a Customer-only concept (a Supplier has no linked
		// village field in this app) -- hide it rather than show a filter
		// that would silently do nothing.
		$root.find(".santu-dues-village").toggle(party_type === "Customer");
		$root.find(".santu-dues-add-btn").toggle(party_type === "Customer");
		$search.val("");
		$village.val("");
		reload();
	});
	$tabs.filter('[data-party-type="Customer"]').addClass("is-active");

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
	// santu_village stopped being written to on 2026-08-27 (address-only
	// now) — reading it straight off Customer here missed every customer
	// added since, so their village never showed up as a filter option even
	// though get_customer_due_villages() (and the row itself) can see it
	// fine via the linked Address.
	const villages = await frappe.xcall("santu_hardware.santu_hardware.api.get_customer_due_villages");
	(villages || []).forEach((v) => $village.append(`<option value="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</option>`));
}

async function load_dues($root, party_type, search, village) {
	const is_supplier = party_type === "Supplier";
	const $list = $root.find(".santu-dues-list");
	const $summary = $root.find(".santu-dues-summary");
	$list.html(`<div class="santu-dash-loading">Loading...</div>`);

	const rows = await frappe.xcall(
		is_supplier
			? "santu_hardware.santu_hardware.api.get_supplier_dues"
			: "santu_hardware.santu_hardware.api.get_customer_dues",
		is_supplier ? { search: search || null } : { search: search || null, village: village || null }
	);

	const total = rows.reduce((sum, r) => sum + r.total_due, 0);
	const noun = is_supplier ? "supplier" : "customer";
	$summary.html(`
		<div class="santu-dues-summary-card">
			<div class="santu-dues-summary-label">${rows.length} ${noun}${rows.length === 1 ? "" : "s"} with dues</div>
			<div class="santu-dues-summary-amount">₹ ${format_currency_plain(total)}</div>
		</div>
	`);

	$list.empty();
	if (!rows.length) {
		$list.append(`<div class="santu-dash-recent-empty">No outstanding dues${search || village ? " for this search" : ""}.</div>`);
		return;
	}

	const today = frappe.datetime.get_today();
	rows.forEach((row) => {
		const party_name = is_supplier ? row.supplier_name : row.customer_name;
		const party = is_supplier ? row.supplier : row.customer;
		// "kis date ko kaun sa payment dena/lena hai" (2026-09-03): the
		// earliest still-unpaid bill's due date, flagged red once it's
		// past today.
		const due_html = row.earliest_due_date
			? `<span class="santu-dues-due ${row.earliest_due_date < today ? "is-overdue" : ""}">${
					row.earliest_due_date < today ? __("Overdue since") : __("Due by")
				} ${frappe.datetime.str_to_user(row.earliest_due_date)}</span>`
			: "";
		const $row = $(`
			<div class="santu-dues-row" role="button" tabindex="0">
				<div class="santu-dues-row-main">
					<div class="santu-dues-row-top">
						<div class="santu-dues-row-name">${frappe.utils.escape_html(party_name)}</div>
						<div class="santu-dues-row-amount">₹ ${format_currency_plain(row.total_due)}</div>
					</div>
					<div class="santu-dues-row-bottom">
						<div class="santu-dues-row-meta">
							${is_supplier ? "" : row.village ? frappe.utils.escape_html(row.village) : "No village on file"}
							${row.mobile_no ? " &middot; " + frappe.utils.escape_html(row.mobile_no) : ""}
							${due_html}
						</div>
						<button type="button" class="btn btn-xs btn-primary santu-dues-collect-btn">${is_supplier ? __("Payment Out") : __("Collect Payment")}</button>
					</div>
				</div>
			</div>
		`);
		$row.find(".santu-dues-collect-btn").on("click", (e) => {
			e.stopPropagation();
			window.santu_open_collect_payment({
				party_type,
				party,
				amount: row.total_due,
			});
		});
		$row.on("click", () => show_party_bills(party_type, party, party_name));
		$row.appendTo($list);
	});
}

async function show_party_bills(party_type, party, party_name) {
	const is_supplier = party_type === "Supplier";
	const d = new frappe.ui.Dialog({
		title: __("{0} — All Bills", [party_name]),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "bills" }],
	});
	d.show();
	d.fields_dict.bills.$wrapper.html(`<div class="santu-dash-loading">Loading...</div>`);

	const bills = await frappe.xcall(
		is_supplier
			? "santu_hardware.santu_hardware.api.get_supplier_all_bills"
			: "santu_hardware.santu_hardware.api.get_customer_all_bills",
		is_supplier ? { supplier: party } : { customer: party }
	);

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
		// One item per line, price right next to its own name — same as the
		// Sale screen's rows (2026-09-03 direct request: "jitne v item aahi
		// un sab ke naam ke aage hi item price likhe, jaisa sale me hota
		// hai, eksaath naa likhe"). Was one truncated comma-joined string
		// with no price at all.
		const items_html = (b.items || []).length
			? (b.items || [])
					.map(
						(it) =>
							`<div class="santu-dues-bill-item-row">
								<span>${frappe.utils.escape_html(it.item_name)} × ${it.qty}</span>
								<span class="santu-dues-bill-item-rate">₹ ${format_currency_plain(it.rate)}</span>
							</div>`
					)
					.join("")
			: "—";
		$(`
			<tr class="santu-dues-bill-row">
				<td>${frappe.utils.escape_html(b.display_number || b.name)}</td>
				<td>${frappe.datetime.str_to_user(b.posting_date)}</td>
				<td class="santu-dues-bill-items">${items_html}</td>
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
