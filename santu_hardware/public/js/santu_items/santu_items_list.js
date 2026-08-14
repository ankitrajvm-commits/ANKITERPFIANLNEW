/* global frappe, santu_items */
frappe.provide("santu_items");

santu_items.list = {
	build_row(row) {
		const u = santu_items.utils;
		const qty = row.is_stock_item ? u.format_qty(row.available_qty, row.stock_uom) : "—";
		const qty_class = u.qty_class_for(row);

		return $(`
			<div class="santu-items-row" role="button" tabindex="0" data-code="${frappe.utils.escape_html(row.item_code)}">
				<span class="santu-items-row-name" title="${frappe.utils.escape_html(row.item_name)}">${frappe.utils.escape_html(row.item_name)}</span>
				<span class="santu-items-row-qty santu-figures ${qty_class}">${qty}</span>
			</div>
		`);
	},

	build_category_row(row) {
		return $(`
			<div class="santu-items-row" role="button" tabindex="0">
				<span class="santu-items-row-name">${frappe.utils.escape_html(row.name)}</span>
				<span class="santu-items-row-qty santu-figures">${row.item_count}</span>
			</div>
		`);
	},

	build_unit_row(row) {
		const type_label = row.must_be_whole_number ? "Whole" : "Decimal";
		return $(`
			<div class="santu-items-row" role="button" tabindex="0">
				<span class="santu-items-row-name">${frappe.utils.escape_html(row.uom_name || row.name)}</span>
				<span class="santu-items-row-qty">${type_label}</span>
			</div>
		`);
	},

	set_active($list, code) {
		$list.find(".santu-items-row").removeClass("santu-items-row-active");
		if (code) {
			$list.find(`.santu-items-row[data-code="${CSS.escape(code)}"]`).addClass("santu-items-row-active");
		}
	},

	show_loading($list) {
		$list.html(`<div class="santu-dash-loading">Loading...</div>`);
	},

	show_empty($list, message) {
		$list.html(`<div class="santu-dash-recent-empty">${message}</div>`);
	},
};
