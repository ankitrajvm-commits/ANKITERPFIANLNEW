frappe.pages["santu-sale"].on_page_load = function (wrapper) {
	frappe.require(
		[
			// customer_details() -- the address/phone lookup Billing (POS)
			// already uses, reused for the party line on each bill row.
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_utils.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_api.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_summary.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_transactions.js",
			"/assets/santu_hardware/js/santu_sale/santu_sale_page.js",
		],
		() => {
			const view = santu_sale.utils.get_view();
			const view_meta = santu_sale.VIEWS[view];
			if (view_meta && view_meta.redirect) {
				frappe.set_route(view_meta.redirect);
				return;
			}

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: (view_meta && view_meta.title) || "Sale Invoices",
				single_column: true,
			});

			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-sale-page-main");
			santu_sale.create_page().init($(page.body), { view });
		}
	);
};
