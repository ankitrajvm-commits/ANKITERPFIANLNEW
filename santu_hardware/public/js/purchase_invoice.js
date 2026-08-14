// UX_STRATEGY.md SS4.3 / 1.3: ERPNext's default Purchase Order -> Purchase
// Receipt -> Purchase Invoice chain exists for organizations where
// different people request, receive, and invoice. This shop has one person
// doing all three the moment the truck arrives, so default straight to the
// single-document path: update_stock=1 makes one Purchase Invoice post both
// the stock receipt AND the accounting entry together (a native ERPNext
// mechanism, not something built from scratch) — the multi-document chain
// stays available in Admin Mode for the rare case it's ever actually needed,
// it's just never the default.
frappe.ui.form.on("Purchase Invoice", {
	onload: function (frm) {
		if (!frm.doc.__islocal) return;

		if (!frm.doc.update_stock) {
			frm.set_value("update_stock", 1);
		}

		if (!frm.doc.set_warehouse) {
			frappe.db
				.get_list("Warehouse", { filters: { is_group: 0, disabled: 0 }, limit: 2 })
				.then((warehouses) => {
					if (warehouses.length === 1) {
						frm.set_value("set_warehouse", warehouses[0].name);
					}
				});
		}
	},
});
