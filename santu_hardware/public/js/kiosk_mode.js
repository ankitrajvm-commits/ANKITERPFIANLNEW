// Shop Mode and the billing screen (Point of Sale) should feel like
// dedicated shop software, not a page inside Frappe Desk (UX_STRATEGY.md
// SS5, findings 1-4). This hides Desk chrome and renames leftover ERP
// vocabulary on those two routes only — everywhere else in Desk (Admin
// Mode) is completely untouched, so the Owner's full access is unaffected.

// "shop-mode" removed (2026-08-01 direct request: "remove this tile page
// from everywhere") — the Page itself is deleted (see page/shop_mode/),
// so this list only needs the routes that still exist.
const SANTU_KIOSK_ROUTES = ["point-of-sale", "shift-start"];
const SANTU_STAFF_KEY = "santu_current_staff";

// Shared by shift_start.js (sets it) and the status bar below (reads it).
// localStorage, not a server-side session record: this shop runs on one
// shared computer (BUSINESS_RULES.md SS1), so there's no multi-device case
// to support, and it keeps this feature small until Phase 3's price-change
// log needs something more durable to attribute overrides to.
function santu_get_current_staff() {
	return localStorage.getItem(SANTU_STAFF_KEY) || null;
}
function santu_set_current_staff(staff_name) {
	if (staff_name) {
		localStorage.setItem(SANTU_STAFF_KEY, staff_name);
	} else {
		localStorage.removeItem(SANTU_STAFF_KEY);
	}
	santu_render_status_bar();
}

// "PRIVACY MODE IS NOT WORKING" (2026-08-01 direct report) — turned out
// to have never been wired up at all (pure static label). Actual spec,
// direct from the user: reveals item cost price (for judging how much
// discount still leaves a profit, without leaving it visible to
// customers by default) — PIN-gated to turn ON, no PIN needed to turn
// back OFF (tap again, or auto-off after 10s either way). Kept as an
// in-memory flag, not localStorage — this should never survive a page
// reload/new session by accident.
let santu_privacy_mode_active = false;
let santu_privacy_mode_timer = null;
const SANTU_PRIVACY_MODE_TIMEOUT_MS = 10000;

function santu_is_privacy_mode_active() {
	return santu_privacy_mode_active;
}

function santu_set_privacy_mode(active) {
	santu_privacy_mode_active = active;
	clearTimeout(santu_privacy_mode_timer);
	if (active) {
		santu_privacy_mode_timer = setTimeout(() => santu_set_privacy_mode(false), SANTU_PRIVACY_MODE_TIMEOUT_MS);
	}
	document.body.classList.toggle("santu-privacy-mode-active", active);
	santu_render_status_bar();
}

async function santu_toggle_privacy_mode() {
	if (santu_privacy_mode_active) {
		santu_set_privacy_mode(false);
		return;
	}

	frappe.prompt(
		{
			fieldname: "pin",
			fieldtype: "Password",
			label: __("Enter PIN"),
			reqd: 1,
		},
		async (values) => {
			const correct = await frappe.xcall("santu_hardware.santu_hardware.api.check_privacy_mode_pin", {
				pin: values.pin,
			});
			if (correct) {
				santu_set_privacy_mode(true);
			} else {
				frappe.show_alert({ message: __("Wrong PIN"), indicator: "red" });
			}
		},
		__("Privacy Mode"),
		__("Unlock")
	);
}

