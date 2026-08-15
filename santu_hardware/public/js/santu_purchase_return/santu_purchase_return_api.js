/* global frappe, santu_purchase_return */
frappe.provide("santu_purchase_return");

santu_purchase_return.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_invoice_init");
	},
	returnable_invoices(supplier) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_returnable_purchase_bills", { supplier });
	},
	invoice_items(invoice) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_items_for_return", { invoice });
	},
	save(ret, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_purchase_return", {
			return_json: JSON.stringify(ret),
			submit: submit ? 1 : 0,
		});
	},
};
