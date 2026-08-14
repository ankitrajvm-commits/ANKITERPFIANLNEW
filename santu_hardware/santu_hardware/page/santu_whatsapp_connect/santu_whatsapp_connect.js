frappe.pages["santu-whatsapp-connect"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_api.js",
			"/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_app.js",
		],
		() => {
			const page = frappe.ui.make_app_page({ parent: wrapper, title: "WhatsApp Connect", single_column: true });
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-wa-connect-page-main");
			santu_wa_connect.init(page.body);
		}
	);
};
