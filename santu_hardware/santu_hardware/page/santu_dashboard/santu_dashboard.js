frappe.pages["santu-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Dashboard",
		single_column: true,
	});

	$(page.wrapper).addClass("santu-dash-page");
	$(page.wrapper).find(".page-head").hide();
	render_dashboard(page);
};

frappe.pages["santu-dashboard"].on_page_show = function (wrapper) {
	$(wrapper).find(".page-head").hide();
};

const SANTU_CHART_RANGES = [
	"Today",
	"This Week",
	"This Month",
	"Last Month",
	"This Quarter",
	"This Year",
	"Custom Range",
];
const SANTU_DEFAULT_CHART_RANGE = "This Month";

function render_dashboard(page) {
	$(page.body).find(".santu-dash").remove();
	const $root = $(`<div class="santu-dash"></div>`).appendTo(page.body);
	$root.html(`<div class="santu-dash-loading">Loading...</div>`);

	frappe.call({
		method: "santu_hardware.santu_hardware.api.get_dashboard_data",
		callback: (r) => render_dashboard_data($root, r.message || {}),
		error: () => {
			$root.html(`
				<div class="santu-dash-error">
					Unable to load dashboard.
					<button type="button" class="btn btn-sm btn-primary santu-dash-retry">Retry</button>
				</div>
			`);
			$root.find(".santu-dash-retry").on("click", () => {
				$root.html(`<div class="santu-dash-loading">Loading...</div>`);
				frappe.call({
					method: "santu_hardware.santu_hardware.api.get_dashboard_data",
					callback: (res) => render_dashboard_data($root, res.message || {}),
				});
			});
		},
	});
}

function render_dashboard_data($root, data) {
	$root.empty();

	const $layout = $(`
		<div class="santu-dash-layout">
			<div class="santu-dash-main"></div>
			<aside class="santu-dash-widgets"></aside>
		</div>
	`).appendTo($root);

	const $main = $layout.find(".santu-dash-main");
	const $widgets = $layout.find(".santu-dash-widgets");

	render_fast_actions($main, data);
	render_receivable_payable($main, data);
	render_daily_chart($main);
	render_reports_row($main);
	render_widget_panel($widgets, data);
}

function render_receivable_payable($root, data) {
	const $row = $(`<div class="santu-dash-vy-row"></div>`).appendTo($root);

	$row.append(
		build_vy_summary_card(
			"Total Receivable",
			data.total_receivable,
			data.receivable_party_count,
			"↓",
			"good",
			() => frappe.set_route("santu-customer-dues"),
			"No outstanding receivables."
		)
	);
	$row.append(
		build_vy_summary_card(
			"Total Payable",
			data.pending_supplier_payments,
			data.payable_party_count,
			"↑",
			"warning",
			() => frappe.set_route("query-report", "Accounts Payable"),
			"No outstanding payables."
		)
	);
}

function build_vy_summary_card(label, amount, party_count, arrow, tone, on_click, empty_text) {
	const has_value = (amount || 0) !== 0 || (party_count || 0) > 0;
	const sub_html = has_value
		? `From <b>${party_count || 0}</b> ${party_count === 1 ? "Party" : "Parties"}`
		: frappe.utils.escape_html(empty_text || "");
	return $(`
		<div class="santu-dash-vy-card" role="button" tabindex="0">
			<div class="santu-dash-vy-card-main">
				<div class="santu-dash-vy-card-label">${label}</div>
				<div class="santu-dash-vy-card-amount santu-figures">₹ ${format_currency_plain(amount || 0)}</div>
				<div class="santu-dash-vy-card-sub">${sub_html}</div>
			</div>
			<div class="santu-dash-vy-card-icon santu-tone-${tone}">${arrow}</div>
		</div>
	`).on("click", on_click);
}

function open_santu_report(report_id) {
	sessionStorage.setItem("santu_reports_selected", report_id);
	frappe.set_route("santu-reports");
}

function render_reports_row($root) {
	const $section = $(`
		<div class="santu-dash-section">
			<div class="santu-dash-section-head">
				<div class="santu-dash-section-title santu-dash-section-kicker">Most Used Reports</div>
				<button type="button" class="santu-dash-view-all">View All</button>
			</div>
			<div class="santu-dash-reports-row"></div>
		</div>
	`).appendTo($root);

	$section.find(".santu-dash-view-all").on("click", () => frappe.set_route("santu-reports"));

	const $row = $section.find(".santu-dash-reports-row");
	const reports = [
		{ label: "Sale Report", report_id: "sale" },
		{ label: "All Transactions", report_id: "all_transactions" },
		{ label: "Daybook Report", report_id: "day_book" },
		{ label: "Party Statement", report_id: "party_statement" },
	];

	reports.forEach((r) => {
		$(`
			<div class="santu-dash-report-card" role="button" tabindex="0">
				<span>${r.label}</span>
				<span class="santu-dash-report-arrow">›</span>
			</div>
		`)
			.on("click", () => open_santu_report(r.report_id))
			.appendTo($row);
	});
}