// UX_STRATEGY.md SS4.1: Cashier role lands directly on billing, no "New
// Bill" button/menu step — billing is the resting state, not a destination.
// SS4.2: before landing on billing, make sure someone has tapped their name
// (shift-start) so price-override attribution has something real to log
// later, without making anyone type a password.
//
// This has to happen client-side: Frappe's role_home_page hook only fires
// for "Website User" accounts (verified against frappe/auth.py source),
// but Desk staff logins are "System User" accounts, which land on the
// generic Workspaces/Home screen with no clean per-role override available
// server-side. Only redirects away from that generic landing spot — once a
// Cashier has actually navigated somewhere on purpose (e.g. Customer), this
// never yanks them back.
function santu_redirect_cashier_to_billing() {
	const route = frappe.get_route();
	// route[0] === "Workspaces" matches *every* workspace (accounting,
	// stock, selling...), not just the default Home landing (confirmed by
	// testing — /app/accounting resolves to ["Workspaces", "accounting"]).
	// Restricting to the actual default landing specifically, so a Cashier
	// account that *does* legitimately navigate into a workspace isn't
	// yanked back out.
	const is_default_landing = route && route[0] === "Workspaces" && (route[1] || "Home") === "Home";
	if (!is_default_landing) return;

	// Administrator (and anyone else holding System Manager) implicitly
	// has every role, Cashier included — confirmed via frappe.boot.user.roles
	// directly, not assumed. Without excluding System Manager here, the
	// Owner's own Administrator login would get redirected to billing too.
	const is_dedicated_cashier =
		frappe.user.has_role("Cashier") && !frappe.user.has_role("System Manager");
	if (!is_dedicated_cashier) return;

	if (santu_get_current_staff()) {
		frappe.set_route("point-of-sale");
	} else {
		frappe.set_route("shift-start");
	}
}

// Topbar shop name, everywhere — the navbar markup only has a slot for
// the logo image, no app-name text, so it's inserted directly. Runs on
// every route change (cheap, idempotent) since the navbar itself never
// gets torn down between routes, only content, but this is the one
// reliable hook already firing on both first load and every navigation.
function santu_add_navbar_brand_text() {
	const brand = document.querySelector(".navbar-brand.navbar-home");
	if (!brand || brand.querySelector(".santu-navbar-brand-text")) return;
	const span = document.createElement("span");
	span.className = "santu-navbar-brand-text";
	span.textContent = "Santu Hardware";
	brand.appendChild(span);
}

let santu_status_poll_timer = null;
let santu_pos_poll_timer = null;
let santu_dashboard_poll_timer = null;

function santu_apply_kiosk_mode() {
	santu_add_navbar_brand_text();

	const route = frappe.get_route();
	const in_kiosk = route && SANTU_KIOSK_ROUTES.includes(route[0]);
	document.body.classList.toggle("santu-kiosk-mode", !!in_kiosk);

	// Register-open state and "who's billing" can both change *within* the
	// point-of-sale route (submitting the opening dialog doesn't trigger a
	// real route change, it's an internal state flip) — a one-shot check on
	// route-change alone would go stale the moment that happens. Poll
	// instead, for as long as we're actually on a kiosk screen.
	clearInterval(santu_status_poll_timer);
	if (in_kiosk) {
		santu_render_status_bar();
		santu_status_poll_timer = setInterval(santu_render_status_bar, 8000);
	}

	clearInterval(santu_pos_poll_timer);
	if (route && route[0] === "point-of-sale") {
		santu_simplify_pos();
		santu_apply_pending_pos_item();
		santu_pos_poll_timer = setInterval(() => {
			santu_simplify_pos();
			santu_apply_pending_pos_item();
		}, 2000);
	}

	// Home + Dashboard merge (2026-08-14 direct request): the native
	// Home workspace and the custom santu-dashboard page were duplicating
	// each other (same "New Sale" shortcut, raw Item/Customer/Supplier
	// lists Home had no nicer view for than the ones santu-items/
	// santu-parties already provide). Dashboard is the one users actually
	// want, so anyone landing on the default Workspaces/Home screen — the
	// standard behavior for a bare /app with no other default_workspace —
	// now gets bounced straight to it. santu_color_dashboard_cards() /
	// santu_render_home_greeting() below are Home's own native-card
	// styling and are now dead (kept, not deleted, in case Home becomes
	// a real destination again later — same precedent as
	// santu_redirect_cashier_to_billing() above).
	clearInterval(santu_dashboard_poll_timer);
	if (route && route[0] === "Workspaces" && (route[1] || "Home") === "Home") {
		frappe.set_route("santu-dashboard");
	}

	// Also fires on the native "Accounts Dashboard" (route ["dashboard-view",
	// "Accounts"]) — it independently renders the same shared "Total
	// Outgoing Bills" Number Card (repointed to today's POS sales, see
	// SANTU_ACCOUNTING_LABEL_MAP above), so without this it would show
	// today's figure still labeled "Total Outgoing Bills" there, which
	// reads as wrong instead of just differently-scoped.
	clearInterval(santu_accounting_poll_timer);
	const is_accounting_workspace = route && route[0] === "Workspaces" && (route[1] || "") === "Accounting";
	const is_accounts_dashboard = route && route[0] === "dashboard-view" && (route[1] || "") === "Accounts";
	if (is_accounting_workspace || is_accounts_dashboard) {
		santu_relabel_accounting_workspace();
		santu_accounting_poll_timer = setInterval(santu_relabel_accounting_workspace, 2000);
	}

	clearInterval(santu_buying_poll_timer);
	if (route && route[0] === "Workspaces" && (route[1] || "") === "Buying") {
		santu_color_buying_cards();
		santu_buying_poll_timer = setInterval(santu_color_buying_cards, 2000);
	}

	clearInterval(santu_selling_poll_timer);
	if (route && route[0] === "Workspaces" && ["Selling", "Stock", "Staff", "Settings"].includes(route[1] || "")) {
		santu_mark_advanced_section();
		santu_selling_poll_timer = setInterval(santu_mark_advanced_section, 2000);
	}
}

