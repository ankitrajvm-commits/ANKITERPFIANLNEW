/* global santu_txn_msg */
frappe.provide("santu_txn_msg");

santu_txn_msg.VIEWS = {
	message: { title: "Transaction Message", label: "TRANSACTION MESSAGE" },
	whatsapp: { title: "WhatsApp Integration", label: "WHATSAPP" },
	history: { title: "Message History", label: "MESSAGE HISTORY" },
};

santu_txn_msg.TRANSACTION_TYPES = [
	"Sales Transaction", "Purchase Transaction", "Sales Return", "Purchase Return",
	"Payment In", "Payment Out", "Sales Order", "Purchase Order",
	"Estimate / Quotation", "Proforma Invoice", "Delivery Challan", "Cancelled Invoice",
];

santu_txn_msg.utils = {
	get_view() {
		return (frappe.route_options && frappe.route_options.view) || sessionStorage.getItem("santu_txn_msg_view") || "message";
	},
	status_class(status) {
		const s = (status || "").toLowerCase();
		if (s === "sent" || s === "delivered" || s === "read") return "status-ok";
		if (s === "failed") return "status-fail";
		if (s === "queued") return "status-queue";
		return "status-none";
	},
};
