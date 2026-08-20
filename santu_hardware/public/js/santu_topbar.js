// Vyapar-match top bar (2026-08-14 direct request, pixel-match a Vyapar
// screenshot). Injected into Frappe's own navbar rather than replacing it
// wholesale — the real command palette (Cmd+G) and notifications/help/user
// menu underneath all keep working exactly as before, this just adds the
// Vyapar-style row of quick actions Desk doesn't have out of the box.
(function () {
	function is_kiosk() {
		return document.body.classList.contains("santu-kiosk-mode");
	}

	// Single shared "open a saved transaction" entry point (2026-08-15 direct
	// request: the native Form view must never appear anywhere, not even for
	// viewing an already-saved document) — every screen that used to jump
	// straight to `Form/<doctype>/<name>` calls this instead, routing to the
	// Vyapar-style santu-view-invoice screen (backed by
	// santu_hardware.api.get_invoice_view_data) for every doctype below.
	// Anything not in the list still falls back to the native form.
	// Every doctype that can actually reach santu_open_invoice_view() from
	// a transaction row/link anywhere in the app (Sale/Purchase transaction
	// lists, Parties, Customer Dues, etc.) — 2026-08-15 "sabka kr, harek
	// part ka" after Payment Entry rows still fell through to the native
	// Form. Grep santu_open_invoice_view( call sites before removing
	// anything from this list.
	const SANTU_VIEWABLE_DOCTYPES = [
		"Sales Invoice",
		"POS Invoice",
		"Purchase Invoice",
		"Quotation",
		"Sales Order",
		"Purchase Order",
		"Delivery Note",
		"Payment Entry",
		"Journal Entry",
	];
	window.santu_open_invoice_view = function (doctype, name) {
		if (!SANTU_VIEWABLE_DOCTYPES.includes(doctype)) {
			if (doctype === "Customer" || doctype === "Supplier") {
				frappe.set_route("santu-parties");
				return;
			}
			if (doctype === "Item") {
				frappe.set_route("santu-stock");
				return;
			}
			frappe.set_route("santu-dashboard");
			return;
		}
		frappe.route_options = { doctype, name };
		// set_route to the route already showing is a no-op in Frappe — no
		// "show" event fires, so the view page's init() never re-runs and it
		// keeps displaying the PREVIOUS document (or a stale "Could not load
		// this document." if that one failed). Opening a second document
		// from the view screen, and saving while already on it, both hit
		// this. Re-init the live page directly in that case.
		if (frappe.get_route()[0] === "santu-view-invoice" && window.santu_view_invoice_page) {
			santu_view_invoice_page.init(santu_view_invoice_page.page);
			return;
		}
		frappe.set_route("santu-view-invoice");
	};

	// Where each doctype's native LIST view should redirect instead
	// (2026-08-15: "cash and bank k harek functions ko check kro... old wale
	// ko delete kro and new ui lao harek jegeh"). santu-sale/santu-purchase
	// read their active view from sessionStorage, not route_options — and
	// since frappe.set_route() to a route you're ALREADY on doesn't re-fire
	// on_page_load/on_page_show, the sidebar's own view-switch links also
	// trigger santu-*-view-change manually (see santu_fixed_sidebar.js) so
	// an already-open page updates live instead of silently no-op'ing.
	const SANTU_LIST_VIEW_REDIRECTS = {
		"Sales Invoice": () => {
			sessionStorage.setItem("santu_sale_view", "invoices");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		"Purchase Invoice": () => {
			sessionStorage.setItem("santu_purchase_view", "bills");
			frappe.set_route("santu-purchase");
			$(document).trigger("santu-purchase-view-change");
		},
		"Journal Entry": () => {
			sessionStorage.setItem("santu_purchase_view", "expenses");
			frappe.set_route("santu-purchase");
			$(document).trigger("santu-purchase-view-change");
		},
		"Payment Entry": () => {
			sessionStorage.setItem("santu_sale_view", "payment_in");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		"Sales Order": () => {
			sessionStorage.setItem("santu_sale_view", "sales_order");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		"Purchase Order": () => {
			sessionStorage.setItem("santu_purchase_view", "purchase_order");
			frappe.set_route("santu-purchase");
			$(document).trigger("santu-purchase-view-change");
		},
		"Delivery Note": () => {
			sessionStorage.setItem("santu_sale_view", "delivery_challan");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		Quotation: () => {
			sessionStorage.setItem("santu_sale_view", "quotation");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		"POS Invoice": () => {
			sessionStorage.setItem("santu_sale_view", "invoices");
			frappe.set_route("santu-sale");
			$(document).trigger("santu-sale-view-change");
		},
		Item: () => frappe.set_route("santu-stock"),
		Customer: () => frappe.set_route("santu-parties"),
		Supplier: () => frappe.set_route("santu-parties"),
		Contact: () => frappe.set_route("santu-parties"),
		Address: () => frappe.set_route("santu-parties"),
		"Stock Entry": () => frappe.set_route("santu-stock"),
		Warehouse: () => frappe.set_route("santu-stock"),
		"Item Group": () => frappe.set_route("santu-stock"),
		Account: () => frappe.set_route("santu-cash-bank"),
		Company: () => window.santu_open_shop_profile && window.santu_open_shop_profile(),
		"Mode of Payment": () => window.santu_open_payment_modes && window.santu_open_payment_modes(),
		User: () => {
			sessionStorage.setItem("santu_utilities_view", "accountant_access");
			frappe.set_route("santu-utilities");
			$(document).trigger("santu-utilities-view-change");
		},
	};

	function go_santu_report(report_id) {
		sessionStorage.setItem("santu_reports_selected", report_id || "");
		frappe.set_route("santu-reports");
	}
	window.santu_open_report = go_santu_report;

	const SANTU_QUERY_REPORT_IDS = {
		"Stock Balance": "stock_summary_item_category",
		"Sales Register": "sale",
		"Purchase Register": "purchase",
		"General Ledger": "day_book",
		"Stock Ledger": "stock_detail",
		"Profit and Loss Statement": "profit_and_loss",
		"Gross Profit": "bill_wise_profit",
		"Cash Flow": "cash_flow",
		"Trial Balance": "trial_balance",
		"Balance Sheet": "balance_sheet",
		"GSTR-1": "gstr1",
		"GST Purchase Register": "gstr2",
		"GSTR-3B Details": "gstr3b",
		"Item-wise Sales Register": "party_report_by_item",
		"HSN-wise-summary of outward supplies": "sale_summary_hsn",
		"Bank Reconciliation Statement": "bank_statement",
		"Sales Order Analysis": "sale_orders",
	};

	function go_workspace(name) {
		const key = name || "Home";
		const map = {
			Home: () => frappe.set_route("santu-dashboard"),
			home: () => frappe.set_route("santu-dashboard"),
			Accounting: () => frappe.set_route("santu-cash-bank"),
			accounting: () => frappe.set_route("santu-cash-bank"),
			Selling: () => SANTU_LIST_VIEW_REDIRECTS["Sales Invoice"](),
			selling: () => SANTU_LIST_VIEW_REDIRECTS["Sales Invoice"](),
			Buying: () => SANTU_LIST_VIEW_REDIRECTS["Purchase Invoice"](),
			buying: () => SANTU_LIST_VIEW_REDIRECTS["Purchase Invoice"](),
			Stock: () => frappe.set_route("santu-stock"),
			stock: () => frappe.set_route("santu-stock"),
			Settings: () => frappe.set_route("santu-utilities"),
			settings: () => frappe.set_route("santu-utilities"),
			Users: () => {
				sessionStorage.setItem("santu_utilities_view", "accountant_access");
				frappe.set_route("santu-utilities");
				$(document).trigger("santu-utilities-view-change");
			},
			users: () => {
				sessionStorage.setItem("santu_utilities_view", "accountant_access");
				frappe.set_route("santu-utilities");
				$(document).trigger("santu-utilities-view-change");
			},
			Staff: () => {
				sessionStorage.setItem("santu_utilities_view", "accountant_access");
				frappe.set_route("santu-utilities");
				$(document).trigger("santu-utilities-view-change");
			},
			staff: () => {
				sessionStorage.setItem("santu_utilities_view", "accountant_access");
				frappe.set_route("santu-utilities");
				$(document).trigger("santu-utilities-view-change");
			},
			"ERPNext Settings": () => frappe.set_route("santu-utilities"),
			"erpnext-settings": () => frappe.set_route("santu-utilities"),
			CRM: () => frappe.set_route("santu-parties"),
			crm: () => frappe.set_route("santu-parties"),
		};
		(map[key] || (() => frappe.set_route("santu-dashboard")))();
	}

	// Where "create a new <doctype>" should go instead of the native form.
	// Module scope (not tucked inside the ListView patch) because two
	// different patches need the same map: the native list's "+Add" button,
	// and the router's handling of "new-<doctype>-xxxxx" draft routes.
	// Route strings go through frappe.set_route (our own quick-entry pages);
	// Payment Entry has no dedicated create page of its own, so it gets a
	// function — called with no party context, so it defaults to Customer /
	// Collect Payment, the more common case.
	//
	// Note there is deliberately no separate Sales Return entry: a return IS
	// a Sales Invoice, so "new Sales Invoice" must land on the normal sale
	// screen. The return screen is reached from its own view's button.
	const SANTU_LIST_ADD_ACTIONS = {
		"Sales Invoice": () => frappe.set_route("santu-billing"),
		"Purchase Invoice": () => frappe.set_route("santu-purchase-invoice"),
		"Payment Entry": () => window.santu_open_collect_payment({ party_type: "Customer" }),
		"Sales Order": () => frappe.set_route("santu-sales-order"),
		"Purchase Order": () => frappe.set_route("santu-purchase-order"),
		"Delivery Note": () => frappe.set_route("santu-delivery-challan"),
		"Journal Entry": () => frappe.set_route("santu-expense"),
		Quotation: () => frappe.set_route("santu-estimate"),
		"POS Invoice": () => frappe.set_route("santu-billing"),
		Item: () => frappe.set_route("santu-add-item"),
		Customer: () => frappe.set_route("santu-parties"),
		Supplier: () => frappe.set_route("santu-parties"),
	};

	// Single shared "collect/pay money" dialog (2026-08-15 direct request:
	// "total receivable me mark as paid kaha se kre? ya paise jama kaha se
	// hoga?" — there was nowhere to actually record a payment against
	// outstanding dues without the native Payment Entry form). Every button
	// that used to call `frappe.new_doc("Payment Entry", {...})` opens this
	// instead — Customer Dues' "Collect Payment", the Sale/Purchase quick
	// screens' "Payment" action, the topbar mega-menu's Payment-In/Out, and
	// the Sale/Purchase pages' own Payment-In/Payment-Out buttons all share
	// this one dialog + one backend call (create_payment_entry), rather than
	// each wiring up its own copy.
	// 2026-08-15 ("payment in me ui vyapaar ke jaisa kro and kuch bugs hai"):
	// this used to BE a frappe.ui.Dialog — a bare amount box with nothing on
	// screen about what the party owed, and a Mode of Payment that defaulted
	// to whatever sorted first alphabetically ("Bank Draft"), quietly
	// mis-recording cash collections. It now routes to the real Vyapar-style
	// santu-payment-entry screen instead, so every caller gets the same one
	// path rather than each keeping its own dialog copy.
	window.santu_open_collect_payment = function (opts) {
		opts = opts || {};
		const route_options = {
			party_type: opts.party_type || "Customer",
			party: opts.party || null,
			amount: opts.amount || null,
		};
		// set_route to the route already showing is a no-op in Frappe — no
		// "show" event, so on_page_show never runs and the screen would keep
		// the previous party. Collecting from two parties back-to-back is
		// normal at a counter, so hand the options straight to the live page
		// in that case instead.
		// A Page route is ["santu-payment-entry"] — the name sits at index 0,
		// not 1 the way a Form/List route's doctype does.
		if (frappe.get_route()[0] === "santu-payment-entry" && window.santu_payment_entry_page) {
			santu_payment_entry_page.apply_route_options(route_options);
			return;
		}
		frappe.route_options = route_options;
		frappe.set_route("santu-payment-entry");
	};

	// "+Add More" mega-menu — pixel-matched to a Vyapar screenshot
	// (2026-08-14). Every item now opens one of our own Vyapar-style
	// screens. "Party To Party Transfer" was the last holdout: it used to
	// point at the raw Journal Entry form for want of a dedicated doctype,
	// and once new-<doctype> routes began redirecting it started landing on
	// the Expense screen instead. It has its own screen now
	// (santu-party-transfer) — a transfer is a real thing a shop does, not
	// an expense.
	const MEGA_MENU_COLUMNS = [
		{
			heading: "SALE",
			items: [
				{ label: "Sale Invoice", shortcut: "⌥S", action: () => frappe.set_route("santu-billing") },
				{ label: "Payment-In", shortcut: "⌥I", action: () => window.santu_open_collect_payment({ party_type: "Customer" }) },
				{ label: "Sale Return", sub: "Cr Note", shortcut: "⌥R", action: () => frappe.set_route("santu-sales-return") },
				{ label: "Sale Order", shortcut: "⌥F", action: () => frappe.set_route("santu-sales-order") },
				{ label: "Estimate/Quotation", shortcut: "⌥M", action: () => frappe.set_route("santu-estimate") },
				{ label: "Proforma Invoice", shortcut: "⌥K", action: () => frappe.set_route("santu-billing") },
				{ label: "Delivery Challan", shortcut: "⌥D", action: () => frappe.set_route("santu-delivery-challan") },
			],
		},
		{
			heading: "PURCHASE",
			items: [
				{ label: "Purchase Bill", shortcut: "⌥P", action: () => frappe.set_route("santu-purchase-invoice") },
				{ label: "Payment-Out", shortcut: "⌥O", action: () => window.santu_open_collect_payment({ party_type: "Supplier" }) },
				{ label: "Purchase Return", sub: "Dr Note", shortcut: "⌥L", action: () => frappe.set_route("santu-purchase-return") },
				{ label: "Purchase Order", shortcut: "⌥G", action: () => frappe.set_route("santu-purchase-order") },
			],
		},
		{
			heading: "OTHERS",
			items: [
				{ label: "Expenses", shortcut: "⌥E", action: () => frappe.set_route("santu-expense") },
				{ label: "Party To Party Transfer", shortcut: "⌥J", action: () => frappe.set_route("santu-party-transfer") },
			],
		},
	];

	function open_quick_menu($anchor) {
		$(".santu-topbar-mega").remove();
		const $mega = $(`<div class="santu-topbar-mega"></div>`);
		const $cols = $(`<div class="santu-topbar-mega-cols"></div>`).appendTo($mega);
		MEGA_MENU_COLUMNS.forEach((col) => {
			const $col = $(`<div class="santu-topbar-mega-col"><div class="santu-topbar-mega-heading">${col.heading}</div></div>`).appendTo($cols);
			col.items.forEach((item) => {
				$(`
					<button type="button" class="santu-topbar-mega-item">
						<span class="santu-topbar-mega-item-label">▸ ${frappe.utils.escape_html(item.label)}${item.sub ? `<span class="santu-topbar-mega-item-sub">${frappe.utils.escape_html(item.sub)}</span>` : ""}</span>
						<span class="santu-topbar-mega-item-kbd">${item.shortcut}</span>
					</button>
				`)
					.on("click", () => {
						$mega.remove();
						item.action();
					})
					.appendTo($col);
			});
		});
		$(`<div class="santu-topbar-mega-footer">Shortcut to open this menu: <span class="santu-topbar-mega-kbd">⌘</span> + <span class="santu-topbar-mega-kbd santu-topbar-mega-kbd-enter">Enter</span></div>`).appendTo($mega);

		$("body").append($mega);
		const rect = $anchor[0].getBoundingClientRect();
		$mega.css({ top: rect.bottom + 8 + "px", right: window.innerWidth - rect.right + "px" });
		setTimeout(() => {
			$(document).one("click.santu-topbar-mega", (e) => {
				if (!$(e.target).closest(".santu-topbar-mega, .santu-topbar-quick").length) $mega.remove();
			});
		}, 0);
	}

	function all_mega_menu_items() {
		return MEGA_MENU_COLUMNS.flatMap((c) => c.items);
	}

	function open_more_menu($anchor) {
		const items = [
			{ label: "Privacy", action: () => toggle_dashboard_privacy() },
			{
				label: "Settings",
				action: () => {
					frappe.set_route("santu-utilities");
				},
			},
			{ label: "Reports", action: () => frappe.set_route("santu-reports") },
			{ label: "Log out", action: () => frappe.app.logout() },
		];
		show_dropdown($anchor, items);
	}

	// ---------- Privacy (2026-08-14 direct request) — blurs page content
	// with an eye-lock overlay until toggled off again. Deliberately a
	// separate feature/body-class from kiosk_mode.js's existing "Privacy
	// Mode" (which reveals cost price behind a PIN in POS) — opposite
	// default state and opposite purpose, reusing that name here would
	// make both features behave unpredictably against each other.
	function toggle_dashboard_privacy() {
		document.body.classList.toggle("santu-dash-privacy-active");
	}

	function show_dropdown($anchor, items) {
		$(".santu-topbar-menu").remove();
		const $menu = $(`<div class="santu-topbar-menu"></div>`);
		items.forEach((item) => {
			$(`<button type="button">${frappe.utils.escape_html(item.label)}</button>`)
				.on("click", () => {
					$menu.remove();
					item.action();
				})
				.appendTo($menu);
		});
		$("body").append($menu);
		const rect = $anchor[0].getBoundingClientRect();
		$menu.css({ top: rect.bottom + 6 + "px", right: window.innerWidth - rect.right + "px" });
		setTimeout(() => {
			$(document).one("click.santu-topbar-menu", (e) => {
				if (!$(e.target).closest(".santu-topbar-menu").length) $menu.remove();
			});
		}, 0);
	}

	function search_transactions(query) {
		const $dd = $(".santu-topbar-search-dropdown");
		if (!query || query.length < 2) {
			$dd.hide().empty();
			return;
		}
		frappe
			.xcall("santu_hardware.santu_hardware.api.search_transactions_topbar", { query })
			.then((rows) => {
				$dd.empty();
				if (!rows.length) {
					$dd.append(`<div class="santu-topbar-dd-empty">No transactions found.</div>`);
				}
				rows.forEach((r) => {
					$(`
						<div class="santu-topbar-dd-row">
							<span>${frappe.utils.escape_html(r.name)}</span>
							<span class="santu-topbar-dd-sub">${frappe.utils.escape_html(r.doctype)} · ${frappe.utils.escape_html(r.party || "")}</span>
						</div>
					`)
						.on("click", () => {
							$dd.hide();
							window.santu_open_invoice_view(r.doctype, r.name);
						})
						.appendTo($dd);
				});
				$dd.show();
			});
	}

	function build_topbar() {
		if ($(".santu-topbar-extra").length) return;

		const $container = $(".navbar .container").first();
		if (!$container.length) return;

		const $searchForm = $container.find("form.form-inline").first();
		const $navInput = $container.find("#navbar-search");
		if ($navInput.length) $navInput.attr("placeholder", "Open Anything (⌘ + G)");

		const $extra = $(`
			<div class="santu-topbar-extra">
				<div class="santu-topbar-search-wrap">
					<input type="text" class="santu-topbar-search" placeholder="Search Transactions" autocomplete="off">
					<div class="santu-topbar-search-dropdown" style="display:none;"></div>
				</div>
				<button type="button" class="santu-topbar-btn santu-topbar-btn-sale">+ Add Sale</button>
				<button type="button" class="santu-topbar-btn santu-topbar-btn-purchase">+ Receive Stock</button>
				<button type="button" class="santu-topbar-icon-btn santu-topbar-quick" title="Quick Add">+</button>
				<button type="button" class="santu-topbar-icon-btn santu-topbar-more" title="More">⋮</button>
			</div>
		`);

		if ($searchForm.length) $extra.insertAfter($searchForm);
		else $container.append($extra);

		$extra.find(".santu-topbar-search").on(
			"input",
			frappe.utils.debounce((e) => search_transactions(e.target.value.trim()), 250)
		);
		$(document)
			.off("click.santu-topbar-search")
			.on("click.santu-topbar-search", (e) => {
				if (!$(e.target).closest(".santu-topbar-search-wrap").length) {
					$(".santu-topbar-search-dropdown").hide();
				}
			});

		// Points at Billing (POS), not New Sale Invoice (2026-08-18 direct
		// request: "add sale ko pos billing se map kro") — Billing is meant
		// to be the one daily-use counter screen, so the global quick-add
		// button should land there too, not on the separate detailed form.
		$extra.find(".santu-topbar-btn-sale").on("click", () => frappe.set_route("santu-billing"));
		// Points at Receive Stock (Quick), not the Purchase Bill screen
		// (2026-08-18 direct request: replace "+ Add Purchase" with "+ Receive
		// Stock") — a real Purchase Bill (supplier, GST, payment) is still
		// reachable from Purchase & Expense > Purchase Bills, the mega-menu's
		// "Purchase Bill" item, and ⌥P; this quick button is specifically for
		// "maal aaya, turant chadha do", which is what Receive Stock already
		// handles end to end (also the top item in the Purchase Bills dropdown
		// per the same 2026-08-17 reordering request).
		$extra.find(".santu-topbar-btn-purchase").on("click", () => frappe.set_route("santu-receive-stock"));
		$extra.find(".santu-topbar-quick").on("click", (e) => open_quick_menu($(e.currentTarget)));
		$extra.find(".santu-topbar-more").on("click", (e) => open_more_menu($(e.currentTarget)));
	}

	function build_privacy_overlay() {
		if ($("#santu-dash-privacy-overlay").length) return;
		$(`
			<div id="santu-dash-privacy-overlay">
				<div class="santu-dash-privacy-icon">👁️‍🗨️</div>
				<div class="santu-dash-privacy-text">
					Privacy Mode enabled.<br>Please toggle the Privacy button to view your Dashboard.
				</div>
			</div>
		`)
			.on("click", toggle_dashboard_privacy)
			.appendTo("body");
	}

	function toggle_topbar() {
		if (is_kiosk()) {
			$(".santu-topbar-extra").hide();
		} else {
			build_topbar();
			build_privacy_overlay();
			$(".santu-topbar-extra").show();
		}
	}

	// Alt+letter for every mega-menu action, Cmd/Ctrl+Enter to open the
	// menu itself — matches the reference's own shortcut labels. Skipped
	// while typing in a field so these don't fight normal form input.
	$(document).on("keydown", (e) => {
		const typing = $(e.target).is("input, textarea, select, [contenteditable]");
		if (typing) return;
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			const $btn = $(".santu-topbar-quick");
			if ($btn.length) open_quick_menu($btn);
			return;
		}
		if (!e.altKey) return;
		const match = all_mega_menu_items().find((item) => item.shortcut === "⌥" + e.key.toUpperCase());
		if (match) {
			e.preventDefault();
			match.action();
		}
	});

	frappe.router.on("change", toggle_topbar);
	$(toggle_topbar);

	// "Open Anything" search bug fix (2026-08-14 direct report): frequently
	// visited routes show up as suggestions when the search box is empty,
	// but Frappe core's frappe.utils.get_route_label() has no case for
	// "Workspaces/<name>" routes — it falls through to a generic label
	// built from just the first route segment, so every visited workspace
	// (Home, in our case, visited a lot while testing) shows up as the
	// bare word "Workspaces" instead of its actual name. Every other route
	// type (List, Report, modules, dashboard) already gets a real label;
	// this just adds the missing Workspaces case the same way.
	if (frappe.utils && typeof frappe.utils.get_route_label === "function" && !frappe.utils.get_route_label._santu_patched) {
		const original_get_route_label = frappe.utils.get_route_label;
		frappe.utils.get_route_label = function (route_str) {
			const route = (route_str || "").split("/");
			if (route[0] === "Workspaces" && route[1]) {
				return __(frappe.utils.to_title_case(route[1], true));
			}
			return original_get_route_label(route_str);
		};
		frappe.utils.get_route_label._santu_patched = true;
	}

	// 2026-08-15 direct report: the native Sales/Purchase Invoice LIST view
	// (reached via the Accounting workspace's own "Sales Invoice"/"Purchase
	// Invoice" shortcut cards, Awesomebar, or any direct navigation — not
	// just the topbar buttons already routed to our custom screens above)
	// still has ERPNext's own "+ Add Sales/Purchase Invoice" primary button,
	// which opens the raw native form. erpnext's own
	// sales_invoice_list.js/purchase_invoice_list.js *replace*
	// frappe.listview_settings[doctype] wholesale every time that list view
	// loads (after this file has already run once at desk boot), so setting
	// `.primary_action` on it here wouldn't stick — patching
	// ListView.prototype.set_primary_action instead means our override runs
	// every time a list view is actually shown, regardless of what
	// listview_settings looked like at that moment.
	if (frappe.views && frappe.views.ListView && !frappe.views.ListView.prototype.set_primary_action._santu_patched) {
		const original_set_primary_action = frappe.views.ListView.prototype.set_primary_action;
		frappe.views.ListView.prototype.set_primary_action = function () {
			const action = SANTU_LIST_ADD_ACTIONS[this.doctype];
			if (action && this.can_create && !frappe.boot.read_only) {
				const doctype_name = __(frappe.router.doctype_layout) || __(this.doctype);
				this.page.set_primary_action(`${__("Add", null, "Primary action in list view")} ${doctype_name}`, action, "add");
				return;
			}
			return original_set_primary_action.apply(this, arguments);
		};
		frappe.views.ListView.prototype.set_primary_action._santu_patched = true;
	}

	// 2026-08-15 direct report: "payment entry ka ui abhi v same hai... cash
	// and bank option se" — the native "Cash & Bank" sidebar item opens
	// ERPNext's own Accounting workspace, whose Payment Entry list is
	// completely outside our custom pages, so clicking a row there landed
	// straight on Form/Payment Entry/<name> — bypassing santu_open_invoice_view
	// entirely (that function only helps when OUR OWN code calls it). This
	// patches the actual router, so ANY way of reaching Form/<doctype>/<name>
	// for a whitelisted doctype — native list rows, direct URL, breadcrumbs,
	// awesomebar, Connections panel links — redirects to our view instead.
	if (frappe.router && !frappe.router.render_page._santu_patched) {
		const original_render_page = frappe.router.render_page.bind(frappe.router);
		frappe.router.render_page = function () {
			const route = this.current_route;
			// "new-sales-invoice-xxxxx" etc. — Frappe's placeholder name for an
			// unsaved document being created. These can't go to the view screen
			// (get_invoice_view_data only loads documents that already exist,
			// and throws "not found" for these), but letting them fall through
			// lands the user on the raw native create form — which is exactly
			// how the native New Sales Invoice page kept appearing
			// (2026-08-15: "ui ko vyapaar type kro naa new sale invoice ka").
			// Send them to that doctype's own quick-entry screen instead; only
			// doctypes with no such screen still fall through.
			if (route && route[0] === "Form" && route[2] && route[2].startsWith("new-")) {
				const add_action = SANTU_LIST_ADD_ACTIONS[route[1]];
				if (add_action) {
					// Deferred for the same re-entrancy reason as below.
					setTimeout(add_action, 0);
					return;
				}
			}
			if (
				route &&
				route[0] === "Form" &&
				route[2] &&
				!route[2].startsWith("new-") &&
				SANTU_VIEWABLE_DOCTYPES.includes(route[1])
			) {
				const name = route.slice(2).join("/");
				// Deferred, not called straight from here: the outer
				// frappe.router.route() call that led to this render_page()
				// is still mid-flight (set_title/trigger("change") haven't
				// run yet for the Form route) — calling frappe.set_route
				// synchronously re-enters the router while that outer call
				// is still using its own now-stale route state, which threw
				// a "Cannot read properties of null (reading 'join')" from
				// jQuery's Deferred internals (confirmed live 2026-08-15).
				// Letting the current route() call finish first avoids it.
				setTimeout(() => window.santu_open_invoice_view(route[1], name), 0);
				return;
			}
			// Same problem one level up: the native LIST view for these
			// doctypes (reached via the Accounting workspace's own
			// shortcuts — "Sales Invoice 23", "Journal Entry 1", etc., not
			// just a single Form) is still ERPNext's raw table, not our
			// Vyapar screen (2026-08-15: "cash and bank k harek functions ko
			// check kro... old wale ko delete kro and new ui lao harek
			// jegeh"). Each entry's `view` sets frappe.route_options.view
			// before navigating, the same mechanism santu_sale/santu_purchase
			// already read on load — see santu_sale_utils.js/
			// santu_purchase_utils.js get_view().
			if (route && route[0] === "List" && route[1] && SANTU_LIST_VIEW_REDIRECTS[route[1]]) {
				setTimeout(SANTU_LIST_VIEW_REDIRECTS[route[1]], 0);
				return;
			}
			if (route && (route[0] === "Workspaces" || route[0] === "workspace")) {
				setTimeout(() => go_workspace(route[1] || "Home"), 0);
				return;
			}
			if (route && (route[0] === "query-report" || route[0] === "query_report")) {
				const report_name = decodeURIComponent(route.slice(1).join("/") || "");
				setTimeout(() => go_santu_report(SANTU_QUERY_REPORT_IDS[report_name] || ""), 0);
				return;
			}
			if (route && (route[0] === "dashboard-view" || route[0] === "dashboard" || route[0] === "Dashboard")) {
				setTimeout(() => frappe.set_route("santu-dashboard"), 0);
				return;
			}
			// Everyone gets bounced off erpnext's native POS, cashiers included
			// (2026-08-20). This used to spare Cashiers — but that route has
			// been broken all along ("POS Profile Santu Hardware POS not
			// found", see santu_billing.js's header), so the one role that
			// lives on the billing screen was the only one still being sent to
			// the broken copy of it.
			if (route && route[0] === "point-of-sale") {
				setTimeout(() => frappe.set_route("santu-billing"), 0);
				return;
			}
			if (route && (route[0] === "Tree" || (route[0] === "List" && route[2] === "Tree")) && SANTU_LIST_VIEW_REDIRECTS[route[1]]) {
				setTimeout(SANTU_LIST_VIEW_REDIRECTS[route[1]], 0);
				return;
			}
			if (route && route[0] === "Form" && route[1] && SANTU_LIST_VIEW_REDIRECTS[route[1]] && !SANTU_VIEWABLE_DOCTYPES.includes(route[1])) {
				setTimeout(SANTU_LIST_VIEW_REDIRECTS[route[1]], 0);
				return;
			}
			return original_render_page();
		};
		frappe.router.render_page._santu_patched = true;
	}

	if (frappe.router && typeof frappe.router.make_url === "function" && !frappe.router.make_url._santu_patched) {
		const original_make_url = frappe.router.make_url.bind(frappe.router);
		frappe.router.make_url = function (params) {
			const has_path = (params || []).some((a) => a && !$.isPlainObject(a));
			if (!has_path) {
				const cashier = frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager");
				if (cashier) {
					// santu-billing, not the broken native point-of-sale route
					// (2026-08-20) — this is the "home" URL a Cashier gets, so
					// it has to match where santu_redirect_cashier_to_billing()
					// in kiosk_mode.js now actually sends them.
					return localStorage.getItem("santu_current_staff") ? "/app/santu-billing" : "/app/shift-start";
				}
				return "/app/santu-dashboard";
			}
			return original_make_url(params);
		};
		frappe.router.make_url._santu_patched = true;
	}
})();

// Shared "add a person" dialog. Both callers used to open the native User
// form — roles table, API keys, module permissions. A shop needs a name, a
// login email, and which of the two kinds of person this is.
window.santu_open_add_user = function (role, on_created) {
	const d = new frappe.ui.Dialog({
		title: role === "Accountant" ? __("Add Accountant") : __("Add User"),
		fields: [
			{ fieldtype: "Data", fieldname: "full_name", label: __("Name"), reqd: 1 },
			{
				fieldtype: "Data",
				fieldname: "email",
				label: __("Email"),
				reqd: 1,
				description: __("They sign in with this"),
			},
		],
		primary_action_label: __("Add"),
		primary_action: (v) => {
			frappe.dom.freeze(__("Adding…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.create_staff_user", {
					full_name: v.full_name,
					email: v.email,
					role,
				})
				.then(() => {
					frappe.dom.unfreeze();
					d.hide();
					frappe.show_alert({ message: __("Added"), indicator: "green" });
					if (on_created) on_created();
				})
				.catch(() => frappe.dom.unfreeze());
		},
	});
	d.show();
};

window.santu_open_shop_profile = function () {
	sessionStorage.setItem("santu_utilities_view", "shop_profile");
	if ((frappe.get_route() || [])[0] === "santu-utilities") {
		$(document).trigger("santu-utilities-view-change");
		return;
	}
	frappe.set_route("santu-utilities");
};

// Manage payment modes. Replaced a jump to the native Mode of Payment list
// — a Frappe list view with filters, bulk edit and a raw child table for
// per-company accounts. What a shop needs is: which ways can I take money,
// and does each one actually work.
window.santu_open_payment_modes = function () {
	const render = (d) => {
		frappe.xcall("santu_hardware.santu_hardware.api.get_payment_modes").then((rows) => {
			const $w = d.fields_dict.modes.$wrapper;
			$w.empty();
			const $list = $(`<div class="santu-pm-list"></div>`).appendTo($w);
			rows.forEach((r) => {
				const $row = $(`
					<div class="santu-pm-row">
						<label class="santu-pm-toggle">
							<input type="checkbox" ${r.enabled ? "checked" : ""}>
							<span>${frappe.utils.escape_html(r.name)}</span>
						</label>
						<span class="santu-pm-meta">${
							r.ready
								? `<span class="santu-pm-ok">Ready</span>`
								: `<span class="santu-pm-warn" title="No cash/bank account set for this company">Not set up</span>`
						}</span>
					</div>
				`);
				$row.find("input").on("change", function () {
					frappe
						.xcall("santu_hardware.santu_hardware.api.set_payment_mode_enabled", {
							mode: r.name,
							enabled: this.checked ? 1 : 0,
						})
						.then(() => frappe.show_alert({ message: __("Saved"), indicator: "green" }));
				});
				$list.append($row);
			});
		});
	};

	const d = new frappe.ui.Dialog({
		title: __("Payment Modes"),
		fields: [
			{ fieldtype: "HTML", fieldname: "modes" },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Data", fieldname: "new_mode", label: __("Add a new one") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Select", fieldname: "new_type", label: __("Kind"), options: "Cash\nBank", default: "Cash" },
		],
		primary_action_label: __("Add"),
		primary_action: (v) => {
			if (!(v.new_mode || "").trim()) {
				d.hide();
				return;
			}
			frappe.dom.freeze(__("Adding…"));
			frappe
				.xcall("santu_hardware.santu_hardware.api.create_payment_mode", {
					mode_name: v.new_mode,
					mode_type: v.new_type,
				})
				.then(() => {
					frappe.dom.unfreeze();
					d.set_value("new_mode", "");
					render(d);
					frappe.show_alert({ message: __("Added"), indicator: "green" });
				})
				.catch(() => frappe.dom.unfreeze());
		},
	});
	d.show();
	render(d);
};
