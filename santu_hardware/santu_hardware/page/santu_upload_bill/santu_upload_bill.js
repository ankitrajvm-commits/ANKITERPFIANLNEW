// "Upload bill in PDF, auto-read the goods received, update inventory"
// (2026-08-02 direct request). Step 1 (this page) only reads the PDF and
// returns plain parsed data (see get_purchase_invoice_from_bill_pdf in
// api.py). Step 2 is santu_show_bill_editor below: every detected bill
// (usually one, sometimes more — a real supplier PDF tested live turned
// out to bundle two separate invoices) gets its own fully editable table
// on ONE screen — Item/Qty/Rate/Supplier all correctable right there,
// rows addable/removable — with a live running total. Step 3, only once
// the user clicks "Create", actually creates the real (draft, unsubmitted)
// Purchase Invoice record(s) via create_purchase_invoices_from_bills.
// Submitting each one — the point where stock/accounts actually change —
// still happens afterward, opened from the result list, same as any
// hand-entered purchase.
//
// This intentionally does NOT hand off to ERPNext's own native Purchase
// Invoice form (an earlier version of this file did, via frappe.new_doc())
// — 2026-08-02 direct follow-up request, after testing against a real
// multi-invoice PDF: "mujhe ek hi screen pe dono table saath dikhna
// chahiye... items bhi isi screen pe edit karna chahiye" (both bills'
// tables together on one screen, items editable right there too, not
// opened one at a time in a native form). Desk's Form view can only show
// one document per tab at all — a hard limit of the doctype/view
// architecture, not a choice made here — so "multiple bills, all visible
// and editable together, one tab" only works if this review screen IS the
// editor and creates the records directly.
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
			<div class="santu-upload-bill-status"></div>
		</div>
	`);

	const $status = $root.find(".santu-upload-bill-status");

	$root.find(".santu-upload-bill-btn").on("click", () => {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".pdf"] },
			on_success: (file_doc) => {
				santu_parse_bill(file_doc.file_url, $status);
			},
		});
	});
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

	santu_show_bill_editor(bills);
}

// The one review screen for everything this PDF turned out to contain —
// see the file-level comment above for why this isn't ERPNext's native
// Purchase Invoice form. `state` mirrors `bills` one-to-one and holds the
// live standalone field controls (frappe.ui.form.make_control — the same
// mechanism Frappe's own list-view filters use for a field control with
// no `frm`/doc behind it) for everything editable: Supplier, Bill No,
// Bill Date per bill, and Item/Qty/Rate per row. Reading final values at
// "Create" time means asking these controls, not the original parsed
// data — that data is only ever the STARTING point.
function santu_show_bill_editor(bills) {
	const state = bills.map(() => ({ rows: [] }));

	const sections_html = bills
		.map((bill, i) => {
			const auto_note = bill.auto_created_items.length
				? `<div class="santu-bill-note">${__(
						"{0} of these items are newly created in your catalog (from this bill) — double-check the Item name/rate, or search and pick a different existing Item if one of these is actually a duplicate under another name.",
						[bill.auto_created_items.length]
					)}</div>`
				: "";

			return `
				<div class="santu-bill-section" data-bill-index="${i}">
					<div class="santu-bill-section-header">
						<label>
							<input type="checkbox" class="santu-bill-toggle" data-bill-index="${i}" checked>
							<b>${__("Invoice {0}", [i + 1])}</b>
						</label>
					</div>
					<div class="santu-bill-meta-row">
						<div class="santu-bill-meta-field" data-field="supplier" data-bill-index="${i}"></div>
						<div class="santu-bill-meta-field" data-field="bill_no" data-bill-index="${i}"></div>
						<div class="santu-bill-meta-field" data-field="bill_date" data-bill-index="${i}"></div>
					</div>
					<table class="santu-bill-table">
						<thead>
							<tr><th>${__("Item")}</th><th>${__("Qty")}</th><th>${__("Rate")}</th><th>${__("Amount")}</th><th></th></tr>
						</thead>
						<tbody class="santu-bill-rows" data-bill-index="${i}"></tbody>
					</table>
					<button class="btn btn-xs btn-default santu-bill-add-row" data-bill-index="${i}">${__("+ Add Item")}</button>
					<div class="santu-bill-subtotal">${__("Subtotal")}: <span class="santu-bill-subtotal-value" data-bill-index="${i}">₹ 0.00</span></div>
					${auto_note}
				</div>`;
		})
		.join("");

	const d = new frappe.ui.Dialog({
		title:
			bills.length > 1
				? __("{0} bills found in this PDF — review and create", [bills.length])
				: __("Review bill before creating Purchase Invoice"),
		size: "extra-large",
		fields: [
			{
				fieldtype: "HTML",
				options: `<div class="santu-bill-editor">${sections_html}<div class="santu-bill-grand-total">${__("Total")}: <span class="santu-bill-grand-total-value">₹ 0.00</span></div></div>`,
			},
		],
		primary_action_label: __("Create Purchase Invoice(s)"),
		primary_action: () => santu_create_bills(d, bills, state),
	});
	d.show();

	bills.forEach((bill, i) => {
		const $section = d.$wrapper.find(`.santu-bill-section[data-bill-index="${i}"]`);

		const supplier_control = frappe.ui.form.make_control({
			parent: $section.find('[data-field="supplier"]')[0],
			df: { fieldtype: "Link", options: "Supplier", fieldname: "supplier", label: __("Supplier"), reqd: 1 },
			render_input: true,
		});
		supplier_control.refresh();
		if (bill.supplier) supplier_control.set_value(bill.supplier);

		const bill_no_control = frappe.ui.form.make_control({
			parent: $section.find('[data-field="bill_no"]')[0],
			df: { fieldtype: "Data", fieldname: "bill_no", label: __("Supplier Invoice No") },
			render_input: true,
		});
		bill_no_control.refresh();
		if (bill.bill_no) bill_no_control.set_value(bill.bill_no);

		const bill_date_control = frappe.ui.form.make_control({
			parent: $section.find('[data-field="bill_date"]')[0],
			df: { fieldtype: "Date", fieldname: "bill_date", label: __("Supplier Invoice Date") },
			render_input: true,
		});
		bill_date_control.refresh();
		if (bill.bill_date) bill_date_control.set_value(bill.bill_date);

		state[i].supplier_control = supplier_control;
		state[i].bill_no_control = bill_no_control;
		state[i].bill_date_control = bill_date_control;
		state[i].source_bill_pdf = bill.source_bill_pdf;

		bill.items.forEach((row) => santu_add_item_row(d, state, i, row));
	});

	d.$wrapper.find(".santu-bill-toggle").on("change", function () {
		const index = $(this).data("bill-index");
		d.$wrapper
			.find(`.santu-bill-section[data-bill-index="${index}"]`)
			.toggleClass("santu-bill-section-excluded", !this.checked);
		santu_recalc_grand_total(d, state);
	});

	d.$wrapper.find(".santu-bill-add-row").on("click", function () {
		const index = $(this).data("bill-index");
		santu_add_item_row(d, state, index, { item_code: null, qty: 1, rate: 0 });
	});

	santu_recalc_grand_total(d, state);
}

function santu_add_item_row(d, state, bill_index, row_data) {
	const $tbody = d.$wrapper.find(`.santu-bill-rows[data-bill-index="${bill_index}"]`);
	const $tr = $(`
		<tr>
			<td class="santu-bill-cell-item"></td>
			<td class="santu-bill-cell-qty"></td>
			<td class="santu-bill-cell-rate"></td>
			<td class="santu-bill-num santu-bill-cell-amount">₹ 0.00</td>
			<td><button type="button" class="btn btn-xs btn-default santu-bill-remove-row">×</button></td>
		</tr>
	`);
	$tbody.append($tr);

	const item_control = frappe.ui.form.make_control({
		parent: $tr.find(".santu-bill-cell-item")[0],
		df: {
			fieldtype: "Link",
			options: "Item",
			fieldname: "item_code",
			placeholder: row_data.description || __("Search item"),
		},
		render_input: true,
	});
	item_control.refresh();
	if (row_data.item_code) item_control.set_value(row_data.item_code);

	const qty_control = frappe.ui.form.make_control({
		parent: $tr.find(".santu-bill-cell-qty")[0],
		df: { fieldtype: "Float", fieldname: "qty" },
		render_input: true,
	});
	qty_control.refresh();
	qty_control.set_value(row_data.qty || 1);

	const rate_control = frappe.ui.form.make_control({
		parent: $tr.find(".santu-bill-cell-rate")[0],
		df: { fieldtype: "Currency", fieldname: "rate" },
		render_input: true,
	});
	rate_control.refresh();
	rate_control.set_value(row_data.rate || 0);

	const row_state = {
		item_control,
		qty_control,
		rate_control,
		hsn: row_data.hsn || null,
		// Tracked separately from the controls, not re-read via
		// get_value() on every recalc — confirmed live, control.set_value()
		// is async (frappe.run_serially under the hood), so reading it
		// straight back synchronously right after setting it sees the
		// PRE-set value: every Amount cell showed ₹0.00 on first render
		// despite the Qty/Rate inputs themselves displaying correctly.
		// This starts from the real parsed data directly and only trusts
		// get_value() once a real input/change event has fired (by which
		// point the control has genuinely settled).
		qty: flt(row_data.qty) || 1,
		rate: flt(row_data.rate) || 0,
		$tr,
		$amount: $tr.find(".santu-bill-cell-amount"),
	};
	state[bill_index].rows.push(row_state);

	const recalc_row = () => {
		row_state.qty = flt(qty_control.get_value()) || 0;
		row_state.rate = flt(rate_control.get_value()) || 0;
		row_state.$amount.text(format_currency(row_state.qty * row_state.rate));
		santu_recalc_grand_total(d, state);
	};
	qty_control.$input.on("change input", recalc_row);
	rate_control.$input.on("change input", recalc_row);
	row_state.$amount.text(format_currency(row_state.qty * row_state.rate));

	$tr.find(".santu-bill-remove-row").on("click", () => {
		$tr.remove();
		const idx = state[bill_index].rows.indexOf(row_state);
		if (idx > -1) state[bill_index].rows.splice(idx, 1);
		santu_recalc_grand_total(d, state);
	});
}

function santu_recalc_grand_total(d, state) {
	let grand_total = 0;
	state.forEach((bill_state, i) => {
		const subtotal = bill_state.rows.reduce((sum, row) => sum + row.qty * row.rate, 0);
		d.$wrapper.find(`.santu-bill-subtotal-value[data-bill-index="${i}"]`).text(format_currency(subtotal));

		if (d.$wrapper.find(`.santu-bill-toggle[data-bill-index="${i}"]`).is(":checked")) {
			grand_total += subtotal;
		}
	});
	d.$wrapper.find(".santu-bill-grand-total-value").text(format_currency(grand_total));
}

async function santu_create_bills(d, bills, state) {
	const payload = [];
	for (let i = 0; i < bills.length; i++) {
		if (!d.$wrapper.find(`.santu-bill-toggle[data-bill-index="${i}"]`).is(":checked")) continue;

		const s = state[i];
		const supplier = s.supplier_control.get_value();
		if (!supplier) {
			frappe.msgprint(__("Please select a Supplier for Invoice {0} before creating it.", [i + 1]));
			return;
		}

		const items = [];
		for (const row of s.rows) {
			const item_code = row.item_control.get_value();
			if (!item_code) {
				frappe.msgprint(
					__(
						"Invoice {0} has a row with no Item selected — search and pick one, or remove that row (the × button), before creating.",
						[i + 1]
					)
				);
				return;
			}
			items.push({
				item_code,
				qty: flt(row.qty_control.get_value()) || 1,
				rate: flt(row.rate_control.get_value()) || 0,
				hsn: row.hsn,
			});
		}
		if (!items.length) {
			frappe.msgprint(__("Invoice {0} has no items — add at least one, or untick it.", [i + 1]));
			return;
		}

		payload.push({
			supplier,
			bill_no: s.bill_no_control.get_value(),
			bill_date: s.bill_date_control.get_value(),
			source_bill_pdf: s.source_bill_pdf,
			items,
		});
	}

	if (!payload.length) {
		frappe.msgprint(__("Tick at least one bill to create."));
		return;
	}

	let r;
	try {
		r = await frappe.call({
			method: "santu_hardware.santu_hardware.api.create_purchase_invoices_from_bills",
			args: { bills: payload },
			freeze: true,
			freeze_message: __("Creating Purchase Invoice(s)..."),
		});
	} catch (e) {
		return;
	}

	d.hide();
	santu_show_creation_result(r.message || []);
}

function santu_show_creation_result(created) {
	const rows = created
		.map(
			(inv) =>
				`<li><a href="/app/purchase-invoice/${encodeURIComponent(inv.name)}" target="_blank">${frappe.utils.escape_html(inv.name)}</a>${
					inv.bill_no ? " — " + frappe.utils.escape_html(inv.bill_no) : ""
				} — ${format_currency(inv.grand_total)}</li>`
		)
		.join("");

	frappe.msgprint({
		title: __("Purchase Invoice(s) created"),
		indicator: "green",
		message:
			`<p>${__(
				"Created as drafts — nothing has updated stock or accounts yet. Open each one, do a final check, and Submit when ready:"
			)}</p><ul>${rows}</ul>`,
	});
}
