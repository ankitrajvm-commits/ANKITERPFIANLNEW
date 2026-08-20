frappe.pages["shift-start"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Who's Billing?",
		single_column: true,
	});
	$(page.wrapper).find(".page-head .page-actions").hide();

	frappe.db
		.get_list("Staff Member", {
			filters: { active: 1 },
			fields: ["staff_name"],
			order_by: "staff_name asc",
			limit: 50,
		})
		.then((staff) => {
			if (!staff.length) {
				// No staff configured yet (Admin Mode > Staff Member) — don't
				// block billing on a feature nobody has set up, just proceed.
				santu_set_current_staff(null);
				frappe.set_route("santu-billing");
				return;
			}
			render_shift_start_grid(page, staff);
		});
};

function render_shift_start_grid(page, staff) {
	const $container = $(`<div class="santu-shift-start-grid"></div>`).appendTo(page.body);

	staff.forEach((s) => {
		const initial = (s.staff_name[0] || "?").toUpperCase();
		$(`
			<div class="santu-shift-tile" role="button" tabindex="0">
				<div class="santu-shift-initial">${initial}</div>
				<div class="santu-shift-name">${frappe.utils.escape_html(s.staff_name)}</div>
			</div>
		`)
			.on("click", () => santu_pick_staff(s.staff_name))
			.on("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					santu_pick_staff(s.staff_name);
				}
			})
			.appendTo($container);
	});
}

function santu_pick_staff(staff_name) {
	santu_set_current_staff(staff_name);
	frappe.set_route("santu-billing");
}
