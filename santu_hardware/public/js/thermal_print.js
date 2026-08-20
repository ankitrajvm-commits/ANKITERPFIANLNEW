// Thermal bill printing.
//
// Bills are printed by the server — macOS's own print queue first, then raw
// USB to the printer — never by QZ Tray. See the ladder further down for why.
//
// SETUP NEEDED ON THE SHOP PC (one-time):
//   Add the thermal printer as a normal macOS printer. That is all; nothing
//   else has to be installed or running for a bill to print.
//
// QZ Tray remains installed and is still loaded here, but only as a
// last-resort way to enumerate printers if macOS returns none. It prints
// nothing. If it is stopped, bills still print.

function santu_qz_available() {
	return typeof qz !== "undefined";
}

async function santu_qz_connect() {
	if (!santu_qz_available()) {
		throw new Error(
			"QZ Tray connector didn't load. Check that vendor_qz_tray.js is included."
		);
	}
	if (qz.websocket.isActive()) return true;

	try {
		await qz.websocket.connect();
		return true;
	} catch (err) {
		throw new Error(
			"Couldn't reach QZ Tray. Make sure it's installed and running on this computer (look for its icon in the system tray/menu bar), then try again."
		);
	}
}

// Auto-detect: lists every printer QZ Tray (and therefore the OS) can
// see right now — this is what populates the picker in Printer Settings,
// rather than a hardcoded Epson/XPrinter/TVS model list, so it works
// with whatever's actually plugged in.
async function santu_qz_list_printers() {
	await santu_qz_connect();
	return await qz.printers.find();
}

// ---------------------------------------------------------------------------
// Printing a bill — the ONE path every screen uses.
//
// QZ Tray used to print the bill and no longer does. On 2026-08-17 it
// reported success while nothing came out of the printer: the operator
// pressed reprint ten times, saw no paper, and then all ten slips appeared
// at once when the printer woke up. A route that cannot tell the truth about
// whether it printed is worse than one that plainly fails, because every
// safety net built on top of it is built on a lie.
//
// The ladder lives here, in the shared function, on purpose. Seven different
// screens print bills — the sale screen, Billing (POS), the post-sale popup,
// the sale and purchase transaction lists, the review dialog, and the print
// button on every doctype form. When the ladder lived in the sale screen
// only, the other six silently kept using QZ. One implementation means one
// behaviour.
//
//   1. Printer   — macOS prints the real 3-inch bill and CUPS is asked
//                  whether the job actually left the queue.
//   2. Direct USB — raw ESC/POS straight to the printer's USB endpoint,
//                  bypassing the browser and the print system entirely.
//   3. PDF        — open it on screen so there is always something to hand over.
// ---------------------------------------------------------------------------

const SANTU_PRINT_API = "santu_hardware.santu_hardware.print_service";

async function santu_print_open_pdf(doctype, docname) {
	const print_format =
		doctype === "POS Invoice" ? "Santu Hardware Thermal Bill" : "Santu Hardware Thermal Bill (Sales Invoice)";
	const b64 = await frappe.xcall("santu_hardware.santu_hardware.api.get_invoice_pdf_base64", {
		doctype,
		name: docname,
		print_format,
	});
	const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
	window.open(url, "_blank");
	setTimeout(() => URL.revokeObjectURL(url), 60000);
	return "PDF";
}

