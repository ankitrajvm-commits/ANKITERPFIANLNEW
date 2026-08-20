/* global santu_reports */
frappe.provide("santu_reports");

santu_reports.nav = {
	render($wrap, on_select) {
		$wrap.empty();
		const selected = santu_reports.utils.get_selected_id();

		const make_item = (r) =>
			$(`
				<button type="button" class="santu-reports-nav-item${r.id === selected ? " is-active" : ""}" data-id="${r.id}">
					${frappe.utils.escape_html(r.label)}
				</button>
			`).on("click", () => {
				$wrap.find(".santu-reports-nav-item").removeClass("is-active");
				$(`.santu-reports-nav-item[data-id="${r.id}"]`).addClass("is-active");
				santu_reports.utils.set_selected_id(r.id);
				on_select(r);
			});

		santu_reports.CATEGORIES.forEach((cat) => {
			const reports = santu_reports.utils.get_reports_by_category(cat.id);
			if (!reports.length) return;

			$wrap.append(`<div class="santu-reports-cat-header">${frappe.utils.escape_html(cat.label)}</div>`);

			// less_used reports (2026-08-17: "jo jyada use nh hone wale hai use
			// report section me hi more me daal do") sit behind a "More ▾"
			// toggle per category instead of the main list — unless every
			// report in the category is less_used, in which case hiding the
			// only options behind a toggle would just add a click for nothing.
			const main = reports.filter((r) => !r.less_used);
			const more = reports.filter((r) => r.less_used);
			const show_all_plain = !main.length;

			(show_all_plain ? reports : main).forEach((r) => $wrap.append(make_item(r)));

			if (!show_all_plain && more.length) {
				const has_selected_in_more = more.some((r) => r.id === selected);
				const $more_toggle = $(`
					<button type="button" class="santu-reports-nav-more">
						${__("More")} <span class="santu-reports-nav-more-arrow">${has_selected_in_more ? "▾" : "▸"}</span>
					</button>
				`).appendTo($wrap);
				const $more_items = $(`<div class="santu-reports-nav-more-items"></div>`)
					.toggle(has_selected_in_more)
					.appendTo($wrap);
				more.forEach((r) => $more_items.append(make_item(r)));
				$more_toggle.on("click", () => {
					const open = $more_items.is(":visible");
					$more_items.toggle(!open);
					$more_toggle.find(".santu-reports-nav-more-arrow").text(open ? "▸" : "▾");
				});
			}
		});
	},

	scroll_to_active($wrap) {
		const $active = $wrap.find(".santu-reports-nav-item.is-active");
		if ($active.length) {
			$active[0].scrollIntoView({ block: "nearest" });
		}
	},
};
