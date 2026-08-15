// One-click silent thermal printing via QZ Tray (https://qz.io), a free
// local desktop service that bridges a browser tab to real printers/USB
// devices — something a browser sandbox can never do on its own. The
// connector library itself is vendored in `vendor_qz_tray.js` (loaded
// right before this file) rather than pulled from QZ's CDN, since this
// shop runs offline-first and can't depend on internet access to print
// a bill (ROADMAP.md's whole premise for this app).
//
// SETUP NEEDED ON THE SHOP PC (one-time, outside this app):
//   1. Install QZ Tray: https://qz.io/download/ (free, LGPL-2.1)
//   2. Launch it — it sits in the system tray/menu bar, listening on
//      ws://localhost:8182 (unsecured) / wss://localhost:8181 (secured).
//   3. Plug in / configure the thermal printer as a normal OS printer.
// Without a paid QZ signing certificate, QZ Tray runs in "unsigned"
// mode: the FIRST print each browser session shows a one-time "Allow
// this website to print?" dialog from QZ Tray itself (not this app) —
// that's QZ protecting the user, not a bug here, and it remembers the
// choice for the rest of the session.

const SANTU_ESC_POS_CASH_DRAWER_KICK = "\x1B\x70\x00\x19\xFA";

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

async function santu_qz_get_default_printer() {
	await santu_qz_connect();
	return await qz.printers.getDefault();
}

// Prints a POS Invoice / Sales Invoice using the shop's configured
// thermal print format + paper width (Settings -> Printer Settings).
// Renders the bill server-side to a real PDF (same pipeline as "Get
// PDF" — reuses the print format entirely, no separate raw ESC/POS
// template to keep in sync) and hands the bytes to QZ Tray as a pixel
// job, which prints it through the printer's normal OS driver.
async function santu_qz_print_invoice(doctype, docname) {
	await santu_qz_connect();

	const settings = await frappe.db.get_doc("Santu POS Settings");
	const printer_name = settings.printer_name;
	if (!printer_name) {
		frappe.throw(
			__("No printer selected yet. Set one in Settings → Printer Settings first.")
		);
	}
	const copies = cint(settings.print_copies) || 1;
	const paper_width = settings.paper_width || "80mm";
	const print_format =
		doctype === "POS Invoice" ? "Santu Hardware Thermal Bill" : "Santu Hardware Thermal Bill (Sales Invoice)";

	const pdf_base64 = await frappe.xcall(
		"santu_hardware.santu_hardware.api.get_invoice_pdf_base64",
		{ doctype, name: docname, print_format }
	);

	// The invoice PDF is now generated at its own correct, content-driven
	// page size (see get_invoice_pdf_base64 in api.py) instead of the old
	// A4 default, so this job size only needs to be a generous upper
	// bound — never smaller than the tallest real bill — not an exact
	// match. Matches the printer queue's own max roll length (see
	// `lpadmin ... -o PageSize=RP80x2000` in the CUPS setup) so neither
	// layer clips a long itemized bill.
	const config = qz.configs.create(printer_name, {
		copies: copies,
		size: { width: parseFloat(paper_width), height: 2000, units: "mm" },
		units: "mm",
	});

	await qz.print(config, [
		{ type: "pixel", format: "pdf", flavor: "base64", data: pdf_base64 },
	]);

	if (cint(settings.open_cash_drawer)) {
		await santu_qz_open_cash_drawer(printer_name);
	}
}

async function santu_qz_open_cash_drawer(printer_name) {
	await santu_qz_connect();
	if (!printer_name) {
		const settings = await frappe.db.get_doc("Santu POS Settings");
		printer_name = settings.printer_name;
	}
	if (!printer_name) return;

	const config = qz.configs.create(printer_name);
	await qz.print(config, [
		{ type: "raw", format: "command", data: SANTU_ESC_POS_CASH_DRAWER_KICK },
	]);
}

// Small helper so callers get one consistent, shop-owner-readable error
// message instead of a raw JS exception, whichever of the steps above
// (QZ not installed / not running / no printer selected / print job
// itself failing) is the one that went wrong.
async function santu_print_thermal_bill(doctype, docname) {
	try {
		await santu_qz_print_invoice(doctype, docname);
		frappe.show_alert({ message: __("Printed"), indicator: "green" });
		return true;
	} catch (err) {
		frappe.msgprint({
			title: __("Couldn't Print"),
			message: err.message || String(err),
			indicator: "red",
		});
		return false;
	}
}

// ---------------------------------------------------------------------------
// Print density (Epson TM-T82X-II)
//
// The bill itself goes out as a PDF pixel job through the Epson CUPS driver,
// which exposes no darkness setting at all. Density instead rides the same
// raw ESC/POS channel QZ Tray already uses for the cash-drawer kick, writing
// straight to the printer's own stored settings.
//
// The byte sequences come from the server (get_density_escpos) rather than
// being assembled here: the 1-7 clamp and the command format belong in one
// place, and a browser is not where a printer's stored configuration should
// be composed.
// ---------------------------------------------------------------------------

async function santu_qz_apply_print_density(printer_name, level) {
	await santu_qz_connect();
	if (!printer_name) {
		frappe.throw(__("No printer selected yet."));
	}

	const cmds = await frappe.xcall("santu_hardware.santu_hardware.api.get_density_escpos", { level });
	const config = qz.configs.create(printer_name);

	// Sent as separate jobs on purpose. Function 1 makes the printer reply
	// with a "mode change notice" before it will accept the value, and
	// Function 2 performs a software reset — batching all three into one
	// stream gives the printer no room to do either.
	// format "hex", not "command": a "\xNN" escape only becomes a byte if
	// whatever reads the string chooses to decode it, and a printer command
	// is not a place to leave that to chance.
	await qz.print(config, [
		{ type: "raw", format: "hex", data: cmds.enter_user_setting_mode },
	]);
	await new Promise((r) => setTimeout(r, 400));
	await qz.print(config, [{ type: "raw", format: "hex", data: cmds.set_density }]);
	await new Promise((r) => setTimeout(r, 200));
	await qz.print(config, [
		{ type: "raw", format: "hex", data: cmds.end_user_setting_mode },
	]);
	// The reset takes a moment; printing immediately after would be dropped.
	await new Promise((r) => setTimeout(r, 1500));

	await frappe.xcall("santu_hardware.santu_hardware.api.set_printer_density", {
		printer_name,
		level: cmds.level,
		mark_applied: 1,
	});
	return cmds;
}

// Deliberately raw ESC/POS text, not the usual PDF pipeline: nothing about
// the real bill's layout, fonts, margins, paper width or GST formatting is
// involved, so a density test cannot disturb any of it.
async function santu_qz_print_density_test(printer_name, level) {
	await santu_qz_connect();
	const receipt = await frappe.xcall(
		"santu_hardware.santu_hardware.api.get_density_test_receipt",
		{ level, printer_name }
	);
	const config = qz.configs.create(printer_name);
	await qz.print(config, [{ type: "raw", format: "hex", data: receipt.data }]);
	return receipt;
}
