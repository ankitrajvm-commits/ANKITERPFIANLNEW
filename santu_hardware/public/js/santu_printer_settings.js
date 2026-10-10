/* global frappe */

(function () {
	const API = "santu_hardware.santu_hardware.api";

	// ---------------------------------------------------------------------
	// Printer Settings -- hardware only: which physical printer, the logo on
	// the bill header, print density, and diagnostics. Template/layout choice
	// (Thermal Invoice Library, WhatsApp/A4 Library) lives in Invoice Settings
	// instead (2026-08-29 direct request: "invoice setting me thermal and a4
	// library dalna chahiye" -- those are bill-content decisions, not printer
	// hardware ones, so they belong next to the other bill-content setting
	// (UPI ID) rather than here).
	// ---------------------------------------------------------------------
	window.santu_render_printer_settings = async function ($body) {
		$body.html(`<div class="santu-prn-loading">${__("Loading Settings…")}</div>`);

		let printers = [];
		let selected = null;
		let levels = null;

		async function boot() {
			try {
				printers = await frappe.xcall(`${API}.list_printers`);
			} catch (e) {
				$body.html(`<div class="santu-prn-error"><b>${__("Could not read the printer list.")}</b><p>${frappe.utils.escape_html((e && e.message) || String(e))}</p></div>`);
				return;
			}

			try {
				levels = await frappe.xcall(`${API}.get_density_levels`);
				const settings = await frappe.db.get_doc("Santu POS Settings", "Santu POS Settings");

				selected = settings.printer_name && printers.includes(settings.printer_name)
					? settings.printer_name
					: printers[0] || null;

				render();
			} catch (e) {
				$body.html(`<div class="santu-prn-error"><b>${__("Could not load settings.")}</b><p>${frappe.utils.escape_html((e && e.message) || String(e))}</p></div>`);
			}
		}

		async function render() {
			if (!selected) {
				$body.html(`<div class="santu-prn-error">${__("No printer is connected.")}</div>`);
				return;
			}

			const diag = await frappe.xcall(`${API}.get_printer_diagnostics`, { printer_name: selected });
			const dens = diag.density || {};
			const cur = dens.level || levels.default;

			$body.html(`
				<div class="santu-prn">
					<div class="santu-prn-card">
						<div class="santu-prn-section-title">${__("Printer")}</div>
						<div class="santu-prn-row">
							<select class="santu-prn-printer">
								${printers.map((p) => `<option value="${frappe.utils.escape_html(p)}" ${p === selected ? "selected" : ""}>${frappe.utils.escape_html(p)}</option>`).join("")}
							</select>
						</div>
					</div>

					<div class="santu-prn-card">
						<div class="santu-prn-section-title">${__("Print Quality")}</div>
						<p class="santu-prn-help">${__("How dark this printer burns the paper. Written to the printer's own memory.")}</p>

						<div class="santu-prn-slider-wrap">
							<span class="santu-prn-end">${__("Lighter")}</span>
							<input type="range" class="santu-prn-density" min="${levels.min}" max="${levels.max}" step="1" value="${cur}" ${diag.density_supported ? "" : "disabled"}>
							<span class="santu-prn-end">${__("Darker")}</span>
						</div>
						<div class="santu-prn-density-read"></div>
						<div class="santu-prn-ticks">
							${levels.levels.map((l) => `<span>${l.level}</span>`).join("")}
						</div>

						${dens.last_applied_on ? `<div class="santu-prn-applied">${__("Last written")}: ${frappe.datetime.str_to_user(dens.last_applied_on)}</div>` : `<div class="santu-prn-applied santu-prn-unapplied">${__("Not written yet.")}</div>`}

						${diag.density_supported ? "" : `<div class="santu-prn-blocked"><b>${__("Density cannot be changed from here on this computer.")}</b><p>${frappe.utils.escape_html(diag.density_support_note || "")}</p></div>`}

						<div class="santu-prn-actions">
							<button class="btn btn-default santu-prn-test" ${diag.density_supported ? "" : "disabled"}>${__("Test Density")}</button>
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
							<tr><td>${__("Density control")}</td><td><b>${diag.density_supported ? __("Supported") : __("Not supported")}</b></td></tr>
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
				$body.html(`<div class="santu-prn-loading">${__("Reading printer…")}</div>`);
				render();
			});

			$body.find(".santu-prn-save").on("click", async () => {
				const lvl = cint($slider.val());
				const $btn = $body.find(".santu-prn-save").prop("disabled", true).text(__("Writing…"));
				try {
					await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "printer_name", selected);
					const res = await frappe.xcall("santu_hardware.santu_hardware.api.apply_printer_density", { printer_name: selected, level: lvl });
					frappe.show_alert({ message: __("Density set to {0} — {1}", [res.level, res.label]), indicator: "green" });

					$body.html(`<div class="santu-prn-loading">${__("Reading printer…")}</div>`);
					render();
				} catch (e) {
					frappe.msgprint({ title: __("Could not change density"), message: (e && e.message) || String(e), indicator: "red" });
					$btn.prop("disabled", false).text(__("Save & Apply to Printer"));
				}
			});

			$body.find(".santu-prn-test").on("click", async () => {
				const $btn = $body.find(".santu-prn-test").prop("disabled", true).text(__("Printing…"));
				try {
					const r = await frappe.xcall(`${API}.print_density_test`, { printer_name: selected, level: cint($slider.val()) });
					frappe.show_alert({ message: __("Test printed at density {0} — {1}", [r.level, r.label]), indicator: "blue" });
				} catch (e) {
					frappe.msgprint({ title: __("Could not print"), message: (e && e.message) || String(e), indicator: "red" });
				}
				$btn.prop("disabled", false).text(__("Test Density"));
			});
		}

		await boot();
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

	// ---------------------------------------------------------------------
	// Invoice Library -- Thermal Invoice Library + WhatsApp/A4 Library:
	// which layout each document type actually prints/sends as. This is bill
	// CONTENT, not printer hardware, so it lives in Invoice Settings.
	// ---------------------------------------------------------------------
	window.santu_render_invoice_library = async function ($body) {
		$body.html(`<div class="santu-prn-loading">${__("Loading templates…")}</div>`);

		let settings = null;
		let show_logo = 1;
		let show_logo_a4 = 1;
		const latest_docs = {};
		// Which Print Formats actually exist, so the preview never asks the
		// server for one that was never built. Without this the panel showed a
		// raw Python traceback whenever a doctype had no matching layout.
		let available_formats = [];

		// Every document this shop prints, thermal or A4, has a slot here
		// (2026-09-05 direct request: "jitne v a4 and thermal print hote
		// hai, sabhi ke sabhi whaa pe template hone chahiye"). Purchase
		// Order had an A4 layout but no way to see or pick it, and Khata
		// Statement — the statement handed to a customer — was missing from
		// the library altogether.
		// Har wo kagaz jo dukaan sach me deti hai, apne naam se — aur har ek
		// ke apne kai roop (2026-09-23: "return ka koi document type nh tha...
		// multiple formats banao"). Return ab apni entry hai: wo hai to Sales
		// Invoice hi, par kagaz par bill nahi, wapsi ki parchi hai.
		const docTypes = [
			{ value: "Sales Invoice", label: "Sale Bill" },
			{ value: "Sales Return", label: "Sales Return / Credit Note", real: "Sales Invoice", prefix: "Return", ret: 1 },
			{ value: "Quotation", label: "Estimate / Quotation", prefix: "Estimate" },
			{ value: "Sales Order", label: "Sales Order", prefix: "Order" },
			{ value: "Delivery Note", label: "Delivery Challan", prefix: "Challan" },
			{ value: "Purchase Invoice", label: "Purchase Bill", prefix: "Purchase" },
			{ value: "Purchase Return", label: "Purchase Return / Debit Note", real: "Purchase Invoice", prefix: "Purchase Return", ret: 1 },
			{ value: "Purchase Order", label: "Purchase Order", prefix: "Purchase Order" },
			{ value: "Payment Entry", label: "Payment In / Out", prefix: "Receipt" },
			{ value: "Stock Entry", label: "Receive Stock (Goods Received)", prefix: "Goods Received" },
			{ value: "Khata Statement", label: "Account Statement" },
		];
		const DOC_META = {};
		docTypes.forEach((d) => (DOC_META[d.value] = d));
		// Jo doctype ERPNext ke paas sach me hai (Return ka apna doctype nahi hota)
		const real_doctype = (dt) => (DOC_META[dt] && DOC_META[dt].real) || dt;
		const format_prefix = (dt) => (DOC_META[dt] && DOC_META[dt].prefix) || "";

		// The khata is generated markup, not a Print Format (a statement
		// spans many bills), so it previews through its own page instead of
		// /printview. Same iframe, same shape of URL.
		const KHATA_DOCTYPE = "Khata Statement";

		const libraries = {
			"Thermal Invoice Library": {
				title: "Thermal Invoice Library",
				desc: "Select a thermal bill layout. The live preview updates immediately. Set as Default to apply to actual prints.",
				templates: [
					{ id: "Standard Bill", name: "Standard Bill", desc: "Everything: items, totals, account summary and Scan & Pay QR." },
					{ id: "Compact Bill", name: "Compact Bill", desc: "Smaller type, no QR, no account block. Saves roll on long bills." },
					{ id: "Detailed Bill", name: "Detailed Bill", desc: "Adds item code under each name, a discount column and payment split." },
					{ id: "Simple Cash Bill", name: "Simple Cash Bill", desc: "No customer, no running account. Just items and total for a walk-in." },
					{ id: "Customer Copy", name: "Customer Copy", desc: "Standard bill stamped CUSTOMER COPY." },
					{ id: "Duplicate / Office Copy", name: "Duplicate / Office Copy", desc: "Stamped DUPLICATE, with item codes and a signature line." },
					{ id: "Bill + Payment Receipt", name: "Bill + Payment Receipt", desc: "Standard bill plus a mode-wise payment receipt and change returned." },
					{ id: "Delivery Slip (No Rates)", name: "Delivery Slip (No Rates)", desc: "Items and quantities only, no prices. Send goods with a helper safely." },
					{ id: "Large Print Bill", name: "Large Print Bill", desc: "Bigger type throughout, for reading at arm's length." },
					{ id: "Udhaar / Balance Bill", name: "Udhaar / Balance Bill", desc: "Balance due printed large at the top, with a signature line." },
					{ id: "Minimal Slip", name: "Minimal Slip", desc: "Bill number, item count and total only. Smallest possible slip." },
				],
			},
			"WhatsApp Library": {
				title: "WhatsApp Library",
				desc: "Select an A4 document template for sharing invoices and other documents on WhatsApp.",
				templates: [
					{ id: "Standard A4", name: "Standard A4", desc: "Clean and standard A4 document layout." },
					{ id: "Professional A4", name: "Professional A4", desc: "Premium aesthetic with bolder headers." },
					{ id: "Detailed A4", name: "Detailed A4", desc: "Includes all item details, HSN, and taxes if applicable." },
					{ id: "Simple A4", name: "Simple A4", desc: "Minimalist A4 slip without excessive borders." },
					{ id: "Customer Copy", name: "Customer Copy", desc: "Standard A4 stamped CUSTOMER COPY." },
					{ id: "Office Copy", name: "Office Copy", desc: "Standard A4 stamped OFFICE COPY." },
				],
			},
		};

		// Only the Sales Invoice has eleven hand-built thermal layouts. Every
		// other document has exactly one, and listing all eleven cards
		// against a Purchase Order suggested a choice that does not exist —
		// whichever one was clicked, the same single layout appeared. Each
		// document now shows the layouts it actually has (2026-09-05).
		// Har document ke apne roop. Sale Bill ke 11 thermal / 6 A4 pehle se the;
		// baaki har document ke liye 2026-09-23 ko asli formats banaye gaye
		// (pehle ek hi tha, ya tha hi nahi). Jo yahan nahi hai wo poori list
		// dikhata hai (sirf Sale Bill).
		const T = (id, name, desc) => ({ id, name, desc });
		const THERMAL_SET = [
			T("Standard", "Standard", "Poora parcha — saaman, matra, rate aur total."),
			T("Compact", "Compact", "Chhote akshar, kam jagah. Lambi list me roll bachta hai."),
			T("Detailed", "Detailed", "Har saaman ke neeche uska code bhi."),
			T("Large Print", "Large Print", "Bade akshar — door se bhi padha jaye."),
			T("Duplicate Copy", "Duplicate Copy", "Upar DUPLICATE COPY ki mohar, saath me item code."),
		];
		const A4_SET = [
			T("Standard A4", "Standard A4", "Saaf-suthra A4 dastavez."),
			T("Professional A4", "Professional A4", "Gehra header, bada title."),
			T("Detailed A4", "Detailed A4", "Har saaman ke neeche uska code."),
			T("Simple A4", "Simple A4", "Halki lines, bina signature — kam jagah."),
			T("Office Copy", "Office Copy", "Upar OFFICE COPY ki mohar."),
		];
		const pick = (set, ids) => set.filter((t) => ids.includes(t.id));

		const SINGLE_LAYOUTS = {
			"Thermal Invoice Library": {
				"Sales Return": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Large Print"]),
				"Quotation": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Large Print"]),
				"Sales Order": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Large Print"]),
				"Delivery Note": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Large Print"]),
				"Purchase Invoice": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Duplicate Copy"]),
				"Purchase Return": pick(THERMAL_SET, ["Standard", "Compact", "Detailed"]),
				"Purchase Order": pick(THERMAL_SET, ["Standard", "Compact", "Detailed", "Large Print"]),
				"Payment Entry": pick(THERMAL_SET, ["Standard", "Compact", "Large Print", "Duplicate Copy"]),
				"Stock Entry": pick(THERMAL_SET, ["Standard", "Compact", "Large Print"]),
				"Khata Statement": [
					T("Thermal Khata", "Thermal Account Statement", "Poora chalta account — har bill ke saaman, har payment, balance ke saath."),
					T("Thermal Khata (Compact)", "Thermal Account Statement (Compact)", "Wahi account, bina saaman ki line — sirf date, bill no aur paisa."),
				],
			},
			"WhatsApp Library": {
				"Sales Return": pick(A4_SET, ["Standard A4", "Professional A4", "Simple A4"]),
				"Quotation": pick(A4_SET, ["Standard A4", "Professional A4", "Detailed A4", "Simple A4"]),
				"Sales Order": pick(A4_SET, ["Standard A4", "Professional A4", "Detailed A4", "Simple A4"]),
				"Delivery Note": pick(A4_SET, ["Standard A4", "Professional A4", "Detailed A4", "Simple A4"]),
				"Purchase Invoice": pick(A4_SET, ["Standard A4", "Professional A4", "Detailed A4", "Office Copy"]),
				"Purchase Return": pick(A4_SET, ["Standard A4", "Simple A4"]),
				"Purchase Order": pick(A4_SET, ["Standard A4", "Professional A4", "Detailed A4", "Simple A4"]),
				"Payment Entry": pick(A4_SET, ["Standard A4", "Professional A4", "Simple A4"]),
				"Stock Entry": pick(A4_SET, ["Standard A4", "Simple A4"]),
				"Khata Statement": [T("A4 Khata", "A4 Account Statement", "Poora A4 statement — har bill ke saaman ke saath.")],
			},
		};

		function templates_for(lib_name, dt) {
			const only = (SINGLE_LAYOUTS[lib_name] || {})[dt];
			if (!only) return libraries[lib_name].templates;
			return Array.isArray(only) ? only : [only];
		}

		// default_templates[library][doctype] = template_id
		let default_templates = { "Thermal Invoice Library": {}, "WhatsApp Library": {} };
		let active_doc_type = { "Thermal Invoice Library": "Sales Invoice", "WhatsApp Library": "Sales Invoice" };
		let active_preview_template = { "Thermal Invoice Library": "Standard Bill", "WhatsApp Library": "Standard A4" };
		let previewing_library = "Thermal Invoice Library";

		async function fetch_latest_doc(doctype) {
			if (latest_docs[doctype]) return latest_docs[doctype];

			// The khata has no document of its own to point at — the
			// preview page picks the party itself. A truthy marker is all
			// the caller needs so it stops saying "koi bill bana hi nahi".
			if (doctype === KHATA_DOCTYPE) {
				latest_docs[doctype] = { doctype: KHATA_DOCTYPE, name: KHATA_DOCTYPE };
				return latest_docs[doctype];
			}

			// Return ka apna doctype nahi hota — wahi Sales/Purchase Invoice hai
			// jis par is_return lagi ho. Preview usi tarah ka document dhoondhta hai,
			// warna wapsi ka roop ek saadhe bill par dikhta (2026-09-23).
			const meta = DOC_META[doctype] || {};
			const real = meta.real || doctype;
			const filters = meta.ret ? { docstatus: 1, is_return: 1 } : { docstatus: 1 };
			let invoices = await frappe.db.get_list(real, { limit: 1, filters, order_by: "creation desc" });
			if (invoices.length) {
				latest_docs[doctype] = { doctype: real, name: invoices[0].name };
				return latest_docs[doctype];
			}
			// Fallback to POS Invoice if Sales Invoice is empty
			if (doctype === "Sales Invoice") {
				invoices = await frappe.db.get_list("POS Invoice", { limit: 1, filters: { docstatus: 1 }, order_by: "creation desc" });
				if (invoices.length) {
					latest_docs[doctype] = { doctype: "POS Invoice", name: invoices[0].name };
					return latest_docs[doctype];
				}
			}
			return null;
		}

		function resolve_format(lib, dt, style) {
			// Each template is its own Print Format, so the preview and a real
			// print go through the identical path. `&style=` never worked -- a
			// print format cannot read it -- which is why every template used to
			// preview the same bill.
			//
			// The two lists are kept strictly apart. The thermal list used to
			// include "Santu Hardware Challan (Delivery Note)" -- an A4
			// format -- so picking a thermal layout for a Delivery Note
			// previewed, and would have printed, a full A4 sheet on the roll
			// (2026-09-05). A thermal slot may only ever resolve to a thermal
			// format, and an A4 slot only to an A4 one; where one genuinely
			// does not exist the panel says so instead of quietly showing the
			// other kind.
			// Har document ke apne format ka naam: "Santu Thermal - <Document> - <Style>"
			// (Sale Bill purane naam "Santu Thermal - <Style>" par hi rehta hai).
			const pfx = format_prefix(dt);
			const real = real_doctype(dt);
			const own = lib === "Thermal Invoice Library"
				? (pfx ? [`Santu Thermal - ${pfx} - ${style}`] : [])
				: (pfx ? [`Santu A4 - ${pfx} - ${style}`] : []);
			const candidates = lib === "Thermal Invoice Library"
				? [...own, `Santu Thermal - ${style}`, "Santu Hardware Thermal Bill (Sales Invoice)",
				   "Santu Hardware Thermal Estimate (Quotation)",
				   "Santu Hardware Thermal Challan (Delivery Note)",
				   "Santu Hardware Thermal Purchase Bill",
				   "Santu Hardware Thermal Purchase Order",
				   "Santu Hardware Thermal Payment Receipt", "Santu Hardware Thermal Bill"]
				: [...own, `Santu A4 - ${style}`, `Santu A4 - WhatsApp (${real})`, `Santu Hardware Bill (${real})`, "Santu Hardware Bill",
				   "Santu Hardware Challan (Delivery Note)", "Santu Hardware Purchase Bill",
				   "Santu Hardware Purchase Order", "Santu Hardware Payment Receipt"];
			return candidates.find((name) =>
				available_formats.some((f) => f.name === name && f.doc_type === real)
			) || null;
		}

		function get_preview_url() {
			const lib = previewing_library;
			const dt = active_doc_type[lib];
			const doc = latest_docs[dt];
			const style = active_preview_template[lib];
			// Jis tarah ka document dukaan me abhi bana hi nahi (Sales Order,
			// Purchase Bill...) uska preview pehle khaali reh jata tha aur
			// layout dekhne ka koi tareeka nahi tha (2026-09-23). Ab server
			// ek NAMUNA parcha bana kar dikhata hai -- kuch save nahi hota.
			if (!doc && dt !== KHATA_DOCTYPE) {
				const fmt = resolve_format(lib, dt, style);
				if (!fmt) return "";
				return `/api/method/santu_hardware.santu_hardware.api.sample_print_preview?doctype=${encodeURIComponent(real_doctype(dt))}&print_format=${encodeURIComponent(fmt)}&_=${Date.now()}`;
			}
			if (!doc) return "";
			if (dt === KHATA_DOCTYPE) {
				const layout = lib === "Thermal Invoice Library" ? "thermal" : "a4";
				const compact = style === "Thermal Khata (Compact)" ? 1 : 0;
				// A whitelisted method returning a bare document — NOT a www
				// page. Frappe wraps a www page in the whole website template
				// (navbar, footer, website bundle) and the khata markup is
				// itself a complete <!doctype html>, so the iframe was loading
				// a full website page with a second document nested inside it
				// (2026-09-05).
				// Cache-buster: the browser happily reuses a previous response
				// for the same URL, so the "Live Preview" kept showing an old
				// rendering of a template that had since changed — which is
				// the one thing a preview must never do (2026-09-05).
				return `/api/method/santu_hardware.santu_hardware.khata_preview.khata_preview?party_type=Customer&layout=${layout}&compact=${compact}&_=${Date.now()}`;
			}
			const format = resolve_format(lib, dt, style);
			if (!format) return "";
			// `/api/method/frappe.utils.print_and_email.printview` does not exist
			// on this Frappe version -- it answered 417 and the panel rendered the
			// traceback as the "bill". `/printview` is the real endpoint.
			return `/printview?doctype=${encodeURIComponent(doc.doctype)}&name=${encodeURIComponent(doc.name)}&format=${encodeURIComponent(format)}&no_letterhead=1&_=${Date.now()}`;
		}

		async function boot() {
			settings = await frappe.db.get_doc("Santu POS Settings");
			show_logo = cint(settings.show_logo_on_bill ?? 1);
			show_logo_a4 = cint(settings.show_logo_on_a4_bill ?? 1);
			try {
				available_formats = await frappe.db.get_list("Print Format", {
					fields: ["name", "doc_type"],
					filters: { disabled: 0 },
					limit: 500,
				});
			} catch (e) {
				available_formats = [];
			}

			// Populate default_templates from settings.document_templates
			(settings.document_templates || []).forEach((row) => {
				if (!default_templates[row.library]) default_templates[row.library] = {};
				default_templates[row.library][row.document_type] = row.template_name;
			});
			// Fallback default for Thermal if missing
			if (!default_templates["Thermal Invoice Library"]["Sales Invoice"]) {
				default_templates["Thermal Invoice Library"]["Sales Invoice"] = settings.invoice_template_style || "Standard Bill";
			}

			active_preview_template["Thermal Invoice Library"] = default_templates["Thermal Invoice Library"]["Sales Invoice"] || "Standard Bill";
			active_preview_template["WhatsApp Library"] = default_templates["WhatsApp Library"]["Sales Invoice"] || "Standard A4";

			await fetch_latest_doc("Sales Invoice");

			render();
		}

		function render() {
			const render_library_section = (lib_name) => {
				const lib = libraries[lib_name];
				const dt = active_doc_type[lib_name];
				const default_tpl = default_templates[lib_name][dt];
				const active_preview = active_preview_template[lib_name];

				return `
					<div class="santu-prn-card santu-prn-lib-card" data-lib="${lib_name}">
						<div class="santu-prn-section-title">${__(lib.title)}</div>
						<p class="santu-prn-help">${__(lib.desc)}</p>

						<div class="santu-prn-row" style="margin-bottom: 12px; max-width: 300px;">
							<label style="flex: 0 0 auto;">${__("Document Type")}</label>
							<select class="santu-prn-doc-type" data-lib="${lib_name}">
								${docTypes.map((d) => `<option value="${d.value}" ${d.value === dt ? "selected" : ""}>${d.label}</option>`).join("")}
							</select>
						</div>

						<div class="santu-prn-templates-grid">
							${templates_for(lib_name, dt).map((t) => `
								<div class="santu-prn-template-card ${t.id === active_preview ? "active" : ""}" data-lib="${lib_name}" data-id="${t.id}">
									<div class="santu-prn-template-name">${t.name}</div>
									<div class="santu-prn-template-desc">${t.desc}</div>
									${t.id === default_tpl ? '<div class="santu-prn-template-default"><i class="fa fa-check-circle"></i> Default</div>' : ""}
								</div>
							`).join("")}
						</div>
						<div class="santu-prn-template-actions">
							<button class="btn btn-primary santu-prn-set-default" data-lib="${lib_name}" ${active_preview === default_tpl ? "disabled" : ""}>${__("Set as Default")}</button>
							${lib_name === "Thermal Invoice Library" ? `<button class="btn btn-default santu-prn-test-template" data-lib="${lib_name}">${__("Test Print Template")}</button>` : ""}
						</div>
					</div>
				`;
			};

			$body.html(`
				<div class="santu-prn-modern">
					<div class="santu-prn-left">
						<div class="santu-prn-card" style="margin-bottom: 24px;">
							<div class="santu-prn-section-title">${__("Logo Library")}</div>
							<p class="santu-prn-help">${__("Upload different logos for Thermal (black & white, high contrast) and A4 (colorful, high resolution).")}</p>
							
							<div style="display: flex; gap: 24px; margin-top: 16px;">
								<div style="flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; text-align: center;">
									<div style="font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 8px;">${__("Thermal Logo")}</div>
									${settings.thermal_logo_image ? `<img src="${settings.thermal_logo_image}" style="max-height: 60px; max-width: 100%; margin-bottom: 12px; object-fit: contain;">` : `<div style="height: 60px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 11px; margin-bottom: 12px; background: #f3f4f6; border-radius: 4px;">No Logo</div>`}
									<button class="btn btn-default btn-xs santu-prn-upload-thermal-logo">${__("Upload")}</button>
									${settings.thermal_logo_image ? `<button class="btn btn-danger btn-xs santu-prn-clear-thermal-logo" style="margin-left: 4px;">${__("Clear")}</button>` : ""}
									<div style="margin-top: 16px; text-align: left;">
										<div style="font-size: 11px; color: #4b5563; margin-bottom: 4px; display: flex; justify-content: space-between;">
											<span>${__("Logo Size (Width)")}</span>
											<span><span class="thermal-width-val">${settings.thermal_logo_width || 65}</span>mm</span>
										</div>
										<input type="range" class="santu-prn-thermal-width" min="10" max="72" value="${settings.thermal_logo_width || 65}" style="width: 100%;">
									</div>
								</div>
								
								<div style="flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; text-align: center;">
									<div style="font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 8px;">${__("A4 Logo")}</div>
									${settings.a4_logo_image ? `<img src="${settings.a4_logo_image}" style="max-height: 60px; max-width: 100%; margin-bottom: 12px; object-fit: contain;">` : `<div style="height: 60px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 11px; margin-bottom: 12px; background: #f3f4f6; border-radius: 4px;">No Logo</div>`}
									<button class="btn btn-default btn-xs santu-prn-upload-a4-logo">${__("Upload")}</button>
									${settings.a4_logo_image ? `<button class="btn btn-danger btn-xs santu-prn-clear-a4-logo" style="margin-left: 4px;">${__("Clear")}</button>` : ""}
									<div style="margin-top: 16px; text-align: left;">
										<div style="font-size: 11px; color: #4b5563; margin-bottom: 4px; display: flex; justify-content: space-between;">
											<span>${__("Logo Size (Width)")}</span>
											<span><span class="a4-width-val">${settings.a4_logo_width || 40}</span>%</span>
										</div>
										<input type="range" class="santu-prn-a4-width" min="10" max="100" value="${settings.a4_logo_width || 40}" style="width: 100%;">
									</div>
								</div>
							</div>
						</div>

						<div class="santu-prn-card" style="margin-bottom: 24px;">
							<div class="santu-prn-section-title">${__("Bill Header Toggles")}</div>
							<p class="santu-prn-help">${__("Control whether the shop logo prints at the top of the bills. Thermal printers are black-and-white, so if the logo ever comes out poorly on the actual roll, turn it off instantly.")}</p>
							<div style="display: flex; gap: 24px; margin-top: 12px;">
								<label class="santu-prn-check" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
									<input type="checkbox" class="santu-prn-logo-toggle" ${show_logo ? "checked" : ""}>
									<span>${__("Show logo on Thermal Bill")}</span>
								</label>
								<label class="santu-prn-check" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
									<input type="checkbox" class="santu-prn-a4-logo-toggle" ${show_logo_a4 ? "checked" : ""}>
									<span>${__("Show logo on A4 Bill")}</span>
								</label>
							</div>
						</div>

						${render_library_section("Thermal Invoice Library")}
						${render_library_section("WhatsApp Library")}
					</div>

					<div class="santu-prn-right">
						<div class="santu-prn-preview-panel ${previewing_library === "WhatsApp Library" ? "is-a4" : ""}">
							<div class="santu-prn-preview-header">${__("Live Preview")} <span class="santu-prn-preview-badge">${__(previewing_library)}</span></div>
							<div class="santu-prn-preview-content">
								${(() => {
									const dt = active_doc_type[previewing_library];
									const url = get_preview_url();
									if (!url) {
										return `<div class="santu-prn-no-preview">${__("Ye template abhi sirf Invoice ke liye bana hai. {0} ke liye abhi nahi.", [__(dt)])}</div>`;
									}
									// Preview kabhi chup-chaap khaali na rahe: agar frame
									// na khule (purana cache, format mit gaya, request
									// ruk gayi) to yahi jagah batati hai kya karna hai
									// (2026-09-23: "live preview show nh kar raha").
									return `
										<iframe class="santu-prn-preview-frame" src="${url}" onload="this.dataset.loaded=1"></iframe>
										<div class="santu-prn-preview-fallback" style="display:none;">
											<div class="santu-prn-no-preview">
												${__("Preview nahi khul paaya.")}<br>
												${__("Ek baar Cmd+Shift+R dabakar screen dobara kholiye.")}
											</div>
											<button type="button" class="santu-prn-preview-retry">${__("Dobara dikhao")}</button>
										</div>`;
								})()}
							</div>
						</div>
					</div>
				</div>
			`);

			// Frame khula ya nahi -- 6 second me na khule to fallback dikhao.
			const $frame = $body.find(".santu-prn-preview-frame");
			const $fallback = $body.find(".santu-prn-preview-fallback");
			if ($frame.length) {
				setTimeout(() => {
					if (!$frame[0] || $frame[0].dataset.loaded !== "1") {
						$frame.hide();
						$fallback.show();
					}
				}, 6000);
			}
			$body.find(".santu-prn-preview-retry").on("click", () => render());

			$body.find(".santu-prn-upload-thermal-logo").on("click", () => {
				new frappe.ui.FileUploader({
					doctype: "Santu POS Settings",
					docname: "Santu POS Settings",
					folder: "Home/Attachments",
					on_success: async (file_doc) => {
						await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "thermal_logo_image", file_doc.file_url);
						settings.thermal_logo_image = file_doc.file_url;
						render();
					}
				});
			});

			$body.find(".santu-prn-clear-thermal-logo").on("click", async () => {
				await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "thermal_logo_image", "");
				settings.thermal_logo_image = "";
				render();
			});

			$body.find(".santu-prn-upload-a4-logo").on("click", () => {
				new frappe.ui.FileUploader({
					doctype: "Santu POS Settings",
					docname: "Santu POS Settings",
					folder: "Home/Attachments",
					on_success: async (file_doc) => {
						await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "a4_logo_image", file_doc.file_url);
						settings.a4_logo_image = file_doc.file_url;
						render();
					}
				});
			});

			$body.find(".santu-prn-clear-a4-logo").on("click", async () => {
				await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "a4_logo_image", "");
				settings.a4_logo_image = "";
				render();
			});

			$body.find(".santu-prn-thermal-width").on("input", (e) => {
				$body.find(".thermal-width-val").text(e.target.value);
			}).on("change", async (e) => {
				await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "thermal_logo_width", e.target.value);
				settings.thermal_logo_width = e.target.value;
				render();
			});

			$body.find(".santu-prn-a4-width").on("input", (e) => {
				$body.find(".a4-width-val").text(e.target.value);
			}).on("change", async (e) => {
				await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "a4_logo_width", e.target.value);
				settings.a4_logo_width = e.target.value;
				render();
			});

			$body.find(".santu-prn-logo-toggle").on("change", async (e) => {
				show_logo = e.target.checked ? 1 : 0;
				try {
					await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "show_logo_on_bill", show_logo);
					frappe.show_alert({ message: show_logo ? __("Logo will print on thermal bills") : __("Plain text name will print on thermal bills"), indicator: "green" });
					render();
				} catch (err) {
					e.target.checked = !e.target.checked;
					show_logo = show_logo ? 0 : 1;
					frappe.msgprint({ title: __("Could not save"), message: (err && err.message) || String(err), indicator: "red" });
				}
			});

			$body.find(".santu-prn-a4-logo-toggle").on("change", async (e) => {
				show_logo_a4 = e.target.checked ? 1 : 0;
				try {
					await frappe.db.set_value("Santu POS Settings", "Santu POS Settings", "show_logo_on_a4_bill", show_logo_a4);
					frappe.show_alert({ message: show_logo_a4 ? __("Logo will print on A4 bills") : __("Plain text name will print on A4 bills"), indicator: "green" });
					render();
				} catch (err) {
					e.target.checked = !e.target.checked;
					show_logo_a4 = show_logo_a4 ? 0 : 1;
					frappe.msgprint({ title: __("Could not save"), message: (err && err.message) || String(err), indicator: "red" });
				}
			});

			$body.find(".santu-prn-doc-type").on("change", async function () {
				const lib = $(this).attr("data-lib");
				const dt = $(this).val();
				active_doc_type[lib] = dt;
				previewing_library = lib;

				// Set active preview to this doctype's default, or its first
				// REAL layout — falling back to the Sales Invoice style list
				// left a Purchase Order highlighting "Standard Bill", a card
				// that is not even on screen for it.
				const choices = templates_for(lib, dt);
				const saved = default_templates[lib][dt];
				active_preview_template[lib] =
					(saved && choices.some((t) => t.id === saved) && saved) || choices[0].id;

				await fetch_latest_doc(dt);
				render();
			});

			$body.find(".santu-prn-template-card").on("click", function () {
				const lib = $(this).attr("data-lib");
				const id = $(this).attr("data-id");

				active_preview_template[lib] = id;
				previewing_library = lib;
				render();
			});

			$body.find(".santu-prn-test-template").on("click", async function () {
				const lib = $(this).attr("data-lib");
				const dt = active_doc_type[lib];
				const doc = latest_docs[dt];
				if (!doc) return;

				const $btn = $(this).prop("disabled", true).text(__("Printing…"));
				try {
					// This used to call a server method (api.print_thermal_bill)
					// that never existed, so every "Test Print Template" click
					// threw "has no attribute 'print_thermal_bill'" (2026-09-07
					// bug report). window.santu_print_thermal_bill is the one
					// real print path every other button in the app already
					// uses (Save & Print, Reprint, the print icon everywhere) --
					// it runs the actual CUPS/USB/PDF ladder and reports back
					// what really happened, instead of a fake success.
					//
					// It always prints the shop's currently SAVED default
					// template for this doctype, not necessarily the card being
					// previewed here -- picking a specific non-default layout to
					// physically test isn't wired up (the USB rung renders its
					// own raw ESC/POS bytes, entirely separate from these Print
					// Format records, so there's no single place to plug an
					// override into both paths safely). Set the card as Default
					// first, then Test Print, to try a specific layout on paper.
					await window.santu_print_thermal_bill(doc.doctype, doc.name);
				} catch (e) {
					frappe.msgprint({ title: __("Print Failed"), message: (e && e.message) || String(e), indicator: "red" });
				}
				$btn.prop("disabled", false).text(__("Test Print Template"));
			});

			$body.find(".santu-prn-set-default").on("click", async function () {
				const lib = $(this).attr("data-lib");
				const dt = active_doc_type[lib];
				const active_tpl = active_preview_template[lib];

				const $btn = $(this).prop("disabled", true).text(__("Saving…"));
				try {
					await frappe.xcall("santu_hardware.santu_hardware.api.set_document_template", {
						library: lib,
						document_type: dt,
						template_name: active_tpl,
					});

					default_templates[lib][dt] = active_tpl;
					frappe.show_alert({ message: __("Default template updated."), indicator: "green" });
					render();
				} catch (e) {
					frappe.msgprint({ title: __("Error"), message: (e && e.message) || String(e), indicator: "red" });
					$btn.text(__("Set as Default")).prop("disabled", false);
				}
			});
		}

		boot();
	};
})();
