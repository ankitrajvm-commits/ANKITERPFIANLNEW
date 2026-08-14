/*
 * SANTU CUSTOMIZATION — Smart POS submit confirmation (ROADMAP.md Phase
 * 2.5 Stage 2, POS priority #1, direct 2026-07-30 instruction).
 *
 * Native ERPNext shows a generic "Permanently Submit ACC-PSINV-2026-00002?"
 * dialog on every single completed sale via frm.savesubmit() ->
 * frappe.confirm() (frappe/public/js/frappe/form/form.js). At the volume
 * this screen runs (BUSINESS_RULES.md: dozens-hundreds of sales/day), that
 * is real friction with no real safety benefit for a normal small sale —
 * but a final check genuinely matters for a large amount, a steep manual
 * discount, or a big credit sale.
 *
 * Implementation choice (Core Modification Policy, ERP_MASTER_PROMPT.md
 * §8.1): monkey-patch frappe.confirm narrowly, matched only against the
 * exact POS-submit message text while on the point-of-sale route — every
 * other frappe.confirm call anywhere else in Desk (cancel, delete, other
 * doctypes' submit) is completely untouched. Same proven pattern already
 * used in this app for the loyalty-program bug workaround
 * (santu_hardware/__init__.py) — custom-app only, no core file edited,
 * fully reversible by removing this file.
 */

const SANTU_POS_SUBMIT_CONFIRM_RE = /^Permanently Submit (ACC-PSINV-[\w-]+)\?$/;

const _santu_original_frappe_confirm = frappe.confirm;

frappe.confirm = function (message, ifyes, ifno) {
	const match = typeof message === "string" && message.match(SANTU_POS_SUBMIT_CONFIRM_RE);
	const on_pos_route = frappe.get_route()[0] === "point-of-sale";

	if (match && on_pos_route) {
		santu_pos_smart_confirm(match[1], ifyes, ifno);
		return;
	}

	return _santu_original_frappe_confirm.apply(this, arguments);
};

function santu_pos_smart_confirm(docname, ifyes, ifno) {
	const doc = locals["POS Invoice"] && locals["POS Invoice"][docname];
	if (!doc) {
		// Couldn't read the doc for some reason — fail toward the safe,
		// original native behaviour rather than silently skipping a check.
		_santu_original_frappe_confirm.call(frappe, __("Permanently Submit {0}?", [docname]), ifyes, ifno);
		return;
	}

	frappe.call({
		method: "santu_hardware.santu_hardware.api.get_pos_confirmation_settings",
		callback: (r) => {
			const settings = r.message || {};
			const risk = santu_assess_pos_risk(doc, settings);

			if (settings.enable_smart_confirmation && !risk.length) {
				// Normal sale, nothing risky, owner has opted into the fast
				// path — complete it immediately, exactly like Shopify/
				// Square never asking "are you sure" per sale.
				ifyes();
				return;
			}

			santu_show_meaningful_confirm(doc, risk, ifyes, ifno);
		},
		error: () => {
			// Settings fetch failed — same fail-safe as above.
			_santu_original_frappe_confirm.call(frappe, __("Permanently Submit {0}?", [docname]), ifyes, ifno);
		},
	});
}

function santu_assess_pos_risk(doc, settings) {
	const reasons = [];

	if (settings.large_amount_threshold && doc.grand_total > settings.large_amount_threshold) {
		reasons.push(`Large sale — over ₹${format_currency_plain(settings.large_amount_threshold)}`);
	}
	if (
		settings.discount_limit_percent &&
		flt(doc.additional_discount_percentage) > settings.discount_limit_percent
	) {
		reasons.push(`Discount of ${flt(doc.additional_discount_percentage)}% is above the usual limit`);
	}
	if (
		settings.credit_sale_limit &&
		flt(doc.outstanding_amount) > 0 &&
		flt(doc.outstanding_amount) > settings.credit_sale_limit
	) {
		reasons.push(`₹${format_currency_plain(doc.outstanding_amount)} left unpaid (credit)`);
	}

	return reasons;
}

function santu_show_meaningful_confirm(doc, risk, ifyes, ifno) {
	const payment_summary =
		(doc.payments || [])
			.filter((p) => flt(p.amount) > 0)
			.map((p) => p.mode_of_payment)
			.join(" + ") || "—";

	const risk_html = risk.length
		? `<span class="santu-confirm-risk">${risk.map((r) => `⚠️ ${frappe.utils.escape_html(r)}`).join("<br>")}</span>`
		: "";

	// Meaningful, business-readable confirmation — never the generic
	// "Permanently Submit {docname}?" wording (explicit 2026-07-30
	// instruction). The cashier verifies what's actually happening
	// (amount, customer, item count, payment mode), not a technical ID.
	//
	// Uses <span> (styled as block via CSS), not <div>: frappe.confirm()
	// wraps this whole message in a <p> (frappe/ui/messages.js), and per
	// the HTML5 spec a <p> auto-closes the instant it hits a block-level
	// element like <div> — found by testing, not inspection, when a
	// misplaced closing tag showed up as literal visible text. <span> is
	// inline, so it never triggers that auto-close.
	const message = `
		<span class="santu-confirm-summary">
			<span class="santu-confirm-amount">Complete sale for ₹${format_currency_plain(doc.grand_total)}?</span>
			<span class="santu-confirm-row"><span>Customer</span><strong>${frappe.utils.escape_html(doc.customer || "Walk-in Customer")}</strong></span>
			<span class="santu-confirm-row"><span>Items</span><strong>${flt(doc.total_qty)}</strong></span>
			<span class="santu-confirm-row"><span>Payment</span><strong>${frappe.utils.escape_html(payment_summary)}</strong></span>
			${risk_html}
		</span>
	`;

	_santu_original_frappe_confirm.call(frappe, message, ifyes, ifno);
}

function format_currency_plain(value) {
	// frappe.format(value, {fieldtype: "Currency"}) returns HTML wrapped in
	// a <div> (e.g. "<div style='text-align: right'>₹ 50,000.00</div>") —
	// found by testing: stripping only the leading non-digit prefix left
	// a literal trailing "</div>" in the string, which either got silently
	// dropped as a bogus unmatched tag or, worse, rendered as visible
	// "</div>" text once escape_html turned it into safe-looking entities.
	// The global `format_currency` helper returns a plain string with no
	// wrapper at all — the correct tool for text content, not HTML.
	return format_currency(value, "INR").replace(/^\D+/, "");
}
