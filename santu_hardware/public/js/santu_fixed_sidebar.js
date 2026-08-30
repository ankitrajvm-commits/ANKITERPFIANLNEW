/*
 * Global fixed left sidebar — always visible on Desk (except kiosk/POS).
 */
(function () {
	const SIDEBAR_WIDTH = 260;
	const SIDEBAR_WIDTH_COLLAPSED = 64;
	// Bump whenever NAV_ITEMS changes shape — build_sidebar() reuses an
	// already-rendered sidebar when this matches, so without a bump an open
	// tab keeps the old menu.
	const SIDEBAR_NAV_VERSION = "vyapar-match-28";

	// Nav glyphs are real icon files now, not emoji: emoji render differently
	// on every OS (this shop is used from both a Mac and a phone) and sat at
	// their own fixed colours, so an active item's icon never picked up the
	// active colour. Painted via mask-image + currentColor so each icon takes
	// whatever colour its row already uses — which also keeps them correct if
	// the sidebar theme flips between the light and dark palettes both
	// stylesheets define. A non-filename value is still rendered as text, so
	// any leftover glyph keeps working.
	const SANTU_NAV_ICON_DIR = "/assets/santu_hardware/images/items";
	const santu_nav_icon_html = (icon) => {
		if (!icon) return '<span class="santu-app-sidebar-icon"></span>';
		if (!/\.(svg|png|webp)$/i.test(icon)) return `<span class="santu-app-sidebar-icon">${icon}</span>`;
		// Stamped like the CSS/JS: without it the browser keeps serving a
		// redrawn icon's old copy until a hard reload.
		const url = `${SANTU_NAV_ICON_DIR}/${encodeURIComponent(icon)}?v=${santu_asset_stamp()}`;
		return `<span class="santu-app-sidebar-icon santu-app-sidebar-icon-img" style="--santu-nav-ico:url('${url}')"></span>`;
	};
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
		// Purchase Return moved to its own "Return" group, alongside Sales
		// Return (2026-08-18 direct request) — see NAV_ITEMS below.
	];

	// Nested one level inside "More" (2026-08-18 direct request: "purchase
	// and expense ko hata kr more me daal do") — Sale stays top-level since
	// it is the more frequent daily action; Purchase & Expense is reachable
	// one extra tap down. `type: "group"` on a child (not just a top-level
	// NAV_ITEMS entry) is what build_group() below recurses on to render a
	// full nested accordion instead of a plain leaf button.
	const PURCHASE_GROUP = {
		type: "group",
		key: "purchase",
		icon: "Purchase.svg",
		label: "Purchase & Expense",
		storageView: "santu_purchase_view",
		storageExpanded: "santu_purchase_sidebar_expanded",
		defaultView: "bills",
		route: "santu-purchase",
		changeEvent: "santu-purchase-view-change",
		isActive: () => get_route()[0] === "santu-purchase",
		getView: () => sessionStorage.getItem("santu_purchase_view") || "bills",
		children: PURCHASE_CHILDREN,
	};

	const NAV_ITEMS = [
		{ type: "link", route: "santu-dashboard", icon: "home.svg", label: "Home" },
		// Locked to customers-only (2026-08-18 direct request: the counter's
		// day-to-day flow has no use for supplier info right now — "party
		// info ka koi kaam nahi hai... ye sab 2.0 me krenge"). Same page,
		// same route family, just a second route segment the page itself
		// reads to lock the list — see santu_parties.js on_page_show. The
		// full Customer+Supplier directory still exists, moved to More as
		// "Parties2" for whenever it's actually needed again.
		{ type: "link", route: "santu-parties/customers", icon: "Parties.svg", label: "Parties" },
		// Items and Stock & Rates were two separate screens showing
		// overlapping things (2026-08-17: "items and stock and rates ko
		// merge kro") — Stock & Rates absorbed Items' Products/Services
		// tabs, Category/Units management, and per-item detail+history, so
		// there is now exactly one place to look for any of it.
		{
			// Was a plain link — "Update Items In Bulk" moved here from More
			// (2026-08-19 direct request), which needed Items to actually be
			// an expandable group. Clicking the row itself still goes
			// straight to Items/Stock, same as before; the chevron is what's
			// new.
			type: "group",
			key: "items",
			icon: "Items.svg",
			label: "Items",
			storageExpanded: "santu_items_sidebar_expanded",
			route: "santu-stock",
			quickadd: { run: () => frappe.set_route("santu-add-item") },
			isActive: () =>
				get_route()[0] === "santu-stock" ||
				(get_route()[0] === "santu-utilities" && sessionStorage.getItem("santu_utilities_view") === "bulk_update"),
			getView: () =>
				get_route()[0] === "santu-utilities" && sessionStorage.getItem("santu_utilities_view") === "bulk_update"
					? "bulk_update"
					: null,
			children: [
				{ view: "bulk_update", label: "Update Items In Bulk", route: "santu-utilities", storageView: "santu_utilities_view" },
			],
		},
		{
			type: "group",
			key: "sale",
			icon: "Sale.svg",
			label: "Sale",
			storageView: "santu_sale_view",
			storageExpanded: "santu_sale_sidebar_expanded",
			defaultView: "invoices",
			route: "santu-sale",
			changeEvent: "santu-sale-view-change",
			isActive: () => {
				const r = get_route();
				return (
					r[0] === "santu-sale" ||
					r[0] === "santu-sale-invoice" ||
					r[0] === "santu-billing" ||
					r[0] === "santu-delivery-challan"
				);
			},
			getView: () => {
				if (get_route()[0] === "santu-sale-invoice") return "new_invoice";
				if (get_route()[0] === "santu-billing") return "pos";
				if (get_route()[0] === "santu-delivery-challan") return "delivery_challan";
				return sessionStorage.getItem("santu_sale_view") || "invoices";
			},
			children: [
				{ view: "invoices", label: "Sale Invoices", route: "santu-sale" },
				{ view: "quotation", label: "Estimate / Quotation", route: "santu-sale" },
				{ view: "payment_in", label: "Payment In", route: "santu-sale" },
				{ view: "pos", label: "Billing (POS)", redirect: "santu-billing" },
				// Back under Sale, not "More" (2026-08-27 direct request: "sale
				// me chalan add ker do child me") — was moved into More on
				// 2026-08-18 along with Proforma/Sales Order, but Ankit wants
				// it reachable from Sale directly again.
				{ view: "delivery_challan", label: "Delivery Challan", route: "santu-sale" },
			],
		},
		{
			// Sale's and Purchase's own return entries pulled into one place
			// (2026-08-18 direct request: "return ka ek parent bana do sale ke
			// niche") — a return is neither a sale nor a purchase in the
			// operator's head; it undoes one, so it gets its own spot right
			// under Sale rather than being buried a tab deep inside either.
			// Same cross-group-leaf pattern as Purchase's other relocated
			// items: each child carries its OWN storageView, since it still
			// really belongs to Sale's or Purchase's page/view, not this
			// group's.
			type: "group",
			key: "return",
			icon: "return.svg",
			label: "Return",
			storageExpanded: "santu_return_sidebar_expanded",
			no_default_nav: true,
			route: "santu-sale",
			isActive: () => {
				const r = get_route();
				return (
					(r[0] === "santu-sale" && sessionStorage.getItem("santu_sale_view") === "sales_return") ||
					(r[0] === "santu-purchase" && sessionStorage.getItem("santu_purchase_view") === "purchase_return")
				);
			},
			getView: () => {
				const r = get_route();
				if (r[0] === "santu-sale" && sessionStorage.getItem("santu_sale_view") === "sales_return") return "sales_return";
				if (r[0] === "santu-purchase" && sessionStorage.getItem("santu_purchase_view") === "purchase_return") return "purchase_return";
				return null;
			},
			children: [
				{ view: "sales_return", label: "Sales Return / Credit Note", route: "santu-sale", storageView: "santu_sale_view" },
				{
					view: "purchase_return",
					label: "Purchase Return / Dr. Note",
					route: "santu-purchase",
					storageView: "santu_purchase_view",
					quickadd: { run: () => frappe.set_route("santu-purchase-return") },
				},
			],
		},
		{
			type: "group",
			key: "grow",
			// Points at whatsappLeftNav.svg, the file actually maintained for
			// this row (whatsapp.svg is the older duplicate).
			icon: "whatsappLeftNav.svg",
			label: "WhatsApp",
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
		{
			type: "group",
			key: "sync",
			icon: "backup.svg",
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
			icon: "Utilities.svg",
			label: "Utilities",
			storageView: "santu_utilities_view",
			storageExpanded: "santu_utilities_sidebar_expanded",
			// Was "import_items" — moved into More (2026-08-18), so the
			// group's own default landing view points at something still
			// listed under Utilities itself.
			defaultView: "shop_profile",
			route: "santu-utilities",
			changeEvent: "santu-utilities-view-change",
			isActive: () => get_route()[0] === "santu-utilities",
			getView: () => sessionStorage.getItem("santu_utilities_view") || "shop_profile",
			children: [
				// Doctor leads the list: it is what someone opens when something
				// has stopped working, and hunting for it is the last thing
				// anyone wants to do at that moment.
				{ view: "doctor", label: "Doctor Uncle (kuch kaam na kare to)", redirect: "santu-doctor" },
				{ view: "shop_profile", label: "Shop Profile", route: "santu-utilities" },
				{ view: "payment_modes", label: "Payment Modes", run: () => window.santu_open_payment_modes() },
				{ view: "cost_price_lock", label: "Cost Price Lock", run: () => window.santu_privacy.manage_dialog() },
				{ view: "barcode_generator", label: "Barcode Generator", route: "santu-utilities" },
				{ view: "printer_settings", label: "Printer Settings", route: "santu-utilities" },
				{ view: "invoice_settings", label: "Invoice Settings", route: "santu-utilities" },
				{ view: "verify_data", label: "Verify My Data", route: "santu-utilities" },
				{ view: "bug_report", label: "Bug Report", route: "santu-utilities" },
				{ view: "feature_workbook", label: "Feature Workbook", redirect: "santu-feature-workbo" },
				{ view: "recycle_bin", label: "Recycle Bin", redirect: "santu-recycle-bin" },
			],
		},
		{
			type: "link",
			route: "santu-utilities",
			icon: "Settings.svg",
			label: "Settings",
			run: () => frappe.set_route("santu-utilities"),
		},
		{
			type: "group",
			key: "more",
			icon: "plus.svg",
			label: "More",
			no_default_nav: true,
			storageExpanded: "santu_more_sidebar_expanded",
			route: "santu-cash-bank",
			// Also "active" while inside Purchase & Expense — it now lives
			// nested one level down inside this group, not as its own
			// top-level entry, so the group needs to stay highlighted/open
			// state-aware for it the same way it already is for Cash & Bank.
			isActive: () => get_route()[0] === "santu-cash-bank" || get_route()[0] === "santu-purchase",
			getView: () => (get_route()[0] === "santu-cash-bank" ? "cash_bank" : null),
			children: [
				{ view: "cash_bank", label: "Cash & Bank", redirect: "santu-cash-bank" },
				// Moved out of Sale's own children (2026-08-18 direct request:
				// "new sale invoice, proforma, delivery chalan, sales order ko
				// more me dalo") — Sale Invoices, Estimate/Quotation, Payment
				// In and Billing (POS) are what the counter actually opens day
				// to day; these four stay reachable, just not first-line. Each
				// still routes to Sale's own page/view, so they carry Sale's
				// storageView the same way the other relocated leaves below
				// carry Utilities' — a leaf living in a different group than
				// the page it routes to needs that (see the comment further
				// down on accountant_access etc.).
				{ view: "new_invoice", label: "+ New Sale Invoice", redirect: "santu-billing" },
				{ view: "proforma", label: "Proforma Invoice", route: "santu-sale", storageView: "santu_sale_view" },
				{ view: "sales_order", label: "Sales Order", route: "santu-sale", storageView: "santu_sale_view" },
				// Delivery Challan moved back under Sale itself (2026-08-27
				// direct request) — see Sale's own children list above.
				// Moved out of the top level (2026-08-18 direct request) — a
				// plain route, same as Cash & Bank above it.
				{ route: "santu-reports", label: "Reports" },
				// The full Customer+Supplier directory (2026-08-18 direct
				// request) — "Parties" itself, in the main sidebar, now only
				// ever shows customers (see the santu-parties/customers entry
				// above); this unlocked version — same screen, same route,
				// just without the "/customers" segment — is what still has
				// suppliers in it, kept here rather than deleted for whenever
				// that's actually needed again.
				{ route: "santu-parties", label: "All Parties (Customers & Suppliers)" },
				PURCHASE_GROUP,
				// Moved out of Utilities (2026-08-18 direct request). Each
				// carries its own `storageView` — a leaf living inside a
				// DIFFERENT group than the page it routes to needs that, since
				// navigate() otherwise writes the view into the CLICKING
				// group's storage key (More has none of its own) rather than
				// "santu_utilities_view", which the Utilities page itself reads.
				{ view: "accountant_access", label: "Accountant Access", route: "santu-utilities", storageView: "santu_utilities_view" },
				// Update Items In Bulk moved under Items (2026-08-19 direct
				// request) — it's about items, not shop-wide setup, so it
				// belongs in the group that's actually about items.
				{ view: "import_parties", label: "Import Parties", route: "santu-utilities", storageView: "santu_utilities_view" },
				{ view: "track_salesmen", label: "Track Your Salesmen", route: "santu-utilities", storageView: "santu_utilities_view" },
				{ view: "export_items", label: "Export Items", route: "santu-utilities", storageView: "santu_utilities_view" },
				{ view: "import_items", label: "Import Items", route: "santu-utilities", storageView: "santu_utilities_view" },
				{ view: "export_tally", label: "Exports To Tally", route: "santu-utilities", storageView: "santu_utilities_view" },
				{ view: "close_fy", label: "Close Financial Year", route: "santu-utilities", storageView: "santu_utilities_view" },
			],
		},
	];

	// Flat lookup of every group — top-level ones AND ones nested inside
	// another group's children (like Purchase & Expense inside More) — since
	// active-state highlighting and the "collapse every other group" click
	// handler both need to find any group by key regardless of how deep it
	// is nested, not just the ones directly in NAV_ITEMS.
	const ALL_GROUPS = (function collect_groups(items) {
		let out = [];
		items.forEach((item) => {
			if (item.type !== "group") return;
			out.push(item);
			out = out.concat(collect_groups(item.children || []));
		});
		return out;
	})(NAV_ITEMS);

	// Parent key of every nested group (Purchase & Expense -> "more") — so
	// opening a nested group can keep its own ancestors expanded instead of
	// collapsing them along with every other unrelated group, which would
	// otherwise immediately hide the very group that was just opened (it
	// lives inside its parent's now-collapsed .santu-app-sidebar-children).
	const GROUP_PARENT = (function collect_parents(items, parentKey) {
		let out = {};
		items.forEach((item) => {
			if (item.type !== "group") return;
			if (parentKey) out[item.key] = parentKey;
			Object.assign(out, collect_parents(item.children || [], item.key));
		});
		return out;
	})(NAV_ITEMS, null);

	function group_and_ancestor_keys(key) {
		const keys = [];
		let k = key;
		while (k) {
			keys.push(k);
			k = GROUP_PARENT[k];
		}
		return keys;
	}

	function is_kiosk() {
		return document.body.classList.contains("santu-kiosk-mode");
	}

	function get_route() {
		return frappe.get_route() || [];
	}

	function is_active_link(route) {
		// frappe.get_route_str() calls frappe.get_route().join("/") with no
		// null guard — mid-navigation to a "new" unsaved document (confirmed
		// live 2026-08-20: /app/letter-head/new-letter-head) frappe.get_route()
		// briefly returns null, and that .join() throws and aborts the
		// sidebar's click handler entirely, leaving the whole page body blank
		// until a manual reload picks up the route once it has settled. Using
		// the local get_route() helper (already null-safe, defaults to [])
		// instead of frappe.get_route_str() sidesteps the crash.
		return get_route().join("/") === route;
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
		// A leaf can live inside a DIFFERENT group than the page it actually
		// routes to (Utilities items relocated into More, 2026-08-18) — find
		// the group that really owns that route/view pair (falling back to
		// the clicking group when the leaf is a normal, un-relocated child)
		// so its storage key and change-event are used, not the clicking
		// group's. Using the clicking group's own route_options/changeEvent
		// here also matters when the target page is ALREADY open: set_route
		// to an unchanged route fires no router "change" event, so without
		// the target's changeEvent trigger a relocated leaf's click would
		// silently do nothing while already sitting on that very page.
		if (group && item.view && item.route) {
			const target_group = ALL_GROUPS.find((g) => g.route === item.route) || group;
			const storage_key = item.storageView || target_group.storageView;
			if (storage_key) sessionStorage.setItem(storage_key, item.view);
			frappe.route_options = { view: item.view };
			frappe.set_route(item.route);
			if (target_group.changeEvent) $(document).trigger(target_group.changeEvent);
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
					${santu_nav_icon_html(item.icon)}
					<span class="santu-app-sidebar-text">${__(item.label)}</span>
					<span class="santu-app-sidebar-chevron">${expanded ? "▼" : "▶"}</span>
				</button>
				<div class="santu-app-sidebar-children"></div>
			</div>
		`);
		const $children = $group.children(".santu-app-sidebar-children");
		const current_view = item.getView();
		item.children.forEach((child) => {
			// A child that is itself a group (Purchase & Expense nested inside
			// More) gets its own full nested accordion, not a plain leaf
			// button — recurses into the exact same rendering this group
			// itself just went through.
			if (child.type === "group") {
				build_group(child, $children);
				return;
			}
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
		// Scoped to THIS group's own toggle button, not `.find()` — a nested
		// group (Purchase inside More) has its own `.santu-app-sidebar-parent`
		// button too, and `.find()` being a descendant search would have bound
		// a second, wrong click handler onto it from the ancestor's call.
		$group.children(".santu-app-sidebar-parent").on("click", () => {
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
			// Opening this group must not collapse its OWN ancestors — e.g.
			// opening Purchase & Expense (nested inside More) must leave More
			// expanded too, or Purchase's row would immediately disappear
			// inside its now-hidden parent right after being opened.
			const keep_open_keys = will_expand ? group_and_ancestor_keys(item.key) : [];
			$("#santu-app-sidebar .santu-app-sidebar-group").each(function () {
				const $g = $(this);
				const key = $g.data("group");
				const open = keep_open_keys.includes(key);
				$g.toggleClass("is-expanded", open);
				// Scoped to this group's own chevron — `.find()` would also
				// reach a nested group's chevron (Purchase inside More).
				$g.children(".santu-app-sidebar-parent").find(".santu-app-sidebar-chevron").text(open ? "▼" : "▶");
				// ALL_GROUPS, not NAV_ITEMS — a nested group (like Purchase,
				// now inside More) isn't a direct NAV_ITEMS entry anymore, so
				// looking it up there always missed and its own expand/collapse
				// state was never actually remembered across reloads.
				const group_item = ALL_GROUPS.find((n) => n.key === key);
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
					${santu_nav_icon_html(item.icon)}
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
			$(`
				<div class="santu-app-sidebar-company">
					<img class="santu-app-sidebar-company-badge" src="/assets/santu_hardware/images/logo.svg?v=${santu_asset_stamp()}" alt="">
					<span>${frappe.utils.escape_html(company)}</span>
				</div>
			`)
				.on("click", () => window.santu_open_shop_profile())
				.appendTo($sidebar);
		}

		$sidebar.appendTo("body");
		document.body.classList.add("santu-fixed-sidebar");
		apply_collapsed_state();
		bind_sidebar_tooltips();

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
	// Collapsed sidebar is icons only, and the browser's own title tooltip
	// takes a second to appear and can be missed entirely — the icons then
	// read as a guessing game. This shows the name instantly beside the
	// icon. Appended to <body>, not the sidebar, so it is not clipped.
	function bind_sidebar_tooltips() {
		if (window.__santu_sb_tips_bound) return;
		window.__santu_sb_tips_bound = true;

		const $tip = $(`<div class="santu-sb-tip" style="display:none;"></div>`).appendTo(document.body);
		const hide = () => $tip.hide();

		$(document)
			.on("mouseenter", ".santu-app-sidebar-item", function () {
				if (!document.body.classList.contains("santu-sidebar-collapsed")) return hide();
				const label =
					$(this).attr("title") || $(this).find(".santu-app-sidebar-text").first().text().trim();
				if (!label) return hide();
				const r = this.getBoundingClientRect();
				$tip.text(label)
					.css({ top: Math.round(r.top + r.height / 2), left: Math.round(r.right + 10) })
					.show();
			})
			.on("mouseleave", ".santu-app-sidebar-item", hide);

		$(window).on("scroll resize", hide);
	}

	// The logo is a plain image URL, so the browser holds on to it across
	// redeploys — a redrawn logo kept showing the old one until a hard
	// reload. Borrow the ?v= stamp hooks.py already stamps on the app's own
	// CSS so the image busts with everything else.
	function santu_asset_stamp() {
		const link = document.querySelector('link[href*="/santu_hardware/css/"][href*="?v="]');
		return link ? link.href.split("?v=")[1] : "";
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

		// ALL_GROUPS, not NAV_ITEMS — a nested group (Purchase, now inside
		// More) isn't a direct NAV_ITEMS entry, so it never got its own
		// active-state pass and its children never lit up as active/inactive.
		ALL_GROUPS.forEach((item) => {
			const group_active = item.isActive();
			const $group = $(`#santu-app-sidebar .santu-app-sidebar-group[data-group='${item.key}']`);
			$group.toggleClass("is-active", group_active);
			const view = item.getView();
			// Scoped to this group's own direct children — `.find()` would
			// also reach a nested group's children (Purchase's Bills/Payment-
			// Out/etc, while iterating More), which ALL_GROUPS already handles
			// correctly in its own pass and this would otherwise clobber.
			$group
				.children(".santu-app-sidebar-children")
				.children(".santu-app-sidebar-child")
				.each(function () {
					const label = $(this).find(".santu-app-sidebar-text").text();
					const child = item.children.find((c) => __(c.label) === label || c.label === label);
					$(this).toggleClass("is-active", group_active && child && child.view === view);
				});
		});
	}

	// The rail is `position: fixed`, so it needs to know where the top chrome
	// actually ends. That used to be a hardcoded 56px in the CSS, correct only
	// while the navbar sat flush at y=0; the shop status bar (41px) later moved
	// the navbar down and the rail started covering its bottom half, clipping
	// the left of the "Santu Hardware" logo whenever the sidebar was collapsed.
	// The status bar is absent on some screens, so the offset is measured live
	// rather than swapped for a second magic number.
	function sync_sidebar_top() {
		const navbar = document.querySelector(".navbar");
		if (!navbar) return;
		const bottom = Math.round(navbar.getBoundingClientRect().bottom);
		if (bottom > 0) {
			document.documentElement.style.setProperty("--santu-sidebar-top", bottom + "px");
		}
	}

	// The status bar renders and re-renders on its own schedule (staff changes,
	// privacy mode timing out), and each time it can change height — so the rail
	// has to re-measure rather than trust whatever it read at page load.
	let santu_top_observer = null;
	function watch_top_chrome() {
		if (typeof ResizeObserver === "undefined") return;
		if (!santu_top_observer) santu_top_observer = new ResizeObserver(sync_sidebar_top);
		santu_top_observer.disconnect();
		[".santu-status-bar", ".navbar"].forEach((sel) => {
			const el = document.querySelector(sel);
			if (el) santu_top_observer.observe(el);
		});
	}
	$(window).on("resize", sync_sidebar_top);
	document.addEventListener("santu-privacy-mode-change", sync_sidebar_top);

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
			sync_sidebar_top();
			watch_top_chrome();
		}
	}

	$(document).on("page-change", toggle_sidebar_visibility);
	frappe.router.on("change", toggle_sidebar_visibility);
	$(toggle_sidebar_visibility);
})();
