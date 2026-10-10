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

// erpnext's financial-statement family (Profit and Loss / Cash Flow / Balance
// Sheet) all need filter_based_on + from_fiscal_year/to_fiscal_year to run —
// our generic filter renderer never sees these since they live only in each
// report's .js filter script, not the Report doctype's own filters meta.
santu_reports.fiscal_year_filters = (init) => ({
	filter_based_on: "Fiscal Year",
	periodicity: "Yearly",
	from_fiscal_year: init.fiscal_year,
	to_fiscal_year: init.fiscal_year,
});

santu_reports.REPORTS = [
	// Transaction
	// "sale"/"purchase" embed the real Sale/Purchase screens verbatim
	// (2026-08-15: "report ko ui aise rakho same to same" — Vyapar's own
	// Reports > Sale is literally its Sale Invoices screen, not a re-skinned
	// generic report) instead of going through the generic ERPNext report
	// wrapper below, which showed POS Register's raw columns.
	{ id: "sale", label: "Sale", category: "transaction", type: "embed", embed: "sale", view: "invoices" },
	{ id: "purchase", label: "Purchase", category: "transaction", type: "embed", embed: "purchase", view: "bills" },
	// less_used: true tucks a report under that category's "More ▾" toggle
	// instead of showing it in the main list (2026-08-17: "jo jyada use nh
	// hone wale hai use report section me hi more me daal do") — these are
	// accountant/CA-level statements a small hardware shop's own day-to-day
	// doesn't touch, still one click away rather than removed.
	{ id: "day_book", label: "Day Book", category: "transaction", type: "erpnext", report_name: "General Ledger", less_used: true },
	{ id: "all_transactions", label: "All Transactions", category: "transaction", type: "erpnext", report_name: "General Ledger", less_used: true },
	{ id: "profit_and_loss", label: "Profit And Loss", category: "transaction", type: "erpnext", report_name: "Profit and Loss Statement", is_tree: true, parent_field: "account", extra_filters: santu_reports.fiscal_year_filters, less_used: true },
	{ id: "bill_wise_profit", label: "Bill Wise Profit", category: "transaction", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Invoice" } },
	{ id: "cash_flow", label: "Cash Flow", category: "transaction", type: "erpnext", report_name: "Cash Flow", is_tree: true, parent_field: "account", extra_filters: santu_reports.fiscal_year_filters, less_used: true },
	{ id: "trial_balance", label: "Trial Balance Report", category: "transaction", type: "erpnext", report_name: "Trial Balance", extra_filters: (init) => ({ fiscal_year: init.fiscal_year }), less_used: true },
	{ id: "balance_sheet", label: "Balance Sheet", category: "transaction", type: "erpnext", report_name: "Balance Sheet", is_tree: true, parent_field: "account", extra_filters: santu_reports.fiscal_year_filters, less_used: true },

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
	{
		id: "gstr3b",
		label: "GSTR 3B",
		category: "gst",
		type: "erpnext",
		report_name: "GSTR-3B Details",
		extra_filters: (init) => {
			const today = frappe.datetime.get_today();
			const d = new Date(today);
			const month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
			return {
				company_gstin: init.company_gstin || "",
				year: String(d.getFullYear()),
				month_or_quarter: month_names[d.getMonth()],
				filter_by: "ITC Claim Period",
				sub_section: "4",
			};
		},
	},
	{ id: "gstr9", label: "GSTR 9", category: "gst", type: "config", config_message: "GSTR-9 annual return is not available as a standard report in india_compliance. Please file GSTR-9 through the GST portal or consult your CA.", less_used: true },
	{ id: "sale_summary_hsn", label: "Sale Summary By HSN", category: "gst", type: "erpnext", report_name: "HSN-wise-summary of outward supplies" },
	{ id: "sac_report", label: "SAC Report", category: "gst", type: "erpnext", report_name: "HSN-wise-summary of outward supplies" },
	{ id: "export_tally", label: "Exports To Tally (XML / Excel)", category: "transaction", type: "embed", embed: "utilities", view: "export_tally" },
	{ id: "gst_export_tally", label: "Exports To Tally (XML / Excel)", category: "gst", type: "embed", embed: "utilities", view: "export_tally" },

	// Stock
	// Low Stock Summary merged into this one (2026-08-17: "stock and low
	// stock ko merge kr do") — the embedded screen already has its own
	// "Only low stock" checkbox, so a separate entry only for that filter
	// pre-set was a second path to the same screen.
	{ id: "stock_summary", label: "Stock Summary", category: "stock", type: "embed", embed: "stock" },
	{ id: "item_report_by_party", label: "Item Report By Party", category: "stock", type: "erpnext", report_name: "Item-wise Sales Register" },
	{ id: "item_wise_pl", label: "Item Wise Profit And Loss", category: "stock", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Item Code" } },
	{ id: "item_category_pl", label: "Item Category Wise Profit And Loss", category: "stock", type: "erpnext", report_name: "Gross Profit", extra_filters: { group_by: "Item Group" } },
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
	{
		id: "bank_statement",
		label: "Bank Statement",
		category: "business",
		type: "erpnext",
		report_name: "Bank Reconciliation Statement",
		extra_filters: (init) => ({ bank_account: init.bank_account || "" }),
		less_used: true,
	},
	{ id: "discount_report", label: "Discount Report", category: "business", type: "custom", method: "discount_report" },

	// Taxes
	{
		id: "gst_report",
		label: "GST Report",
		category: "taxes",
		type: "erpnext",
		report_name: "GST Account-wise Summary",
		extra_filters: (init) => {
			const d = santu_reports.utils.default_dates();
			return {
				date_range: [d.from_date, d.to_date],
				voucher_type: "Sales",
			};
		},
	},
	{
		id: "gst_rate_report",
		label: "GST Rate Report",
		category: "taxes",
		type: "erpnext",
		report_name: "GST Tax Rate-wise Summary",
		extra_filters: (init) => {
			const d = santu_reports.utils.default_dates();
			return {
				date_range: [d.from_date, d.to_date],
				voucher_type: "Sales Invoice",
			};
		},
	},
	// party_type is required by the report itself (it crashed with "can only
	// concatenate str (not NoneType)" without it -- full-app test 2026-09-19).
	// 27EQ is the TCS return: tax collected from CUSTOMERS.
	{ id: "form_27eq", label: "Form No. 27EQ", category: "taxes", type: "erpnext", report_name: "TDS Computation Summary-India", extra_filters: { party_type: "Customer" }, less_used: true },
	{ id: "tcs_receivable", label: "TCS Receivable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Customer" }, less_used: true },
	{ id: "tds_payable", label: "TDS Payable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Supplier" }, less_used: true },
	{ id: "tds_receivable", label: "TDS Receivable", category: "taxes", type: "erpnext", report_name: "Tax Withholding Details-India", extra_filters: { party_type: "Customer" }, less_used: true },

	// Expense
	{ id: "expense", label: "Expense", category: "expense", type: "custom", method: "expense" },
	{ id: "expense_category", label: "Expense Category Report", category: "expense", type: "custom", method: "expense_category" },
	{ id: "expense_item", label: "Expense Item Report", category: "expense", type: "custom", method: "expense_item" },

	// Sale Order
	{ id: "sale_orders", label: "Sale Orders", category: "sale_order", type: "erpnext", report_name: "Sales Order Analysis" },
	{ id: "sale_order_item", label: "Sale Order Item", category: "sale_order", type: "erpnext", report_name: "Sales Order Analysis" },

	// Loan
	{ id: "loan_statement", label: "Loan Statement", category: "loan", type: "config", config_message: "Loan tracking is not switched on for this shop. Until it is, open the General Ledger report and filter it by your loan account to see the same figures.", less_used: true },
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
