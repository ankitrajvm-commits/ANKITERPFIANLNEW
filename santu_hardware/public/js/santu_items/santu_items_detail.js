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
		const purchase_price = u.format_money(item.purchase_rate || 0);
		const stock_qty_n = parseFloat(item.actual_qty);
		const stock_qty = item.is_stock_item ? u.format_qty_short(item.actual_qty) : "—";
		const stock_neg = item.is_stock_item && stock_qty_n < 0;
		const stock_value_n = parseFloat(item.stock_value) || 0;
		const stock_value = item.is_stock_item
			? (stock_value_n < 0 ? `-${u.format_money(Math.abs(stock_value_n))}` : u.format_money(stock_value_n))
			: "—";
		const qty_class = stock_neg ? "santu-items-qty-out" : u.qty_class_for(item);

		$detail.html(`
			<div class="santu-items-detail-top santu-items-detail-top-split">
				<div class="santu-items-detail-left">
					<div class="santu-items-detail-title-row">
						<h2 class="santu-items-detail-name">${frappe.utils.escape_html((item.item_name || "").toUpperCase())}</h2>
						<button type="button" class="santu-items-share-btn" title="Share">
							<img src="/assets/santu_hardware/images/items/shareOnlineStoreItem.svg" alt="" width="16" height="16">
						</button>
						<button type="button" class="btn btn-danger santu-items-delete-btn" title="Delete Item">DELETE ITEM</button>
					</div>
					<div class="santu-items-price-row">
						<div class="santu-items-price-block">
							<span class="santu-items-price-label">SALE PRICE:</span>
							<span class="santu-items-price-value santu-figures">${sale_price} <small>(excl)</small></span>
						</div>
						<div class="santu-items-price-block">
							<span class="santu-items-price-label">PURCHASE PRICE:</span>
							<span class="santu-items-price-value santu-figures">${purchase_price} <small>(excl)</small></span>
						</div>
					</div>
					${item.is_stock_item ? "" : `<span class="santu-items-service-tag">Service Item — stock not tracked</span>`}
				</div>
				${item.is_stock_item ? `
					<div class="santu-items-detail-right">
						<button type="button" class="btn btn-primary santu-items-adjust-btn">ADJUST ITEM</button>
						<div class="santu-items-stock-block">
							${stock_neg ? `<img class="santu-items-stock-warn" src="/assets/santu_hardware/images/items/out_of_stock_label.png" alt="" width="16" height="16">` : ""}
							<span class="santu-items-stock-label">STOCK QUANTITY:</span>
							<span class="santu-items-stock-value santu-figures ${qty_class}">${stock_qty}</span>
						</div>
						<div class="santu-items-stock-block">
							<span class="santu-items-stock-label">STOCK VALUE:</span>
							<span class="santu-items-stock-value santu-figures ${stock_value_n < 0 ? "santu-items-qty-out" : ""}">${stock_value}</span>
						</div>
					</div>
				` : `<div class="santu-items-detail-right"></div>`}
			</div>
			<div class="santu-items-txn-section">
				<div class="santu-items-txn-header">
					<span class="santu-items-txn-title">TRANSACTIONS</span>
					<div class="santu-items-txn-controls">
						<input type="text" class="santu-items-txn-search form-control" placeholder="Search">
						<button type="button" class="santu-items-txn-export" title="Export to Excel">
							<img src="/assets/santu_hardware/images/items/bulk_update_item_icon.svg" alt="" width="16" height="16">
						</button>
					</div>
				</div>
				<div class="santu-items-txn-table-wrap"></div>
			</div>
		`);

		$detail.find(".santu-items-share-btn").on("click", () => this.share_item(item));
		$detail.find(".santu-items-txn-export").on("click", () => this.export_transactions(item, txns));
		$detail.find(".santu-items-adjust-btn").on("click", () => this.adjust_stock(item));
		$detail.find(".santu-items-delete-btn").on("click", () => this.delete_item($detail, item));

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

		rerender();
	},

	// Opened the raw Stock Reconciliation form until 2026-08-15 — a
	// multi-item accounting document, for what is one number and a reason.
	// api.fix_stock already existed for exactly this and posts the same real
	// Stock Reconciliation underneath.
	adjust_stock(item) {
		const current = flt(item.actual_qty || item.stock_qty || 0);
		const d = new frappe.ui.Dialog({
			title: __("Adjust Stock"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "current",
					options: `<div class="santu-adj-current">${__("In stock now")}: <b>${format_number(current, null, 2)}</b> ${frappe.utils.escape_html(item.stock_uom || "")}</div>`,
				},
				{
					fieldtype: "Float",
					fieldname: "new_qty",
					label: __("Correct quantity"),
					reqd: 1,
					default: current,
					description: __("What the shelf actually has right now"),
				},
				{
					fieldtype: "Select",
					fieldname: "reason",
					label: __("Reason"),
					reqd: 1,
					options: ["Count Correction", "Damage", "Theft", "Other"].join("\n"),
					default: "Count Correction",
				},
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Saving…"));
				frappe
					.xcall("santu_hardware.santu_hardware.api.fix_stock", {
						item_code: item.item_code,
						new_qty: v.new_qty,
						reason: v.reason,
					})
					.then(() => {
						frappe.dom.unfreeze();
						d.hide();
						frappe.show_alert({ message: __("Stock updated"), indicator: "green" });
						if (window.santu_items_page) santu_items_page.reload_list();
					})
					.catch(() => frappe.dom.unfreeze());
			},
		});
		d.show();
	},

	delete_item($detail, item) {
		frappe.confirm(
			__("Delete {0}? This cannot be undone.", [frappe.utils.escape_html(item.item_name || item.item_code)]),
			() => {
				frappe.dom.freeze();
				santu_items.api
					.delete_item(item.item_code)
					.then((res) => {
						frappe.dom.unfreeze();
						if (res && res.disabled) {
							frappe.show_alert({
								message: __("This item has past bills/stock linked to it, so it can't be fully deleted — it has been hidden from billing instead."),
								indicator: "orange",
							});
						} else {
							frappe.show_alert({ message: __("Item deleted"), indicator: "green" });
						}
						if (window.santu_items_page) santu_items_page.reload_list();
					})
					.catch(() => frappe.dom.unfreeze());
			}
		);
	},

	export_transactions(item, txns) {
		if (!txns.length) {
			frappe.show_alert({ message: __("No transactions to export"), indicator: "orange" });
			return;
		}
		const headers = ["Type", "Invoice/Ref No", "Name", "Date", "Quantity", "Price/Unit", "Status"];
		const rows = txns.map((t) => [
			t.type,
			t.invoice_no,
			t.party_name || "",
			frappe.datetime.str_to_user(t.txn_date),
			t.quantity,
			t.rate || 0,
			t.status,
		]);
		const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${item.item_code}-transactions.csv`;
		a.click();
	},

	share_item(item) {
		const url = `${window.location.origin}/app/item/${encodeURIComponent(item.item_code)}`;
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(url).then(() => frappe.show_alert({ message: "Item link copied", indicator: "green" }));
		} else {
			frappe.msgprint(url);
		}
	},

	async show_category($detail, row, is_uncategorized) {
		const u = santu_items.utils;
		const heading = is_uncategorized ? "ITEMS NOT IN ANY CATEGORY" : frappe.utils.escape_html(row.name).toUpperCase();

		$detail.html(`
			<div class="santu-items-detail-top santu-items-cat-top">
				<div>
					<h2 class="santu-items-cat-heading">${heading}</h2>
					<span class="santu-items-cat-count santu-figures">${row.item_count}</span>
				</div>
				${is_uncategorized
					? `<button type="button" class="btn btn-primary santu-items-cat-move-btn">Move To This Category</button>`
					: `<button type="button" class="btn btn-default santu-items-action-edit">Edit Category</button>`}
			</div>
			<div class="santu-items-cat-items-section">
				<div class="santu-items-cat-items-header">
					<span class="santu-items-cat-items-title">ITEMS</span>
					<input type="text" class="santu-items-cat-items-search form-control" placeholder="Search">
				</div>
				<div class="santu-items-cat-items-table-wrap"><div class="santu-dash-loading">Loading...</div></div>
			</div>
		`);

		if (!is_uncategorized) {
			$detail.find(".santu-items-action-edit").on("click", () => {
				const d = new frappe.ui.Dialog({
					title: __("Rename Category"),
					fields: [{ fieldtype: "Data", fieldname: "new_name", label: __("Category name"), reqd: 1, default: row.name }],
					primary_action_label: __("Save"),
					primary_action: (v) => {
						frappe.dom.freeze(__("Saving…"));
						frappe
							.xcall("santu_hardware.santu_hardware.api.rename_item_master", {
								doctype: "Item Group",
								old_name: row.name,
								new_name: v.new_name,
							})
							.then(() => {
								frappe.dom.unfreeze();
								d.hide();
								frappe.show_alert({ message: __("Renamed"), indicator: "green" });
								if (window.santu_items_page) santu_items_page.reload_list();
							})
							.catch(() => frappe.dom.unfreeze());
					},
				});
				d.show();
			});
		}
		$detail.find(".santu-items-cat-move-btn").on("click", () => {
			frappe.route_options = { item_group: row.name };
			frappe.set_route("santu-items");
		});

		const render_items = (rows) => {
			const $wrap = $detail.find(".santu-items-cat-items-table-wrap");
			if (!rows.length) {
				$wrap.html(`<div class="santu-items-unit-conv-empty">No items to show.</div>`);
				return;
			}
			$wrap.html(`
				<table class="santu-items-txn-table santu-items-cat-items-table">
					<thead>
						<tr>
							<th>NAME <span class="santu-items-qty-filter">▽</span></th>
							<th class="num">QUANTITY <span class="santu-items-qty-filter">▽</span></th>
							<th class="num">STOCK VALUE <span class="santu-items-qty-filter">▽</span></th>
						</tr>
					</thead>
					<tbody>
						${rows
							.map(
								(it) => `
							<tr class="santu-items-txn-row" data-code="${frappe.utils.escape_html(it.item_code)}">
								<td>${frappe.utils.escape_html(it.item_name)}</td>
								<td class="num santu-figures">${it.is_stock_item ? u.format_qty(it.quantity, it.stock_uom) : "—"}</td>
								<td class="num santu-figures">${it.is_stock_item ? u.format_money(it.stock_value) : "—"}</td>
							</tr>
						`
							)
							.join("")}
					</tbody>
				</table>
			`);
			$wrap.find(".santu-items-txn-row").on("click", function () {
				frappe.route_options = { item_code: $(this).data("code") };
				frappe.set_route("santu-items");
			});
		};

		let all_items = [];
		try {
			all_items = await santu_items.api.get_category_items(row.name);
		} catch (e) {
			console.error(e);
		}
		render_items(all_items);

		$detail.find(".santu-items-cat-items-search").on(
			"input",
			santu_items.utils.debounce(function () {
				const q = $(this).val().toLowerCase();
				render_items(!q ? all_items : all_items.filter((it) => it.item_name.toLowerCase().includes(q)));
			})
		);
	},

	async show_unit($detail, row) {
		$detail.html(`
			<div class="santu-items-detail-top santu-items-unit-top">
				<h2 class="santu-items-detail-name">${frappe.utils.escape_html((row.uom_name || row.name).toUpperCase())}</h2>
				<button type="button" class="btn btn-primary santu-items-unit-add-conv-btn">+ Add Conversion</button>
			</div>
			<div class="santu-items-unit-conv-section">
				<div class="santu-items-unit-conv-header">
					<span class="santu-items-unit-conv-title">UNITS</span>
					<input type="text" class="santu-items-unit-conv-search form-control" placeholder="Search">
				</div>
				<div class="santu-items-unit-conv-table-head">
					<span>UNIT</span>
					<span>CONVERSION</span>
				</div>
				<div class="santu-items-unit-conv-list"><div class="santu-dash-loading">Loading...</div></div>
			</div>
		`);

		$detail.find(".santu-items-unit-add-conv-btn").on("click", () => this.open_add_conversion_dialog($detail, row));

		const $convList = $detail.find(".santu-items-unit-conv-list");
		let all_rows = [];

		const render_conv_rows = (search) => {
			const q = (search || "").toLowerCase();
			const filtered = !q
				? all_rows
				: all_rows.filter(
						(r) => r.from_uom.toLowerCase().includes(q) || r.to_uom.toLowerCase().includes(q)
				  );
			if (!filtered.length) {
				$convList.html(`<div class="santu-items-unit-conv-empty">No Rows To Show</div>`);
				return;
			}
			$convList.html(
				filtered
					.map((r) => {
						const other = r.from_uom === row.name ? r.to_uom : r.from_uom;
						const factor = r.from_uom === row.name ? r.value : (1 / r.value).toFixed(4);
						return `
							<div class="santu-items-unit-conv-row">
								<span>${frappe.utils.escape_html(other)}</span>
								<span class="santu-figures">1 ${frappe.utils.escape_html(row.name)} = ${factor} ${frappe.utils.escape_html(other)}</span>
							</div>
						`;
					})
					.join("")
			);
		};

		try {
			all_rows = await santu_items.api.get_uom_conversions(row.name);
		} catch (e) {
			console.error(e);
		}
		render_conv_rows("");

		$detail.find(".santu-items-unit-conv-search").on(
			"input",
			santu_items.utils.debounce(function () {
				render_conv_rows($(this).val());
			})
		);
	},

	open_add_conversion_dialog($detail, row) {
		const d = new frappe.ui.Dialog({
			title: __("Add Conversion for {0}", [row.uom_name || row.name]),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "to_uom",
					label: "Convert To",
					options: "UOM",
					reqd: 1,
				},
				{
					fieldtype: "Float",
					fieldname: "value",
					label: `1 ${row.name} =`,
					reqd: 1,
				},
			],
			primary_action_label: __("Add"),
			primary_action: async (values) => {
				try {
					await santu_items.api.add_uom_conversion(row.name, values.to_uom, values.value);
					d.hide();
					frappe.show_alert({ message: __("Conversion added"), indicator: "green" });
					this.show_unit($detail, row);
				} catch (e) {
					console.error(e);
				}
			},
		});
		d.show();
	},
};