function render_daily_chart($root) {
	const $section = $(`
		<div class="santu-dash-section santu-dash-vy-chart-card">
			<div class="santu-dash-vy-chart-head">
				<div>
					<div class="santu-dash-section-title santu-dash-sale-link">Total Sale</div>
					<div class="santu-dash-vy-chart-amount santu-figures santu-dash-sale-link">₹ 0</div>
				</div>
				<div class="santu-dash-vy-chart-dropdown">
					<button type="button" class="santu-dash-vy-chart-badge">
						<span class="santu-dash-vy-chart-range-label">${SANTU_DEFAULT_CHART_RANGE}</span>
						<span>▾</span>
					</button>
					<div class="santu-dash-vy-chart-menu" style="display:none">
						${SANTU_CHART_RANGES.map(
							(r) => `<div class="santu-dash-vy-chart-menu-item" data-range="${r}">${r}</div>`
						).join("")}
					</div>
				</div>
			</div>
			<div class="santu-dash-chart"></div>
		</div>
	`).appendTo($root);

	const $btn = $section.find(".santu-dash-vy-chart-badge");
	const $menu = $section.find(".santu-dash-vy-chart-menu");

	$btn.on("click", (e) => {
		e.stopPropagation();
		$menu.toggle();
	});
	$(document).off("click.santu-chart-menu").on("click.santu-chart-menu", () => $menu.hide());

	$menu.find(".santu-dash-vy-chart-menu-item").on("click", function (e) {
		e.stopPropagation();
		const range = $(this).data("range");
		$menu.hide();
		if (range === "Custom Range") {
			const d = new frappe.ui.Dialog({
				title: "Custom Range",
				fields: [
					{ fieldtype: "Date", fieldname: "from_date", label: "From", reqd: 1, default: frappe.datetime.month_start() },
					{ fieldtype: "Date", fieldname: "to_date", label: "To", reqd: 1, default: frappe.datetime.get_today() },
				],
				primary_action_label: "Apply",
				primary_action(values) {
					d.hide();
					$section.find(".santu-dash-vy-chart-range-label").text("Custom Range");
					load_sale_chart($section, "Custom Range", values.from_date, values.to_date);
					refresh_period_widgets(values.from_date, values.to_date, "Custom Range");
				},
			});
			d.show();
			return;
		}
		$section.find(".santu-dash-vy-chart-range-label").text(range);
		load_sale_chart($section, range);
		refresh_period_widgets(null, null, range);
	});

	$section.find(".santu-dash-sale-link").on("click", () => open_santu_report("sale"));

	load_sale_chart($section, SANTU_DEFAULT_CHART_RANGE);
}

function load_sale_chart($section, range, from_date, to_date) {
	const $chart_el = $section.find(".santu-dash-chart");
	$chart_el.html(`<div class="santu-dash-chart-empty">Loading chart…</div>`);

	frappe.call({
		method: "santu_hardware.santu_hardware.api.get_sales_chart",
		args: { range_key: range, from_date: from_date || null, to_date: to_date || null },
		callback: (r) => {
			const data = r.message || { total: 0, points: [], empty: true };
			$section.find(".santu-dash-vy-chart-amount").text("₹ " + format_currency_plain(data.total));
			$chart_el.empty();

			if (!data.points || !data.points.length) {
				$chart_el.html(`<div class="santu-dash-chart-empty">No sales recorded for this period.</div>`);
				return;
			}

			new frappe.Chart($chart_el[0], {
				data: {
					labels: data.points.map((p) => p.date),
					datasets: [{ name: "Sales", values: data.points.map((p) => p.total) }],
				},
				type: "line",
				height: 220,
				colors: ["#5b8def"],
				axisOptions: { xIsSeries: true },
				lineOptions: { regionFill: 1, hideDots: 0 },
				tooltipOptions: {
					formatTooltipY: (value) => "₹ " + format_currency_plain(value || 0),
				},
			});
		},
		error: () => {
			$chart_el.html(`
				<div class="santu-dash-chart-empty">
					Unable to load chart.
					<button type="button" class="btn btn-xs btn-default santu-chart-retry">Retry</button>
				</div>
			`);
			$chart_el.find(".santu-chart-retry").on("click", () => load_sale_chart($section, range, from_date, to_date));
		},
	});
}

