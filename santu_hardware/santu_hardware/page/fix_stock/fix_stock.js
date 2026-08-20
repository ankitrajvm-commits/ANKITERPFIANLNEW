// UX_STRATEGY.md SS4.5: "we broke two of these" shouldn't require opening
// ERPNext's full multi-item Stock Reconciliation form. A frappe.ui.Dialog
// gives native Link-field autocomplete and validation for free — reusing
// it here instead of hand-building a custom item search control.
frappe.pages["fix-stock"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Fix Stock",
		single_column: true,
	});
	$(page.wrapper).find(".page-head .page-actions").hide();

	$(`<div class="santu-fix-stock-intro">
		<p>Pick an item, enter what the shelf actually has, and why. This
		corrects the stock count directly — it's not a purchase or a sale.</p>
	</div>`).appendTo(page.body);

	page.set_primary_action("Fix an Item's Stock", () => open_fix_stock_dialog());

	open_fix_stock_dialog();
};

function open_fix_stock_dialog() {
	const dialog = new frappe.ui.Dialog({
		title: "Fix Stock",
		fields: [
			{
				fieldtype: "Link",
				fieldname: "item_code",
				label: "Item",
				options: "Item",
				reqd: 1,
				get_query: () => ({ filters: { disabled: 0 } }),
				onchange: () => update_current_stock(dialog),
			},
			{
				fieldtype: "Data",
				fieldname: "current_qty",
				label: "Current Stock (system)",
				read_only: 1,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Float",
				fieldname: "new_qty",
				label: "Actual Quantity (what's really on the shelf)",
				reqd: 1,
			},
			{
				fieldtype: "Select",
				fieldname: "reason",
				label: "Reason",
				options: "\nDamage\nTheft\nCount Correction\nOther",
				reqd: 1,
			},
		],
		primary_action_label: "Save Correction",
		primary_action: (values) => {
			frappe.call({
				method: "santu_hardware.santu_hardware.api.fix_stock",
				args: values,
				freeze: true,
				freeze_message: "Saving...",
				callback: () => {
					frappe.show_alert({ message: "Stock corrected", indicator: "green" });
					dialog.hide();
				},
			});
		},
	});

	dialog.show();
}

function update_current_stock(dialog) {
	const item_code = dialog.get_value("item_code");
	if (!item_code) {
		dialog.set_value("current_qty", "");
		return;
	}
	// get_stock_balance needs a specific warehouse. Ask which one the shop
	// sells out of — picking "the first warehouse" would show the old shop's
	// stock here the moment a second warehouse exists, and this dialog is
	// used to *correct* stock, so a wrong number does real damage.
	frappe.xcall("santu_hardware.santu_hardware.api.get_default_selling_warehouse").then((warehouse) => {
		if (!warehouse) return;
		frappe.call({
			method: "erpnext.stock.utils.get_stock_balance",
			args: { item_code, warehouse },
			callback: (r) => {
				dialog.set_value("current_qty", r.message != null ? String(r.message) : "0");
			},
		});
	});
}
