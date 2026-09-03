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

// `var`, not `const` — this app_include_js file only ever loads once per
// page in the normal case, but a `const` at top level throws "Can't create
// duplicate variable" (a hard, blank-screen crash) if the script is ever
// re-executed in the same document — seen 2026-08-31 on WhatsApp Connect,
// 10 times in one session, never since (looked like a dev-server asset
// rebuild racing an open page, not a reproducible app bug). `var` makes a
// second execution a harmless no-op instead of a crash, whatever the cause.
var SANTU_PRINT_API = "santu_hardware.santu_hardware.print_service";

// Last rung: show the bill on screen so there is always something to hand
// over. This used to be `window.open(blobUrl, "_blank")` — a bare PDF tab.
// On the shop PC that tab has no toolbar and no tab strip (kiosk), so when
// printing failed the operator was left staring at a black screen with the
// bill on it and no way back: "ye kat bhi nahi raha aur kuch ho bhi nahi
// raha" (2026-08-23 report). An in-app dialog with a Band Karein button can
// always be closed, and never navigates away from the billing screen.
async function santu_print_open_pdf(doctype, docname) {
	const print_format = SANTU_THERMAL_FORMATS[doctype];
	const r = await frappe.call({
		method: "frappe.www.printview.get_html_and_style",
		args: { doc: doctype, name: docname, print_format, no_letterhead: 0 },
	});
	const { html, style } = r.message || {};
	if (!html) throw new Error(__("Bill screen par bhi nahi khul paya."));

	const d = new frappe.ui.Dialog({
		title: __("Print nahi hua — bill screen par"),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "bill", options: `<div class="santu-pdf-preview-wrap"></div>` }],
		primary_action_label: __("Band Karein"),
		primary_action: () => d.hide(),
	});
	d.show();

	const iframe = document.createElement("iframe");
	iframe.style.cssText = "width:100%;height:70vh;border:1px solid var(--gray-300);background:#fff;";
	d.fields_dict.bill.$wrapper.find(".santu-pdf-preview-wrap").append(iframe);
	iframe.srcdoc = `<html><head><style>${style || ""}</style></head><body><div class="print-format print-format-preview">${html}</div></body></html>`;
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

	// `silent: true` matters here. Each rung fails by throwing server-side —
	// that is how the ladder learns to try the next one — but frappe.xcall
	// also pops the raw server error on screen as it goes. With the printer
	// unplugged the operator got "The printer is not connected." stacked on
	// top of the bill dialog, an error about a rung the ladder had already
	// moved past. The ladder reports the outcome once, at the end; the
	// intermediate stumbles belong in the attempt log, not in a popup.
	const rung_call = async (method, args) => {
		const r = await frappe.call({ method, args, silent: true });
		if (r && r.exc) throw r;
		return r ? r.message : null;
	};

	const rungs = [
		["Printer", () => rung_call(`${SANTU_PRINT_API}.print_via_cups`, {
			invoice_doctype: doctype, invoice_name: docname, is_duplicate,
		})],
		["Direct USB", () => rung_call(`${SANTU_PRINT_API}.print_via_usb`, {
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

// Kis doctype ka kaunsa thermal design — is file me sirf YAHI ek jagah.
// Baaki doctypes seedhe aam print view pe chale jaate hain (neeche).
//
// YE MAP print_service.py ki SANTU_THERMAL_DOCTYPES ki NAKAL hai — dono
// jagah ek saath badalni padti hai. Naya doctype jodo to dono jagah jodna.
//
// Pehle yahi baat is file me DO jagah likhi thi: ek list "kiska thermal hai"
// ki, aur ek alag ternary PDF wale rung me "kaunsa format" ka. 2026-08-27 ko
// Quotation list me to jud gaya par ternary me nahi, to Quotation ka parcha
// Sales Invoice ke format se banne laga aur "Argument 'amount' should be of
// type 'float'" dekar phat gaya (Quotation me paid_amount hota hi nahi).
// Ab ek hi map, dono kaam usi se.
var SANTU_THERMAL_FORMATS = {
	"Sales Invoice": "Santu Hardware Thermal Bill (Sales Invoice)",
	"POS Invoice": "Santu Hardware Thermal Bill",
	"Quotation": "Santu Hardware Thermal Estimate (Quotation)",
};
var SANTU_THERMAL_DOCTYPES = Object.keys(SANTU_THERMAL_FORMATS);

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
	// 2026-09-03 direct request: "thermal printing hamesha puch ke ho, sab
	// jagah" — every screen that prints a thermal bill (Save & Print button,
	// the auto-print setting, Reprint Last, WhatsApp Connect's print button,
	// the transaction lists' print icons) funnels through this one function,
	// so asking here once covers all of them instead of touching each call
	// site separately and risking missing one.
	const confirmed = await new Promise((resolve) => {
		frappe.confirm(__("Thermal bill print karein?"), () => resolve(true), () => resolve(false));
	});
	if (!confirmed) return false;
	try {
		// Which rung answered decides what the operator is told. This used to
		// say "Printed" in green whenever the ladder resolved — including the
		// PDF rung, which prints nothing and only puts the bill on screen. So
		// with the printer unplugged the shop got a green "Printed" tick over
		// a bill that never existed on paper. That is the same lie QZ Tray was
		// removed for on 2026-08-17, rebuilt one level higher up.
		const { method } = await santu_print_bill_ladder(doctype, docname, opts);
		if (method === "PDF") {
			frappe.show_alert({
				message: __("Chhapa NAHI — bill sirf screen par hai"),
				indicator: "orange",
			}, 10);
		} else {
			frappe.show_alert({ message: __("Printed"), indicator: "green" });
		}
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

window.santu_print_thermal_bill = santu_print_thermal_bill;
