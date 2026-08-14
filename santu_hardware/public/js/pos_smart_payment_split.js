// "here only cash option is showing as default, u hav to select if cash
// is 8500 and upi is entered 500 then cash should be 8000 as total
// amount is 8500" (2026-07-30 direct request). Native POS payment UI
// (`pos_payment.js`) auto-fills the default mode (Cash) with the FULL
// grand total the moment it's selected, but typing an amount into a
// second mode (UPI) just adds a second row on top — Cash never reduces,
// so Paid Amount overshoots the grand total instead of the two modes
// splitting it.
//
// Fix: whenever a non-default payment row's amount changes, top the
// default row back down to (grand_total - sum of every other row),
// floored at 0. Registered as an ADDITIONAL "Sales Invoice Payment"/
// "amount" listener (the same child doctype `pos_payment.js` itself
// listens on for loyalty-redemption sync, confirmed via
// `POS Invoice.payments` field options) — `frappe.ui.form.on` appends
// listeners rather than replacing them, so this runs alongside core
// without patching it. Guarded so editing the default row itself (or a
// programmatic top-up from this same handler) never recurses.
(function () {
	frappe.ui.form.on("Sales Invoice Payment", "amount", function (frm, cdt, cdn) {
		if (!["POS Invoice", "Sales Invoice"].includes(frm.doc.doctype)) return;
		if (frm.__santu_splitting_payment) return;

		const payments = frm.doc.payments || [];
		if (payments.length < 2) return;

		const changed_row = locals[cdt][cdn];
		const default_row = payments.find((p) => p.default && p.name !== changed_row.name);
		if (!default_row) return;

		const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
			? frm.doc.grand_total
			: frm.doc.rounded_total;

		const other_total = payments
			.filter((p) => p.name !== default_row.name)
			.reduce((sum, p) => sum + flt(p.amount), 0);

		const new_default_amount = flt(Math.max(0, flt(grand_total) - other_total));

		if (flt(default_row.amount) !== new_default_amount) {
			frm.__santu_splitting_payment = true;
			frappe.model
				.set_value(default_row.doctype, default_row.name, "amount", new_default_amount)
				.then(() => {
					frm.__santu_splitting_payment = false;
					if (window.cur_pos && cur_pos.payment) {
						cur_pos.payment.render_payment_mode_dom();
					}
				});
		}
	});
})();
