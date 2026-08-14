/* global santu_reports */
frappe.provide("santu_reports");

santu_reports.nav = {
	render($wrap, on_select) {
		$wrap.empty();
		const selected = santu_reports.utils.get_selected_id();

		santu_reports.CATEGORIES.forEach((cat) => {
			const reports = santu_reports.utils.get_reports_by_category(cat.id);
			if (!reports.length) return;

			$wrap.append(`<div class="santu-reports-cat-header">${frappe.utils.escape_html(cat.label)}</div>`);
			reports.forEach((r) => {
				$(`
					<button type="button" class="santu-reports-nav-item${r.id === selected ? " is-active" : ""}" data-id="${r.id}">
						${frappe.utils.escape_html(r.label)}
					</button>
				`)
					.on("click", () => {
						$wrap.find(".santu-reports-nav-item").removeClass("is-active");
						$(`.santu-reports-nav-item[data-id="${r.id}"]`).addClass("is-active");
						santu_reports.utils.set_selected_id(r.id);
						on_select(r);
					})
					.appendTo($wrap);
			});
		});
	},

	scroll_to_active($wrap) {
		const $active = $wrap.find(".santu-reports-nav-item.is-active");
		if ($active.length) {
			$active[0].scrollIntoView({ block: "nearest" });
		}
	},
};
