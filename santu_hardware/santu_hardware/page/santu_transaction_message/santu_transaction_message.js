frappe.pages["santu-transaction-message"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_transaction_message/santu_txn_msg_utils.js",
			"/assets/santu_hardware/js/santu_transaction_message/santu_txn_msg_api.js",
			"/assets/santu_hardware/js/santu_transaction_message/santu_txn_msg_views.js",
		],
		() => {
			const view = santu_txn_msg.utils.get_view();
			const meta = santu_txn_msg.VIEWS[view] || santu_txn_msg.VIEWS.message;

			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: meta.title,
				single_column: true,
			});
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-txn-msg-page-main");

			const $root = $(`
				<div class="santu-txn-msg">
					<div class="santu-txn-msg-layout">
						<nav class="santu-txn-msg-sidebar"></nav>
						<div class="santu-txn-msg-main">
							<div class="santu-txn-msg-header">
								<h1 class="santu-txn-msg-title">${frappe.utils.escape_html(meta.title)}</h1>
							</div>
							<div class="santu-txn-msg-content"></div>
						</div>
					</div>
				</div>
			`).appendTo(page.body);

			const renderSidebar = () => {
				const v = santu_txn_msg.utils.get_view();
				let html = "";
				Object.entries(santu_txn_msg.VIEWS).forEach(([key, m]) => {
					html += `<button type="button" class="santu-txn-msg-nav-item${v === key ? " active" : ""}" data-view="${key}">${m.label}</button>`;
				});
				$root.find(".santu-txn-msg-sidebar").html(html);
				$root.find(".santu-txn-msg-nav-item").on("click", function () {
					const viewKey = $(this).data("view");
					sessionStorage.setItem("santu_txn_msg_view", viewKey);
					frappe.route_options = { view: viewKey };
					const m = santu_txn_msg.VIEWS[viewKey];
					$root.find(".santu-txn-msg-title").text(m.title);
					$root.find(".santu-txn-msg-nav-item").removeClass("active");
					$(this).addClass("active");
					santu_txn_msg.views.render($root.find(".santu-txn-msg-content"), viewKey);
				});
			};

			renderSidebar();
			santu_txn_msg.views.render($root.find(".santu-txn-msg-content"), view);

			$(document).off("santu-txn-msg-view-change").on("santu-txn-msg-view-change", () => {
				const v = santu_txn_msg.utils.get_view();
				renderSidebar();
				santu_txn_msg.views.render($root.find(".santu-txn-msg-content"), v);
			});
		}
	);
};
