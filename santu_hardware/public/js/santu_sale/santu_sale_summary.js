/* global santu_sale */
frappe.provide("santu_sale");

santu_sale.summary = {
	render($wrap, summary, opts = {}) {
		const u = santu_sale.utils;
		// The Reports > Sale screen (2026-08-15, matched pixel-for-pixel
		// against a real Vyapar screenshot) has no trend badge at all — just
		// Total Sales Amount / Received / Balance. The badge stays on for the
		// standalone Sale module page, where "vs last month" is the point.
		const show_trend = opts.show_trend !== false;
		const pct = summary.pct_vs_last_month;
		const pct_class = pct >= 0 ? "santu-sale-pct-up" : "santu-sale-pct-down";
		const arrow = pct >= 0 ? "↗" : "↘";

		const has_label1 = summary.label1 != null;
		const has_label2 = summary.label2 != null;
		const sub = has_label1
			? `
				<div class="santu-sale-summary-sub santu-figures">
					<span>${frappe.utils.escape_html(summary.label1)}: <b>${
						summary.label1 === "Challans" ? summary.value1 : u.format_money(summary.value1)
					}</b></span>
					${
						has_label2
							? `<span class="santu-sale-summary-sep">|</span>
					<span>${frappe.utils.escape_html(summary.label2)}: <b class="${summary.value2_danger ? "santu-sale-balance-due" : ""}">${u.format_money(summary.value2)}</b></span>`
							: ""
					}
				</div>
			`
			: "";

		$wrap.html(`
			<div class="santu-sale-summary-card">
				<div class="santu-sale-summary-top">
					<div class="santu-sale-summary-headline">
						<span class="santu-sale-summary-label">${frappe.utils.escape_html(summary.title || "Total Sales Amount")}</span>
						<span class="santu-sale-summary-amount santu-figures">${u.format_money(summary.total_sales)}</span>
					</div>
					${
						show_trend
							? `<div class="santu-sale-summary-pct-wrap">
						<span class="santu-sale-summary-badge ${pct_class}">${arrow} ${Math.abs(pct)}%</span>
						<span class="santu-sale-summary-pct-caption">vs last month</span>
					</div>`
							: ""
					}
				</div>
				${sub}
			</div>
		`);
	},
};
