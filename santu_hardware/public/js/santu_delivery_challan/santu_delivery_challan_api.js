/* global frappe, santu_delivery_challan */
frappe.provide("santu_delivery_challan");

// Thin wrapper only — customer search, item search/pricing and the Add Party
// dialog all come from santu_sale_invoice.api, which this screen reuses
// verbatim rather than reimplementing (same approach as the Sales Order and
// Purchase Order screens).
santu_delivery_challan.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	save(challan, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_delivery_note", {
			challan_json: JSON.stringify(challan),
			submit: submit ? 1 : 0,
		});
	},
};
