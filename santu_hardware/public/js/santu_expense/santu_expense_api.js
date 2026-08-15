/* global frappe, santu_expense */
frappe.provide("santu_expense");

santu_expense.api = {
	init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_expense_init");
	},
	save(expense, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_expense", {
			expense_json: JSON.stringify(expense),
			submit: submit ? 1 : 0,
		});
	},
};
