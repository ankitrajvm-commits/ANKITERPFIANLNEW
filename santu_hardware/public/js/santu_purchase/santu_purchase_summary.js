/* global santu_purchase */
frappe.provide("santu_purchase");

santu_purchase.summary = {
	render($wrap, summary, view) {
		const u = santu_purchase.utils;
		const type = summary.summary_type || view;

		if (type === "bills") {
			$wrap.html(`
				<div class="santu-purchase-summary-triple">
					<div class="santu-purchase-sum-card santu-purchase-sum-paid">
						<div class="santu-purchase-sum-label">Paid</div>
						<div class="santu-purchase-sum-value santu-figures">${u.format_money(summary.paid)}</div>
					</div>
					<span class="santu-purchase-sum-op">+</span>
					<div class="santu-purchase-sum-card santu-purchase-sum-unpaid">
						<div class="santu-purchase-sum-label">Unpaid</div>
						<div class="santu-purchase-sum-value santu-figures">${u.format_money(summary.unpaid)}</div>
					</div>
					<span class="santu-purchase-sum-op">=</span>
					<div class="santu-purchase-sum-card santu-purchase-sum-total">
						<div class="santu-purchase-sum-label">Total</div>
						<div class="santu-purchase-sum-value santu-figures">${u.format_money(summary.total)}</div>
					</div>
				</div>
			`);
			return;
		}

		if (type === "payment_out") {
			const pct = summary.pct_vs_last_month || 0;
			const pct_label = `${pct >= 0 ? "+" : ""}${pct}% vs last month`;
			const pct_class = pct >= 0 ? "santu-purchase-pct-up" : "santu-purchase-pct-down";
			const arrow = pct >= 0 ? "↗" : "↘";
			$wrap.html(`
				<div class="santu-purchase-summary-card">
					<div class="santu-purchase-summary-top">
						<div class="santu-purchase-summary-label">Total Amount</div>
						<span class="santu-purchase-summary-badge ${pct_class}">${pct_label} ${arrow}</span>
					</div>
					<div class="santu-purchase-summary-amount santu-figures">${u.format_money(summary.total_amount)}</div>
					<div class="santu-purchase-summary-sub santu-figures">Paid: <b>${u.format_money(summary.paid)}</b></div>
				</div>
			`);
			return;
		}

		if (type === "expenses") {
			$wrap.html(`
				<div class="santu-purchase-summary-card">
					<div class="santu-purchase-summary-label">Total Expenses</div>
					<div class="santu-purchase-summary-amount santu-figures">${u.format_money(summary.total_expenses)}</div>
				</div>
			`);
			return;
		}

		if (type === "purchase_return") {
			$wrap.html(`
				<div class="santu-purchase-return-footer">
					<span class="santu-purchase-return-total">Total Amount: <b class="santu-purchase-text-green santu-figures">${u.format_money(summary.total_amount)}</b></span>
					<span class="santu-purchase-return-balance">Balance: <b class="santu-purchase-text-red santu-figures">${u.format_money(summary.balance)}</b></span>
				</div>
			`);
			return;
		}

		$wrap.empty();
	},
};
