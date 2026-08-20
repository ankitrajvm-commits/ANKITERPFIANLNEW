/* global santu_utilities */
frappe.provide("santu_utilities");

santu_utilities.VIEWS = {
	import_items: { title: "Import Items", label: "Import Items" },
	shop_profile: { title: "Shop Profile", label: "Shop Profile" },
	accountant_access: { title: "Accountant Access", label: "Accountant Access" },
	barcode_generator: { title: "Barcode Generator", label: "Barcode Generator" },
	bulk_update: { title: "Update Items In Bulk", label: "Update Items In Bulk" },
	import_parties: { title: "Import Parties", label: "Import Parties" },
	track_salesmen: { title: "Track Your Salesmen", label: "Track Your Salesmen" },
	export_tally: { title: "Exports To Tally", label: "Exports To Tally" },
	export_items: { title: "Export Items", label: "Export Items" },
	printer_settings: { title: "Printer Settings", label: "Printer Settings" },
	invoice_settings: { title: "Invoice Settings", label: "Invoice Settings" },
	verify_data: { title: "Verify My Data", label: "Verify My Data" },
	close_fy: { title: "Close Financial Year", label: "Close Financial Year" },
};

santu_utilities.ITEM_FIELDS = [
	{ key: "item_name", label: "Item Name" },
	{ key: "item_code", label: "Item Code" },
	{ key: "item_group", label: "Item Group" },
	{ key: "brand", label: "Brand" },
	{ key: "hsn_code", label: "HSN Code" },
	{ key: "description", label: "Description" },
	{ key: "standard_rate", label: "Selling Price" },
	{ key: "valuation_rate", label: "Purchase Price" },
	{ key: "stock_uom", label: "Stock UOM" },
	{ key: "opening_stock", label: "Opening Stock" },
	{ key: "min_order_qty", label: "Minimum Stock" },
	{ key: "barcode", label: "Barcode" },
];

santu_utilities.LABEL_LINE_OPTIONS = [
	"Item Code", "Item Name", "Sale Price", "MRP", "HSN", "GST", "Brand", "Batch", "UOM",
];

santu_utilities.utils = {
	get_view() {
		return (
			(frappe.route_options && frappe.route_options.view) ||
			sessionStorage.getItem("santu_utilities_view") ||
			"import_items"
		);
	},
	format_currency(val) {
		return frappe.format(val, { fieldtype: "Currency" });
	},
	debounce(fn, ms = 300) {
		let t;
		return (...args) => {
			clearTimeout(t);
			t = setTimeout(() => fn(...args), ms);
		};
	},
	download_csv(filename, rows) {
		const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = filename;
		link.click();
	},
};
