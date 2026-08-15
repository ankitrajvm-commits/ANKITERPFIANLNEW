/* global frappe */
frappe.provide("santu_items");

santu_items.utils = {
	SELECTED_KEY: "santu_items_selected",

	format_qty_short(qty) {
		if (qty === null || qty === undefined) return "—";
		const n = parseFloat(qty);
		return Number.isInteger(n) ? String(n) : n.toFixed(2);
	},

	format_qty(qty, uom) {
		if (qty === null || qty === undefined) return "—";
		const n = parseFloat(qty);
		const formatted = Number.isInteger(n) ? String(n) : n.toFixed(2);
		return uom ? `${formatted} ${uom}` : formatted;
	},

	format_currency_plain(value) {
		return format_currency(value || 0, "INR").replace(/^\D+/, "");
	},

	format_money(value) {
		if (value === null || value === undefined || value === "") return "—";
		return `₹ ${this.format_currency_plain(value)}`;
	},

	qty_class_for(row) {
		if (!row.is_stock_item) return "santu-items-qty-na";
		if (row.stock_status === "out" || (row.available_qty !== null && row.available_qty < 0)) {
			return "santu-items-qty-out";
		}
		if (row.stock_status === "low") return "santu-items-qty-low";
		return "santu-items-qty-ok";
	},

	get_selected_code() {
		try {
			return sessionStorage.getItem(this.SELECTED_KEY);
		} catch (e) {
			return null;
		}
	},

	set_selected_code(code) {
		try {
			if (code) sessionStorage.setItem(this.SELECTED_KEY, code);
			else sessionStorage.removeItem(this.SELECTED_KEY);
		} catch (e) {
			/* ignore */
		}
	},

	debounce(fn, ms = 250) {
		let timer;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), ms);
		};
	},
};
