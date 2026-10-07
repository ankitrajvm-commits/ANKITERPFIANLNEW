/* global frappe */
// Vyapar-style read-only view for an already-saved Sales Invoice / Purchase
// Invoice / Quotation (2026-08-15 direct request: the native ERPNext Form
// view must never appear anywhere, not even for viewing a saved document —
// every "Share"/"Open"/transaction-row click across the app now routes here
// via window.santu_open_invoice_view() in santu_topbar.js instead of
// straight to Form/<doctype>/<name>). Reuses the same santu-si2-* CSS
// already shipped for the Sale/Purchase quick-entry screens, so this reads
// as one continuous visual language rather than a bolted-on extra screen.
// Which document types can be reopened and corrected, and which screen each
// one reopens on. Kept beside the view rather than inside it because the
// buttons and the click handler both read it, and they must never disagree
// about what is editable. Sales Invoice is deliberately absent -- it has its
// own older, payment-aware edit path through Billing (edit-bill below).
const SANTU_EDITABLE_DOCS = {
	Quotation: { label: "Estimate", route: "santu-estimate", option: "edit_quotation" },
	"Sales Order": { label: "Order", route: "santu-sales-order", option: "edit_order" },
	"Delivery Note": { label: "Challan", route: "santu-delivery-challan", option: "edit_challan" },
	"Purchase Invoice": { label: "Purchase Bill", route: "santu-purchase-invoice", option: "edit_purchase" },
	"Purchase Order": { label: "Purchase Order", route: "santu-purchase-order", option: "edit_purchase_order" },
};

frappe.pages["santu-view-invoice"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "Invoice", single_column: true });
	$(page.wrapper).find(".page-head").hide();
	$(page.main).addClass("santu-si2-page-main");
	santu_view_invoice_page.init(page);
};

frappe.pages["santu-view-invoice"].on_page_show = function () {
	santu_view_invoice_page.init(santu_view_invoice_page.page);
};

