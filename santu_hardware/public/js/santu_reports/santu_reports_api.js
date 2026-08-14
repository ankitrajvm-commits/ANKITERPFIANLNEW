/* global frappe, santu_reports */
frappe.provide("santu_reports");

santu_reports.api = {
	_script_cache: new Map(),

	async get_init() {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_reports_init");
	},

	async get_script(report_name) {
		if (this._script_cache.has(report_name)) return this._script_cache.get(report_name);
		const data = await frappe.xcall("frappe.desk.query_report.get_script", { report_name });
		this._script_cache.set(report_name, data);
		return data;
	},

	async run_erpnext(report_name, filters, options = {}) {
		const r = await frappe.call({
			method: "frappe.desk.query_report.run",
			args: {
				report_name,
				filters,
				ignore_prepared_report: false,
				are_default_filters: false,
				...options,
			},
		});
		return r.message;
	},

	async run_custom(report_id, filters) {
		return frappe.xcall("santu_hardware.santu_hardware.api.run_santu_report", {
			report_id,
			filters,
		});
	},

	export_excel(report_name, filters) {
		const url = frappe.urllib.get_full_url("/api/method/frappe.desk.query_report.export_query");
		frappe.call({
			method: "frappe.desk.query_report.export_query",
			args: { file_format_type: "Excel", report_name, filters, selected_items: "" },
			callback(r) {
				if (r.message) window.open(r.message, "_blank");
			},
		});
	},

	export_custom(report_id, filters) {
		return frappe.xcall("santu_hardware.santu_hardware.api.export_santu_report", {
			report_id,
			filters,
		}).then((url) => {
			if (url) window.open(url, "_blank");
		});
	},
};
