/**
 * The ✓ on an item row: push what the operator actually typed on that line
 * back into the item itself — selling price AND unit.
 *
 * Shared by Billing and Estimate (2026-09-25: "jo bill screen me tick waala
 * feature hai use krne se rate, unit dono save ho jaye... is feature ko
 * estimate me v laa do") so the two screens can never drift apart.
 *
 * History worth keeping: the tick saved the unit too until 2026-09-21, when
 * it was cut ("bs rate update hoga") because a unit change quietly rewrites
 * what every future bill means. It is back now, but no longer quiet — the
 * confirm box spells the unit change out, because force_overwrite_item_unit
 * RELABELS without converting: 100 Pcs in hand become 100 Box.
 *
 * Rate needs no conversion here. Whatever unit the row is in becomes the
 * item's stock unit, so the row's own rate IS the price of one stock unit.
 * (The old code divided by the conversion factor for the confirm box but
 * sent the undivided rate — it showed ₹10 and saved ₹250.)
 */
(function () {
	function abbr(x) {
		return frappe.utils.escape_html((window.santu_uom && santu_uom.abbr(x)) || x || "");
	}

	window.santu_tick_to_master = {
		// A name typed on a bill line only ever changed THAT line -- a
		// deliberate old rule, because a bill sometimes wants its own wording.
		// Ankit asked for the catalogue to follow (2026-09-25: "jo naam edit
		// kiya wo direct master list me save hoa na?"), so it now asks, once,
		// instead of either silently renaming the catalogue or silently not.
		push_name(r, old_name, opts) {
			opts = opts || {};
			const fresh = (r && r.item_name ? String(r.item_name) : "").trim();
			if (!r || !r.item_code || !fresh || fresh === String(old_name || "").trim()) return;

			// santu-plain: this is a question, not a failure, so the error
			// framer leaves it exactly as written (2026-09-25).
			frappe.confirm(
				`<div class="santu-plain"><b>Naya naam:</b> ${frappe.utils.escape_html(fresh)}<br><br>` +
					"Poori list me bhi yahi naam kar dein?<br>" +
					'<span style="color:#64748b;font-size:12.5px;">Na karein to sirf isi bill par badlega.</span></div>',
				() => {
					frappe
						.xcall("santu_hardware.santu_hardware.api.update_item_field", {
							item_code: r.item_code,
							fieldname: "item_name",
							value: fresh,
						})
						.then(() => {
							frappe.show_alert({ message: __("Poori list me naam badal gaya."), indicator: "green" }, 6);
							if (opts.after) opts.after(true);
						})
						.catch((e) => {
							// Name already taken, etc. -- the bill line keeps the
							// new text, the catalogue does not.
							frappe.msgprint((e && e.message) || __("Naam list me save nahi hua."));
							if (opts.after) opts.after(false);
						});
				},
				() => {
					frappe.show_alert({ message: __("Sirf isi bill par badla."), indicator: "blue" }, 4);
					if (opts.after) opts.after(false);
				}
			);
		},

		push(r, opts) {
			opts = opts || {};
			if (!r || !r.item_code) {
				frappe.show_alert({ message: __("Is row me item nahi hai."), indicator: "orange" });
				return;
			}
			const stock_uom = (r.uom_options && r.uom_options.length && r.uom_options[0].uom) || r.uom;
			const unit_changing = r.uom && stock_uom && r.uom !== stock_uom;

			frappe.confirm(
				`${frappe.utils.escape_html(r.item_name || r.item_code)}<br><br>` +
					`${__("Selling price: <b>₹{0}</b> (har {1} ka)", [format_number(flt(r.rate), null, 2), abbr(r.uom)])}<br>` +
					(unit_changing
						? `<div style="margin-top:8px;background:#fff3cd;border:1px solid #ffe69c;border-radius:6px;padding:8px 10px;font-size:12.5px;">
								${__("Unit badlega: <b>{0}</b> se <b>{1}</b>", [abbr(stock_uom), abbr(r.uom)])}<br>
								${__("Stock ka number wahi rahega, sirf naam badlega — 100 {0} ab 100 {1} dikhega.", [
									abbr(stock_uom),
									abbr(r.uom),
								])}
							</div>`
						: "") +
					`<br>${__("Item me save kar dein?")}`,
				() => {
					frappe.dom.freeze(__("Saving…"));
					frappe
						.xcall("santu_hardware.santu_hardware.api.push_bill_row_to_master", {
							item_code: r.item_code,
							rate: flt(r.rate),
							uom: r.uom || null,
						})
						.then((res) => {
							frappe.dom.unfreeze();
							res = res || {};
							const bits = [];
							if (res.price_changed) bits.push(__("price ₹{0}", [format_number(res.new_rate, null, 2)]));
							if (res.unit_changed) bits.push(__("unit {0}", [abbr(r.uom)]));
							if (res.unit_error) {
								frappe.msgprint({ title: __("Unit save nahi hua"), message: res.unit_error, indicator: "orange" });
							}
							if (bits.length) {
								frappe.show_alert({ message: __("Item me save ho gaya — {0}.", [bits.join(", ")]), indicator: "green" }, 7);
							} else if (!res.unit_error) {
								frappe.show_alert({ message: __("Kuch badla nahi — pehle se hi yahi hai."), indicator: "blue" });
							}
							if (opts.after) opts.after(res);
						})
						.catch(() => frappe.dom.unfreeze());
				}
			);
		},
	};
})();
