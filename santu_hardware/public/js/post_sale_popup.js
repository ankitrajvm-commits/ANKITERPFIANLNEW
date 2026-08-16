// Phase 3/5: "Sale complete hote hi" — the moment a bill is submitted,
// offer the actions an owner actually wants next: print it, share it,
// or reprint the last one. `on_submit` is a standard Frappe client-script
// hook — POS's screen builds a real `frappe.ui.form.Form` under the
// hood (`pos_controller.js`), so this fires for every POS sale without
// touching any core file.
frappe.ui.form.on("POS Invoice", {
	async on_submit(frm) {
		await santu_maybe_auto_print(frm.doc);
		await santu_show_post_sale_popup(frm.doc);
	},
});

async function santu_maybe_auto_print(doc) {
	const settings = await frappe.db.get_doc("Santu POS Settings");
	if (cint(settings.auto_print)) {
		await santu_print_thermal_bill(doc.doctype, doc.name);
	}
}

// "when I open the invoice preview and then go back, the system
// immediately asks me to create a new bill" (2026-07-31 direct request,
// root cause traced live) — `window.open(url, "_blank")` for Preview/
// Save PDF only behaves safely if the browser actually opens a NEW tab;
// in this session's own Browser pane it silently reused the SAME tab
// instead (confirmed: `tabs_context` showed no second tab after
// clicking Preview), turning "open a preview" into a full navigation
// away from the POS single-page app — pressing Back then force-reloads
// `/app/point-of-sale` into a brand-new invoice, which is exactly the
// reported bug. Fetching the PDF as base64 (the same
// `get_invoice_pdf_base64` endpoint QZ Tray printing already uses) and
// rendering/downloading it in-page never navigates the tab at all, so
// there's nothing for a Back press to undo.
async function santu_get_pdf_info(doc) {
	const print_format =
		doc.doctype === "POS Invoice" ? "Santu Hardware Thermal Bill" : "Santu Hardware Thermal Bill (Sales Invoice)";
	const base64 = await frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_pdf_base64", {
		doctype: doc.doctype,
		name: doc.name,
		print_format,
	});
	return { base64, print_format };
}

function santu_download_pdf_blob(base64, filename) {
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

// On-screen preview only — Save PDF (below) still uses the real PDF bytes,
// which QZ Tray/file downloads genuinely need. The on-screen box rendered
// solid black no matter how the PDF bytes reached the iframe (raw data:
// URI, then a Blob URL — both tried, both still black), so the PDF itself
// was the problem, not the delivery mechanism. This sidesteps it by using
// Frappe core's OWN print-preview mechanism instead — the same
// `frappe.www.printview.get_html_and_style` call the standard "Print"
// toolbar button's live preview uses — which renders the print format
// straight to HTML/CSS, no PDF generation involved at all.
async function santu_show_pdf_preview(doc) {
	const print_format =
		doc.doctype === "POS Invoice" ? "Santu Hardware Thermal Bill" : "Santu Hardware Thermal Bill (Sales Invoice)";
	const r = await frappe.call({
		method: "frappe.www.printview.get_html_and_style",
		args: { doc: doc.doctype, name: doc.name, print_format, no_letterhead: 0 },
	});
	const { html, style } = r.message || {};

	const preview_dialog = new frappe.ui.Dialog({
		title: __("Preview — {0}", [doc.name]),
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "pdf_preview",
				options: html
					? `<div class="santu-pdf-preview-wrap"></div>`
					: `<div style="padding:60px 20px;text-align:center;color:var(--gray-600);">${__("Preview unavailable.")}</div>`,
			},
		],
	});
	preview_dialog.show();

	if (html) {
		const iframe = document.createElement("iframe");
		iframe.style.cssText = "width:100%;height:70vh;border:1px solid var(--gray-300);background:#fff;";
		preview_dialog.fields_dict.pdf_preview.$wrapper.find(".santu-pdf-preview-wrap").append(iframe);
		iframe.srcdoc = `<html><head><style>${style || ""}</style></head><body><div class="print-format print-format-preview">${html}</div></body></html>`;
	}
}

// `contact_mobile` only gets populated when a real Contact record was
// linked during billing — this shop's customers mostly just have
// `mobile_no` set directly on the Customer master instead (same
// fallback the print format already uses), so the WhatsApp button needs
// to check both or it stays hidden for customers who do have a number
// on file.
async function santu_get_customer_mobile(doc) {
	if (doc.contact_mobile) return doc.contact_mobile;
	if (!doc.customer) return null;
	const customer = await frappe.db.get_doc("Customer", doc.customer);
	return customer.mobile_no || null;
}

async function santu_show_post_sale_popup(doc) {
	const customer_mobile = await santu_get_customer_mobile(doc);

	const d = new frappe.ui.Dialog({
		title: __("Invoice Created — {0}", [doc.name]),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "summary",
				options: `
					<div class="santu-post-sale-summary">
						<div class="santu-post-sale-amount">₹ ${format_currency(doc.grand_total, doc.currency).replace(/^\D+/, "")}</div>
						<div class="santu-post-sale-customer">${frappe.utils.escape_html(doc.customer_name || doc.customer)}</div>
					</div>
				`,
			},
		],
		primary_action_label: __("Print"),
		primary_action: async () => {
			await santu_print_thermal_bill(doc.doctype, doc.name);
		},
	});

	d.set_secondary_action_label(__("Close"));

	// Extra actions below the standard primary/secondary buttons — Frappe
	// dialogs don't support more than two out of the box, so these are
	// appended directly.
	const $extra = $(`<div class="santu-post-sale-actions"></div>`);
	$extra.insertAfter(d.$wrapper.find(".modal-footer .standard-actions"));

	$(`<button class="btn btn-default btn-sm">${__("Preview")}</button>`)
		.on("click", async () => {
			await santu_show_pdf_preview(doc);
		})
		.appendTo($extra);

	$(`<button class="btn btn-default btn-sm">${__("Save PDF")}</button>`)
		.on("click", async () => {
			const info = await santu_get_pdf_info(doc);
			santu_download_pdf_blob(info.base64, `${doc.name}.pdf`);
		})
		.appendTo($extra);

	if (customer_mobile) {
		$(`<button class="btn btn-default btn-sm santu-whatsapp-btn">${__("Share on WhatsApp")}</button>`)
			.on("click", () => santu_share_on_whatsapp(doc, customer_mobile))
			.appendTo($extra);
	}

	d.show();
}

function santu_share_on_whatsapp(doc, customer_mobile) {
	if (window.santu_whatsapp_share) {
		window.santu_whatsapp_share.send_transaction(doc.doctype, doc.name);
		return;
	}
	frappe.msgprint(__("WhatsApp share is loading — please try again."));
}

// Reprint Last Invoice — Phase 1/6. Looks up the most recent submitted
// POS Invoice for the current user rather than requiring a document to
// already be open, so it works as a single always-available action
// (e.g. a "Reprint Last Bill" tile on the billing screen).
async function santu_reprint_last_invoice() {
	const rows = await frappe.db.get_list("POS Invoice", {
		filters: { docstatus: 1, owner: frappe.session.user },
		fields: ["name", "doctype"],
		order_by: "creation desc",
		limit: 1,
	});
	if (!rows.length) {
		frappe.msgprint(__("No bills yet today."));
		return;
	}
	await santu_print_thermal_bill("POS Invoice", rows[0].name);
}
