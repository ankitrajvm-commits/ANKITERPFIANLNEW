/* global frappe */
frappe.provide("santu_estimate");

// Customer search, item search, item pricing, and formatting utilities are
// shared verbatim with the Sale Invoice screen (santu_sale_invoice.api) —
// same backend endpoints, same behavior. Only the save call differs
// (Quotation instead of Sales Invoice), so that's the one thing defined
// here rather than duplicated.
santu_estimate.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	save(quotation, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_quotation", {
			quotation_json: JSON.stringify(quotation),
			submit: submit ? 1 : 0,
		});
	},
};
