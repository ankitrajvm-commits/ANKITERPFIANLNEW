/* global frappe */
frappe.provide("santu_items");

santu_items.api = {
	_detail_cache: new Map(),
	_txn_cache: new Map(),
	_list_cache: new Map(),

	clear_item_cache(item_code) {
		this._detail_cache.delete(item_code);
		this._txn_cache.delete(item_code);
	},

	clear_list_cache() {
		this._list_cache.clear();
	},

	async get_items_list(params, force = false) {
		const key = JSON.stringify(params || {});
		if (!force && this._list_cache.has(key)) {
			return this._list_cache.get(key);
		}
		const rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_vyapar_items_list", params);
		this._list_cache.set(key, rows);
		return rows;
	},

	async get_item_detail(item_code, force = false) {
		if (!force && this._detail_cache.has(item_code)) {
			return this._detail_cache.get(item_code);
		}
		const item = await frappe.xcall("santu_hardware.santu_hardware.api.get_item_detail", { item_code });
		this._detail_cache.set(item_code, item);
		return item;
	},

	async get_item_transactions(item_code, force = false) {
		if (!force && this._txn_cache.has(item_code)) {
			return this._txn_cache.get(item_code);
		}
		const txns = await frappe.xcall("santu_hardware.santu_hardware.api.get_item_transactions", {
			item_code,
		});
		this._txn_cache.set(item_code, txns);
		return txns;
	},

	async get_item_groups(search) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_item_groups_list", {
			search: search || null,
		});
	},

	async get_uoms(search) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_uom_list", {
			search: search || null,
		});
	},
};
