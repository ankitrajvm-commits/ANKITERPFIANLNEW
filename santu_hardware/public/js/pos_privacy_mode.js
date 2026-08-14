// Companion to `santu_toggle_privacy_mode` in kiosk_mode.js — that file
// owns the PIN check and the on/off state (`body.santu-privacy-mode-active`,
// `santu_is_privacy_mode_active()`); this file owns the one thing Privacy
// Mode actually reveals: the current cart item's cost price, injected into
// core's own Item Details panel (`pos_item_details.js`) right after its
// native "Price List Rate" row, matching that panel's own field-by-field
// layout (`.form-container > .{fieldname}-control` divs — confirmed by
// reading `pos_item_details.js::render_form`/`get_form_fields` directly,
// not guessed) so it reads as one more field, not a bolted-on overlay.
//
// Polls rather than hooking a core event, same reasoning as
// `santu_simplify_pos` elsewhere in this app: opening/closing the Item
// Details panel and switching which cart row it's showing are internal
// `pos_item_details.js` state changes, not Frappe route changes or any
// event this app can subscribe to.
(function () {
	let poll_timer = null;
	let last_item_code = null;
	let last_cost = null;

	function in_kiosk_poll_range() {
		const route = frappe.get_route();
		return route && route[0] === "point-of-sale";
	}

	async function get_cost_price(item_code, warehouse) {
		if (item_code === last_item_code && last_cost !== null) return last_cost;
		last_item_code = item_code;
		try {
			last_cost = await frappe.xcall("santu_hardware.santu_hardware.api.get_item_cost_price", {
				item_code,
				warehouse,
			});
		} catch (err) {
			last_cost = null;
		}
		return last_cost;
	}

	async function santu_render_cost_price_row() {
		if (!in_kiosk_poll_range() || !window.cur_pos || !cur_pos.item_details) return;

		const item_details = cur_pos.item_details;
		const panel_visible = item_details.$component && item_details.$component.is(":visible");
		const $form_container = item_details.$component && item_details.$component.find(".form-container");
		if (!$form_container || !$form_container.length) return;

		if (!panel_visible || !santu_is_privacy_mode_active()) {
			$form_container.find(".santu-cost-price-control").remove();
			last_item_code = null;
			last_cost = null;
			return;
		}

		const item_row = item_details.current_item;
		if (!item_row || !item_row.item_code) return;

		let $row = $form_container.find(".santu-cost-price-control");
		if (!$row.length) {
			$row = $(`
				<div class="santu-cost-price-control" data-fieldname="santu_cost_price">
					<div class="control-label">${__("Cost Price")}</div>
					<div class="santu-cost-price-value control-value like-disabled-input">…</div>
				</div>
			`);
			const $price_list_rate = $form_container.find(".price_list_rate-control");
			if ($price_list_rate.length) {
				$row.insertAfter($price_list_rate);
			} else {
				$form_container.append($row);
			}
		}

		const cost = await get_cost_price(item_row.item_code, item_row.warehouse);
		const doc = cur_pos.frm && cur_pos.frm.doc;
		const currency = (doc && doc.currency) || "INR";
		$row.find(".santu-cost-price-value").text(
			cost === null ? __("Unavailable") : format_currency(cost, currency)
		);
	}

	function santu_apply_privacy_mode_poll() {
		clearInterval(poll_timer);
		if (in_kiosk_poll_range()) {
			poll_timer = setInterval(santu_render_cost_price_row, 500);
		}
	}

	frappe.router.on("change", santu_apply_privacy_mode_poll);
	$(document).ready(santu_apply_privacy_mode_poll);
})();
