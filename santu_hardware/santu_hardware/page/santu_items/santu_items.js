// Items merged into Stock & Rates (2026-08-17: "items and stock and rates
// ko merge kro") — this page is kept only so an old bookmark or a stray
// caller that still says "santu-items" lands somewhere real instead of a
// blank page. It forwards whatever route_options it was given (item_code,
// item_group) straight through, since santu-stock understands the same ones
// this page used to.
frappe.pages["santu-items"].on_page_load = function () {
	frappe.set_route("santu-stock");
};
