// "Creation of a new customer is not looking easy" (2026-07-30 direct
// request) — instead of requiring the cashier to search-and-pick (or
// separately go create a Customer record), ask for name + phone right
// when a new sale starts. A phone that matches an existing customer
// picks that person automatically — no name-typo duplicates. `onload`
// fires every time a fresh POS Invoice doc is created (first load of
// the day, and every "New Order" after completing a sale) since POS's
// screen builds a real `frappe.ui.form.Form` under the hood (same fact
// already used for the post-sale popup's `on_submit` hook).
// `pos_controller.js::make_return_invoice()` builds the return's new frm
// via `get_new_frm()` (which fires `onload` on a genuinely BLANK doc)
// SYNCHRONOUSLY, then only populates `is_return`/`customer` afterward via
// an async `frappe.call` + `frappe.model.sync()` once the server responds
// (confirmed live, 2026-08-06: checking `frm.doc.is_return` inside
// `onload` still read blank/0, even though it reads correctly moments
// later — a real race, not a logic bug in the check itself). Checking
// `is_return`/`customer` inside `onload` can never see the return's data
// in time, no matter which fields are checked. The reliable fix is to
// mark the window during which a return is being built, from the one
// place that genuinely knows: `make_return_invoice` itself, patched here
// the same way `pos_review_before_finalize.js` patches
// `cur_pos.payment.events.submit_invoice` — polling for the already-
// constructed `cur_pos` singleton and wrapping one of its instance
// methods, since prototype-patching ahead of construction isn't an
// option here either.
(function () {
	const wait_for_pos = setInterval(() => {
		if (!window.cur_pos || typeof cur_pos.make_return_invoice !== "function") return;
		clearInterval(wait_for_pos);
		const original_make_return_invoice = cur_pos.make_return_invoice.bind(cur_pos);
		cur_pos.make_return_invoice = function (doc) {
			frappe.flags.santu_return_in_progress = true;
			const result = original_make_return_invoice(doc);
			if (result && typeof result.finally === "function") {
				result.finally(() => {
					frappe.flags.santu_return_in_progress = false;
				});
			} else {
				frappe.flags.santu_return_in_progress = false;
			}
			return result;
		};
	}, 200);
})();

// "Creation of a new customer is not looking easy" (2026-07-30 direct
// request) — instead of requiring the cashier to search-and-pick (or
// separately go create a Customer record), ask for name + phone right
// when a new sale starts. A phone that matches an existing customer
// picks that person automatically — no name-typo duplicates. `onload`
// fires every time a fresh POS Invoice doc is created (first load of
// the day, and every "New Order" after completing a sale) since POS's
// screen builds a real `frappe.ui.form.Form` under the hood (same fact
// already used for the post-sale popup's `on_submit` hook).
frappe.ui.form.on("POS Invoice", {
	onload(frm) {
		// `is_new()` alone also fires for a Return loaded via the "Return"
		// button on an old order — see the `make_return_invoice` patch
		// above for why checking `is_return`/`customer` here can't catch
		// that case directly; `santu_return_in_progress` is the reliable
		// signal instead.
		if (frm.is_new() && !frappe.flags.santu_return_in_progress) {
			santu_prompt_customer_for_new_sale(frm);
		}
	},
});

