/* global frappe, santu_sales_return */
frappe.provide("santu_sales_return");

// Thin wrapper only — customer search, item search/pricing and the Add Party
// dialog all come from santu_sale_invoice.api, which this screen reuses
// verbatim rather than reimplementing.
santu_sales_return.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	returnable_invoices(customer) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_returnable_invoices", { customer });
	},
	invoice_items(invoice) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_items_for_return", { invoice });
	},
	save(ret, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_sales_return", {
			return_json: JSON.stringify(ret),
			submit: submit ? 1 : 0,
		});
	},
};