let santu_accounting_poll_timer = null;
let santu_buying_poll_timer = null;
let santu_selling_poll_timer = null;

// SANTU CUSTOMIZATION 2026-07-30: visually mark the "Advanced" catch-all
// card on the Selling workspace as deliberately deprioritized (dashed
// border, sunken background) — matched by its title text since it's the
// only reliable hook (see selling_workspace.css for why :nth-of-type/
// :nth-child aren't used here, same lesson as the other two workspaces).
function santu_mark_advanced_section() {
	document.querySelectorAll(".links-widget-box").forEach((card) => {
		const title = card.querySelector(".widget-title .ellipsis")?.textContent.trim();
		if (title === "Advanced" && !card.classList.contains("santu-advanced-section")) {
			card.classList.add("santu-advanced-section");
		}
	});
}

// SANTU CUSTOMIZATION 2026-07-30: Buying workspace color accent per
// section card (Purchases/Suppliers/Products), same proven pattern as
// santu_color_dashboard_cards() — index-based in JS, not CSS
// :nth-child/:nth-of-type (those count all DOM siblings, not just
// matching elements; see IMPROVEMENT_LOG.md for the bug that taught this).
function santu_color_buying_cards() {
	document.querySelectorAll(".links-widget-box").forEach((card, i) => {
		const cls = `santu-accent-${i % 3}`;
		if (!card.classList.contains(cls)) {
			card.classList.add(cls);
		}
	});
}

// SANTU CUSTOMIZATION 2026-07-30: Accounting workspace UI redesign —
// plain-language number-card titles ("Total Outgoing Bills" -> "Sales").
// Renaming the underlying Number Card / Workspace records was already
// tried once (2026-07-30, logged in IMPROVEMENT_LOG.md) and silently
// broke that widget's rendering — a real Frappe bug in how
// `Workspace.number_cards[].label` is read. Fixed at the right layer
// this time: pure DOM text replacement, the data layer is never touched,
// so that bug class can't recur here. Idempotent + polled, since the
// widget can re-render on its own (live figure refresh).
const SANTU_ACCOUNTING_LABEL_MAP = {
	// "aaj ka sale kaha hai?" (2026-07-31 direct request) — this card's
	// own filters were repointed to today's POS Invoice total (same
	// Number Card record, same name, only its filters_json/
	// dynamic_filters_json changed — renaming the record itself or the
	// Workspace's reference to it is the documented bug above), so the
	// label needs to say what it now actually shows.
	"Total Outgoing Bills": "Today's Sales",
	"Total Incoming Bills": "Purchases",
	"Total Incoming Payment": "Payments Received",
	"Total Outgoing Payment": "Payments Made",
	"Dashboard": "Financial Reports", // shortcut — distinct from the app's own Dashboard tile
};

