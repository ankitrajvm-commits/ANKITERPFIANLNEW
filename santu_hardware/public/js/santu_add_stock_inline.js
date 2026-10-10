/**
 * "Available: 3 Pcs" on a bill row is a button now — tap it and put the
 * stock in, without leaving the bill you are in the middle of writing
 * (2026-09-25: "sale ya estimate se available pe click krke items stocks ko
 * add kr ske").
 *
 * Posts through api.receive_stock_simple — the very same call the Receive
 * Stock screen uses, so this is a shortcut to that screen, not a second way
 * of putting stock on the shelf. It ADDS to what is there (never sets a
 * total): "10 aur aaye", not "ab 10 hain".
 */
(function () {
	window.santu_add_stock = {
		// "Available: N" was written onto a row once, when the item was added,
		// and never updated again — so stock received while a bill sat open
		// never showed (2026-09-25: "pos bill me qty update nh ho rha hai").
		// Call this with every row on screen; it refreshes them in one request.
		async refresh(rows, opts) {
			opts = opts || {};
			const list = (rows || []).filter((r) => r && r.item_code);
			if (!list.length) return false;
			let live;
			try {
				live = await frappe.xcall("santu_hardware.santu_hardware.api.get_available_qty", {
					item_codes: [...new Set(list.map((r) => r.item_code))],
				});
			} catch (e) {
				return false; // a stale number is better than a broken screen
			}
			let changed = false;
			list.forEach((r) => {
				const q = live[r.item_code];
				if (q != null && flt(q) !== flt(r.available_qty)) {
					r.available_qty = flt(q);
					changed = true;
				}
			});
			if (changed && opts.after) opts.after();
			return changed;
		},

		// row: the bill line ({item_code, item_name, uom, available_qty}).
		// opts.after(new_qty) runs once the stock is really in.
		open(row, opts) {
			opts = opts || {};
			if (!row || !row.item_code) {
				frappe.show_alert({ message: __("Is line me item nahi hai."), indicator: "orange" });
				return;
			}
			const unit = frappe.utils.escape_html((window.santu_uom && santu_uom.abbr(row.uom)) || row.uom || "");
			const have = flt(row.available_qty);

			const d = new frappe.ui.Dialog({
				title: __("Stock chadhaiye"),
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "head",
						options: `<p style="margin:0 0 10px;font-size:14px;">
								<b>${frappe.utils.escape_html(row.item_name || row.item_code)}</b><br>
								<span style="color:#475569;">${__("Abhi stock:")} <b>${format_number(have, null, 0)} ${unit}</b></span>
							</p>`,
					},
					{
						fieldtype: "Float",
						fieldname: "qty",
						label: __("Kitna maal aaya?"),
						description: __("Jitna aaya utna likhiye — purane me jud jayega"),
						reqd: 1,
					},
					{
						fieldtype: "Currency",
						fieldname: "rate",
						label: __("Naya purchase rate (optional)"),
						description: __("Khaali chhod dijiye to purana rate wahi rahega"),
					},
				],
				primary_action_label: __("Stock chadhao"),
				primary_action(values) {
					const qty = flt(values.qty);
					if (qty <= 0) {
						frappe.msgprint(__("Qty zero se zyada honi chahiye."));
						return;
					}
					d.hide();
					frappe.dom.freeze(__("Stock chadha rahe hain…"));
					// The rate key is LEFT OUT when the box is empty, never sent
					// as null. receive_stock_simple declares `rate: float = None`
					// and Frappe type-checks arguments before the body runs, so an
					// explicit null fails the float check with FrappeTypeError --
					// which meant that leaving the rate blank (the normal case)
					// made every "Stock chadhao" fail (2026-09-25: "pos bill se
					// stock nh badh raha"). Omitting it lets the default apply.
					const args = { item_code: row.item_code, qty };
					if (values.rate) args.rate = flt(values.rate);
					frappe
						.xcall("santu_hardware.santu_hardware.api.receive_stock_simple", args)
						.then((res) => {
							frappe.dom.unfreeze();
							const new_qty = res && res.new_qty != null ? flt(res.new_qty) : have + qty;
							row.available_qty = new_qty;
							frappe.show_alert(
								{ message: __("Ho gaya — ab {0} {1} hai.", [format_number(new_qty, null, 0), unit]), indicator: "green" },
								6
							);
							if (opts.after) opts.after(new_qty);
						})
						.catch((e) => {
							frappe.dom.unfreeze();
							frappe.msgprint((e && e.message) || __("Stock chadh nahi paya."));
						});
				},
			});
			d.show();
		},
	};
})();