// Runs the ladder and records every attempt on a Santu Print Job. Resolves
// with the method that worked; rejects only when all three rungs fail.
async function santu_print_bill_ladder(doctype, docname, opts = {}) {
	const is_duplicate = opts.is_duplicate ? 1 : 0;
	let job = null;
	try {
		job = await frappe.xcall(`${SANTU_PRINT_API}.create_print_job`, {
			invoice_doctype: doctype,
			invoice_name: docname,
			is_duplicate,
		});
	} catch (e) {
		// Not being able to log the attempt must never stop the printing.
		job = null;
	}

	const record = (method, ok, err) => {
		if (!job) return;
		frappe
			.xcall(`${SANTU_PRINT_API}.record_print_attempt`, {
				job_name: job,
				method,
				ok: ok ? 1 : 0,
				error: err || undefined,
			})
			.catch(() => {});
	};

	const rungs = [
		["Printer", () => frappe.xcall(`${SANTU_PRINT_API}.print_via_cups`, {
			invoice_doctype: doctype, invoice_name: docname, is_duplicate,
		})],
		["Direct USB", () => frappe.xcall(`${SANTU_PRINT_API}.print_via_usb`, {
			invoice_doctype: doctype, invoice_name: docname, is_duplicate,
		})],
		["PDF", () => santu_print_open_pdf(doctype, docname)],
	];

	// Frappe rejects an xcall with its own server-error shape, which has no
	// `.message` — so the attempt log recorded a useless "undefined" for the
	// one thing it exists to capture. Dig out whatever the server actually
	// said.
	const from_server_messages = (raw) => {
		try {
			const first = JSON.parse(raw)[0];
			return JSON.parse(first).message || String(first);
		} catch (x) {
			return String(raw);
		}
	};

	const describe = (e) => {
		if (typeof e === "string" && e) return e;
		if (e && e.message) return String(e.message);
		if (e && e._server_messages) return from_server_messages(e._server_messages);
		if (e && e.exc_type) return String(e.exc_type);
		// frappe.xcall frequently rejects with undefined and puts the real
		// reason on the last response instead. Without this the attempt log
		// recorded "unknown error" for the one thing it exists to capture.
		const last = frappe.last_response;
		if (last && last._server_messages) return from_server_messages(last._server_messages);
		if (last && last.exc_type) return String(last.exc_type);
		return e ? String(e) : "unknown error";
	};

	let last_error = null;
	for (const [method, run] of rungs) {
		try {
			await run();
			record(method, true);
			return { method, job };
		} catch (e) {
			last_error = describe(e);
			record(method, false, last_error);
		}
	}
	const failure = new Error(last_error || "Print failed");
	failure.job = job;
	throw failure;
}

// Only these two have a thermal bill designed for them. Kept in step with
// SANTU_THERMAL_DOCTYPES in print_service.py.
const SANTU_THERMAL_DOCTYPES = ["Sales Invoice", "POS Invoice"];

// What every screen calls. Runs the ladder above and gives the shop owner
// one readable answer instead of a raw JS exception.
async function santu_print_thermal_bill(doctype, docname, opts = {}) {
	// The sale and purchase transaction lists hand this whatever doctype the
	// row happens to be — Purchase Invoice, Sales Order, Quotation. Those have
	// no thermal bill, and forcing one produced a supplier bill shaped like a
	// customer's, with a blank party name and "Thank you!" on it. Send them to
	// the ordinary print view, which is what they had before the thermal
	// button existed.
	if (!SANTU_THERMAL_DOCTYPES.includes(doctype)) {
		frappe.set_route("print", doctype, docname);
		return true;
	}
	try {
		await santu_print_bill_ladder(doctype, docname, opts);
		frappe.show_alert({ message: __("Printed"), indicator: "green" });
		return true;
	} catch (err) {
		frappe.msgprint({
			title: __("Print nahi ho paya"),
			message:
				(err && err.message) ||
				__("Printer tak nahi pahunch paye. Utilities → Doctor Uncle kholkar jaanchein."),
			indicator: "red",
		});
		return false;
	}
}

// Print density and the cash drawer used to live here, driven through QZ
// Tray. Both moved out on 2026-08-17 when QZ was removed from printing:
//
//   * Density is written server-side over raw USB by
//     `api.py::apply_printer_density`, which reads the value back off the
//     printer afterwards to prove it took. QZ could not prove that.
//   * The cash drawer kick was already known broken — macOS dropped raw CUPS
//     queues, so Epson's raster filter swallowed it. Whoever buys a drawer
//     should send the kick through `api.py::_usb_send`, the same channel
//     density uses, rather than reviving the QZ version.
//
// What is left of QZ in this file is only the connector used to list
// printers as a last-resort fallback. No bill travels through it.
