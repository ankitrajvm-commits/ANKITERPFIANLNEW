/* global santu_sale */
frappe.provide("santu_sale");

santu_sale.summary = {
	render($wrap, summary) {
		const u = santu_sale.utils;
		const pct = summary.pct_vs_last_month;
		const pct_label = `${pct >= 0 ? "+" : ""}${pct}% vs last month`;
		const pct_class = pct >= 0 ? "santu-sale-pct-up" : "santu-sale-pct-down";
		const arrow = pct >= 0 ? "↗" : "↘";

		$wrap.html(`
			<div class="santu-sale-summary-card">
				<div class="santu-sale-summary-top">
					<div class="santu-sale-summary-label">Total Sales Amount</div>
					<span class="santu-sale-summary-badge ${pct_class}">${pct_label} ${arrow}</span>
				</div>
				<div class="santu-sale-summary-amount santu-figures">${u.format_money(summary.total_sales)}</div>
				<div class="santu-sale-summary-sub santu-figures">
					<span>Received: <b>${u.format_money(summary.received)}</b></span>
					<span class="santu-sale-summary-sep">|</span>
					<span>Balance: <b class="${summary.balance > 0 ? "santu-sale-balance-due" : ""}">${u.format_money(summary.balance)}</b></span>
				</div>
			</div>
		`);
	},
};
