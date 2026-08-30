/* global window */

// santu_bill_label(bill_no) — the ONLY way a bill may be named on screen.
//
// Standing order, repeated many times and finally as an absolute rule
// (2026-08-30): the internal docname ("SINV-26-00426") must NEVER appear as
// a bill name or number anywhere the shop or a customer can see it.
//
// Every `bill_no || name` fallback scattered across the screens was a leak
// waiting for one invoice with an empty santu_bill_no — amended, imported,
// restored, or still a draft. So this function takes the bill number ONLY;
// there is deliberately no docname argument to fall back to.
//
// A bill with no number yet reads as "—". No number is strictly better than
// the wrong one, and the bill is still findable by customer, date, or
// amount.
//
// Mirrors api.py's `format_bill_no` / `bill_label`: plain 1, 2, 3 up to 999,
// then A01, A02 … B01 … so the printed number stays four characters.
//
// Assigned with a guard rather than declared top-level: two page scripts in
// the Desk SPA sharing a top-level name is a SyntaxError that blanks the
// screen until reload.
if (!window.santu_bill_label) {
	window.santu_bill_label = function (bill_no) {
		const n = parseInt(bill_no, 10);
		if (!n || n <= 0) return "—";

		const BLOCK = 999;
		const block_index = Math.floor((n - 1) / BLOCK);
		const within = ((n - 1) % BLOCK) + 1;
		if (!block_index) return String(within);

		let letters = "";
		let i = block_index;
		while (i > 0) {
			const rem = (i - 1) % 26;
			i = Math.floor((i - 1) / 26);
			letters = String.fromCharCode(65 + rem) + letters;
		}
		return `${letters}${String(within).padStart(2, "0")}`;
	};
}
