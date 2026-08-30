// Catch what the browser throws, so a broken screen stops being invisible.
//
// The app had thirteen places that swallowed an error into console.error and
// carried on. That is fine for the code — the sale still completes — but it
// means the only person who ever finds out is whoever happens to have the
// console open, which at this counter is nobody. Everything caught here lands
// in Santu Bug Report next to the server-side errors.
//
// Deliberately quiet: this never shows the operator a dialog. A JS error that
// did not stop them selling should not stop them selling now.

(function () {
	const SANTU_ERR_ENDPOINT = "santu_hardware.santu_hardware.bug_report_service.report_browser_errors";

	// Batched, because a render loop can throw the same error hundreds of
	// times a second and this must never become the reason the app is slow.
	const FLUSH_AFTER_MS = 4000;
	const MAX_PER_BATCH = 10;
	// Hard ceiling per page load. Past this the browser is clearly stuck in a
	// loop and more reports add nothing but load.
	const MAX_PER_SESSION = 40;

	let queue = [];
	let sent_this_session = 0;
	let flush_timer = null;
	const seen = new Set();

	function current_route() {
		try {
			return (frappe.get_route && frappe.get_route().join("/")) || location.hash || location.pathname;
		} catch (e) {
			return location.pathname;
		}
	}

	function flush() {
		flush_timer = null;
		if (!queue.length) return;
		const batch = queue.slice(0, MAX_PER_BATCH);
		queue = queue.slice(MAX_PER_BATCH);
		try {
			frappe.xcall(SANTU_ERR_ENDPOINT, { errors: JSON.stringify(batch) }).catch(() => {});
		} catch (e) {
			/* Reporting a bug must never itself raise. */
		}
		if (queue.length) schedule();
	}

	function schedule() {
		if (flush_timer) return;
		flush_timer = setTimeout(flush, FLUSH_AFTER_MS);
	}

	function capture(title, message, stack) {
		if (sent_this_session >= MAX_PER_SESSION) return;
		const str_title = String(title || "");
		const str_msg = String(message || "");
		const str_stack = String(stack || "");

		// Ignore benign DOM / framework / extension noise
		if (str_title.includes("removeChild") || str_msg.includes("removeChild")) return;
		if (str_title.includes("ResizeObserver loop") || str_msg.includes("ResizeObserver loop")) return;
		if (str_title.includes("chrome-extension://") || str_stack.includes("chrome-extension://")) return;
		if (str_title.includes("reading 'push'") && str_stack.includes("<anonymous>:")) return;

		// One row per distinct error per page load — the server counts
		// repeats, it does not need every single one shipped to it.
		const key = str_title + "|" + str_msg.slice(0, 200);
		if (seen.has(key)) return;
		seen.add(key);
		sent_this_session += 1;

		queue.push({
			title: (str_title || "Browser error").slice(0, 140),
			message: str_msg.slice(0, 2000),
			stack: str_stack.slice(0, 4000),
			route: current_route(),
		});
		schedule();
	}

	window.addEventListener("error", function (e) {
		const where = e.filename ? ` (${e.filename}:${e.lineno})` : "";
		capture((e.message || "Script error") + where, e.message, e.error && e.error.stack);
	});

	// A rejection reason can be anything at all — an Error, Frappe's server
	// error shape, a plain object, or undefined. Reduce it to something a
	// human can read; a bug report titled "[object Object]" tells nobody
	// anything, which is what the first real capture produced (2026-08-17).
	function describe(reason) {
		if (reason == null) return "";
		if (typeof reason === "string") return reason;
		if (reason.message) return String(reason.message);
		if (reason.responseText) return String(reason.responseText);
		// Frappe's xcall rejects with the server's exception payload.
		if (reason.exc_type) return String(reason.exc_type) + ": " + (reason._server_messages || "");
		if (reason._server_messages) return String(reason._server_messages);
		try {
			const json = JSON.stringify(reason);
			if (json && json !== "{}") return json.slice(0, 500);
		} catch (e) {
			/* circular — fall through */
		}
		return Object.prototype.toString.call(reason);
	}

	window.addEventListener("unhandledrejection", function (e) {
		const msg = describe(e.reason);
		// A rejection carrying nothing at all says nothing worth storing, and
		// Frappe emits those routinely when a request is superseded.
		if (!msg || msg === "[object Undefined]") return;
		capture(msg, msg, e.reason && e.reason.stack);
	});

	// Anything still queued when the tab closes would otherwise be lost —
	// and a crash on the way out is exactly the kind worth keeping.
	window.addEventListener("pagehide", flush);

	// Used by the app's own catch blocks so a swallowed error still gets
	// recorded instead of only reaching the console.
	window.santu_report_error = function (title, err) {
		capture(title, (err && err.message) || String(err), err && err.stack);
	};
})();
