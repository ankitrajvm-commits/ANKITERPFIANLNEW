/* global frappe, santu_items */
frappe.provide("santu_items");

santu_items.detail = {
	_request_id: 0,

	async show($detail, item_code, { on_transactions_ready } = {}) {
		const request_id = ++this._request_id;
		$detail.html(`<div class="santu-items-detail-loading"><div class="santu-dash-loading">Loading...</div></div>`);

		try {
			const [item, txns] = await Promise.all([
				santu_items.api.get_item_detail(item_code),
				santu_items.api.get_item_transactions(item_code),
			]);

			if (request_id !== this._request_id) return;

			this.render($detail, item, txns);
			if (on_transactions_ready) on_transactions_ready(txns, item);
		} catch (e) {
			if (request_id !== this._request_id) return;
			$detail.html(`<div class="santu-items-empty">Could not load item details.</div>`);
			console.error(e);
		}
	},

	render($detail, item, txns) {
		const u = santu_items.utils;
		const sale_price = u.format_money(item.selling_rate || 0);
		const purchase_price = item.purchase_rate ? u.format_money(item.purchase_rate) : "—";
		const stock_qty = item.is_stock_item ? u.format_qty(item.available_qty, item.stock_uom) : "—";
		const stock_value = item.is_stock_item ? u.format_money(item.stock_value) : "—";
		const stock_qty_class = u.qty_class_for(item);

		$detail.html(`
			<div class="santu-items-detail-top">
				<div class="santu-items-detail-title-row">
					<h2 class="santu-items-detail-name">${frappe.utils.escape_html(item.item_name)}</h2>
					<button type="button" class="santu-items-share-btn" title="Share item link">↗</button>
				</div>
				<div class="santu-items-price-row">
					<div class="santu-items-price-block">
						<span class="santu-items-price-label">SALE PRICE</span>
						<span class="santu-items-price-value santu-figures">${sale_price} <small>(excl)</small></span>
					</div>
					<div class="santu-items-price-block">
						<span class="santu-items-price-label">PURCHASE PRICE</span>
						<span class="santu-items-price-value santu-figures">${purchase_price} <small>(excl)</small></span>
					</div>
				</div>
				<div class="santu-items-stock-row">
					${item.is_stock_item ? `
						<div class="santu-items-stock-block">
							<span class="santu-items-stock-label">STOCK QUANTITY</span>
							<span class="santu-items-stock-value santu-figures ${stock_qty_class}">${stock_qty}</span>
						</div>
						<div class="santu-items-stock-block">
							<span class="santu-items-stock-label">STOCK VALUE</span>
							<span class="santu-items-stock-value santu-figures santu-items-qty-ok">${stock_value}</span>
						</div>
						<button type="button" class="btn santu-items-adjust-btn">⚖ ADJUST ITEM</button>
					` : `<span class="santu-items-service-tag">Service Item — stock not tracked</span>`}
				</div>
			</div>
			<div class="santu-items-txn-section">
				<div class="santu-items-txn-header">
					<span class="santu-items-txn-title">TRANSACTIONS</span>
					<div class="santu-items-txn-controls">
						<select class="santu-items-txn-type-filter form-control">
							<option value="">All Types</option>
							<option value="Purchase">Purchase</option>
							<option value="Sale">Sale</option>
							<option value="Material Receipt">Material Receipt</option>
							<option value="Material Issue">Material Issue</option>
							<option value="Stock">Stock</option>
						</select>
						<input type="text" class="santu-items-txn-search form-control" placeholder="Search">
					</div>
				</div>
				<div class="santu-items-txn-table-wrap"></div>
			</div>
		`);

		$detail.find(".santu-items-share-btn").on("click", () => this.share_item(item));
		$detail.find(".santu-items-adjust-btn").on("click", () => this.adjust_stock(item));
		$detail.find(".santu-items-detail-name").on("dblclick", () => frappe.set_route("Form", "Item", item.item_code));

		const $txn_wrap = $detail.find(".santu-items-txn-table-wrap");
		const state = { txns, item, sort_key: "txn_date", sort_dir: "desc", type_filter: "", search: "" };

		const rerender = () => {
			const filtered = santu_items.transactions.filter_rows(state);
			const sorted = santu_items.transactions.sort_rows(filtered, state.sort_key, state.sort_dir);
			santu_items.transactions.render($txn_wrap, sorted, item, {
				on_sort: (key) => {
					if (state.sort_key === key) {
						state.sort_dir = state.sort_dir === "asc" ? "desc" : "asc";
					} else {
						state.sort_key = key;
						state.sort_dir = "desc";
					}
					rerender();
				},
				sort_key: state.sort_key,
				sort_dir: state.sort_dir,
			});
		};

		$detail.find(".santu-items-txn-search").on(
			"input",
			santu_items.utils.debounce(function () {
				state.search = $(this).val().toLowerCase();
				rerender();
			})
		);
		$detail.find(".santu-items-txn-type-filter").on("change", function () {
			state.type_filter = $(this).val();
			rerender();
		});

		rerender();
	},

	adjust_stock(item) {
		frappe.new_doc("Stock Reconciliation", {
			items: [{ item_code: item.item_code, warehouse: item.warehouse }],
		});
	},

	share_item(item) {
		const url = `${window.location.origin}/app/item/${encodeURIComponent(item.item_code)}`;
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(url).then(() => frappe.show_alert({ message: "Item link copied", indicator: "green" }));
		} else {
			frappe.msgprint(url);
		}
	},

	show_category($detail, row) {
		$detail.html(`
			<div class="santu-items-detail-top">
				<h2 class="santu-items-detail-name">${frappe.utils.escape_html(row.name)}</h2>
				<p class="santu-items-detail-sub">${row.item_count} items in this category</p>
			</div>
			<div class="santu-items-actions">
				<button type="button" class="btn btn-default santu-items-action-edit">Edit Category</button>
			</div>
		`);
		$detail.find(".santu-items-action-edit").on("click", () => frappe.set_route("Form", "Item Group", row.name));
	},

	show_unit($detail, row) {
		$detail.html(`
			<div class="santu-items-detail-top">
				<h2 class="santu-items-detail-name">${frappe.utils.escape_html(row.uom_name || row.name)}</h2>
				<p class="santu-items-detail-sub">${row.must_be_whole_number ? "Whole numbers only" : "Decimal allowed"}</p>
			</div>
			<div class="santu-items-actions">
				<button type="button" class="btn btn-default santu-items-action-edit">Edit Unit</button>
			</div>
		`);
		$detail.find(".santu-items-action-edit").on("click", () => frappe.set_route("Form", "UOM", row.name));
	},
};
