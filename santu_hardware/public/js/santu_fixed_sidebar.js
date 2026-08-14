/*
 * Global fixed left sidebar — always visible on Desk (except kiosk/POS).
 */
(function () {
	const SIDEBAR_WIDTH = 220;

	const PURCHASE_CHILDREN = [
		{ view: "bills", label: "Purchase Bills", route: "santu-purchase" },
		{ view: "payment_out", label: "Payment-Out", route: "santu-purchase" },
		{ view: "expenses", label: "Expenses", route: "santu-purchase" },
		{ view: "purchase_order", label: "Purchase Order", route: "santu-purchase" },
		{ view: "purchase_return", label: "Purchase Return / Dr. Note", route: "santu-purchase" },
	];

	const NAV_ITEMS = [
		{ type: "link", route: "santu-dashboard", icon: "📊", label: "Dashboard" },
		{ type: "label", label: "PUBLIC" },
		{ type: "workspace", route: "Home", icon: "🏠", label: "Home" },
		{
			type: "group",
			key: "parties",
			icon: "👥",
			label: "Parties",
			storageView: "santu_parties_view",
			storageExpanded: "santu_parties_sidebar_expanded",
			defaultView: "list",
			route: "santu-parties",
			changeEvent: "santu-parties-view-change",
			isActive: () => {
				const r = get_route();
				return r[0] === "santu-parties" || r[0] === "santu-whatsapp-connect";
			},
			getView: () => {
				if (get_route()[0] === "santu-whatsapp-connect") return "whatsapp";
				return sessionStorage.getItem("santu_parties_view") || "list";
			},
			children: [
				{ view: "list", label: "Parties", route: "santu-parties" },
				{ view: "whatsapp", label: "WhatsApp Connect", route: "santu-whatsapp-connect" },
			],
		},
		{ type: "link", route: "santu-items", icon: "📦", label: "Items" },
		{ type: "link", route: "santu-reports", icon: "📊", label: "Reports" },
		{
			type: "group",
			key: "sale",
			icon: "🧾",
			label: "Sale",
			storageView: "santu_sale_view",
			storageExpanded: "santu_sale_sidebar_expanded",
			defaultView: "invoices",
			route: "santu-sale",
			changeEvent: "santu-sale-view-change",
			isActive: () => {
				const r = get_route();
				return r[0] === "santu-sale" || r[0] === "santu-sale-invoice" || r[0] === "point-of-sale";
			},
			getView: () => {
				if (get_route()[0] === "point-of-sale") return "pos";
				if (get_route()[0] === "santu-sale-invoice") return "new_invoice";
				return sessionStorage.getItem("santu_sale_view") || "invoices";
			},
			children: [
				{ view: "invoices", label: "Sale Invoices", route: "santu-sale" },
				{ view: "new_invoice", label: "+ New Sale Invoice", route: "santu-sale-invoice" },
				{ view: "quotation", label: "Estimate / Quotation", route: "santu-sale" },
				{ view: "proforma", label: "Proforma Invoice", route: "santu-sale" },
				{ view: "payment_in", label: "Payment In", route: "santu-sale" },
				{ view: "sales_order", label: "Sales Order", route: "santu-sale" },
				{ view: "delivery_challan", label: "Delivery Challan", route: "santu-sale" },
				{ view: "sales_return", label: "Sales Return / Credit Note", route: "santu-sale" },
				{ view: "pos", label: "Vyapar POS", redirect: "point-of-sale" },
			],
		},
		{
			type: "group",
			key: "purchase",
			icon: "🛒",
			label: "Purchase & Expense",
			storageView: "santu_purchase_view",
			storageExpanded: "santu_purchase_sidebar_expanded",
			defaultView: "bills",
			route: "santu-purchase",
			changeEvent: "santu-purchase-view-change",
			isActive: () => get_route()[0] === "santu-purchase",
			getView: () => sessionStorage.getItem("santu_purchase_view") || "bills",
			children: PURCHASE_CHILDREN,
		},
		{
			type: "group",
			key: "sync",
			icon: "🔄",
			label: "Sync, Share & Backup",
			storageView: "santu_sync_view",
			storageExpanded: "santu_sync_sidebar_expanded",
			defaultView: "sync_share",
			route: "santu-sync",
			changeEvent: "santu-sync-view-change",
			isActive: () => get_route()[0] === "santu-sync",
			getView: () => sessionStorage.getItem("santu_sync_view") || "sync_share",
			children: [
				{ view: "sync_share", label: "Sync & Share", route: "santu-sync" },
				{ view: "auto_backup", label: "Auto Backup", route: "santu-sync" },
				{ view: "backup_computer", label: "Backup To Computer", route: "santu-sync" },
				{ view: "backup_drive", label: "Backup To Drive", route: "santu-sync" },
				{ view: "restore_backup", label: "Restore Backup", route: "santu-sync" },
			],
		},
		{
			type: "group",
			key: "utilities",
			icon: "🔧",
			label: "Utilities",
			storageView: "santu_utilities_view",
			storageExpanded: "santu_utilities_sidebar_expanded",
			defaultView: "import_items",
			route: "santu-utilities",
			changeEvent: "santu-utilities-view-change",
			isActive: () => get_route()[0] === "santu-utilities",
			getView: () => sessionStorage.getItem("santu_utilities_view") || "import_items",
			children: [
				{ view: "import_items", label: "Import Items", route: "santu-utilities" },
				{ view: "setup_business", label: "Set Up My Business", route: "santu-utilities" },
				{ view: "accountant_access", label: "Accountant Access", route: "santu-utilities" },
				{ view: "barcode_generator", label: "Barcode Generator", route: "santu-utilities" },
				{ view: "bulk_update", label: "Update Items In Bulk", route: "santu-utilities" },
				{ view: "import_parties", label: "Import Parties", route: "santu-utilities" },
				{ view: "track_salesmen", label: "Track Your Salesmen", route: "santu-utilities" },
				{ view: "export_tally", label: "Exports To Tally", route: "santu-utilities" },
				{ view: "export_items", label: "Export Items", route: "santu-utilities" },
				{ view: "verify_data", label: "Verify My Data", route: "santu-utilities" },
				{ view: "close_fy", label: "Close Financial Year", route: "santu-utilities" },
			],
		},
		{ type: "workspace", route: "Accounting", icon: "💼", label: "Accounting" },
		{ type: "workspace", route: "Selling", icon: "💳", label: "Selling" },
		{ type: "workspace", route: "Stock", icon: "📦", label: "Stock" },
		{ type: "workspace", route: "Staff", icon: "👤", label: "Staff" },
		{ type: "workspace", route: "Users", icon: "👥", label: "Users" },
		{ type: "workspace", route: "Settings", icon: "⚙️", label: "Settings" },
		{ type: "link", route: "santu-transaction-message", icon: "💬", label: "Transaction Message" },
		{ type: "workspace", route: "ERPNext Settings", icon: "⚙️", label: "ERPNext Settings" },
	];

	function is_kiosk() {
		return document.body.classList.contains("santu-kiosk-mode");
	}

	function get_route() {
		return frappe.get_route() || [];
	}

	function is_active_link(route) {
		return frappe.get_route_str() === route;
	}

	function is_active_workspace(name) {
		const r = get_route();
		return r[0] === "Workspaces" && (r[1] || "Home") === name;
	}

	function navigate(item, group) {
		if (item.redirect) {
			frappe.set_route(item.redirect);
			return;
		}
		if (item.type === "workspace") {
			frappe.set_route("Workspaces", item.route);
			return;
		}
		if (item.route === "santu-sale-invoice") {
			frappe.set_route("santu-sale-invoice");
			return;
		}
		if (group && item.view && item.route && item.route !== group.route) {
			sessionStorage.setItem(group.storageView, item.view);
			frappe.set_route(item.route);
			return;
		}
		if (group && item.route === group.route && item.view) {
			sessionStorage.setItem(group.storageView, item.view);
			frappe.route_options = { view: item.view };
			frappe.set_route(group.route);
			$(document).trigger(group.changeEvent);
			return;
		}
		if (item.route) {
			frappe.set_route(item.route);
		}
	}

	function build_group(item, $list) {
		const expanded =
			item.isActive() || sessionStorage.getItem(item.storageExpanded) === "1";
		const group_active = item.isActive();
		const $group = $(`
			<div class="santu-app-sidebar-group${expanded ? " is-expanded" : ""}${group_active ? " is-active" : ""}" data-group="${item.key}">
				<button type="button" class="santu-app-sidebar-item santu-app-sidebar-parent">
					<span class="santu-app-sidebar-icon">${item.icon}</span>
					<span class="santu-app-sidebar-text">${__(item.label)}</span>
					<span class="santu-app-sidebar-chevron">${expanded ? "▼" : "▶"}</span>
				</button>
				<div class="santu-app-sidebar-children"></div>
			</div>
		`);
		const $children = $group.find(".santu-app-sidebar-children");
		const current_view = item.getView();
		item.children.forEach((child) => {
			const child_active = group_active && current_view === child.view;
			$(`
				<button type="button" class="santu-app-sidebar-item santu-app-sidebar-child${child_active ? " is-active" : ""}">
					<span class="santu-app-sidebar-icon">•</span>
					<span class="santu-app-sidebar-text">${__(child.label)}</span>
				</button>
			`)
				.on("click", () => {
					sessionStorage.setItem(item.storageExpanded, "1");
					navigate(child, item);
					update_active_states();
				})
				.appendTo($children);
		});
		$group.find(".santu-app-sidebar-parent").on("click", () => {
			const is_exp = $group.toggleClass("is-expanded").hasClass("is-expanded");
			$group.find(".santu-app-sidebar-chevron").text(is_exp ? "▼" : "▶");
			sessionStorage.setItem(item.storageExpanded, is_exp ? "1" : "0");
			if (!is_exp) return;
			sessionStorage.setItem(item.storageView, item.defaultView);
			frappe.route_options = { view: item.defaultView };
			frappe.set_route(item.route);
		});
		$list.append($group);
	}

	function build_sidebar() {
		if ($("#santu-app-sidebar").length) return;

		const $sidebar = $(`<nav id="santu-app-sidebar" class="santu-app-sidebar" aria-label="Main navigation"></nav>`);
		const $list = $(`<div class="santu-app-sidebar-list"></div>`).appendTo($sidebar);

		NAV_ITEMS.forEach((item) => {
			if (item.type === "label") {
				$list.append(`<div class="santu-app-sidebar-label">${__(item.label)}</div>`);
				return;
			}
			if (item.type === "group") {
				build_group(item, $list);
				return;
			}

			let active = false;
			if (item.type === "link") active = is_active_link(item.route);
			if (item.type === "workspace") active = is_active_workspace(item.route);

			$(`
				<button type="button" class="santu-app-sidebar-item${active ? " is-active" : ""}" data-nav-type="${item.type}" data-nav-route="${frappe.utils.escape_html(item.route || "")}">
					<span class="santu-app-sidebar-icon">${item.icon}</span>
					<span class="santu-app-sidebar-text">${__(item.label)}</span>
				</button>
			`)
				.on("click", () => navigate(item))
				.appendTo($list);
		});

		$sidebar.appendTo("body");
		document.body.classList.add("santu-fixed-sidebar");
		document.documentElement.style.setProperty("--santu-sidebar-width", `${SIDEBAR_WIDTH}px`);
	}

	function update_active_states() {
		if (!$("#santu-app-sidebar").length || is_kiosk()) return;

		$("#santu-app-sidebar .santu-app-sidebar-item[data-nav-type]").each(function () {
			const type = $(this).data("nav-type");
			const route = $(this).data("nav-route");
			let active = false;
			if (type === "link") active = is_active_link(route);
			if (type === "workspace") active = is_active_workspace(route);
			$(this).toggleClass("is-active", active);
		});

		NAV_ITEMS.filter((i) => i.type === "group").forEach((item) => {
			const group_active = item.isActive();
			const $group = $(`#santu-app-sidebar .santu-app-sidebar-group[data-group='${item.key}']`);
			$group.toggleClass("is-active", group_active);
			const view = item.getView();
			$group.find(".santu-app-sidebar-child").each(function () {
				const label = $(this).find(".santu-app-sidebar-text").text();
				const child = item.children.find((c) => __(c.label) === label || c.label === label);
				$(this).toggleClass("is-active", group_active && child && child.view === view);
			});
		});
	}

	function toggle_sidebar_visibility() {
		if (is_kiosk()) {
			$("#santu-app-sidebar").hide();
			document.body.classList.remove("santu-fixed-sidebar");
		} else {
			build_sidebar();
			$("#santu-app-sidebar").show();
			document.body.classList.add("santu-fixed-sidebar");
			update_active_states();
		}
	}

	$(document).on("page-change", toggle_sidebar_visibility);
	frappe.router.on("change", toggle_sidebar_visibility);
	$(toggle_sidebar_visibility);
})();
