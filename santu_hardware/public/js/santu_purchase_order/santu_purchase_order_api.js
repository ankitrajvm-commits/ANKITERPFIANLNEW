/* global frappe */
frappe.provide("santu_purchase_order");

// Supplier search, item search/pricing, and formatting utilities are
// shared verbatim with the Purchase Invoice screen
// (santu_purchase_invoice.api) — same backend endpoints, same behavior.
// Only the save call differs (Purchase Order instead of Purchase Invoice).
santu_purchase_order.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_purchase_invoice_init");
	},
	save(order, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_purchase_order", {
			order_json: JSON.stringify(order),
			submit: submit ? 1 : 0,
		});
	},
};
