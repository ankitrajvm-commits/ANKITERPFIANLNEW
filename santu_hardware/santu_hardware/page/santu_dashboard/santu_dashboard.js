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
	"Half Year",
	"This Year",
	"Custom Range",
];
const SANTU_DASH_RECEIVE_ICON = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3.5v11M5 10.5L9 14.5l4-4" stroke="#08bd7c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SANTU_DASH_PAY_ICON = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 14.5v-11M5 7.5L9 3.5l4 4" stroke="#f45972" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SANTU_DEFAULT_CHART_RANGE = "This Month";

function render_dashboard(page) {
	// The sales chart's ResizeObserver + debounced redraw (further down)
	// outlives the DOM it was watching if nobody stops it here — re-opening
	// Dashboard removes the old .santu-dash below, but a resize timer already
	// in flight from the PREVIOUS visit still fires afterwards and calls
	// draw_sale_chart() on a container that's no longer in the document,
	// which frappe.Chart's own DOM code throws "NotFoundError" on trying to
	// manipulate (BUG-20260827-00329, 5x on this route, never caught before
	// because nothing ever tore this down on navigation/reload).
	santu_stop_watching_chart_resize();
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

	render_receivable_payable($main, data);
	render_daily_chart($main);
	render_reports_row($main);
	render_widget_panel($widgets, data);
}

function render_receivable_payable($root, data) {
	// Total Payable moved off Home entirely (2026-08-18 direct request) —
	// it now lives on the Purchase Bills page itself (More > Purchase &
	// Expense > Purchase Bills), right where the Paid/Unpaid/Total figures
	// it overlaps with already are. Total Receivable takes the freed-up
	// width rather than sitting in a now-half-empty row.
	const $row = $(`<div class="santu-dash-vy-row santu-dash-vy-row-single"></div>`).appendTo($root);

	$row.append(
		build_vy_summary_card(
			"Total Receivable",
			data.total_receivable,
			data.receivable_party_count,
			SANTU_DASH_RECEIVE_ICON,
			"good",
			() => frappe.set_route("santu-customer-dues"),
			"You don't have any pending amount to be received."
		)
	);
}

function build_vy_summary_card(label, amount, party_count, icon_html, tone, on_click, empty_text) {
	const has_value = (amount || 0) !== 0 || (party_count || 0) > 0;
	const sub_html = has_value
		? `From <span class="santu-dash-party-count-num">${party_count || 0}</span> ${party_count === 1 ? "Party" : "Parties"}`
		: frappe.utils.escape_html(empty_text || "");
	return $(`
		<div class="santu-dash-vy-card" role="button" tabindex="0">
			<div class="santu-dash-vy-card-top">
				<div class="santu-dash-vy-card-data">
					<div class="santu-dash-vy-card-label">${label}</div>
					<div class="santu-dash-vy-card-amount santu-figures">₹ ${santu_dashboard_amount(amount || 0)}</div>
				</div>
				<div class="santu-dash-vy-card-icon santu-tone-${tone}">${icon_html}</div>
			</div>
			<div class="santu-dash-vy-card-sub">${sub_html}</div>
		</div>
	`).on("click", on_click);
}

function open_santu_report(report_id) {
	sessionStorage.setItem("santu_reports_selected", report_id);
	frappe.set_route("santu-reports");
}

function render_reports_row($root) {
	const $section = $(`
		<div class="santu-dash-reports-section">
			<div class="santu-dash-section-head">
				<div class="santu-dash-section-title santu-dash-section-kicker">Most Used Reports</div>
				<button type="button" class="santu-dash-view-all">View All</button>
			</div>
			<div class="santu-dash-reports-row"></div>
		</div>
	`).appendTo($root);

	$section.find(".santu-dash-view-all").on("click", () => frappe.set_route("santu-reports"));

	const $row = $section.find(".santu-dash-reports-row");
	// "Party Statement" swapped for "Printer Settings" (2026-08-18 direct
	// request) — the only card here that isn't a report, so it opens
	// Utilities' Printer Settings view directly instead of routing through
	// open_santu_report(), which only knows how to select a report_id.
	const reports = [
		{ label: "Sale Report", report_id: "sale" },
		{ label: "All Transactions", report_id: "all_transactions" },
		{ label: "Daybook Report", report_id: "day_book" },
		{
			label: "Printer Settings",
			open: () => {
				sessionStorage.setItem("santu_utilities_view", "printer_settings");
				frappe.route_options = { view: "printer_settings" };
				frappe.set_route("santu-utilities");
			},
		},
	];

	reports.forEach((r) => {
		$(`
			<div class="santu-dash-report-card" role="button" tabindex="0">
				<span>${r.label}</span>
				<span class="santu-dash-report-arrow">›</span>
			</div>
		`)
			.on("click", () => (r.open ? r.open() : open_santu_report(r.report_id)))
			.appendTo($row);
	});
}

