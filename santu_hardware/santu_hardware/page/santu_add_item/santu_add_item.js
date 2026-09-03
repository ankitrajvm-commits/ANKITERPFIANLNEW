/* global frappe, santu_add_item_page */
// Santu Hardware — Add Item.
//
// Rebuilt 2026-08-18 into sectioned cards (Basic / Barcode / Pricing /
// GST / Stock / Batch / Supplier) against a written spec: "when I add a
// product once, it contains all the information needed later for billing,
// purchase, stock management, barcode scanning, GST/non-GST sales, batches
// and reporting". The previous version looked right but three of its own
// fields (Tax Rate, Wholesale Price, Discount) were silently dropped by the
// backend, and it had no brand, description, MRP, supplier, batch or
// multi-barcode support at all.
//
// Everything here maps onto fields ERPNext already has — brand,
// description, disabled, item_group, stock_uom, barcodes (multiple, typed),
// reorder_levels, item_defaults.default_supplier, supplier_items,
// has_batch_no, Batch, Item Price (per price list, and per batch) — plus
// four custom fields for the facts ERPNext has no home for (MRP, minimum
// selling price, GST-applicable switch, sub-category). Nothing is
// duplicated; see save_item.
frappe.pages["santu-add-item"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "Add Item", single_column: true });
	$(page.wrapper).find(".page-head").hide();
	$(page.main).addClass("santu-ai-page-main");
	santu_add_item_page.init(page);
};

// Fresh form every visit — a half-typed item left from last time is worse
// than an empty one, and on_page_load only fires once per session.
frappe.pages["santu-add-item"].on_page_show = function () {
	if (window.santu_add_item_page && santu_add_item_page.page) santu_add_item_page.reset();
};

