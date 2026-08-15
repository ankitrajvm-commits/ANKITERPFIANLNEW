frappe.pages["santu-items"].on_page_show = function () {
	// set_route to a page already showing fires no lifecycle, so a second
	// "open this item" from elsewhere would otherwise silently do nothing.
	if (window.santu_items_page && santu_items_page.$list && santu_items_page.apply_route_options()) {
		santu_items_page.reload_list();
	}
};

frappe.pages["santu-items"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Items",
		single_column: true,
	});

	$(page.wrapper).find(".page-head").hide();
	$(page.main).addClass("santu-items-page-main");

	frappe.require(
		[
			"/assets/santu_hardware/js/santu_items/santu_items_utils.js",
			"/assets/santu_hardware/js/santu_items/santu_items_api.js",
			"/assets/santu_hardware/js/santu_items/santu_items_list.js",
			"/assets/santu_hardware/js/santu_items/santu_items_transactions.js",
			"/assets/santu_hardware/js/santu_items/santu_items_detail.js",
		],
		() => santu_items_page.init(page)
	);
};

const SANTU_ITEMS_TABS = [
	{ key: "products", label: "Products", item_type: "product" },
	{ key: "services", label: "Services", item_type: "service" },
	{ key: "category", label: "Category" },
	{ key: "units", label: "Units" },
];


