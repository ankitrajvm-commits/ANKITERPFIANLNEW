/**
 * The three save buttons every document screen shares.
 *
 *   [        Save        ]        <- saves, and does nothing else
 *   [ Save & Print ][ WhatsApp ]  <- saves, then that one action, straight away
 *
 * Built for Billing on 2026-09-06 ("save bill, save and print bill, send on
 * whatsapp, no extra popup. same screen pe all kaam ho, baar baar is app ko
 * puchna v nahi padega") and lifted out here on 2026-09-07 so Estimate, the
 * returns, Purchase Invoice and the Challan get exactly the same three
 * buttons behaving exactly the same way -- rather than five screens each
 * growing their own near-copy that slowly drifts.
 *
 * The whole point is that pressing a button IS the answer: nothing here ever
 * asks "print karein?" or opens a WhatsApp preview to confirm. Plain Save
 * neither prints nor sends.
 */
(function () {
	// Doctypes that have a real thermal layout (mirrors print_service.py's
	// SANTU_THERMAL_DOCTYPES). Anything else still prints -- thermal_print.js
	// sends it to the normal print view -- this only decides the wording.
	const THERMAL = ["Sales Invoice", "POS Invoice", "Quotation"];

	function html(opts) {
		opts = opts || {};
		const save_label = opts.save_label || __("Save");
		const kbd = opts.kbd ? `<span class="santu-bill-kbd">${opts.kbd}</span>` : "";
		// Save & Print is the big button, the other two share the row under
		// it -- printing is what actually happens on nearly every document,
		// so it gets the target you can hit without looking (2026-09-07).
		return `
			<button type="button" class="santu-bill-save-print">🖨️ ${__("Save &amp; Print")} ${kbd}</button>
			<div class="santu-bill-save-row">
				<button type="button" class="santu-bill-save">${save_label}</button>
				<button type="button" class="santu-bill-save-whatsapp">💬 ${__("Send WhatsApp")}</button>
			</div>`;
	}

	// `on_save(after)` gets undefined / "print" / "whatsapp".
	function bind($root, on_save) {
		$root.find(".santu-bill-save").off("click.santu-save").on("click.santu-save", () => on_save());
		$root.find(".santu-bill-save-print").off("click.santu-save").on("click.santu-save", () => on_save("print"));
		$root.find(".santu-bill-save-whatsapp").off("click.santu-save").on("click.santu-save", () => on_save("whatsapp"));
	}

	// Call once the document is saved. Returns a promise so callers can wait
	// before closing the tab out from under a print that is still rendering.
	async function after_save(doctype, name, after, opts) {
		opts = opts || {};
		if (after === "print") {
			if (typeof santu_print_thermal_bill === "function") {
				return santu_print_thermal_bill(doctype, name, opts.print_opts || {});
			}
			return false;
		}
		if (after === "whatsapp") {
			if (!window.santu_whatsapp_share) return false;
			// A party with no number is the one case worth a word, otherwise
			// the send just happens.
			if (opts.has_party === false) {
				frappe.show_alert({ message: __("Party chuni nahi hai — WhatsApp nahi bhej sakte."), indicator: "orange" });
				return false;
			}
			return window.santu_whatsapp_share.send_transaction(doctype, name, { skip_dialog: true });
		}
		return true;
	}

	window.santu_save_buttons = { html, bind, after_save, THERMAL };
})();
