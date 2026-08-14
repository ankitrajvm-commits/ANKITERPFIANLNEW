/* global frappe */
frappe.provide("santu_sale_invoice");

santu_sale_invoice.utils = {
	format_money(v) {
		return `₹ ${format_currency(v || 0, "INR").replace(/^\D+/, "")}`;
	},
	debounce(fn, ms = 250) {
		let t;
		return (...a) => {
			clearTimeout(t);
			t = setTimeout(() => fn(...a), ms);
		};
	},
};

santu_sale_invoice.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_invoice_init");
	},
	search_customers(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_customers_by_name", { query: q });
	},
	customer_details(customer) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_customer_details_for_sale", { customer });
	},
	search_items(q) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_products", { query: q, limit: 15 });
	},
	item_row(customer, item_code, warehouse, qty) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_sale_item_row", {
			customer,
			item_code,
			warehouse,
			qty,
		});
	},
	save(invoice, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_sale_invoice", {
			invoice_json: JSON.stringify(invoice),
			submit: submit ? 1 : 0,
		});
	},
};
