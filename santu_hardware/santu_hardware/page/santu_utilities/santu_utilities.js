frappe.pages["santu-utilities"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_utilities/santu_utilities_utils.js",
			"/assets/santu_hardware/js/santu_utilities/santu_utilities_api.js",
			"/assets/santu_hardware/js/santu_utilities/santu_utilities_views.js",
		],
		() => {
			const view = santu_utilities.utils.get_view();
			const meta = santu_utilities.VIEWS[view] || santu_utilities.VIEWS.import_items;

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: meta.title,
				single_column: true,
			});
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-utilities-page-main");

			const $root = $(`
				<div class="santu-utilities">
					<div class="santu-utilities-header">
						<h1 class="santu-utilities-title">${frappe.utils.escape_html(meta.title)}</h1>
					</div>
					<div class="santu-utilities-content"></div>
				</div>
			`).appendTo(page.body);

			const reload = () => {
				const v = santu_utilities.utils.get_view();
				const m = santu_utilities.VIEWS[v] || santu_utilities.VIEWS.import_items;
				$root.find(".santu-utilities-title").text(m.title);
				santu_utilities.views.render($root.find(".santu-utilities-content"), v, { reload });
			};
			window.santu_utilities_reload = reload;

			reload();

			$(document)
				.off("santu-utilities-view-change.santu-utilities")
				.on("santu-utilities-view-change.santu-utilities", () => {
					reload();
				});
		}
	);
};

frappe.pages["santu-utilities"].on_page_show = function (wrapper) {
	$(wrapper).find(".page-head").hide();
	if (window.santu_utilities_reload) {
		window.santu_utilities_reload();
	}
};
