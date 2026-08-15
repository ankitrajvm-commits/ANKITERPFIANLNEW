/* global frappe, santu_add_item_page */
// Santu Hardware — Add Item, laid out from the real Vyapar screen
// (2026-08-15: "abhi v items- add items wali page vyapaar wali nh hai, use
// vyapaar wali ui kro", with a screenshot of Vyapar's own Add Item page).
//
// This replaced a frappe.ui.Dialog, which was the wrong shape entirely:
// Vyapar's Add Item is a full page with a Product/Service toggle, an HSN
// search, a unit picker, and Pricing / Stock tabs. A modal with Frappe
// controls could never read as the same product no matter which fields it
// carried.
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
		this.state = {
			is_service: false,
			tab: "pricing",
			item_name: "",
			gst_hsn_code: "",
			uom: this.init_data.default_uom,
			item_group: "",
			item_code: "",
			sale_price: "",
			sale_price_tax_mode: "Without Tax",
			discount: "",
			discount_mode: "Percentage",
			wholesale_open: false,
			wholesale_price: "",
			purchase_price: "",
			purchase_price_tax_mode: "Without Tax",
			tax_rate: "None",
			opening_qty: "",
			at_price: "",
			as_of_date: frappe.datetime.get_today(),
			min_stock: "",
			location: "",
			barcode: "",
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
							<div class="santu-ai-toggle-wrap">
								<span class="santu-ai-toggle-label ${s.is_service ? "" : "is-on"}">Product</span>
								<button type="button" class="santu-ai-toggle ${s.is_service ? "is-service" : ""}" role="switch" aria-checked="${s.is_service}">
									<span class="santu-ai-toggle-knob"></span>
								</button>
								<span class="santu-ai-toggle-label ${s.is_service ? "is-on" : ""}">Service</span>
							</div>
						</div>
						<div class="santu-ai-head-right">
							<button type="button" class="santu-ai-icon-btn santu-ai-close" title="Close">✕</button>
						</div>
					</div>

					<div class="santu-ai-fields">
						<div class="santu-ai-row">
							<div class="santu-ai-field santu-ai-field-name">
								<label class="santu-ai-float-label">Item Name <span class="santu-ai-req">*</span></label>
								<input type="text" class="santu-ai-input santu-ai-item-name" value="${frappe.utils.escape_html(s.item_name)}" autocomplete="off">
							</div>
							<div class="santu-ai-field">
								<div class="santu-ai-search-wrap">
									<input type="text" class="santu-ai-input santu-ai-hsn" placeholder="Item HSN" value="${frappe.utils.escape_html(s.gst_hsn_code)}" autocomplete="off">
									<span class="santu-ai-search-icon">🔍</span>
									<div class="santu-ai-hsn-dropdown" style="display:none;"></div>
								</div>
							</div>
							<div class="santu-ai-field santu-ai-field-unit">
								<button type="button" class="santu-ai-unit-btn">${s.uom ? frappe.utils.escape_html(s.uom) : "Select Unit"}</button>
							</div>
							<div class="santu-ai-field santu-ai-field-image">
								<button type="button" class="santu-ai-image-btn"><span>📷</span> Add Item Image</button>
							</div>
						</div>

						<div class="santu-ai-row">
							<div class="santu-ai-field santu-ai-field-name">
								<select class="santu-ai-input santu-ai-category">
									<option value="">Category</option>
									${(this.init_data.item_groups || [])
										.map((g) => `<option value="${frappe.utils.escape_html(g)}" ${g === s.item_group ? "selected" : ""}>${frappe.utils.escape_html(g)}</option>`)
										.join("")}
								</select>
							</div>
							<div class="santu-ai-field">
								<div class="santu-ai-code-wrap">
									<input type="text" class="santu-ai-input santu-ai-item-code" placeholder="Item Code" value="${frappe.utils.escape_html(s.item_code)}" autocomplete="off">
									<button type="button" class="santu-ai-assign-btn">Assign Code</button>
								</div>
							</div>
						</div>
					</div>

					<div class="santu-ai-tabs">
						<button type="button" class="santu-ai-tab ${s.tab === "pricing" ? "is-active" : ""}" data-tab="pricing">Pricing</button>
						<button type="button" class="santu-ai-tab ${s.tab === "stock" ? "is-active" : ""}" data-tab="stock" ${s.is_service ? "disabled" : ""}>Stock</button>
					</div>

					<div class="santu-ai-tabbody"></div>
				</div>

				<div class="santu-ai-footer">
					<button type="button" class="santu-ai-btn santu-ai-btn-ghost" data-action="save-new">Save &amp; New</button>
					<button type="button" class="santu-ai-btn santu-ai-btn-primary" data-action="save" disabled>Save</button>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-ai");
		this._render_tab();
		this._bind();
		this._refresh_save();
	},

	_render_tab() {
		const s = this.state;
		const $b = this.$root.find(".santu-ai-tabbody");
		if (s.tab === "stock") {
			$b.html(`
				<div class="santu-ai-panel">
					<div class="santu-ai-section">
						<div class="santu-ai-section-title">Stock</div>
						<div class="santu-ai-grid">
							<div class="santu-ai-cell">
								<label>Opening Quantity</label>
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-opening-qty" value="${s.opening_qty}" placeholder="0">
							</div>
							<div class="santu-ai-cell">
								<label>At Price</label>
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-at-price" value="${s.at_price}" placeholder="0">
							</div>
							<div class="santu-ai-cell">
								<label>As Of Date</label>
								<input type="date" class="santu-ai-input santu-ai-as-of" value="${s.as_of_date}">
							</div>
						</div>
						<div class="santu-ai-grid">
							<div class="santu-ai-cell">
								<label>Min Stock To Maintain</label>
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-min-stock" value="${s.min_stock}" placeholder="0">
							</div>
							<div class="santu-ai-cell">
								<label>Location</label>
								<input type="text" class="santu-ai-input santu-ai-location" value="${frappe.utils.escape_html(s.location)}" placeholder="Rack / shelf">
							</div>
							<div class="santu-ai-cell">
								<label>Barcode</label>
								<input type="text" class="santu-ai-input santu-ai-barcode" value="${frappe.utils.escape_html(s.barcode)}" placeholder="Scan or type">
							</div>
						</div>
					</div>
				</div>
			`);
		} else {
			$b.html(`
				<div class="santu-ai-panel">
					<div class="santu-ai-section">
						<div class="santu-ai-section-title">Sale Price</div>
						<div class="santu-ai-inline">
							<div class="santu-ai-pair">
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-sale-price" placeholder="Sale Price" value="${s.sale_price}">
								<select class="santu-ai-input santu-ai-sale-tax-mode">
									<option ${s.sale_price_tax_mode === "Without Tax" ? "selected" : ""}>Without Tax</option>
									<option ${s.sale_price_tax_mode === "With Tax" ? "selected" : ""}>With Tax</option>
								</select>
							</div>
							<div class="santu-ai-pair">
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-discount" placeholder="Disc. On Sale Price" value="${s.discount}">
								<select class="santu-ai-input santu-ai-discount-mode">
									<option ${s.discount_mode === "Percentage" ? "selected" : ""}>Percentage</option>
									<option ${s.discount_mode === "Amount" ? "selected" : ""}>Amount</option>
								</select>
							</div>
						</div>
						${
							s.wholesale_open
								? `<div class="santu-ai-inline santu-ai-wholesale">
										<div class="santu-ai-pair">
											<input type="number" min="0" step="any" class="santu-ai-input santu-ai-wholesale-price" placeholder="Wholesale Price" value="${s.wholesale_price}">
										</div>
									</div>`
								: `<button type="button" class="santu-ai-link santu-ai-add-wholesale">+ Add Wholesale Price</button>`
						}
					</div>

					<div class="santu-ai-two-col">
						<div class="santu-ai-section">
							<div class="santu-ai-section-title">Purchase Price</div>
							<div class="santu-ai-pair">
								<input type="number" min="0" step="any" class="santu-ai-input santu-ai-purchase-price" placeholder="Purchase Price" value="${s.purchase_price}">
								<select class="santu-ai-input santu-ai-purchase-tax-mode">
									<option ${s.purchase_price_tax_mode === "Without Tax" ? "selected" : ""}>Without Tax</option>
									<option ${s.purchase_price_tax_mode === "With Tax" ? "selected" : ""}>With Tax</option>
								</select>
							</div>
						</div>
						<div class="santu-ai-section">
							<div class="santu-ai-section-title">Taxes</div>
							<div class="santu-ai-cell">
								<label>Tax Rate</label>
								<select class="santu-ai-input santu-ai-tax-rate">
									${["None", "GST@0%", "GST@5%", "GST@12%", "GST@18%", "GST@28%"]
										.map((t) => `<option ${t === s.tax_rate ? "selected" : ""}>${t}</option>`)
										.join("")}
								</select>
							</div>
						</div>
					</div>
				</div>
			`);
		}
	},

	_refresh_save() {
		// Vyapar keeps Save greyed until the row is actually saveable. Item
		// name is the one hard requirement here; HSN is enforced separately
		// by GST settings and surfaced as an error if missing.
		const ok = !!(this.state.item_name || "").trim();
		this.$root.find("[data-action='save']").prop("disabled", !ok);
	},

	_bind() {
		const s = this.state;
		const $r = this.$root;
		const set = (sel, key, num) =>
			$r.find(sel).on("input change", (e) => {
				s[key] = num ? e.target.value : e.target.value;
				if (key === "item_name") this._refresh_save();
			});

		set(".santu-ai-item-name", "item_name");
		set(".santu-ai-item-code", "item_code");
		set(".santu-ai-category", "item_group");
		set(".santu-ai-sale-price", "sale_price");
		set(".santu-ai-sale-tax-mode", "sale_price_tax_mode");
		set(".santu-ai-discount", "discount");
		set(".santu-ai-discount-mode", "discount_mode");
		set(".santu-ai-wholesale-price", "wholesale_price");
		set(".santu-ai-purchase-price", "purchase_price");
		set(".santu-ai-purchase-tax-mode", "purchase_price_tax_mode");
		set(".santu-ai-tax-rate", "tax_rate");
		set(".santu-ai-opening-qty", "opening_qty");
		set(".santu-ai-at-price", "at_price");
		set(".santu-ai-as-of", "as_of_date");
		set(".santu-ai-min-stock", "min_stock");
		set(".santu-ai-location", "location");
		set(".santu-ai-barcode", "barcode");

		$r.find(".santu-ai-toggle").on("click", () => {
			s.is_service = !s.is_service;
			// A service has no stock, so the Stock tab goes with it.
			if (s.is_service && s.tab === "stock") s.tab = "pricing";
			this.render();
		});

		$r.find(".santu-ai-tab").on("click", (e) => {
			const t = $(e.currentTarget).data("tab");
			if (t === "stock" && s.is_service) return;
			s.tab = t;
			this.render();
		});

		$r.find(".santu-ai-add-wholesale").on("click", () => {
			s.wholesale_open = true;
			this._render_tab();
			this._bind();
		});

		$r.find(".santu-ai-unit-btn").on("click", () => this._pick_unit());
		$r.find(".santu-ai-assign-btn").on("click", () => this._assign_code());
		$r.find(".santu-ai-image-btn").on("click", () =>
			frappe.show_alert({ message: __("Add the image from the item's own screen after saving."), indicator: "blue" })
		);
		$r.find(".santu-ai-close").on("click", () => frappe.set_route("santu-items"));

		// HSN typed as free text, searched against the 18,687 GST HSN Code
		// records by description — nobody memorises these.
		$r.find(".santu-ai-hsn").on(
			"input",
			frappe.utils.debounce((e) => this._hsn_search($(e.target).val()), 250)
		);
		$(document).off("click.santu-ai").on("click.santu-ai", (e) => {
			if (!$(e.target).closest(".santu-ai-search-wrap").length) $r.find(".santu-ai-hsn-dropdown").hide();
		});

		$r.find("[data-action='save']").on("click", () => this._save(false));
		$r.find("[data-action='save-new']").on("click", () => this._save(true));
		$(document).off("keydown.santu-ai").on("keydown.santu-ai", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s" && frappe.get_route()[0] === "santu-add-item") {
				e.preventDefault();
				this._save(false);
			}
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

	_pick_unit() {
		const s = this.state;
		const d = new frappe.ui.Dialog({
			title: __("Select Unit"),
			fields: [
				{
					fieldtype: "Select",
					fieldname: "uom",
					label: __("Unit"),
					options: (this.init_data.uoms || []).join("\n"),
					default: s.uom,
				},
			],
			primary_action_label: __("Select"),
			primary_action: (v) => {
				s.uom = v.uom;
				this.$root.find(".santu-ai-unit-btn").text(v.uom);
				d.hide();
			},
		});
		d.show();
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
		if (!(s.item_name || "").trim()) {
			frappe.msgprint(__("Enter an item name."));
			return;
		}
		frappe.dom.freeze(__("Saving…"));
		frappe
			.xcall("santu_hardware.santu_hardware.api.save_item", {
				item_json: JSON.stringify({
					item_name: s.item_name,
					item_code: s.item_code || null,
					is_service: s.is_service ? 1 : 0,
					gst_hsn_code: s.gst_hsn_code || null,
					uom: s.uom,
					item_group: s.item_group || null,
					sale_price: s.sale_price || 0,
					sale_price_tax_mode: s.sale_price_tax_mode,
					discount: s.discount || 0,
					discount_mode: s.discount_mode,
					wholesale_price: s.wholesale_price || 0,
					purchase_price: s.purchase_price || 0,
					purchase_price_tax_mode: s.purchase_price_tax_mode,
					tax_rate: s.tax_rate,
					opening_qty: s.opening_qty || 0,
					at_price: s.at_price || 0,
					as_of_date: s.as_of_date,
					min_stock: s.min_stock || 0,
					location: s.location || null,
					barcode: s.barcode || null,
				}),
			})
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({
					message: r.opening_qty
						? __("{0} added with {1} in stock", [r.item_name, r.opening_qty])
						: __("{0} added", [r.item_name]),
					indicator: "green",
				});
				if (and_new) this.reset();
				else frappe.set_route("santu-items");
			})
			.catch(() => frappe.dom.unfreeze());
	},
};
