// "Upload bill in PDF, auto-read the goods received, update inventory"
// (2026-08-02 direct request). This page only reads the PDF (see
// get_purchase_invoice_from_bill_pdf in api.py) and returns plain parsed
// data — supplier, bill no/date, items with qty/rate. The review-and-edit
// step is the same Vyapar-style Purchase screen used for every other
// purchase in this shop (2026-08-17 direct request: "upload pdf bill me jo
// ui aata hia, uske baad jo ui aata hia, us ui ko vyapaar type bana do") —
// a scanned bill is not a different kind of purchase, so it should not open
// a different-looking screen. santu_purchase_invoice.js's
// _apply_prefill_bills() turns each detected bill into its own tab there,
// pre-filled and ready to check before saving — same tabs, same buttons,
// same screen a hand-typed purchase uses. Nothing is created here; the
// actual (draft) Purchase Invoice only exists once the user saves that tab,
// same as any other purchase.
//
// Choosing the file and reading it both happen right on this one card —
// no separate popup on top (2026-08-17 direct follow-up: "ye itna dialogue
// kyu khul rha hai, ek hi dialog me kro"). frappe.ui.FileUploader is its
// own modal dialog on top of this page; a plain hidden <input type=file>
// triggers the browser's native OS file picker instead (unavoidable — a
// file has to be chosen somewhere — but that isn't an app-level dialog),
// uploaded directly, with every step's status shown in the same spot this
// card already has.
frappe.pages["santu-upload-bill"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Upload Supplier Bill",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_upload_bill(page);
};

function render_upload_bill(page) {
	const $root = $(`<div class="santu-upload-bill"></div>`).appendTo(page.body);

	$root.html(`
		<div class="santu-upload-bill-card">
			<div class="santu-upload-bill-icon">📄</div>
			<div class="santu-upload-bill-title">${__("Upload Supplier Bill (PDF)")}</div>
			<div class="santu-upload-bill-help">
				${__(
					"Upload the PDF bill you received from a supplier — item, quantity, and rate will be read automatically and filled into a Purchase Invoice for you to check before it updates inventory. Works best for text-based PDFs (not scanned photos)."
				)}
			</div>
			<button class="btn btn-primary santu-upload-bill-btn">${__("Choose PDF & Read Bill")}</button>
			<input type="file" accept="application/pdf,.pdf" class="santu-upload-bill-file-input" style="display:none">
			<div class="santu-upload-bill-status"></div>
		</div>
	`);

	const $status = $root.find(".santu-upload-bill-status");
	const $file_input = $root.find(".santu-upload-bill-file-input");

	$root.find(".santu-upload-bill-btn").on("click", () => $file_input.trigger("click"));

	$file_input.on("change", (e) => {
		const file = e.target.files && e.target.files[0];
		$file_input.val("");
		if (!file) return;
		santu_upload_and_parse(file, $status);
	});
}

async function santu_upload_and_parse(file, $status) {
	$status.html(`<div class="santu-upload-bill-reading">${__("Uploading...")}</div>`);

	const form_data = new FormData();
	form_data.append("file", file, file.name);
	form_data.append("is_private", 1);
	form_data.append("folder", "Home/Attachments");

	let file_url;
	try {
		const res = await fetch("/api/method/upload_file", {
			method: "POST",
			headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
			body: form_data,
		});
		const data = await res.json();
		if (!res.ok || !data.message) throw new Error((data.message && data.message.message) || __("Upload failed."));
		file_url = data.message.file_url;
	} catch (e) {
		$status.html(`<div class="santu-upload-bill-error">${__("Upload nahi ho paya — dobara koshish karein.")}</div>`);
		return;
	}

	santu_parse_bill(file_url, $status);
}

async function santu_parse_bill(file_url, $status) {
	$status.html(`<div class="santu-upload-bill-reading">${__("Reading bill...")}</div>`);

	let r;
	try {
		r = await frappe.call({
			method: "santu_hardware.santu_hardware.api.get_purchase_invoice_from_bill_pdf",
			args: { file_url },
			freeze: true,
			freeze_message: __("Reading bill..."),
		});
	} catch (e) {
		$status.html("");
		return;
	}
	$status.html("");
	const bills = (r && r.message && r.message.bills) || [];
	if (!bills.length) return;

	// Newly-created items are the one thing worth flagging before handing
	// off — everything else (supplier, qty, rate) is corrected right on the
	// Purchase screen itself, same as any other line on any other bill.
	const auto_created_total = bills.reduce((sum, b) => sum + (b.auto_created_items || []).length, 0);
	if (auto_created_total) {
		frappe.show_alert({
			message: __("{0} item(s) from this bill are new in your catalog — double-check name/rate on the Purchase screen.", [
				auto_created_total,
			]),
			indicator: "orange",
		});
	}

	frappe.route_options = bills.length > 1 ? { prefill_bills: bills } : { prefill: bills[0] };
	frappe.set_route("santu-purchase-invoice");
}
