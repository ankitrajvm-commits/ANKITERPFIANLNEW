// "in discount there should be 2 option percentage or discount in rs"
// (2026-07-30 direct request). Native POS "Add Discount" widget
// (`pos_item_cart.js` show_discount_control/hide_discount_control) only
// ever writes `additional_discount_percentage` — there's no way to type
// a flat rupee discount from the POS screen, even though the core
// doctype already has a `discount_amount` field the totals engine
// (taxes_and_totals.js) understands natively.
//
// Overriding both methods on the shared `erpnext.PointOfSale.ItemCart`
// prototype (same non-invasive pattern as `pos_no_gst.js`) to add a %/₹
// toggle. `hide_discount_control` is rewritten to read both discount
// fields straight from `frm.doc` instead of trusting its `discount`
// argument, because core calls it as
// `this.hide_discount_control(frm.doc.additional_discount_percentage)`
// on every cart refresh — trusting only that argument would show
// "Add Discount" (empty) even when a rupee discount is active.
//
// `pos_item_cart.js` lives in the POS page's own lazy-loaded bundle, not
// the main desk bundle `app_include_js` runs alongside — so
// `erpnext.PointOfSale.ItemCart` doesn't exist yet the instant this file
// first executes (confirmed live: a one-shot guarded patch silently
// no-opped and the native single-field discount box kept showing).
// Polling until the class actually exists, then patching once and
// stopping, sidesteps needing to know the exact bundle-load event to
// hook.
(function () {
	const wait_for_item_cart = setInterval(() => {
		if (!window.erpnext || !erpnext.PointOfSale || !erpnext.PointOfSale.ItemCart) return;
		clearInterval(wait_for_item_cart);
		patch_item_cart();
	}, 200);

	function patch_item_cart() {
		const proto = erpnext.PointOfSale.ItemCart.prototype;

		proto.show_discount_control = function () {
			this.$add_discount_elem.css({ padding: "0px", border: "none" });
			this.$add_discount_elem.html(`
				<div class="santu-discount-toggle" style="display:flex;align-items:center;gap:6px;width:100%;">
					<div class="santu-discount-mode-btn" data-mode="percentage" style="cursor:pointer;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">%</div>
					<div class="santu-discount-mode-btn" data-mode="amount" style="cursor:pointer;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">₹</div>
					<div class="add-discount-field" style="flex:1;"></div>
				</div>
			`);
			const me = this;
			const frm = me.events.get_frm();
			me.santu_discount_mode =
				me.santu_discount_mode || (flt(frm.doc.discount_amount) > 0 ? "amount" : "percentage");

			function style_toggle() {
				me.$add_discount_elem.find(".santu-discount-mode-btn").each(function () {
					const active = $(this).attr("data-mode") === me.santu_discount_mode;
					$(this).css({
						background: active ? "var(--dark-green-100)" : "transparent",
						color: active ? "var(--dark-green-600)" : "var(--gray-600)",
					});
				});
			}

			function render_field() {
				style_toggle();
				const is_pct = me.santu_discount_mode === "percentage";
				const existing = is_pct ? frm.doc.additional_discount_percentage : frm.doc.discount_amount;

				me.$add_discount_elem.find(".add-discount-field").html("");
				me.discount_field = frappe.ui.form.make_control({
					df: {
						label: __("Discount"),
						fieldtype: "Data",
						placeholder: is_pct
							? existing
								? existing + "%"
								: __("Enter discount percentage.")
							: existing
							? String(existing)
							: __("Enter discount amount."),
						input_class: "input-xs",
						onchange: function () {
							this.value = flt(this.value);
							if (is_pct && this.value > 100) {
								frappe.msgprint({
									title: __("Invalid Discount"),
									indicator: "red",
									message: __("Discount cannot be greater than 100%."),
								});
								this.value = 0;
							}
							if (is_pct) {
								frappe.model.set_value(frm.doc.doctype, frm.doc.name, "discount_amount", 0);
								frappe.model.set_value(
									frm.doc.doctype,
									frm.doc.name,
									"additional_discount_percentage",
									flt(this.value)
								);
							} else {
								frappe.model.set_value(
									frm.doc.doctype,
									frm.doc.name,
									"additional_discount_percentage",
									0
								);
								frappe.model.set_value(
									frm.doc.doctype,
									frm.doc.name,
									"discount_amount",
									flt(this.value)
								);
							}
							me.hide_discount_control();
						},
					},
					parent: me.$add_discount_elem.find(".add-discount-field"),
					render_input: true,
				});
				me.discount_field.toggle_label(false);
				me.discount_field.set_focus();
			}

			me.$add_discount_elem.off("click", ".santu-discount-mode-btn");
			me.$add_discount_elem.on("click", ".santu-discount-mode-btn", function () {
				me.santu_discount_mode = $(this).attr("data-mode");
				render_field();
			});

			render_field();
		};

		proto.hide_discount_control = function () {
			const frm = this.events.get_frm();
			const pct = flt(frm.doc.additional_discount_percentage);
			const amt = flt(frm.doc.discount_amount);
			const has_discount = pct > 0 || amt > 0;

			if (!has_discount) {
				this.$add_discount_elem.css({
					border: "1px dashed var(--gray-500)",
					padding: "var(--padding-sm) var(--padding-md)",
				});
				this.$add_discount_elem.html(`${this.get_discount_icon()} ${__("Add Discount")}`);
				this.discount_field = undefined;
			} else {
				const label = pct > 0 ? `${pct}%` : format_currency(amt, frm.doc.currency);
				this.$add_discount_elem.css({
					border: "1px dashed var(--dark-green-500)",
					padding: "var(--padding-sm) var(--padding-md)",
				});
				this.$add_discount_elem.html(
					`<div class="edit-discount-btn">
						${this.get_discount_icon()} ${__("Additional")}&nbsp;${label.bold()} ${__("discount applied")}
					</div>`
				);
			}
		};
	}
})();
