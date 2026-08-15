/* global frappe */

// Printer Settings. Until now this did not exist — the setup wizard said
// "printer settings live in Settings › Printer Settings", which was a place
// that was never built, so the only way to change a printer was the raw
// Santu POS Settings form.
//
// The one thing here that is not cosmetic is Print Density: it writes to the
// printer's own stored settings over ESC/POS. Nothing on this screen changes
// how a bill is laid out.
(function () {
	const API = "santu_hardware.santu_hardware.api";

	// Rendered into whatever container it is handed, so the same screen serves
	// both the Utilities entry (where someone actually looks for it) and the
	// setup wizard's Printer step, instead of existing twice.
	window.santu_render_printer_settings = async function ($body) {
		$body.html(`<div class="santu-prn-loading">${__("Looking for printers…")}</div>`);

		let printers = [];
		let selected = null;
		let levels = null;

		async function boot() {
			try {
				printers = await frappe.xcall(`${API}.list_printers`);
			} catch (e) {
				$body.html(`
					<div class="santu-prn-error">
						<b>${__("Could not read the printer list.")}</b>
						<p>${frappe.utils.escape_html(e.message || String(e))}</p>
					</div>
				`);
				return;
			}
			levels = await frappe.xcall(`${API}.get_density_levels`);
			const settings = await frappe.db.get_doc("Santu POS Settings");
			selected = settings.printer_name && printers.includes(settings.printer_name)
				? settings.printer_name
				: printers[0] || null;
			render();
		}

		async function render() {
			if (!selected) {
				$body.html(`<div class="santu-prn-error">${__("No printer is connected.")}</div>`);
				return;
			}
			$body.html(`<div class="santu-prn-loading">${__("Reading printer…")}</div>`);
			const diag = await frappe.xcall(`${API}.get_printer_diagnostics`, { printer_name: selected });
			const dens = diag.density || {};
			const cur = dens.level || levels.default;

			$body.html(`
				<div class="santu-prn">
					<div class="santu-prn-row">
						<label>${__("Printer")}</label>
						<select class="santu-prn-printer">
							${printers
								.map(
									(p) =>
										`<option value="${frappe.utils.escape_html(p)}" ${p === selected ? "selected" : ""}>${frappe.utils.escape_html(p)}</option>`
								)
								.join("")}
						</select>
					</div>

					<div class="santu-prn-section">
						<div class="santu-prn-section-title">${__("Print Density")}</div>
						<p class="santu-prn-help">${__(
							"How dark this printer burns the paper. This is written into the printer itself, so it stays even after unplugging it. It does not change how bills look on screen."
						)}</p>

						<div class="santu-prn-slider-wrap">
							<span class="santu-prn-end">${__("Lighter")}</span>
							<input type="range" class="santu-prn-density"
								min="${levels.min}" max="${levels.max}" step="1" value="${cur}"
								${diag.density_supported ? "" : "disabled"}>
							<span class="santu-prn-end">${__("Darker")}</span>
						</div>
						<div class="santu-prn-density-read"></div>
						<div class="santu-prn-ticks">
							${levels.levels.map((l) => `<span>${l.level}</span>`).join("")}
						</div>
						${
							dens.last_applied_on
								? `<div class="santu-prn-applied">${__("Last written to the printer")}: ${frappe.datetime.str_to_user(dens.last_applied_on)}</div>`
								: `<div class="santu-prn-applied santu-prn-unapplied">${__("Not written to this printer yet.")}</div>`
						}

						${
							diag.density_supported
								? ""
								: `<div class="santu-prn-blocked">
										<b>${__("Density cannot be changed from here on this computer.")}</b>
										<p>${frappe.utils.escape_html(diag.density_support_note || "")}</p>
										<p>${__(
											"Plug the printer in over USB and reopen this screen."
										)}</p>
									</div>`
						}

						<div class="santu-prn-actions">
							<button class="btn btn-default santu-prn-test" ${diag.density_supported ? "" : "disabled"}>${__("Test Print")}</button>
							<button class="btn btn-primary santu-prn-save" ${diag.density_supported ? "" : "disabled"}>${__("Save & Apply to Printer")}</button>
						</div>
					</div>

					<details class="santu-prn-diag">
						<summary>${__("Diagnostics")}</summary>
						<table class="santu-prn-diag-table">
							<tr><td>${__("Printer")}</td><td>${frappe.utils.escape_html(diag.printer_name || "—")}</td></tr>
							<tr><td>${__("Print queue")}</td><td>${frappe.utils.escape_html(diag.cups_queue || "—")}</td></tr>
							<tr><td>${__("Connection")}</td><td>${frappe.utils.escape_html(diag.connection || "—")}</td></tr>
							<tr><td>${__("Device")}</td><td class="santu-prn-mono">${frappe.utils.escape_html(diag.device_uri || "—")}</td></tr>
							<tr><td>${__("Bill printing")}</td><td>${frappe.utils.escape_html(diag.printing_method)}</td></tr>
							<tr><td>${__("Density written by")}</td><td>${frappe.utils.escape_html(diag.density_method)}</td></tr>
							<tr><td>${__("Density in printer driver")}</td><td>${diag.density_in_driver ? __("Yes") : __("No")}</td></tr>
							<tr><td>${__("Density control")}</td><td><b>${diag.density_supported ? __("Supported") : __("Not supported")}</b></td></tr>
							<tr><td>${__("Driver options")}</td><td class="santu-prn-mono">${frappe.utils.escape_html((diag.driver_options || []).join(", ") || "—")}</td></tr>
						</table>
						<p class="santu-prn-help">${frappe.utils.escape_html(diag.density_support_note || "")}</p>
					</details>
				</div>
			`);

			const $slider = $body.find(".santu-prn-density");
			const show = () => {
				const lvl = cint($slider.val());
				const meta = levels.levels.find((l) => l.level === lvl) || {};
				$body.find(".santu-prn-density-read").html(
					`<b>${__("Density {0} of {1}", [lvl, levels.max])}</b> — ${frappe.utils.escape_html(meta.label || "")}`
				);
			};
			show();
			$slider.on("input", show);

			$body.find(".santu-prn-printer").on("change", (e) => {
				selected = e.target.value;
				render();
			});

			$body.find(".santu-prn-save").on("click", async () => {
				const lvl = cint($slider.val());
				const $btn = $body.find(".santu-prn-save").prop("disabled", true).text(__("Writing to printer…"));
				try {
					await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "printer_name", selected);
					const res = await santu_qz_apply_print_density(selected, lvl);
					frappe.show_alert({
						message: __("Density set to {0} — {1}", [res.level, res.label]),
						indicator: "green",
					});
					render();
				} catch (e) {
					frappe.msgprint({
						title: __("Could not change density"),
						message: e.message || String(e),
						indicator: "red",
					});
					$btn.prop("disabled", false).text(__("Save & Apply to Printer"));
				}
			});

			$body.find(".santu-prn-test").on("click", async () => {
				const $btn = $body.find(".santu-prn-test").prop("disabled", true).text(__("Printing…"));
				try {
					// Prints at whatever the printer is currently set to — the
					// point is to look at the paper, not to trust the screen.
					const r = await frappe.xcall(`${API}.print_density_test`, {
						printer_name: selected,
						level: cint($slider.val()),
					});
					frappe.show_alert({
						message: __("Test printed at density {0} — {1}", [r.level, r.label]),
						indicator: "blue",
					});
				} catch (e) {
					frappe.msgprint({
						title: __("Could not print"),
						message: e.message || String(e),
						indicator: "red",
					});
				}
				$btn.prop("disabled", false).text(__("Test Print"));
			});
		}

		boot();
	};

	window.santu_open_printer_settings = function () {
		const d = new frappe.ui.Dialog({
			title: __("Printer Settings"),
			size: "large",
			fields: [{ fieldtype: "HTML", fieldname: "body" }],
		});
		d.show();
		window.santu_render_printer_settings(d.fields_dict.body.$wrapper);
	};
})();
