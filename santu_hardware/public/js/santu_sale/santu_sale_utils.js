/* global santu_sale */
frappe.provide("santu_sale");

santu_sale.VIEWS = {
	invoices: { label: "Sale Invoices", title: "Sale Invoices", addLabel: "+ Add Sale" },
	quotation: { label: "Estimate / Quotation", title: "Estimate / Quotation", addLabel: "+ Add Estimate" },
	proforma: { label: "Proforma Invoice", title: "Proforma Invoice", addLabel: "+ Add Proforma" },
	payment_in: { label: "Payment In", title: "Payment In", addLabel: "+ Add Payment-In" },
	sales_order: { label: "Sales Order", title: "Sales Order", addLabel: "+ Add Sales Order" },
	delivery_challan: { label: "Delivery Challan", title: "Delivery Challan", addLabel: "+ Add Delivery Challan" },
	sales_return: { label: "Sales Return / Credit Note", title: "Sales Return", addLabel: "+ Add Sales Return" },
	pos: { label: "POS", title: "POS", redirect: "santu-billing" },
};

santu_sale.PERIODS = ["Today", "This Week", "This Month", "Last Month", "This Quarter", "This Year", "Custom"];

santu_sale.utils = {
	format_money(value) {
		return `₹ ${format_currency(value || 0, "INR").replace(/^\D+/, "")}`;
	},

	format_date_user(iso) {
		if (!iso) return "";
		return frappe.datetime.str_to_user(iso);
	},

	to_iso_input(date_str) {
		if (!date_str) return "";
		return frappe.datetime.str_to_user ? frappe.datetime.user_to_str(date_str) : date_str;
	},

	debounce(fn, ms = 300) {
		let timer;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), ms);
		};
	},

	get_view() {
		return (frappe.route_options && frappe.route_options.view) || sessionStorage.getItem("santu_sale_view") || "invoices";
	},

	set_view(view) {
		sessionStorage.setItem("santu_sale_view", view);
		if (frappe.route_options) frappe.route_options.view = view;
	},

	export_csv(transactions) {
		const headers = ["Date", "Invoice No", "Party Name", "Transaction", "Payment Type", "Amount", "Balance", "Status"];
		const rows = transactions.map((t) => [
			frappe.datetime.str_to_user(t.posting_date),
			t.invoice_no,
			t.party_name || "",
			t.transaction,
			t.payment_type || "",
			t.amount,
			t.balance || 0,
			t.status,
		]);
		const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `sale-transactions-${frappe.datetime.get_today()}.csv`;
		a.click();
	},
};
