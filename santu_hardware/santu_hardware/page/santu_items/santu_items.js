// Items merged into Stock & Rates (2026-08-17: "items and stock and rates
// ko merge kro") — this page is kept only so an old bookmark or a stray
// caller that still says "santu-items" lands somewhere real instead of a
// blank page. It forwards whatever route_options it was given (item_code,
// item_group) straight through, since santu-stock understands the same ones
// this page used to.
//
// The redirect lives in on_page_show, NOT on_page_load: on_page_load fires
// only the first time Frappe builds the page. On every later visit the
// container is already in the DOM, so Frappe skips on_page_load and this
// page rendered as a completely blank screen instead of forwarding
// (2026-09-04, caught by walking all 36 screens in one session — the first
// visit redirected correctly, the second showed nothing at all).
frappe.pages["santu-items"].on_page_show = function () {
	frappe.set_route("santu-stock");
};