function render_daily_chart($root) {
	const $section = $(`
		<div class="santu-dash-section santu-dash-vy-chart-card">
			<div class="santu-dash-vy-chart-head">
				<div>
					<div class="santu-dash-section-title santu-dash-sale-link">Total Sale</div>
					<div class="santu-dash-vy-chart-amount-row">
						<div class="santu-dash-vy-chart-amount santu-figures santu-dash-sale-link">₹ 0</div>
						<div class="santu-dash-vy-chart-pct is-same"></div>
					</div>
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
			const data = r.message || { total: 0, points: [], empty: true, percent_change: 0 };
			$section.find(".santu-dash-vy-chart-amount").text("₹ " + santu_dashboard_amount(data.total));
			const pct = Number(data.percent_change || 0);
			const $pct = $section.find(".santu-dash-vy-chart-pct");
			$pct.removeClass("is-up is-down is-same");
			if (!pct) {
				$pct.addClass("is-same").html("Same as last period");
			} else if (pct > 0) {
				$pct.addClass("is-up").html(`<b>↑ ${Math.abs(pct).toFixed(1)}%</b>`);
			} else {
				$pct.addClass("is-down").html(`<b>↓ ${Math.abs(pct).toFixed(1)}%</b>`);
			}
			$chart_el.empty();

			if (!data.points || !data.points.length) {
				santu_stop_watching_chart_resize();
				$chart_el.html(`<div class="santu-dash-chart-empty">No sales recorded for this period.</div>`);
				return;
			}

			draw_sale_chart($chart_el, data.points);
			watch_chart_resize($chart_el, data.points);
		},
		error: () => {
			santu_stop_watching_chart_resize();
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

// frappe-charts draws its SVG at whatever pixel height the container has at
// that one instant and never re-measures. The desktop app
// (SantuHardware.app) finishes sizing its window AFTER the page has already
// rendered, so the chart stayed locked to that small early height and left a
// big blank gap below it inside the card — while the same build in a browser,
// where the window is already at its final size when the chart draws, filled
// the card properly (reported 2026-08-19 with side-by-side screenshots of
// both). Redrawing whenever the container's own height actually changes makes
// the two identical, and also fixes the chart after any later window resize.
let santu_chart_resize_observer = null;

function draw_sale_chart($chart_el, points) {
	const chart_h = Math.max(180, ($chart_el.height() || 220) - 8);
	$chart_el.empty();
	new frappe.Chart($chart_el[0], {
		data: {
			labels: points.map((p) => p.date),
			datasets: [{ name: "Sales", values: points.map((p) => p.total) }],
		},
		type: "line",
		height: chart_h,
		colors: ["#3b82f6"],
		axisOptions: { xIsSeries: true },
		lineOptions: { regionFill: 1, hideDots: 0 },
		tooltipOptions: {
			formatTooltipY: (value) => "₹ " + santu_dashboard_amount(value || 0),
		},
	});
	$chart_el.data("santu-drawn-height", chart_h);
}

function santu_stop_watching_chart_resize() {
	if (santu_chart_resize_observer) {
		santu_chart_resize_observer.disconnect();
		santu_chart_resize_observer = null;
	}
}

function watch_chart_resize($chart_el, points) {
	santu_stop_watching_chart_resize();
	if (typeof ResizeObserver === "undefined") return;

	let timer = null;
	santu_chart_resize_observer = new ResizeObserver(() => {
		// Debounced: dragging a window edge fires this continuously, and every
		// redraw rebuilds the entire SVG.
		clearTimeout(timer);
		timer = setTimeout(() => {
			if (!$chart_el.is(":visible")) return;
			const drawn = $chart_el.data("santu-drawn-height") || 0;
			const target = Math.max(180, ($chart_el.height() || 220) - 8);
			// Only redraw on a real change — the observer also fires for the
			// size change our own redraw causes, which would otherwise loop.
			if (Math.abs(target - drawn) < 24) return;
			draw_sale_chart($chart_el, points);
		}, 150);
	});
	santu_chart_resize_observer.observe($chart_el[0]);
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
			? `<div class="santu-dash-w-value">₹ ${santu_dashboard_amount(w.value || 0)}</div>`
			: `<div class="santu-dash-w-value">${frappe.utils.escape_html(w.text || "")}</div>`;

	const $el = $(`
		<div class="santu-dash-w-card" role="button" tabindex="0">
			<button type="button" class="santu-dash-w-remove" title="Remove">×</button>
			<div class="santu-dash-w-top">
				<div class="santu-dash-w-title">${frappe.utils.escape_html(w.title)}</div>
				${w.period ? `<div class="santu-dash-w-period">${frappe.utils.escape_html(w.period)}</div>` : ""}
			</div>
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
		if (window.santu_open_report) window.santu_open_report("");
		else frappe.set_route("santu-reports");
		return;
	}
	// No `doctype` branch here any more: the Google Profile Manager card was
	// the only catalog entry that carried one, and it existed purely to open
	// a native Form. Every remaining widget targets one of our own screens.
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
			w.kind === "currency" ? `₹ ${santu_dashboard_amount(w.value || 0)}` : w.text || "";
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

function santu_dashboard_amount(value) {
	const n = Number(value || 0);
	if (!Number.isFinite(n)) return "0";
	return n.toLocaleString("en-IN", {
		maximumFractionDigits: n % 1 === 0 ? 0 : 2,
		minimumFractionDigits: 0,
	});
}
