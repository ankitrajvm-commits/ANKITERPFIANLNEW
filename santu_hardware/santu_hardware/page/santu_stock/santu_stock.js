/* global frappe, santu_stock */

frappe.pages["santu-stock"].on_page_load = function (wrapper) {
	frappe.require(["/assets/santu_hardware/js/santu_stock/santu_stock_page.js"], () => {
		const page = frappe.ui.make_app_page({ parent: wrapper, title: "Stock Summary", single_column: true });
		$(page.wrapper).find(".page-head").hide();
		$(page.main).addClass("santu-stock-page-main");
		window.santu_stock_page = santu_stock.create_page();
		santu_stock_page.init($(page.body), { page });
	});
};

// Re-read on every visit: stock moves constantly, and a screen whose whole
// job is "how much is left" is worse than useless if it shows what was true
// when the tab was first opened.
frappe.pages["santu-stock"].on_page_show = function () {
	if (window.santu_stock_page && santu_stock_page.$root) santu_stock_page.load();
};
