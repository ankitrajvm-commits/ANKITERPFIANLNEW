// USB barcode scanner support.
//
// There is nothing to install. A USB scanner is a keyboard: it "types" the
// barcode very fast and presses Enter. The entire job is telling that burst
// apart from a person typing, and handing it to whichever screen is open.
//
// Why a shared listener rather than an input box on each screen:
//
//   * The scanner types wherever the focus happens to be. At a counter the
//     focus is rarely where you would like it — it is on a quantity box, a
//     phone field, or nothing at all. A page-level listener catches the scan
//     no matter what, so the operator never has to "click here first".
//   * Every screen that wants scans registers one handler. There is one
//     implementation of the detection, so a fix helps all of them — the same
//     reason bill printing has one ladder.
//
// How a scan is recognised:
//
//   * Characters arrive far faster than a human types (see MAX_GAP_MS).
//   * The burst ends with Enter.
//   * It is long enough to be a real code (MIN_LENGTH).
//
// Anything slower or shorter is left completely alone, so ordinary typing —
// including typing into a search box — behaves exactly as before.

(function () {
	// A human hitting keys manages perhaps 100–200ms between characters at
	// speed. Scanners emit at 5–20ms. 40ms sits well clear of both.
	const MAX_GAP_MS = 40;
	// Shorter than this and it is far more likely a person than a product
	// code — EAN-8 is the smallest real barcode in normal retail use.
	const MIN_LENGTH = 6;
	// If a burst stops without Enter, forget it rather than let stray
	// characters accumulate into a phantom scan minutes later.
	const RESET_AFTER_MS = 200;

	let buffer = "";
	let last_key_time = 0;
	let reset_timer = null;
	let handler = null;
	let handler_owner = null;

	function reset() {
		buffer = "";
		if (reset_timer) {
			clearTimeout(reset_timer);
			reset_timer = null;
		}
	}

	function schedule_reset() {
		if (reset_timer) clearTimeout(reset_timer);
		reset_timer = setTimeout(reset, RESET_AFTER_MS);
	}

	function deliver(code, event) {
		if (!handler) return false;
		// The scanner's Enter must not also submit the form or trigger the
		// focused button — the scan is the action.
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		try {
			handler(code);
		} catch (e) {
			console.error("santu barcode handler failed", e);
			if (window.santu_report_error) window.santu_report_error("Barcode handler failed", e);
		}
		return true;
	}

	document.addEventListener(
		"keydown",
		function (e) {
			// Modifier combinations are shortcuts, never scans.
			if (e.ctrlKey || e.metaKey || e.altKey) return reset();

			const now = Date.now();
			const gap = now - last_key_time;
			last_key_time = now;

			if (e.key === "Enter") {
				const code = buffer;
				reset();
				if (code.length >= MIN_LENGTH) deliver(code, e);
				return;
			}

			// Printable single characters only — barcodes are alphanumeric.
			if (e.key.length !== 1) return;

			// A slow keystroke means a person is typing: start counting again
			// from this character rather than gluing it onto an old burst.
			if (gap > MAX_GAP_MS) buffer = "";
			buffer += e.key;
			schedule_reset();
		},
		true // capture, so the scan is seen before any field consumes it
	);

	window.santu_barcode = {
		// Register the screen that should receive scans. Passing an owner
		// (any stable value, usually the page name) lets a screen release its
		// handler without stepping on whatever registered afterwards.
		listen(fn, owner) {
			handler = fn;
			handler_owner = owner || null;
		},
		stop(owner) {
			if (owner && handler_owner && owner !== handler_owner) return;
			handler = null;
			handler_owner = null;
		},
		is_listening() {
			return !!handler;
		},
		// Exposed for the "type it in" fallback: a scanner that will not read
		// a scuffed label still leaves the operator able to key the number.
		submit(code) {
			return deliver(String(code || "").trim(), null);
		},
	};
})();
