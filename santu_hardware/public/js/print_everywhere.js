// Phase 5, "Print Button Everywhere" — a one-click thermal print button
// on the Desk form itself (not just the POS screen), for whenever a bill
// is reopened later rather than printed right after the sale. Reuses
// the same QZ Tray plumbing `thermal_print.js` already built.
//
// Scoped to Sales Invoice and POS Invoice only — those are the two
// doctypes with a Santu Hardware thermal print format designed for them
// (`Santu Hardware Thermal Bill(...)`). Purchase Invoice and Quotation
// don't have one yet — a supplier-facing purchase print and a
// quotation/estimate print are different content (no "Paid"/QR-to-pay
// section makes sense on either), not just a doctype swap on the
// existing bill format, so rolling this out further needs those two
// designed first rather than pointing them at the wrong template.
frappe.ui.form.on("Sales Invoice", {
	refresh(frm) {
		santu_add_thermal_print_button(frm);
	},
});
frappe.ui.form.on("POS Invoice", {
	refresh(frm) {
		santu_add_thermal_print_button(frm);
	},
});

function santu_add_thermal_print_button(frm) {
	if (frm.doc.docstatus !== 1) return;
	frm.add_custom_button(__("Print (Thermal)"), () => {
		santu_print_thermal_bill(frm.doctype, frm.doc.name);
	});
}
