// "I don't want this GST anywhere in the bill" (2026-07-30 direct
// request, live screenshot of SGST/CGST still showing in the cart).
// The earlier `included_in_print_rate` fix (same day, earlier) kept the
// grand total correct but still showed the tax split — this removes
// the split entirely.
//
// The server-side `strip_gst_line_items` doc_event (api.py,
// `before_validate`/`validate`) only fires on save/submit — it does
// nothing for the LIVE cart total shown while a sale is still being
// built, which is calculated purely client-side by
// `erpnext.taxes_and_totals` (`taxes_and_totals.js`), reading whatever
// tax rows india_compliance's own logic already populated onto
// `frm.doc.taxes` earlier (independent of any doc_event). Confirmed
// live: without this patch, the cart still showed "SGST @ 9% / CGST @
// 9%" the instant an item was added, before any save happened.
//
// Wrapping the shared `calculate_taxes_and_totals` method (a class on
// `erpnext.taxes_and_totals`, not a per-doctype override point) and
// clearing `taxes` immediately before every recalculation is the one
// choke point that catches every path that adds a tax row — item add,
// qty change, customer change — without needing to find and patch each
// one individually.
(function () {
	if (!window.erpnext || !erpnext.taxes_and_totals) return;

	const original = erpnext.taxes_and_totals.prototype.calculate_taxes_and_totals;

	erpnext.taxes_and_totals.prototype.calculate_taxes_and_totals = function (update_paid_amount) {
		if (this.frm && ["POS Invoice", "Sales Invoice"].includes(this.frm.doc.doctype)) {
			if (this.frm.doc.taxes && this.frm.doc.taxes.length) {
				this.frm.doc.taxes = [];
			}
			if (this.frm.doc.taxes_and_charges) {
				this.frm.doc.taxes_and_charges = null;
			}
		}
		return original.call(this, update_paid_amount);
	};
})();
