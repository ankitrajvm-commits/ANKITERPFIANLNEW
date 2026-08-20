/* global santu_purchase */
frappe.provide("santu_purchase");

santu_purchase.summary = {
	render($wrap, summary, view) {
		const u = santu_purchase.utils;
		const type = summary.summary_type || view;

		if (type === "bills") {
			// Total Payable — moved here from Home (2026-08-18 direct request:
			// "home se total payable ko hata do aur more me daal do"). This is
			// the overall pending-across-every-supplier figure, deliberately
			// separate from the Paid/Unpaid/Total triple below it, which is
			// scoped to whichever date filter is selected — the two numbers
			// answer different questions and shouldn't be made to look like one.
			const party_count = summary.payable_party_count || 0;
			const payable_html =
				(summary.total_payable || 0) > 0
					? `
				<div class="santu-purchase-total-payable">
					<div class="santu-purchase-total-payable-label">Total Payable</div>
					<div class="santu-purchase-total-payable-amount santu-figures">${u.format_money(summary.total_payable)}</div>
					<div class="santu-purchase-total-payable-sub">From <b>${party_count}</b> ${party_count === 1 ? "Party" : "Parties"}</div>
				</div>
			`
					: "";
			$wrap.html(`
				${payable_html}
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
