/* global santu_reports, frappe */
frappe.provide("santu_reports");

santu_reports.filters = {
	render($wrap, filter_defs, values, on_change) {
		$wrap.empty();
		if (!filter_defs || !filter_defs.length) {
			$wrap.hide();
			return;
		}
		$wrap.show();
		const $bar = $(`<div class="santu-reports-filter-bar"></div>`).appendTo($wrap);

		filter_defs.forEach((f) => {
			const val = values[f.fieldname] !== undefined ? values[f.fieldname] : f.default;
			const $group = $(`<div class="santu-reports-filter-group"></div>`).appendTo($bar);
			$group.append(`<label>${frappe.utils.escape_html(f.label || f.fieldname)}</label>`);

			if (f.fieldtype === "Select") {
				const opts = (f.options || "").split("\n").filter(Boolean);
				const $sel = $(`<select class="santu-reports-pill" data-field="${f.fieldname}"></select>`);
				opts.forEach((o) => $sel.append(`<option value="${frappe.utils.escape_html(o)}">${frappe.utils.escape_html(o)}</option>`));
				if (val) $sel.val(val);
				$sel.appendTo($group);
			} else if (f.fieldtype === "Link") {
				const $inp = $(`<input type="text" class="santu-reports-pill santu-reports-link" data-field="${f.fieldname}" data-doctype="${f.options || ""}" placeholder="${f.label || ""}">`);
				$inp.val(val || "");
				$inp.appendTo($group);
				this._bind_link($inp, f.options);
			} else if (f.fieldtype === "Date") {
				const $inp = $(`<input type="date" class="santu-reports-pill" data-field="${f.fieldname}">`);
				$inp.val(val || "");
				$inp.appendTo($group);
			} else if (f.fieldtype === "Check") {
				const $chk = $(`<input type="checkbox" class="santu-reports-check" data-field="${f.fieldname}">`);
				$chk.prop("checked", !!val);
				$chk.appendTo($group);
			} else {
				const $inp = $(`<input type="text" class="santu-reports-pill" data-field="${f.fieldname}">`);
				$inp.val(val || "");
				$inp.appendTo($group);
			}
		});

		const $run = $(`<button type="button" class="btn btn-primary btn-sm santu-reports-run-btn">Run Report</button>`).appendTo($bar);
		$run.on("click", () => on_change(this.collect($wrap), true));
		$bar.find("input, select").on("change", () => on_change(this.collect($wrap), false));
	},

	_bind_link($inp, doctype) {
		if (!doctype || !frappe.ui.form.ControlLink) return;
		$inp.on("focus", function () {
			if ($(this).data("link-bound")) return;
			$(this).data("link-bound", true);
			const control = frappe.ui.form.make_control({
				df: { fieldtype: "Link", options: doctype, fieldname: "link" },
				parent: $(this).parent()[0],
				render_input: true,
			});
			control.$input.val($inp.val());
			control.$input.on("change", () => $inp.val(control.get_value() || "").trigger("change"));
			$inp.hide();
		});
	},

	collect($wrap) {
		const values = {};
		$wrap.find("[data-field]").each(function () {
			const field = $(this).data("field");
			if ($(this).is(":checkbox")) {
				values[field] = $(this).is(":checked") ? 1 : 0;
			} else {
				values[field] = $(this).val();
			}
		});
		return values;
	},

	build_defaults(filter_defs, init) {
		const dates = santu_reports.utils.default_dates();
		const values = { company: init.company, from_date: dates.from_date, to_date: dates.to_date };
		(filter_defs || []).forEach((f) => {
			if (f.default !== undefined && f.default !== null && f.default !== "") {
				values[f.fieldname] = f.default;
			}
		});
		return values;
	},

	merge_extra(values, report, init) {
		const extra = typeof report.extra_filters === "function" ? report.extra_filters(init) : report.extra_filters;
		if (extra) {
			Object.assign(values, extra);
		}
		return values;
	},
};
