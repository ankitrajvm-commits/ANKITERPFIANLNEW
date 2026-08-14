// "The cashier should be able to edit the Unit Price simply by clicking
// on the price itself... no need for a separate pencil/edit icon" +
// "Discounts should be supported at the line-item level. The primary
// discount input should be a fixed amount (₹), with an optional
// percentage (%) field... In real retail stores, cashiers usually
// negotiate in rupees, not percentages." (2026-07-31 direct request).
//
// Native POS only lets you edit a row's rate/discount through the full
// "Item Details" side panel (8+ fields: qty, uom, rate, discount_percentage,
// warehouse, actual_qty, price_list_rate...) reached by clicking the row —
// correct but heavy for "just fix this one price" during a live sale.
//
// This adds a second, faster surface: clicking directly on a cart row's
// price opens a compact 2-field inline editor (Rate, Discount ₹/%) right
// there, using EVENT DELEGATION rather than overriding
// `render_cart_item` (a ~100-line method with several closures) — so the
// native rendering/side-panel path is untouched and this is purely
// additive.
//
// Edits are committed via `frappe.model.set_value` + `cur_pos.
// update_cart_html(row)` directly — NOT via `cur_pos.on_cart_update`,
// even though that looks like the obvious reuse target (it's what the
// native side panel's `rate` field and the numpad's `discount_percentage`
// action both call). Traced live why a first version silently did
// nothing: `on_cart_update` gates its `set_value` call behind
// `is_current_item_being_edited(item_row)`, which only returns true
// when `item_details.current_item` already equals this row — i.e. only
// when the (heavier) side panel is the thing currently open for it. This
// inline editor deliberately never opens that panel, so the gate always
// failed and the edit was dropped with no error. Calling `set_value` +
// `update_cart_html` directly is exactly what `on_cart_update` itself
// does once that gate passes — same two calls, just without the
// side-panel coupling this standalone editor doesn't have.
//
// Setting `discount_amount` this way is not a new code path either:
// core's `sales_common.js` already wires a `discount_amount(doc, cdt,
// cdn)` field-trigger (fires automatically via `frappe.model.set_value`,
// same as any Desk form) that recomputes `rate` from `price_list_rate -
// discount_amount` — confirmed by reading `apply_discount_on_item` /
// `price_list_rate` in `transaction.js`. So this file only adds UI; all
// recalculation and totals stay entirely core logic, doc-scoped (never
// touches the Item master or a Pricing Rule).
(function () {
	function item_row_from_name(row_name) {
		if (!window.cur_pos || !cur_pos.frm) return null;
		return cur_pos.frm.doc.items.find((i) => i.name === row_name) || null;
	}

	function close_editor($wrapper) {
		$wrapper.find(".santu-line-edit").remove();
		$wrapper.find(".item-rate-amount").css("display", "");
	}

	function open_editor($wrapper, item_row) {
		if (!cur_pos.settings.allow_rate_change && !cur_pos.settings.allow_discount_change) return;
		if ($wrapper.find(".santu-line-edit").length) return; // already open

		const currency = cur_pos.frm.doc.currency;
		$wrapper.find(".item-rate-amount").css("display", "none");

		// Default to ₹ always, per the explicit ask ("primary discount
		// input should be a fixed amount... cashiers usually negotiate in
		// rupees, not percentages") — only start in % mode if a percentage
		// discount is already the one active on this row (no amount set).
		let discount_mode =
			flt(item_row.discount_percentage) > 0 && !flt(item_row.discount_amount) ? "percentage" : "amount";

		const $editor = $(`
			<div class="santu-line-edit" style="display:flex;align-items:flex-end;gap:8px;padding:6px 0;">
				<div>
					<div style="font-size:11px;color:var(--gray-600);margin-bottom:2px;">${__("Rate")}</div>
					<input type="number" step="0.01" class="santu-line-rate form-control input-xs" style="width:90px;" value="${flt(item_row.rate)}">
				</div>
				<div>
					<div style="font-size:11px;color:var(--gray-600);margin-bottom:2px;display:flex;align-items:center;gap:4px;">
						${__("Discount")}
						<span class="santu-line-disc-mode" data-mode="amount" style="cursor:pointer;padding:0 4px;border-radius:3px;font-weight:600;">₹</span>
						<span class="santu-line-disc-mode" data-mode="percentage" style="cursor:pointer;padding:0 4px;border-radius:3px;font-weight:600;">%</span>
					</div>
					<input type="number" step="0.01" class="santu-line-discount form-control input-xs" style="width:70px;" value="${
						discount_mode === "amount" ? flt(item_row.discount_amount) || "" : flt(item_row.discount_percentage) || ""
					}">
				</div>
				<div class="santu-line-edit-done btn btn-primary btn-xs" style="height:28px;">✓</div>
			</div>
		`);

		function style_modes() {
			$editor.find(".santu-line-disc-mode").each(function () {
				const active = $(this).attr("data-mode") === discount_mode;
				$(this).css({
					background: active ? "var(--dark-green-100)" : "transparent",
					color: active ? "var(--dark-green-600)" : "var(--gray-600)",
				});
			});
		}
		style_modes();

		$editor.find(".santu-line-disc-mode").on("click", function (e) {
			e.stopPropagation();
			discount_mode = $(this).attr("data-mode");
			style_modes();
			const val =
				discount_mode === "amount" ? flt(item_row.discount_amount) : flt(item_row.discount_percentage);
			$editor.find(".santu-line-discount").val(val || "");
		});

		async function commit() {
			const new_rate = flt($editor.find(".santu-line-rate").val());
			const discount_val = flt($editor.find(".santu-line-discount").val());
			const row = item_row_from_name(item_row.name);
			if (!row) return close_editor($wrapper);

			if (discount_val > 0) {
				const field = discount_mode === "amount" ? "discount_amount" : "discount_percentage";
				await frappe.model.set_value(row.doctype, row.name, field, discount_val);
			} else if (new_rate !== flt(row.rate)) {
				await frappe.model.set_value(row.doctype, row.name, "rate", new_rate);
			}
			cur_pos.update_cart_html(row);
			close_editor($wrapper);
		}

		$editor.find(".santu-line-edit-done").on("click", (e) => {
			e.stopPropagation();
			commit();
		});
		$editor.on("keydown", "input", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commit();
			}
			if (e.key === "Escape") close_editor($wrapper);
		});
		$editor.on("click", (e) => e.stopPropagation());

		if (!cur_pos.settings.allow_rate_change) $editor.find(".santu-line-rate").prop("disabled", true);
		if (!cur_pos.settings.allow_discount_change) $editor.find(".santu-line-discount").prop("disabled", true);

		$editor.insertAfter($wrapper.find(".item-rate-amount"));
		$editor.find(".santu-line-rate").trigger("focus").trigger("select");
	}

	// Capture phase, not jQuery's (bubble-phase) `.on()`: the native row
	// click handler is delegated on `$cart_items_wrapper`, which sits
	// CLOSER to `.item-rate-amount` in the DOM than `document` — so on
	// the bubble phase it fires first regardless of `stopPropagation()`
	// called later in a `document`-level bubble listener (confirmed live:
	// the native Item Details panel opened anyway). Capture phase runs
	// top-down before any bubble-phase handler, so stopping it here
	// actually pre-empts the native handler instead of racing it.
	document.addEventListener(
		"click",
		function (e) {
			const $target = $(e.target).closest(".cart-item-wrapper .item-rate-amount");
			if (!$target.length) return;
			if (!window.cur_pos || !cur_pos.frm) return;

			e.stopPropagation();

			const $wrapper = $target.closest(".cart-item-wrapper");
			const row_name = $wrapper.attr("data-row-name");
			const item_row = item_row_from_name(row_name);
			if (!item_row) return;
			open_editor($wrapper, item_row);
		},
		true
	);
})();
