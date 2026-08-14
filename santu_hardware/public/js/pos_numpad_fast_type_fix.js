// "10 percent discount nahi de pa raha — 10 ko jaldi type karne pr 10
// nahi ho raha, bas 1 hi ho raha" (direct report: typing "10" quickly on
// the on-screen numpad for a line item's Discount/Qty/Rate only commits
// "1"). Root-caused live, not guessed — this is a genuine race in core
// ERPNext, not something this app's own customizations introduced:
//
// Each numpad digit tap calls `POSController.update_item_field(value,
// field)`, which calls `field_control.set_value(value)` on the Item
// Details panel's bound Qty/Rate/Discount control. `set_value()` is
// async (`frappe.ui.form.Control.validate_and_set_in_model`, in
// `frappe/public/js/frappe/form/controls/base_control.js`), and that
// function sets `this.inside_change_event = true` for the DURATION of
// its async chain, only resetting it once that chain resolves. Crucially
// it also *guards on that same flag*: `if (this.inside_change_event ||
// ...) return Promise.resolve()` — a `set_value()` call made while a
// previous one on the same control is still in flight is silently
// dropped, not queued. Tapping "1" then "0" fast enough means the "0"
// tap's `set_value("10")` call lands while the "1" tap's `set_value("1")`
// chain hasn't resolved yet, so it's discarded and the field is left at
// "1". Typing slowly works because each tap's chain finishes before the
// next one starts.
//
// Fix: wrap `update_item_field` so a `set_value()` call that arrives
// while one is still in flight is queued (remembering only the latest
// value, since numpad taps always pass the full cumulative string) and
// flushed the instant the in-flight call resolves, instead of calling
// `set_value()` again immediately and having core's own guard drop it.
// Scoped to exactly the numpad -> field-control path (`update_item_field`)
// — nowhere else in Desk is touched, and manually typing into a field
// normally (one keystroke's change event fully resolving before the
// next keystroke is physically possible) is unaffected either way.
(function () {
	const wait_for_controller = setInterval(() => {
		if (!window.erpnext || !erpnext.PointOfSale || !erpnext.PointOfSale.Controller) return;
		clearInterval(wait_for_controller);
		patch_controller();
	}, 200);

	function patch_controller() {
		const proto = erpnext.PointOfSale.Controller.prototype;
		const original_update_item_field = proto.update_item_field;

		proto.update_item_field = function (value, field_or_action) {
			if (field_or_action === "checkout" || field_or_action === "remove" || value === "") {
				return original_update_item_field.call(this, value, field_or_action);
			}

			const field_control = this.item_details[`${field_or_action}_control`];
			if (!field_control) return original_update_item_field.call(this, value, field_or_action);

			field_control.set_focus();

			if (field_control.__santu_set_value_inflight) {
				field_control.__santu_latest_pending_value = value;
				return;
			}

			const apply = (val) => {
				field_control.__santu_set_value_inflight = true;
				Promise.resolve(field_control.set_value(val)).finally(() => {
					field_control.__santu_set_value_inflight = false;
					const pending = field_control.__santu_latest_pending_value;
					field_control.__santu_latest_pending_value = undefined;
					if (pending !== undefined && pending !== val) {
						apply(pending);
					}
				});
			};
			apply(value);
		};
	}
})();
