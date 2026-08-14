/* global santu_reports, frappe */
frappe.provide("santu_reports");

santu_reports.table = {
	_state: { search: "", sort_col: null, sort_asc: true, page: 1, page_size: 50 },

	render($wrap, data, report) {
		$wrap.empty();
		this._state = { search: "", sort_col: null, sort_asc: true, page: 1, page_size: 50 };

		if (!data || !data.columns) {
			$wrap.html(`<div class="santu-reports-empty">No data returned.</div>`);
			return;
		}

		const columns = data.columns.filter((c) => !c.hidden);
		let rows = (data.result || []).slice();

		if (data.message && !rows.length) {
			$wrap.html(`<div class="santu-reports-empty">${frappe.utils.escape_html(data.message)}</div>`);
			return;
		}

		const $toolbar = $(`
			<div class="santu-reports-table-toolbar">
				<input type="text" class="form-control santu-reports-table-search" placeholder="Search in report...">
				<span class="santu-reports-row-count"></span>
			</div>
		`).appendTo($wrap);

		const $table_wrap = $(`<div class="santu-reports-table-wrap"></div>`).appendTo($wrap);
		const $table = $(`<table class="santu-reports-table"><thead><tr></tr></thead><tbody></tbody></table>`).appendTo($table_wrap);
		const $thead = $table.find("thead tr");

		columns.forEach((col, idx) => {
			const label = col.label || col.fieldname || "";
			$thead.append(`<th data-col="${idx}" class="${col.fieldtype === "Currency" || col.fieldtype === "Float" ? "num" : ""}">${frappe.utils.escape_html(label)} <span class="santu-reports-sort">↕</span></th>`);
		});

		const $tbody = $table.find("tbody");
		const $count = $toolbar.find(".santu-reports-row-count");
		const $search = $toolbar.find(".santu-reports-table-search");

		const paint = () => {
			let filtered = this._filter_rows(rows, columns, this._state.search);
			if (this._state.sort_col !== null) {
				filtered = this._sort_rows(filtered, columns, this._state.sort_col, this._state.sort_asc);
			}
			const total = filtered.length;
			const start = (this._state.page - 1) * this._state.page_size;
			const page_rows = filtered.slice(start, start + this._state.page_size);

			$tbody.empty();
			page_rows.forEach((row) => {
				const is_obj = row && typeof row === "object" && !Array.isArray(row);
				const cells = columns.map((col, i) => {
					let val = is_obj ? row[col.fieldname] : row[i];
					if (col.fieldname === "account" && row.indent) {
						val = `${"\u00a0".repeat((row.indent || 0) * 4)}${val || ""}`;
					}
					return santu_reports.utils.format_cell(val, col);
				});
				const $tr = $("<tr></tr>");
				cells.forEach((c, i) => {
					const cls = columns[i].fieldtype === "Currency" || columns[i].fieldtype === "Float" ? "num" : "";
					$tr.append(`<td class="${cls}">${frappe.utils.escape_html(String(c ?? ""))}</td>`);
				});
				$tbody.append($tr);
			});

			$count.text(`${total} row${total !== 1 ? "s" : ""}${total > this._state.page_size ? ` (page ${this._state.page})` : ""}`);
		};

		$search.on("input", santu_reports.utils.debounce((e) => {
			this._state.search = $(e.target).val();
			this._state.page = 1;
			paint();
		}));

		$thead.find("th").on("click", function () {
			const idx = $(this).data("col");
			if (santu_reports.table._state.sort_col === idx) {
				santu_reports.table._state.sort_asc = !santu_reports.table._state.sort_asc;
			} else {
				santu_reports.table._state.sort_col = idx;
				santu_reports.table._state.sort_asc = true;
			}
			paint();
		});

		if (data.report_summary && data.report_summary.length) {
			const $summary = $(`<div class="santu-reports-summary-row"></div>`).prependTo($wrap);
			data.report_summary.forEach((s) => {
				$summary.append(`<span class="santu-reports-summary-chip"><b>${frappe.utils.escape_html(s.label)}:</b> ${frappe.utils.escape_html(String(s.value ?? ""))}</span>`);
			});
		}

		paint();
		this._last_rows = rows;
		this._last_columns = columns;
	},

	_filter_rows(rows, columns, q) {
		if (!q) return rows;
		const lower = q.toLowerCase();
		return rows.filter((row) => {
			const is_obj = row && typeof row === "object" && !Array.isArray(row);
			return columns.some((col, i) => {
				const val = is_obj ? row[col.fieldname] : row[i];
				return String(val ?? "").toLowerCase().includes(lower);
			});
		});
	},

	_sort_rows(rows, columns, col_idx, asc) {
		const col = columns[col_idx];
		return rows.slice().sort((a, b) => {
			const is_obj = a && typeof a === "object" && !Array.isArray(a);
			let va = is_obj ? a[col.fieldname] : a[col_idx];
			let vb = is_obj ? b[col.fieldname] : b[col_idx];
			if (typeof va === "number" && typeof vb === "number") {
				return asc ? va - vb : vb - va;
			}
			va = String(va ?? "");
			vb = String(vb ?? "");
			return asc ? va.localeCompare(vb) : vb.localeCompare(va);
		});
	},
};