// "jab mai ye naam likh rha to existing name search hona chahiye, yaad
// karke show kre" (direct request) — only the Phone field deduped
// against existing customers; typing a NAME had no equivalent, so two
// cashiers spelling "Chandra Prakash" slightly differently (or one just
// not knowing the phone number offhand) could each create a separate
// customer record. This adds a live, debounced suggestion dropdown
// under the Name field, backed by `search_customers_by_name`.
function santu_wire_customer_name_suggestions(d) {
	const $wrapper = d.fields_dict.customer_name.$wrapper;
	$wrapper.css("position", "relative");
	const $dropdown = $(`<div class="santu-customer-suggest" style="
		position:absolute; top:100%; left:0; right:0; z-index:1100;
		background:#fff; border:1px solid var(--gray-300, #d1d8dd);
		border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12);
		max-height:220px; overflow-y:auto; display:none; margin-top:2px;
	"></div>`);
	$wrapper.append($dropdown);

	let selected_customer = null;
	let selected_customer_name = null;
	let debounce_timer = null;
	let request_token = 0;

	function hide_dropdown() {
		$dropdown.hide().empty();
	}

	function render_results(results) {
		if (!results.length) return hide_dropdown();
		$dropdown.empty();
		results.forEach((row) => {
			const $row = $(`<div class="santu-customer-suggest-row" style="
				padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--gray-100, #f4f5f6);
			">
				<div style="font-weight:600;">${frappe.utils.escape_html(row.customer_name)}</div>
				<div style="font-size:11px;color:var(--gray-600, #74808b);">
					${[row.mobile_no, row.santu_village].filter(Boolean).map(frappe.utils.escape_html).join(" · ") || __("No phone on file")}
				</div>
			</div>`);
			$row.on("mouseenter", () => $row.css("background", "var(--gray-50, #f9fafb)"));
			$row.on("mouseleave", () => $row.css("background", ""));
			$row.on("mousedown", (e) => {
				// mousedown (not click) so this fires before the input's
				// blur — otherwise blur-driven UI (if any is ever added)
				// could close the dropdown first and swallow the pick.
				e.preventDefault();
				selected_customer = row.name;
				selected_customer_name = row.customer_name;
				d.fields_dict.customer_name.set_value(row.customer_name);
				if (row.mobile_no) d.fields_dict.phone.set_value(row.mobile_no);
				if (row.santu_village) d.fields_dict.address.set_value(row.santu_village);
				hide_dropdown();
			});
			$dropdown.append($row);
		});
		$dropdown.show();
	}

	d.fields_dict.customer_name.$input.on("input", function () {
		const query = $(this).val();

		// Typing further away from a previously-picked suggestion means
		// the cashier is no longer referring to that exact customer —
		// fall back to normal create-or-match-by-phone on submit.
		if (selected_customer && query !== selected_customer_name) {
			selected_customer = null;
			selected_customer_name = null;
		}

		clearTimeout(debounce_timer);
		if (!query || query.length < 2) return hide_dropdown();

		debounce_timer = setTimeout(async () => {
			const my_token = ++request_token;
			let results;
			try {
				results = await frappe.xcall(
					"santu_hardware.santu_hardware.api.search_customers_by_name",
					{ query }
				);
			} catch (err) {
				return;
			}
			if (my_token !== request_token) return; // a newer keystroke's request already landed
			render_results(results || []);
		}, 250);
	});

	$(document).on("mousedown.santu-customer-suggest", (e) => {
		if (!$(e.target).closest($wrapper).length) hide_dropdown();
	});
	d.$wrapper.on("hide.bs.modal", () => $(document).off("mousedown.santu-customer-suggest"));

	return () => selected_customer;
}

function santu_prompt_customer_for_new_sale(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Who's this sale for?"),
		fields: [
			{
				fieldname: "customer_name",
				fieldtype: "Data",
				label: __("Name"),
				reqd: 1,
			},
			{
				fieldname: "phone",
				fieldtype: "Data",
				label: __("Phone Number"),
				description: __("If this number is already a customer, we'll use their existing account."),
			},
			{
				fieldname: "address",
				fieldtype: "Data",
				label: __("Address"),
			},
		],
		primary_action_label: __("Continue"),
		primary_action: async (values) => {
			const name = (values.customer_name || "").trim();
			if (!name) {
				frappe.msgprint(__("Party Name is required."));
				return;
			}
			const phone = (values.phone || "").trim();
			const address = (values.address || "").trim();
			if (Boolean(phone) !== Boolean(address)) {
				frappe.msgprint(__("Phone number aur address dono do, ya dono chhod do — sirf ek nahi."));
				return;
			}
			d.disable_primary_action();
			try {
				// If the cashier picked a suggestion and hasn't since edited
				// the name away from it, `get_selected_customer()` is the
				// actual Customer doc name — use it directly rather than
				// going back through phone-based create-or-match, which
				// has no way to know "this exact record was already chosen".
				const picked = get_selected_customer();
				const customer =
					picked ||
					(await frappe.xcall(
						"santu_hardware.santu_hardware.api.get_or_create_customer_by_phone",
						{
							customer_name: name,
							phone: phone || undefined,
							address: address || undefined,
						}
					));
				await santu_apply_customer_to_pos(frm, customer);
			} catch (err) {
				d.enable_primary_action();
				frappe.msgprint({
					title: __("Couldn't Set Customer"),
					message: err.message || String(err),
					indicator: "red",
				});
				return;
			}
			d.hide();
		},
	});
	const get_selected_customer = santu_wire_customer_name_suggestions(d);
	d.show();
	d.fields_dict.customer_name.$input.trigger("focus");
}

// Mirrors exactly what the native customer-search field's `onchange`
// does (`pos_item_cart.js::make_customer_selector`) — setting only
// `frm.doc.customer` updates the underlying invoice, but the visible
// "Walk-in Customer" summary card in the cart is a separately-rendered
// component with its own state, so it needs its own refresh calls too
// or it would keep showing the old name until the next unrelated
// re-render.
async function santu_apply_customer_to_pos(frm, customer) {
	frappe.dom.freeze();
	try {
		await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "customer", customer);
		await frm.script_manager.trigger("customer", frm.doc.doctype, frm.doc.name);

		const cart = window.cur_pos && cur_pos.cart;
		if (cart) {
			await cart.fetch_customer_details(customer);
			cart.events.customer_details_updated(cart.customer_info);
			cart.update_customer_section();
			cart.update_totals_section && cart.update_totals_section();
		}
	} finally {
		frappe.dom.unfreeze();
	}
}