window.santu_add_item_page = {
	init(page) {
		this.page = page;
		this.init_data = null;
		$(page.body).html(`<div class="santu-ai-loading">Loading…</div>`);
		frappe.xcall("santu_hardware.santu_hardware.api.get_add_item_init").then((data) => {
			this.init_data = data;
			this.reset();
		});
	},

	reset() {
		if (!this.init_data) return;
		this.saving = false;
		// Collapsed by default — GST and Batch Tracking are real but not
		// needed for most items added day to day (2026-08-19 direct
		// request: "kaafi cheezein unnecessary hai, ease it").
		this.show_advanced = false;
		this.state = {
			is_service: false,
			// Basic
			item_name: "",
			item_code: "",
			item_group: this.init_data.default_group || "",
			sub_category: "",
			brand: "",
			brand_type: "",
			uom: this.init_data.default_uom,
			description: "",
			is_active: true,
			image: "",
			// Barcode
			barcode: "",
			barcode_type: "",
			alternate_barcodes: [],
			// Pricing
			purchase_price: "",
			sale_price: "",
			mrp: "",
			wholesale_price: "",
			min_selling_price: "",
			// GST
			gst_applicable: false,
			gst_rate: "",
			gst_hsn_code: "",
			// Stock
			opening_qty: "",
			at_price: "",
			as_of_date: frappe.datetime.get_today(),
			min_stock: "",
			warehouse: this.init_data.default_warehouse || "",
			location: "",
			// Batch
			track_batches: false,
			batch_no: "",
			batch_mrp: "",
			batch_purchase_rate: "",
			batch_selling_rate: "",
			batch_expiry: "",
			// Supplier
			default_supplier: "",
			supplier_item_code: "",
		};
		this.render();
	},

	render() {
		const s = this.state;
		$(this.page.body).html(`
			<div class="santu-ai">
				<div class="santu-ai-card">
					<div class="santu-ai-head">
						<div class="santu-ai-head-left">
							<span class="santu-ai-title">Add Item</span>
							<!-- Product/Service toggle removed 2026-08-20: it sat right next to
							     the title and was easy to bump by mistake, silently saving a
							     stocked item as a non-stock Service (is_stock_item = 0). Every
							     item added here is a Product now; quick_create_item (the mid-sale
							     POS path) still makes Service items on purpose, unaffected. -->
						</div>
						<div class="santu-ai-head-right">
							<label class="santu-ai-check"><input type="checkbox" class="santu-ai-active" ${s.is_active ? "checked" : ""}> Active</label>
							<button type="button" class="santu-ai-icon-btn santu-ai-close" title="Close">✕</button>
						</div>
					</div>

					<div class="santu-ai-sections">
						${this._section_basic(s)}
						${this._section_pricing_stock(s)}
						
						<div class="santu-ai-adv-wrap">
							<button type="button" class="santu-ai-advanced-toggle">${this.show_advanced ? "▾ Hide Extra Details (GST, Batches, Wholesale, Supplier)" : "▸ + Extra Details (GST, Batches, Wholesale, Supplier)"}</button>
							${this.show_advanced ? this._section_advanced(s) : ""}
						</div>
					</div>
				</div>

				<div class="santu-ai-footer">
					<button type="button" class="santu-ai-btn santu-ai-btn-ghost" data-action="save-new">Save &amp; Add Another</button>
					<button type="button" class="santu-ai-btn santu-ai-btn-primary" data-action="save" disabled>Save Item</button>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-ai");
		this._bind();
		this._refresh_save();
	},

	_sec(key, title, body) {
		return `
			<div class="santu-ai-sec" data-sec="${key}">
				<div class="santu-ai-sec-head">
					<span class="santu-ai-sec-title">${title}</span>
				</div>
				<div class="santu-ai-sec-body">${body}</div>
			</div>`;
	},

	_section_basic(s) {
		const groups = this.init_data.item_groups || [];
		const opts = (list, sel) =>
			list.map((g) => `<option value="${frappe.utils.escape_html(g)}" ${g === sel ? "selected" : ""}>${frappe.utils.escape_html(g)}</option>`).join("");
		const brands = this.init_data.brands || [];
		const is_other = s.brand_type === "Other" || s.brand === "Other" || (s.brand && !brands.includes(s.brand));
		const sel_brand_val = is_other ? "Other" : (brands.includes(s.brand) ? s.brand : "");
		const other_text = (is_other && s.brand !== "Other") ? s.brand : "";

		const brand_opts = [
			`<option value="">Choose brand</option>`,
			...brands.map((b) => `<option value="${frappe.utils.escape_html(b)}" ${b === sel_brand_val ? "selected" : ""}>${frappe.utils.escape_html(b)}</option>`),
			`<option value="Other" ${sel_brand_val === "Other" ? "selected" : ""}>Other</option>`,
			`<option value="__new__">+ Add New Brand...</option>`,
		].join("");

		return this._sec(
			"basic",
			"Item Details",
			`
			<div class="santu-ai-grid4">
				<div class="santu-ai-cell santu-ai-cell-span2">
					<label>Item Name <span class="santu-ai-req">*</span></label>
					<input type="text" class="santu-ai-input santu-ai-item-name" value="${frappe.utils.escape_html(s.item_name)}" autocomplete="off" placeholder="e.g. Asian Paints Apex 20L / 12mm Washer">
					<div class="santu-ai-dupname"></div>
				</div>
				<div class="santu-ai-cell">
					<label>Category <span class="santu-ai-req">*</span></label>
					<select class="santu-ai-input santu-ai-category">
						<option value="">Choose category</option>
						${opts(groups, s.item_group)}
					</select>
				</div>
				<div class="santu-ai-cell">
					<label>Unit <span class="santu-ai-req">*</span></label>
					<select class="santu-ai-input santu-ai-uom">${opts(this.init_data.uoms || [], s.uom)}</select>
				</div>
			</div>
			<div class="santu-ai-grid4">
				<div class="santu-ai-cell">
					<div class="santu-ai-cell-head-inline">
						<label>Brand</label>
						<button type="button" class="santu-ai-link-btn santu-ai-add-brand-btn">+ Add</button>
					</div>
					<select class="santu-ai-input santu-ai-brand-select">
						${brand_opts}
					</select>
					<div class="santu-ai-other-brand-wrap" style="${is_other ? '' : 'display:none;'}">
						<input type="text" class="santu-ai-input santu-ai-brand-other-input" placeholder="Specify brand name" value="${frappe.utils.escape_html(other_text)}" autocomplete="off">
					</div>
				</div>
				<div class="santu-ai-cell">
					<label>Item Code / SKU</label>
					<div class="santu-ai-code-wrap">
						<input type="text" class="santu-ai-input santu-ai-item-code" placeholder="Auto-generated" value="${frappe.utils.escape_html(s.item_code)}" autocomplete="off">
						<button type="button" class="santu-ai-assign-btn" title="Naam se chhota code bana do">Naam se</button>
					</div>
				</div>
				<div class="santu-ai-cell">
					<label>Barcode</label>
					<input type="text" class="santu-ai-input santu-ai-barcode" value="${frappe.utils.escape_html(s.barcode)}" placeholder="Scan or type barcode" autocomplete="off">
				</div>
				<div class="santu-ai-cell">
					<label>Rack / Shelf Location</label>
					<input type="text" class="santu-ai-input santu-ai-location" value="${frappe.utils.escape_html(s.location)}" placeholder="e.g. Rack 3, top shelf">
				</div>
			</div>`
		);
	},

	_section_pricing_stock(s) {
		return this._sec(
			"pricing-stock",
			"Pricing & Stock",
			`
			<div class="santu-ai-grid4">
				<div class="santu-ai-cell">
					<label>Purchase Rate (CP)</label>
					<input type="number" min="0" step="any" class="santu-ai-input santu-ai-purchase-price" value="${s.purchase_price}" placeholder="0.00">
				</div>
				<div class="santu-ai-cell">
					<label>Selling Rate (SP)</label>
					<input type="number" min="0" step="any" class="santu-ai-input santu-ai-sale-price" value="${s.sale_price}" placeholder="0.00">
				</div>
				<div class="santu-ai-cell">
					<label>MRP</label>
					<input type="number" min="0" step="any" class="santu-ai-input santu-ai-mrp" value="${s.mrp}" placeholder="0.00">
				</div>
				<div class="santu-ai-cell santu-ai-margin-cell">
					<label>Live Margin</label>
					<div class="santu-ai-margin">—</div>
				</div>
			</div>
			<div class="santu-ai-grid4">
				<div class="santu-ai-cell">
					<label>Opening Stock</label>
					<input type="number" min="0" step="any" class="santu-ai-input santu-ai-opening-qty" value="${s.opening_qty}" placeholder="0">
				</div>
				<div class="santu-ai-cell">
					<label>Min Stock Alert</label>
					<input type="number" min="0" step="any" class="santu-ai-input santu-ai-min-stock" value="${s.min_stock}" placeholder="0">
				</div>
				<div class="santu-ai-cell">
					<label>Description</label>
					<input type="text" class="santu-ai-input santu-ai-description" value="${frappe.utils.escape_html(s.description)}" placeholder="Size, model, notes (optional)">
				</div>
				<div class="santu-ai-cell">
					<label>Item Photo</label>
					<div class="santu-ai-image-row">
						<button type="button" class="santu-ai-image-btn">${s.image ? "Change Photo" : "📷 Choose Photo"}</button>
						${s.image ? `<img class="santu-ai-image-preview" src="${frappe.utils.escape_html(s.image)}" alt=""><button type="button" class="santu-ai-image-clear" title="Remove">✕</button>` : ""}
					</div>
				</div>
			</div>`
		);
	},

	_section_advanced(s) {
		return `
			<div class="santu-ai-sec santu-ai-sec-adv" data-sec="advanced">
				<div class="santu-ai-sec-body">
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell">
							<label>GST Applicable</label>
							<label class="santu-ai-check" style="height:36px;"><input type="checkbox" class="santu-ai-gst-applicable" ${s.gst_applicable ? "checked" : ""}> Yes, GST lagta hai</label>
						</div>
						${
							s.gst_applicable
								? `
						<div class="santu-ai-cell">
							<label>GST Rate (%)</label>
							<select class="santu-ai-input santu-ai-gst-rate">
								<option value="">Select</option>
								${(this.init_data.gst_rates || []).map((r) => `<option value="${r}" ${r === s.gst_rate ? "selected" : ""}>${r}%</option>`).join("")}
							</select>
						</div>
						<div class="santu-ai-cell">
							<label>HSN / SAC</label>
							<div class="santu-ai-search-wrap">
								<input type="text" class="santu-ai-input santu-ai-hsn" placeholder="Search HSN" value="${frappe.utils.escape_html(s.gst_hsn_code)}" autocomplete="off">
								<div class="santu-ai-hsn-dropdown" style="display:none;"></div>
							</div>
						</div>`
								: `<div class="santu-ai-cell santu-ai-cell-span2"><div class="santu-ai-note">Non-GST item — bill me GST nahi lagega.</div></div>`
						}
					</div>
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell">
							<label>Wholesale Rate</label>
							<input type="number" min="0" step="any" class="santu-ai-input santu-ai-wholesale-price" value="${s.wholesale_price}" placeholder="0.00">
						</div>
						<div class="santu-ai-cell">
							<label>Minimum Selling Price</label>
							<input type="number" min="0" step="any" class="santu-ai-input santu-ai-min-selling" value="${s.min_selling_price}" placeholder="0.00">
						</div>
						<div class="santu-ai-cell">
							<label>Warehouse</label>
							<select class="santu-ai-input santu-ai-warehouse">
								${(this.init_data.warehouses || [])
									.map((w) => `<option value="${frappe.utils.escape_html(w)}" ${w === s.warehouse ? "selected" : ""}>${frappe.utils.escape_html(w)}</option>`)
									.join("")}
							</select>
						</div>
					</div>
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell">
							<label>Default Supplier</label>
							<input type="text" class="santu-ai-input santu-ai-supplier" list="santu-ai-supplierlist" value="${frappe.utils.escape_html(s.default_supplier)}" placeholder="Supplier name" autocomplete="off">
							<datalist id="santu-ai-supplierlist">
								${(this.init_data.suppliers || []).map((x) => `<option value="${frappe.utils.escape_html(x)}"></option>`).join("")}
							</datalist>
						</div>
						<div class="santu-ai-cell">
							<label>Supplier Item Code</label>
							<input type="text" class="santu-ai-input santu-ai-supplier-code" value="${frappe.utils.escape_html(s.supplier_item_code)}" placeholder="Optional">
						</div>
						<div class="santu-ai-cell">
							<label>Stock As Of Date</label>
							<input type="date" class="santu-ai-input santu-ai-as-of" value="${s.as_of_date}">
						</div>
					</div>
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell santu-ai-cell-wide">
							<label class="santu-ai-check"><input type="checkbox" class="santu-ai-track-batches" ${s.track_batches ? "checked" : ""}> Track batches for this item</label>
						</div>
					</div>
					${
						s.track_batches
							? `
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell">
							<label>Batch Number</label>
							<input type="text" class="santu-ai-input santu-ai-batch-no" value="${frappe.utils.escape_html(s.batch_no)}" placeholder="Auto">
						</div>
						<div class="santu-ai-cell">
							<label>Batch Purchase Rate</label>
							<input type="number" min="0" step="any" class="santu-ai-input santu-ai-batch-purchase" value="${s.batch_purchase_rate}" placeholder="Purchase rate">
						</div>
						<div class="santu-ai-cell">
							<label>Batch MRP</label>
							<input type="number" min="0" step="any" class="santu-ai-input santu-ai-batch-mrp" value="${s.batch_mrp}" placeholder="MRP">
						</div>
					</div>
					<div class="santu-ai-grid3">
						<div class="santu-ai-cell">
							<label>Batch Selling Rate</label>
							<input type="number" min="0" step="any" class="santu-ai-input santu-ai-batch-selling" value="${s.batch_selling_rate}" placeholder="Selling rate">
						</div>
						<div class="santu-ai-cell">
							<label>Expiry Date</label>
							<input type="date" class="santu-ai-input santu-ai-batch-expiry" value="${s.batch_expiry}">
						</div>
						<div class="santu-ai-cell"></div>
					</div>`
							: ""
					}
				</div>
			</div>`;
	},

	_refresh_save() {
		const s = this.state;
		// Name, Category and Unit are the three the spec makes required —
		// everything else stays optional so adding many items stays fast.
		const ok = !!((s.item_name || "").trim() && s.item_group && s.uom) && !this.saving;
		this.$root.find("[data-action='save'], [data-action='save-new']").prop("disabled", !ok);
	},

	_update_margin() {
		const s = this.state;
		const buy = Number(s.purchase_price) || 0;
		const sell = Number(s.sale_price) || 0;
		const $m = this.$root.find(".santu-ai-margin");
		if (!buy || !sell) {
			$m.text("—").removeClass("is-loss");
			return;
		}
		const diff = sell - buy;
		const pct = (diff / buy) * 100;
		$m.text(`₹${diff.toFixed(2)} (${pct.toFixed(1)}%)`).toggleClass("is-loss", diff < 0);
	},

	_bind() {
		const s = this.state;
		const $r = this.$root;

		// Scan while creating an item and the barcode fills itself in — the
		// product is in hand, which is exactly when capturing it is free.
		if (window.santu_barcode) {
			window.santu_barcode.listen((code) => {
				s.barcode = code;
				$r.find(".santu-ai-barcode").val(code);
				frappe.show_alert({ message: __("Barcode: {0}", [code]), indicator: "green" });
			}, "santu-add-item");
		}

		const bind = (sel, key, after) =>
			$r.find(sel).on("input change", (e) => {
				s[key] = e.target.value;
				if (after) after();
			});

		bind(".santu-ai-item-name", "item_name", () => {
			this._refresh_save();
			this._check_duplicate_name();
		});
		bind(".santu-ai-item-code", "item_code");
		bind(".santu-ai-category", "item_group", () => this._refresh_save());

		$r.find(".santu-ai-brand-select").on("change", (e) => {
			const val = e.target.value;
			if (val === "__new__") {
				$(e.target).val(s.brand_type === "Other" ? "Other" : (s.brand || ""));
				this._prompt_new_brand();
			} else if (val === "Other") {
				s.brand_type = "Other";
				const custom = ($r.find(".santu-ai-brand-other-input").val() || "").trim();
				s.brand = custom || "Other";
				$r.find(".santu-ai-other-brand-wrap").slideDown(150, () => {
					$r.find(".santu-ai-brand-other-input").trigger("focus");
				});
			} else {
				s.brand_type = "";
				s.brand = val;
				$r.find(".santu-ai-other-brand-wrap").slideUp(150);
			}
		});

		$r.find(".santu-ai-brand-other-input").on("input change", (e) => {
			const val = (e.target.value || "").trim();
			s.brand = val || "Other";
		});

		$r.find(".santu-ai-add-brand-btn").on("click", () => {
			this._prompt_new_brand();
		});

		bind(".santu-ai-uom", "uom", () => this._refresh_save());
		bind(".santu-ai-description", "description");
		bind(".santu-ai-barcode", "barcode");
		bind(".santu-ai-barcode-type", "barcode_type");
		bind(".santu-ai-purchase-price", "purchase_price", () => this._update_margin());
		bind(".santu-ai-sale-price", "sale_price", () => this._update_margin());
		bind(".santu-ai-mrp", "mrp");
		bind(".santu-ai-wholesale-price", "wholesale_price");
		bind(".santu-ai-min-selling", "min_selling_price");
		bind(".santu-ai-gst-rate", "gst_rate");
		bind(".santu-ai-opening-qty", "opening_qty");
		bind(".santu-ai-as-of", "as_of_date");
		bind(".santu-ai-min-stock", "min_stock");
		bind(".santu-ai-warehouse", "warehouse");
		bind(".santu-ai-location", "location");
		bind(".santu-ai-batch-no", "batch_no");
		bind(".santu-ai-batch-purchase", "batch_purchase_rate");
		bind(".santu-ai-batch-mrp", "batch_mrp");
		bind(".santu-ai-batch-selling", "batch_selling_rate");
		bind(".santu-ai-batch-expiry", "batch_expiry");
		bind(".santu-ai-supplier", "default_supplier");
		bind(".santu-ai-supplier-code", "supplier_item_code");

		$r.find(".santu-ai-active").on("change", (e) => (s.is_active = e.target.checked));

		// These change which fields exist, so they re-render.
		$r.find(".santu-ai-advanced-toggle").on("click", () => {
			this.show_advanced = !this.show_advanced;
			this.render();
		});
		$r.find(".santu-ai-gst-applicable").on("change", (e) => {
			s.gst_applicable = e.target.checked;
			this.render();
		});
		$r.find(".santu-ai-track-batches").on("change", (e) => {
			s.track_batches = e.target.checked;
			this.render();
		});

		$r.find(".santu-ai-add-altbar").on("click", () => {
			s.alternate_barcodes.push({ barcode: "" });
			this.render();
		});
		$r.find(".santu-ai-altbar").on("input change", (e) => {
			const i = $(e.target).closest(".santu-ai-altbar-row").data("idx");
			s.alternate_barcodes[i].barcode = e.target.value;
		});
		$r.find(".santu-ai-altbar-remove").on("click", (e) => {
			const i = $(e.target).closest(".santu-ai-altbar-row").data("idx");
			s.alternate_barcodes.splice(i, 1);
			this.render();
		});

		$r.find(".santu-ai-assign-btn").on("click", () => this._assign_code());
		$r.find(".santu-ai-image-btn").on("click", () => this._pick_image());
		$r.find(".santu-ai-image-clear").on("click", () => {
			s.image = "";
			this.render();
		});
		$r.find(".santu-ai-close").on("click", () => frappe.set_route("santu-stock"));

		$r.find(".santu-ai-hsn").on(
			"input",
			frappe.utils.debounce((e) => this._hsn_search($(e.target).val()), 250)
		);
		$(document)
			.off("click.santu-ai")
			.on("click.santu-ai", (e) => {
				if (!$(e.target).closest(".santu-ai-search-wrap").length) $r.find(".santu-ai-hsn-dropdown").hide();
			});

		$r.find("[data-action='save']").on("click", () => this._save(false));
		$r.find("[data-action='save-new']").on("click", () => this._save(true));
		$(document)
			.off("keydown.santu-ai")
			.on("keydown.santu-ai", (e) => {
				if ((e.ctrlKey || e.metaKey) && e.key === "s" && frappe.get_route()[0] === "santu-add-item") {
					e.preventDefault();
					this._save(false);
				}
			});

		this._update_margin();
	},

	// Same duplicate warning the sale screen's quick-create shows: say so,
	// never refuse — the same name in two pack sizes is normal here.
	_check_duplicate_name() {
		const name = (this.state.item_name || "").trim();
		const $slot = this.$root.find(".santu-ai-dupname");
		if (!name || name.length < 3) return $slot.empty();
		if (this._dup_timer) clearTimeout(this._dup_timer);
		this._dup_timer = setTimeout(() => {
			frappe
				.xcall("santu_hardware.santu_hardware.api.items_with_same_name", { item_name: name })
				.then((matches) => {
					$slot.empty();
					if (matches && matches.length) {
						$slot.html(`<span class="santu-ai-warn">Is naam ka saman pehle se hai: ${matches.map((m) => frappe.utils.escape_html(m.item_code)).join(", ")}</span>`);
					}
				})
				.catch(() => $slot.empty());
		}, 400);
	},

	_pick_image() {
		new frappe.ui.FileUploader({
			doctype: "Item",
			folder: "Home/Attachments",
			on_success: (file) => {
				this.state.image = file.file_url;
				this.render();
				frappe.show_alert({ message: __("Photo added"), indicator: "green" });
			},
		});
	},

	_hsn_search(q) {
		const $dd = this.$root.find(".santu-ai-hsn-dropdown");
		this.state.gst_hsn_code = q;
		if (!q || q.length < 2) {
			$dd.hide().empty();
			return;
		}
		frappe
			.call({
				method: "frappe.desk.search.search_link",
				args: { doctype: "GST HSN Code", txt: q, page_length: 8 },
			})
			.then((r) => {
				$dd.empty();
				(r.message || []).forEach((row) => {
					$(`
						<div class="santu-ai-dd-row">
							<b>${frappe.utils.escape_html(row.value)}</b>
							<span>${frappe.utils.escape_html((row.description || "").replace(row.value + ", ", ""))}</span>
						</div>
					`)
						.on("click", () => {
							this.state.gst_hsn_code = row.value;
							this.$root.find(".santu-ai-hsn").val(row.value);
							$dd.hide().empty();
						})
						.appendTo($dd);
				});
				if (!(r.message || []).length) {
					$dd.append(`<div class="santu-ai-dd-row santu-ai-dd-empty">No matching code</div>`);
				}
				$dd.show();
			});
	},

	_prompt_new_brand() {
		frappe.prompt(
			[
				{
					label: __("Brand Name"),
					fieldname: "brand_name",
					fieldtype: "Data",
					reqd: 1,
					placeholder: "e.g. Pidilite / Astral / Supreme",
				},
			],
			(values) => {
				const name = (values.brand_name || "").trim();
				if (!name) return;
				frappe
					.xcall("santu_hardware.santu_hardware.api.create_brand", { brand_name: name })
					.then((r) => {
						const bname = (r && r.brand) || name;
						if (!this.init_data.brands.includes(bname)) {
							this.init_data.brands.push(bname);
							this.init_data.brands.sort((a, b) => a.localeCompare(b));
						}
						this.state.brand_type = "";
						this.state.brand = bname;
						this.render();
						frappe.show_alert({ message: __("Brand '{0}' added", [bname]), indicator: "green" });
					})
					.catch(() => {
						frappe.msgprint(__("Could not add brand."));
					});
			},
			__("Add New Brand"),
			__("Add Brand")
		);
	},

	_assign_code() {
		const name = (this.state.item_name || "").trim();
		if (!name) {
			frappe.show_alert({ message: __("Enter the item name first."), indicator: "orange" });
			return;
		}
		const code = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
		this.state.item_code = code;
		this.$root.find(".santu-ai-item-code").val(code);
	},

	_save(and_new) {
		const s = this.state;
		// Guard against a double-click firing two saves — the request is not
		// instant and two clicks would create two items.
		if (this.saving) return;
		if (!(s.item_name || "").trim()) return frappe.msgprint(__("Enter an item name."));
		if (!s.item_group) return frappe.msgprint(__("Choose a category."));
		if (!s.uom) return frappe.msgprint(__("Choose a unit."));

		this.saving = true;
		this._refresh_save();
		frappe.dom.freeze(__("Saving…"));
		frappe
			.xcall("santu_hardware.santu_hardware.api.save_item", {
				item_json: JSON.stringify({
					item_name: s.item_name,
					item_code: s.item_code || null,
					is_service: s.is_service ? 1 : 0,
					is_active: s.is_active ? 1 : 0,
					item_group: s.item_group || null,
					sub_category: s.sub_category || null,
					brand: s.brand || null,
					uom: s.uom,
					description: s.description || null,
					image: s.image || null,
					barcode: s.barcode || null,
					barcode_type: s.barcode_type || null,
					alternate_barcodes: s.alternate_barcodes.filter((b) => (b.barcode || "").trim()),
					purchase_price: s.purchase_price || 0,
					sale_price: s.sale_price || 0,
					mrp: s.mrp || 0,
					wholesale_price: s.wholesale_price || 0,
					min_selling_price: s.min_selling_price || 0,
					gst_applicable: s.gst_applicable ? 1 : 0,
					gst_rate: s.gst_rate || null,
					gst_hsn_code: s.gst_applicable ? s.gst_hsn_code || null : null,
					opening_qty: s.opening_qty || 0,
					at_price: s.at_price || 0,
					as_of_date: s.as_of_date,
					min_stock: s.min_stock || 0,
					warehouse: s.warehouse || null,
					location: s.location || null,
					track_batches: s.track_batches ? 1 : 0,
					batch_no: s.batch_no || null,
					batch_mrp: s.batch_mrp || 0,
					batch_purchase_rate: s.batch_purchase_rate || 0,
					batch_selling_rate: s.batch_selling_rate || 0,
					batch_expiry: s.batch_expiry || null,
					default_supplier: s.default_supplier || null,
					supplier_item_code: s.supplier_item_code || null,
				}),
			})
			.then((r) => {
				frappe.dom.unfreeze();
				this.saving = false;
				const bits = [`${r.item_name} saved`];
				if (r.opening_qty) bits.push(`Opening Stock: ${r.opening_qty} ${santu_uom.abbr(r.uom)}`);
				if (r.min_stock) bits.push(`Minimum Stock: ${r.min_stock} ${santu_uom.abbr(r.uom)}`);
				if (r.current_stock) bits.push(`Current Stock: ${r.current_stock} ${santu_uom.abbr(r.uom)}`);
				if (r.batch_no) bits.push(`Batch: ${r.batch_no}`);
				frappe.show_alert({ message: bits.join(" · "), indicator: "green" }, 7);
				if (and_new) this.reset();
				else frappe.set_route("santu-stock");
			})
			.catch(() => {
				frappe.dom.unfreeze();
				this.saving = false;
				this._refresh_save();
			});
	},
};
