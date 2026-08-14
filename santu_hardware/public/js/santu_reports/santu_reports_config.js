/* global santu_reports, frappe */
frappe.provide("santu_reports");

santu_reports.CATEGORIES = [
	{ id: "transaction", label: "Transaction report" },
	{ id: "party", label: "Party report" },
	{ id: "gst", label: "GST reports" },
	{ id: "stock", label: "Item / Stock report" },
	{ id: "business", label: "Business Status" },
	{ id: "taxes", label: "Taxes" },
	{ id: "expense", label: "Expense report" },
	{ id: "sale_order", label: "Sale Order report" },
	{ id: "loan", label: "Loan Accounts" },
];

santu_reports.REPORTS = [
	// Transaction
	{ id: "sale", label: "Sale", category: "transaction", type: "erpnext", report_name: "POS Register" },
	{ id: "purchase", label: "Purchase", category: "transaction", type: "erpnext", report_name: "Purchase Register" },
	{ id: "day_book", label: "Day Book", category: "transaction", type: "erpnext", report_name: "General Ledger" },
	{ id: "all_transactions", label: "All Transactions", category: "transaction", type: "erpnext", report_name: "General Ledger" },
	{ id: "profit_and_loss", label: "Profit And Loss", category: "transaction", type: "erpnext", report_name: "Profit and Loss Statement", is_tree: true, parent_field: "account" },
	{ id: "bill_wise_profit", label: "Bill Wise Profit", category: "transaction", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Invoice" } },
	{ id: "cash_flow", label: "Cash Flow", category: "transaction", type: "erpnext", report_name: "Cash Flow", is_tree: true, parent_field: "account" },
	{ id: "trial_balance", label: "Trial Balance Report", category: "transaction", type: "erpnext", report_name: "Trial Balance" },
	{ id: "balance_sheet", label: "Balance Sheet", category: "transaction", type: "erpnext", report_name: "Balance Sheet", is_tree: true, parent_field: "account" },

	// Party
	{ id: "party_statement", label: "Party Statement", category: "party", type: "erpnext", report_name: "General Ledger", extra_filters: { party_type: "Customer" } },
	{ id: "party_wise_pl", label: "Party Wise Profit & Loss", category: "party", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Customer" } },
	{ id: "all_parties", label: "All Parties", category: "party", type: "custom", method: "all_parties" },
	{ id: "party_report_by_item", label: "Party Report By Item", category: "party", type: "erpnext", report_name: "Item-wise Sales Register" },
	{ id: "sale_purchase_by_party", label: "Sale Purchase By Party", category: "party", type: "custom", method: "sale_purchase_by_party" },
	{ id: "sale_purchase_party_group", label: "Sale Purchase By Party Group", category: "party", type: "custom", method: "sale_purchase_party_group" },

	// GST
	{ id: "gstr1", label: "GSTR 1", category: "gst", type: "erpnext", report_name: "GSTR-1" },
	{ id: "gstr2", label: "GSTR 2", category: "gst", type: "erpnext", report_name: "GST Purchase Register" },
	{ id: "gstr3b", label: "GSTR 3B", category: "gst", type: "erpnext", report_name: "GSTR-3B Details" },
	{ id: "gstr9", label: "GSTR 9", category: "gst", type: "config", config_message: "GSTR-9 annual return is not available as a standard report in india_compliance. Please file GSTR-9 through the GST portal or consult your CA." },
	{ id: "sale_summary_hsn", label: "Sale Summary By HSN", category: "gst", type: "erpnext", report_name: "HSN-wise-summary of outward supplies" },
	{ id: "sac_report", label: "SAC Report", category: "gst", type: "erpnext", report_name: "HSN-wise-summary of outward supplies" },

	// Stock
	{ id: "stock_summary", label: "Stock Summary", category: "stock", type: "erpnext", report_name: "Stock Balance" },
	{ id: "item_report_by_party", label: "Item Report By Party", category: "stock", type: "erpnext", report_name: "Item-wise Sales Register" },
	{ id: "item_wise_pl", label: "Item Wise Profit And Loss", category: "stock", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Item Code" } },
	{ id: "item_category_pl", label: "Item Category Wise Profit And Loss", category: "stock", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Item Group" } },
	{ id: "low_stock", label: "Low Stock Summary", category: "stock", type: "erpnext", report_name: "Item Shortage Report" },
	{ id: "stock_detail", label: "Stock Detail", category: "stock", type: "erpnext", report_name: "Stock Ledger" },
	{ id: "item_detail", label: "Item Detail", category: "stock", type: "custom", method: "item_detail", custom_filters: [
		{ fieldname: "from_date", label: "From Date", fieldtype: "Date" },
		{ fieldname: "to_date", label: "To Date", fieldtype: "Date" },
		{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company" },
		{ fieldname: "item", label: "Item", fieldtype: "Link", options: "Item" },
	]},
	{ id: "sale_purchase_item_category", label: "Sale/Purchase Report By Item Category", category: "stock", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Item Group" } },
	{ id: "stock_summary_item_category", label: "Stock Summary Report By Item Category", category: "stock", type: "erpnext", report_name: "Stock Balance" },
	{ id: "item_wise_discount", label: "Item Wise Discount", category: "stock", type: "custom", method: "discount_report" },

	// Business
	{ id: "bank_statement", label: "Bank Statement", category: "business", type: "erpnext", report_name: "Bank Reconciliation Statement" },
	{ id: "discount_report", label: "Discount Report", category: "business", type: "custom", method: "discount_report" },

	// Taxes
	{ id: "gst_report", label: "GST Report", category: "taxes", type: "erpnext", report_name: "GST Account-wise Summary" },
	{ id: "gst_rate_report", label: "GST Rate Report", category: "taxes", type: "erpnext", report_name: "GST Tax Rate-wise Summary" },
	{ id: "form_27eq", label: "Form No. 27EQ", category: "taxes", type: "erpnext", report_name: "TDS Computation Summary-India" },
	{ id: "tcs_receivable", label: "TCS Receivable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Customer" } },
	{ id: "tds_payable", label: "TDS Payable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Supplier" } },
	{ id: "tds_receivable", label: "TDS Receivable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Customer" } },

	// Expense
	{ id: "expense", label: "Expense", category: "expense", type: "custom", method: "expense" },
	{ id: "expense_category", label: "Expense Category Report", category: "expense", type: "custom", method: "expense_category" },
	{ id: "expense_item", label: "Expense Item Report", category: "expense", type: "custom", method: "expense_item" },

	// Sale Order
	{ id: "sale_orders", label: "Sale Orders", category: "sale_order", type: "erpnext", report_name: "Sales Order Analysis" },
	{ id: "sale_order_item", label: "Sale Order Item", category: "sale_order", type: "erpnext", report_name: "Sales Order Analysis" },

	// Loan
	{ id: "loan_statement", label: "Loan Statement", category: "loan", type: "config", config_message: "Loan Statement requires the ERPNext Lending app. Use General Ledger filtered by your loan account, or install the Lending app from Frappe." },
];

santu_reports.utils = {
	get_report(id) {
		return santu_reports.REPORTS.find((r) => r.id === id);
	},

	get_reports_by_category(cat_id) {
		return santu_reports.REPORTS.filter((r) => r.category === cat_id);
	},

	get_selected_id() {
		return sessionStorage.getItem("santu_reports_selected") || "sale";
	},

	set_selected_id(id) {
		sessionStorage.setItem("santu_reports_selected", id);
	},

	default_dates() {
		const today = frappe.datetime.get_today();
		const parts = today.split("-");
		const from = `${parts[0]}-${parts[1]}-01`;
		return { from_date: from, to_date: today };
	},

	debounce(fn, ms = 300) {
		let timer;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), ms);
		};
	},

	format_cell(value, col) {
		if (value === null || value === undefined || value === "") return "";
		if (col && col.fieldtype === "Currency") {
			return format_currency(value, frappe.defaults.get_default("currency") || "INR");
		}
		if (col && col.fieldtype === "Date") {
			return frappe.datetime.str_to_user(value);
		}
		if (col && col.fieldtype === "Float" && typeof value === "number") {
			return flt(value, 2);
		}
		return value;
	},
};
