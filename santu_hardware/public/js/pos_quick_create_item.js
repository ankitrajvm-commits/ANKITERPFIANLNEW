// "If the searched product does not exist in the inventory, I should be
// able to create it instantly without leaving the billing screen"
// (2026-07-31 direct request) — a minimal dialog (Name, Selling Price
// required, Category/Unit/Barcode optional), created item auto-added to
// the current bill and available for every future sale.
//
// `pos_item_selector.js` (native) has no empty-state at all — when a
// search returns zero results, `render_item_list([])` just leaves the
// container blank (confirmed by reading the method: it's a plain
// `.forEach` over `items` with no `if (!items.length)` branch). Wrapping
// `render_item_list` rather than rewriting search/filtering keeps this
// purely additive — the native filtering logic is untouched, this only
// adds what happens when it returns nothing.
(function () {
	const wait_for_selector = setInterval(() => {
		if (!window.erpnext || !erpnext.PointOfSale || !erpnext.PointOfSale.ItemSelector) return;
		clearInterval(wait_for_selector);
		patch_item_selector();
	}, 200);

	function patch_item_selector() {
		const proto = erpnext.PointOfSale.ItemSelector.prototype;
		const original_render = proto.render_item_list;

		proto.render_item_list = function (items) {
			// Core inconsistency (`point_of_sale.py` `get_items`, confirmed by
			// reading it): returns `{items: [...]}` when the SQL query finds
			// rows, but a BARE `[]` when it finds none — `filter_items`'s
			// `const { items } = message` then silently gets `items =
			// undefined` for the "nothing found" case, and the ORIGINAL
			// `render_item_list`'s `.forEach` throws on that before this
			// wrapper's own empty-state code below ever runs (confirmed
			// live: the container stayed blank, no error visible in the
			// console because the throw happened inside a promise chain
			// with no `.catch`). Coercing to an array here is a one-line
			// defensive fix scoped to this wrapper — not a core patch.
			items = Array.isArray(items) ? items : [];
			original_render.call(this, items);
			if (items.length) return;

			const search_term = (this.search_field && this.search_field.get_value()) || "";
			this.$items_container.html(`
				<div class="santu-no-items-found" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 20px;text-align:center;color:var(--gray-600);">
					<div>${
						search_term
							? __('No item found for "{0}"', [frappe.utils.escape_html(search_term)])
							: __("No items found")
					}</div>
					<div class="btn btn-primary btn-sm santu-create-item-btn">+ ${__("Create New Item")}</div>
				</div>
			`);

			this.$items_container.find(".santu-create-item-btn").on("click", () => {
				santu_open_quick_create_item_dialog(search_term, this);
			});
		};
	}

	function santu_open_quick_create_item_dialog(prefill_name, item_selector) {
		const d = new frappe.ui.Dialog({
			title: __("Create New Item"),
			fields: [
				{
					fieldname: "item_name",
					fieldtype: "Data",
					label: __("Product Name"),
					reqd: 1,
					default: prefill_name || "",
				},
				{
					fieldname: "selling_price",
					fieldtype: "Currency",
					label: __("Selling Price"),
					reqd: 1,
				},
				{
					fieldname: "col_break_1",
					fieldtype: "Column Break",
				},
				{
					fieldname: "item_group",
					fieldtype: "Link",
					options: "Item Group",
					label: __("Category"),
					description: __("Defaults to \"Products\" if left blank."),
				},
				{
					fieldname: "uom",
					fieldtype: "Link",
					options: "UOM",
					label: __("Unit"),
					default: "Nos",
				},
				{
					fieldname: "barcode",
					fieldtype: "Data",
					label: __("Barcode"),
				},
				{
					fieldname: "gst_hsn_code",
					fieldtype: "Link",
					options: "GST HSN Code",
					label: __("HSN/SAC Code"),
					description: __("Required for GST — this shop has HSN validation on. Ask the owner if unsure; it can be fixed later from the Item."),
				},
			],
			primary_action_label: __("Create & Add to Bill"),
			primary_action: async (values) => {
				d.disable_primary_action();
				try {
					const doc = cur_pos && cur_pos.frm ? cur_pos.frm.doc : {};
					const new_item = await frappe.xcall(
						"santu_hardware.santu_hardware.api.quick_create_item",
						{
							item_name: values.item_name,
							selling_price: values.selling_price,
							item_group: values.item_group,
							uom: values.uom,
							barcode: values.barcode,
							gst_hsn_code: values.gst_hsn_code,
							price_list: doc.selling_price_list,
						}
					);

					await cur_pos.on_cart_update({
						field: "qty",
						value: 1,
						item: {
							item_code: new_item.item_code,
							rate: new_item.rate,
							uom: new_item.uom,
							stock_uom: new_item.uom,
							batch_no: null,
							serial_no: null,
						},
					});

					frappe.show_alert({
						message: __("{0} created and added to the bill", [new_item.item_name]),
						indicator: "green",
					});

					d.hide();
					item_selector.search_field.set_value("");
					item_selector.filter_items({ search_term: "" });
				} catch (err) {
					frappe.msgprint({
						title: __("Couldn't Create Item"),
						message: err.message || String(err),
						indicator: "red",
					});
				} finally {
					d.enable_primary_action();
				}
			},
		});

		d.show();
	}
})();
