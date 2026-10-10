/* global santu_utilities, frappe */
frappe.provide("santu_utilities");

santu_utilities.views = {
	async render($wrap, view, ctx) {
		$wrap.html(`<div class="santu-utilities-loading">Loading…</div>`);
		try {
			const fn = this[`render_${view}`] || this.render_import_items;
			await fn.call(this, $wrap, ctx);
		} catch (e) {
			$wrap.html(`<div class="santu-utilities-error">${frappe.utils.escape_html((e && e.message) || "Failed to load")}</div>`);
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
								<h3>Import From PDF / Photo</h3>
								<p>Supplier ki rate list — PDF ho, scan ho, ya mobile se khinchi photo. OCR khud padhta hai aur items match karta hai.</p>
							</label>
						</div>
						<div class="santu-utilities-or">OR</div>
						<label class="santu-utilities-method-card wide">
							<input type="radio" name="import_method" value="library" disabled />
							<h3>Import From Santu Hardware Library</h3>
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

	/* ── Shop Profile (Vyapar company details page) ─────────── */
	async render_shop_profile($wrap) {
		$wrap.html(`<div class="santu-shop-profile-loading">Loading…</div>`);
		const p = await frappe.xcall("santu_hardware.santu_hardware.api.get_shop_profile");
		if (!p || !p.name) {
			$wrap.html(`<div class="santu-utilities-error">No company is set for this user.</div>`);
			return;
		}

		const esc = frappe.utils.escape_html;
		const val = (k) => esc(p[k] || "");
		const states = [
			"Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
			"Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
			"Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
			"Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
			"Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim",
			"Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
		];
		const state = p.state || "Bihar";
		const state_opts = states
			.map((s) => `<option value="${esc(s)}"${s === state ? " selected" : ""}>${esc(s)}</option>`)
			.join("");
		const initials = (p.company_name || p.name || "SH")
			.split(" ")
			.map((w) => w[0])
			.join("")
			.slice(0, 2)
			.toUpperCase();
		const logo = p.company_logo
			? `<img class="santu-shop-logo-img" src="${esc(p.company_logo)}" alt="">`
			: `<span class="santu-shop-logo-initials">${esc(initials)}</span>`;

		$wrap.html(`
			<div class="santu-shop-profile">
				<div class="santu-shop-card">
					<div class="santu-shop-head">
						<div class="santu-shop-title">Shop Profile</div>
						<button type="button" class="santu-shop-save">Save</button>
					</div>
					<div class="santu-shop-body">
						<div class="santu-shop-logo-col">
							<div class="santu-shop-logo">${logo}</div>
							<button type="button" class="santu-shop-logo-btn">Add Logo</button>
							<input type="hidden" name="company_logo" value="${val("company_logo")}">
						</div>
						<div class="santu-shop-fields">
							<label class="santu-shop-field">
								<span>Business Name</span>
								<input type="text" name="company_name" value="${val("company_name")}" maxlength="140">
							</label>
							<div class="santu-shop-row">
								<label class="santu-shop-field">
									<span>Phone</span>
									<input type="text" name="phone_no" value="${val("phone_no")}" maxlength="20">
								</label>
								<label class="santu-shop-field">
									<span>Email</span>
									<input type="email" name="email" value="${val("email")}" maxlength="140">
								</label>
							</div>
							<div class="santu-shop-row">
								<label class="santu-shop-field">
									<span>GSTIN</span>
									<input type="text" name="gstin" value="${val("gstin")}" maxlength="15" style="text-transform:uppercase">
								</label>
								<label class="santu-shop-field">
									<span>Website</span>
									<input type="text" name="website" value="${val("website")}" maxlength="140">
								</label>
							</div>
							<label class="santu-shop-field">
								<span>Billing Address</span>
								<textarea name="address" rows="2">${val("address")}</textarea>
							</label>
							<div class="santu-shop-row">
								<label class="santu-shop-field">
									<span>City</span>
									<input type="text" name="city" value="${val("city")}">
								</label>
								<label class="santu-shop-field">
									<span>State</span>
									<select name="state">${state_opts}</select>
								</label>
								<label class="santu-shop-field santu-shop-field-pin">
									<span>Pincode</span>
									<input type="text" name="pincode" value="${val("pincode")}" maxlength="6">
								</label>
							</div>
						</div>
					</div>
				</div>
			</div>
		`);

		const $form = $wrap.find(".santu-shop-profile");
		const read = (name) => ($form.find(`[name="${name}"]`).val() || "").trim();

		// Shared by the Save button and the logo upload below, so a logo
		// persists the moment it is picked rather than needing a second,
		// separate Save click that nothing on screen says is still required.
		//
		// Before this, uploading a logo only swapped the on-screen preview —
		// the picture behind "Add Logo" — while the actual saved value in
		// the database never changed. Refreshing the page re-read that
		// unchanged database value and the new logo appeared to vanish
		// (2026-09-04: "logo upload nh ho rha... refresh krne se cancel ho
		// jaa raha hai"). It hadn't cancelled; it had simply never been
		// saved, and nothing on screen said a Save was still needed.
		function save_profile(overrides = {}) {
			const company_name = read("company_name");
			if (!company_name) {
				frappe.show_alert({ message: "Business Name is required", indicator: "red" });
				return Promise.reject();
			}
			const payload = {
				company: p.name,
				company_name,
				phone_no: read("phone_no"),
				email: read("email"),
				gstin: read("gstin").toUpperCase(),
				website: read("website"),
				address: read("address"),
				city: read("city"),
				state: read("state"),
				pincode: read("pincode"),
				company_logo: read("company_logo"),
				...overrides,
			};
			frappe.dom.freeze(__("Saving…"));
			return frappe
				.xcall("santu_hardware.santu_hardware.api.update_shop_profile", payload)
				.then(() => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: "Saved", indicator: "green" });
				})
				.catch((e) => {
					frappe.dom.unfreeze();
					throw e;
				});
		}

		$form.find(".santu-shop-logo-btn").on("click", () => {
			new frappe.ui.FileUploader({
				allow_multiple: false,
				restrictions: { allowed_file_types: ["image/*"] },
				on_success(file) {
					$form.find("[name=company_logo]").val(file.file_url);
					$form.find(".santu-shop-logo").html(`<img class="santu-shop-logo-img" src="${esc(file.file_url)}" alt="">`);
					// company_logo wasn't in the form's own reactive state
					// (read() pulls it straight off the hidden input, which is
					// already updated above), so no extra plumbing is needed —
					// just save right away.
					save_profile().catch(() => {
						frappe.msgprint(__("Logo select ho gaya par save nahi ho paya. Save button dabaiye."));
					});
				},
			});
		});

		$form.find(".santu-shop-save").on("click", () => {
			save_profile().catch(() => {});
		});
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
				// This used to call quickCreateItem with only {barcode, item_name},
				// but quick_create_item has always required a selling price — so the
				// button could never create anything, it only ever printed "missing 1
				// required positional argument" (pre-existing; found 2026-08-20 while
				// auditing every caller). It now asks for the name, price and opening
				// stock the item actually needs, the same three the billing screen asks.
				$results.find(".santu-create-item").on("click", () => {
					const d = new frappe.ui.Dialog({
						title: __("Naya saman jodein"),
						fields: [
							{ fieldtype: "Data", fieldname: "item_name", label: __("Saman ka naam"), default: q, reqd: 1 },
							{
								fieldtype: "Data",
								fieldname: "barcode",
								label: __("Barcode"),
								default: q,
								read_only: 1,
							},
							{ fieldtype: "Currency", fieldname: "selling_price", label: __("Bechne ka daam"), reqd: 1 },
							{
								fieldtype: "Float",
								fieldname: "opening_qty",
								label: __("Abhi kitna hai?"),
								description: __("Dukaan me abhi jitna maal hai — bharna zaroori hai."),
								reqd: 1,
							},
						],
						primary_action_label: __("Banao"),
						primary_action: async (v) => {
							try {
								const r = await santu_utilities.api.quickCreateItem({
									item_name: v.item_name,
									selling_price: v.selling_price,
									opening_qty: v.opening_qty,
									barcode: q,
								});
								d.hide();
								frappe.show_alert({ message: __("Ban gaya — {0}", [r.item_code]), indicator: "green" });
								$input.val(r.item_code).trigger("input");
							} catch (e) {
								frappe.msgprint({
									title: __("Saman nahi ban paya"),
									indicator: "red",
									message: (e && e.message) || __("Dobara koshish karein."),
								});
							}
						},
					});
					d.show();
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
				frappe.set_route("santu-stock");
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
					${is_pdf
						? `<p class="santu-utilities-muted">Text wali PDF ho ya scan/photo — dono chalti hain. Scan ho to OCR khud padh leta hai (thoda time lagta hai).</p>`
						: `<p class="santu-utilities-muted">.xlsx, .xls ya .csv. File gandi ho — columns idhar-udhar, "₹ 155", merged cells — to neeche wala button dabaiye.</p>`}
					<div class="santu-utilities-upload-zone" id="santu-item-upload"></div>
					<div class="santu-import-prompt-bar">
						<button class="btn btn-default btn-sm santu-import-prompt-btn">
							🤖 ${is_pdf ? "AI se file theek karwao" : "AI se Excel theek karwao"}
						</button>
						<span class="santu-utilities-muted">Prompt copy karke Claude/ChatGPT ko file ke saath de dijiye — wo file sahi format me bana dega.</span>
					</div>
				</div>
			`);
			$wrap.find(".santu-util-back").on("click", onBack);
			// The rules this importer actually enforces, written out as a
			// prompt the shop can hand to ANY assistant — because the app will
			// not always be driven from a Claude session (2026-09-05: "hamesa
			// to ye app claude se nh chalega naa"). Reads the uploaded file
			// when there is one, so the prompt talks about THIS sheet.
			$wrap.find(".santu-import-prompt-btn").on("click", async () => {
				const r = await frappe.xcall(
					"santu_hardware.santu_hardware.import_prompt.get_item_import_prompt",
					{ file_url: state.file_url || null }
				);
				const d = new frappe.ui.Dialog({
					title: __("Ye prompt AI ko dijiye"),
					size: "large",
					fields: [
						{
							fieldtype: "HTML",
							options: `<p style="margin-bottom:8px;color:#4b5563;">
								${r.read_file
									? __("Aapki upload ki hui file padh li gayi hai — prompt me usi ke columns aur dikkatein likhi hain.")
									: __("File pehle upload kar denge to prompt usi file ke hisaab se ban jayega.")}
							</p>`,
						},
						{ fieldtype: "Code", fieldname: "prompt", label: __("Prompt"), options: "Text", default: r.prompt },
					],
					primary_action_label: __("Copy karo"),
					primary_action: () => {
						frappe.utils.copy_to_clipboard(r.prompt);
						frappe.show_alert({ message: __("Copy ho gaya"), indicator: "green" });
						d.hide();
					},
				});
				d.show();
			});
			const uploader = new frappe.ui.FileUploader({
				wrapper: $wrap.find("#santu-item-upload")[0],
				allow_multiple: false,
				// Photos too, not just PDFs — OCR reads a phone picture of a
				// mahajan's rate card as happily as a scanned page, and that
				// picture is what the shop usually has (2026-09-05).
				restrictions: {
					allowed_file_types: is_pdf
						? [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".webp", ".tiff"]
						: [".xlsx", ".xls", ".csv"],
				},
				on_success: (file) => {
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
				// Every column matched a known field on its own (same-format
				// re-upload, e.g. Item Name/Size/MRP/SP) — skip straight to
				// the review screen instead of making the user re-pick
				// dropdowns they'd just pick the same way again.
				//
				// A pure-commentary column ("Source / Note", "Remarks") counts
				// as handled: there is no field it could map to, so leaving it
				// out of this test used to drag the operator through the Map
				// Columns screen for a dropdown whose only answer is Skip
				// (2026-09-03: a supplier's CPVC sheet with a trailing
				// "Source / Note" column lost the one-click path for that
				// reason alone).
				const ignorable = data.ignorable_headers || [];
				const all_mapped =
					data.headers.length > 0 &&
					data.headers.every((h) => !!state.mapping[h] || ignorable.includes(h));
				if (all_mapped && !state._mapping_reviewed) {
					state.step = "validate";
					this._render_excel_import($wrap, state, onBack);
					return;
				}
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
			// Everything the user needs to eyeball before items get created:
			// every row (not just the counts), what's wrong with it, and a
			// place to type how many are actually on the shelf right now —
			// their source Excel has no quantity column, so opening stock
			// has to be entered here or every item lands at zero stock
			// (2026-09-03 request: "saman list dikhna chahiye ... kitna
			// item available hai, ye v dalna padega").
			const all_rows = [...result.valid, ...result.warnings, ...result.errors].sort((a, b) => a.row - b.row);
			const error_rows = new Set((result.errors || []).map((e) => e.row));
			let rowsHtml = all_rows.map((entry) => {
				const is_error = error_rows.has(entry.row);
				const d = entry.data || {};
				const mrp = flt(d.custom_mrp);
				const sp = flt(d.standard_rate);
				// Discount % shown here is derived from MRP/SP already present
				// (from the file), not stored anywhere — typing a new % is
				// what drives SP, one-way (2026-09-03 request: "mrp - discount
				// percent then sp").
				const discount = mrp > 0 && sp > 0 ? (((mrp - sp) / mrp) * 100).toFixed(2) : "";
				return `
					<tr data-row="${entry.row}" class="${is_error ? "santu-import-row-error" : ""}">
						<td><input type="checkbox" class="santu-row-include" ${is_error ? "" : "checked"}></td>
						<td><input type="text" class="form-control input-sm santu-row-name" value="${frappe.utils.escape_html(d.item_name || "")}"></td>
						<td><input type="number" class="form-control input-sm santu-row-mrp" min="0" step="0.01" value="${d.custom_mrp || ""}"></td>
						<td><input type="number" class="form-control input-sm santu-row-discount" min="0" max="100" step="0.01" value="${discount}" placeholder="%"></td>
						<td><input type="number" class="form-control input-sm santu-row-sp" min="0" step="0.01" value="${d.standard_rate || ""}"></td>
						<td><input type="number" class="form-control input-sm santu-row-stock" min="0" value="${d.opening_stock || ""}" placeholder="0"></td>
						<td class="${is_error ? "text-danger" : entry.issues.length ? "text-warning" : "text-muted"}">${(entry.issues || []).join("; ") || "OK"}</td>
					</tr>`;
			}).join("");
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
					<label class="santu-utilities-muted" style="margin-right:6px;">Set Available Qty for all rows:</label>
					<input type="number" min="0" class="form-control input-sm santu-set-all-qty" style="width:100px;display:inline-block;" placeholder="0">
					<button class="btn btn-default btn-sm santu-apply-all-qty">Apply to All</button>
					<label class="santu-utilities-muted" style="margin:0 6px 0 16px;">Set Discount % for all rows:</label>
					<input type="number" min="0" max="100" step="0.01" class="form-control input-sm santu-set-all-discount" style="width:100px;display:inline-block;" placeholder="%">
					<button class="btn btn-default btn-sm santu-apply-all-discount">Apply to All</button>
				</div>
				<div class="santu-utilities-card">
					<div class="table-responsive">
						<table class="santu-utilities-table">
							<thead><tr>
								<th><input type="checkbox" class="santu-select-all" checked></th>
								<th>Item Name</th><th>MRP</th><th>Discount %</th><th>SP</th><th>Available Qty</th><th>Issues</th>
							</tr></thead>
							<tbody>${rowsHtml}</tbody>
						</table>
					</div>
				</div>
				<div class="santu-utilities-toolbar santu-import-summary santu-utilities-muted"></div>
				<div class="santu-utilities-toolbar">
					<button class="btn btn-primary santu-import-valid" ${c.valid || c.warnings ? "" : "disabled"}>Import Selected Rows</button>
					<button class="btn btn-default santu-download-errors" ${c.errors ? "" : "disabled"}>Download Error Report</button>
				</div>
			`);
			// Bhaiya can't read 30 rows before clicking Import — a running
			// count + stock value catches "oops wrong file" or "typed an
			// extra zero" before items actually get created, since import
			// itself can't be undone from here.
			const refresh_summary = () => {
				let count = 0, qty_total = 0, value_total = 0;
				$wrap.find("tr[data-row]").each(function () {
					const $tr = $(this);
					if (!$tr.find(".santu-row-include").is(":checked")) return;
					count += 1;
					const qty = flt($tr.find(".santu-row-stock").val());
					const sp = flt($tr.find(".santu-row-sp").val());
					qty_total += qty;
					value_total += qty * sp;
				});
				$wrap.find(".santu-import-summary").text(
					`${count} item${count === 1 ? "" : "s"} selected · ${qty_total} total qty · ₹${value_total.toFixed(2)} stock value`
				);
			};
			refresh_summary();
			$wrap.find("tbody").on("input change", "input", refresh_summary);
			$wrap.find(".santu-select-all").on("change", function () {
				$wrap.find(".santu-row-include:not(:disabled)").prop("checked", $(this).is(":checked"));
				refresh_summary();
			});
			$wrap.find(".santu-apply-all-qty").on("click", () => {
				const qty = $wrap.find(".santu-set-all-qty").val();
				if (qty === "" || qty === null) return;
				$wrap.find(".santu-row-stock").val(qty);
				refresh_summary();
			});
			$wrap.find(".santu-apply-all-discount").on("click", () => {
				const pct = $wrap.find(".santu-set-all-discount").val();
				if (pct === "" || pct === null) return;
				$wrap.find(".santu-row-discount").val(pct).trigger("input");
			});
			$wrap.find(".santu-row-discount").on("input", function () {
				const $tr = $(this).closest("tr");
				const mrp_val = flt($tr.find(".santu-row-mrp").val());
				const pct = flt($(this).val());
				if (mrp_val > 0 && $(this).val() !== "") {
					$tr.find(".santu-row-sp").val((mrp_val - (mrp_val * pct) / 100).toFixed(2));
				}
			});
			$wrap.find(".santu-row-mrp").on("input", function () {
				const $tr = $(this).closest("tr");
				const $discount = $tr.find(".santu-row-discount");
				if ($discount.val() === "") return;
				const mrp_val = flt($(this).val());
				const pct = flt($discount.val());
				if (mrp_val > 0) $tr.find(".santu-row-sp").val((mrp_val - (mrp_val * pct) / 100).toFixed(2));
			});
			$wrap.find(".santu-util-back-map").on("click", () => { state.step = "map"; state._mapping_reviewed = true; this._render_excel_import($wrap, state, onBack); });
			$wrap.find(".santu-download-errors").on("click", () => {
				const rows = [["Row", "Issues", "Item Name", "Item Code"]];
				(result.errors || []).forEach((e) => {
					rows.push([e.row, (e.issues || []).join("; "), e.data.item_name || "", e.data.item_code || ""]);
				});
				santu_utilities.utils.download_csv("import-errors.csv", rows);
			});
			$wrap.find(".santu-import-valid").on("click", async () => {
				const selected = [];
				$wrap.find("tr[data-row]").each(function () {
					const $tr = $(this);
					if (!$tr.find(".santu-row-include").is(":checked")) return;
					const row_no = parseInt($tr.data("row"), 10);
					const entry = all_rows.find((e) => e.row === row_no);
					if (!entry) return;
					const name = $tr.find(".santu-row-name").val();
					const mrp = $tr.find(".santu-row-mrp").val();
					const sp = $tr.find(".santu-row-sp").val();
					const stock = $tr.find(".santu-row-stock").val();
					selected.push({
						...entry,
						data: {
							...entry.data,
							item_name: (name || "").trim(),
							custom_mrp: mrp || "",
							standard_rate: sp || "",
							opening_stock: stock || 0,
						},
					});
				});
				if (!selected.length) return;
				frappe.confirm(`Import ${selected.length} items?`, async () => {
					const r = await santu_utilities.api.importItemsValid(selected);
					// Says both halves: a re-imported price list mostly UPDATES
					// existing items rather than adding new ones, and the shop
					// needs to see that it refreshed rates instead of silently
					// doing nothing.
					const _parts = [];
					if (r.created_count) _parts.push(`${r.created_count} naye item jude`);
					if (r.updated_count) _parts.push(`${r.updated_count} item ke rate update hue`);
					if (r.failed.length) _parts.push(`${r.failed.length} nahi ho paye`);
					frappe.msgprint(_parts.length ? _parts.join(", ") + "." : "Kuch import nahi hua.");
					state.step = "upload";
					state.method = null;
					onBack();
				});
			});
		}
	},

	/* ── 2b. Item Highlight Rules ────────────────────────────── */
	// Generic version of the old hardcoded CPVC(yellow)/UPVC(pink) rule
	// (2026-09-03 direct request: "agar mai koi v saaman ko new colour dena
	// chahu to wo ho jaye, item name start with this then ye colour apply,
	// item name include this then ye colour apply, sare colour option diye
	// ho"). Rules save to Santu Item Highlight Settings (item_highlight_api.py)
	// and take effect everywhere item rows render — Items, billing, sale/
	// purchase, reports — via santu_item_highlight.js, on the very next page
	// load (rules are read from frappe.boot, stamped once at login/reload).
	async render_item_highlight_rules($wrap) {
		// A real colour wheel, not a fixed list (2026-09-03 follow-up: "ye
		// wali colour schema ki baat kar raha tha, item colour yaha se
		// choose hoga, jo man karega mai wo choose karunga") — the browser's
		// own colour picker (native OS wheel on Mac/most browsers) via
		// `<input type="color">`. Whatever hex comes out of it is always
		// shown here as a LIGHT tint preview next to the swatch, because the
		// picker itself can return anything, including something too dark
		// for black text to read in the actual item list ("light theme
		// preferred qk agar dark hoga to item nahi dikhega list me") — the
		// preview is exactly what santu_item_highlight.js will compute at
		// runtime (santu_hl_lighten), so there's no surprise between what's
		// picked here and what shows up on Items/Billing/Reports.
		let rules = await santu_utilities.api.fetchItemHighlightRules();

		const row_html = (r) => `
			<tr>
				<td><input type="checkbox" class="santu-hl-enabled" ${r.enabled ? "checked" : ""}></td>
				<td>
					<select class="form-control input-sm santu-hl-match">
						<option value="Starts With" ${r.match_type === "Starts With" ? "selected" : ""}>Starts With</option>
						<option value="Contains" ${r.match_type !== "Starts With" ? "selected" : ""}>Contains</option>
					</select>
				</td>
				<td><input type="text" class="form-control input-sm santu-hl-value" value="${frappe.utils.escape_html(r.value || "")}" placeholder="e.g. CPVC"></td>
				<td class="santu-hl-color-cell">
					<input type="color" class="santu-hl-color" value="${r.color || "#f5d90a"}">
					<span class="santu-hl-preview" title="List me aisa dikhega" style="display:inline-block;width:20px;height:20px;border-radius:4px;border:1px solid #d1d5db;vertical-align:middle;margin-left:6px;background:${window.santu_hl_lighten ? window.santu_hl_lighten(r.color || "#f5d90a", 0.88) : (r.color || "#f5d90a")}"></span>
				</td>
				<td>
					<button class="btn btn-xs btn-default santu-hl-up" title="Priority me upar le jao">↑</button>
					<button class="btn btn-xs btn-default santu-hl-down" title="Priority me neeche le jao">↓</button>
					<button class="btn btn-xs btn-default santu-hl-remove">✕</button>
				</td>
			</tr>`;

		const render_table = () => {
			$wrap.find("tbody.santu-hl-body").html(rules.map(row_html).join(""));
		};

		$wrap.html(`
			<div class="santu-utilities-card">
				<h3>Item Colour Rules</h3>
				<p class="santu-utilities-muted">
					Jab bhi Item Name ya Item Code me ye text mile, wo item Items list, billing, sale/purchase, reports — har jagah is rang me dikhega.
					CPVC (pila) aur UPVC (gulaabi) hamesha built-in hain, sabse AAKHIR me — sirf tab lagta hai jab neeche koi bhi rule match na kare. Colour box par click karke jo bhi rang chuno, list me hamesha uska halka (light) version hi dikhega.<br>
					<b>Priority:</b> Table me sabse UPAR wala rule jeetta hai agar ek hi item do rules se match ho jaaye (jaise "SUPREME" aur "CPVC" dono ek item me hon) — ↑/↓ se order badlo.
				</p>
				<div class="table-responsive">
					<table class="santu-utilities-table">
						<thead><tr><th>On</th><th>Match</th><th>Item Name/Code Text</th><th>Colour</th><th></th></tr></thead>
						<tbody class="santu-hl-body"></tbody>
					</table>
				</div>
				<div class="santu-utilities-toolbar">
					<button class="btn btn-default btn-sm santu-hl-add">+ Add Rule</button>
					<button class="btn btn-primary santu-hl-save">Save</button>
				</div>
			</div>
		`);
		render_table();

		$wrap.find(".santu-hl-add").on("click", () => {
			rules.push({ enabled: 1, match_type: "Contains", value: "", color: "#f5d90a" });
			render_table();
		});
		$wrap.on("click", ".santu-hl-remove", function () {
			const idx = $(this).closest("tr").index();
			rules.splice(idx, 1);
			render_table();
		});
		$wrap.on("click", ".santu-hl-up", function () {
			const idx = $(this).closest("tr").index();
			if (idx <= 0) return;
			[rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
			render_table();
		});
		$wrap.on("click", ".santu-hl-down", function () {
			const idx = $(this).closest("tr").index();
			if (idx >= rules.length - 1) return;
			[rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
			render_table();
		});
		$wrap.on("input", ".santu-hl-color", function () {
			const preview = window.santu_hl_lighten ? window.santu_hl_lighten($(this).val(), 0.88) : $(this).val();
			$(this).closest("td").find(".santu-hl-preview").css("background", preview);
		});
		$wrap.find(".santu-hl-save").on("click", async () => {
			const collected = [];
			$wrap.find("tbody.santu-hl-body tr").each(function () {
				const $tr = $(this);
				const value = $tr.find(".santu-hl-value").val();
				if (!(value || "").trim()) return;
				collected.push({
					enabled: $tr.find(".santu-hl-enabled").is(":checked") ? 1 : 0,
					match_type: $tr.find(".santu-hl-match").val(),
					value: value.trim(),
					color: $tr.find(".santu-hl-color").val(),
				});
			});
			rules = await santu_utilities.api.saveItemHighlightRules(collected);
			render_table();
			frappe.show_alert({ message: "Colour rules saved. Naye rang har page reload par dikhenge.", indicator: "green" });
		});
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
		// search_by: "all" (blended name/code/hsn/brand, the old default) /
		// "name" / "brand" -- and a separate brand dropdown that narrows the
		// list to exactly one brand, usable together with a name search
		// (2026-09-07 direct request: "search by brand, search by name").
		// One combined view instead of three Daam/Stock/Item Info radio
		// modes -- switching modes used to lose the whole column layout AND
		// forced re-picking the checkbox selection state was kept, but the
		// operator still had to flip modes back and forth mid-edit to reach
		// a field in a different bucket, then flip back (2026-09-07 direct
		// request: "baar baar select karna pad raha hai, ek hi mein daam,
		// stock and item info edit karne ka option do, mere upar depend
		// karega ki main kya edit karu"). get_bulk_items already returns
		// every field regardless of `mode` (mode was accepted but never
		// read server-side) -- this only ever was a frontend column filter.
		const state = { search: "", search_by: "all", brand: "", page: 1, selected: new Set(), edits: {} };
		const PAGE_SIZE = 500;
		let brand_options = null;
		let uom_options = null;
		const render = async () => {
			// Every render fully replaces $wrap's HTML (including a "Loading…"
			// placeholder swap mid-way through), which used to drop focus out
			// of the search box on every keystroke -- typing one letter meant
			// clicking back into the box before the next one (2026-09-07 bug
			// report: "search ho jaa raha hai, phir se click krna pad rha
			// hai"). Captured here, before the first DOM wipe, and restored
			// once the final table HTML is in.
			const $prev_search = $wrap.find(".santu-bulk-search");
			const had_focus = $prev_search.length && document.activeElement === $prev_search[0];
			const caret = had_focus ? $prev_search[0].selectionStart : null;
			$wrap.html(`<div class="santu-utilities-loading">Loading items…</div>`);
			if (!brand_options) {
				brand_options = await santu_utilities.api.getBulkItemBrands();
			}
			// Unit is a dropdown, not free text -- a typo here would create a
			// UOM that doesn't exist and force_overwrite_item_unit would
			// reject it (2026-09-07: "update item in bulk se v unit change ho
			// jaye", same rule as Stock Summary and the POS tick).
			if (!uom_options) {
				uom_options = await frappe.xcall("santu_hardware.santu_hardware.api.get_uom_list");
			}
			const data = await santu_utilities.api.getBulkItems(
				"all", state.search, state.page, PAGE_SIZE,
				state.search_by === "all" ? null : state.search_by,
				state.brand || null
			);
			// Every field in one table: pricing (CP/SP/MRP), stock (godown/
			// qty, read-only -- a real Stock Reconciliation is still what
			// actually changes quantity), and item info (group/brand/HSN/
			// barcode/description/rack-shelf-bin) together.
			const cols = ["item_name", "item_group", "brand", "gst_hsn_code", "barcode",
				"valuation_rate", "standard_rate", "custom_min_selling_price", "custom_mrp",
				"warehouse", "actual_qty", "stock_uom",
				"custom_no_reward_points",
				"custom_sub_category", "custom_rack_number", "custom_shelf_number", "custom_bin_location",
				"description"];


			let html = `
				<div class="santu-utilities-toolbar">
					<select class="form-control santu-bulk-search-by" style="max-width:150px;">
						<option value="all" ${state.search_by === "all" ? "selected" : ""}>Search: All</option>
						<option value="name" ${state.search_by === "name" ? "selected" : ""}>Search by Name</option>
						<option value="brand" ${state.search_by === "brand" ? "selected" : ""}>Search by Brand</option>
					</select>
					<input class="form-control santu-bulk-search" placeholder="Search by Item Name / Code / HSN / Brand" value="${frappe.utils.escape_html(state.search)}">
					<select class="form-control santu-bulk-brand-filter" style="max-width:170px;">
						<option value="">All Brands</option>
						${(brand_options || []).map((b) => `<option value="${frappe.utils.escape_html(b)}" ${state.brand === b ? "selected" : ""}>${frappe.utils.escape_html(b)}</option>`).join("")}
					</select>
					<input type="text" class="form-control santu-bulk-scan" placeholder="📷 Scan barcode…" autocomplete="off">
					<button type="button" class="btn btn-default santu-bulk-pdf-import">📄 Import from PDF</button>
				</div>
				<div class="santu-utilities-toolbar">
					<span><b>${state.selected.size}</b> items selected</span>
					<button class="btn btn-primary santu-bulk-update" ${state.selected.size ? "" : "disabled"}>Update Selected</button>
				</div>
				<div class="santu-utilities-table-wrap"><table class="santu-utilities-table santu-bulk-table"><thead><tr>
					<th><input type="checkbox" class="santu-bulk-all"></th><th>#</th>`;
			const col_labels = { item_name: "Item Name", item_group: "Group", gst_hsn_code: "HSN", valuation_rate: "Kharid Daam (CP)", standard_rate: "Bechne ka Daam (SP)", warehouse: "Godown", actual_qty: "Stock", stock_uom: "Unit", brand: "Brand", barcode: "Barcode", description: "Description", custom_min_selling_price: "Min Selling Price", custom_mrp: "MRP", custom_sub_category: "Sub Category", custom_rack_number: "Rack Number", custom_shelf_number: "Shelf Number", custom_bin_location: "Bin Location", custom_no_reward_points: "Reward Nahi" };
			cols.forEach((c) => { html += `<th>${col_labels[c] || c.replace(/_/g, " ")}</th>`; });
			html += `</tr></thead><tbody>`;
			data.items.forEach((it, idx) => {
				const checked = state.selected.has(it.name) ? "checked" : "";
				const row_hl = santu_item_row_class(it.name, it.item_name);
				html += `<tr data-name="${frappe.utils.escape_html(it.name)}" class="${row_hl}"><td><input type="checkbox" class="santu-bulk-chk" ${checked}></td><td>${(state.page - 1) * PAGE_SIZE + idx + 1}</td>`;
				cols.forEach((c) => {
					// A field staged in state.edits (typed by hand, or filled in by
					// the barcode-scan / PDF-import actions below) always wins over
					// what's still in the database — otherwise a re-render (paging,
					// switching mode and back, another scan) would silently discard
					// an unsaved edit the moment the row scrolls out of view.
					const staged = state.edits[it.name];
					const val = (staged && staged[c] !== undefined) ? staged[c] : (it[c] ?? "");
					// A real tick-box, not a 0/1 to type -- this is the one
					// column an operator sets by eye down a filtered list
					// (2026-09-08: "reward point not applicable on item").
					if (c === "custom_no_reward_points") {
						html += `<td style="text-align:center;"><input type="checkbox" class="santu-bulk-edit santu-bulk-check" data-field="custom_no_reward_points" ${cint(val) ? "checked" : ""} style="width:16px; height:16px;"></td>`;
						return;
					}
					if (c === "stock_uom") {
						const known = (uom_options || []).some((u) => u.name === val);
						let opts = !known && val ? `<option value="${frappe.utils.escape_html(val)}" selected>${frappe.utils.escape_html(val)}</option>` : "";
						opts += (uom_options || [])
							.map((u) => `<option value="${frappe.utils.escape_html(u.name)}" ${u.name === val ? "selected" : ""}>${frappe.utils.escape_html(u.uom_name)}</option>`)
							.join("");
						html += `<td><select class="form-control input-sm santu-bulk-edit" data-field="stock_uom">${opts}</select></td>`;
						return;
					}
					const editable = ["valuation_rate", "standard_rate", "brand", "description", "gst_hsn_code", "barcode", "custom_min_selling_price", "custom_mrp", "custom_sub_category", "custom_rack_number", "custom_shelf_number", "custom_bin_location"].includes(c);
					html += editable
						? `<td><input class="form-control input-sm santu-bulk-edit" data-field="${c}" value="${frappe.utils.escape_html(String(val))}"></td>`
						: `<td>${frappe.utils.escape_html(String(val))}</td>`;
				});
				html += `</tr>`;
			});
			html += `</tbody></table></div>
				<div class="santu-utilities-pagination">
					<button class="btn btn-default btn-sm santu-page-prev" ${state.page <= 1 ? "disabled" : ""}>Prev</button>
					<span>Page ${state.page} of ${Math.ceil(data.total / PAGE_SIZE) || 1} (${data.total} items)</span>
					<button class="btn btn-default btn-sm santu-page-next" ${state.page * PAGE_SIZE >= data.total ? "disabled" : ""}>Next</button>
				</div>`;
			$wrap.html(html);
			if (had_focus) {
				const $inp = $wrap.find(".santu-bulk-search");
				if ($inp.length) {
					$inp.trigger("focus");
					try {
						$inp[0].setSelectionRange(caret, caret);
					} catch (e) {
						// setSelectionRange can throw on some input types; losing
						// the caret position is harmless, losing focus is not.
					}
				}
			}

			const debouncedSearch = santu_utilities.utils.debounce(() => {
				state.search = $wrap.find(".santu-bulk-search").val();
				state.page = 1;
				render();
			}, 400);
			$wrap.find(".santu-bulk-search").on("input", debouncedSearch);
			$wrap.find(".santu-bulk-search-by").on("change", (e) => {
				state.search_by = e.target.value;
				state.page = 1;
				render();
			});
			$wrap.find(".santu-bulk-brand-filter").on("change", (e) => {
				state.brand = e.target.value;
				state.page = 1;
				render();
			});

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
					on_success: async (file) => {
						dialog.hide();
						frappe.dom.freeze(__("Reading PDF…"));
						try {
							const result = await santu_utilities.api.matchPdfItemsForBulkUpdate(file.file_url);
							result.matched.forEach((m) => {
								state.selected.add(m.item_code);
								if (!state.edits[m.item_code]) state.edits[m.item_code] = {};
								if (m.rate != null) state.edits[m.item_code].valuation_rate = m.rate;
							});
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
				// .val() on a checkbox is the literal string "on" whether it is
				// ticked or not -- read the tick itself.
				const $f = $(this);
				state.edits[name][$f.data("field")] = $f.is(":checkbox") ? ($f.is(":checked") ? 1 : 0) : $f.val();
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
			on_success: async (file) => {
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
			let html = `
				<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
					<span class="badge" style="background:#059669;color:#fff;font-weight:600;padding:4px 10px;border-radius:6px;">🔒 Admin Sole Access</span>
					<span class="santu-utilities-muted">${frappe.utils.escape_html(r.note || "")}</span>
				</div>
				<table class="santu-utilities-table">
					<thead>
						<tr>
							<th>Sales Person</th>
							<th>Access & Permissions</th>
							<th>Total Sales</th>
							<th>Invoices</th>
							<th>Collection</th>
							<th>Outstanding</th>
						</tr>
					</thead>
					<tbody>`;
			(r.rows || []).forEach((row) => {
				html += `
					<tr>
						<td><b>${frappe.utils.escape_html(row.salesman)}</b></td>
						<td><span class="badge" style="background:#dbeafe;color:#1e40af;font-weight:600;padding:2px 8px;border-radius:4px;">${frappe.utils.escape_html(row.rights || "Full Rights")}</span></td>
						<td><b>${santu_utilities.utils.format_currency(row.total_sales)}</b></td>
						<td>${row.invoice_count}</td>
						<td>${santu_utilities.utils.format_currency(row.collection)}</td>
						<td>${santu_utilities.utils.format_currency(row.outstanding)}</td>
					</tr>`;
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
				<button class="btn btn-danger santu-tally-export-xml" title="Download TallyPrime / ERP9 XML format"><span style="margin-right:4px;">📥</span> Export To Tally (XML)</button>
				<button class="btn btn-default santu-tally-export-xlsx" title="Download Excel format"><span style="margin-right:4px;">📗</span> Export To Excel</button>
			</div>
			<div class="santu-tally-type-filters">TRANSACTIONS: ${types.map((t) => `<label><input type="checkbox" class="santu-tally-type" value="${t}" checked> ${t}</label>`).join(" ")}</div>
			<div class="santu-tally-table-wrap"></div>
		`);
		const load = async () => {
			const selected = [];
			$wrap.find(".santu-tally-type:checked").each(function () { selected.push($(this).val()); });
			$wrap.find(".santu-tally-table-wrap").html(`<div class="santu-utilities-loading">Loading…</div>`);
			const r = await santu_utilities.api.getTallyData($wrap.find(".santu-tally-from").val(), $wrap.find(".santu-tally-to").val(), selected);
			let total_sum = 0;
			let html = `
				<div style="margin-bottom:10px;display:flex;gap:12px;align-items:center;">
					<span class="badge" style="background:#059669;color:#fff;padding:5px 12px;font-size:13px;border-radius:6px;">Total Records: ${r.count}</span>
				</div>
				<table class="santu-utilities-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Invoice No</th>
							<th>Party</th>
							<th>Type</th>
							<th>Payment</th>
							<th>Amount</th>
							<th>Balance</th>
						</tr>
					</thead>
					<tbody>`;
			(r.transactions || []).forEach((row) => {
				total_sum += (Number(row.amount) || 0);
				html += `<tr>
					<td>${row.date}</td>
					<td><b>${frappe.utils.escape_html(row.invoice_no)}</b></td>
					<td>${frappe.utils.escape_html(row.party)}</td>
					<td><span class="badge" style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:4px;">${row.type}</span></td>
					<td>${row.payment_type}</td>
					<td><b>${santu_utilities.utils.format_currency(row.amount)}</b></td>
					<td>${santu_utilities.utils.format_currency(row.balance)}</td>
				</tr>`;
			});
			html += `</tbody></table>`;
			$wrap.find(".santu-tally-table-wrap").html(html);
		};
		$wrap.find(".santu-tally-load").on("click", load);
		$wrap.find(".santu-tally-type").on("change", load);

		$wrap.find(".santu-tally-export-xml").on("click", async () => {
			const selected = [];
			$wrap.find(".santu-tally-type:checked").each(function () { selected.push($(this).val()); });
			frappe.dom.freeze(__("Generating Tally XML…"));
			try {
				const r = await santu_utilities.api.downloadTally($wrap.find(".santu-tally-from").val(), $wrap.find(".santu-tally-to").val(), selected, "xml");
				frappe.dom.unfreeze();
				window.open(r.file_url, "_blank");
				frappe.show_alert({ message: `Exported ${r.count} transactions to Tally XML`, indicator: "green" });
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint(__("Failed to generate Tally XML: ") + ((e && e.message) || String(e)));
			}
		});

		$wrap.find(".santu-tally-export-xlsx").on("click", async () => {
			const selected = [];
			$wrap.find(".santu-tally-type:checked").each(function () { selected.push($(this).val()); });
			frappe.dom.freeze(__("Generating Excel Export…"));
			try {
				const r = await santu_utilities.api.downloadTally($wrap.find(".santu-tally-from").val(), $wrap.find(".santu-tally-to").val(), selected, "xlsx");
				frappe.dom.unfreeze();
				window.open(r.file_url, "_blank");
				frappe.show_alert({ message: `Exported ${r.count} transactions to Excel`, indicator: "green" });
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint(__("Failed to generate Excel: ") + ((e && e.message) || String(e)));
			}
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

	/* ── Invoice Settings (2026-08-19 direct request) ─────────
	   UPI ID had a real backend field (Santu POS Settings.upi_id, used by
	   the "Scan & Pay" QR on every printed bill) but no screen anywhere in
	   the app to change it — the only way was the raw Frappe doctype form.
	   This is that home; more bill-content settings (as opposed to printer
	   hardware settings, which stay in Printer Settings above) belong here
	   going forward rather than each getting a one-off screen. */
	async render_invoice_settings($wrap) {
		$wrap.html(`<div class="santu-utilities-loading">Loading…</div>`);
		let settings;
		try {
			settings = await frappe.db.get_doc("Santu POS Settings", "Santu POS Settings");
		} catch (e) {
			$wrap.html(`<div class="santu-utilities-error">Could not load settings: ${frappe.utils.escape_html((e && e.message) || String(e))}</div>`);
			return;
		}
		const esc = frappe.utils.escape_html;

		$wrap.html(`
			<div class="santu-shop-profile">
				<div class="santu-shop-card">
					<div class="santu-shop-head">
						<div class="santu-shop-title">Invoice Settings</div>
						<button type="button" class="santu-shop-save">Save</button>
					</div>
					<div class="santu-shop-body">
						<div class="santu-shop-fields">
							<label class="santu-shop-field">
								<span>UPI ID (for "Scan &amp; Pay" QR on printed bills)</span>
								<input type="text" class="santu-inv-upi" value="${esc(settings.upi_id || "")}" placeholder="e.g. shopname@okhdfcbank" autocomplete="off">
							</label>
						</div>
					</div>
				</div>
				<div class="santu-inv-library-wrap"></div>
			</div>
		`);

		$wrap.find(".santu-shop-save").on("click", () => {
			const upi_id = ($wrap.find(".santu-inv-upi").val() || "").trim();
			frappe.dom.freeze(__("Saving…"));
			frappe.db
				.set_value("Santu POS Settings", "Santu POS Settings", "upi_id", upi_id)
				.then(() => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("Saved"), indicator: "green" });
				})
				.catch(() => frappe.dom.unfreeze());
		});

		// Thermal Invoice Library + WhatsApp/A4 Library moved here from Printer
		// Settings (2026-08-29 direct request) -- which layout a bill prints as
		// is bill CONTENT, not printer hardware, so it belongs next to UPI ID
		// rather than next to the printer/density settings.
		window.santu_render_invoice_library($wrap.find(".santu-inv-library-wrap"));
	},

	async render_verify_data($wrap) {
		const render = async () => {
			$wrap.html(`<div class="santu-shop-profile-loading">Scanning Database Health…</div>`);
			const r = await santu_utilities.api.getDataAudit();
			const s = r.summary;
			const neg = await frappe
				.xcall("santu_hardware.santu_hardware.utilities_api.get_negative_stock")
				.catch(() => ({ rows: [], count: 0 }));
			
			const issues_html = (r.issues && r.issues.length) ? `
				<div class="santu-verify-issues">
					<table class="santu-verify-table">
						<thead>
							<tr>
								<th>Category</th>
								<th>Severity</th>
								<th>Record</th>
								<th>Description</th>
								<th>Suggested Fix</th>
							</tr>
						</thead>
						<tbody>
							${r.issues.map(i => `
								<tr class="severity-${(i.severity || "").toLowerCase()}">
									<td><span class="verify-badge">${frappe.utils.escape_html(i.category)}</span></td>
									<td>
										<span class="verify-severity-badge severity-${(i.severity || "").toLowerCase()}">
											${i.severity === 'Error' ? '❌' : '⚠️'} ${frappe.utils.escape_html(i.severity)}
										</span>
									</td>
									<td class="verify-record">${frappe.utils.escape_html(i.record)}</td>
									<td class="verify-desc">${frappe.utils.escape_html(i.description)}</td>
									<td class="verify-fix">${frappe.utils.escape_html(i.fix)}</td>
								</tr>
							`).join("")}
						</tbody>
					</table>
				</div>
			` : `
				<div class="santu-verify-perfect">
					<div class="verify-perfect-icon">🎉</div>
					<h3>Your Data is Perfect!</h3>
					<p>No errors or warnings found in the database. Everything is running smoothly.</p>
				</div>
			`;

			$wrap.html(`
				<div class="santu-pm-container">
					<div class="santu-pm-card">
						<div class="santu-pm-head verify-head">
							<div class="santu-pm-title">
								<h2>Database Health Check</h2>
								<p>Scan your data for inconsistencies, missing links, or errors.</p>
							</div>
							<div class="verify-health-score">
								<span class="health-label">System Health</span>
								<span class="health-value ${s.errors > 0 ? 'bad' : s.warnings > 0 ? 'warn' : 'good'}">
									${frappe.utils.escape_html(s.health)}
								</span>
							</div>
						</div>
						
						<div class="santu-pm-body">
							<div class="santu-verify-grid">
								<div class="verify-stat-card good">
									<div class="stat-icon">✅</div>
									<div class="stat-info">
										<h3>${s.passed}</h3>
										<p>Checks Passed</p>
									</div>
								</div>
								<div class="verify-stat-card warn">
									<div class="stat-icon">⚠️</div>
									<div class="stat-info">
										<h3>${s.warnings}</h3>
										<p>Warnings</p>
									</div>
								</div>
								<div class="verify-stat-card bad">
									<div class="stat-icon">❌</div>
									<div class="stat-info">
										<h3>${s.errors}</h3>
										<p>Errors Found</p>
									</div>
								</div>
							</div>
							
							${issues_html}
						</div>

						${neg.count ? `
						<div class="santu-verify-negfix">
							<div class="santu-verify-negfix-text">
								<b>${neg.count} ${__("item ka stock minus me hai")}</b>
								<p>${__("Jo maal bech diya par bill nahi chadha, wo minus dikhata hai. Neeche daba kar sabko 0 kar dijiye — ye ek Stock Reconciliation banata hai, jise baad me dekha ya hataya ja sakta hai.")}</p>
								<div class="santu-verify-neglist">${neg.rows
									.slice(0, 12)
									.map(
										(n) =>
											`<span>${frappe.utils.escape_html(n.item_name || n.item_code)}: <b>${n.actual_qty}</b></span>`
									)
									.join("")}${neg.rows.length > 12 ? `<span>+${neg.rows.length - 12} aur…</span>` : ""}</div>
							</div>
							<button class="btn btn-warning santu-verify-fixneg">${__("Sabka stock 0 kar do")}</button>
						</div>` : ""}

						<div class="santu-pm-footer" style="display:flex; justify-content: flex-end;">
							<button class="btn btn-primary santu-verify-refresh" style="display:flex; gap:8px; align-items:center;">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-5.67"/></svg>
								Re-scan Database
							</button>
						</div>
					</div>
				</div>
			`);
			
			$wrap.find(".santu-verify-refresh").on("click", render);
			$wrap.find(".santu-verify-fixneg").on("click", () => {
				frappe.confirm(
					__("{0} item ka stock 0 kar diya jayega. Aage badhein?", [neg.count]),
					async () => {
						frappe.dom.freeze(__("Stock theek kiya ja raha hai…"));
						try {
							const res = await frappe.xcall(
								"santu_hardware.santu_hardware.utilities_api.fix_negative_stock"
							);
							frappe.dom.unfreeze();
							frappe.msgprint({
								title: __("Ho gaya"),
								message: res.entry
									? __("{0} item ka stock 0 kar diya. Entry: {1}", [res.fixed, res.entry])
									: res.message,
								indicator: "green",
							});
							render();
						} catch (e) {
							frappe.dom.unfreeze();
							frappe.msgprint((e && e.message) || __("Stock theek nahi ho paya"));
						}
					}
				);
			});
		};
		render();
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
				<b>${__("Yeh screen saal ke ant ki jaanch-list hai. Yahan se kuch mitta nahi hai.")}</b>
				<p>${__("Grahak ka baaki, mahajan ka baaki, stock aur purane bill — sab waise ke waise rehte hain aur agle saal chalte rehte hain. Neeche sirf ye dikhta hai ki saal band karne se pehle kya theek karna baaki hai.")}</p>
			</div>
			<div class="santu-utilities-card">
				<h3>Current Financial Year: ${frappe.utils.escape_html(fy.name || "—")}</h3>
				${checksHtml}
			</div>
			<div class="santu-utilities-footer-bar">
				<button class="btn btn-default santu-fy-backup">Create Backup First</button>
				<button class="btn btn-primary santu-fy-close" ${r.can_close ? "" : "disabled"}>${__("Aage kya karna hai")}</button>
			</div>
		`);
		$wrap.find(".santu-fy-backup").on("click", async () => {
			frappe.show_alert({ message: "Creating backup…", indicator: "blue" });
			await santu_utilities.api.createBackup();
			frappe.show_alert({ message: "Backup created", indicator: "green" });
		});
		// This button used to ask "This will close the financial year in your
		// books. Continue?" and then do NOTHING but show a note -- it closed
		// nothing, and the question implied it had (2026-10-02). It now says
		// plainly what this screen is and is not.
		$wrap.find(".santu-fy-close").on("click", () => {
			frappe.msgprint({
				title: __("Saal band karna"),
				message: __(
					"Yahan se koi khata band ya saaf nahi hota — na grahak ka baaki, na mahajan ka, na stock. Sab agle saal chalta rehta hai.<br><br>Saal band karne ka asli kaam (Period Closing Voucher) accountant karte hain. Upar wali list theek ho jaane ke baad unhe bula lijiye, aur pehle <b>Backup</b> zaroor le lijiye."
				),
				indicator: "blue",
			});
		});
	},

	/* ── 12. Bug Report ──────────────────────────────────────── */
	async render_bug_report($wrap) {
		const render = async () => {
			const recentRaw = await frappe.xcall(
				"santu_hardware.santu_hardware.bug_report_service.get_recent_bugs",
				{ limit: 20 }
			).catch(() => []);

			const esc = frappe.utils.escape_html;
			const rows = (recentRaw || []).map((r) => `
				<tr>
					<td>${esc(r.title || "")}</td>
					<td>${esc(r.creation ? r.creation.slice(0, 16) : "")}</td>
					<td><span class="santu-bug-status santu-bug-status-${esc((r.status || "new").toLowerCase())}">${esc(r.status || "New")}</span></td>
				</tr>`).join("");

			$wrap.html(`
				<div class="santu-utilities-card santu-bug-report-card">
					<h2 class="santu-utilities-subtitle">Kya problem aayi? Batao humein</h2>
					<p class="santu-utilities-muted" style="margin-bottom:12px">
						Yahan type karo ya mic se bolo — Ankit dekh lenge.
					</p>
					<div class="santu-bug-input-row">
						<textarea class="form-control santu-bug-textarea" rows="4" placeholder="Kya hua? Kaunsa screen tha? Kya kiya tha?"></textarea>
						<button type="button" class="btn santu-bug-mic" title="Mic se bolo">🎙️</button>
					</div>
					<div class="santu-utilities-footer-bar" style="margin-top:10px">
						<button type="button" class="btn btn-primary santu-bug-submit">Bhejo</button>
					</div>
				</div>
				${rows ? `
				<div class="santu-utilities-card" style="margin-top:16px">
					<h3 class="santu-utilities-subtitle" style="margin-bottom:8px">Haal ke reports</h3>
					<div class="santu-utilities-table-wrap">
						<table class="santu-utilities-table">
							<thead><tr><th>Kya hua</th><th>Kab</th><th>Status</th></tr></thead>
							<tbody>${rows}</tbody>
						</table>
					</div>
				</div>` : ""}
			`);

			// Web Speech API mic button
			const $mic = $wrap.find(".santu-bug-mic");
			const $ta = $wrap.find(".santu-bug-textarea");
			let recognition = null;
			let is_listening = false;
			let initialText = "";

			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

			if (SpeechRecognition) {
				const startListening = () => {
					if (recognition) {
						try { recognition.stop(); } catch(e) {}
					}

					recognition = new SpeechRecognition();
					recognition.continuous = true;
					recognition.interimResults = true;
					recognition.lang = "hi-IN";

					initialText = $ta.val() ? $ta.val().trim() + " " : "";

					recognition.onstart = () => {
						is_listening = true;
						$mic.addClass("is-listening").html("⏹️").attr("title", "Listening… Click to Stop");
						$wrap.find(".santu-bug-status-text").remove();
						$wrap.find(".santu-bug-input-row").after(`
							<div class="santu-bug-status-text" style="font-size:12px; font-weight:600; color:#ef4444; margin:4px 0 8px;">
								🔴 Sun rahe hain… Boliye kya dikkat aayi (bolte hi yahan type hota jayega)
							</div>
						`);
					};

					recognition.onresult = (event) => {
						let interimTranscript = '';
						let finalTranscript = '';

						for (let i = event.resultIndex; i < event.results.length; ++i) {
							if (event.results[i].isFinal) {
								finalTranscript += event.results[i][0].transcript;
							} else {
								interimTranscript += event.results[i][0].transcript;
							}
						}

						const spoken = finalTranscript || interimTranscript;
						if (spoken) {
							$ta.val(initialText + spoken);
						}
					};

					recognition.onerror = (event) => {
						console.warn("Bug Report Voice recognition error:", event.error);
						is_listening = false;
						$mic.removeClass("is-listening").html("🎙️").attr("title", "Mic se bolo");
						$wrap.find(".santu-bug-status-text").html(`
							<span style="color:#ef4444; font-size:12px;">Mic error: ${event.error}. Mic button dobara dabakar try karein.</span>
						`);
					};

					recognition.onend = () => {
						is_listening = false;
						$mic.removeClass("is-listening").html("🎙️").attr("title", "Mic se bolo");
						$wrap.find(".santu-bug-status-text").fadeOut(2000, function() { $(this).remove(); });
					};

					try {
						recognition.start();
					} catch(err) {
						console.error("SpeechRecognition start error:", err);
					}
				};

				const stopListening = () => {
					if (recognition) {
						try { recognition.stop(); } catch(e) {}
					}
					is_listening = false;
					$mic.removeClass("is-listening").html("🎙️").attr("title", "Mic se bolo");
				};

				$mic.on("click", () => {
					if (is_listening) {
						stopListening();
					} else {
						startListening();
					}
				});
			} else {
				$mic.prop("disabled", true).attr("title", "Is browser mein mic support nahi hai").css("opacity", 0.4);
			}

			$wrap.find(".santu-bug-submit").on("click", async () => {
				const text = ($ta.val() || "").trim();
				if (!text) { frappe.show_alert({ message: "Kuch likhna padega ya bolna padega pehle.", indicator: "orange" }); return; }
				const btn = $wrap.find(".santu-bug-submit").prop("disabled", true).text("Bhej rahe hain…");
				try {
					await frappe.xcall(
						"santu_hardware.santu_hardware.bug_report_service.report_bug_from_user",
						{ what_happened: text, route: frappe.get_route_str() }
					);
					$ta.val("");
					frappe.show_alert({ message: "Report bhej di! Ankit dekh lenge.", indicator: "green" });
					await render();
				} catch (e) {
					frappe.show_alert({ message: "Bhej nahi paye — dobara try karo.", indicator: "red" });
				} finally {
					btn.prop("disabled", false).text("Bhejo");
				}
			});
		};
		await render();
	},

	async render_payment_modes($wrap) {
		const esc = frappe.utils.escape_html;
		const render = async () => {
			$wrap.html(`<div class="santu-shop-profile-loading">Loading Payment Modes…</div>`);
			const rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_payment_modes");
			
			$wrap.html(`
				<div class="santu-pm-container">
					<div class="santu-pm-card">
						<div class="santu-pm-head">
							<div class="santu-pm-title">
								<h2>Payment Modes</h2>
								<p>Manage the ways you accept payments from customers.</p>
							</div>
						</div>
						
						<div class="santu-pm-body">
							<div class="santu-pm-list-modern">
								${rows.map(r => `
									<div class="santu-pm-row-modern ${r.enabled ? 'is-enabled' : ''}">
										<div class="santu-pm-info">
											<div class="santu-pm-icon">${r.name === 'Cash' ? '💵' : r.name === 'UPI' ? '📱' : r.name.toLowerCase().includes('bank') ? '🏦' : '💳'}</div>
											<div class="santu-pm-details">
												<h4>${esc(r.name)}</h4>
												<span class="santu-pm-status ${r.ready ? 'ok' : 'warn'}">
													${r.ready ? '✅ Setup Ready' : '⚠️ Missing Account setup'}
												</span>
											</div>
										</div>
										<label class="santu-pm-switch">
											<input type="checkbox" data-mode="${esc(r.name)}" ${r.enabled ? "checked" : ""}>
											<span class="santu-pm-slider"></span>
										</label>
									</div>
								`).join("")}
							</div>
						</div>

						<div class="santu-pm-footer">
							<h4>Add Custom Payment Mode</h4>
							<div class="santu-pm-add-form">
								<input type="text" class="santu-pm-new-name" placeholder="E.g. Paytm Wallet, PhonePe..." maxlength="50">
								<select class="santu-pm-new-type">
									<option value="Bank">Bank / Online</option>
									<option value="Cash">Cash</option>
								</select>
								<button type="button" class="santu-pm-add-btn">Add Mode</button>
							</div>
						</div>
					</div>
				</div>
			`);

			$wrap.find(".santu-pm-switch input").on("change", async function() {
				const mode = $(this).data("mode");
				const enabled = this.checked ? 1 : 0;
				$(this).closest(".santu-pm-row-modern").toggleClass("is-enabled", enabled);
				await frappe.xcall("santu_hardware.santu_hardware.api.set_payment_mode_enabled", { mode, enabled });
				frappe.show_alert({ message: "Saved", indicator: "green" });
			});

			$wrap.find(".santu-pm-add-btn").on("click", async () => {
				const mode_name = $wrap.find(".santu-pm-new-name").val().trim();
				if (!mode_name) return;
				const mode_type = $wrap.find(".santu-pm-new-type").val();
				
				frappe.dom.freeze("Adding…");
				try {
					await frappe.xcall("santu_hardware.santu_hardware.api.create_payment_mode", { mode_name, mode_type });
					frappe.show_alert({ message: "Added Successfully", indicator: "green" });
					render();
				} catch (e) {
					// standard error handler
				} finally {
					frappe.dom.unfreeze();
				}
			});
		};
		render();
	},

	/* ── Loyalty Points ─────────────────────────────────────── */
	// Back on (2026-09-06 direct request: "utility me loyality wala add kr
	// de, sara system... conversion ratio v daal dena jo mai change kr
	// saku in rs"). Points were being earned this whole time — ERPNext
	// earns them on every sale once a customer has a loyalty programme,
	// independent of any screen existing to show them — this is the first
	// place that ever showed the shop what had quietly built up, and the
	// only place the ratio can be changed from.
	async render_loyalty_points($wrap) {
		const esc = frappe.utils.escape_html;
		const money = (v) => "₹ " + frappe.utils.escape_html(format_number(v || 0, null, 2));
		let cust_search = "";
		const render = async () => {
			$wrap.html(`<div class="santu-shop-profile-loading">Loading…</div>`);
			const [s, customers] = await Promise.all([
				frappe.xcall("santu_hardware.santu_hardware.api.get_loyalty_settings"),
				frappe.xcall("santu_hardware.santu_hardware.api.get_loyalty_customers", { search: cust_search || null }),
			]);
			const today_str = frappe.datetime.get_today();
			const days_left = (d) => d ? frappe.datetime.get_day_diff(d, today_str) : null;
			const expiry_html = (d) => {
				if (!d) return `<span style="color:#9ca3af;">—</span>`;
				const dl = days_left(d);
				const label = frappe.datetime.str_to_user(d);
				if (dl <= 7) return `<span style="color:#dc2626; font-weight:600;">${esc(label)} (${dl}d)</span>`;
				if (dl <= 30) return `<span style="color:#d97706;">${esc(label)} (${dl}d)</span>`;
				return `<span style="color:#374151;">${esc(label)}</span>`;
			};

			$wrap.html(`
				<div class="santu-pm-container santu-loyalty-container">
					<div class="santu-utilities-summary-cards">
						<div class="summary-card"><b>${s.customers_with_balance}</b><span>Customers With Points</span></div>
						<div class="summary-card"><b>${format_number(s.outstanding_points, null, 0)}</b><span>Points Outstanding</span></div>
						<div class="summary-card valid"><b>${money(s.outstanding_value)}</b><span>Worth If All Redeemed Today</span></div>
						<div class="summary-card"><b>${money(s.redeemed_value)}</b><span>Redeemed So Far</span></div>
					</div>

					<div class="santu-shop-card">
						<div class="santu-shop-head">
							<div class="santu-shop-title">Loyalty Points</div>
							<button type="button" class="santu-shop-save">Save</button>
						</div>
						<div class="santu-shop-body" style="display:block;">
							<label class="santu-pm-check-row" style="display:flex; align-items:center; gap:10px; margin-bottom:18px;">
								<input type="checkbox" class="santu-loyalty-enabled" ${s.enabled ? "checked" : ""} style="width:18px; height:18px;">
								<span>
									<b>Reward points chalu hain</b><br>
									<span style="font-size:12px; color:#6b7280;">
										Off karne se pehle se jama points kabhi nahi mitte — sirf counter par use karna band ho jaata hai. Points earn karna ERPNext ka apna kaam hai, is switch se nahi rukta.
									</span>
								</span>
							</label>

							<div class="santu-shop-row">
								<label class="santu-shop-field">
									<span>Rs Spent Per Point</span>
									<input type="number" min="1" step="any" class="santu-loyalty-spend" value="${esc(s.spend_per_point)}">
									<span style="font-size:11.5px; color:#6b7280; margin-top:2px;">Rs ${esc(s.spend_per_point)} ka bill = 1 point</span>
								</label>
								<label class="santu-shop-field">
									<span>1 Point = Rs</span>
									<input type="number" min="0" step="any" class="santu-loyalty-value" value="${esc(s.point_value)}">
									<span style="font-size:11.5px; color:#6b7280; margin-top:2px;">1 point use karne par Rs ${esc(s.point_value)} ki chhoot</span>
								</label>
							</div>
							<div class="santu-shop-row">
								<label class="santu-shop-field">
									<span>Points Expire After (Months)</span>
									<input type="number" min="1" step="1" class="santu-loyalty-expiry" value="${esc(s.expiry_months)}">
								</label>
							</div>
						</div>
					</div>

					<div class="santu-pm-card" style="margin-top:16px;">
						<div class="santu-pm-head">
							<div class="santu-pm-title">
								<h2>Customer-wise Points</h2>
								<p>Kis customer ke paas kitne points hain, aur kab expire ho rahe hain — sirf wahi jinke paas abhi kuch dikhane laayak hai.</p>
							</div>
						</div>
						<div class="santu-pm-body" style="padding: 12px 20px 20px;">
							<input type="text" class="form-control santu-loyalty-cust-search" placeholder="Naam ya phone se dhundo…" value="${esc(cust_search)}" style="max-width:280px; margin-bottom:14px;">
							${!customers.length
								? `<div style="color:#9ca3af; font-size:13px; padding:12px 0;">${cust_search ? "Koi match nahi mila." : "Abhi kisi customer ke paas active ya pending points nahi hain."}</div>`
								: `<div class="santu-utilities-table-wrap"><table class="santu-utilities-table">
									<thead><tr>
										<th>Customer</th><th>Phone</th><th>Points</th><th>Value</th><th>Expire Kab</th><th>Pending</th>
									</tr></thead>
									<tbody>
										${customers.map((c) => `
											<tr>
												<td>${esc(c.customer_name)}</td>
												<td>${esc(c.mobile_no || "—")}</td>
												<td><b>${format_number(c.points, null, 2)}</b></td>
												<td>${money(c.value)}</td>
												<td>${expiry_html(c.nearest_expiry)}</td>
												<td>${c.pending_points
													? `<span style="color:#d97706;">${format_number(c.pending_points, null, 2)} pending${c.pending_deadline ? ` (by ${esc(frappe.datetime.str_to_user(c.pending_deadline))})` : ""}</span>`
													: `<span style="color:#9ca3af;">—</span>`
												}</td>
											</tr>
										`).join("")}
									</tbody>
								</table></div>`
							}
						</div>
					</div>

					<div class="santu-pm-card" style="margin-top:16px;">
						<div class="santu-pm-head">
							<div class="santu-pm-title">
								<h2>Kaam Kaise Karta Hai</h2>
							</div>
						</div>
						<div class="santu-pm-body" style="padding: 4px 20px 20px;">
							<ul style="margin:0; padding-left: 18px; font-size:13px; color:#4b5563; line-height:1.8;">
								<li>Har sale par grahak ke points apne aap jud jaate hain — kuch alag se dabana nahi padta.</li>
								<li>Billing screen par grahak chunne ke baad <b>More &rarr; Reward Points [F10]</b> se points use ho sakte hain.</li>
								<li>Points ki value seedha bill ke payable amount se minus hoti hai — grand total wahi rehta hai jo bika, sirf jitna cash lena hai wo kam ho jaata hai.</li>
								<li>Ratio badalne se pehle se jama points ki ginti nahi badalti, sirf naye bill par nayi ginti aur redeem karne pe nayi value lagti hai.</li>
							</ul>
						</div>
					</div>
				</div>
			`);

			// Refocus + restore the caret after render() replaces the DOM, same
			// fix Update Items In Bulk needed (2026-09-07: typing lost focus on
			// every keystroke because the whole table gets rebuilt on input).
			$wrap.find(".santu-loyalty-cust-search").on("input", frappe.utils.debounce((e) => {
				cust_search = e.target.value;
				const caret = e.target.selectionStart;
				render().then(() => {
					const $again = $wrap.find(".santu-loyalty-cust-search");
					$again.focus();
					try { $again[0].setSelectionRange(caret, caret); } catch (err) {}
				});
			}, 300));

			$wrap.find(".santu-shop-save").on("click", async () => {
				const enabled = $wrap.find(".santu-loyalty-enabled").is(":checked") ? 1 : 0;
				const spend_per_point = flt($wrap.find(".santu-loyalty-spend").val());
				const point_value = flt($wrap.find(".santu-loyalty-value").val());
				const expiry_months = cint($wrap.find(".santu-loyalty-expiry").val());
				frappe.dom.freeze(__("Saving…"));
				try {
					await frappe.xcall("santu_hardware.santu_hardware.api.update_loyalty_settings", {
						enabled, spend_per_point, point_value, expiry_months,
					});
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("Saved"), indicator: "green" });
					render();
				} catch (e) {
					frappe.dom.unfreeze();
				}
			});
		};
		render();
	},

	async render_cost_price_lock($wrap) {
		const render = async () => {
			$wrap.html(`<div class="santu-shop-profile-loading">Checking Privacy Status…</div>`);
			const [s, al] = await Promise.all([window.santu_privacy.status(), window.santu_app_lock.status()]);
			
			$wrap.html(`
				<div class="santu-pm-container">
					<div class="santu-pm-card">
						<div class="santu-pm-head">
							<div class="santu-pm-title">
								<h2>Cost Price Lock</h2>
								<p>Cost price is hidden on the billing screen so customers cannot see your margins. Manage security here.</p>
							</div>
						</div>
						
						<div class="santu-pm-body">
							<div class="santu-pm-list-modern">
								<div class="santu-pm-row-modern ${s.pin_set ? 'is-enabled' : ''}">
									<div class="santu-pm-info">
										<div class="santu-pm-icon">🔒</div>
										<div class="santu-pm-details">
											<h4>Security PIN</h4>
											<span class="santu-pm-status ${s.pin_set ? 'ok' : 'warn'}">
												${s.pin_set ? '✅ PIN is Set' : '⚠️ Not Set Up'}
											</span>
										</div>
									</div>
									<button class="btn ${s.pin_set ? 'btn-default' : 'btn-primary'} btn-sm santu-privacy-set-pin">
										${s.pin_set ? 'Change PIN' : 'Set PIN'}
									</button>
								</div>

								<div class="santu-pm-row-modern ${s.touch_id_devices ? 'is-enabled' : ''}">
									<div class="santu-pm-info">
										<div class="santu-pm-icon">👆</div>
										<div class="santu-pm-details">
											<h4>Fingerprint (Touch ID)</h4>
											<span class="santu-pm-status ${s.touch_id_devices ? 'ok' : 'warn'}">
												${s.touch_id_devices ? `✅ ${s.touch_id_devices} device(s) active` : '⚠️ Not Set Up'}
											</span>
										</div>
									</div>
									<button class="btn btn-default btn-sm santu-privacy-add-touch" ${s.pin_set ? '' : 'disabled'}>
										Add this Mac
									</button>
								</div>
								
								${!s.pin_set ? '<div style="margin-top:10px; color:#f59e0b; font-size:13px; font-weight:500;">Note: Set a PIN first — the fingerprint is a shortcut for it.</div>' : ''}
							</div>
						</div>
					</div>

					<div class="santu-pm-card" style="margin-top:16px;">
						<div class="santu-pm-head">
							<div class="santu-pm-title">
								<h2>App Login PIN</h2>
								<p>App khulte hi ye PIN maanga jayega, jab tak sahi PIN na daalo tab tak kuch nazar nahi aayega — dukaan ke computer ko lock rakhne ke liye.</p>
							</div>
						</div>

						<div class="santu-pm-body">
							<div class="santu-pm-list-modern">
								<div class="santu-pm-row-modern ${al.enabled ? 'is-enabled' : ''}">
									<div class="santu-pm-info">
										<div class="santu-pm-icon">🔐</div>
										<div class="santu-pm-details">
											<h4>App Lock</h4>
											<span class="santu-pm-status ${al.enabled ? 'ok' : 'warn'}">
												${al.enabled ? '✅ On — PIN maanga jayega' : '⚠️ Off — koi bhi seedha aa sakta hai'}
											</span>
										</div>
									</div>
									<button class="btn ${al.enabled ? 'btn-default' : 'btn-primary'} btn-sm santu-applock-set-pin">
										${al.enabled ? 'Change PIN' : 'Turn On'}
									</button>
								</div>

								<div class="santu-pm-row-modern ${al.touch_id_devices ? 'is-enabled' : ''}">
									<div class="santu-pm-info">
										<div class="santu-pm-icon">👆</div>
										<div class="santu-pm-details">
											<h4>Fingerprint (Touch ID)</h4>
											<span class="santu-pm-status ${al.touch_id_devices ? 'ok' : 'warn'}">
												${al.touch_id_devices ? `✅ ${al.touch_id_devices} device(s) active` : '⚠️ Not Set Up'}
											</span>
										</div>
									</div>
									<div style="display:flex; gap:6px; align-items:center;">
										<button class="btn btn-default btn-sm santu-applock-add-touch" ${al.enabled ? '' : 'disabled'}>
											${al.touch_id_devices ? 'Dobara Set Karo' : 'Add this Mac'}
										</button>
										${al.touch_id_devices ? '<button class="btn btn-danger btn-sm santu-applock-forget-touch">Hata Do</button>' : ''}
									</div>
								</div>
								${!al.enabled
									? '<div style="margin-top:10px; color:#f59e0b; font-size:13px; font-weight:500;">Note: PIN On kariye pehle — fingerprint uska shortcut hai.</div>'
									: ''}
								${al.enabled
									? '<button class="btn btn-default btn-sm santu-applock-turn-off" style="margin-top:8px;">Turn Off App Lock</button>'
									: ''}
							</div>
						</div>
					</div>
				</div>
			`);

			$wrap.find(".santu-privacy-set-pin").on("click", async () => {
				if (await window.santu_privacy.set_pin_dialog()) render();
			});
			$wrap.find(".santu-privacy-add-touch").on("click", async () => {
				if (await window.santu_privacy.register_touch_id()) render();
			});
			$wrap.find(".santu-applock-set-pin").on("click", async () => {
				if (await window.santu_app_lock.set_pin_dialog(al.enabled)) render();
			});
			$wrap.find(".santu-applock-add-touch").on("click", async () => {
				if (await window.santu_app_lock_webauthn.register()) render();
			});
			// Revoking a fingerprint had no button at all — the only way to
			// drop a trusted Mac was to change the PIN, which is a much
			// bigger hammer than "not this machine any more" (2026-09-05).
			$wrap.find(".santu-applock-forget-touch").on("click", () => {
				frappe.confirm(__("Is Mac se fingerprint unlock hata dein? PIN waise hi chalta rahega."), async () => {
					await frappe.xcall("santu_hardware.santu_hardware.api.app_lock_device_forget");
					if (window.santu_app_lock_webauthn) await window.santu_app_lock_webauthn.nativeForget();
					frappe.show_alert({ message: __("Fingerprint hata diya"), indicator: "orange" });
					render();
				});
			});
			$wrap.find(".santu-applock-turn-off").on("click", () => {
				frappe.confirm(__("App Lock band kar dein? Ab bina PIN ke koi bhi app khol sakega."), async () => {
					await window.santu_app_lock.disable();
					try {
						sessionStorage.removeItem("santu_applock_unlocked");
					} catch (e) {
						/* ignore */
					}
					frappe.show_alert({ message: __("App Lock band ho gaya"), indicator: "orange" });
					render();
				});
			});
		};
		render();
	},

	/* ── 14. Voice Model Training ───────────────────────────── */
	async render_voice_model($wrap) {
		let data = await santu_utilities.api.getVoiceModel();
		let catalogData = await santu_utilities.api.getCatalogItemsForTraining({ status: "all" });
		let datasetStats = await santu_utilities.api.getVoiceDatasetStats();
		let activeTab = "wizard"; // "wizard" | "items" | "settings"
		let wizardIndex = 0;
		let wizardFilterGroup = "All Groups";
		let wizardFilterStatus = "untrained"; // Untrained by default so trained items never repeat!
		let recognition = null;
		let is_recording = false;

		const render = () => {
			$wrap.html(`
				<div class="santu-utilities-section">
					<div class="santu-utilities-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
						<div>
							<h1 class="santu-utilities-title">🎙️ Voice Model Training (आवाज़ पहचान & लोकल ऑडियो स्टोरेज)</h1>
							<p class="santu-utilities-muted" style="margin:4px 0 0;">
								Saman ka naam bolkar train karein — har trained saman ka voice audio aapke computer ke <code>voice_dataset/</code> folder me permanently save hota jayega.
							</p>
						</div>
						<div style="display:flex; gap:8px;">
							<button class="btn btn-default btn-sm santu-vm-auto-train">
								⚡ 1-Click Auto-Train Brands
							</button>
							<button class="btn btn-primary btn-sm santu-vm-add-rule">
								+ Add Custom Voice Rule
							</button>
						</div>
					</div>

					<!-- Navigation Tabs -->
					<div class="santu-vm-tab-nav">
						<button type="button" class="santu-vm-tab-btn ${activeTab === 'wizard' ? 'is-active' : ''}" data-tab="wizard">
							🚀 Step-by-Step Training Wizard (${catalogData.untrained_count || 0} Untrained)
						</button>
						<button type="button" class="santu-vm-tab-btn ${activeTab === 'items' ? 'is-active' : ''}" data-tab="items">
							📦 All Items Catalog (${catalogData.total_count || 0})
						</button>
						<button type="button" class="santu-vm-tab-btn ${activeTab === 'settings' ? 'is-active' : ''}" data-tab="settings">
							⚙️ Voice Rules & Local Audio Dataset (${datasetStats.total_recordings || 0} Audio Files)
						</button>
					</div>

					<!-- Tab Content Container -->
					<div class="santu-vm-tab-content">
						${activeTab === 'wizard' ? render_wizard_tab() : (activeTab === 'items' ? render_items_tab() : render_settings_tab())}
					</div>
				</div>
			`);

			attach_main_events();
		};

		/* ── Tab 1: Step-by-Step Training Wizard ── */
		const get_wizard_items = () => {
			let items = catalogData.items || [];
			if (wizardFilterGroup && wizardFilterGroup !== "All Groups") {
				items = items.filter(it => it.item_group === wizardFilterGroup);
			}
			if (wizardFilterStatus === "untrained") {
				items = items.filter(it => !it.is_trained);
			} else if (wizardFilterStatus === "trained") {
				items = items.filter(it => it.is_trained);
			}
			return items;
		};

		const render_wizard_tab = () => {
			const items = get_wizard_items();
			const total = items.length;
			if (wizardIndex >= total) wizardIndex = Math.max(0, total - 1);
			const currentItem = items[wizardIndex];
			const trainedCount = catalogData.trained_count || 0;
			const totalCatalog = catalogData.total_count || 1;
			const percent = Math.round((trainedCount / totalCatalog) * 100);

			if (!currentItem) {
				return `
					<div class="santu-vm-wizard-card">
						<div style="font-size:48px; margin-bottom:12px;">🎉</div>
						<h2>Sabhi Saman Train Ho Chuke Hain!</h2>
						<p class="text-muted" style="margin-bottom:18px;">
							Aapke catalog ke sabhi <b>${totalCatalog} items</b> ka voice model train ho chuka hai. Naya saman add hone par wo yahan automatically aa jayega!
						</p>
						<button class="btn btn-default santu-vm-view-all-trained">
							Review All Trained Items (${trainedCount})
						</button>
					</div>
				`;
			}

			return `
				<div class="santu-vm-wizard-card">
					<!-- Progress Header -->
					<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
						<div style="display:flex; align-items:center; gap:8px;">
							<span class="badge ${currentItem.is_trained ? 'badge-success' : 'badge-warning'}">
								${currentItem.is_trained ? '✅ Already Trained' : '⚠️ Untrained'}
							</span>
							<span style="font-weight:700; font-size:14px; color:#1e293b;">
								Untrained Queue: Item ${wizardIndex + 1} of ${total}
							</span>
						</div>
						<div style="display:flex; align-items:center; gap:8px;">
							<select class="form-control input-sm santu-vm-wizard-group-select" style="width:160px; font-size:12px;">
								${(catalogData.groups || []).map(g => `<option value="${g}" ${g === wizardFilterGroup ? 'selected' : ''}>${g}</option>`).join('')}
							</select>
							<select class="form-control input-sm santu-vm-wizard-status-select" style="width:140px; font-size:12px;">
								<option value="untrained" ${wizardFilterStatus === 'untrained' ? 'selected' : ''}>Untrained Only</option>
								<option value="trained" ${wizardFilterStatus === 'trained' ? 'selected' : ''}>Trained Only</option>
								<option value="all" ${wizardFilterStatus === 'all' ? 'selected' : ''}>All Items</option>
							</select>
						</div>
					</div>

					<div class="santu-vm-progress-bar-wrap">
						<div class="santu-vm-progress-bar-fill" style="width: ${percent}%;"></div>
					</div>
					<div style="font-size:12px; color:#64748b; margin-top:-14px; margin-bottom:18px; text-align:right;">
						Overall Shop Progress: <b>${trainedCount} / ${totalCatalog} items trained (${percent}%)</b>
					</div>

					<!-- Item Info Display -->
					<div style="margin: 16px 0;">
						<div style="display:inline-flex; gap:6px; margin-bottom:8px;">
							${currentItem.brand ? `<span class="badge badge-info">${frappe.utils.escape_html(currentItem.brand)}</span>` : ''}
							<span class="badge badge-default">${frappe.utils.escape_html(currentItem.item_group || 'General')}</span>
						</div>
						<div class="santu-vm-wizard-item-title">
							${frappe.utils.escape_html(currentItem.item_name)}
						</div>
						<div style="color:#64748b; font-size:14px; font-weight:500;">
							Code: <code>${frappe.utils.escape_html(currentItem.item_code)}</code> | Rate: <b style="color:#16a34a;">₹${currentItem.standard_rate}</b> / ${currentItem.stock_uom}
						</div>
						${currentItem.aliases && currentItem.aliases.length ? `
							<div style="margin-top:10px;">
								<span style="font-size:12px; color:#475569; font-weight:600;">Current Trained Aliases: </span>
								${currentItem.aliases.map(a => `<span class="santu-vm-badge santu-vm-badge-green">🗣️ "${frappe.utils.escape_html(a)}"</span>`).join('')}
							</div>
						` : ''}
					</div>

					<!-- Big Mic Button -->
					<div style="margin: 20px 0;">
						<button type="button" class="santu-vm-wizard-mic" id="santu-vm-wizard-mic-btn" title="Click to Speak & Record Audio">
							<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
								<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
								<line x1="12" y1="19" x2="12" y2="22"></line>
							</svg>
						</button>
						<div class="santu-vm-wizard-status" style="font-size:15px; font-weight:600; color:#475569;">
							👆 Click Mic & Speak local name (Audio will be recorded & saved locally)
						</div>
					</div>

					<!-- Speech Feedback Banner -->
					<div class="santu-vm-wizard-feedback" style="display:none; margin:16px auto; max-width:520px; padding:12px 18px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe; font-size:14px; text-align:left;"></div>

					<!-- Navigation Buttons -->
					<div style="display:flex; justify-content:center; align-items:center; gap:12px; margin-top:24px;">
						<button class="btn btn-default santu-vm-wizard-prev" ${wizardIndex === 0 ? 'disabled' : ''}>
							← Previous Item
						</button>
						<button class="btn btn-default santu-vm-wizard-skip">
							Skip (अगला सामान) →
						</button>
						<button class="btn btn-primary santu-vm-wizard-manual-add">
							✏️ Type / Edit Alias
						</button>
					</div>
				</div>
			`;
		};

		/* ── Tab 2: All Items Catalog List ── */
		const render_items_tab = () => {
			const items = catalogData.items || [];
			return `
				<div class="santu-vm-card">
					<div class="santu-vm-card-head">
						<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
							<h3><span>📦</span> Shop Items Catalog (${items.length})</h3>
							<span class="badge badge-success">${catalogData.trained_count || 0} Trained</span>
							<span class="badge badge-warning">${catalogData.untrained_count || 0} Untrained</span>
						</div>
						<div style="display:flex; gap:8px;">
							<select class="form-control input-sm santu-vm-items-group-filter" style="width:160px; font-size:12px;">
								${(catalogData.groups || []).map(g => `<option value="${g}">${g}</option>`).join('')}
							</select>
							<select class="form-control input-sm santu-vm-items-status-filter" style="width:140px; font-size:12px;">
								<option value="all">All Status</option>
								<option value="untrained">Untrained Only</option>
								<option value="trained">Trained Only</option>
							</select>
							<input type="text" class="form-control input-sm santu-vm-items-search" placeholder="Search item by name/code…" style="width:220px;" />
						</div>
					</div>

					<div style="overflow-x:auto;">
						<table class="santu-vm-rules-table">
							<thead>
								<tr>
									<th style="width:30%;">Item Details</th>
									<th style="width:15%;">Category</th>
									<th style="width:12%;">Rate</th>
									<th style="width:28%;">Trained Voice Aliases</th>
									<th style="width:15%; text-align:right;">Action</th>
								</tr>
							</thead>
							<tbody class="santu-vm-items-table-body">
								${render_items_table_rows(items)}
							</tbody>
						</table>
					</div>
				</div>
			`;
		};

		const render_items_table_rows = (items) => {
			if (!items.length) {
				return `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">No items found matching the selected filters.</td></tr>`;
			}
			return items.map(it => `
				<tr data-item-code="${frappe.utils.escape_html(it.item_code)}">
					<td>
						<div style="font-weight:700; color:#0f172a;">${frappe.utils.escape_html(it.item_name)}</div>
						<div style="font-size:12px; color:#64748b;"><code>${frappe.utils.escape_html(it.item_code)}</code> ${it.brand ? `• ${frappe.utils.escape_html(it.brand)}` : ''}</div>
					</td>
					<td><span class="badge badge-default">${frappe.utils.escape_html(it.item_group || 'General')}</span></td>
					<td style="font-weight:600; color:#16a34a;">₹${it.standard_rate} <span style="font-size:11px; color:#64748b;">/${it.stock_uom}</span></td>
					<td>
						${it.aliases && it.aliases.length ? it.aliases.map(a => `<span class="santu-vm-badge santu-vm-badge-green">🗣️ "${frappe.utils.escape_html(a)}"</span>`).join('') : '<span class="badge santu-vm-badge-untrained">⚠️ Untrained</span>'}
					</td>
					<td style="text-align:right;">
						<button class="btn btn-xs btn-primary santu-vm-train-item-btn" data-code="${frappe.utils.escape_html(it.item_code)}" data-name="${frappe.utils.escape_html(it.item_name)}">
							🎙️ Train Voice
						</button>
					</td>
				</tr>
			`).join('');
		};

		/* ── Tab 3: Settings & Local Audio Dataset ── */
		const render_settings_tab = () => {
			const rules = data.rules || [];
			const samples = datasetStats.recent_samples || [];
			return `
				<!-- Local Dataset Folder Summary Card -->
				<div class="santu-vm-card" style="margin-bottom:20px; border-left:4px solid #2563eb;">
					<div class="santu-vm-card-head" style="margin-bottom:8px;">
						<h3><span>📁</span> Local Voice Audio Dataset Storage (Mac Hard Disk)</h3>
						<span class="badge badge-success">${datasetStats.total_recordings || 0} Audio Clips Saved</span>
					</div>
					<div style="font-size:13px; color:#475569; line-height:1.6;">
						<div>Aapki har ek training audio clip computer me is folder me save hoti hai:</div>
						<div style="margin:6px 0;"><code>${frappe.utils.escape_html(datasetStats.folder_path || 'sites/site1.local/public/files/voice_dataset/')}</code></div>
						<div style="font-size:12px; color:#64748b;">
							Disk Usage: <b>${datasetStats.disk_usage_mb || 0} MB</b> | Total Recordings: <b>${datasetStats.total_recordings || 0}</b> | Format: <b>WebM / PCM Audio</b>
						</div>
					</div>

					${samples.length ? `
						<div style="margin-top:14px; padding-top:12px; border-top:1px dashed #cbd5e1;">
							<div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px;">RECENT RECORDED VOICE SAMPLES:</div>
							<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px;">
								${samples.slice(0, 6).map(s => `
									<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
										<div style="font-weight:700; font-size:13px; color:#0f172a;">${frappe.utils.escape_html(s.item_name)}</div>
										<div style="font-size:12px; color:#2563eb; margin:2px 0 6px;">🗣️ "${frappe.utils.escape_html(s.phrase)}"</div>
										${s.file_url ? `
											<audio controls style="width:100%; height:32px;" src="${frappe.utils.escape_html(s.file_url)}"></audio>
										` : ''}
										<div style="font-size:11px; color:#94a3b8; margin-top:4px;">${frappe.utils.escape_html(s.created_at || '')}</div>
									</div>
								`).join('')}
							</div>
						</div>
					` : ''}
				</div>

				<div class="santu-vm-grid">
					<!-- Live Voice Testing Sandbox -->
					<div class="santu-vm-card">
						<div class="santu-vm-card-head">
							<h3><span>🎤</span> Live Voice Test & Training Sandbox</h3>
							<span class="badge ${data.enabled ? 'badge-success' : 'badge-danger'}">
								${data.enabled ? 'Active' : 'Disabled'}
							</span>
						</div>

						<div style="text-align:center; padding:10px 0;">
							<button type="button" class="santu-vm-mic-btn" id="santu-vm-mic-trigger" title="Click to Speak">
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
									<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
									<line x1="12" y1="19" x2="12" y2="22"></line>
								</svg>
							</button>
							<div class="santu-vm-status-text" style="font-size:13px; font-weight:600; color:#64748b; margin-bottom:12px;">
								Click Mic button to speak in Hindi or English (e.g., "adha inch socket" ya "tota pilas")
							</div>
						</div>

						<div class="santu-vm-test-box">
							<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
								<span style="font-size:12px; font-weight:600; color:#475569; text-transform:uppercase;">Voice Recognition & Mapping Result</span>
								<span class="santu-vm-live-indicator" style="font-size:11px; color:#94a3b8;">Ready</span>
							</div>
							<div class="santu-vm-output" style="font-size:14px; color:#1e293b; min-height:22px;">
								<i style="color:#94a3b8;">Spoken phrase will appear here in real-time…</i>
							</div>
							<div class="santu-vm-test-result" style="display:none;"></div>
						</div>
					</div>

					<!-- Model Global Configuration -->
					<div class="santu-vm-card">
						<div class="santu-vm-card-head">
							<h3><span>⚙️</span> Voice Model Settings</h3>
							<span style="font-size:12px; color:#64748b;">${catalogData.total_count || 0} items catalog</span>
						</div>

						<form class="santu-vm-settings-form">
							<div class="form-group" style="margin-bottom:14px;">
								<label style="font-weight:600; font-size:13px; margin-bottom:4px; display:block;">Speech Recognition Language</label>
								<select class="form-control santu-vm-lang" style="font-size:13px;">
									<option value="hi-IN" ${data.language === 'hi-IN' ? 'selected' : ''}>Hindi / Hinglish (hi-IN) - Recommended</option>
									<option value="en-IN" ${data.language === 'en-IN' ? 'selected' : ''}>Indian English (en-IN)</option>
									<option value="auto" ${data.language === 'auto' ? 'selected' : ''}>System Default (Auto)</option>
								</select>
								<small class="text-muted">Dictation engine uses this primary dialect model.</small>
							</div>

							<div style="margin-bottom:12px;">
								<label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
									<input type="checkbox" class="santu-vm-auto-unit" ${data.auto_unit_conversion ? 'checked' : ''} />
									Auto Hardware Unit & Fraction Conversion (adha → 1/2, pauna → 3/4, dedh → 1-1/2, inchi → inch)
								</label>
							</div>

							<div style="margin-bottom:18px;">
								<label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;">
									<input type="checkbox" class="santu-vm-fuzzy" ${data.fuzzy_matching ? 'checked' : ''} />
									Phonetic Fuzzy Matching (Tolerate accent & colloquial variances)
								</label>
							</div>

							<button type="submit" class="btn btn-primary btn-sm">
								Save Voice Settings
							</button>
						</form>
					</div>
				</div>

				<!-- Trained Rules Table Card -->
				<div class="santu-vm-card" style="margin-top:20px;">
					<div class="santu-vm-card-head" style="margin-bottom:12px;">
						<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
							<h3><span>📋</span> Trained Vocabulary & Rules (${rules.length})</h3>
							<span class="badge badge-info">${rules.filter(r => r.enabled).length} Active</span>
						</div>
						<div style="width:260px;">
							<input type="text" class="form-control input-sm santu-vm-search-rules" placeholder="Search rules or phrases…" />
						</div>
					</div>

					<div style="overflow-x:auto;">
						<table class="santu-vm-rules-table">
							<thead>
								<tr>
									<th style="width:28%;">What You Speak (Phrase)</th>
									<th style="width:28%;">Searches For (Target Keyword)</th>
									<th style="width:20%;">Linked Item / Category</th>
									<th style="width:12%;">Status</th>
									<th style="width:12%; text-align:right;">Actions</th>
								</tr>
							</thead>
							<tbody class="santu-vm-rules-body">
								${render_rules_rows(rules)}
							</tbody>
						</table>
					</div>
				</div>
			`;
		};

		const render_rules_rows = (rules) => {
			if (!rules.length) {
				return `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">No custom voice rules added yet.</td></tr>`;
			}
			return rules.map((r) => `
				<tr data-rule-id="${r.id}">
					<td><span class="santu-vm-phrase-tag">🗣️ "${frappe.utils.escape_html(r.phrase)}"</span></td>
					<td><span class="santu-vm-target-tag">🔍 ${frappe.utils.escape_html(r.target)}</span></td>
					<td style="color:#64748b; font-size:12px;">${r.item_code ? `<code>${frappe.utils.escape_html(r.item_code)}</code>` : (r.description || '—')}</td>
					<td>
						<span class="badge ${r.enabled ? 'badge-success' : 'badge-default'}" style="cursor:pointer;" data-action="toggle-status">
							${r.enabled ? 'Enabled' : 'Disabled'}
						</span>
					</td>
					<td style="text-align:right;">
						<button class="btn btn-xs btn-default" data-action="edit-rule" title="Edit Rule" style="margin-right:4px;">✏️</button>
						<button class="btn btn-xs btn-danger" data-action="delete-rule" title="Delete Rule">🗑️</button>
					</td>
				</tr>
			`).join('');
		};

		const attach_main_events = () => {
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

			// Tab Switching
			$wrap.find(".santu-vm-tab-btn").on("click", function() {
				activeTab = $(this).data("tab");
				render();
			});

			$wrap.find(".santu-vm-view-all-trained").on("click", function() {
				activeTab = "items";
				render();
			});

			// Auto-Train Catalog
			$wrap.find(".santu-vm-auto-train").on("click", async () => {
				frappe.dom.freeze(__("Analyzing shop catalog & generating voice aliases…"));
				try {
					const res = await santu_utilities.api.autoTrainCatalog();
					frappe.dom.unfreeze();
					frappe.msgprint({
						title: __("Voice Model Auto-Trained"),
						indicator: "green",
						message: `<b>${res.items_analyzed} items</b> analyzed.<br><b>${res.new_rules_added} new voice rules</b> generated from catalog brands and sizes!`,
					});
					data = await santu_utilities.api.getVoiceModel();
					catalogData = await santu_utilities.api.getCatalogItemsForTraining();
					datasetStats = await santu_utilities.api.getVoiceDatasetStats();
					render();
				} catch (err) {
					frappe.dom.unfreeze();
					frappe.msgprint({ title: __("Error"), message: err.message, indicator: "red" });
				}
			});

			// Add Rule
			$wrap.find(".santu-vm-add-rule").on("click", () => open_rule_dialog());

			/* ── Wizard Events ── */
			if (activeTab === "wizard") {
				const items = get_wizard_items();
				const currentItem = items[wizardIndex];

				$wrap.find(".santu-vm-wizard-group-select").on("change", function() {
					wizardFilterGroup = $(this).val();
					wizardIndex = 0;
					render();
				});

				$wrap.find(".santu-vm-wizard-status-select").on("change", function() {
					wizardFilterStatus = $(this).val();
					wizardIndex = 0;
					render();
				});

				$wrap.find(".santu-vm-wizard-prev").on("click", () => {
					if (wizardIndex > 0) {
						wizardIndex--;
						render();
					}
				});

				$wrap.find(".santu-vm-wizard-skip").on("click", () => {
					wizardIndex++;
					render();
				});

				$wrap.find(".santu-vm-wizard-manual-add").on("click", () => {
					if (currentItem) {
						open_rule_dialog({
							phrase: "",
							target: currentItem.item_name,
							item_code: currentItem.item_code,
						});
					}
				});

				// Wizard Mic & Audio Recorder Handler
				const $wMic = $wrap.find("#santu-vm-wizard-mic-btn");
				const $wStatus = $wrap.find(".santu-vm-wizard-status");
				const $wFeedback = $wrap.find(".santu-vm-wizard-feedback");

				let mediaRecorder = null;
				let audioChunks = [];
				let audioBase64 = null;

				const startAudioRecording = async () => {
					audioChunks = [];
					audioBase64 = null;
					try {
						if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
							const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
							mediaRecorder = new MediaRecorder(stream);
							mediaRecorder.ondataavailable = (e) => {
								if (e.data && e.data.size > 0) audioChunks.push(e.data);
							};
							mediaRecorder.onstop = () => {
								try {
									const blob = new Blob(audioChunks, { type: 'audio/webm' });
									const reader = new FileReader();
									reader.onloadend = () => {
										audioBase64 = reader.result;
									};
									reader.readAsDataURL(blob);
									stream.getTracks().forEach(t => t.stop());
								} catch(e) {}
							};
							mediaRecorder.start();
						}
					} catch(err) {
						console.warn("Audio media recording not available:", err);
					}
				};

				const stopAudioRecording = () => {
					if (mediaRecorder && mediaRecorder.state === "recording") {
						try { mediaRecorder.stop(); } catch(e) {}
					}
				};

				$wMic.on("click", () => {
					if (!SpeechRecognition) {
						frappe.show_alert({ message: "Speech Recognition not supported in browser", indicator: "orange" });
						return;
					}
					if (is_recording && recognition) {
						try { recognition.stop(); } catch(e) {}
						stopAudioRecording();
						return;
					}

					recognition = new SpeechRecognition();
					recognition.continuous = false;
					recognition.interimResults = false;
					const selLang = data.language || 'hi-IN';
					if (selLang && selLang !== 'auto') recognition.lang = selLang;

					recognition.onstart = () => {
						is_recording = true;
						$wMic.addClass("is-listening");
						$wStatus.html(`<span style="color:#ef4444; font-weight:700;">🔴 Sun rahe hain & Record kar rahe hain… Boliye is saman ka naam!</span>`);
						startAudioRecording();
					};

					recognition.onresult = async (event) => {
						stopAudioRecording();
						let transcript = '';
						for (let i = event.resultIndex; i < event.results.length; ++i) {
							transcript += event.results[i][0].transcript;
						}
						if (transcript && currentItem) {
							// Wait a short tick for audio FileReader to finish encoding
							await new Promise(r => setTimeout(r, 150));

							$wFeedback.html(`
								<div style="font-weight:700; color:#1e293b; margin-bottom:4px;">
									🗣️ Suna: <span style="color:#2563eb; font-size:16px;">"${frappe.utils.escape_html(transcript)}"</span>
								</div>
								<div style="color:#16a34a; font-weight:600; margin-bottom:4px;">
									✅ Saved voice alias for <b>${frappe.utils.escape_html(currentItem.item_name)}</b>!
								</div>
								<div style="font-size:12px; color:#64748b;">
									📁 Audio sample saved to local <code>voice_dataset/</code> folder on Mac
								</div>
							`).slideDown();

							// Save alias and audio sample to server & disk
							await santu_utilities.api.trainItemVoiceAlias(currentItem.item_code, transcript, audioBase64, "webm");
							data = await santu_utilities.api.getVoiceModel();
							catalogData = await santu_utilities.api.getCatalogItemsForTraining();
							datasetStats = await santu_utilities.api.getVoiceDatasetStats();

							frappe.show_alert({ message: `Trained: "${transcript}" → ${currentItem.item_name}`, indicator: "green" });

							// Auto advance to next untrained item after 1.2s
							setTimeout(() => {
								render();
							}, 1200);
						}
					};

					recognition.onerror = (e) => {
						is_recording = false;
						stopAudioRecording();
						$wMic.removeClass("is-listening");
						$wStatus.text("Error listening: " + e.error + ". Click mic to try again.");
					};

					recognition.onend = () => {
						is_recording = false;
						stopAudioRecording();
						$wMic.removeClass("is-listening");
					};

					try { recognition.start(); } catch(e) { console.error(e); }
				});
			}

			/* ── Items Tab Events ── */
			if (activeTab === "items") {
				const filter_items_table = () => {
					const q = $wrap.find(".santu-vm-items-search").val().toLowerCase().trim();
					const grp = $wrap.find(".santu-vm-items-group-filter").val();
					const st = $wrap.find(".santu-vm-items-status-filter").val();

					let filtered = (catalogData.items || []).filter(it => {
						const matchQ = !q || it.item_name.toLowerCase().includes(q) || it.item_code.toLowerCase().includes(q) || (it.brand && it.brand.toLowerCase().includes(q));
						const matchGrp = grp === "All Groups" || it.item_group === grp;
						const matchSt = st === "all" || (st === "trained" && it.is_trained) || (st === "untrained" && !it.is_trained);
						return matchQ && matchGrp && matchSt;
					});
					$wrap.find(".santu-vm-items-table-body").html(render_items_table_rows(filtered));
				};

				$wrap.find(".santu-vm-items-search").on("input", santu_utilities.utils.debounce(filter_items_table, 200));
				$wrap.find(".santu-vm-items-group-filter, .santu-vm-items-status-filter").on("change", filter_items_table);

				$wrap.find(".santu-vm-items-table-body").on("click", ".santu-vm-train-item-btn", function() {
					const code = $(this).data("code");
					const name = $(this).data("name");
					open_single_item_mic_dialog(code, name);
				});
			}

			/* ── Settings Tab Events ── */
			if (activeTab === "settings") {
				$wrap.find(".santu-vm-settings-form").on("submit", async (e) => {
					e.preventDefault();
					frappe.dom.freeze(__("Saving voice settings…"));
					try {
						await santu_utilities.api.saveVoiceSettings({
							enabled: 1,
							language: $wrap.find(".santu-vm-lang").val(),
							auto_unit_conversion: $wrap.find(".santu-vm-auto-unit").is(":checked") ? 1 : 0,
							fuzzy_matching: $wrap.find(".santu-vm-fuzzy").is(":checked") ? 1 : 0,
						});
						data = await santu_utilities.api.getVoiceModel();
						frappe.dom.unfreeze();
						frappe.show_alert({ message: __("Voice settings saved"), indicator: "green" });
					} catch (err) {
						frappe.dom.unfreeze();
						frappe.msgprint({ title: __("Error"), message: err.message, indicator: "red" });
					}
				});

				$wrap.find(".santu-vm-search-rules").on("input", function() {
					const q = $(this).val().toLowerCase().trim();
					const filtered = (data.rules || []).filter(r => 
						(r.phrase && r.phrase.toLowerCase().includes(q)) || 
						(r.target && r.target.toLowerCase().includes(q)) ||
						(r.item_code && r.item_code.toLowerCase().includes(q))
					);
					$wrap.find(".santu-vm-rules-body").html(render_rules_rows(filtered));
				});

				$wrap.find(".santu-vm-rules-body").on("click", "[data-action]", async function(e) {
					e.preventDefault();
					const action = $(this).data("action");
					const ruleId = $(this).closest("tr").data("rule-id");
					const rule = (data.rules || []).find(r => r.id === ruleId);
					if (!rule) return;

					if (action === "toggle-status") {
						rule.enabled = !rule.enabled;
						await santu_utilities.api.saveVoiceRule(rule);
						render();
					} else if (action === "delete-rule") {
						frappe.confirm(`Delete voice rule for "<b>${frappe.utils.escape_html(rule.phrase)}</b>"?`, async () => {
							await santu_utilities.api.deleteVoiceRule(ruleId);
							data = await santu_utilities.api.getVoiceModel();
							catalogData = await santu_utilities.api.getCatalogItemsForTraining();
							datasetStats = await santu_utilities.api.getVoiceDatasetStats();
							render();
						});
					} else if (action === "edit-rule") {
						open_rule_dialog(rule);
					}
				});

				// Sandbox Mic Tester
				const $micBtn = $wrap.find("#santu-vm-mic-trigger");
				const $statusText = $wrap.find(".santu-vm-status-text");
				const $output = $wrap.find(".santu-vm-output");
				const $resContainer = $wrap.find(".santu-vm-test-result");
				const $indicator = $wrap.find(".santu-vm-live-indicator");

				$micBtn.on("click", () => {
					if (!SpeechRecognition) {
						frappe.show_alert({ message: "Speech Recognition not supported in browser", indicator: "orange" });
						return;
					}
					if (is_recording && recognition) {
						try { recognition.stop(); } catch(e) {}
						return;
					}

					recognition = new SpeechRecognition();
					recognition.continuous = false;
					recognition.interimResults = true;
					const selLang = $wrap.find(".santu-vm-lang").val();
					if (selLang && selLang !== 'auto') recognition.lang = selLang;

					recognition.onstart = () => {
						is_recording = true;
						$micBtn.addClass("is-listening");
						$statusText.html(`<span style="color:#ef4444;">🔴 Listening… Speak now into your microphone</span>`);
						$indicator.text("Listening…").css("color", "#ef4444");
					};

					recognition.onresult = async (event) => {
						let transcript = '';
						for (let i = event.resultIndex; i < event.results.length; ++i) {
							transcript += event.results[i][0].transcript;
						}
						if (transcript) {
							$output.html(`<b>Spoken:</b> <span style="font-size:15px; color:#2563eb;">"${frappe.utils.escape_html(transcript)}"</span>`);
							const testResult = await santu_utilities.api.testVoiceQuery(transcript);
							
							let rulesBadges = (testResult.rules_applied || []).map(r => `<span class="santu-vm-badge">${frappe.utils.escape_html(r)}</span>`).join('');
							if (!rulesBadges) rulesBadges = `<span style="color:#94a3b8; font-size:12px;">Direct search (no custom transformation needed)</span>`;

							let itemsHtml = '';
							if (testResult.matched_items && testResult.matched_items.length) {
								itemsHtml = `
									<div style="margin-top:10px;">
										<div style="font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">MATCHED SHOP ITEMS (${testResult.matched_items.length}):</div>
										${testResult.matched_items.slice(0, 3).map(it => `
											<div class="santu-vm-item-preview">
												<div>
													<b>${frappe.utils.escape_html(it.item_name || it.item_code)}</b>
													<span style="color:#64748b; font-size:12px; margin-left:6px;">(${frappe.utils.escape_html(it.item_code)})</span>
												</div>
												<div style="font-weight:600; color:#16a34a;">₹${it.standard_rate || 0}</div>
											</div>
										`).join('')}
									</div>
								`;
							}

							$resContainer.html(`
								<div style="font-size:13px; margin-bottom:6px;">
									<b>Transformed Search Term:</b> <span class="santu-vm-badge santu-vm-badge-green" style="font-size:13px;">${frappe.utils.escape_html(testResult.transformed_query)}</span>
								</div>
								<div style="margin-bottom:6px;">
									<div style="font-size:12px; font-weight:600; color:#475569; margin-bottom:2px;">RULES APPLIED:</div>
									${rulesBadges}
								</div>
								${itemsHtml}
								<div style="margin-top:12px; text-align:right;">
									<button class="btn btn-xs btn-primary santu-vm-save-quick-rule" data-spoken="${frappe.utils.escape_html(testResult.raw_query)}" data-target="${frappe.utils.escape_html(testResult.transformed_query)}">
										+ Save as Custom Training Rule
									</button>
								</div>
							`).show();

							$resContainer.find(".santu-vm-save-quick-rule").on("click", function() {
								open_rule_dialog({
									phrase: $(this).data("spoken"),
									target: $(this).data("target"),
								});
							});
						}
					};

					recognition.onerror = (event) => {
						is_recording = false;
						$micBtn.removeClass("is-listening");
						$statusText.text("Click Mic button to speak again.");
						$indicator.text("Error: " + event.error).css("color", "#ef4444");
					};

					recognition.onend = () => {
						is_recording = false;
						$micBtn.removeClass("is-listening");
						$statusText.text("Click Mic button to speak again.");
						$indicator.text("Done").css("color", "#16a34a");
					};

					try { recognition.start(); } catch(e) { console.error(e); }
				});
			}
		};

		const open_single_item_mic_dialog = (item_code, item_name) => {
			let mediaRec = null;
			let audioDataChunks = [];
			let encodedAudio = null;

			const d = new frappe.ui.Dialog({
				title: `🎙️ Train Voice for: ${item_name}`,
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "mic_ui",
						options: `
							<div style="text-align:center; padding:15px 0;">
								<div style="font-size:14px; font-weight:600; color:#1e293b; margin-bottom:12px;">
									Item: <b>${frappe.utils.escape_html(item_name)}</b> (<code>${frappe.utils.escape_html(item_code)}</code>)
								</div>
								<button type="button" class="santu-vm-wizard-mic" id="santu-dialog-mic-btn" style="width:68px; height:68px;">
									<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
										<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
										<line x1="12" y1="19" x2="12" y2="22"></line>
									</svg>
								</button>
								<div id="santu-dialog-mic-status" style="font-size:13px; font-weight:600; color:#64748b;">
									Click Mic button & speak phrase (Audio will be recorded locally)
								</div>
							</div>
						`,
					},
					{
						fieldtype: "Data",
						fieldname: "spoken_phrase",
						label: __("Spoken Phrase (आवाज़ से क्या बोलेंगे)"),
						reqd: 1,
						description: __("Boliye ya type karein (e.g. 'astral 1 inch pipe')"),
					},
				],
				primary_action_label: __("Save Voice Alias & Audio"),
				primary_action: async (values) => {
					d.hide();
					frappe.dom.freeze(__("Saving voice alias and audio sample…"));
					try {
						await santu_utilities.api.trainItemVoiceAlias(item_code, values.spoken_phrase, encodedAudio, "webm");
						data = await santu_utilities.api.getVoiceModel();
						catalogData = await santu_utilities.api.getCatalogItemsForTraining();
						datasetStats = await santu_utilities.api.getVoiceDatasetStats();
						frappe.dom.unfreeze();
						frappe.show_alert({ message: __("Voice alias and audio saved locally!"), indicator: "green" });
						render();
					} catch(err) {
						frappe.dom.unfreeze();
						frappe.msgprint({ title: __("Error"), message: err.message, indicator: "red" });
					}
				},
			});

			d.show();

			const $dMic = d.$wrapper.find("#santu-dialog-mic-btn");
			const $dStatus = d.$wrapper.find("#santu-dialog-mic-status");
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

			$dMic.on("click", async () => {
				if (!SpeechRecognition) return;
				audioDataChunks = [];
				encodedAudio = null;

				try {
					if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
						const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
						mediaRec = new MediaRecorder(stream);
						mediaRec.ondataavailable = (e) => {
							if (e.data && e.data.size > 0) audioDataChunks.push(e.data);
						};
						mediaRec.onstop = () => {
							try {
								const blob = new Blob(audioDataChunks, { type: 'audio/webm' });
								const reader = new FileReader();
								reader.onloadend = () => { encodedAudio = reader.result; };
								reader.readAsDataURL(blob);
								stream.getTracks().forEach(t => t.stop());
							} catch(e) {}
						};
						mediaRec.start();
					}
				} catch(e) {}

				const rec = new SpeechRecognition();
				rec.continuous = false;
				rec.interimResults = false;
				rec.lang = data.language || 'hi-IN';

				rec.onstart = () => {
					$dMic.addClass("is-listening");
					$dStatus.html(`<span style="color:#ef4444;">🔴 Listening & Recording… Speak now!</span>`);
				};
				rec.onresult = (e) => {
					if (mediaRec && mediaRec.state === "recording") {
						try { mediaRec.stop(); } catch(err) {}
					}
					let t = '';
					for (let i = e.resultIndex; i < e.results.length; ++i) t += e.results[i][0].transcript;
					if (t) {
						d.set_value("spoken_phrase", t);
						$dStatus.html(`<span style="color:#16a34a;">✅ Recognized & Recorded: "${frappe.utils.escape_html(t)}"</span>`);
					}
				};
				rec.onerror = () => {
					if (mediaRec && mediaRec.state === "recording") {
						try { mediaRec.stop(); } catch(err) {}
					}
					$dMic.removeClass("is-listening");
					$dStatus.text("Click mic to try again.");
				};
				rec.onend = () => {
					if (mediaRec && mediaRec.state === "recording") {
						try { mediaRec.stop(); } catch(err) {}
					}
					$dMic.removeClass("is-listening");
				};
				rec.start();
			});
		};

		const open_rule_dialog = (existing = null) => {
			const d = new frappe.ui.Dialog({
				title: existing ? __("Edit Voice Training Rule") : __("Add Custom Voice Training Rule"),
				fields: [
					{
						fieldtype: "Data",
						fieldname: "phrase",
						label: __("Spoken Phrase (What you or operator speaks)"),
						reqd: 1,
						default: existing ? existing.phrase : "",
						description: __("e.g., totaplas, pechkas, adha inchi soket, fevikol"),
					},
					{
						fieldtype: "Data",
						fieldname: "target",
						label: __("Target Keyword (What to search in catalog)"),
						reqd: 1,
						default: existing ? existing.target : "",
						description: __("e.g., TOTA PLIERS, Screw Driver, 1/2 inch Socket, Fevicol"),
					},
					{
						fieldtype: "Link",
						options: "Item",
						fieldname: "item_code",
						label: __("Direct Linked Item (Optional)"),
						default: existing ? existing.item_code : "",
					},
					{
						fieldtype: "Data",
						fieldname: "description",
						label: __("Note / Description (Optional)"),
						default: existing ? existing.description : "",
					},
					{
						fieldtype: "Check",
						fieldname: "enabled",
						label: __("Rule Enabled"),
						default: existing ? (existing.enabled ? 1 : 0) : 1,
					},
				],
				primary_action_label: existing ? __("Update Rule") : __("Save Rule"),
				primary_action: async (values) => {
					d.hide();
					frappe.dom.freeze(__("Saving voice rule…"));
					try {
						await santu_utilities.api.saveVoiceRule({
							phrase: values.phrase,
							target: values.target,
							item_code: values.item_code,
							description: values.description,
							enabled: values.enabled,
							rule_id: existing ? existing.id : null,
						});
						data = await santu_utilities.api.getVoiceModel();
						catalogData = await santu_utilities.api.getCatalogItemsForTraining();
						datasetStats = await santu_utilities.api.getVoiceDatasetStats();
						frappe.dom.unfreeze();
						frappe.show_alert({ message: __("Voice rule saved"), indicator: "green" });
						render();
					} catch (err) {
						frappe.dom.unfreeze();
						frappe.msgprint({ title: __("Error"), message: err.message, indicator: "red" });
					}
				},
			});
			d.show();
		};

		render();
	},
};



