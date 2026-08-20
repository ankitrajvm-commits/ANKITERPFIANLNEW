// "Printer selection in Settings" (Phase 4) — auto-detects printers via
// QZ Tray instead of a hardcoded Epson/XPrinter/TVS model list, so it
// works with whatever's actually plugged into the shop PC.
frappe.ui.form.on("Santu POS Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Detect Printers"), () => santu_detect_printers(frm));
		if (frm.doc.printer_name) {
			frm.add_custom_button(__("Test Print"), () => santu_test_print(frm));
		}
	},
});

async function santu_detect_printers(frm) {
	frappe.show_alert({ message: __("Looking for printers..."), indicator: "blue" });
	// Ask macOS, not QZ Tray. Bills no longer print through QZ, so needing
	// QZ to be running just to pick a printer would make setup depend on a
	// component the shop does not otherwise need. QZ stays as a fallback
	// only for the case where CUPS somehow returns nothing.
	let printers;
	try {
		printers = (await frappe.xcall("santu_hardware.santu_hardware.api.list_printers")) || [];
		if (!printers.length && typeof santu_qz_list_printers === "function") {
			printers = await santu_qz_list_printers();
		}
	} catch (err) {
		frappe.msgprint({
			title: __("Printer nahi mil paye"),
			message: (err && err.message) || String(err),
			indicator: "red",
		});
		return;
	}

	if (!printers || !printers.length) {
		frappe.msgprint(__("No printers found. Make sure the printer is switched on and connected."));
		return;
	}

	const options = Array.isArray(printers) ? printers : [printers];
	frappe.prompt(
		[
			{
				fieldname: "printer_name",
				fieldtype: "Select",
				label: __("Printer"),
				options: options.join("\n"),
				default: frm.doc.printer_name || options[0],
				reqd: 1,
			},
		],
		(values) => {
			frm.set_value("printer_name", values.printer_name);
			frm.save();
		},
		__("Select Printer")
	);
}

async function santu_test_print(frm) {
	// Server-side, not QZ Tray. "Test print sent" used to appear whenever QZ
	// accepted the job — including when no paper came out, which made the one
	// button meant to prove the printer works the least trustworthy thing on
	// the screen (2026-08-17).
	try {
		const res = await frappe.xcall("santu_hardware.santu_hardware.print_service.test_print");
		frappe.show_alert({
			message: __("Test parchi bhej di ({0}) — printer dekhiye", [res.method]),
			indicator: "green",
		});
	} catch (err) {
		frappe.msgprint({
			title: __("Test print nahi ho paya"),
			message: (err && err.message) || String(err),
			indicator: "red",
		});
	}
}