function santu_relabel_accounting_workspace() {
	document.querySelectorAll(".widget-title .ellipsis, .shortcut-widget-box .widget-title span").forEach((el) => {
		const original = el.getAttribute("title") || el.textContent.trim();
		const replacement = SANTU_ACCOUNTING_LABEL_MAP[original];
		if (replacement && el.textContent.trim() !== replacement) {
			el.textContent = replacement;
		}
	});

	// Color + icon per number card, by CURRENT (already-relabeled) text —
	// green for money in, amber for money out (UI_GUIDELINES.md §4.3).
	const tone_by_label = {
		"Today's Sales": "good",
		"Payments Received": "good",
		Purchases: "warning",
		"Payments Made": "warning",
	};
	document.querySelectorAll(".number-widget-box").forEach((card) => {
		const label = card.querySelector(".widget-title .ellipsis")?.textContent.trim();
		const tone = tone_by_label[label];
		if (tone && !card.classList.contains(`santu-tone-${tone}`)) {
			card.classList.remove("santu-tone-good", "santu-tone-warning");
			card.classList.add(`santu-tone-${tone}`);
		}
	});
}

// SANTU CUSTOMIZATION 2026-07-30: "just fix the main dashboard's UI...
// add some modern colours" — a rotating accent color per section card
// (Accounting/Stock/Data Import and Settings), matching
// dashboard_home.css's .santu-accent-N classes. Assigned by index in JS,
// not CSS :nth-of-type — that counts DOM siblings by tag, not by class,
// so it never lined up with just the card widgets (found by testing).
// Idempotent (checks classList before adding), safe to poll.
function santu_color_dashboard_cards() {
	document.querySelectorAll(".links-widget-box").forEach((card, i) => {
		const cls = `santu-accent-${i % 4}`;
		if (!card.classList.contains(cls)) {
			card.classList.add(cls);
		}
	});
}

// "homescreen ko accha karo... jo v ho" (2026-08-05 direct request) — Home
// previously opened straight into "Your Shortcuts" with zero warmth, no
// sense of "this is a live shop, right now". A time-of-day greeting + the
// actual date reads like a real dashboard instead of a bare nav page.
// Inserted as a sibling BEFORE `.codex-editor` (the workspace's read-only
// EditorJS render), not inside it — content inside that container is
// EditorJS-managed and can get wiped on its own re-renders; a sibling
// survives that untouched. Idempotent + polled alongside
// `santu_color_dashboard_cards()` since Edit/New workspace actions can
// tear down and rebuild `.codex-editor` itself.
function santu_render_home_greeting() {
	const editor = document.querySelector(".desk-page.page-main-content .codex-editor");
	if (!editor) return;
	if (document.querySelector(".santu-home-greeting")) return;

	const hour = new Date().getHours();
	const greeting = hour < 12 ? __("Good Morning") : hour < 17 ? __("Good Afternoon") : __("Good Evening");
	const today = new Date().toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});

	const el = document.createElement("div");
	el.className = "santu-home-greeting";
	el.innerHTML = `
		<div class="santu-home-greeting-text">${frappe.utils.escape_html(greeting)}, Santu Hardware</div>
		<div class="santu-home-greeting-date">${frappe.utils.escape_html(today)}</div>
	`;
	editor.parentElement.insertBefore(el, editor);
}

// "back home ki tarah kaam kr rha, in new sale" (2026-08-01 direct
// report) — traced live: core POS (`pos_controller.js`) switches between
// its Cart / Payment / Item-Details / Order-Summary views with plain
// jQuery `.css("display", ...)` toggles, never `frappe.set_route()` —
// so `window.history.back()` has no in-POS steps to walk through at all
// and always jumps straight to whatever page was open before POS,
// exactly matching "Home". Fix: check POS's OWN component visibility
// (the same `.$component.is(":visible")` idiom core already uses
// internally in every one of these files) and call its real "go back"
// method first; only fall through to browser history once there's
// truly nothing left inside POS to step back through.
function santu_go_back() {
	const route = frappe.get_route();
	if (route[0] === "point-of-sale" && window.cur_pos) {
		if (cur_pos.item_details && cur_pos.item_details.$component.is(":visible")) {
			cur_pos.item_details.toggle_item_details_section(null);
			return;
		}
		if (cur_pos.payment && cur_pos.payment.$component.is(":visible")) {
			cur_pos.payment.edit_cart();
			return;
		}
		// Order Summary (post-sale) has nothing to step back into within
		// POS — the sale is already done — so fall through below.
	}
	window.history.back();
}

