/* global santu_reports */
frappe.provide("santu_reports");

santu_reports.runner = {
	async load(report, $workspace, init) {
		this._report = report;
		this._$workspace = $workspace;
		this._init = init;
		this._filters = {};

		$workspace.find(".santu-reports-ws-title").text(report.label);
		const $filters = $workspace.find(".santu-reports-filters");
		const $table = $workspace.find(".santu-reports-table-area");
		const $config = $workspace.find(".santu-reports-config-msg");

		$table.empty();
		$config.hide().empty();
		$filters.empty().hide();

		if (report.type === "config") {
			$config.show().html(`
				<div class="santu-reports-config-box">
					<div class="santu-reports-config-icon">ℹ️</div>
					<div class="santu-reports-config-text">${frappe.utils.escape_html(report.config_message || "This report is not available.")}</div>
				</div>
			`);
			return;
		}

		$table.html(`<div class="santu-reports-loading">Loading report…</div>`);

		try {
			if (report.type === "erpnext") {
				const script = await santu_reports.api.get_script(report.report_name);
				const filter_defs = script.filters || [];
				this._filters = santu_reports.filters.build_defaults(filter_defs, init);
				santu_reports.filters.merge_extra(this._filters, report);
				santu_reports.filters.render($filters, filter_defs, this._filters, (vals, run_now) => {
					this._filters = vals;
					if (run_now) this._run();
				});
				await this._run();
			} else if (report.type === "custom") {
				this._filters = {
					company: init.company,
					...santu_reports.utils.default_dates(),
				};
				const filter_defs = report.custom_filters || [
					{ fieldname: "from_date", label: "From Date", fieldtype: "Date" },
					{ fieldname: "to_date", label: "To Date", fieldtype: "Date" },
					{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company" },
				];
				santu_reports.filters.render($filters, filter_defs, this._filters, (vals, run_now) => {
					this._filters = vals;
					if (run_now) this._run();
				});
				await this._run();
			}
		} catch (e) {
			$table.html(`<div class="santu-reports-error">Could not load report: ${frappe.utils.escape_html(e.message || String(e))}</div>`);
			console.error(e);
		}
	},

	async _run() {
		const report = this._report;
		const $table = this._$workspace.find(".santu-reports-table-area");
		$table.html(`<div class="santu-reports-loading">Running report…</div>`);

		try {
			let data;
			if (report.type === "erpnext") {
				const opts = {};
				if (report.is_tree) {
					opts.is_tree = true;
					opts.parent_field = report.parent_field || "account";
				}
				data = await santu_reports.api.run_erpnext(report.report_name, this._filters, opts);
			} else {
				data = await santu_reports.api.run_custom(report.method || report.id, this._filters);
			}
			santu_reports.table.render($table, data, report);
		} catch (e) {
			$table.html(`<div class="santu-reports-error">${frappe.utils.escape_html(e.message || "Report failed")}</div>`);
			console.error(e);
		}
	},

	refresh() {
		if (this._report) return this._run();
	},

	export_excel() {
		const report = this._report;
		if (!report) return;
		if (report.type === "erpnext") {
			santu_reports.api.export_excel(report.report_name, this._filters);
		} else {
			santu_reports.api.export_custom(report.method || report.id, this._filters);
		}
	},

	print() {
		window.print();
	},
};
