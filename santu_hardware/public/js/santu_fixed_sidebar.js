/*
 * Global fixed left sidebar — always visible on Desk (except kiosk/POS).
 */
(function () {
	const SIDEBAR_WIDTH = 260;
	const SIDEBAR_WIDTH_COLLAPSED = 64;
	// Bump whenever NAV_ITEMS changes shape — build_sidebar() reuses an
	// already-rendered sidebar when this matches, so without a bump an open
	// tab keeps the old menu.
	const SIDEBAR_NAV_VERSION = "vyapar-match-7";
	const SIDEBAR_COLLAPSE_KEY = "santu_sidebar_collapsed";

	const PURCHASE_CHILDREN = [
		{ view: "bills", label: "Purchase Bills", route: "santu-purchase" },
		{ view: "payment_out", label: "Payment-Out", route: "santu-purchase", quickadd: { run: () => window.santu_open_collect_payment({ party_type: "Supplier" }) } },
		{ view: "expenses", label: "Expenses", route: "santu-purchase", quickadd: { run: () => frappe.set_route("santu-expense") } },
		// No quickadd here (unlike the other Purchase & Expense entries) —
		// it went through frappe.new_doc("Purchase Order") straight to the
		// native form (2026-08-15 direct report, screenshot of exactly that
		// form). santu-purchase-order (Sales Order's sibling screen) is the
		// real create flow now, same as Sales Order's own sidebar entry
		// (also route-only, no quickadd) — its own view already has a
		// visible "+ Add Purchase Order" button.
		{ view: "purchase_order", label: "Purchase Order", route: "santu-purchase" },
		{ view: "purchase_return", label: "Purchase Return / Dr. Note", route: "santu-purchase", quickadd: { run: () => frappe.set_route("santu-purchase-return") } },
	];

	const NAV_ITEMS = [
		{ type: "link", route: "santu-dashboard", icon: "🏠", label: "Home" },
		{ type: "link", route: "santu-parties", icon: "👥", label: "Parties" },
		{ type: "link", route: "santu-items", icon: "📦", label: "Items", quickadd: { run: () => frappe.set_route("santu-add-item") } },
		// "kaun sa product kitna stock me hai, kis rate me aaya, kis rate me
		// becha ja raha hai" — one screen, next to Items where someone looks
		// for it, not buried three levels into Reports.
		{ type: "link", route: "santu-stock", icon: "📊", label: "Stock & Rates" },
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
				return r[0] === "santu-sale" || r[0] === "santu-sale-invoice" || r[0] === "santu-billing";
			},
			getView: () => {
				if (get_route()[0] === "santu-sale-invoice") return "new_invoice";
				if (get_route()[0] === "santu-billing") return "pos";
				return sessionStorage.getItem("santu_sale_view") || "invoices";
			},
			children: [
				{ view: "invoices", label: "Sale Invoices", route: "santu-sale" },
				{ view: "new_invoice", label: "+ New Sale Invoice", redirect: "santu-sale-invoice" },
				{ view: "quotation", label: "Estimate / Quotation", route: "santu-sale" },
				{ view: "proforma", label: "Proforma Invoice", route: "santu-sale" },
				{ view: "payment_in", label: "Payment In", route: "santu-sale" },
				{ view: "sales_order", label: "Sales Order", route: "santu-sale" },
				{ view: "delivery_challan", label: "Delivery Challan", route: "santu-sale" },
				{ view: "sales_return", label: "Sales Return / Credit Note", route: "santu-sale" },
				{ view: "pos", label: "Billing (POS)", redirect: "santu-billing" },
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
			key: "grow",
			icon: "📈",
			label: "Grow Your Business",
			storageView: "santu_grow_view",
			storageExpanded: "santu_grow_sidebar_expanded",
			defaultView: "whatsapp",
			route: "santu-whatsapp-connect",
			changeEvent: "santu-grow-view-change",
			isActive: () => {
				const r = get_route();
				return r[0] === "santu-whatsapp-connect" || r[0] === "santu-transaction-message";
			},
			getView: () => (get_route()[0] === "santu-transaction-message" ? "messages" : "whatsapp"),
			children: [
				{ view: "whatsapp", label: "WhatsApp Connect", route: "santu-whatsapp-connect" },
				{ view: "messages", label: "Transaction Message", route: "santu-transaction-message" },
			],
		},
		{ type: "link", route: "santu-reports", icon: "📊", label: "Reports" },
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
				{ view: "shop_profile", label: "Shop Profile", run: () => window.santu_open_shop_profile() },
				{ view: "payment_modes", label: "Payment Modes", run: () => window.santu_open_payment_modes() },
				{ view: "cost_price_lock", label: "Cost Price Lock", run: () => window.santu_privacy.manage_dialog() },
				{ view: "accountant_access", label: "Accountant Access", route: "santu-utilities" },
				{ view: "barcode_generator", label: "Barcode Generator", route: "santu-utilities" },
				{ view: "bulk_update", label: "Update Items In Bulk", route: "santu-utilities" },
				{ view: "import_parties", label: "Import Parties", route: "santu-utilities" },
				{ view: "track_salesmen", label: "Track Your Salesmen", route: "santu-utilities" },
				{ view: "export_tally", label: "Exports To Tally", route: "santu-utilities" },
				{ view: "export_items", label: "Export Items", route: "santu-utilities" },
				{ view: "printer_settings", label: "Printer Settings", route: "santu-utilities" },
				{ view: "verify_data", label: "Verify My Data", route: "santu-utilities" },
				{ view: "close_fy", label: "Close Financial Year", route: "santu-utilities" },
			],
		},
		{ type: "workspace", route: "Settings", icon: "⚙️", label: "Settings" },
		{
			type: "group",
			key: "more",
			icon: "➕",
			label: "More",
			no_default_nav: true,
			storageExpanded: "santu_more_sidebar_expanded",
			isActive: () => {
				const r = get_route();
				// santu-cash-bank is reached from the Accounting workspace's
				// own "Cash & Bank" shortcut, so it counts as being inside
				// this group too — otherwise opening it would leave nothing
				// highlighted in the sidebar.
				if (r[0] === "santu-cash-bank") return true;
				return r[0] === "Workspaces" && ["Accounting", "ERPNext Settings"].includes(r[1]);
			},
			getView: () => {
				const r = get_route();
				if (r[0] === "santu-cash-bank") return "Accounting";
				return r[0] === "Workspaces" ? r[1] : null;
			},
			children: [
				// 2026-08-15 direct request: "cash and bank section mujjhe
				// faltoo ka lag raha hai, ise more me dalo" — demoted from a
				// top-level item to a More entry rather than removed, since
				// it's still the only way into the Accounting workspace.
				{ view: "Accounting", label: "Cash & Bank", type: "workspace", route: "Accounting" },
				{ view: "ERPNext Settings", label: "ERPNext Settings", type: "workspace", route: "ERPNext Settings" },
			],
		},
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

	function open_quickadd(qa) {
		// `run` wins when present: entries whose target is one of our own
		// Vyapar screens go straight there. Going through
		// frappe.new_doc(doctype) instead would bounce off the router's
		// new-<doctype> redirect, which only knows the doctype and would
		// silently drop the intent — Payment-Out's party_type: "Supplier"
		// would land on Payment-IN (2026-08-15, caught while wiring the
		// Expense screen).
		if (qa.run) {
			qa.run();
			return;
		}
		// frappe.new_doc's route_options mechanism silently drops any field
		// marked no_copy in its doctype JSON (e.g. Sales/Purchase Invoice's
		// "is_return") — confirmed live 2026-08-15 testing: "Purchase Return"
		// opened a blank invoice with the Is Return checkbox NOT ticked.
		// Re-applying via set_value after the form loads catches exactly
		// those dropped fields (already-applied ones are a no-op).
		frappe.new_doc(qa.doctype, qa.defaults || {}).then(() => {
			if (qa.defaults && cur_frm) {
				Object.keys(qa.defaults).forEach((k) => {
					if (cur_frm.doc[k] !== qa.defaults[k]) cur_frm.set_value(k, qa.defaults[k]);
				});
			}
		});
	}

	function navigate(item, group) {
		close_mobile_sidebar();
		// Some settings are a single small form. Routing to a page whose only
		// content is a button to open that form is the thing that made the
		// old setup wizard feel broken -- six of its seven steps were exactly
		// that. These open their form directly instead.
		if (item.run) {
			item.run();
			return;
		}
		if (item.redirect) {
			frappe.set_route(item.redirect);
			return;
		}
		if (item.type === "workspace") {
			frappe.set_route("Workspaces", item.route);
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
		const expanded = item.isActive();
		const group_active = item.isActive();
		const $group = $(`
			<div class="santu-app-sidebar-group${expanded ? " is-expanded" : ""}${group_active ? " is-active" : ""}" data-group="${item.key}">
				<button type="button" class="santu-app-sidebar-item santu-app-sidebar-parent" title="${frappe.utils.escape_html(item.label)}">
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
			const $child = $(`
				<button type="button" class="santu-app-sidebar-item santu-app-sidebar-child${child_active ? " is-active" : ""}">
					<span class="santu-app-sidebar-icon">•</span>
					<span class="santu-app-sidebar-text">${__(child.label)}</span>
					${child.quickadd ? `<span class="santu-app-sidebar-quickadd" title="Quick add">+</span>` : ""}
				</button>
			`)
				.on("click", (e) => {
					if ($(e.target).closest(".santu-app-sidebar-quickadd").length) return;
					sessionStorage.setItem(item.storageExpanded, "1");
					navigate(child, item);
					update_active_states();
				})
				.appendTo($children);
			if (child.quickadd) {
				$child.find(".santu-app-sidebar-quickadd").on("click", (e) => {
					e.stopPropagation();
					open_quickadd(child.quickadd);
				});
			}
		});
		$group.find(".santu-app-sidebar-parent").on("click", () => {
			if (is_sidebar_collapsed()) {
				if (item.no_default_nav) navigate(item.children[0]);
				else {
					sessionStorage.setItem(item.storageView, item.defaultView);
					frappe.route_options = { view: item.defaultView };
					frappe.set_route(item.route);
				}
				return;
			}
			const will_expand = !$group.hasClass("is-expanded");
			$("#santu-app-sidebar .santu-app-sidebar-group").each(function () {
				const $g = $(this);
				const open = will_expand && $g.data("group") === item.key;
				$g.toggleClass("is-expanded", open);
				$g.find(".santu-app-sidebar-chevron").text(open ? "▼" : "▶");
				const key = $g.data("group");
				const group_item = NAV_ITEMS.find((n) => n.type === "group" && n.key === key);
				if (group_item) sessionStorage.setItem(group_item.storageExpanded, open ? "1" : "0");
			});
			if (!will_expand || item.no_default_nav) return;
			sessionStorage.setItem(item.storageView, item.defaultView);
			frappe.route_options = { view: item.defaultView };
			frappe.set_route(item.route);
		});
		$list.append($group);
	}

	function build_sidebar() {
		const $existing = $("#santu-app-sidebar");
		if ($existing.length && $existing.attr("data-nav-version") === SIDEBAR_NAV_VERSION) {
			return;
		}
		$existing.remove();

		const $sidebar = $(`<nav id="santu-app-sidebar" class="santu-app-sidebar" data-nav-version="${SIDEBAR_NAV_VERSION}" aria-label="Main navigation"></nav>`);

		$(`<button type="button" class="santu-app-sidebar-collapse-toggle" title="Collapse/expand sidebar">‹</button>`)
			.on("click", toggle_sidebar_collapsed)
			.appendTo($sidebar);

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

			const $item = $(`
				<button type="button" class="santu-app-sidebar-item${active ? " is-active" : ""}" data-nav-type="${item.type}" data-nav-route="${frappe.utils.escape_html(item.route || "")}" title="${frappe.utils.escape_html(item.label)}">
					<span class="santu-app-sidebar-icon">${item.icon}</span>
					<span class="santu-app-sidebar-text">${__(item.label)}</span>
					${item.quickadd ? `<span class="santu-app-sidebar-quickadd" title="Quick add">+</span>` : ""}
				</button>
			`)
				.on("click", (e) => {
					if ($(e.target).closest(".santu-app-sidebar-quickadd").length) return;
					navigate(item);
				})
				.appendTo($list);
			if (item.quickadd) {
				$item.find(".santu-app-sidebar-quickadd").on("click", (e) => {
					e.stopPropagation();
					open_quickadd(item.quickadd);
				});
			}
		});

		const company = frappe.boot.sysdefaults && frappe.boot.sysdefaults.company;
		if (company) {
			const initials = company
				.split(" ")
				.map((w) => w[0])
				.join("")
				.slice(0, 2)
				.toUpperCase();
			$(`
				<div class="santu-app-sidebar-company">
					<span class="santu-app-sidebar-company-badge">${frappe.utils.escape_html(initials)}</span>
					<span>${frappe.utils.escape_html(company.toUpperCase())}</span>
				</div>
			`)
				.on("click", () => window.santu_open_shop_profile())
				.appendTo($sidebar);
		}

		$sidebar.appendTo("body");
		document.body.classList.add("santu-fixed-sidebar");
		apply_collapsed_state();

		if (!$("#santu-app-sidebar-backdrop").length) {
			$(`<div id="santu-app-sidebar-backdrop"></div>`)
				.on("click", close_mobile_sidebar)
				.appendTo("body");
		}
		if (!$("#santu-app-sidebar-toggle").length) {
			$(`<button type="button" id="santu-app-sidebar-toggle" aria-label="Menu">☰</button>`)
				.on("click", toggle_mobile_sidebar)
				.appendTo("body");
		}
	}

	function open_mobile_sidebar() {
		document.body.classList.add("santu-sidebar-open");
	}
	function close_mobile_sidebar() {
		document.body.classList.remove("santu-sidebar-open");
	}
	function toggle_mobile_sidebar() {
		document.body.classList.toggle("santu-sidebar-open");
	}

	function is_sidebar_collapsed() {
		return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
	}
	function apply_collapsed_state() {
		const collapsed = is_sidebar_collapsed();
		document.body.classList.toggle("santu-sidebar-collapsed", collapsed);
		document.documentElement.style.setProperty(
			"--santu-sidebar-width",
			`${collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH}px`
		);
		$("#santu-app-sidebar-collapse-toggle, .santu-app-sidebar-collapse-toggle").text(collapsed ? "›" : "‹");
	}
	function toggle_sidebar_collapsed() {
		localStorage.setItem(SIDEBAR_COLLAPSE_KEY, is_sidebar_collapsed() ? "0" : "1");
		apply_collapsed_state();
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
			close_mobile_sidebar();
		} else {
			build_sidebar();
			close_mobile_sidebar();
			$("#santu-app-sidebar").show();
			document.body.classList.add("santu-fixed-sidebar");
			apply_collapsed_state();
			update_active_states();
		}
	}

	$(document).on("page-change", toggle_sidebar_visibility);
	frappe.router.on("change", toggle_sidebar_visibility);
	$(toggle_sidebar_visibility);
})();
