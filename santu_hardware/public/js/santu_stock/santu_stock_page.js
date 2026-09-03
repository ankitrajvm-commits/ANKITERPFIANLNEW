/* global frappe, santu_stock, format_number */
frappe.provide("santu_stock");

// The Stock Summary screen's controller factory. Lives as a static asset so
// the Reports page can embed this exact screen rather than re-skinning a
// generic report — same arrangement santu_sale uses, and for the same reason:
// the shop should only ever learn one stock table. Each caller gets its own
// instance so the standalone page and an embedded copy never share $root.
santu_stock.create_page = function () {
	return {
	init($container, opts = {}) {
		this.$container = $container;
		this.page = opts.page || null;
		// Reports embeds this same screen twice: once plainly, and once as
		// "Low Stock Summary" with the filter already switched on.
		this.state = {
			search: "",
			item_group: "",
			only_low: !!opts.only_low,
			sort: "item_name",
			dir: 1,
			stock_first: true,
			// Services tab removed from this screen entirely (2026-08-18
			// direct request) — only ever "product" now, no UI left to change
			// it. Left as a field (not deleted outright) since the backend
			// query still filters on it.
			item_type: "product",
		};
		this.render_shell();
		this.apply_route_options();
		this.load();
		this.listen_for_scans();
	},

	// Lets anything in the app open this screen focused on one item or
	// category, the way the old Items screen did — used by Low Stock rows,
	// Utilities item lists, and anywhere else that used to route to
	// "santu-items".
	apply_route_options() {
		const opts = frappe.route_options || {};
		frappe.route_options = null;
		if (opts.item_group) {
			this.state.item_group = opts.item_group;
			this.$group.val(opts.item_group);
		}
		if (opts.item_code) {
			this._pending_detail_code = opts.item_code;
		}
		return !!(opts.item_code || opts.item_group);
	},

	render_shell() {
		const $root = $(`
			<div class="santu-stock">
				<div class="santu-stock-header">
					<div class="santu-stock-title">Stock Summary</div>
					<div class="santu-stock-header-actions">
						<button type="button" class="btn santu-stock-add-btn">+ Add Item</button>
						<button type="button" class="btn santu-stock-more-btn" title="${__("Category, Units")}">⋮</button>
					</div>
				</div>

				<div class="santu-stock-filters">
					<div class="santu-stock-search-wrap">
						<span class="santu-stock-search-icon" aria-hidden="true">🔍</span>
						<input type="text" class="santu-stock-search" placeholder="Search item, code or rack">
					</div>
					<select class="santu-stock-group" aria-label="Category"><option value="">All Categories</option></select>
					<label class="santu-stock-lowtoggle">
						<input type="checkbox" class="santu-stock-only-low"> Only low stock
					</label>
					<button type="button" class="santu-stock-refresh" title="Refresh">↻</button>
				</div>

				<div class="santu-stock-cards"></div>
				<div class="santu-stock-table-wrap"></div>
			</div>
		`).appendTo(this.$container);

		this.$root = $root;
		this.$cards = $root.find(".santu-stock-cards");
		this.$table = $root.find(".santu-stock-table-wrap");
		this.$group = $root.find(".santu-stock-group");
		this.$lowtoggle = $root.find(".santu-stock-lowtoggle");

		let timer = null;
		$root.find(".santu-stock-search").on("input", (e) => {
			this.state.search = e.target.value;
			clearTimeout(timer);
			timer = setTimeout(() => this.load(), 300);
		});
		this.$group.on("change", (e) => {
			this.state.item_group = e.target.value;
			this.load();
		});
		$root.find(".santu-stock-only-low").on("change", (e) => {
			this.state.only_low = e.target.checked;
			this.load();
		});
		$root.find(".santu-stock-only-low").prop("checked", this.state.only_low);
		// Click the Running Low card itself instead of hunting for the
		// checkbox (2026-09-03 direct request: "only low stock ko click
		// karna pad raha hai, running low click karte hi dikhna chahiye").
		// Delegated on the cards container, which gets emptied and
		// rebuilt on every load() — a direct binding wouldn't survive that.
		this.$cards.on("click", ".santu-stock-card-warn", () => {
			this.state.only_low = true;
			$root.find(".santu-stock-only-low").prop("checked", true);
			this.load();
		});
		$root.find(".santu-stock-refresh").on("click", () => this.load());
		$root.find(".santu-stock-add-btn").on("click", () => frappe.set_route("santu-add-item"));
		$root.find(".santu-stock-more-btn").on("click", (e) => this.show_more_menu($(e.currentTarget)));

	},

	// The old Items screen's Category/Units tabs, folded into one menu here
	// rather than two more tabs — this table only ever lists items, and
	// categories/units are managed occasionally, not browsed daily.
	show_more_menu($anchor) {
		const items = [
			{ label: __("Manage Categories"), action: () => this.manage_categories() },
			{ label: __("Manage Units"), action: () => this.manage_units() },
		];
		const $menu = $(`<div class="santu-topbar-menu"></div>`);
		items.forEach((item) => {
			$(`<button type="button">${frappe.utils.escape_html(item.label)}</button>`)
				.on("click", () => {
					$menu.remove();
					item.action();
				})
				.appendTo($menu);
		});
		$(".santu-topbar-menu").remove();
		$("body").append($menu);
		const rect = $anchor[0].getBoundingClientRect();
		const menu_width = $menu.outerWidth();
		let left = rect.left;
		if (left + menu_width > window.innerWidth) {
			left = rect.right - menu_width;
		}
		left = Math.max(8, left);
		$menu.css({ top: rect.bottom + 6 + "px", left: left + "px" });
		setTimeout(() => {
			$(document).one("click.santu-stock-more-menu", (e) => {
				if (!$(e.target).closest(".santu-topbar-menu").length) $menu.remove();
			});
		}, 0);
	},

	// Loads the old Items screen's detail/category/unit modules on first use
	// — this table only opens them occasionally (a row, or Manage
	// Categories/Units), so there is no reason to ship them with the page
	// on every load the way the table itself is.
	_require_items_modules() {
		if (this._items_modules_ready) return this._items_modules_ready;
		if (!$("link[href*='santu_items.css']").length) {
			$("<link>", { rel: "stylesheet", href: "/assets/santu_hardware/css/santu_items.css" }).appendTo("head");
		}
		this._items_modules_ready = new Promise((resolve) => {
			frappe.require(
				[
					"/assets/santu_hardware/js/santu_items/santu_items_utils.js",
					"/assets/santu_hardware/js/santu_items/santu_items_api.js",
					"/assets/santu_hardware/js/santu_items/santu_items_transactions.js",
					"/assets/santu_hardware/js/santu_items/santu_items_detail.js",
				],
				resolve
			);
		});
		return this._items_modules_ready;
	},

	// Full item detail + sale/purchase transaction history — the one thing
	// the old Items screen had that this table's inline-editable cells and
	// Batches/purchase-history dialogs don't cover (2026-08-17 merge: this
	// table is now the one place items live, so this has to live here too).
	// A Dialog rather than a side panel, since this table has no second
	// column to put one in.
	show_item_detail(row) {
		this._require_items_modules().then(() => {
			const d = new frappe.ui.Dialog({
				title: row.item_name,
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "body", options: `<div class="santu-items-detail-panel santu-stock-detail-dialog"></div>` }],
			});
			d.show();
			santu_items.detail.show(d.$wrapper.find(".santu-stock-detail-dialog"), row.item_code);
		});
	},

	// The old Items screen's Category tab (browse categories, rename, see
	// what's inside), reached from the ⋮ menu now instead of its own tab —
	// this table's own Category dropdown already covers day-to-day
	// filtering, so this is for the occasional "rename/inspect" instead.
	manage_categories() {
		this._require_items_modules().then(async () => {
			const data = await santu_items.api.get_item_groups(null);
			const rows = [
				...(data.uncategorized && data.uncategorized.item_count > 0 ? [{ ...data.uncategorized, uncategorized: true }] : []),
				...data.categories,
			];
			const d = new frappe.ui.Dialog({
				title: __("Categories"),
				fields: [{ fieldtype: "HTML", fieldname: "body", options: `<div class="santu-stock-master-list"></div>` }],
			});
			d.show();
			const $list = d.$wrapper.find(".santu-stock-master-list");
			const render = () => {
				$list.html(
					rows
						.map(
							(r, i) => `
					<div class="santu-stock-master-row" data-i="${i}">
						<span>${frappe.utils.escape_html(r.name)}</span>
						<span class="santu-stock-master-count">${r.item_count} ${__("items")}</span>
						${r.uncategorized ? "" : `<button type="button" class="santu-stock-master-rename" data-i="${i}">${__("Rename")}</button>`}
					</div>`
						)
						.join("")
				);
				$list.find(".santu-stock-master-rename").on("click", (e) => {
					e.stopPropagation();
					const r = rows[$(e.currentTarget).data("i")];
					const rd = new frappe.ui.Dialog({
						title: __("Rename Category"),
						fields: [{ fieldtype: "Data", fieldname: "new_name", label: __("Category name"), reqd: 1, default: r.name }],
						primary_action_label: __("Save"),
						primary_action: (v) => {
							frappe.dom.freeze(__("Saving…"));
							frappe
								.xcall("santu_hardware.santu_hardware.api.rename_item_master", {
									doctype: "Item Group",
									old_name: r.name,
									new_name: v.new_name,
								})
								.then(() => {
									frappe.dom.unfreeze();
									rd.hide();
									frappe.show_alert({ message: __("Renamed"), indicator: "green" });
									r.name = v.new_name;
									render();
									this.load();
								})
								.catch(() => frappe.dom.unfreeze());
						},
					});
					rd.show();
				});
			};
			render();
		});
	},

	// The old Items screen's Units tab — the one real capability it had
	// that nothing else in this app replaces: UOM conversions (1 Box =
	// 10 Nos). The smart UOM dropdown on item creation already covers
	// picking a unit; this is for defining how units relate to each other.
	manage_units() {
		this._require_items_modules().then(async () => {
			const rows = await santu_items.api.get_uoms(null);
			const d = new frappe.ui.Dialog({
				title: __("Units"),
				fields: [{ fieldtype: "HTML", fieldname: "body", options: `<div class="santu-stock-master-list"></div>` }],
			});
			d.show();
			const $list = d.$wrapper.find(".santu-stock-master-list");
			$list.html(
				rows
					.map(
						(r, i) => `<div class="santu-stock-master-row" data-i="${i}"><span>${frappe.utils.escape_html(r.uom_name || r.name)}</span><span class="santu-stock-master-count">${__("Conversions")} ▸</span></div>`
					)
					.join("")
			);
			$list.find(".santu-stock-master-row").on("click", (e) => {
				const r = rows[$(e.currentTarget).data("i")];
				const ud = new frappe.ui.Dialog({
					title: r.uom_name || r.name,
					fields: [{ fieldtype: "HTML", fieldname: "body", options: `<div class="santu-items-detail-panel santu-stock-detail-dialog"></div>` }],
				});
				ud.show();
				santu_items.detail.show_unit(ud.$wrapper.find(".santu-stock-detail-dialog"), r);
			});
		});
	},


	// Attach (or replace) an item's barcode without leaving this list.
	//
	// Turns the barcode line into a box, right there in the row — no dialog.
	// The list underneath does not move or reflow, so the place you were
	// looking a second ago is still exactly where your eyes are.
	edit_barcode($cell, row) {
		if ($cell.data("editing")) return; // already open
		$cell.data("editing", true);
		const existing = row.barcodes || "";

		$cell.html(`
			<span class="santu-stock-barcode-inline">
				<input type="text" class="santu-stock-barcode-input" value="${frappe.utils.escape_html(existing)}" placeholder="${__("Scan karein ya type karein")}">
				<button type="button" class="santu-stock-barcode-save" title="${__("Save")}">✓</button>
				<button type="button" class="santu-stock-barcode-cancel" title="${__("Cancel")}">✕</button>
			</span>
		`);
		const $input = $cell.find(".santu-stock-barcode-input");
		$input.trigger("focus").trigger("select");

		// The scanner points here while this box is open. Stopped on save,
		// cancel, or losing focus — never left pointed at a row that closed.
		const previous_listener_active = window.santu_barcode && window.santu_barcode.is_listening();
		const release_scanner = () => {
			if (!window.santu_barcode) return;
			window.santu_barcode.stop("santu-stock-barcode-inline");
			if (previous_listener_active) this.listen_for_scans();
		};
		if (window.santu_barcode) {
			window.santu_barcode.listen((code) => {
				$input.val(code);
				save();
			}, "santu-stock-barcode-inline");
		}

		const close = () => {
			release_scanner();
			$cell.data("editing", false);
			this.render_row_barcode($cell, row);
		};

		const save = () => {
			const code = $input.val().trim();
			if (!code || code === existing) return close();
			frappe
				.xcall("santu_hardware.santu_hardware.api.attach_barcode_to_item", {
					item_code: row.item_code,
					barcode: code,
				})
				.then(() => {
					row.barcodes = code;
					frappe.show_alert({
						message: __("{0} par barcode lag gaya", [row.item_name]),
						indicator: "green",
					});
					close();
				})
				.catch((err) => {
					frappe.show_alert({
						message: (err && err.message) || __("Ye barcode shayad kisi aur saman par laga hai."),
						indicator: "red",
					});
					$input.trigger("focus").trigger("select");
				});
		};

		$cell.find(".santu-stock-barcode-save").on("click", (e) => {
			e.stopPropagation();
			save();
		});
		$cell.find(".santu-stock-barcode-cancel").on("click", (e) => {
			e.stopPropagation();
			close();
		});
		$input.on("click", (e) => e.stopPropagation());
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				save();
			}
			if (e.key === "Escape") close();
		});
	},

	// Item master fields editable from this list — name and its Link fields.
	// Matches EDITABLE_ITEM_FIELDS in api.py; kept here only for label/kind,
	// the server is the actual gatekeeper of what may be written.
	// key = row's own key in the data returned by get_stock_summary();
	// field = the actual Item fieldname to send to update_item_field()
	// (only differs from key for hsn_code/rack, where the summary query
	// aliases the column to a friendlier name than the underlying field).
	EDIT_FIELD_SPECS: {
		item_name: { field: "item_name", kind: "data", label: "Naam" },
		item_group: { field: "item_group", kind: "link", doctype: "Item Group", label: "Category" },
		brand: { field: "brand", kind: "link", doctype: "Brand", label: "Brand" },
		hsn_code: { field: "gst_hsn_code", kind: "link", doctype: "GST HSN Code", label: "HSN" },
		rack: { field: "custom_rack_number", kind: "data", label: "Rack/Location" },
	},

	// Purchase Rate and Selling Price, editable straight from the row
	// (2026-08-18 direct request: "purchase rate and selling rate change
	// krne ka option do"). Same in-place input pattern as edit_item_field,
	// just numeric and backed by update_item_rate instead — that one field
	// touches Item Price and, for Purchase Rate on an item that already has
	// stock, a real Stock Reconciliation, so it needs its own endpoint
	// rather than the plain field setter the other cells use.
	edit_rate($cell, row, kind) {
		if ($cell.data("editing")) return;
		$cell.data("editing", true);
		const key = kind === "purchase" ? "cost_rate" : "sale_rate";
		const label = kind === "purchase" ? __("Purchase Rate") : __("Selling Price");
		const existing = row[key] || "";

		$cell.html(`
			<span class="santu-stock-field-inline">
				<input type="number" min="0" step="any" class="santu-stock-field-input santu-stock-rate-input" value="${existing}" placeholder="${label}">
				<button type="button" class="santu-stock-field-save" title="${__("Save")}">✓</button>
				<button type="button" class="santu-stock-field-cancel" title="${__("Cancel")}">✕</button>
			</span>
		`);
		const $input = $cell.find(".santu-stock-field-input");
		$input.trigger("focus").trigger("select");

		const render_value = () => {
			$cell.data("editing", false);
			const dash = `<span class="santu-stock-dash">—</span>`;
			$cell.html(row[key] ? this._money(row[key]) : dash);
		};

		let saving = false;
		const save = () => {
			if (saving) return;
			const value = Number($input.val());
			if ($input.val() === "" || Number.isNaN(value) || value === Number(existing)) return render_value();
			saving = true;
			frappe
				.xcall("santu_hardware.santu_hardware.api.update_item_rate", {
					item_code: row.item_code,
					kind,
					rate: value,
				})
				.then((res) => {
					row[key] = kind === "purchase" ? res.cost_rate ?? value : value;
					frappe.show_alert({ message: __("{0} update ho gaya", [label]), indicator: "green" });
					render_value();
					// The Stock Value / Sale Value / Running Low cards are
					// computed server-side across the whole filtered set, so
					// editing a rate here left them showing the OLD totals until
					// someone hit Refresh — a ₹1 -> ₹25 change kept Sale Value at
					// ₹819 when it was really ₹891 (found 2026-09-04 testing this
					// screen). Re-reading is what the Refresh button itself does,
					// so the cards can never disagree with the rate just saved;
					// a purchase-rate edit also books a Stock Reconciliation
					// server-side, which moves Stock Value for reasons only the
					// server can total up.
					this.load();
				})
				.catch((err) => {
					saving = false;
					frappe.show_alert({ message: (err && err.message) || __("Save nahi ho paya."), indicator: "red" });
					$input.trigger("focus").trigger("select");
				});
		};

		$cell.find(".santu-stock-field-save").on("click", (e) => {
			e.stopPropagation();
			save();
		});
		$cell.find(".santu-stock-field-cancel").on("click", (e) => {
			e.stopPropagation();
			render_value();
		});
		$input.on("click", (e) => e.stopPropagation());
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				save();
			}
			if (e.key === "Escape") render_value();
		});
	},

	// Same dialog-free click-to-edit pattern as the barcode cell: the cell's
	// text becomes an input right there in the row, so editing category or
	// brand never scrolls the list or opens a form the operator has to find
	// their way back out of.
	edit_item_field($cell, row, key) {
		if ($cell.data("editing")) return;
		const spec = this.EDIT_FIELD_SPECS[key];
		const fieldname = spec.field || key;
		$cell.data("editing", true);
		const existing = row[key] || "";
		const dl_id = `santu-stock-dl-${key}-${row.item_code.replace(/[^a-zA-Z0-9]/g, "")}`;

		$cell.html(`
			<span class="santu-stock-field-inline">
				<input type="text" class="santu-stock-field-input" value="${frappe.utils.escape_html(existing)}"
					${spec.kind === "link" ? `list="${dl_id}"` : ""} placeholder="${__(spec.label)}">
				${spec.kind === "link" ? `<datalist id="${dl_id}"></datalist>` : ""}
				<button type="button" class="santu-stock-field-save" title="${__("Save")}">✓</button>
				<button type="button" class="santu-stock-field-cancel" title="${__("Cancel")}">✕</button>
			</span>
		`);
		const $input = $cell.find(".santu-stock-field-input");
		$input.trigger("focus").trigger("select");

		if (spec.kind === "link") {
			const $dl = $cell.find("datalist");
			const search = frappe.utils.debounce((q) => {
				frappe
					.xcall("santu_hardware.santu_hardware.api.search_link_values", {
						doctype: spec.doctype,
						query: q || "",
					})
					.then((opts) => {
						$dl.html((opts || []).map((o) => `<option value="${frappe.utils.escape_html(o)}">`).join(""));
					});
			}, 250);
			search("");
			$input.on("input", () => search($input.val()));
		}

		const close = () => {
			$cell.data("editing", false);
			this.render_row_field($cell, row, key);
		};

		// Save and cancel-button clicks both blur the input, and for Link
		// fields that blur also fires "change" — without this guard the two
		// paths race and send the request twice.
		let saving = false;
		const save = () => {
			if (saving) return;
			const value = $input.val().trim();
			if (value === existing) return close();
			saving = true;
			frappe
				.xcall("santu_hardware.santu_hardware.api.update_item_field", {
					item_code: row.item_code,
					fieldname: fieldname,
					value: value,
				})
				.then((res) => {
					row[key] = res.value || "";
					frappe.show_alert({
						message: __("{0} update ho gaya", [spec.label]),
						indicator: "green",
					});
					close();
				})
				.catch((err) => {
					saving = false;
					frappe.show_alert({
						message: (err && err.message) || __("Save nahi ho paya."),
						indicator: "red",
					});
					$input.trigger("focus").trigger("select");
				});
		};

		$cell.find(".santu-stock-field-save").on("click", (e) => {
			e.stopPropagation();
			save();
		});
		$cell.find(".santu-stock-field-cancel").on("click", (e) => {
			e.stopPropagation();
			close();
		});
		$input.on("click", (e) => e.stopPropagation());
		$input.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				save();
			}
			if (e.key === "Escape") close();
		});
		// Belt-and-braces for Link fields: picking a value from the native
		// <datalist> dropdown fires "change" but can swallow the Enter
		// keydown before it reaches the handler above (browser-owned
		// popup), so Enter alone isn't reliable there.
		if (spec.kind === "link") {
			$input.on("change", () => save());
		}
	},

	// Batch concept removed from this app entirely (2026-08-17: "bath ka
	// concept hata do pura") — one number per item, corrected directly.

	// Changing an item's unit from the shelf-view. Two outcomes, decided by
	// the server: an item that has never moved simply switches its unit,
	// while one with history keeps counting stock in its old unit and gains
	// the new one as an alternate to bill in. Both are stated plainly in the
	// dialog so nobody has to guess which one happened.
	edit_unit(r) {
		santu_uom.list(r.item_code, r.uom).then((opts) => {
			const others = opts.filter((o) => o.uom !== r.uom);
			const d = new frappe.ui.Dialog({
				title: __("Unit badlein"),
				fields: [
					{
						fieldtype: "HTML",
						options: `<div style="margin-bottom:8px">${frappe.utils.escape_html(r.item_name || r.item_code)}<br>
							<span style="color:var(--text-muted)">${__("Abhi")}: <b>${frappe.utils.escape_html(santu_uom.abbr(r.uom) || "")}</b></span></div>`,
					},
					{
						fieldtype: "Select",
						fieldname: "uom",
						label: __("Naya Unit"),
						reqd: 1,
						options: others.map((o) => o.uom).join("\n"),
					},
					{
						fieldtype: "Float",
						fieldname: "conversion_factor",
						label: __("1 naya unit = kitne {0}?", [santu_uom.abbr(r.uom) || ""]),
						description: __("Khali chhod dein to system khud samajhne ki koshish karega (jaise 1 Gram = 0.001 Kg)."),
					},
				],
				primary_action_label: __("Save"),
				primary_action: (v) => {
					frappe
						.call({
							method: "santu_hardware.santu_hardware.api.set_item_unit",
							args: {
								item_code: r.item_code,
								uom: v.uom,
								conversion_factor: v.conversion_factor || null,
							},
						})
						.then((res) => {
							const m = (res && res.message) || {};
							d.hide();
							// The unit list just changed, so the cached copy is stale.
							delete santu_uom._cache[r.item_code];
							frappe.show_alert({ message: m.message || __("Ho gaya."), indicator: "green" }, 7);
							this.load();
						});
				},
			});
			d.show();
		});
	},

	edit_stock(row) {
		this._edit_stock_dialog(row);
	},

	_edit_stock_dialog(row) {
		const current = Number(row.qty) || 0;
		const d = new frappe.ui.Dialog({
			title: __("Stock theek karein"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "head",
					options: `<div style="font-size:15px;margin-bottom:4px"><b>${frappe.utils.escape_html(
						row.item_name
					)}</b></div><div style="color:var(--text-muted)">${__("Abhi system me")}: ${current} ${frappe.utils.escape_html(santu_uom.abbr(row.uom) || "")}</div>`,
				},
				{
					fieldtype: "Float",
					fieldname: "new_qty",
					label: __("Dukaan me sach me kitna hai?"),
					reqd: 1,
					default: current,
				},
				{
					fieldtype: "Select",
					fieldname: "reason",
					label: __("Kyun badla?"),
					reqd: 1,
					options: ["Count Correction", "Damage", "Theft", "Other"].join("\n"),
					default: "Count Correction",
				},
			],
			primary_action_label: __("Theek karein"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Stock theek kar rahe hain…"));
				frappe
					.xcall("santu_hardware.santu_hardware.api.set_item_stock", {
						item_code: row.item_code,
						new_qty: v.new_qty,
						reason: v.reason,
					})
					.then(() => {
						frappe.dom.unfreeze();
						d.hide();
						frappe.show_alert({
							message: __("Stock theek kar diya"),
							indicator: "green",
						});
						this.load();
					})
					.catch((err) => {
						frappe.dom.unfreeze();
						frappe.msgprint({
							title: __("Stock theek nahi ho paya"),
							indicator: "red",
							message: (err && err.message) || __("Dobara koshish karein."),
						});
					});
			},
		});
		d.show();
	},

	// Resting state for an editable master-data cell — used by both the
	// first render and closing out of an edit, so they always match.
	render_row_field($cell, row, key) {
		const value = row[key];
		$cell.html(value ? frappe.utils.escape_html(value) : `<span class="santu-stock-dash">—</span>`);
	},

	// The barcode cell's resting state — its own function so both the first
	// render and "cancel out of editing" produce exactly the same markup.
	render_row_barcode($cell, row) {
		$cell.html(
			row.barcodes
				? `▮▯▮ ${frappe.utils.escape_html(row.barcodes)}`
				: `<span class="santu-stock-no-barcode">${__("+ barcode lagayein")}</span>`
		);
	},

	// Scanning on the stock list answers "how many of these do we have?" —
	// scan the thing instead of remembering its name. The search box already
	// matches barcodes server-side, so a scan is just a search.
	listen_for_scans() {
		if (!window.santu_barcode) return;
		window.santu_barcode.listen((code) => {
			const $search = this.$root.find(".santu-stock-search");
			$search.val(code);
			this.state.search = code;
			this.load();
		}, "santu-stock");
	},

	load() {
		this.$table.html(`<div class="santu-stock-loading">Loading…</div>`);
		frappe
			.xcall("santu_hardware.santu_hardware.api.get_stock_summary", {
				search: this.state.search || null,
				item_group: this.state.item_group || null,
				only_low: this.state.only_low ? 1 : 0,
				item_type: this.state.item_type,
			})
			.then((data) => {
				this.data = data;
				if (this.$group.children().length <= 1) {
					(data.item_groups || []).forEach((g) =>
						this.$group.append(`<option value="${frappe.utils.escape_html(g)}">${frappe.utils.escape_html(g)}</option>`)
					);
					this.$group.val(this.state.item_group || "");
				}
				this.render_cards(data.summary);
				this.render_table(data.rows);
				if (this._pending_detail_code) {
					const code = this._pending_detail_code;
					this._pending_detail_code = null;
					this.show_item_detail({ item_code: code, item_name: code });
				}
			})
			.catch((e) => {
				this.$cards.empty();
				this.$table.html(`<div class="santu-stock-empty">Could not load stock.</div>`);
				console.error(e);
			});
	},

	_money(v) {
		return `₹ ${format_number(v || 0, null, 2)}`;
	},

	render_cards(s) {
		s = s || {};
		// "Profit if all sold" removed (2026-08-18 direct request) — margin
		// figures now live nowhere on this screen, only Sale Rate/Selling
		// Price per item, matching the "buying price never leaked" standard
		// this app already holds to elsewhere (Cost Price Lock, etc.).
		this.$cards.html(`
			<div class="santu-stock-card">
				<div class="santu-stock-card-label">Stock Value <span title="What this stock cost you">(at cost)</span></div>
				<div class="santu-stock-card-value">${this._money(s.stock_value)}</div>
				<div class="santu-stock-card-sub">${format_number(s.items || 0, null, 0)} items · ${format_number(s.total_qty || 0, null, 0)} pieces</div>
			</div>
			<div class="santu-stock-card">
				<div class="santu-stock-card-label">Sale Value <span title="What this stock would fetch at today's prices">(at selling price)</span></div>
				<div class="santu-stock-card-value">${this._money(s.sale_value)}</div>
				<div class="santu-stock-card-sub">If everything sold at today's rate</div>
			</div>
			<div class="santu-stock-card ${s.low_count ? "santu-stock-card-warn" : ""}">
				<div class="santu-stock-card-label">Running Low</div>
				<div class="santu-stock-card-value">${format_number(s.low_count || 0, null, 0)}</div>
				<div class="santu-stock-card-sub">Items at or below their alert level</div>
			</div>
		`);
	},

	_sorted(rows) {
		const key = this.state.sort;
		const dir = this.state.dir;
		const compare = (a, b) => {
			const x = a[key], y = b[key];
			if (typeof x === "string" || typeof y === "string") {
				return dir * String(x || "").localeCompare(String(y || ""));
			}
			return dir * ((x || 0) - (y || 0));
		};
		return rows.slice().sort((a, b) => {
			// What's actually on the shelf comes first. Plain alphabetical
			// buried the stocked items under every empty one that happened to
			// sort earlier — searching "fevi" showed fourteen "0 Nos" rows and
			// the two Fevicols the shop really has sat off the bottom of the
			// screen, so it read as "fevicol didn't come up" (2026-08-16 bug
			// report). Clicking any column header turns this off, for when the
			// out-of-stock list is the point (reordering).
			if (this.state.stock_first) {
				const ax = (Number(a.qty) || 0) > 0 ? 0 : 1;
				const bx = (Number(b.qty) || 0) > 0 ? 0 : 1;
				if (ax !== bx) return ax - bx;
			}
			return compare(a, b);
		});
	},

	render_table(rows) {
		if (!rows || !rows.length) {
			this.$table.html(`
				<div class="santu-stock-empty">
					<div class="santu-stock-empty-icon">📦</div>
					<div class="santu-stock-empty-title">Nothing to show</div>
					<div class="santu-stock-empty-sub">No product matches this search.</div>
				</div>
			`);
			return;
		}

		// HSN deliberately not a column here (2026-08-17 direct feedback:
		// "hsn ko background me rakho wo purchase ke time pe add hoga") —
		// it is GST paperwork, not something a shop floor operator reads off
		// a shelf; it still exists on the item (editable from the detail
		// dialog / Add Item) and still gets filled in automatically wherever
		// a purchase already supplies it.
		const head = [
			["item_name", "ITEM", "left"],
			["qty", "IN STOCK", "right"],
			["cost_rate", "PURCHASE RATE", "right"],
			["sale_rate", "SELLING PRICE", "right"],
			["last_purchase_date", "LAST PURCHASE", "right"],
			["stock_value", "STOCK VALUE", "right"],
			["hsn_code", "HSN", "right"],
			["brand", "BRAND", "left"],
			["barcodes", "BARCODE", "left"],
			["rack", "RACK / LOCATION", "left"],
		];

		const $t = $(`
			<table class="santu-stock-table">
				<thead><tr>
					<!-- A plain running count, not sortable — it names "which row am
					     I looking at" for a screen someone reads aloud from or counts
					     down while doing a physical stock check, same as every other
					     billing screen's # column. -->
					<th class="santu-stock-th-idx">#</th>
					${head
					.map(
						([k, label, align]) =>
							`<th class="santu-stock-th-${align}" data-sort="${k}">${label}${
								this.state.sort === k ? (this.state.dir === 1 ? " ▲" : " ▼") : ""
							}</th>`
					)
					.join("")}</tr></thead>
				<tbody></tbody>
			</table>
		`);

		const $tb = $t.find("tbody");
		this._sorted(rows).forEach((r, idx) => {
			// A dash, not "₹ 0.00": an item nobody has priced yet has no
			// selling rate, and showing zero would read as "sells for nothing".
			const dash = `<span class="santu-stock-dash">—</span>`;
			const row_hl = santu_item_row_class(r.item_code, r.item_name);
			const $tr = $(`
				<tr class="${row_hl}">
					<td class="santu-stock-td-idx">${idx + 1}</td>
					<td class="santu-stock-td-item">
						<div class="santu-stock-item-name santu-stock-field-edit" data-field="item_name" title="${__("Naam badalne ke liye dabaiye")}">${frappe.utils.escape_html(r.item_name)}</div>
					</td>
					<!-- Unit folded in here rather than its own column
					     (2026-08-17: "in stock me hi number ke saath unit
					     aaye") — "90" on its own answers nothing without
					     knowing if that's 90 pieces or 90 boxes. -->
					<td class="santu-stock-td-num santu-stock-qty-edit" title="${__("Stock theek karne ke liye dabaiye")}">
						<span class="${r.low ? "santu-stock-qty-low" : ""}">${format_number(r.qty, null, 0)}</span>
						<span class="santu-stock-uom santu-stock-uom-edit" title="${__("Unit badalne ke liye dabaiye")}">${frappe.utils.escape_html(santu_uom.abbr(r.uom) || "")}</span>
						${r.is_stock_item && flt(r.qty) <= 1 ? `<span class="santu-stock-critical-badge" title="${__("Bahut kam bacha hai — 1 ya usse kam")}">${__("Critical")}</span>` : ""}
					</td>
					<td class="santu-stock-td-num santu-stock-rate-edit" data-kind="purchase" title="${__("Purchase Rate badalne ke liye dabaiye")}">${r.cost_rate ? this._money(r.cost_rate) : dash}</td>
					<td class="santu-stock-td-num santu-stock-rate-edit" data-kind="selling" title="${__("Selling Price badalne ke liye dabaiye")}">${r.sale_rate ? this._money(r.sale_rate) : dash}</td>
					<td class="santu-stock-td-text">${r.last_purchase_date ? frappe.datetime.str_to_user(r.last_purchase_date) : dash}</td>
					<td class="santu-stock-td-num">${this._money(r.stock_value)}</td>
					<td class="santu-stock-td-text santu-stock-td-hsn">${r.hsn_code ? frappe.utils.escape_html(r.hsn_code) : dash}</td>
					<td class="santu-stock-td-text santu-stock-field-edit" data-field="brand" title="${__("Brand badalne ke liye dabaiye")}">${r.brand ? frappe.utils.escape_html(r.brand) : dash}</td>
					<!-- Which code identifies this item. Without it there is no way to
					     tell, from this screen, whether an item can be scanned at all —
					     and "no barcode yet" is the thing worth seeing, because that is
					     the list of items still to be tagged. Tappable: this screen is
					     where the gap is noticed, so it has to be where it gets fixed. -->
					<td class="santu-stock-td-barcode santu-stock-item-barcode santu-stock-barcode-edit" title="${__("Barcode lagane ya badalne ke liye dabaiye")}">${
						r.barcodes
							? `▮▯▮ ${frappe.utils.escape_html(r.barcodes)}`
							: `<span class="santu-stock-no-barcode">${__("+ barcode lagayein")}</span>`
					}</td>
					<!-- edit_barcode() replaces this cell's contents with an input, in place. -->
					<td class="santu-stock-td-text santu-stock-field-edit" data-field="rack" title="${__("Rack/Location badalne ke liye dabaiye")}">${r.rack ? frappe.utils.escape_html(r.rack) : dash}</td>
				</tr>
			`);
			$tr.find(".santu-stock-rate-edit").on("click", (e) => {
				// Must not also open the item screen underneath.
				e.stopPropagation();
				this.edit_rate($(e.currentTarget), r, $(e.currentTarget).data("kind"));
			});
			$tr.find(".santu-stock-item-barcode").on("click", (e) => {
				// Must not also open the item screen underneath.
				e.stopPropagation();
				this.edit_barcode($(e.currentTarget), r);
			});
			$tr.find(".santu-stock-field-edit").on("click", (e) => {
				// Must not also open the item screen underneath.
				e.stopPropagation();
				this.edit_item_field($(e.currentTarget), r, $(e.currentTarget).data("field"));
			});
			// The unit sits inside the quantity cell, so it has to swallow the
			// click itself -- otherwise tapping "Kg" would open the
			// fix-the-stock-count dialog instead of the unit one.
			$tr.find(".santu-stock-uom-edit").on("click", (e) => {
				e.stopPropagation();
				this.edit_unit(r);
			});
			$tr.find(".santu-stock-qty-edit").on("click", (e) => {
				// Must not also open the item screen underneath.
				e.stopPropagation();
				this.edit_stock(r);
			});
			$tr.on("click", () => this.show_item_detail(r));
			$tb.append($tr);
		});

		$t.find("th[data-sort]").on("click", (e) => {
			const k = $(e.currentTarget).data("sort");
			this.state.stock_first = false;
			if (this.state.sort === k) this.state.dir = -this.state.dir;
			else {
				this.state.sort = k;
				// Names read best A–Z; every money or quantity column is asked
				// about biggest-first ("what's my costliest stock?").
				this.state.dir = k === "item_name" ? 1 : -1;
			}
			this.render_table(this.data.rows);
		});

		this.$table.empty().append($t);
	},
};
};
