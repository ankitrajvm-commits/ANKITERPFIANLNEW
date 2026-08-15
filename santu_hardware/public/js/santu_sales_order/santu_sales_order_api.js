/* global frappe */
frappe.provide("santu_sales_order");

// Customer search, item search, item pricing, and formatting utilities are
// shared verbatim with the Sale Invoice screen (santu_sale_invoice.api) —
// same backend endpoints, same behavior. Only the save call differs
// (Sales Order instead of Sales Invoice/Quotation).
santu_sales_order.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	save(order, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_sales_order", {
			order_json: JSON.stringify(order),
			submit: submit ? 1 : 0,
		});
	},
};