function refresh_period_widgets(from_date, to_date, period) {
	frappe.call({
		method: "santu_hardware.santu_hardware.dashboard_api.get_dashboard_widget_data",
		args: { period: period || "This Month", from_date: from_date || null, to_date: to_date || null },
		callback: (r) => {
			const msg = r.message || {};
			const $panel = $(".santu-dash-widgets");
			if (!$panel.length) return;
			const data = {
				widget_catalog: msg.catalog || [],
				selected_widgets: msg.selected || [],
				low_stock_count: 0,
			};
			const low = (msg.catalog || []).find((w) => w.key === "low_stock");
			if (low) data.low_stock_count = low.count || 0;
			render_widget_panel($panel, data);
		},
	});
}

function render_fast_actions($root, data) {
	const $section = $(`<div class="santu-dash-actions"></div>`).appendTo($root);

	$section.append(
		build_action_tile({ label: "Start New Sale", icon: "🧾", action: "sale" }, true)
	);

	const $row = $(`<div class="santu-dash-actions-row"></div>`).appendTo($section);
	$row.append(build_action_tile({ label: "Receive Stock", icon: "📦", action: "receive" }));
	$row.append(build_action_tile({ label: "Search Product", icon: "🔍", action: "search" }));
	$row.append(
		build_action_tile({
			label: data.register_open ? "Close Counter" : "Open Counter",
			icon: data.register_open ? "🔒" : "🔓",
			action: data.register_open ? "close" : "open",
		})
	);
}

function build_action_tile(action, featured) {
	return $(`
		<div class="santu-dash-tile${featured ? " santu-dash-tile-featured" : ""}" role="button" tabindex="0">
			<span class="santu-dash-tile-icon">${action.icon}</span>
			<span class="santu-dash-tile-label">${action.label}</span>
		</div>
	`)
		.on("click", () => run_dashboard_action(action.action))
		.on("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				run_dashboard_action(action.action);
			}
		});
}

function run_dashboard_action(action) {
	if (action === "sale" || action === "open") {
		frappe.set_route("point-of-sale");
		return;
	}
	if (action === "receive") {
		frappe.set_route("santu-receive-stock");
		return;
	}
	if (action === "search") {
		frappe.set_route("product-search");
		return;
	}
	if (action === "close") {
		frappe.confirm(
			"Close the counter for today? This opens the POS Closing Entry so you can count cash and submit.",
			() => {
				if (!frappe.model.can_create("POS Closing Entry")) {
					frappe.msgprint("You do not have permission to close the counter.");
					return;
				}
				frappe.set_route("pos-closing-entry", "new");
			}
		);
	}
}

function render_widget_panel($panel, data) {
	const catalog = data.widget_catalog || [];
	const selected = data.selected_widgets || [];
	const by_key = {};
	catalog.forEach((w) => {
		by_key[w.key] = w;
	});

	$panel.html(`
		<div class="santu-dash-widget-rail">
			<div class="santu-dash-widget-list"></div>
			<button type="button" class="santu-dash-add-widget">
				<span>Add Widget of Your Choice</span>
				<span class="santu-dash-add-plus">+</span>
			</button>
		</div>
	`);

	const $list = $panel.find(".santu-dash-widget-list");
	if (!selected.length) {
		$list.html(`
			<div class="santu-dash-widget-empty">
				<div class="santu-dash-widget-empty-art" aria-hidden="true">
					<svg viewBox="0 0 120 88" width="96" height="70">
						<rect x="18" y="38" width="84" height="42" rx="6" fill="#dbeafe"/>
						<rect x="30" y="22" width="60" height="22" rx="4" fill="#93c5fd"/>
						<circle cx="60" cy="28" r="10" fill="#fff"/>
						<rect x="38" y="52" width="18" height="28" rx="2" fill="#fff"/>
						<rect x="64" y="56" width="22" height="12" rx="2" fill="#fff"/>
					</svg>
				</div>
				<p>It Looks So Empty in Here!</p>
				<p class="santu-dash-widget-empty-sub">Add one of our widgets to get started and view your business operations.</p>
			</div>
		`);
	} else {
		selected.forEach((key) => {
			const w = by_key[key];
			if (w) $list.append(build_active_widget(w, selected));
		});
	}

	$panel.find(".santu-dash-add-widget").on("click", () => open_widget_picker($panel, catalog, selected));
}