// UX_STRATEGY.md SS5 finding 6 / SS7: a small always-visible strip so
// nobody has to hold "who's billing / is the register open / is Privacy
// Mode on" in their head — the software should show it, not make staff
// remember it. Privacy Mode is a static placeholder icon until Phase 3
// builds the real lock/unlock mechanism (BUSINESS_RULES.md SS3.2).
function santu_render_status_bar() {
	let $bar = $(".santu-status-bar");
	if (!$bar.length) {
		$bar = $('<div class="santu-status-bar"></div>').prependTo(document.body);
	}

	// "yaha se bhi back aane ka option nahi hai" (2026-07-31 direct
	// report) — kiosk_mode.css hides the ENTIRE navbar (including the
	// Santu Hardware logo/home link) on every kiosk route, and the only
	// other way out was a keyboard shortcut buried in a "..." menu no one
	// would find. This status bar is the one thing left visible on kiosk
	// routes, so it's the right place for a real, obvious way back.
	// Routes to the standard ERPNext Home workspace, NOT the Shop Mode
	// tile page — that page is deleted entirely (2026-08-01 direct
	// request: "remove this tile page from everywhere") since it was
	// still being reached via this exact link.
	//
	// "always add option to go back, not just home" (2026-08-01 direct
	// follow-up) — Home always jumps all the way out, which loses
	// wherever the cashier was mid-flow (e.g. mid-sale for a customer).
	// A real "Back" (one step at a time, browser-history based) sits
	// next to it so either is available.
	//
	// The Staff/Register/Privacy Mode items that used to sit alongside
	// Back/Home were removed 2026-08-15 direct request ("ise hatao" on a
	// screenshot of exactly those three) — Back/Home stay since kiosk mode
	// still hides the native navbar and this is the only way out of it.
	// Privacy Mode's PIN-gated cost-price reveal (santu_toggle_privacy_mode,
	// referenced from santu_sale_invoice.js) has no other trigger now, so
	// cost price stays hidden — say so if that turns out to still be needed.
	// Icon-only per 2026-08-15 direct follow-up ("just cross and minus
	// rakho na") — − for Back, ✕ for Home (closing out of the kiosk flow),
	// no text labels.
	const back_html = `<span class="santu-status-item santu-status-back" role="button" tabindex="0" title="${__("Back")}" aria-label="${__("Back")}">−</span>`;
	const home_html = `<span class="santu-status-item santu-status-home" role="button" tabindex="0" title="${__("Home")}" aria-label="${__("Home")}">✕</span>`;

	$bar.html(`
		${back_html}
		${home_html}
	`);

	$bar.find(".santu-status-back").on("click keydown", (e) => {
		if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		santu_go_back();
	});

	$bar.find(".santu-status-home").on("click keydown", (e) => {
		if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		frappe.set_route("Workspaces", "Home");
	});
}

function santu_apply_pending_pos_item() {
	const raw = sessionStorage.getItem("santu_pos_pending_item");
	if (!raw || !window.cur_pos || !cur_pos.on_cart_update) return;

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch (e) {
		sessionStorage.removeItem("santu_pos_pending_item");
		return;
	}

	if (!payload || !payload.item_code) {
		sessionStorage.removeItem("santu_pos_pending_item");
		return;
	}

	sessionStorage.removeItem("santu_pos_pending_item");
	cur_pos.on_cart_update({
		field: "qty",
		value: "+1",
		item: {
			item_code: payload.item_code,
			stock_uom: payload.stock_uom,
		},
	});
}

