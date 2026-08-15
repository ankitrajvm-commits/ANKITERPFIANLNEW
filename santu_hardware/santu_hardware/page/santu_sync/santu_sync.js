frappe.pages["santu-sync"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sync/santu_sync_utils.js",
			"/assets/santu_hardware/js/santu_sync/santu_sync_api.js",
			"/assets/santu_hardware/js/santu_sync/santu_sync_views.js",
		],
		() => {
			if (!frappe.user.has_role("System Manager") && !frappe.user.has_role("Administrator")) {
				frappe.msgprint("Sync & Backup is available to System Managers only.");
				frappe.set_route("santu-dashboard");
				return;
			}

			const view = santu_sync.utils.get_view();
			const meta = santu_sync.VIEWS[view] || santu_sync.VIEWS.sync_share;

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: meta.title,
				single_column: true,
			});
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-sync-page-main");

			const $root = $(`
				<div class="santu-sync">
					<div class="santu-sync-header">
						<h1 class="santu-sync-title">${frappe.utils.escape_html(meta.title)}</h1>
					</div>
					<div class="santu-sync-content"></div>
				</div>
			`).appendTo(page.body);

			const reload = () => {
				const v = santu_sync.utils.get_view();
				santu_sync.views.render($root.find(".santu-sync-content"), v, { reload });
			};

			reload();

			$(document).off("santu-sync-view-change.santu-sync").on("santu-sync-view-change.santu-sync", () => {
				const v = santu_sync.utils.get_view();
				const m = santu_sync.VIEWS[v] || santu_sync.VIEWS.sync_share;
				$root.find(".santu-sync-title").text(m.title);
				// The Page's own title was set once at construction, so every
				// view after the first left the browser tab reading "Sync &
				// Share" while the body said "Restore Backup". Same slip as
				// the Payment-Out screen had.
				if (page.set_title) page.set_title(m.title);
				reload();
			});
		}
	);
};
