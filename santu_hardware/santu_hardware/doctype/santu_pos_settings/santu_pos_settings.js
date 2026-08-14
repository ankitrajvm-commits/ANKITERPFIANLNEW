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
	let printers;
	try {
		printers = await santu_qz_list_printers();
	} catch (err) {
		frappe.msgprint({
			title: __("Couldn't Detect Printers"),
			message: err.message || String(err),
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
	try {
		await santu_qz_connect();
		const config = qz.configs.create(frm.doc.printer_name);
		await qz.print(config, [
			{
				type: "raw",
				format: "plain",
				data:
					"\n" +
					"      SANTU HARDWARE\n" +
					"      TEST PRINT OK\n" +
					"\n\n\n",
			},
		]);
		frappe.show_alert({ message: __("Test print sent"), indicator: "green" });
	} catch (err) {
		frappe.msgprint({
			title: __("Test Print Failed"),
			message: err.message || String(err),
			indicator: "red",
		});
	}
}