// Runs repeatedly (every 2s, see santu_pos_poll_timer above) rather than a
// one-shot burst on route-change: several things this needs to react to —
// the title/menu rendering asynchronously, and the opening dialog being
// submitted — don't fire a real Frappe route-change event, they're internal
// state flips inside ERPNext's own POS controller. Every check here is
// idempotent (no-ops once already applied), so polling is safe.
function santu_simplify_pos() {
	const title_el = document.querySelector(".page-head .title-text");
	if (title_el && title_el.textContent.trim() !== "New Bill") {
		title_el.textContent = "New Bill";
		title_el.setAttribute("title", "New Bill");
	}

	// "Open Form View" and "Save as Draft" are developer/ERP vocabulary a
	// cashier never needs — hide them rather than leave them sitting at
	// equal visual weight next to actually-useful options.
	document.querySelectorAll(".user-action .dropdown-item").forEach((el) => {
		const text = el.textContent.trim();
		if (text.startsWith("Open Form View") || text.startsWith("Save as Draft")) {
			const wrapper = el.closest("li") || el.parentElement;
			if (wrapper) wrapper.style.display = "none";
		}
	});

	santu_autofill_pos_opening_dialog();
	santu_autofocus_pos_search();
}

// SANTU CUSTOMIZATION 2026-07-30: found by testing, not by inspection —
// the search/barcode field wasn't focused on initial page load, meaning
// every fresh bill started with a wasted click before the first scan could
// register. Real friction on a screen meant for continuous all-day use
// (ROADMAP.md Phase 2.5 Stage 2 POS priority).
//
// First version of this checked only "is something other than body/a
// button currently focused" before stealing focus — looked safe, but
// broke on real testing: ERPNext's own POS periodically re-renders Item
// Details (live stock refresh), which blurs the Rate field for a moment
// even while someone's actively mid-edit there. This function's own 2s
// poll could land in that gap and yank focus to search out from under a
// price override in progress. Fixed by also checking the Item Details
// panel isn't open at all — if it is, this backs off completely,
// regardless of the momentary activeElement state.
function santu_autofocus_pos_search() {
	const input = document.querySelector('input[placeholder*="Search by item code"]');
	if (!input || !document.body.contains(input)) return;
	if (document.querySelector(".item-details-container")) return;

	const active = document.activeElement;
	const nothing_meaningfully_focused =
		!active || active === document.body || active.tagName === "BUTTON";
	if (nothing_meaningfully_focused) {
		input.focus();
	}
}

// The "Create POS Opening Entry" dialog is a hardcoded frappe.ui.Dialog
// inside ERPNext's own pos_controller.js, not a standard form — it doesn't
// run doctype_js scripts at all, so the only way to reach it without
// touching core files is watching for it and filling it in directly.
// Company already defaults itself (frappe.defaults.get_default("company")
// in core); POS Profile has no such default, so this only ever has to do
// that one field — opening the register should be "type the cash amount,
// submit," not a form (UX_STRATEGY.md SS5.2 / SS7 open question 3).
function santu_autofill_pos_opening_dialog() {
	const dialog = cur_dialog;
	const is_opening_dialog = dialog && dialog.title === __("Create POS Opening Entry");
	if (!is_opening_dialog || dialog.get_value("pos_profile")) return;

	frappe.db.get_list("POS Profile", { limit: 2 }).then((profiles) => {
		if (profiles.length === 1 && cur_dialog === dialog && !dialog.get_value("pos_profile")) {
			dialog.set_value("pos_profile", profiles[0].name);
		}
	});
}

// santu_redirect_cashier_to_billing() disabled (2026-07-31 direct
// request, "ye wala screen nh chahiye" re: Shop Mode) — home_page no
// longer routes here at all, so forcibly bouncing Cashiers off the
// standard Home/Workspace landing onto Shop Mode/billing would fight
// that same request. Function kept, just unhooked, in case Shop Mode
// becomes an opt-in destination again later.
frappe.router.on("change", santu_apply_kiosk_mode);
$(document).ready(() => {
	santu_apply_kiosk_mode();
});