function build_active_widget(w, selected) {
	const value_html =
		w.kind === "currency"
			? `<div class="santu-dash-w-value">₹ ${format_currency_plain(w.value || 0)}</div>`
			: `<div class="santu-dash-w-value">${frappe.utils.escape_html(w.text || "")}</div>`;

	const $el = $(`
		<div class="santu-dash-w-card" role="button" tabindex="0">
			<button type="button" class="santu-dash-w-remove" title="Remove">×</button>
			<div class="santu-dash-w-title">${frappe.utils.escape_html(w.title)}</div>
			${value_html}
		</div>
	`);
	$el.on("click", (e) => {
		if ($(e.target).closest(".santu-dash-w-remove").length) return;
		open_widget_route(w);
	});
	$el.find(".santu-dash-w-remove").on("click", (e) => {
		e.stopPropagation();
		const next = selected.filter((k) => k !== w.key);
		save_widgets(next);
	});
	return $el;
}

function open_widget_route(w) {
	if (w.report_id) {
		open_santu_report(w.report_id);
		return;
	}
	if (w.report_name) {
		frappe.set_route("query-report", w.report_name);
		return;
	}
	if (w.doctype) {
		if (w.available === false) {
			frappe.msgprint("Google Profile Manager is not configured in this site.");
			return;
		}
		frappe.set_route("Form", w.doctype);
		return;
	}
	if (w.route) frappe.set_route(w.route);
}

function open_widget_picker($panel, catalog, selected) {
	$panel.html(`
		<div class="santu-dash-widget-rail santu-dash-picker-inrail">
			<div class="santu-dash-picker-list"></div>
			<div class="santu-dash-picker-footer">
				<span>Add Widget of Your Choice</span>
				<button type="button" class="santu-dash-picker-close" aria-label="Close">✕</button>
			</div>
		</div>
	`);

	const $list = $panel.find(".santu-dash-picker-list");
	catalog.forEach((w) => {
		const added = selected.includes(w.key);
		const value =
			w.kind === "currency" ? `₹ ${format_currency_plain(w.value || 0)}` : w.text || "";
		const $row = $(`
			<div class="santu-dash-picker-row">
				<div>
					<div class="santu-dash-picker-title">${frappe.utils.escape_html(w.title)}</div>
					<div class="santu-dash-picker-value">${frappe.utils.escape_html(String(value))}</div>
				</div>
				<button type="button" class="santu-dash-picker-add ${added ? "is-added" : ""}">${added ? "✓ Added" : "+"}</button>
			</div>
		`);
		$row.find(".santu-dash-picker-add").on("click", () => {
			let next = selected.slice();
			if (next.includes(w.key)) next = next.filter((k) => k !== w.key);
			else next.push(w.key);
			save_widgets(next, true);
		});
		$list.append($row);
	});

	$panel.find(".santu-dash-picker-close").on("click", () => {
		frappe.call({
			method: "santu_hardware.santu_hardware.dashboard_api.get_dashboard_widget_data",
			callback: (r) => {
				const msg = r.message || {};
				render_widget_panel($panel, {
					widget_catalog: msg.catalog || catalog,
					selected_widgets: msg.selected || selected,
				});
			},
		});
	});
}

function save_widgets(keys, keep_picker) {
	frappe.call({
		method: "santu_hardware.santu_hardware.dashboard_api.save_dashboard_widgets",
		args: { widgets: keys },
		callback: () => {
			frappe.call({
				method: "santu_hardware.santu_hardware.dashboard_api.get_dashboard_widget_data",
				callback: (r) => {
					const msg = r.message || {};
					const $w = $(".santu-dash-widgets");
					if (!$w.length) return;
					const data = {
						widget_catalog: msg.catalog || [],
						selected_widgets: msg.selected || keys,
					};
					if (keep_picker) open_widget_picker($w, data.widget_catalog, data.selected_widgets);
					else render_widget_panel($w, data);
					frappe.show_alert({ message: "Dashboard widgets saved", indicator: "green" });
				},
			});
		},
	});
}

function format_currency_plain(value) {
	const n = Number(value || 0);
	if (!Number.isFinite(n)) return "0";
	return n.toLocaleString("en-IN", {
		maximumFractionDigits: n % 1 === 0 ? 0 : 2,
		minimumFractionDigits: 0,
	});
}
