frappe.pages["santu-reports"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_reports/santu_reports_config.js",
			"/assets/santu_hardware/js/santu_reports/santu_reports_api.js",
			"/assets/santu_hardware/js/santu_reports/santu_reports_nav.js",
			"/assets/santu_hardware/js/santu_reports/santu_reports_filters.js",
			"/assets/santu_hardware/js/santu_reports/santu_reports_table.js",
			"/assets/santu_hardware/js/santu_reports/santu_reports_runner.js",
		],
		() => {
			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: "Reports",
				single_column: true,
			});
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-reports-page-main");
			santu_reports_page.init(page);
		}
	);
};

// The Home page's "Most Used Reports" tiles (and anything else that jumps
// to a specific report) pick the target by writing santu_reports_selected to
// sessionStorage, then routing here. init() reads that — but init() only
// runs the first time this page is opened in a session, so on every later
// visit the page kept showing whichever report was last open: clicking
// "Daybook Report" on Home landed on Reports with "Sale" still selected
// (confirmed live 2026-08-15). Re-reading the selection on every show fixes
// that; a repeat visit with no change is a no-op.
frappe.pages["santu-reports"].on_page_show = function () {
	const p = window.santu_reports_page;
	if (!p || !p.page || !p.$nav) return;
	const wanted = santu_reports.utils.get_selected_id();
	if (wanted === p._current_report_id) return;
	const report = santu_reports.utils.get_report(wanted);
	if (report) p.select_report_external(report);
};

window.santu_reports_page = {
	async init(page) {
		this.page = page;
		this.init_data = await santu_reports.api.get_init();

		const $root = $(`
			<div class="santu-reports">
				<div class="santu-reports-layout">
					<aside class="santu-reports-nav-panel">
						<div class="santu-reports-nav-scroll"></div>
					</aside>
					<main class="santu-reports-workspace">
						<div class="santu-reports-generic-area">
							<div class="santu-reports-ws-header">
								<h2 class="santu-reports-ws-title">Reports</h2>
								<div class="santu-reports-ws-toolbar">
									<button type="button" class="santu-reports-tb-btn" data-action="refresh" title="Refresh">🔄</button>
									<button type="button" class="santu-reports-tb-btn" data-action="export" title="Export Excel">📗</button>
									<button type="button" class="santu-reports-tb-btn" data-action="print" title="Print">🖨</button>
								</div>
							</div>
							<div class="santu-reports-filters"></div>
							<div class="santu-reports-config-msg" style="display:none;"></div>
							<div class="santu-reports-table-area">
								<div class="santu-reports-welcome">Select a report from the left panel.</div>
							</div>
						</div>
						<div class="santu-reports-embed-area" style="display:none;"></div>
					</main>
				</div>
			</div>
		`).appendTo(page.body);

		this.$root = $root;
		this.$nav = $root.find(".santu-reports-nav-scroll");
		this.$workspace = $root.find(".santu-reports-workspace");

		santu_reports.nav.render(this.$nav, (report) => this.select_report(report));
		santu_reports.nav.scroll_to_active(this.$nav);

		const initial = santu_reports.utils.get_report(santu_reports.utils.get_selected_id()) || santu_reports.REPORTS[0];
		if (initial) this.select_report(initial);

		this.$workspace.find(".santu-reports-tb-btn").on("click", (e) => {
			const action = $(e.currentTarget).data("action");
			if (action === "refresh") santu_reports.runner.refresh();
			if (action === "export") santu_reports.runner.export_excel();
			if (action === "print") santu_reports.runner.print();
		});
	},

	// Tracked so on_page_show can tell "already showing this" from "a
	// different report was requested while the page stayed loaded".
	select_report(report) {
		this._current_report_id = report.id;
		santu_reports.runner.load(report, this.$workspace, this.init_data);
	},

	// Selection arriving from outside the nav (a Home tile, say): the nav's
	// own click handler never ran, so its highlight has to be redrawn here.
	// Nav clicks keep using select_report directly — re-rendering the whole
	// nav on every click would be needless churn.
	select_report_external(report) {
		santu_reports.utils.set_selected_id(report.id);
		santu_reports.nav.render(this.$nav, (r) => this.select_report(r));
		santu_reports.nav.scroll_to_active(this.$nav);
		this.select_report(report);
	},
};