// On `window` rather than a top-level const: a classic script's top-level
// const isn't a window property, and santu_open_invoice_view reaches for it
// by that name to re-init this page when it's already the visible route.
window.santu_view_invoice_page = {
	init(page) {
		this.page = page;
		const opts = frappe.route_options || {};
		this.doctype = opts.doctype;
		this.name = opts.name;
		if (this.doctype && this.name) {
			sessionStorage.setItem("santu_view_invoice_last", JSON.stringify({ doctype: this.doctype, name: this.name }));
		} else {
			try {
				const last = JSON.parse(sessionStorage.getItem("santu_view_invoice_last") || "null");
				if (last) {
					this.doctype = last.doctype;
					this.name = last.name;
				}
			} catch (e) {
				// ignore corrupt storage
			}
		}
		frappe.route_options = null;

		if (!this.doctype || !this.name) {
			$(page.body).html(`<div class="santu-si2-loading">No invoice selected.</div>`);
			return;
		}

		$(page.body).html(`<div class="santu-si2-loading">Loading…</div>`);
		frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_view_data", {
			doctype: this.doctype,
			name: this.name,
		})
			.then((data) => {
				this.data = data;
				this.render();
			})
			.catch(() => {
				$(page.body).html(`<div class="santu-si2-loading">Could not load this document.</div>`);
			});
	},

	_fmt(v) {
		return "₹ " + format_currency(v || 0, "INR").replace(/^\D+/, "");
	},

	_status_class(status) {
		const s = (status || "").toLowerCase();
		if (s.includes("paid") && !s.includes("unpaid")) return "santu-view-status-green";
		if (s.includes("overdue") || s === "cancelled") return "santu-view-status-red";
		if (s.includes("unpaid") || s.includes("partly")) return "santu-view-status-orange";
		return "santu-view-status-gray";
	},

	_doc_label(d) {
		const LABELS = {
			"Sales Invoice": "Sale",
			"POS Invoice": "Sale",
			"Purchase Invoice": "Purchase",
			Quotation: "Estimate",
			"Sales Order": "Sales Order",
			"Purchase Order": "Purchase Order",
			"Delivery Note": "Delivery Challan",
			"Payment Entry": d.payment_type === "Pay" ? "Payment Out" : "Payment In",
			// A Journal Entry is an Expense here only when it actually posts
			// against an expense account. Party to Party Transfer writes one
			// too, with a party on both rows and no expense account in
			// sight — labelling that "Expense" would misfile it for whoever
			// opens it later.
			"Journal Entry": (d.accounts || []).length === 2 && (d.accounts || []).every((r) => r.party)
				? "Party Transfer"
				: "Expense",
		};
		return LABELS[d.doctype] || d.doctype;
	},

	render() {
		const d = this.data;
		if (d.kind === "payment") return this._render_payment();
		if (d.kind === "journal") return this._render_journal();
		this._render_item_doc();
	},

	_render_actionbar($body, d, { whatsapp = true } = {}) {
		$body.find('[data-action="back"]').on("click", () => window.history.back());
		const open_pdf = () => {
			window.open(
				frappe.urllib.get_full_url(
					`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(d.doctype)}&name=${encodeURIComponent(d.name)}&format=&no_letterhead=0`
				),
				"_blank"
			);
		};
		// Sales Invoice/POS Invoice get the real thermal ladder
		// (santu_print_thermal_bill — 2026-08-19: full-page print instead of
		// the thermal slip, paper never cutting). Everything else here used
		// to fall through to santu_print_thermal_bill's own default, which is
		// frappe.set_route("print", ...) — ERPNext's raw native print page,
		// with the shop's own topbar/sidebar gone and the doctype's actual
		// field names showing ("Exchange Gain/Loss", "Paid From Account
		// Type"...). For a Payment In/Out receipt that reads as the app
		// crashing, not as a print dialog (2026-08-19 bug report: "app
		// crash kr raha jab maine koi bill pay kiya... print pe click kiya
		// then app crashed"). This screen's own header comment already
		// bans the native Form/print view outright, so Print does what PDF
		// already safely does — a real PDF in a new tab, app shell intact —
		// for every doctype that doesn't have its own thermal format.
		const THERMAL_DOCTYPES = ["Sales Invoice", "POS Invoice"];
		$body.find('[data-action="print"]').on("click", () => {
			if (THERMAL_DOCTYPES.includes(d.doctype)) window.santu_print_thermal_bill(d.doctype, d.name);
			else open_pdf();
		});
		$body.find('[data-action="pdf"]').on("click", open_pdf);
		// Bound here rather than in one render function: the payment screen and
		// the item-document screen both draw this button.
		$body.find('[data-action="edit-payment"]').on("click", () => {
			frappe.route_options = { edit_payment: d.name };
			frappe.set_route("santu-payment-entry");
		});
		if (whatsapp) {
			$body.find('[data-action="whatsapp"]').on("click", () => this._send_whatsapp());
			$body.find('[data-action="whatsapp_other"]').on("click", () => this._send_whatsapp(true));
		}
	},

	_render_payment() {
		const d = this.data;
		const $body = $(this.page.body);
		const doc_label = this._doc_label(d);

		$body.html(`
			<div class="santu-si2">
				<div class="santu-si2-tabbar">
					<div class="santu-si2-tabs">
						<button type="button" class="santu-si2-tab is-active" disabled>
							<span class="santu-si2-tab-label">${frappe.utils.escape_html(d.name)}</span>
						</button>
					</div>
				</div>
				<div class="santu-si2-body">
					<div class="santu-si2-header">
						<div class="santu-si2-header-title">${doc_label} <span class="santu-view-status-badge ${this._status_class(d.status)}">${frappe.utils.escape_html(d.status)}</span></div>
					</div>

					<div class="santu-si2-toprow">
						<div class="santu-si2-customer-col">
							<div class="santu-si2-cust-card">
								<div class="santu-si2-cust-name">${frappe.utils.escape_html(d.party_name || d.party || "")}</div>
							</div>
						</div>
						<div class="santu-si2-customer-info"></div>
						<div class="santu-si2-invoice-info">
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Reference No</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.name)}</span>
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Date</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(frappe.datetime.str_to_user(d.posting_date) || "")}</span>
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Mode of Payment</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.mode_of_payment || "—")}</span>
							</div>
							${d.reference_no ? `
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Ref / Cheque No</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.reference_no)}</span>
							</div>` : ""}
						</div>
					</div>

					${d.allocations.length ? `
					<div class="santu-si2-table-wrap">
						<!-- Only the table scrolls sideways: the item-search dropdown is a
						     child of the WRAP, so it must stay outside this box or it gets
						     clipped (that bug made searching look like it found nothing). -->
						<div class="santu-si2-table-scroll">
						<table class="santu-si2-table">
							<thead>
								<tr>
									<th class="santu-si2-col-idx">#</th>
									<th class="santu-si2-col-item">PAID AGAINST</th>
									<th class="santu-si2-col-amount">ALLOCATED</th>
								</tr>
							</thead>
							<tbody>
								${d.allocations.map((row, idx) => `
									<tr>
										<td class="santu-si2-col-idx">${idx + 1}</td>
										<td class="santu-si2-col-item"><div class="santu-si2-item-name">${frappe.utils.escape_html(row.reference_doctype)}: ${frappe.utils.escape_html(row.reference_name)}</div></td>
										<td class="santu-si2-col-amount santu-si2-figures">${this._fmt(row.allocated_amount)}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
						</div>
					</div>` : ""}

					<div class="santu-si2-lowerrow">
						<div class="santu-si2-extras"></div>
						<div class="santu-si2-summary">
							<div class="santu-si2-summary-row santu-si2-summary-total">
								<span>Amount</span>
								<span class="santu-si2-figures">${this._fmt(d.paid_amount)}</span>
							</div>
						</div>
					</div>

					<div class="santu-si2-actionbar">
						<div class="santu-si2-actionbar-left">
							<button type="button" class="santu-si2-btn" data-action="back">← Back</button>
							${
								// Payment In / Payment Out is rendered by this function,
								// not by _render_item_doc, so the Edit button added there
								// never appeared on a payment (reported 2026-10-07:
								// "abhi tak payment in me koi edit option nh aaya hai").
								d.docstatus === 1
									? `<button type="button" class="santu-si2-btn santu-si2-btn-edit" data-action="edit-payment" title="${__("Amount ya payment mode galat hai? Yahan se sudhaar kar dobara save ho jayega.")}">${__("Edit Payment")}</button>`
									: ""
							}
						</div>
						<div class="santu-si2-actionbar-right">
							<button type="button" class="santu-si2-btn" data-action="whatsapp">Send on WhatsApp</button>
							<button type="button" class="santu-si2-btn" data-action="whatsapp_other">↗ Kisi aur ko</button>
							<button type="button" class="santu-si2-btn" data-action="print">Print</button>
							<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="pdf">Download PDF</button>
						</div>
					</div>
				</div>
			</div>
		`);

		this._render_actionbar($body, d);
	},

	_render_journal() {
		const d = this.data;
		const $body = $(this.page.body);
		// Was hardcoded "Expense" — the only Journal Entry this app wrote at
		// the time. Party to Party Transfer writes them too now, so this has
		// to go through _doc_label like every other render branch does.
		const doc_label = this._doc_label(d);

		$body.html(`
			<div class="santu-si2">
				<div class="santu-si2-tabbar">
					<div class="santu-si2-tabs">
						<button type="button" class="santu-si2-tab is-active" disabled>
							<span class="santu-si2-tab-label">${frappe.utils.escape_html(d.name)}</span>
						</button>
					</div>
				</div>
				<div class="santu-si2-body">
					<div class="santu-si2-header">
						<div class="santu-si2-header-title">${doc_label} <span class="santu-view-status-badge ${this._status_class(d.status)}">${frappe.utils.escape_html(d.status)}</span></div>
					</div>

					<div class="santu-si2-toprow">
						<div class="santu-si2-invoice-info">
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Reference No</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.name)}</span>
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">Date</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(frappe.datetime.str_to_user(d.posting_date) || "")}</span>
							</div>
						</div>
					</div>

					<div class="santu-si2-table-wrap">
						<!-- Only the table scrolls sideways: the item-search dropdown is a
						     child of the WRAP, so it must stay outside this box or it gets
						     clipped (that bug made searching look like it found nothing). -->
						<div class="santu-si2-table-scroll">
						<table class="santu-si2-table">
							<thead>
								<tr>
									<th class="santu-si2-col-idx">#</th>
									<th class="santu-si2-col-item">ACCOUNT</th>
									<th class="santu-si2-col-amount">DEBIT</th>
									<th class="santu-si2-col-amount">CREDIT</th>
								</tr>
							</thead>
							<tbody>
								${d.accounts.map((row, idx) => `
									<tr>
										<td class="santu-si2-col-idx">${idx + 1}</td>
										<td class="santu-si2-col-item"><div class="santu-si2-item-name">${frappe.utils.escape_html(row.account)}${row.party ? ` (${frappe.utils.escape_html(row.party)})` : ""}</div></td>
										<td class="santu-si2-col-amount santu-si2-figures">${row.debit ? this._fmt(row.debit) : "—"}</td>
										<td class="santu-si2-col-amount santu-si2-figures">${row.credit ? this._fmt(row.credit) : "—"}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
						</div>
					</div>

					<div class="santu-si2-lowerrow">
						<div class="santu-si2-extras">
							${d.user_remark ? `<div class="santu-view-note"><b>Remark</b><p>${frappe.utils.escape_html(d.user_remark)}</p></div>` : ""}
						</div>
						<div class="santu-si2-summary">
							<div class="santu-si2-summary-row santu-si2-summary-total">
								<span>Total</span>
								<span class="santu-si2-figures">${this._fmt(d.grand_total)}</span>
							</div>
						</div>
					</div>

					<div class="santu-si2-actionbar">
						<div class="santu-si2-actionbar-left">
							<button type="button" class="santu-si2-btn" data-action="back">← Back</button>
						</div>
						<div class="santu-si2-actionbar-right">
							<button type="button" class="santu-si2-btn" data-action="print">Print</button>
							<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="pdf">Download PDF</button>
						</div>
					</div>
				</div>
			</div>
		`);

		this._render_actionbar($body, d, { whatsapp: false });
	},

	_render_item_doc() {
		const d = this.data;
		const $body = $(this.page.body);
		const doc_label = this._doc_label(d);

		$body.html(`
			<div class="santu-si2">
				<div class="santu-si2-tabbar">
					<div class="santu-si2-tabs">
						<button type="button" class="santu-si2-tab is-active" disabled>
							<span class="santu-si2-tab-label">${frappe.utils.escape_html(d.display_number || santu_bill_label(d.santu_bill_no))}</span>
						</button>
					</div>
				</div>
				<div class="santu-si2-body">
					<div class="santu-si2-header">
						<div class="santu-si2-header-title">${doc_label} <span class="santu-view-status-badge ${this._status_class(d.status)}">${frappe.utils.escape_html(d.status)}</span></div>
					</div>

					<div class="santu-si2-toprow">
						<div class="santu-si2-customer-col">
							<div class="santu-si2-cust-card">
								<div class="santu-si2-cust-name">${frappe.utils.escape_html(d.party_name || d.party || "")}</div>
							</div>
						</div>
						<div class="santu-si2-customer-info"></div>
						<div class="santu-si2-invoice-info">
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">${doc_label} Number</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.display_number || santu_bill_label(d.santu_bill_no))}</span>
							</div>
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">${doc_label} Date</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(frappe.datetime.str_to_user(d.posting_date) || "")}</span>
							</div>
							${d.place_of_supply ? `
							<div class="santu-si2-inv-row">
								<span class="santu-si2-inv-label">State of supply</span>
								<span class="santu-si2-inv-value">${frappe.utils.escape_html(d.place_of_supply)}</span>
							</div>` : ""}
						</div>
					</div>

					<div class="santu-si2-table-wrap">
						<!-- Only the table scrolls sideways: the item-search dropdown is a
						     child of the WRAP, so it must stay outside this box or it gets
						     clipped (that bug made searching look like it found nothing). -->
						<div class="santu-si2-table-scroll">
						<table class="santu-si2-table">
							<thead>
								<tr>
									<th class="santu-si2-col-idx">#</th>
									<th class="santu-si2-col-item">ITEM</th>
									<th class="santu-si2-col-qty">QTY</th>
									<th class="santu-si2-col-uom">UNIT</th>
									<th class="santu-si2-col-rate">PRICE/UNIT</th>
									<th class="santu-si2-col-amount">AMOUNT</th>
								</tr>
							</thead>
							<tbody>
								${d.items.map((row, idx) => `
									<tr>
										<td class="santu-si2-col-idx">${idx + 1}</td>
										<td class="santu-si2-col-item"><div class="santu-si2-item-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div></td>
										<td class="santu-si2-col-qty">${row.qty}</td>
										<td class="santu-si2-col-uom">${frappe.utils.escape_html(santu_uom.abbr(row.uom) || "")}</td>
										<td class="santu-si2-col-rate">${this._fmt(row.rate)}</td>
										<td class="santu-si2-col-amount santu-si2-figures">${this._fmt(row.amount)}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
						</div>
					</div>

					<div class="santu-si2-lowerrow">
						<div class="santu-si2-extras">
							${d.terms ? `<div class="santu-view-note"><b>Terms &amp; Conditions</b><p>${frappe.utils.escape_html(d.terms)}</p></div>` : ""}
							${d.description ? `<div class="santu-view-note"><b>Description</b><p>${frappe.utils.escape_html(d.description)}</p></div>` : ""}
						</div>
						<div class="santu-si2-summary">
							<div class="santu-si2-summary-row">
								<span>Subtotal</span>
								<span class="santu-si2-figures">${this._fmt(d.subtotal)}</span>
							</div>
							${d.discount_amount ? `
							<div class="santu-si2-summary-row">
								<span>Discount</span>
								<span class="santu-si2-figures">${this._fmt(d.discount_amount)}</span>
							</div>` : ""}
							<div class="santu-si2-summary-row">
								<span>Tax</span>
								<span class="santu-si2-figures">${this._fmt(d.tax)}</span>
							</div>
							<div class="santu-si2-summary-row santu-si2-summary-total">
								<span>Total</span>
								<span class="santu-si2-figures">${this._fmt(d.grand_total)}</span>
							</div>
							${d.outstanding_amount != null && d.doctype !== "Quotation" ? `
							<div class="santu-si2-summary-row">
								<span>Paid</span>
								<span class="santu-si2-figures">${this._fmt(d.paid_amount)}</span>
							</div>
							<div class="santu-si2-summary-row">
								<span class="${d.outstanding_amount > 0 ? "santu-si2-warn-text" : ""}">Baaki (Outstanding)</span>
								<span class="santu-si2-figures ${d.outstanding_amount > 0 ? "santu-si2-warn-text" : ""}">${this._fmt(d.outstanding_amount)}</span>
							</div>` : ""}
						</div>
					</div>

					<div class="santu-si2-actionbar">
						<div class="santu-si2-actionbar-left">
							<button type="button" class="santu-si2-btn" data-action="back">← Back</button>
							${
								// NOT on a return. A credit note is a Sales Invoice too, so
								// it used to get the ordinary "Edit Bill" button -- which
								// reopens it in Billing, where a -1 quantity row is clamped
								// to zero by _row_total's Math.max(..., 0). A -Rs 1,450
								// credit note loaded as a Rs 0 bill, and saving it would
								// have cancelled the customer's real credit and replaced it
								// with nothing (found 2026-10-07). Returns are corrected on
								// the Return screen, not here.
								(d.doctype === "Sales Invoice" && d.docstatus === 1 && !d.is_return)
									? `<button type="button" class="santu-si2-btn santu-si2-btn-edit" data-action="edit-bill" title="${__("Rate ya quantity galat hai? Yahan se sudhaar kar aur nayi bill submit ho jayegi.")}">${__("Edit Bill")}</button>
									   <button type="button" class="santu-si2-btn" data-action="delete-doc" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-weight:600;" title="${__("Delete this Bill")}">${__("Delete Bill")}</button>`
									: ""
							}
							${
								// Every document type that can be rebuilt through its own
								// save path gets the same correction route Sales Invoice
								// has had -- an estimate typed at the wrong rate or a
								// challan missing an item used to be re-keyable only by
								// deleting and starting over, losing the number the
								// customer was already quoting (2026-08-29 request).
								(SANTU_EDITABLE_DOCS[d.doctype] && d.docstatus === 1)
									? `<button type="button" class="santu-si2-btn santu-si2-btn-edit" data-action="edit-doc" title="${__("Saman, rate ya quantity sudhaarna hai? Yahan se badal kar dobara submit ho jayega.")}">${__("Edit {0}", [SANTU_EDITABLE_DOCS[d.doctype].label])}</button>`
									: ""
							}
							${
								// Payment Entry has no items table, so it does not go
								// through SANTU_EDITABLE_DOCS -- the figures that can be
								// corrected are the amount, mode, date and reference
								// (2026-10-07 request).
								(d.doctype === "Payment Entry" && d.docstatus === 1)
									? `<button type="button" class="santu-si2-btn santu-si2-btn-edit" data-action="edit-payment" title="${__("Amount ya payment mode galat hai? Yahan se sudhaar kar dobara save ho jayega.")}">${__("Edit Payment")}</button>`
									: ""
							}
							${
								(d.doctype === "Quotation")
									? `<button type="button" class="santu-si2-btn" data-action="delete-doc" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-weight:600;" title="${__("Delete this Estimate")}">${__("Delete Estimate")}</button>`
									: ""
							}
							${
								(d.doctype === "Delivery Note" || d.doctype === "Sales Order")
									? `<button type="button" class="santu-si2-btn" data-action="delete-doc" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-weight:600;" title="${__("Delete this Document")}">${__("Delete")}</button>`
									: ""
							}
						</div>
						<div class="santu-si2-actionbar-right">
							<button type="button" class="santu-si2-btn" data-action="whatsapp">Send on WhatsApp</button>
							<button type="button" class="santu-si2-btn" data-action="whatsapp_other">↗ Kisi aur ko</button>
							<button type="button" class="santu-si2-btn" data-action="print">Print</button>
							<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="pdf">Download PDF</button>
						</div>
					</div>
				</div>
			</div>
		`);

		this._render_actionbar($body, d);
		// Sirf submitted Sales Invoice pe (2026-08-27 direct request: "Reopen
		// the Sales Invoice... Edit item quantity/rate... Update the
		// invoice"). Billing (POS) is where Sales Invoice is actually built
		// — this reopens the same screen with the bill's own items already
		// in it, rather than a second edit form nobody has seen before.
		$body.find('[data-action="edit-bill"]').on("click", () => {
			frappe.route_options = { edit_invoice: d.name };
			frappe.set_route("santu-billing");
		});
		// Same idea for every other editable type: reopen the document on the
		// screen it was created on, with its own items already loaded, rather
		// than a separate edit form nobody has seen before.
		$body.find('[data-action="edit-doc"]').on("click", () => {
			const cfg = SANTU_EDITABLE_DOCS[d.doctype];
			if (!cfg) return;
			frappe.route_options = { [cfg.option]: d.name };
			frappe.set_route(cfg.route);
		});
		$body.find('[data-action="edit-payment"]').on("click", () => {
			frappe.route_options = { edit_payment: d.name };
			frappe.set_route("santu-payment-entry");
		});
		$body.find('[data-action="delete-doc"]').on("click", () => {
			const display_no = d.display_number || santu_bill_label(d.santu_bill_no);
			const label = d.doctype === "Quotation" ? "Estimate" : (d.doctype === "Delivery Note" ? "Challan" : (d.doctype === "Sales Order" ? "Order" : "Bill"));
			frappe.confirm(
				__("Kya aap sach me {0} <b>{1}</b> ko delete karna chahte hain? Isse iska poora record delete ho jayega.", [label, display_no]),
				async () => {
					frappe.dom.freeze(__("Deleting…"));
					try {
						await frappe.xcall("santu_hardware.santu_hardware.api.delete_sale_invoice", { doctype: d.doctype, name: d.name });
						frappe.dom.unfreeze();
						frappe.show_alert({ message: __("{0} {1} deleted.", [label, display_no]), indicator: "green" });
						frappe.set_route("santu-sale");
					} catch (e) {
						frappe.dom.unfreeze();
						frappe.msgprint((e && e.message) || __("Could not delete."));
					}
				}
			);
		});
	},

	_send_whatsapp(other) {
		const d = this.data;
		window.santu_whatsapp_share.send_transaction(d.doctype, d.name, { other: !!other });
	},
};
