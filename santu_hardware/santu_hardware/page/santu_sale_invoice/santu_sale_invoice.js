/* global frappe */
// The second billing screen used to live here. It is gone (2026-08-30 direct
// request: "billing ke liye sirf 1 screen honi chahiye — POS Billing").
//
// Two screens meant two of everything: two item tables, two save paths, two
// unit-conversion implementations -- and they disagreed. On 2026-08-30 both
// were found mis-scaling a unit change in DIFFERENT ways, and Desk's
// single-page nature meant loading both in one session could blank the second
// one on a top-level `const` collision. POS Billing (santu_billing) is now the
// only place a bill is made, and everything this screen could do that Billing
// could not was moved there first: draft save, Terms & Conditions, customer
// note, photo/document attachments, the unprinted-bills alert with "Dobara
// chhapo", and "kuch gadbad hai" reporting.
//
// The route stays alive and forwards, so old bookmarks, pinned tabs and any
// link still pointing here land on Billing instead of an empty page.
//
// NOT removed, and must not be: /assets/santu_hardware/js/santu_sale_invoice/
// santu_sale_invoice_api.js. Despite the name that is the SHARED library --
// Estimate, Sales Order, Delivery Challan, Sales Return, Payment Entry, Party
// Transfer and Billing itself all call it.
frappe.pages["santu-sale-invoice"].on_page_load = function () {
	frappe.set_route("santu-billing");
};

frappe.pages["santu-sale-invoice"].on_page_show = function () {
	frappe.set_route("santu-billing");
};
