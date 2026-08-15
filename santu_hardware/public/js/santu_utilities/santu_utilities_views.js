/* global santu_utilities, frappe */
frappe.provide("santu_utilities");

santu_utilities.views = {
	async render($wrap, view, ctx) {
		$wrap.html(`<div class="santu-utilities-loading">Loading…</div>`);
		try {
			const fn = this[`render_${view}`] || this.render_import_items;
			await fn.call(this, $wrap, ctx);
		} catch (e) {
			$wrap.html(`<div class="santu-utilities-error">${frappe.utils.escape_html(e.message || "Failed to load")}</div>`);
		}
	},

	/* ── 1. Import Items ─────────────────────────────────────── */
	async render_import_items($wrap) {
		const state = { method: null, file_url: null, mapping: {}, validation: null };
		const render = () => {
			if (!state.method) {
				$wrap.html(`
					<div class="santu-utilities-section">
						<h2 class="santu-utilities-subtitle">Select Import Method</h2>
						<div class="santu-utilities-method-grid">
							<label class="santu-utilities-method-card recommended">
								<input type="radio" name="import_method" value="barcode" />
								<span class="badge-rec">RECOMMENDED</span>
								<div class="method-icon">📦</div>
								<h3>Import From Barcode</h3>
								<p>Scan barcodes to find or create items using the existing Santu Hardware scanner.</p>
							</label>
							<label class="santu-utilities-method-card">
								<input type="radio" name="import_method" value="excel" />
								<div class="method-icon">📊</div>
								<h3>Import From Excel</h3>
								<p>Upload .xlsx / .xls files with column mapping and validation.</p>
							</label>
							<label class="santu-utilities-method-card">
								<input type="radio" name="import_method" value="pdf" />
								<div class="method-icon">📄</div>
								<h3>Import From PDF</h3>
								<p>Upload a supplier's price list or catalogue PDF — items are auto-read and matched.</p>
							</label>
						</div>
						<div class="santu-utilities-or">OR</div>
						<label class="santu-utilities-method-card wide">
							<input type="radio" name="import_method" value="library" disabled />
							<h3>Import From Vyapar Library</h3>
							<p>Not configured — use Excel import for bulk catalogue upload.</p>
						</label>
						<div class="santu-utilities-footer-bar">
							<button class="btn btn-primary santu-utilities-continue" disabled>Continue</button>
						</div>
					</div>
				`);
				$wrap.find('input[name="import_method"]').on("change", function () {
					state.method = $(this).val();
					$wrap.find(".santu-utilities-method-card").removeClass("selected");
					$(this).closest(".santu-utilities-method-card").addClass("selected");
					$wrap.find(".santu-utilities-continue").prop("disabled", false);
				});
				$wrap.find(".santu-utilities-continue").on("click", () => render());
				return;
			}

			if (state.method === "barcode") {
				this._render_barcode_import($wrap, () => { state.method = null; render(); });
				return;
			}
			if (state.method === "excel" || state.method === "pdf") {
				state.source = state.method;
				this._render_excel_import($wrap, state, () => { state.method = null; render(); });
			}
		};
		render();
	},

	_render_barcode_import($wrap, onBack) {
		$wrap.html(`
			<div class="santu-utilities-toolbar">
				<button class="btn btn-default btn-sm santu-util-back">← Back</button>
			</div>
			<div class="santu-utilities-card">
				<h3>Scan Barcode to Import / Find Item</h3>
				<p class="santu-utilities-muted">Uses the same barcode search as POS and Product Search.</p>
				<input type="text" class="form-control santu-barcode-scan" placeholder="Scan barcode or type item code…" autofocus />
				<div class="santu-barcode-results"></div>
			</div>
		`);
		$wrap.find(".santu-util-back").on("click", onBack);
		const $input = $wrap.find(".santu-barcode-scan");
		const $results = $wrap.find(".santu-barcode-results");
		const run = santu_utilities.utils.debounce(async () => {
			const q = $input.val().trim();
			if (!q) { $results.empty(); return; }
			$results.html(`<div class="santu-utilities-loading">Searching…</div>`);
			const data = await santu_utilities.api.lookupBarcode(q);
			const results = (data && data.results) || [];
			if (!results.length) {
				$results.html(`
					<div class="santu-utilities-empty">
						<p>No item found for <b>${frappe.utils.escape_html(q)}</b></p>
						<button class="btn btn-primary btn-sm santu-create-item">Create Item from Barcode</button>
					</div>
				`);
				$results.find(".santu-create-item").on("click", async () => {
					try {
						const r = await santu_utilities.api.quickCreateItem({ barcode: q, item_name: q });
						frappe.show_alert({ message: `Created ${r.item_code}`, indicator: "green" });
						$input.val(r.item_code).trigger("input");
					} catch (e) {
						frappe.msgprint(e.message);
					}
				});
				return;
			}
			let html = `<table class="santu-utilities-table"><thead><tr><th>Item</th><th>Code</th><th>Stock</th><th>Action</th></tr></thead><tbody>`;
			results.forEach((it) => {
				html += `<tr>
					<td>${frappe.utils.escape_html(it.item_name)}</td>
					<td>${frappe.utils.escape_html(it.item_code)}</td>
					<td>${it.available_qty ?? "—"}</td>
					<td><button class="btn btn-xs btn-default" data-code="${frappe.utils.escape_html(it.item_code)}">Open</button></td>
				</tr>`;
			});
			html += "</tbody></table>";
			$results.html(html);
			$results.find("button[data-code]").on("click", function () {
				frappe.route_options = { item_code: $(this).data("code") };
				frappe.set_route("santu-items");
			});
		}, 200);
		$input.on("input", run);
	},

	async _render_excel_import($wrap, state, onBack) {
		const is_pdf = state.source === "pdf";
		const step = state.step || "upload";
		if (step === "upload") {
			$wrap.html(`
				<div class="santu-utilities-toolbar">
					<button class="btn btn-default btn-sm santu-util-back">← Back</button>
				</div>
				<div class="santu-utilities-card">
					<h3>Upload ${is_pdf ? "PDF" : "Excel"} File</h3>
					${is_pdf ? `<p class="santu-utilities-muted">Works best with a real (text) PDF price list or catalogue — not a scanned photo.</p>` : ""}
					<div class="santu-utilities-upload-zone" id="santu-item-upload"></div>
				</div>
			`);
			$wrap.find(".santu-util-back").on("click", onBack);
			const uploader = new frappe.ui.FileUploader({
				wrapper: $wrap.find("#santu-item-upload")[0],
				allow_multiple: false,
				restrictions: { allowed_file_types: is_pdf ? [".pdf"] : [".xlsx", ".xls", ".csv"] },
				onsuccess: (file) => {
					state.file_url = file.file_url;
					state.step = "map";
					this._render_excel_import($wrap, state, onBack);
				},
			});
			return;
		}
		if (step === "map") {
			$wrap.html(`<div class="santu-utilities-loading">Reading file…</div>`);
			const parse_call = is_pdf ? santu_utilities.api.parseItemsFilePdf(state.file_url) : santu_utilities.api.parseItemsFile(state.file_url);
			parse_call.then((data) => {
				state.parsed = data;
				state.mapping = { ...data.suggested_mapping };
				let mapHtml = `<div class="santu-utilities-toolbar"><button class="btn btn-default btn-sm santu-util-back-map">← Upload</button></div>
					<div class="santu-utilities-card"><h3>Map Columns</h3><div class="santu-utilities-map-grid">`;
				data.headers.forEach((h) => {
					mapHtml += `<div class="map-row"><label>${frappe.utils.escape_html(h)}</label><select class="form-control map-field" data-col="${frappe.utils.escape_html(h)}">`;
					mapHtml += `<option value="">— Skip —</option>`;
					santu_utilities.ITEM_FIELDS.forEach((f) => {
						const sel = state.mapping[h] === f.key ? "selected" : "";
						mapHtml += `<option value="${f.key}" ${sel}>${f.label}</option>`;
					});
					mapHtml += `</select></div>`;
				});
				mapHtml += `</div><button class="btn btn-primary santu-validate-import">Validate</button></div>`;
				$wrap.html(mapHtml);
				$wrap.find(".santu-util-back-map").on("click", () => { state.step = "upload"; this._render_excel_import($wrap, state, onBack); });
				$wrap.find(".map-field").on("change", function () {
					const col = $(this).data("col");
					const val = $(this).val();
					if (val) state.mapping[col] = val;
					else delete state.mapping[col];
				});
				$wrap.find(".santu-validate-import").on("click", async () => {
					state.step = "validate";
					await this._render_excel_import($wrap, state, onBack);
				});
			});
			return;
		}
		if (step === "validate") {
			$wrap.html(`<div class="santu-utilities-loading">Validating…</div>`);
			// PDF-sourced rows were already parsed client-side in the "map"
			// step (state.parsed.rows) — validate_items_import only knows how
			// to re-read Excel/CSV from a file_url, so PDF passes its rows
			// straight through instead.
			const result = await santu_utilities.api.validateItemsImport(
				is_pdf ? { rows: state.parsed.rows, mapping: state.mapping } : { file_url: state.file_url, mapping: state.mapping }
			);
			state.validation = result;
			const c = result.counts;
			$wrap.html(`
				<div class="santu-utilities-toolbar">
					<button class="btn btn-default btn-sm santu-util-back-map">← Mapping</button>
				</div>
				<div class="santu-utilities-summary-cards">
					<div class="summary-card valid"><b>${c.valid}</b><span>Valid Rows</span></div>
					<div class="summary-card warning"><b>${c.warnings}</b><span>Warning Rows</span></div>
					<div class="summary-card error"><b>${c.errors}</b><span>Error Rows</span></div>
				</div>
				<div class="santu-utilities-toolbar">
					<button class="btn btn-primary santu-import-valid" ${c.valid ? "" : "disabled"}>Import Valid Rows (${c.valid})</button>
					<button class="btn btn-default santu-download-errors" ${c.errors ? "" : "disabled"}>Download Error Report</button>
				</div>
			`);
			$wrap.find(".santu-util-back-map").on("click", () => { state.step = "map"; this._render_excel_import($wrap, state, onBack); });
			$wrap.find(".santu-download-errors").on("click", () => {
				const rows = [["Row", "Issues", "Item Name", "Item Code"]];
				(result.errors || []).forEach((e) => {
					rows.push([e.row, (e.issues || []).join("; "), e.data.item_name || "", e.data.item_code || ""]);
				});
				santu_utilities.utils.download_csv("import-errors.csv", rows);
			});
			$wrap.find(".santu-import-valid").on("click", async () => {
				frappe.confirm(`Import ${c.valid} valid items?`, async () => {
					const r = await santu_utilities.api.importItemsValid(result.valid);
					frappe.msgprint(`Imported ${r.created_count} items. ${r.failed.length ? r.failed.length + " failed." : ""}`);
					state.step = "upload";
					state.method = null;
					onBack();
				});
			});
		}
	},

	/* ── 2. Set Up My Business ───────────────────────────────── */
	async render_setup_business($wrap) {
		const data = await santu_utilities.api.getBusinessSetup();
		const steps = ["Business", "Tax", "Invoice", "Payment", "Printer", "Security", "Finish"];
		let step = 0;
		const render = () => {
			const pct = Math.round((step / (steps.length - 1)) * 100);
			let body = `<div class="santu-utilities-wizard-steps">${steps.map((s, i) =>
				`<span class="wizard-step ${i === step ? "active" : i < step ? "done" : ""}">${s}</span>`
			).join("")}</div><div class="santu-utilities-progress"><div style="width:${pct}%"></div></div>`;

			if (step === 0) {
				const c = data.company || {};
				body += `<div class="santu-utilities-card"><h3>Business Details</h3>
					<div class="santu-utilities-form-grid">
						<label>Business Name <input class="form-control" id="biz-name" value="${frappe.utils.escape_html(c.company_name || "")}"></label>
						<label>Phone <input class="form-control" id="biz-phone" value="${frappe.utils.escape_html(c.phone_no || "")}"></label>
						<label>Email <input class="form-control" id="biz-email" value="${frappe.utils.escape_html(c.email || "")}"></label>
						<label>GSTIN <input class="form-control" id="biz-gstin" value="${frappe.utils.escape_html(c.gstin || "")}"></label>
					</div></div>`;
			} else if (step === 1) {
				body += `<div class="santu-utilities-card"><h3>Tax Settings</h3>
					<p class="santu-utilities-muted">GST rates come from each item’s HSN code. Set the HSN when you add or edit an item; the tax is then worked out for you on every bill.</p>
					<button class="btn btn-default" id="open-company">Open Company Tax Settings</button></div>`;
			} else if (step === 2) {
				body += `<div class="santu-utilities-card"><h3>Invoice Settings</h3>
					<p>Default Warehouse: <b>${frappe.utils.escape_html(data.warehouse || "—")}</b></p>
					<p>Default Price List: <b>${frappe.utils.escape_html(data.price_list || "—")}</b></p>
</div>`;
			} else if (step === 3) {
				body += `<div class="santu-utilities-card"><h3>Payment Settings</h3>
					<p>Enabled modes: ${(data.payment_modes || []).map(frappe.utils.escape_html).join(", ") || "—"}</p>
					<button class="btn btn-default" id="open-mop">Manage Modes of Payment</button></div>`;
			} else if (step === 4) {
				body += `<div class="santu-utilities-card"><h3>Printer Settings</h3>
					<p class="santu-utilities-muted">Choose which printer bills go to, and how dark it prints. Print density is written into the printer itself, so it survives unplugging.</p>
					<button class="btn btn-default" id="open-printer-settings">Open Printer Settings</button></div>`;
			} else if (step === 5) {
				body += `<div class="santu-utilities-card"><h3>Cost Price Lock</h3>
					<p class="santu-utilities-muted">Cost price stays hidden on the billing screen so a customer at the counter cannot see your margin. Set a PIN to reveal it, and add this Mac's fingerprint so you do not have to type the PIN every time.</p>
					<button class="btn btn-default" id="open-privacy-lock">Set PIN &amp; Fingerprint</button></div>`;
			} else {
				body += `<div class="santu-utilities-hero"><div class="hero-icon">✅</div>
					<h2>Santu Hardware is ready to use.</h2>
					<p>Your business configuration has been saved.</p></div>`;
			}

			body += `<div class="santu-utilities-footer-bar">
				${step > 0 ? '<button class="btn btn-default santu-wiz-prev">Back</button>' : ""}
				${step < steps.length - 1 ? '<button class="btn btn-primary santu-wiz-next">Next</button>' : '<button class="btn btn-primary santu-wiz-done">Finish</button>'}
			</div>`;
			$wrap.html(body);

			$wrap.find("#open-company").on("click", () => window.santu_open_shop_profile());
			$wrap.find("#open-mop").on("click", () => window.santu_open_payment_modes());
			$wrap.find("#open-privacy-lock").on("click", () => window.santu_privacy.manage_dialog());
			$wrap.find("#open-printer-settings").on("click", () => window.santu_open_printer_settings());
			$wrap.find(".santu-wiz-prev").on("click", () => { step--; render(); });
			$wrap.find(".santu-wiz-next").on("click", async () => {
				if (step === 0) {
					await santu_utilities.api.saveBusinessSetup({
						company_name: $wrap.find("#biz-name").val(),
						phone_no: $wrap.find("#biz-phone").val(),
						email: $wrap.find("#biz-email").val(),
						gstin: $wrap.find("#biz-gstin").val(),
					});
					frappe.show_alert({ message: "Business details saved", indicator: "green" });
				}
				step++;
				render();
			});
			$wrap.find(".santu-wiz-done").on("click", () => frappe.set_route("santu-dashboard"));
		};
		render();
	},

	/* ── 3. Accountant Access ────────────────────────────────── */
	async render_accountant_access($wrap) {
		const [staff, roles] = await Promise.all([santu_utilities.api.staff(), santu_utilities.api.roles()]);
		$wrap.html(`
			<div class="santu-utilities-toolbar">
				<button class="btn btn-sm btn-primary santu-add-accountant">+ Add Accountant</button>
			</div>
			<table class="santu-utilities-table">
				<thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
				<tbody></tbody>
			</table>
		`);
		const $tb = $wrap.find("tbody");
		staff.forEach((u) => {
			const $tr = $(`<tr>
				<td>${frappe.utils.escape_html(u.full_name || u.name)}</td>
				<td>${frappe.utils.escape_html(u.email || "")}</td>
				<td>${frappe.utils.escape_html(u.roles || "")}</td>
				<td>${frappe.utils.escape_html(u.status)}</td>
				<td class="santu-utilities-actions"></td>
			</tr>`);
			$tr.find(".santu-utilities-actions").append(`<button class="btn btn-xs btn-default" data-edit="${frappe.utils.escape_html(u.name)}">Edit Access</button>`);
			$tr.find(".santu-utilities-actions").append(`<button class="btn btn-xs btn-danger" data-disable="${frappe.utils.escape_html(u.name)}">Disable</button>`);
			$tb.append($tr);
		});
		$wrap.find(".santu-add-accountant").on("click", () => window.santu_open_add_user("Accountant", () => santu_utilities.views.accountant_access($wrap)));
		$wrap.find("[data-edit]").on("click", function () {
			const user = $(this).data("edit");
			const u = staff.find((x) => x.name === user);
			const dlg = new frappe.ui.Dialog({
				title: `Edit Access — ${user}`,
				fields: [{ fieldtype: "HTML", fieldname: "roles_html" }],
				primary_action_label: "Save",
				primary_action() {
					const selected = [];
					dlg.$wrapper.find(".santu-role-chk:checked").each(function () { selected.push($(this).val()); });
					if (selected.includes("System Manager") || selected.includes("Administrator")) {
						frappe.msgprint("Cannot assign administrator privileges to accountants.");
						return;
					}
					santu_utilities.api.saveRoles(user, selected).then(() => {
						dlg.hide();
						frappe.show_alert({ message: "Roles updated", indicator: "green" });
						santu_utilities.views.render_accountant_access($wrap);
					});
				},
			});
			let html = `<div class="santu-utilities-role-grid">`;
			roles.forEach((g) => {
				html += `<div class="role-group"><b>${g.group}</b><br>`;
				g.existing.forEach((role) => {
					const chk = (u.roles || "").includes(role) ? "checked" : "";
					const blocked = ["System Manager", "Administrator"].includes(role);
					html += `<label><input type="checkbox" class="santu-role-chk" value="${role}" ${chk} ${blocked ? "disabled" : ""}> ${role}</label><br>`;
				});
				html += `</div>`;
			});
			html += `</div>`;
			dlg.fields_dict.roles_html.$wrapper.html(html);
			dlg.show();
		});
		$wrap.find("[data-disable]").on("click", async function () {
			const user = $(this).data("disable");
			frappe.confirm(`Disable ${user}?`, async () => {
				await santu_utilities.api.disableUser(user);
				santu_utilities.views.render_accountant_access($wrap);
			});
		});
	},

	/* ── 4. Barcode Generator ────────────────────────────────── */
	async render_barcode_generator($wrap) {
		const state = { list: [], selected: null };
		const opts = santu_utilities.LABEL_LINE_OPTIONS.map((o) => `<option value="${o}">${o}</option>`).join("");
		$wrap.html(`
			<div class="santu-utilities-barcode-layout">
				<div class="santu-utilities-card">
					<h3>Enter item details to add for barcode</h3>
					<div class="santu-utilities-form-grid">
						<label>Item Name *<input class="form-control santu-bg-item-search" placeholder="Search item…"></label>
						<label>Item Code<input class="form-control santu-bg-item-code" readonly></label>
						<label>No of Labels *<input type="number" class="form-control santu-bg-labels" value="1" min="1"></label>
						<label>Header<select class="form-control santu-bg-header">${opts}</select></label>
						<label>Line 1<select class="form-control santu-bg-l1">${opts}</select></label>
						<label>Line 2<select class="form-control santu-bg-l2">${opts}</select></label>
						<label>Line 3<select class="form-control santu-bg-l3">${opts}</select></label>
						<label>Line 4<select class="form-control santu-bg-l4">${opts}</select></label>
					</div>
					<div class="santu-utilities-toolbar">
						<label>Label Size <select class="form-control santu-bg-size"><option value="50x25">50 × 25 mm</option><option value="50x30">50 × 30 mm</option><option value="100x50">100 × 50 mm</option></select></label>
						<button class="btn btn-primary santu-bg-add">Add for Barcode</button>
					</div>
				</div>
				<div class="santu-utilities-card santu-barcode-preview-card">
					<h3>Preview</h3>
					<div class="santu-barcode-preview"><div class="preview-header">Header</div><img class="preview-barcode-img" src="" alt=""><div class="preview-code">item code</div><div class="preview-lines"></div></div>
				</div>
			</div>
			<div class="santu-utilities-section"><h3>Item List</h3><div class="santu-bg-list"></div></div>
			<div class="santu-utilities-footer-bar">
				<button class="btn btn-default santu-bg-preview-all" disabled>Preview</button>
				<button class="btn btn-primary santu-bg-generate" disabled>Generate</button>
			</div>
		`);

		const $search = $wrap.find(".santu-bg-item-search");
		let searchTimer;
		$search.on("input", () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(async () => {
				const q = $search.val().trim();
				if (q.length < 2) return;
				const data = await santu_utilities.api.searchProducts(q);
				const results = (data && data.results) || [];
				if (results[0]) {
					state.selected = results[0];
					$wrap.find(".santu-bg-item-code").val(results[0].item_code);
					this._update_barcode_preview($wrap, state);
				}
			}, 250);
		});

		$wrap.find(".santu-bg-header, .santu-bg-l1, .santu-bg-l2, .santu-bg-l3, .santu-bg-l4").on("change", () => this._update_barcode_preview($wrap, state));

		$wrap.find(".santu-bg-add").on("click", () => {
			const code = $wrap.find(".santu-bg-item-code").val();
			if (!code) { frappe.msgprint("Select an item first"); return; }
			state.list.push({
				item_code: code,
				item_name: $search.val(),
				labels_count: parseInt($wrap.find(".santu-bg-labels").val(), 10) || 1,
				header: $wrap.find(".santu-bg-header").val(),
				line1: $wrap.find(".santu-bg-l1").val(),
				line2: $wrap.find(".santu-bg-l2").val(),
				line3: $wrap.find(".santu-bg-l3").val(),
				line4: $wrap.find(".santu-bg-l4").val(),
			});
			this._render_barcode_list($wrap, state);
		});

		$wrap.find(".santu-bg-preview-all, .santu-bg-generate").on("click", () => this._print_barcode_labels($wrap, state));
		this._render_barcode_list($wrap, state);
	},

	_update_barcode_preview($wrap, state) {
		const code = $wrap.find(".santu-bg-item-code").val();
		if (!code) return;
		santu_utilities.api.generateBarcodeLabels([{ item_code: code }], $wrap.find(".santu-bg-size").val()).then((r) => {
			const lbl = (r.labels || [])[0];
			if (!lbl) return;
			$wrap.find(".preview-barcode-img").attr("src", lbl.barcode_data_uri);
			$wrap.find(".preview-code").text(lbl.barcode_value);
			$wrap.find(".preview-header").text($wrap.find(".santu-bg-header").val());
			const lines = [$wrap.find(".santu-bg-l1").val(), $wrap.find(".santu-bg-l2").val(), $wrap.find(".santu-bg-l3").val(), $wrap.find(".santu-bg-l4").val()];
			$wrap.find(".preview-lines").html(lines.filter(Boolean).map((l) => `<div>${frappe.utils.escape_html(l)}</div>`).join(""));
		});
	},

	_render_barcode_list($wrap, state) {
		const $list = $wrap.find(".santu-bg-list");
		if (!state.list.length) {
			$list.html(`<div class="santu-utilities-empty">Added items for Barcode generation will appear here.</div>`);
			$wrap.find(".santu-bg-preview-all, .santu-bg-generate").prop("disabled", true);
			return;
		}
		$wrap.find(".santu-bg-preview-all, .santu-bg-generate").prop("disabled", false);
		let html = `<table class="santu-utilities-table"><thead><tr><th>Item</th><th>Labels</th><th>Header</th><th>Lines</th><th></th></tr></thead><tbody>`;
		state.list.forEach((it, i) => {
			html += `<tr><td>${frappe.utils.escape_html(it.item_name || it.item_code)}</td><td>${it.labels_count}</td><td>${frappe.utils.escape_html(it.header || "")}</td>
				<td>${[it.line1, it.line2, it.line3, it.line4].filter(Boolean).join(", ")}</td>
				<td><button class="btn btn-xs btn-danger" data-rm="${i}">Remove</button></td></tr>`;
		});
		html += "</tbody></table>";
		$list.html(html);
		$list.find("[data-rm]").on("click", function () {
			state.list.splice($(this).data("rm"), 1);
			santu_utilities.views._render_barcode_list($wrap, state);
		});
	},

	async _print_barcode_labels($wrap, state) {
		const size = $wrap.find(".santu-bg-size").val();
		// window.open must run synchronously inside the click handler, before
		// any await — otherwise most browsers treat it as a popup (not a
		// user-initiated navigation) and silently block it, returning null.
		const w = window.open("", "_blank");
		if (!w) {
			frappe.msgprint(__("Please allow pop-ups for this site to preview/print barcode labels."));
			return;
		}
		const r = await santu_utilities.api.generateBarcodeLabels(state.list, size);
		let html = `<html><head><title>Barcode Labels</title><style>
			body{font-family:sans-serif} .label{border:1px solid #ccc;padding:8px;margin:8px;display:inline-block;text-align:center}
			img{max-width:100%} .line{font-size:11px}
		</style></head><body>`;
		(r.labels || []).forEach((lbl) => {
			for (let i = 0; i < (lbl.labels_count || 1); i++) {
				html += `<div class="label"><div><b>${frappe.utils.escape_html(lbl.header || "")}</b></div>
					<img src="${lbl.barcode_data_uri}"><div>${frappe.utils.escape_html(lbl.barcode_value)}</div>
					${(lbl.lines || []).filter(Boolean).map((l) => `<div class="line">${frappe.utils.escape_html(l)}</div>`).join("")}
				</div>`;
			}
		});
		html += `</body></html>`;
		w.document.write(html);
		w.document.close();
		w.print();
	},

	/* ── 5. Bulk Update Items ────────────────────────────────── */
	async render_bulk_update($wrap) {
		const state = { mode: "pricing", search: "", page: 1, selected: new Set(), edits: {} };
		const render = async () => {
			$wrap.html(`<div class="santu-utilities-loading">Loading items…</div>`);
			const data = await santu_utilities.api.getBulkItems(state.mode, state.search, state.page, 50);
			const cols = state.mode === "pricing"
				? ["item_name", "item_group", "gst_hsn_code", "valuation_rate", "standard_rate"]
				: state.mode === "stock"
					? ["item_name", "warehouse", "actual_qty", "stock_uom"]
					: ["item_name", "item_group", "brand", "gst_hsn_code", "barcode", "description"];

			let html = `
				<div class="santu-utilities-toolbar">
					<input class="form-control santu-bulk-search" placeholder="Search by Item Name / Code / HSN / Brand" value="${frappe.utils.escape_html(state.search)}">
					<input type="text" class="form-control santu-bulk-scan" placeholder="📷 Scan barcode…" autocomplete="off">
					<button type="button" class="btn btn-default santu-bulk-pdf-import">📄 Import from PDF</button>
					<div class="santu-bulk-modes">
						<label><input type="radio" name="bulk_mode" value="pricing" ${state.mode === "pricing" ? "checked" : ""}> Pricing</label>
						<label><input type="radio" name="bulk_mode" value="stock" ${state.mode === "stock" ? "checked" : ""}> Stock</label>
						<label><input type="radio" name="bulk_mode" value="info" ${state.mode === "info" ? "checked" : ""}> Item Information</label>
					</div>
				</div>
				<div class="santu-utilities-toolbar">
					<span><b>${state.selected.size}</b> items selected</span>
					<button class="btn btn-primary santu-bulk-update" ${state.selected.size ? "" : "disabled"}>Update Selected</button>
				</div>
				<div class="santu-utilities-table-wrap"><table class="santu-utilities-table santu-bulk-table"><thead><tr>
					<th><input type="checkbox" class="santu-bulk-all"></th><th>#</th>`;
			cols.forEach((c) => { html += `<th>${c.replace(/_/g, " ")}</th>`; });
			html += `</tr></thead><tbody>`;
			data.items.forEach((it, idx) => {
				const checked = state.selected.has(it.name) ? "checked" : "";
				html += `<tr data-name="${frappe.utils.escape_html(it.name)}"><td><input type="checkbox" class="santu-bulk-chk" ${checked}></td><td>${(state.page - 1) * 50 + idx + 1}</td>`;
				cols.forEach((c) => {
					// A field staged in state.edits (typed by hand, or filled in by
					// the barcode-scan / PDF-import actions below) always wins over
					// what's still in the database — otherwise a re-render (paging,
					// switching mode and back, another scan) would silently discard
					// an unsaved edit the moment the row scrolls out of view.
					const staged = state.edits[it.name];
					const val = (staged && staged[c] !== undefined) ? staged[c] : (it[c] ?? "");
					const editable = ["valuation_rate", "standard_rate", "brand", "description", "gst_hsn_code", "barcode"].includes(c);
					html += editable
						? `<td><input class="form-control input-sm santu-bulk-edit" data-field="${c}" value="${frappe.utils.escape_html(String(val))}"></td>`
						: `<td>${frappe.utils.escape_html(String(val))}</td>`;
				});
				html += `</tr>`;
			});
			html += `</tbody></table></div>
				<div class="santu-utilities-pagination">
					<button class="btn btn-default btn-sm santu-page-prev" ${state.page <= 1 ? "disabled" : ""}>Prev</button>
					<span>Page ${state.page} of ${Math.ceil(data.total / 50) || 1} (${data.total} items)</span>
					<button class="btn btn-default btn-sm santu-page-next" ${state.page * 50 >= data.total ? "disabled" : ""}>Next</button>
				</div>`;
			$wrap.html(html);

			const debouncedSearch = santu_utilities.utils.debounce(() => {
				state.search = $wrap.find(".santu-bulk-search").val();
				state.page = 1;
				render();
			}, 400);
			$wrap.find(".santu-bulk-search").on("input", debouncedSearch);

			// Scan a barcode straight into the bulk-update list — finds the
			// item, brings it into view (via the existing search filter) and
			// checks it, so a cashier can scan several items in a row,
			// editing each one's fields as it comes up, then apply all of
			// them together with one "Update Selected" click at the end
			// (selection/edits persist across scans, only the visible table
			// filter changes).
			const $scan = $wrap.find(".santu-bulk-scan");
			$scan.on("keydown", async (e) => {
				if (e.key !== "Enter") return;
				const code = $scan.val().trim();
				if (!code) return;
				$scan.prop("disabled", true);
				try {
					const found = await santu_utilities.api.lookupBarcode(code);
					const results = (found && found.results) || [];
					if (!results.length) {
						frappe.show_alert({ message: __("No item found for barcode {0}", [code]), indicator: "orange" });
						return;
					}
					const item = results.find((r) => r.item_code === code) || results[0];
					state.selected.add(item.item_code);
					state.search = item.item_code;
					state.page = 1;
					await render();
					frappe.show_alert({ message: __("Scanned {0} — edit its fields below", [item.item_name]), indicator: "green" });
					$wrap.find(".santu-bulk-scan").trigger("focus");
				} finally {
					$scan.prop("disabled", false);
				}
			});

			// Import from PDF — a supplier's price list, matched against the
			// existing catalogue (this screen only ever edits items that
			// already exist; a line that doesn't match anything belongs in
			// Import Items -> Import From PDF instead, which shares the same
			// PDF reader). Every match gets selected + its Purchase Price
			// staged, exactly like a manual edit would — so several PDFs (or
			// a PDF plus manual scans) can be reviewed together before one
			// "Update Selected" applies all of it.
			$wrap.find(".santu-bulk-pdf-import").on("click", () => {
				const dialog = new frappe.ui.Dialog({
					title: __("Import from PDF"),
					fields: [
						{ fieldtype: "HTML", fieldname: "upload_note", options: `<p class="text-muted">${__("Upload a supplier's price list or catalogue PDF. Matched items get selected below with their new Purchase Price staged for review.")}</p>` },
						{ fieldtype: "HTML", fieldname: "upload_zone" },
					],
				});
				dialog.show();
				new frappe.ui.FileUploader({
					wrapper: dialog.fields_dict.upload_zone.$wrapper[0],
					allow_multiple: false,
					restrictions: { allowed_file_types: [".pdf"] },
					onsuccess: async (file) => {
						dialog.hide();
						frappe.dom.freeze(__("Reading PDF…"));
						try {
							const result = await santu_utilities.api.matchPdfItemsForBulkUpdate(file.file_url);
							result.matched.forEach((m) => {
								state.selected.add(m.item_code);
								if (!state.edits[m.item_code]) state.edits[m.item_code] = {};
								if (m.rate != null) state.edits[m.item_code].valuation_rate = m.rate;
							});
							state.mode = "pricing";
							state.search = "";
							state.page = 1;
							await render();
							const msg = result.unmatched_count
								? __("Matched {0} items from the PDF ({1} lines not found in your catalogue — add those via Import Items instead).", [result.matched_count, result.unmatched_count])
								: __("Matched {0} items from the PDF — review prices below and Update Selected.", [result.matched_count]);
							frappe.msgprint(msg);
						} finally {
							frappe.dom.unfreeze();
						}
					},
				});
			});

			$wrap.find('input[name="bulk_mode"]').on("change", function () {
				state.mode = $(this).val();
				state.page = 1;
				render();
			});
			$wrap.find(".santu-bulk-all").on("change", function () {
				const on = $(this).is(":checked");
				$wrap.find(".santu-bulk-chk").prop("checked", on);
				data.items.forEach((it) => { if (on) state.selected.add(it.name); else state.selected.delete(it.name); });
				$wrap.find(".santu-bulk-update").prop("disabled", !state.selected.size);
				$wrap.find(".santu-utilities-toolbar span b").text(state.selected.size);
			});
			$wrap.find(".santu-bulk-chk").on("change", function () {
				const name = $(this).closest("tr").data("name");
				if ($(this).is(":checked")) state.selected.add(name); else state.selected.delete(name);
				$wrap.find(".santu-bulk-update").prop("disabled", !state.selected.size);
				$wrap.find(".santu-utilities-toolbar span b").text(state.selected.size);
			});
			$wrap.find(".santu-bulk-edit").on("change", function () {
				const $tr = $(this).closest("tr");
				const name = $tr.data("name");
				if (!state.edits[name]) state.edits[name] = {};
				state.edits[name][$(this).data("field")] = $(this).val();
			});
			$wrap.find(".santu-page-prev").on("click", () => { state.page--; render(); });
			$wrap.find(".santu-page-next").on("click", () => { state.page++; render(); });
			$wrap.find(".santu-bulk-update").on("click", () => {
				const updates = [];
				state.selected.forEach((name) => {
					if (state.edits[name]) updates.push({ name, fields: state.edits[name] });
				});
				if (!updates.length) { frappe.msgprint("No field changes detected for selected items."); return; }
				frappe.confirm(`Update ${updates.length} items?`, async () => {
					const r = await santu_utilities.api.bulkUpdateItems(updates);
					frappe.msgprint(`Updated ${r.updated_count} items.`);
					state.edits = {};
					render();
				});
			});
		};
		render();
	},

	/* ── 6. Import Parties ───────────────────────────────────── */
	async render_import_parties($wrap) {
		const state = { party_type: "Customer", file_url: null, rows: [] };
		$wrap.html(`
			<div class="santu-utilities-card">
				<h3>Import Parties</h3>
				<label>Party Type <select class="form-control santu-party-type"><option value="Customer">Customer</option><option value="Supplier">Supplier</option></select></label>
				<div class="santu-utilities-upload-zone" id="santu-party-upload"></div>
				<div class="santu-party-preview"></div>
				<button class="btn btn-primary santu-party-import" disabled>Import Valid Rows</button>
			</div>
		`);
		$wrap.find(".santu-party-type").on("change", function () { state.party_type = $(this).val(); });
		new frappe.ui.FileUploader({
			wrapper: $wrap.find("#santu-party-upload")[0],
			allow_multiple: false,
			restrictions: { allowed_file_types: [".xlsx", ".xls", ".csv"] },
			onsuccess: async (file) => {
				state.file_url = file.file_url;
				const data = await santu_utilities.api.parsePartiesFile(state.file_url, state.party_type);
				state.rows = data.rows;
				$wrap.find(".santu-party-preview").html(`<p><b>${data.total_rows}</b> rows loaded. Preview:</p>
					<pre class="santu-utilities-preview">${frappe.utils.escape_html(JSON.stringify(data.rows.slice(0, 5), null, 2))}</pre>`);
				$wrap.find(".santu-party-import").prop("disabled", false);
			},
		});
		$wrap.find(".santu-party-import").on("click", async () => {
			const mapped = state.rows.map((r) => ({
				party_name: r["Party Name"] || r["party_name"] || r["Name"] || Object.values(r)[0],
				gstin: r["GSTIN"] || r["gstin"] || "",
				mobile_no: r["Mobile"] || r["Phone"] || "",
				email_id: r["Email"] || "",
				customer_group: r["Customer Group"] || "",
				supplier_group: r["Supplier Group"] || "",
			}));
			frappe.confirm(`Import ${mapped.length} ${state.party_type}s?`, async () => {
				const r = await santu_utilities.api.importParties(mapped, state.party_type);
				frappe.msgprint(`Created ${r.created.length}. Failed: ${r.failed.length}`);
			});
		});
	},

	/* ── 7. Track Salesmen ───────────────────────────────────── */
	async render_track_salesmen($wrap) {
		const from = frappe.datetime.add_months(frappe.datetime.get_today(), -1);
		const to = frappe.datetime.get_today();
		$wrap.html(`
			<div class="santu-utilities-toolbar">
				<label>From <input type="date" class="form-control santu-sm-from" value="${from}"></label>
				<label>To <input type="date" class="form-control santu-sm-to" value="${to}"></label>
				<button class="btn btn-primary santu-sm-refresh">Refresh</button>
			</div>
			<div class="santu-sm-results"></div>
		`);
		const load = async () => {
			$wrap.find(".santu-sm-results").html(`<div class="santu-utilities-loading">Loading…</div>`);
			const r = await santu_utilities.api.getSalesmanReport($wrap.find(".santu-sm-from").val(), $wrap.find(".santu-sm-to").val());
			let html = `<p class="santu-utilities-muted">${frappe.utils.escape_html(r.note || "")}</p>
				<table class="santu-utilities-table"><thead><tr><th>Salesman</th><th>Total Sales</th><th>Invoices</th><th>Collection</th><th>Outstanding</th></tr></thead><tbody>`;
			(r.rows || []).forEach((row) => {
				html += `<tr><td>${frappe.utils.escape_html(row.salesman)}</td><td>${santu_utilities.utils.format_currency(row.total_sales)}</td>
					<td>${row.invoice_count}</td><td>${santu_utilities.utils.format_currency(row.collection)}</td><td>${santu_utilities.utils.format_currency(row.outstanding)}</td></tr>`;
			});
			html += `</tbody></table>`;
			$wrap.find(".santu-sm-results").html(html);
		};
		$wrap.find(".santu-sm-refresh").on("click", load);
		load();
	},

	/* ── 8. Exports To Tally ─────────────────────────────────── */
	async render_export_tally($wrap) {
		const types = ["Sale", "Credit Note", "Purchase", "Debit Note", "Sale Cancelled"];
		const from = frappe.datetime.month_start(frappe.datetime.get_today());
		const to = frappe.datetime.get_today();
		$wrap.html(`
			<div class="santu-utilities-card santu-tally-filters">
				<label>From <input type="date" class="form-control santu-tally-from" value="${from}"></label>
				<label>To <input type="date" class="form-control santu-tally-to" value="${to}"></label>
				<button class="btn btn-primary santu-tally-load">Load Transactions</button>
				<button class="btn btn-danger santu-tally-export">Export To Tally</button>
			</div>
			<div class="santu-tally-type-filters">TRANSACTIONS: ${types.map((t) => `<label><input type="checkbox" class="santu-tally-type" value="${t}" checked> ${t}</label>`).join(" ")}</div>
			<div class="santu-tally-table-wrap"></div>
		`);
		const load = async () => {
			const selected = [];
			$wrap.find(".santu-tally-type:checked").each(function () { selected.push($(this).val()); });
			$wrap.find(".santu-tally-table-wrap").html(`<div class="santu-utilities-loading">Loading…</div>`);
			const r = await santu_utilities.api.getTallyData($wrap.find(".santu-tally-from").val(), $wrap.find(".santu-tally-to").val(), selected);
			let html = `<table class="santu-utilities-table"><thead><tr><th>Date</th><th>Invoice No</th><th>Party</th><th>Type</th><th>Payment</th><th>Amount</th><th>Balance</th></tr></thead><tbody>`;
			(r.transactions || []).forEach((row) => {
				html += `<tr><td>${row.date}</td><td>${frappe.utils.escape_html(row.invoice_no)}</td><td>${frappe.utils.escape_html(row.party)}</td>
					<td>${row.type}</td><td>${row.payment_type}</td><td>${santu_utilities.utils.format_currency(row.amount)}</td><td>${santu_utilities.utils.format_currency(row.balance)}</td></tr>`;
			});
			html += `</tbody></table><p class="santu-utilities-muted">${r.count} transactions</p>`;
			$wrap.find(".santu-tally-table-wrap").html(html);
		};
		$wrap.find(".santu-tally-load").on("click", load);
		$wrap.find(".santu-tally-export").on("click", async () => {
			const selected = [];
			$wrap.find(".santu-tally-type:checked").each(function () { selected.push($(this).val()); });
			const r = await santu_utilities.api.downloadTally($wrap.find(".santu-tally-from").val(), $wrap.find(".santu-tally-to").val(), selected);
			window.open(r.file_url, "_blank");
			frappe.show_alert({ message: `Exported ${r.count} transactions`, indicator: "green" });
		});
		load();
	},

	/* ── 9. Export Items ─────────────────────────────────────── */
	async render_export_items($wrap) {
		$wrap.html(`
			<div class="santu-utilities-card">
				<h3>Export Items</h3>
				<div class="santu-utilities-form-grid">
					<label>Item Group <input class="form-control santu-exp-group" placeholder="Optional"></label>
					<label>Brand <input class="form-control santu-exp-brand" placeholder="Optional"></label>
				</div>
				<button class="btn btn-primary santu-exp-run">Export to Excel</button>
				<div class="santu-exp-result"></div>
			</div>
		`);
		$wrap.find(".santu-exp-run").on("click", async () => {
			const filters = { item_group: $wrap.find(".santu-exp-group").val(), brand: $wrap.find(".santu-exp-brand").val() };
			$wrap.find(".santu-exp-result").html(`<div class="santu-utilities-loading">Generating…</div>`);
			const r = await santu_utilities.api.exportItems(filters);
			$wrap.find(".santu-exp-result").html(`<p>Exported <b>${r.count}</b> items. <a href="${r.file_url}" target="_blank">Download Excel</a></p>`);
		});
	},

	/* ── 10. Verify My Data ──────────────────────────────────── */
	async render_printer_settings($wrap) {
		// Printing is a daily thing, so it gets its own entry rather than
		// living four clicks into the setup wizard.
		return window.santu_render_printer_settings($wrap);
	},

	async render_verify_data($wrap) {
		$wrap.html(`<div class="santu-utilities-loading">Scanning database…</div>`);
		const r = await santu_utilities.api.getDataAudit();
		const s = r.summary;
		$wrap.html(`
			<div class="santu-utilities-summary-cards">
				<div class="summary-card valid"><b>${s.passed}</b><span>Passed</span></div>
				<div class="summary-card warning"><b>${s.warnings}</b><span>Warnings</span></div>
				<div class="summary-card error"><b>${s.errors}</b><span>Errors</span></div>
			</div>
			<h3>Data Health: ${frappe.utils.escape_html(s.health)}</h3>
			<table class="santu-utilities-table"><thead><tr><th>Category</th><th>Severity</th><th>Record</th><th>Description</th><th>Fix</th></tr></thead><tbody>
			${(r.issues || []).map((i) => `<tr class="severity-${(i.severity || "").toLowerCase()}">
				<td>${i.category}</td><td>${i.severity}</td><td>${frappe.utils.escape_html(i.record)}</td>
				<td>${frappe.utils.escape_html(i.description)}</td><td>${frappe.utils.escape_html(i.fix)}</td></tr>`).join("")}
			</tbody></table>
			<button class="btn btn-default santu-verify-refresh">Re-scan</button>
		`);
		$wrap.find(".santu-verify-refresh").on("click", () => this.render_verify_data($wrap));
	},

	/* ── 11. Close Financial Year ────────────────────────────── */
	async render_close_fy($wrap) {
		const r = await santu_utilities.api.getFyChecklist();
		const fy = r.fiscal_year || {};
		let checksHtml = (r.checks || []).map((c) =>
			`<div class="fy-check ${c.ok ? "ok" : "warn"}">${c.ok ? "✓" : "⚠"} ${frappe.utils.escape_html(c.label)} <span class="santu-utilities-muted">(${frappe.utils.escape_html(c.detail)})</span></div>`
		).join("");
		$wrap.html(`
			<div class="santu-utilities-warning">
				<b>Closing a financial year is an accounting operation and should only be performed after verification.</b>
			</div>
			<div class="santu-utilities-card">
				<h3>Current Financial Year: ${frappe.utils.escape_html(fy.name || "—")}</h3>
				${checksHtml}
			</div>
			<div class="santu-utilities-footer-bar">
				<button class="btn btn-default santu-fy-backup">Create Backup First</button>
				<button class="btn btn-primary santu-fy-close" ${r.can_close ? "" : "disabled"}>Proceed to Period Closing</button>
			</div>
		`);
		$wrap.find(".santu-fy-backup").on("click", async () => {
			frappe.show_alert({ message: "Creating backup…", indicator: "blue" });
			await santu_utilities.api.createBackup();
			frappe.show_alert({ message: "Backup created", indicator: "green" });
		});
		$wrap.find(".santu-fy-close").on("click", () => {
			frappe.confirm("Open ERPNext Period Closing Voucher?", () => frappe.set_route("List", "Period Closing Voucher"));
		});
	},
};
