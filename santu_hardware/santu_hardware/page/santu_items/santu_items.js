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

const santu_items_page = {
	init(page) {
		this.render_shell(page);
		this.bind_events();
		this.update_tab_ui();
		this.reload_list();
	},

	render_shell(page) {
		const $root = $(`
			<div class="santu-items">
				<div class="santu-items-topbar">
					<div class="santu-items-topbar-search">
						<span class="santu-items-topbar-search-icon">🔍</span>
						<input type="text" class="santu-items-top-search" placeholder="Search Transactions">
					</div>
					<div class="santu-items-topbar-actions">
						<button type="button" class="santu-items-btn-sale">+ Add Sale</button>
						<button type="button" class="santu-items-btn-purchase">+ Add Purchase</button>
						<button type="button" class="santu-items-btn-quick" title="Quick Add">+</button>
						<button type="button" class="santu-items-btn-menu" title="More">⋮</button>
					</div>
				</div>
				<div class="santu-items-tabs-wrap"><div class="santu-items-tabs"></div></div>
				<div class="santu-items-body">
					<div class="santu-items-list-panel">
						<div class="santu-items-toolbar">
							<div class="santu-items-toolbar-search">
								<span class="santu-items-search-icon">🔍</span>
								<input type="text" class="santu-items-search" placeholder="Search">
							</div>
							<button type="button" class="btn btn-primary santu-items-add-btn">+ Add Item</button>
						</div>
						<div class="santu-items-table-head">
							<span class="santu-items-col-item">ITEM</span>
							<span class="santu-items-col-qty">QUANTITY</span>
						</div>
						<div class="santu-items-list"></div>
					</div>
					<div class="santu-items-detail-panel">
						<div class="santu-items-empty">Select an item to see details.</div>
					</div>
				</div>
			</div>
		`).appendTo(page.body);

		this.page = page;
		this.$root = $root;
		this.$tabs = $root.find(".santu-items-tabs");
		this.$search = $root.find(".santu-items-search");
		this.$topSearch = $root.find(".santu-items-top-search");
		this.$list = $root.find(".santu-items-list");
		this.$detail = $root.find(".santu-items-detail-panel");
		this.$tableHead = $root.find(".santu-items-table-head");
		this.$addBtn = $root.find(".santu-items-add-btn");
		this.active_tab = SANTU_ITEMS_TABS[0];
		this.selected_code = santu_items.utils.get_selected_code();

		SANTU_ITEMS_TABS.forEach((tab) => {
			$(`<button type="button" class="santu-items-tab" data-key="${tab.key}">${tab.label}</button>`)
				.on("click", () => this.switch_tab(tab))
				.appendTo(this.$tabs);
		});
		this.$tabs.find(".santu-items-tab").first().addClass("santu-items-tab-active");
	},

	bind_events() {
		this.$root.find(".santu-items-btn-sale").on("click", () => frappe.set_route("point-of-sale"));
		this.$root.find(".santu-items-btn-purchase").on("click", () => frappe.set_route("santu-receive-stock"));
		this.$root.find(".santu-items-btn-quick").on("click", () => frappe.new_doc("Item"));
		this.$root.find(".santu-items-btn-menu").on("click", () => this.show_quick_menu());
		this.$addBtn.on("click", () => this.add_master_record());

		const on_search = santu_items.utils.debounce(() => this.reload_list());
		this.$search.on("input", on_search);
		this.$topSearch.on("input", function () {
			santu_items_page.$search.val($(this).val());
			on_search();
		});
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
		this.$tableHead.find(".santu-items-col-qty").text(
			this.active_tab.key === "category" ? "ITEMS" : this.active_tab.key === "units" ? "TYPE" : "QUANTITY"
		);
	},

	add_master_record() {
		if (this.active_tab.key === "category") frappe.new_doc("Item Group");
		else if (this.active_tab.key === "units") frappe.new_doc("UOM");
		else frappe.new_doc("Item");
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

		const rows = await santu_items.api.get_items_list({
			search: this.$search.val() || null,
			item_type: this.active_tab.item_type,
		});

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
		const rows = await santu_items.api.get_item_groups(this.$search.val());
		this.$list.empty();
		if (!rows.length) {
			santu_items.list.show_empty(this.$list, "No categories found.");
			return;
		}
		rows.forEach((row) => {
			const $row = santu_items.list.build_category_row(row);
			$row.on("click", () => {
				santu_items.list.set_active(this.$list, null);
				$row.addClass("santu-items-row-active");
				santu_items.detail.show_category(this.$detail, row);
			});
			this.$list.append($row);
		});
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
			{ label: "New Item", action: () => frappe.new_doc("Item") },
			{ label: "Receive Stock", action: () => frappe.set_route("santu-receive-stock") },
			{ label: "New Sale", action: () => frappe.set_route("point-of-sale") },
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
