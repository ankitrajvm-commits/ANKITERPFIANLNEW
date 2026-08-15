frappe.pages["santu-purchase"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_utils.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_api.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_summary.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_transactions.js",
			"/assets/santu_hardware/js/santu_purchase/santu_purchase_page.js",
		],
		() => {
			const view = santu_purchase.utils.get_view();
			const view_meta = santu_purchase.VIEWS[view] || santu_purchase.VIEWS.bills;

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: view_meta.title,
				single_column: true,
			});

			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-purchase-page-main");
			santu_purchase.create_page().init($(page.body), { view });
		}
	);
};
