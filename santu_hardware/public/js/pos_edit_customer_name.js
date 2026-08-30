// "give an option to edit name now" (direct request, selected the
// Walk-in Customer summary card in the cart panel) — core POS shows the
// customer name read-only everywhere (collapsed cart summary AND the
// expanded "Contact Details" panel opened by clicking it); the only way
// to fix a typo or rename a hastily-created customer was to leave POS
// and edit the Customer master directly. Adds a small pencil icon right
// next to the name in both places that opens a rename prompt in place.
//
// Monkey-patches `erpnext.PointOfSale.ItemCart`'s two render methods
// that draw `.customer-name` (`update_customer_section` = collapsed
// summary, `toggle_customer_info` = expanded Contact Details) instead of
// polling — both are real, always-called render points on a public,
// addressable class, so wrapping them fires exactly once per actual
// re-render instead of every N ms regardless of state. The class itself
// only exists once the POS page bundle has loaded (not at Desk boot,
// when this file's `app_include_js` script tag runs), so a short poll
// is still needed to catch the moment it becomes available — same
// "wait for cur_pos" reasoning as `pos_privacy_mode.js`.
(function () {
	let patched = false;
	let wait_timer = null;

	function get_customer_name_els(cart) {
		return cart.$customer_section.find(".customer-name");
	}

	function inject_edit_icon(cart) {
		const info = cart.customer_info || {};
		if (!info.customer) return;

		get_customer_name_els(cart).each(function () {
			const $el = $(this);
			if ($el.find(".santu-edit-customer-name-btn").length) return;
			$el.append(
				`<span class="santu-edit-customer-name-btn" title="${__("Edit name")}">&#9998;</span>`
			);
		});
	}

	function santu_open_rename_dialog(cart) {
		const info = cart.customer_info || {};
		if (!info.customer) return;

		frappe.prompt(
			{
				fieldname: "customer_name",
				fieldtype: "Data",
				label: __("Customer Name"),
				reqd: 1,
				default: info.customer_name,
			},
			async (values) => {
				const new_name = (values.customer_name || "").trim();
				if (!new_name || new_name === info.customer_name) return;

				frappe.dom.freeze();
				try {
					await frappe.db.set_value("Customer", info.customer, "customer_name", new_name);
					cart.customer_info.customer_name = new_name;

					const frm = window.cur_pos && cur_pos.frm;
					if (frm && frm.doc.customer === info.customer) {
						await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "customer_name", new_name);
					}

					const showing_details = cart.$customer_section.find(".customer-fields-container").length > 0;
					if (showing_details) {
						cart.toggle_customer_info(true);
					} else {
						cart.update_customer_section();
					}
					frappe.show_alert({ message: __("Name updated"), indicator: "green" });
				} finally {
					frappe.dom.unfreeze();
				}
			},
			__("Edit Customer Name"),
			__("Save")
		);
	}

	function try_patch() {
		if (patched) return;
		if (!window.erpnext || !erpnext.PointOfSale || !erpnext.PointOfSale.ItemCart) return;
		patched = true;
		clearInterval(wait_timer);

		const ItemCart = erpnext.PointOfSale.ItemCart;

		const original_update = ItemCart.prototype.update_customer_section;
		ItemCart.prototype.update_customer_section = function (...args) {
			const result = original_update.apply(this, args);
			inject_edit_icon(this);
			return result;
		};

		const original_toggle = ItemCart.prototype.toggle_customer_info;
		ItemCart.prototype.toggle_customer_info = function (...args) {
			const result = original_toggle.apply(this, args);
			if (args[0]) inject_edit_icon(this);
			return result;
		};
	}

	wait_timer = setInterval(try_patch, 500);
	$(document).ready(try_patch);

	// Capture phase, not jQuery's (bubble-phase) `.on()` — core's own
	// `.customer-display` click handler is bound closer to the target
	// (on `$customer_section`, via `bind_events()`), so it fires before
	// a document-level bubble-phase handler ever would; calling
	// `stopPropagation()` from there is too late to stop it. Capturing
	// on `document` runs before the event reaches the target at all, so
	// stopping it here reliably pre-empts the parent's expand-details
	// handler instead of racing it.
	document.addEventListener(
		"click",
		function (e) {
			const btn = e.target.closest && e.target.closest(".santu-edit-customer-name-btn");
			if (!btn) return;
			e.stopPropagation();
			e.preventDefault();
			if (window.cur_pos && cur_pos.cart) {
				santu_open_rename_dialog(cur_pos.cart);
			}
		},
		true
	);
})();
