/* global frappe */
frappe.provide("santu_sale");

santu_sale.api = {
	_cache: new Map(),

	_cache_key(params) {
		return JSON.stringify(params);
	},

	async fetch(params, force = false) {
		const key = this._cache_key(params);
		if (!force && this._cache.has(key)) return this._cache.get(key);
		const data = await frappe.xcall("santu_hardware.santu_hardware.api.get_sale_dashboard_data", params);
		this._cache.set(key, data);
		return data;
	},

	clear_cache() {
		this._cache.clear();
	},
};
