// "After generating a bill, when I open the invoice preview and then go
// back, the system immediately asks me to create a new bill. Instead,
// the preview screen should provide options like Back to Bill, Continue
// Editing, Print, Download PDF, Share on WhatsApp, and Close. This will
// allow the cashier to return to the same bill and make changes before
// finally completing the sale." (2026-07-31 direct request.)
//
// Root cause of the original bug (traced by reading `post_sale_popup.js`
// and `pos_controller.js`): "Complete Order" called `frm.savesubmit()`
// IMMEDIATELY — the sale was already final by the time any preview
// existed at all — and the popup's "Preview"/"Save PDF" buttons used
// `window.open(url, "_blank")`. In a context where the browser coerces
// `_blank` into the SAME tab (confirmed live in this session's own
// Browser pane: no new tab was ever created), that's a full navigation
// away from the POS single-page app. Pressing Back then force-reloads
// `/app/point-of-sale`, which boots a brand-new POS Invoice and
// `pos_customer_capture.js`'s `onload` hook immediately shows the
// "Who's this sale for?" dialog for it — matching exactly what was
// reported.
//
// The fix has two parts:
//   1. This file — "Complete Order" now SAVES the invoice as a draft and
//      shows a review dialog, INSTEAD OF submitting straight away. The
//      draft is fully editable again via "Back to Bill"/"Continue
//      Editing" (both just call the existing `payment.edit_cart()`).
//      Only the dialog's "Complete Sale" button actually submits.
//   2. `post_sale_popup.js` (separate fix, same file set) — its own
//      Preview/Save PDF buttons switched from `window.open` to an
//      in-dialog PDF blob, so the same failure mode can't happen
//      post-submit either.
//
// Interception point: `cur_pos.payment.events.submit_invoice` is a
// plain object property (an arrow function set in `pos_controller.js`
// `init_payments()`), not a prototype method — so this reassigns it
// directly on the already-constructed singleton (`cur_pos`, exposed by
// `point_of_sale.js`'s `on_page_load`) rather than prototype-patching,
// which would need to run before `init_payments()` executes and could
// lose the timing race (same class of problem `pos_discount_toggle.js`
// and `pos_quick_create_item.js` solve by polling for a *class* to
// exist — here it's an *instance*, so the natural fix is polling for
// `cur_pos.payment` instead and swapping the one function). Core's own
// "Complete Order" click handler (`pos_payment.js`, validates payment
// entered / cart not empty) still runs first, untouched — this only
// changes what happens once that validation passes.
(function () {
	const wait_for_payment = setInterval(() => {
		if (!window.cur_pos || !cur_pos.payment || !cur_pos.payment.events) return;
		clearInterval(wait_for_payment);
		cur_pos.payment.events.submit_invoice = function () {
			santu_show_review_dialog(cur_pos);
		};
	}, 200);

	function get_print_format(doctype) {
		return doctype === "POS Invoice" ? "Santu Hardware Thermal Bill" : "Santu Hardware Thermal Bill (Sales Invoice)";
	}

	async function get_pdf_info(doctype, name) {
		const print_format = get_print_format(doctype);
		const base64 = await frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_pdf_base64", {
			doctype,
			name,
			print_format,
		});
		return { base64, print_format };
	}

	function download_pdf_blob(base64, filename) {
		const byte_chars = atob(base64);
		const byte_numbers = new Array(byte_chars.length);
		for (let i = 0; i < byte_chars.length; i++) byte_numbers[i] = byte_chars.charCodeAt(i);
		const blob = new Blob([new Uint8Array(byte_numbers)], { type: "application/pdf" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	// On-screen preview only — Print/Download PDF still use the real PDF
	// bytes above (QZ Tray and file downloads genuinely need PDF). The
	// on-screen box was rendering solid black no matter how the PDF bytes
	// were delivered to the iframe (raw data: URI, then a Blob URL — both
	// tried and confirmed still black), so the PDF itself, not the
	// delivery mechanism, is the problem here. Sidestepping it entirely:
	// this uses Frappe core's OWN print-preview mechanism instead — the
	// same `frappe.www.printview.get_html_and_style` call the standard
	// "Print" toolbar button's live preview uses (`printing/page/print/
	// print.js::get_print_html`) — which renders the print format straight
	// to HTML/CSS, no PDF generation involved at all.
	async function get_print_html(doctype, name, print_format) {
		const r = await frappe.call({
			method: "frappe.www.printview.get_html_and_style",
			args: { doc: doctype, name, print_format, no_letterhead: 0 },
		});
		return r.message || {};
	}

	function render_print_preview($wrapper, html, style) {
		const iframe = document.createElement("iframe");
		iframe.style.cssText = "width:100%;height:60vh;border:1px solid var(--gray-300);background:#fff;";
		$wrapper.empty().append(iframe);
		iframe.srcdoc = `<html><head><style>${style || ""}</style></head><body><div class="print-format print-format-preview">${
			html || ""
		}</div></body></html>`;
	}

	async function santu_show_review_dialog(controller) {
		frappe.dom.freeze(__("Preparing bill review..."));
		try {
			// `frm.save()` on an already-saved, non-dirty doc hangs forever
			// instead of resolving (confirmed live: the freeze overlay never
			// cleared, no network request ever fired) — core's own
			// `save_and_checkout()` (`pos_controller.js`) guards the exact
			// same call with `is_dirty()` for this reason; matching that
			// here rather than rediscovering it as a fresh bug.
			if (controller.frm.is_dirty()) {
				await controller.frm.save();
			}
		} catch (err) {
			frappe.dom.unfreeze();
			frappe.msgprint({
				title: __("Couldn't Save Bill"),
				message: err.message || String(err),
				indicator: "red",
			});
			return;
		}

		const doc = controller.frm.doc;
		const print_format = get_print_format(doc.doctype);
		let print_html = null;
		try {
			print_html = await get_print_html(doc.doctype, doc.name, print_format);
		} catch (err) {
			// preview is a nicety, not a blocker — fall through to the
			// text placeholder below if rendering itself fails.
		}
		frappe.dom.unfreeze();

		const d = new frappe.ui.Dialog({
			title: __("Review Bill — {0}", [doc.name]),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "preview",
					options: print_html && print_html.html
						? `<div class="santu-review-preview-wrap"></div>`
						: `<div style="padding:60px 20px;text-align:center;color:var(--gray-600);">
								₹ ${format_currency(doc.grand_total, doc.currency).replace(/^\D+/, "")}<br>
								${__("Preview unavailable — you can still complete the sale.")}
							</div>`,
				},
			],
			primary_action_label: __("Complete Sale"),
			primary_action: async () => {
				d.disable_primary_action();
				try {
					const r = await controller.frm.savesubmit();
					d.hide();
					controller.toggle_components(false);
					controller.order_summary.toggle_component(true);
					controller.order_summary.load_summary_of(controller.frm.doc, true);
					frappe.show_alert({
						indicator: "green",
						message: __("POS invoice {0} created succesfully", [r.doc.name]),
					});
				} catch (err) {
					d.enable_primary_action();
					frappe.msgprint({
						title: __("Couldn't Complete Sale"),
						message: err.message || String(err),
						indicator: "red",
					});
				}
			},
			secondary_action_label: __("Continue Editing"),
			secondary_action: () => {
				d.hide();
				controller.payment.edit_cart();
			},
		});

		// Frappe dialogs only support one primary + one secondary action
		// button natively — same constraint `post_sale_popup.js` already
		// works around by appending extra buttons directly into the
		// footer (matching that established pattern here).
		const $standard_actions = d.$wrapper.find(".modal-footer .standard-actions");
		d.$wrapper.find(".modal-footer").css("display", "flex");
		$standard_actions.css("margin-left", "auto");
		const $extra = $(`<div class="santu-review-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>`);
		$extra.insertBefore($standard_actions);

		$(`<button class="btn btn-default btn-sm">← ${__("Back to Bill")}</button>`)
			.on("click", () => {
				d.hide();
				controller.payment.edit_cart();
			})
			.appendTo($extra);

		$(`<button class="btn btn-default btn-sm">${__("Print")}</button>`)
			.on("click", async () => {
				await santu_print_thermal_bill(doc.doctype, doc.name);
			})
			.appendTo($extra);

		$(`<button class="btn btn-default btn-sm">${__("Download PDF")}</button>`)
			.on("click", async () => {
				const info = await get_pdf_info(doc.doctype, doc.name);
				download_pdf_blob(info.base64, `${doc.name}.pdf`);
			})
			.appendTo($extra);

		const customer_mobile = await santu_get_customer_mobile(doc);
		if (customer_mobile) {
			$(`<button class="btn btn-default btn-sm">${__("Share on WhatsApp")}</button>`)
				.on("click", () => santu_share_on_whatsapp(doc, customer_mobile))
				.appendTo($extra);
		}

		d.show();

		if (print_html && print_html.html) {
			render_print_preview(d.fields_dict.preview.$wrapper.find(".santu-review-preview-wrap"), print_html.html, print_html.style);
		}
	}
})();
