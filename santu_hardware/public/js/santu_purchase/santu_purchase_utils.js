/* global santu_purchase */
frappe.provide("santu_purchase");

santu_purchase.VIEWS = {
	bills: { label: "Purchase Bills", title: "Purchase Bills", addLabel: "+ Add Purchase" },
	payment_out: { label: "Payment-Out", title: "Payment-Out", addLabel: "+ Add Payment-Out" },
	expenses: { label: "Expenses", title: "Expenses", addLabel: "+ Add Expense" },
	purchase_order: { label: "Purchase Order", title: "Purchase Orders", addLabel: "+ Add Purchase Order" },
	purchase_return: { label: "Purchase Return / Dr. Note", title: "Purchase Return / Dr. Note", addLabel: "+ Add Debit Note" },
};

santu_purchase.PERIODS = ["Today", "This Week", "This Month", "Last Month", "This Year", "Custom"];

santu_purchase.utils = {
	format_money(value) {
		return `₹ ${format_currency(value || 0, "INR").replace(/^\D+/, "")}`;
	},

	debounce(fn, ms = 300) {
		let timer;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), ms);
		};
	},

	get_view() {
		return (frappe.route_options && frappe.route_options.view) || sessionStorage.getItem("santu_purchase_view") || "bills";
	},

	set_view(view) {
		sessionStorage.setItem("santu_purchase_view", view);
		if (frappe.route_options) frappe.route_options.view = view;
	},

	export_csv(transactions, view) {
		const cols = santu_purchase.transactions.get_columns(view);
		const headers = cols.map((c) => c.label);
		const rows = transactions.map((t) => cols.map((c) => (c.get ? c.get(t) : t[c.key] || "")));
		const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `purchase-${view}-${frappe.datetime.get_today()}.csv`;
		a.click();
	},
};