window.santu_items_page = {
	init(page) {
		this.render_shell(page);
		this.bind_events();
		this.update_tab_ui();
		this.apply_route_options();
		this.reload_list();
	},

	// Lets anything in the app open this screen focused on one item instead
	// of routing to the native Item form. Used by the Low Stock rows, the
	// Utilities item lists and the Items screen's own name/code links, all
	// of which used to jump to Form/Item.
	apply_route_options() {
		const opts = frappe.route_options || {};
		frappe.route_options = null;
		if (opts.item_code) {
			this.selected_code = opts.item_code;
			santu_items.utils.set_selected_code(opts.item_code);
			// An item arriving from elsewhere is always a product; the
			// Services/Category/Units tabs would never show it.
			const tab = SANTU_ITEMS_TABS.find((t) => t.key === "products");
			if (tab) this.active_tab = tab;
			this.update_tab_ui();
		}
		if (opts.item_group) {
			this.pending_group_filter = opts.item_group;
			if (this.$search) this.$search.val("");
		}
		return !!(opts.item_code || opts.item_group);
	},

	render_shell(page) {
		const $root = $(`
			<div class="santu-items">
				<div class="santu-items-tabs-wrap"><div class="santu-items-tabs"></div></div>
				<div class="santu-items-body">
					<div class="santu-items-list-panel">
						<div class="santu-items-toolbar">
							<button type="button" class="santu-items-search-toggle" title="Search">
								<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="#656672" stroke-width="1.5"/><path d="M13.5 13.5L17 17" stroke="#656672" stroke-width="1.5" stroke-linecap="round"/></svg>
							</button>
							<div class="santu-items-toolbar-search">
								<input type="text" class="santu-items-search" placeholder="Search">
							</div>
							<div class="santu-items-add-split">
								<button type="button" class="santu-items-add-btn">+ Add Item</button>
								<button type="button" class="santu-items-add-caret" title="More">▾</button>
							</div>
							<button type="button" class="santu-items-btn-menu" title="More">⋮</button>
						</div>
						<div class="santu-items-table-head">
							<span class="santu-items-col-item">ITEM <span class="santu-items-qty-filter santu-items-item-filter" title="Filter items">▾</span></span>
							<span class="santu-items-col-qty">QUANTITY</span>
						</div>
						<div class="santu-items-list"></div>
					</div>
					<div class="santu-items-detail-panel">
						<div class="santu-items-empty">
							<img src="/assets/santu_hardware/images/items/empty_item.svg" alt="" width="72" height="72">
							<div>Select an item to see details.</div>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(page.body);

		this.page = page;
		this.$root = $root;
		this.$tabs = $root.find(".santu-items-tabs");
		this.$search = $root.find(".santu-items-search");
		this.$list = $root.find(".santu-items-list");
		this.$detail = $root.find(".santu-items-detail-panel");
		this.$tableHead = $root.find(".santu-items-table-head");
		this.$addBtn = $root.find(".santu-items-add-btn");
		this.active_tab = SANTU_ITEMS_TABS[0];
		this.selected_code = santu_items.utils.get_selected_code();
		this.qty_sort_dir = null;

		SANTU_ITEMS_TABS.forEach((tab) => {
			$(`<button type="button" class="santu-items-tab" data-key="${tab.key}">${tab.label}</button>`)
				.on("click", () => this.switch_tab(tab))
				.appendTo(this.$tabs);
		});
		this.$tabs.find(".santu-items-tab").first().addClass("santu-items-tab-active");
	},

	bind_events() {
		this.$root.find(".santu-items-btn-menu").on("click", () => this.show_quick_menu());
		this.$addBtn.on("click", () => this.add_master_record());
		this.$root.find(".santu-items-add-caret").on("click", (e) => this.show_add_menu($(e.currentTarget)));

		this.$root.find(".santu-items-item-filter").on("click", (e) => {
			e.stopPropagation();
			this.qty_sort_dir = this.qty_sort_dir === "desc" ? "asc" : "desc";
			this.reload_list();
		});

		const $searchWrap = this.$root.find(".santu-items-toolbar-search");
		this.$root.find(".santu-items-search-toggle").on("click", () => {
			$searchWrap.toggleClass("santu-items-search-open");
			if ($searchWrap.hasClass("santu-items-search-open")) this.$search.trigger("focus");
		});

		const on_search = santu_items.utils.debounce(() => {
			this.pending_group_filter = null;
			this.$search.attr("placeholder", "Search");
			this.reload_list();
		});
		this.$search.on("input", on_search);
	},

	show_add_menu($anchor) {
		const items = [
			{ label: "New Item", action: () => frappe.set_route("santu-add-item") },
			{ label: "Import Items", action: () => { sessionStorage.setItem("santu_utilities_view", "import_items"); frappe.set_route("santu-utilities"); $(document).trigger("santu-utilities-view-change"); } },
			{ label: "Bulk Items Update", action: () => { sessionStorage.setItem("santu_utilities_view", "bulk_update"); frappe.set_route("santu-utilities"); $(document).trigger("santu-utilities-view-change"); } },
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
		$menu.css({ top: rect.bottom + 6 + "px", left: rect.left + "px" });
		setTimeout(() => {
			$(document).one("click.santu-items-add-menu", (e) => {
				if (!$(e.target).closest(".santu-topbar-menu").length) $menu.remove();
			});
		}, 0);
	},

	switch_tab(tab) {
		this.active_tab = tab;
		this.selected_code = null;
		santu_items.utils.set_selected_code(null);
		this.$tabs.find(".santu-items-tab").removeClass("santu-items-tab-active");
		this.$tabs.find(`[data-key="${tab.key}"]`).addClass("santu-items-tab-active");
		this.update_tab_ui();
		this.reload_list();
		this.$detail.html(`<div class="santu-items-empty">Select an item to see details.</div>`);
	},

	update_tab_ui() {
		const is_master = this.active_tab.key === "category" || this.active_tab.key === "units";
		this.$addBtn.text(
			is_master ? `+ Add ${this.active_tab.key === "category" ? "Category" : "Unit"}` : "+ Add Item"
		);
		const item_label = this.active_tab.key === "category" ? "CATEGORY" : "ITEM";
		this.$tableHead.find(".santu-items-col-item").html(
			`${item_label} <span class="santu-items-qty-filter santu-items-item-filter" title="Filter">▾</span>`
		);
		this.$tableHead.find(".santu-items-item-filter").on("click", (e) => {
			e.stopPropagation();
			this.qty_sort_dir = this.qty_sort_dir === "desc" ? "asc" : "desc";
			this.reload_list();
		});

		const label = this.active_tab.key === "category" ? "ITEM" : this.active_tab.key === "units" ? "TYPE" : "QUANTITY";
		this.$tableHead.find(".santu-items-col-qty").text(label);
	},

	// One name, one insert — used by both the Category and Unit tabs.
	_quick_master(doctype, title, label) {
		const d = new frappe.ui.Dialog({
			title,
			fields: [{ fieldtype: "Data", fieldname: "name_value", label, reqd: 1 }],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				frappe.dom.freeze(__("Saving…"));
				frappe
					.xcall("santu_hardware.santu_hardware.api.create_item_master", {
						doctype,
						name_value: v.name_value,
					})
					.then(() => {
						frappe.dom.unfreeze();
						d.hide();
						frappe.show_alert({ message: __("Added"), indicator: "green" });
						this.reload_list();
					})
					.catch(() => frappe.dom.unfreeze());
			},
		});
		d.show();
	},

	add_master_record() {
		// Both used to open the raw Item Group / UOM forms — parent group,
		// "Is Group", tree fields, none of it meaningful here. A category and
		// a unit are each just a name.
		if (this.active_tab.key === "category") this._quick_master("Item Group", __("Add Category"), __("Category name"));
		else if (this.active_tab.key === "units") this._quick_master("UOM", __("Add Unit"), __("Unit name"));
		else frappe.set_route("santu-add-item");
	},

	async reload_list() {
		santu_items.list.show_loading(this.$list);

		if (this.active_tab.key === "category") {
			await this.load_categories();
			return;
		}
		if (this.active_tab.key === "units") {
			await this.load_units();
			return;
		}

		let rows = await santu_items.api.get_items_list({
			search: this.$search.val() || null,
			item_type: this.active_tab.item_type,
		});

		// Arrived here from a category's item count, which used to open the
		// native Item list filtered by group.
		if (this.pending_group_filter) {
			const group = this.pending_group_filter;
			rows = rows.filter((r) => r.item_group === group);
			this.$search.attr("placeholder", `${group} — showing this category only`);
		}

		if (this.qty_sort_dir) {
			const dir = this.qty_sort_dir === "asc" ? 1 : -1;
			rows = [...rows].sort((a, b) => (flt(a.available_qty) - flt(b.available_qty)) * dir);
		}

		this.$list.empty();
		if (!rows.length) {
			santu_items.list.show_empty(this.$list, "No items found.");
			this.selected_code = null;
			santu_items.utils.set_selected_code(null);
			this.$detail.html(`<div class="santu-items-empty">No items to show.</div>`);
			return;
		}

		let selected_exists = false;
		rows.forEach((row) => {
			const $row = santu_items.list.build_row(row);
			$row.on("click", () => this.select_item(row.item_code, $row));
			if (this.selected_code === row.item_code) {
				$row.addClass("santu-items-row-active");
				selected_exists = true;
			}
			this.$list.append($row);
		});

		if (!selected_exists) {
			this.select_item(rows[0].item_code, this.$list.find(".santu-items-row").first(), false);
		} else {
			santu_items.detail.show(this.$detail, this.selected_code);
		}
	},

	select_item(code, $row, scroll = true) {
		this.selected_code = code;
		santu_items.utils.set_selected_code(code);
		santu_items.list.set_active(this.$list, code);
		if ($row && $row.length) $row.addClass("santu-items-row-active");
		santu_items.detail.show(this.$detail, code);
		if (scroll && $row && $row.length) {
			$row[0].scrollIntoView({ block: "nearest" });
		}
	},

	async load_categories() {
		const data = await santu_items.api.get_item_groups(this.$search.val());
		this.$list.empty();

		const select_category = (row, $row, is_uncategorized) => {
			santu_items.list.set_active(this.$list, null);
			this.$list.find(".santu-items-row").removeClass("santu-items-row-active");
			$row.addClass("santu-items-row-active");
			santu_items.detail.show_category(this.$detail, row, is_uncategorized);
		};

		if (data.uncategorized && data.uncategorized.item_count > 0) {
			const $row = santu_items.list.build_category_row(
				{ name: "Items not in any Category", item_count: data.uncategorized.item_count },
				true
			);
			$row.on("click", () => select_category(data.uncategorized, $row, true));
			this.$list.append($row);
		}

		if (!data.categories.length && !(data.uncategorized && data.uncategorized.item_count > 0)) {
			santu_items.list.show_empty(this.$list, "No categories found.");
			return;
		}

		data.categories.forEach((row) => {
			const $row = santu_items.list.build_category_row(row, false);
			$row.on("click", () => select_category(row, $row, false));
			this.$list.append($row);
		});

		if (data.uncategorized && data.uncategorized.item_count > 0) {
			select_category(data.uncategorized, this.$list.find(".santu-items-row").first(), true);
		} else if (data.categories.length) {
			select_category(data.categories[0], this.$list.find(".santu-items-row").first(), false);
		}
	},

	async load_units() {
		const rows = await santu_items.api.get_uoms(this.$search.val());
		this.$list.empty();
		if (!rows.length) {
			santu_items.list.show_empty(this.$list, "No units found.");
			return;
		}
		rows.forEach((row) => {
			const $row = santu_items.list.build_unit_row(row);
			$row.on("click", () => {
				santu_items.list.set_active(this.$list, null);
				$row.addClass("santu-items-row-active");
				santu_items.detail.show_unit(this.$detail, row);
			});
			this.$list.append($row);
		});
	},

	show_quick_menu() {
		const menu = [
			{ label: "New Item", action: () => frappe.set_route("santu-add-item") },
			{ label: "Receive Stock", action: () => frappe.set_route("santu-receive-stock") },
			{ label: "New Sale", action: () => frappe.set_route("santu-sale-invoice") },
			{ label: "Low Stock", action: () => frappe.set_route("santu-low-stock") },
		];
		const d = new frappe.ui.Dialog({
			title: "Quick Actions",
			fields: menu.map((m, i) => ({ fieldtype: "Button", fieldname: `btn_${i}`, label: m.label })),
		});
		menu.forEach((m, i) => {
			d.fields_dict[`btn_${i}`].$input.on("click", () => {
				d.hide();
				m.action();
			});
		});
		d.show();
	},
};
