// Quantity shortcut for every billing-like screen (2026-09-21, Ankit):
// type "5x tee", "5* tee", "5 * tee", "55x tee" -> 5 / 55 of that item.
//
// The mark (x / * / ×) is REQUIRED. A bare "5 cpvc elbow" stays a plain
// search, because a lot of the shop's item names start with a number and a
// size -- "10 WAY MCB BOX", "2 MOD GI BOX", "20 mm pipe" -- and those must
// never be read as a quantity.
window.santu_qty = {
	split(q) {
		const raw = String(q || "");
		const m = raw.match(/^\s*(\d+(?:\.\d+)?)\s*[x*×]\s*(.+)$/i);
		if (!m) return { qty: null, text: raw };
		const qty = flt(m[1]);
		if (!qty || qty <= 0 || qty > 100000) return { qty: null, text: raw };
		return { qty, text: m[2].trim() };
	},

	// Read once, then forget: the next item picked without a prefix is 1.
	take(ctx) {
		const n = flt(ctx && ctx._pending_qty);
		if (ctx) ctx._pending_qty = null;
		return n > 0 ? n : 1;
	},

	// The line above the results, so bhaiya can see what will go on the bill.
	hint_html(qty, row_class) {
		// Styled inline so it looks the same on every screen without each of
		// them needing its own CSS rule, and clearly NOT a clickable item row.
		return `<div class="${row_class} santu-bill-dd-qtyhint" style="cursor:default;background:#fff8e1;color:#7a5200;font-size:13px;padding:6px 10px;border-bottom:1px solid #f0e0b0;"><b>${format_number(qty, null, 2)} ×</b> — Jo saaman chunenge, uski itni matra bill me jayegi</div>`;
	},
};
