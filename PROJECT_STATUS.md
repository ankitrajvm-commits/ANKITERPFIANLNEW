# PROJECT_STATUS.md — Santu Hardware
### Living Project Status — Read This First in Any New Session

> **This file must be updated after every major change.** It exists so a
> fresh AI session (or a fresh human) can pick up this project with zero
> prior conversation history. If you are an AI reading this cold: also read
> `ERP_MASTER_PROMPT.md` first (project philosophy/rules), then the
> companion doc relevant to whatever you're about to touch. This file tells
> you *what state things are in*; the other docs tell you *why* and *what
> the rules are*.
>
> Last updated: 2026-07-30. Two things happened this session: (1) the
> Complete Billing Simulation (`UX_STRATEGY.md` §10) ran end-to-end through
> the real browser UI — price override, split payment, GST, POS Closing
> Entry consolidation, stock ledger, and GL posting all verified correct.
> (2) **Major policy change: this is now explicitly a long-term commercial
> product ("Santu Hardware ERP"), and ERPNext/Frappe core modification is
> now allowed** when it produces a significantly better UX than the custom
> app alone can achieve — under the strict protocol in `ERP_MASTER_PROMPT.md`
> §8.1 and logged in the new `CORE_PATCHES.md` (empty so far — nothing core
> has been touched yet). Branding/design system, printing, and loyalty
> program are still **design/research only, not implemented.** See
> `UX_STRATEGY.md` §§9-13.

---

## 0. WHAT THIS PROJECT IS

A single-shop, offline-first billing + inventory system for **Santu
Hardware** (Isuapur, Bihar — hardware/electrical/paints/plumbing/sanitary
store), built on ERPNext/Frappe v15, running on one MacBook Air. Not "an ERP
with a UI" — the explicit goal (`ERP_MASTER_PROMPT.md`, `UX_STRATEGY.md`) is
software that feels purpose-built for this shop, judged by: **can a Class 7
student learn and use it within 10 minutes?**

Governing docs, in read order: `ERP_MASTER_PROMPT.md` →
`BUSINESS_RULES.md` → `UI_GUIDELINES.md` → `DATABASE_RULES.md` →
`PRODUCT_MASTER_RULES.md` → `UX_STRATEGY.md` → `ROADMAP.md` →
`CODING_STANDARDS.md` → this file.

---

## 1. CURRENT PROJECT STRUCTURE

```
/Users/santuhardware/erpnext/frappe-bench/          <- bench root
├── sites/site1.local/                              <- the one site
│   ├── site_config.json                            <- db_name, db_password
│   └── ...
├── apps/
│   ├── frappe/                                      <- framework (core — modification now allowed under CORE_PATCHES.md protocol, none touched yet)
│   ├── erpnext/                                      <- ERPNext (core — same protocol, none touched yet)
│   ├── india_compliance/                             <- GST/HSN app (core, untouched)
│   └── santu_hardware/                                <- OUR APP — everything custom lives here
│       ├── ERP_MASTER_PROMPT.md                         <- governing docs (repo root)
│       ├── BUSINESS_RULES.md
│       ├── UI_GUIDELINES.md
│       ├── DATABASE_RULES.md
│       ├── PRODUCT_MASTER_RULES.md
│       ├── UX_STRATEGY.md
│       ├── ROADMAP.md
│       ├── CODING_STANDARDS.md
│       ├── PROJECT_STATUS.md                            <- this file
│       ├── CORE_PATCHES.md                               <- log of every ERPNext/Frappe core edit (none yet)
│       ├── DESIGN_DECISIONS.md                            <- every screen redesign: problem, alternatives, decision, measurable result
│       ├── IMPROVEMENT_LOG.md                            <- running problem/fix/idea log
│       ├── README.md                                    <- default bench scaffold, untouched
│       └── santu_hardware/                              <- the actual Python package (=app)
│           ├── hooks.py                                    <- app config, home_page, asset includes
│           ├── __init__.py                                 <- app __version__ + loyalty-program bug patch
│           ├── public/
│           │   ├── css/shop_mode.css                         <- Shop Mode grid + New Bill banner style
│           │   ├── css/kiosk_mode.css                         <- Desk-chrome hiding, brand color, status bar
│           │   ├── js/kiosk_mode.js                           <- kiosk mode, Cashier redirect, status bar, POS autofill
│           │   └── js/purchase_invoice.js                    <- single-step purchase defaults
│           ├── setup/install.py                             <- after_install hook: UOMs, Item fields, Stock Recon field
│           └── santu_hardware/                              <- "module" folder (doctype/page live here)
│               ├── api.py                                    <- whitelisted server methods (fix_stock)
│               ├── doctype/staff_member/                     <- Staff Member DocType
│               └── page/
│                   ├── shop_mode/                              <- Shop Mode home screen (8 buttons)
│                   ├── shift_start/                            <- "Who's Billing?" tile selector
│                   └── fix_stock/                              <- quick stock correction dialog
```

**IMPORTANT PATH GOTCHA** (this tripped up the previous session repeatedly —
avoid re-making this mistake): the app has **two** "santu_hardware" folder
levels, and it is easy to write to the wrong one silently (both paths look
plausible, neither errors, the file just goes to the wrong place and does
nothing):
- `apps/santu_hardware/santu_hardware/hooks.py` — 2 levels — hooks.py, `__init__.py`, `public/`, `setup/`
- `apps/santu_hardware/santu_hardware/santu_hardware/api.py` — 3 levels — the actual "module" folder: `doctype/`, `page/`, `api.py`

Rule of thumb: `hooks.py`, `__init__.py`, `public/*`, `setup/*` are 2-level.
`doctype/*`, `page/*`, and any new whitelisted-method Python files are
3-level. **When creating a new file, verify with `find` after writing it**,
don't just trust the Write call succeeded at the intended path.

---

## 2. WHAT HAS ALREADY BEEN COMPLETED

### Phase 1 — Foundation
- Frappe bench + ERPNext v15 + `india_compliance` installed on `site1.local`.
- Company "Santu Hardware" created with real GSTIN/PAN/address (Bihar).
- India Compliance app installed for native GST/HSN support (core ERPNext
  dropped this in v14 — see `DATABASE_RULES.md` §1.1).
- Base UOMs created: Nos, Litre, Box, Bundle, Packet, Can.
- Rack/Shelf/Bin custom fields added to Item.
- **Product Master architecture is fully DESIGNED (frozen v1.0 in
  `PRODUCT_MASTER_RULES.md`)** via a full interview + 100-product stress
  test, but **NOT YET IMPLEMENTED** — no Item Group tree, no Item Family
  DocType, no Item Specification child table exist in the system yet. This
  is the single biggest pending item — see §4.

### Phase 2 — Core Billing (UX shell implemented, catalog data still empty)
- Shop Mode home screen (`/app/shop-mode`), 8 buttons, New Bill rendered as
  a dominant full-width brand-color banner.
- POS re-skinned: Desk chrome hidden, retitled "New Bill", dangerous/dev
  menu items removed, brand color applied.
- `Cashier` role: lands directly on billing (no button click), verified to
  NOT affect Administrator/Owner (a real bug here was found and fixed —
  see §5).
- Shift-start tile selector (`Staff Member` DocType) — tap your name, no
  password.
- Persistent status bar: who's billing, register open/closed (live-polls),
  Privacy Mode placeholder.
- Walk-in Customer default on POS Profile.
- Single-step Purchase (Purchase Invoice `update_stock=1` + auto warehouse,
  skips ERPNext's PO→Receipt→Invoice chain).
- Fix Stock quick-correction dialog.

**Everything above is tested end-to-end in the browser, not just written.**
Test data was cleaned up afterward — the only non-default data left in the
system is real: Company, one real Staff Member (Manish Raj), Walk-in
Customer, one active Warehouse.

### Complete Billing Simulation — tested end-to-end 2026-07-30
Ran the full `UX_STRATEGY.md` §10 test plan through the actual browser UI
(11 throwaway demo items across every product category, a demo customer,
two POS Invoices) — not a backend script. All verified:
- Inline **price override** on the POS Rate field recalculates the line
  and cart totals correctly.
- **Split payment** (Cash + UPI) sums exactly to Grand Total and posts to
  the correct GL accounts (`Cash - SH`, `Bank Account - SH`) on consolidation.
- **GST** (SGST 9% + CGST 9%) computed correctly on every line and total.
- **POS Closing Entry → consolidation** correctly merges POS Invoices into
  Sales Invoices; `Bin.actual_qty` only decreases at this step, matching
  ERPNext's by-design deferred-posting architecture (see
  `IMPROVEMENT_LOG.md` 2026-07-30).
- **GL entries** balance correctly on both consolidated Sales Invoices
  (checked directly via `bench console`, not assumed from the UI).
- No buying price/valuation ever appeared in any screen reached during
  testing (Item Details, cart, checkout, receipt) — consistent with
  `BUSINESS_RULES.md`'s pricing-privacy rule.

One real gap found (not a bug in the billing flow, a missing feature):
**Product Search shows no stock quantity** — see §5 item 10. All demo/test
data from this test (11 items, 1 customer, 2 POS Invoices → 2 Sales
Invoices, 1 POS Closing Entry) was cleaned up afterward, same as Phase 2.

---

## 3. EVERY CUSTOMIZATION MADE SO FAR

| What | Where | Why |
|---|---|---|
| Company "Santu Hardware" | Company doctype | Real business data, GSTIN 10BULPP3722N1ZG |
| `india_compliance` app installed | bench-level | GST/HSN, core ERPNext dropped this in v14 |
| UOMs: Nos/Litre/Box/Bundle/Packet/Can | `setup/install.py::create_hardware_uoms()` | BUSINESS_RULES.md §4.1 multi-unit needs |
| Item custom fields: Rack/Shelf/Bin | `setup/install.py::create_item_location_fields()` | DATABASE_RULES.md §2, no native equivalent |
| Stock Reconciliation custom field: `custom_adjustment_reason` | `setup/install.py::create_stock_adjustment_reason_field()` | Fix Stock flow needs a reason, no native field |
| `Staff Member` DocType (new) | `santu_hardware/doctype/staff_member/` | Shift-start selector, flat list like Brand |
| `Cashier` Role (new) | created via console, permissions via Custom DocPerm | Dedicated low-privilege billing-only role |
| Cashier granted 32 Custom DocPerm entries | various doctypes (POS Invoice, Customer, Item, Company, Account, Warehouse, etc., all read/write as appropriate) | Minimum permissions for POS to function — built up incrementally by hitting real permission errors during testing |
| `Cashier` added to Point of Sale Page.roles | Page-level permission (separate system from DocType perms) | Page access ≠ DocType access in Frappe |
| Shop Mode Page (`/app/shop-mode`) | `page/shop_mode/` | UI_GUIDELINES.md §1.1 8-button home |
| Shift Start Page (`/app/shift-start`) | `page/shift_start/` | UX_STRATEGY.md §4.2 |
| Fix Stock Page (`/app/fix-stock`) | `page/fix_stock/` | UX_STRATEGY.md §4.5 |
| `santu_hardware.santu_hardware.api.fix_stock` whitelisted method | `santu_hardware/api.py` | Server-side Stock Reconciliation creation for Fix Stock |
| `kiosk_mode.js` / `kiosk_mode.css` | `public/js/`, `public/css/` | Hide Desk chrome, brand color, status bar, Cashier redirect, POS Opening Entry autofill |
| `purchase_invoice.js` | `public/js/` | Auto-check `update_stock`, auto-set warehouse |
| `home_page = "shop-mode"` | `hooks.py` | Default landing for non-Cashier roles |
| `app_include_css`/`app_include_js` with `?v=` cache-busting | `hooks.py` (`SANTU_ASSET_VERSION`, currently **15**) | Static assets were being served stale during development — bump this number whenever CSS/JS changes and it's not showing up |
| Loyalty program bug workaround | `santu_hardware/__init__.py` | Pre-existing ERPNext core bug breaks every Customer save — see §5 |
| Warehouses disabled: Finished Goods, Work In Progress, Goods In Transit | Warehouse doctype, `disabled=1` | Standard COA manufacturing clutter irrelevant to retail; only "Stores - SH" active |
| Walk-in Customer record | Customer doctype | Set as POS Profile default customer |
| POS Profile "Santu Hardware POS" | POS Profile doctype | Payment modes Cash/UPI/Card/Bank Transfer, warehouse Stores - SH |
| Payment modes renamed/created | Mode of Payment | "Credit Card"→"Card", "Wire Transfer"→"Bank Transfer", "UPI" created new, all mapped to company accounts |
| Brand color CSS variable `--santu-brand: #3730a3` | `kiosk_mode.css` | Deep indigo, deliberately outside the existing green/red/amber/blue semantic palette |
| Desk sidebar decluttered for Administrator | `Workspace.is_hidden=1` on Assets/Manufacturing/Quality/Projects/Support/CRM/Website/Integrations/ERPNext Integrations/Build/Welcome Workspace (data change via console, not a hooks/fixture file) | 2026-07-30 direct request: standard Desk kept (not redirected to Shop Mode) but stripped to only Home/Accounting/Buying/Selling/Stock/Users/Tools/ERPNext Settings — modules a single hardware shop never uses |
| Home workspace content edited | `Workspace` doc "Home" — removed onboarding banner block, removed the now-orphaned "CRM" card (Lead/Customer Group/Territory links) | Kept Home's shortcut cards consistent with the decluttered sidebar; `Module Profile "Santu Hardware Shop"` was also created and assigned to Administrator but turned out to have **no effect on the sidebar** (`block_modules` only feeds `allow_modules`/domain-gated permission lists, not the Workspace sidebar — verified by reading `frappe/utils/user.py`); left assigned since harmless, but `Workspace.is_hidden` is the field that actually did the job |
| Design system tokens (`design_system.css`, new) | `public/css/design_system.css`, loaded via both `app_include_css` (Desk) and `web_include_css` (login/web pages) | ROADMAP.md "Phase 2.5 Stage 1" foundation — `--santu-*` CSS variables for color/typography/spacing/radius/elevation (spec: `UX_STRATEGY.md` §9), light + dark (`html[data-theme="dark"]`), one source of truth for every future screen redesign |
| Login screen redesigned (`login.css`, new) | `public/css/login.css` + `Website Settings` (app_name="Santu Hardware", app_logo/favicon=new SH monogram SVG, show_footer_on_login=0) + `System Settings` (login_with_email_link=0) | Was generic "Login to Frappe" with a newsletter-signup footer, a dead "Create Account" link (signup already disabled site-wide), and an extra "Login with Email Link" choice. Now: branded, single clear path, no core file touched — `app_name`/`app_logo` are native Website Settings fields, the rest is custom-app CSS scoped to `#page-login` |
| Sidebar plain-language relabel + decluttered further | `Workspace` docs: "Tools" hidden (`is_hidden=1`, was a dumping ground of ~25 generic Frappe admin utilities meaningless to a shop owner); "Users"→"Staff", "ERPNext Settings"→"Settings", "Receivables"→"Customer Dues", "Payables"→"Supplier Dues" (docnames fully renamed via `frappe.rename_doc`, see next row) | 2026-07-30 deeper-UX-mandate pass — sidebar now reads Home/Accounting/Buying/Selling/Stock/Staff/Settings, zero "ERPNext"/"Users"/IT jargon |
| Fixed: direct-URL routing 404 on renamed workspaces | `Workspace` docnames properly renamed (`Users`→`Staff`, `ERPNext Settings`→`Settings`, `Receivables`→`Customer Dues`, `Payables`→`Supplier Dues`) via `frappe.rename_doc()` | User reported `/app/staff` → "Page staff not found". Root cause: the earlier relabel only edited `title`/`label` in place; `Workspace.autoname` is `field:label`, so every save silently forced `label` back to the untouched docname (`_sync_autoname_field`) — the sidebar looked right but the actual doc name, and therefore the route, never changed. Real fix is an actual rename, not a field edit. Verified live: `/app/staff` and `/app/settings` now load directly with no redirect. Full root-cause writeup in `IMPROVEMENT_LOG.md` |
| Onboarding banners stripped from Accounting/Buying/Selling/Stock workspaces | `Workspace.content` — removed the `type:"onboarding"` block from each (same technique already applied to Home) | Generic "Let's Set Up..." checklists + "Watch Tutorial" buttons are ERP-onboarding clutter an owner already past setup never needs to see again |
| Number-card widget-title wrap fix | `design_system.css` — `.widget.number-widget-box .widget-title .ellipsis` now wraps instead of truncating | Fixed real unreadable truncation ("TOTAL INCOMING PAYME...") on Accounting's dashboard cards. **Note:** renaming the cards themselves was attempted and reverted — editing `Workspace.number_cards[].label` away from its original value silently breaks that widget's render (Frappe quirk, see `IMPROVEMENT_LOG.md` 2026-07-30); CSS-only fix used instead |
| Shop Mode: "Close Counter" tile added, Purchase/Expenses go straight to `/new` | `page/shop_mode/shop_mode.js` | Close Counter was a real daily step with zero visible path before (hidden Desk menu shortcut only); Purchase/Expenses were an extra list-view click vs. New Bill's direct-to-form pattern — see `DESIGN_DECISIONS.md` |
| Product Search rebuilt — ranked, instant, replaces `/app/item` | New `Item.custom_search_keywords` field, `api.py::search_products`, new `page/product_search/` | Old screen: generic Item list, no stock, no ranking. New: weighted scoring (code>barcode>name>keywords>brand>category>fuzzy>partial), 11-74ms measured latency, verified against every example in `DESIGN_DECISIONS.md` including a barcode and a misspelling |
| 7 realistic demo items kept in the system (not cleaned up) | `DEMO-PAINT-01/02`, `DEMO-ADH-01`, `DEMO-ELEC-01`, `DEMO-FAST-01/02`, `DEMO-PLUMB-01` | Built to validate Product Search against real scenarios; **intentionally left in place** (departure from earlier "always clean up test data" practice) since ROADMAP.md Phase 2.5 Stage 2 needs sample data on an ongoing basis, not just for one test |
| POS search-bar auto-focus | `kiosk_mode.js::santu_autofocus_pos_search()` | Fresh bill previously needed a wasted click before the first scan could register; see `DESIGN_DECISIONS.md` for a real bug found and fixed mid-build (was briefly stealing focus from the Rate field) |
| Smart POS submit confirmation (new) | `Santu POS Settings` (new Single DocType), `api.py::get_pos_confirmation_settings`, `public/js/pos_smart_confirm.js` (monkey-patches `frappe.confirm`, POS route only) | Normal sales now complete with zero popup; large sales / high manual discounts / big credit sales still confirm, with real business context ("Complete sale for ₹X? Customer/Items/Payment") instead of "Permanently Submit {docname}?". Thresholds configurable, all defaults live. See `DESIGN_DECISIONS.md` for 2 real HTML-rendering bugs found and fixed while testing |
| Desk-wide visual reskin (new `desk_theme.css`) | Global (not kiosk-scoped) — buttons, cards/widgets, forms, list views, indicator pills, sidebar, tabs, navbar, checkboxes, scrollbars | Direct request: "make the ui better... its looking old fashioned." Soft shadows/rounded corners instead of flat borders, brand-colored focus/active states, more breathing room. Verified no regressions on Shop Mode/POS/login |
| Home/Dashboard color pass (new `dashboard_home.css`) | Scoped to `body[data-route="Workspaces/Home"]` only | Colored left-border + colored count badge per shortcut (Item=blue, Customer=green, Supplier=amber, Sales Invoice=purple), colored top-border per section card, assigned by `kiosk_mode.js::santu_color_dashboard_cards()` since CSS `:nth-of-type` doesn't count by class |
| **Real Dashboard, full rebuild** (new Page `page/santu_dashboard/`, new API `get_dashboard_data`) | Replaces the placeholder that pointed at the generic Home workspace | Fast Actions (Start New Sale / New Purchase / Search Product / dynamic Open-or-Close Counter) → Today (Sales/Collection/Pending Supplier Payments) → Needs Attention (Low/Out of Stock, only shown when non-zero) → Recent Bills/Purchases. Shop Mode's "Dashboard" tile repointed to it. Full UX audit + before/after in `DESIGN_DECISIONS.md` |
| Accounting workspace UI redesign (new `accounting_workspace.css`, `kiosk_mode.js::santu_relabel_accounting_workspace()`) | `Workspace "Accounting"` content/links trimmed from 9 sections/45+ links to 2 sections/7 links | Number cards renamed to plain language + green/amber color coding via safe DOM-text layer (not the data field that broke rendering earlier); removed Tax Masters/Cost Center/Multi Currency/Banking/Opening-Closing/Subscriptions/Share Management (zero relevance to a single shop) and the dead "Learn Accounting" link. UI-only — no business logic touched. Full audit in `DESIGN_DECISIONS.md` |
| Buying workspace UI redesign (new `buying_workspace.css`, `kiosk_mode.js::santu_color_buying_cards()`) | `Workspace "Buying"` content/links/shortcuts rebuilt from 8 sections/38+ links to 3 sections/8 links | Removed the always-empty "Purchase Order Trends" chart and the unused Purchase Order/Material Request/RFQ chain (shop uses single-step Purchase Invoice, per ROADMAP.md Phase 2); added Purchase Invoice + Supplier to shortcuts (previously missing despite being the actually-used documents). UI-only. Full audit in `DESIGN_DECISIONS.md` |
| Selling workspace UI redesign (new `selling_workspace.css`, `kiosk_mode.js::santu_mark_advanced_section()`) | `Workspace "Selling"` content/links/shortcuts rebuilt from 6 sections/50+ links to 3 curated + 1 "Advanced" catch-all, 26 links | Plain-language shortcuts (New Sale/Customer/Bill/Payment Collection/Customer Dues/Returns, 2 newly added), removed always-empty "Sales Order Trends" chart and sales-team-only features (Sales Partner/Person, Blanket Order, Coupon Code, target-variance reports — no sales team exists). Native `Workspace Shortcut.color` field tried, found to render nothing, reverted to the proven CSS/JS technique. UI-only. Full audit in `DESIGN_DECISIONS.md` |
| Stock workspace UI redesign (new `stock_workspace.css`) | `Workspace "Stock"` content/links/shortcuts rebuilt from 8 sections/60+ links to 3 curated + 1 "Advanced" catch-all, 30 links | Plain-language shortcuts (Products/Add Product/Receive Stock/Search Product/Stock Movement/Storage/Current Stock/Stock History), removed redundant "Warehouse wise Stock Value" chart and serial/batch/subcontracting features never designed into this shop's catalog (PRODUCT_MASTER_RULES.md). Cross-links to the app's own Product Search and Fix Stock pages instead of raw native equivalents. Number cards left untouched (same fragile field that broke Accounting's widget). UI-only. Full audit in `DESIGN_DECISIONS.md` |
| Staff workspace UI redesign (new `staff_workspace.css`) | `Workspace "Users"` (labeled "Staff") content/links/shortcuts rebuilt from 3 sections/13 links to 2 curated + 1 "Advanced", 18 links | Plain-language shortcuts (Staff Logins/Add Staff Login/Employees/Add Employee/Access Levels/Recent Activity). **Finding: Attendance/Leave Application/Salary Slip don't exist in this install** (HRMS app not installed) — no shortcuts built for them rather than shipping broken links; flagged as an owner decision, not assumed. UI-only. Full audit in `DESIGN_DECISIONS.md` |
| Real Staff Member records populated | `Staff Member`: Ankit Kumar, Manish Kumar, Vinay Kumar (all active) | User confirmed org structure (Ankit + Manish = Owners/Full Admin, Vinay = Staff). Fixed a real naming discrepancy: an existing record "Manish Raj" (created early in the project) was actually Manish Kumar — renamed via `frappe.rename_doc`, not duplicated. Deliberately used the lightweight `Staff Member` doctype, not native `Employee` — `Employee` requires date_of_birth/gender (real personal data not available, not to be invented); user confirmed this choice directly. Staff workspace's "Employees"/"Add Employee" shortcuts repointed from `Employee` to `Staff Member` to match. Verified live on both the Staff workspace and the actual Shift-Start "Who's Billing?" tile screen |
| Settings workspace UI redesign (new `settings_workspace.css`) | `Workspace "Settings"` content/links/shortcuts rebuilt from 7 flat shortcuts + 36+ links/6 cards to a 3-tier structure: 10 emoji hero shortcuts + "More Settings" (4 links) + "Advanced" (24 links) | iPhone-Settings-style hero tiles for daily/weekly config (Shop Information, GST & Tax, Billing/Inventory/Printer Settings, Payment Methods, Staff & Permissions, Warehouse Settings, Invoice Design, Backup & Restore); Shop Information opens the Company record directly (not its list), Invoice Design opens Print Format pre-filtered to Sales Invoice only. Website/Email/Workflow/Domain/Manufacturing/CRM/Projects/Support settings (no public website, no approval workflow, no unused modules in this shop) moved into "Advanced". "Security" folded into General Settings and "Devices" omitted — neither has a real, non-duplicate destination in this install; not fabricated. UI-only. Full audit in `DESIGN_DECISIONS.md` |
| List-view filter sidebar removed, Desk-wide (`desk_theme.css`) | CSS: `.list-sidebar:has(.filter-section)` hidden, main list column expanded to fill the freed width | 2026-07-30 direct request after a screenshot of the "Filter By / Assigned To / Created By / Edit Filters / Tags / Show Tags / Save Filter" panel — unused by a 2-owner shop with no assignment/tagging workflow, and it ate ~20% of screen width on every single list view. **Regression caught same session:** a first pass matched `.list-sidebar` alone, which Frappe v15 also uses for the Workspace module-nav sidebar (Home/Accounting/Buying/Selling/Stock/Staff/Settings) — briefly hid navigation Desk-wide until narrowed to match only sidebars containing `.filter-section` (the nav sidebar has `.desk-sidebar` instead, no overlap). Document FORM sidebar (`.form-sidebar` — Assigned To/Attachments/Share on an individual record) was never affected either way. Pure CSS, Desk-wide, no core file touched |
| Shop name in the topbar (`kiosk_mode.js::santu_add_navbar_brand_text()`, `desk_theme.css`) | "Santu Hardware" text inserted next to the logo in `.navbar-brand`, near-black theme-aware text (tuned from an initial indigo after direct feedback that the blue looked odd), 23px/700 weight | 2026-07-30 direct request — the "SH" logo mark alone doesn't read as a shop name at a glance, and this topbar is on screen during every sale a customer can see over the counter. Native navbar markup has no app-name text slot (logo image only), so the text is inserted via idempotent DOM insertion, once per route change. Verified live on Home and a list view — persists across navigation, sits correctly before the breadcrumb. Pure CSS/JS, no core file touched |
| Dashboard: 14-day sales chart (`get_dashboard_data()` in `api.py`, `santu_dashboard.js::render_daily_chart()`) | Bar chart (bundled `frappe.Chart`) on the Dashboard page, one bar per day for the last 14 days, zero-filled for days with no sales, same POS Invoice source as the Today's Sales tile | 2026-07-30 direct request alongside real demo data (see below) — an owner wants to see at a glance whether today is normal/slow/a spike, not just today's single number. New `daily_sales` key added to the existing single-round-trip dashboard API call, no extra request |
| Real demo transactions populated (10 items → 10 customers → 10 bills) | 3 new `Item`s (Stanley Claw Hammer, Havells LED Bulb, UltraTech Cement Bag — joining the 7 pre-existing demo items for 10 total), 1 `Supplier` (Balaji Hardware Distributors), 10 `Customer`s, 1 `Purchase Invoice` (`PINV-26-00001`, ₹1,74,600, `update_stock=1`, adds inventory for all 10 items), 10 `POS Invoice`s (one item to one customer each, all submitted/Paid, ₹13,360 total), 1 `POS Closing Entry` (`POS-CLO-2026-00001`) consolidating them into 10 `Sales Invoice`s | User-requested walkthrough data: "sell 10 different items to 10 different persons, generate bill... add inventory, add buying, add selling." Rates entered are GST-inclusive by explicit instruction — no Sales Taxes and Charges Template applied, so no separate GST line is added on top (verified: `taxes` child table empty on every invoice, `grand_total` exactly equals the entered rate × qty). **Finding: POS Invoice never posts GL Entries on its own** (confirmed by reading `pos_invoice.py::on_submit()` — it only handles loyalty points/status, no `make_gl_entries()` call) — a submitted POS Invoice is real and shows on the custom Dashboard (which reads POS Invoice directly), but is invisible to the Accounting workspace's P&L chart and Sales/Purchases number cards (which read Sales Invoice/GL Entry) until a POS Closing Entry consolidates it. Closed the counter using ERPNext's own `make_closing_entry_from_opening()` helper (the same one its test suite uses) rather than hand-building GL entries — verified live: Accounting workspace now shows Sales ₹13.36K, Purchases ₹1.75L, and a populated Profit and Loss chart. User explicitly said not to delete any of this — all left in place |
| Bill/invoice PDF redesign (2 new `Print Format`s) | `Santu Hardware Bill` (doc_type `POS Invoice`) and `Santu Hardware Bill (Sales Invoice)` (doc_type `Sales Invoice`), both custom Jinja, set as `default_print_format` on their DocTypes and on `POS Profile.print_format` | Replaced india_compliance's dense "GST Tax Invoice" template (buyer/consignee blocks, tax breakup table, HSN summary — B2B compliance paperwork) with a clean shop-branded receipt: big shop name + GSTIN/address, bill no/date, simple item table, bold total, amount in words, one-line thank-you footer — no tax breakup rows, matching the GST-inclusive flat-pricing convention. Built with `<table>` layout, not flexbox, after test-rendering an actual PDF revealed wkhtmltopdf's engine has zero flexbox support. **Environment finding:** this machine has no `wkhtmltopdf` binary and no alternate Chrome-based PDF generator — "Get PDF"/PDF email attachments won't work here until it's installed, though the browser's own Print button (native `window.print()`) is unaffected and works today. Downloaded + checksum-verified the official installer at the user's request; the actual `sudo installer` step was handed back to the user since it needs an interactive password the harness correctly blocked me from bypassing. UI-only, verified live via print preview on both a POS Invoice and its consolidated Sales Invoice |
| Bill/invoice v2 (logo, slogan, signature, dues) | Same 2 `Print Format`s extended: inline SH logo SVG (no external asset dependency in PDF), slogan "Solid Tools. Solid Trust.", Paid/Payment Due status pill, Total/Paid/Balance Due breakdown (`grand_total`/`paid_amount`/`outstanding_amount`), Customer Signature + "For Santu Hardware" signature lines. `Company` address updated to "Main Road, Ishuwapur, Saran, Bihar - 841411" (was missing "Main Road" and pincode); all 10 demo `Customer`s given a `mobile_no` + a real `Address` record | 2026-07-30 direct follow-up request. **Design choice:** shop address, customer phone, and customer address are all looked up live in the template (via `frappe.get_doc`/`frappe.db.get_value` on the Company/Customer/Address masters) rather than read from the invoice document's own stored snapshot fields (`company_address_display`, `contact_mobile`, `address_display`) — those are frozen at the moment a document was created, so the 10 already-submitted demo bills would have kept showing the pre-update address and blank customer contact info forever otherwise. Trade-off noted in `DESIGN_DECISIONS.md`: this means a bill's printed address can change if the shop/customer address is edited later, unlike the traditional "frozen at billing time" invoice convention — acceptable for a single small shop, worth revisiting if this app ever needs to defend a historical printed bill exactly as issued. Verified live on one bill only, per explicit instruction not to regenerate all of them |
| wkhtmltopdf installed, PDF generation confirmed working | System-level install (Rosetta 2 + `wkhtmltopdf 0.12.6`, done by the user themselves after I downloaded/checksum-verified the installer but was blocked from running `sudo` myself) | Verified live: both `Santu Hardware Bill` print formats now generate real PDFs via "Get PDF" (200 OK, confirmed on both POS Invoice and Sales Invoice) — the transient 500 seen immediately after install was Rosetta's one-time translation warm-up for the Intel-only binary, not a real failure; every attempt since has succeeded |
| Accounting workspace: "Payments Received"/"Payments Made" number cards fixed | New `api.py` methods `get_payments_received_total()`/`get_payments_made_total()`, both `Number Card`s (`Total Incoming Payment`/`Total Outgoing Payment`) repointed to `type: "Custom"` | 2026-07-30 direct report via screenshot: Payments Received showed ₹0.00 despite ₹13.36K in fully-paid bills. **Finding:** the native card only sums `Payment Entry` (payment_type=Receive) — structurally wrong for this shop, since counter sales capture payment directly on the invoice (`paid_amount`), never via a separate Payment Entry; the card would read ₹0 forever regardless of real cash collected. New methods sum both non-overlapping sources (invoice `paid_amount` + `Payment Entry`, mirrored for Purchases). Verified live: Payments Received now shows ₹13.36K matching Sales; Payments Made correctly still shows ₹0.00 (genuinely nothing paid to the supplier yet) |
| Desk page body widened for large monitors | `desk_theme.css`: `.page-body.container` max-width raised from Frappe's stock 1290px cap to `min(1600px, 96vw)` | 2026-07-30 direct report via screenshot on a large display: ~315px of dead margin on each side at 1920px width (~33% of the screen unused) on every Desk page — confirmed identical on workspace, list view, and form (same `.container` class, not workspace-specific). No-op below ~1450px viewport, verified unchanged at standard desktop size. Capped at 1600px rather than full-bleed deliberately, to avoid uncomfortably long text lines on ultrawide monitors |
| Thermal printing + auto PDF save + WhatsApp share + cash drawer (Phases 1–6) | 2 new thermal `Print Format`s (58mm/80mm, switchable), `Santu POS Settings` extended (Printer + Payments sections, "Detect Printers" button), `vendor_qz_tray.js` (vendored QZ Tray connector) + `thermal_print.js` (connect/print/cash-drawer), `post_sale_popup.js` (fires on POS Invoice `on_submit`: Print/Preview/Save PDF/Share on WhatsApp), `save_invoice_pdf_to_dated_folder` (`doc_events` on_submit hook → `Invoices/YYYY/Month/YYYY-MM-DD/`), `print_everywhere.js` ("Print (Thermal)" button on Sales Invoice/POS Invoice forms) | User's own 6-phase spec, explicit priority order. Two blockers clarified upfront (AskUserQuestion): silent printing needs QZ Tray (free local bridge service) running on the shop PC — user chose to build for it directly; WhatsApp auto-send needs a paid Business API this shop doesn't have — built the no-API `wa.me` click-to-chat version instead (pre-filled message + PDF handed over to attach manually), with the share function deliberately kept as the one seam a future real Messaging Service could slot into. QR/barcode generated server-side (`pyqrcode`/`python-barcode`, embedded as inline base64 — a print format has no client JS to lean on). **Two real bugs caught during live testing**, not before: an unwrapped folder-creation call blocked an actual POS checkout with a scary "Server Error" (now the entire auto-save function is one try/except — a background nice-to-have must never be able to interrupt a real sale); the WhatsApp button's phone check missed the `Customer.mobile_no` fallback the print format already used, hiding the button for customers who do have a number on file. Both fixed and re-verified live. **Cannot verify from this machine:** the actual QZ Tray → printer → paper path (no QZ Tray, no printer, no cash drawer here) — confirmed instead that the client code fails cleanly and readably when QZ Tray isn't reachable; the remaining step (install QZ Tray, plug in printer, "Detect Printers") is entirely on the shop PC. Purchase Invoice/Quotation print rollout intentionally deferred — they need their own print format designed, not the bill format pointed at the wrong doctype |
| POS: new-sale customer capture ("Who's this sale for?") + item list view | New `api.py::get_or_create_customer_by_phone()`, new `pos_customer_capture.js` (fires on every new POS Invoice via `onload`, phone-matches an existing customer or creates one, refreshes the cart's customer card via `window.cur_pos.cart`), new `pos_item_list.css` (restyles the native tile grid into a single-column list, same component/behavior) | 2026-07-30 direct request: creating a customer wasn't easy (the avatar click only edited Walk-in Customer's own contact info, not a real create-or-find flow), and items should list instead of tile. Verified live both customer paths (phone match reused "Ramesh Verma", a fresh number created "Rajesh Prasad" on the spot, immediately usable, WhatsApp-share-eligible). Item list required 3 rounds of live CSS debugging, not assumed correct: wrong container targeted at first (`.items-selector` vs the real grid `.items-container`), a native `min-height: 128px` silently beating an explicit `height: 40px`, and — caught in a full checkout, not before — the new taller list pushing the whole POS screen into a page-level scroll instead of scrolling within its own panel (flex children's default `min-height: auto` was defeating the panel's own `overflow`/`max-height`). All three fixed and re-verified live. No core file touched |
| Fixed: real POS sales were adding GST on top of item price | `Sales Taxes and Charges Template` "Output GST In-state - SH" and "Output GST Out-state - SH": `included_in_print_rate = 1` set on all tax rows (SGST/CGST/IGST) | 2026-07-30 direct report: a ₹185 item was totaling ₹218.30 at real checkout — india_compliance auto-applies a GST template on every real sale (independent of POS Profile/item settings), which the original 10 script-created demo invoices never triggered, hiding the gap. Fixed the standard ERPNext way for "MRP already includes GST" pricing: tax is now back-calculated from the entered rate instead of added on top — GST still correctly recorded in the GL for compliance, but the customer-facing total exactly equals the typed price. Verified live: fresh sale totaled exactly ₹185.00, confirmed on payment screen, popup, and printed bill |
| Bill v3: numeric bill no, due date +2d, HSN, account balances, reward points, village + Customer Dues page | 3 new Custom Fields (`Customer.santu_village`, `POS/Sales Invoice.santu_bill_no`), `apply_billing_defaults()` (`before_submit` hook: atomic numeric bill number via `getseries()`, due date capped at +2 days), `get_customer_balance_summary()`/`get_customer_loyalty_summary()`/`get_customer_dues()`/`get_customer_all_bills()` in `api.py`, both print formats rebuilt (# / Item / HSN / Qty / Rate / Amount table + Total Qty, Account Summary panel, Rewards panel, "TAX INVOICE" added to thermal), new Loyalty Program "Santu Hardware Rewards" (100 spent = 1 point, auto opt-in), new Page `/app/santu-customer-dues` (search by name, village filter, click-through to every bill for that customer) with a new shortcut tile on Accounting | User's 8-point spec for the printed bill plus a village-based dues tracker. **Required unblocking Loyalty Program first:** `santu_hardware/__init__.py` carried an existing monkey-patch (from earlier this session) that permanently stubbed out `get_loyalty_programs()` to work around a real ERPNext core bug — logged at the time as "upgrade when loyalty is wanted." Replaced the stub with a plain-Python reimplementation of the same filter logic instead of re-triggering the original bug. **Real field-semantics catch:** `POS Invoice.loyalty_points` tracks points *redeemed* as payment, not points *earned* — reward totals correctly read from the actual `Loyalty Point Entry` records instead. Verified live end-to-end: ₹8,500 sale earned 85 points; a real ₹100 unpaid credit sale showed "Previous Balance: Rs. 100.00" / "Current Balance: Rs. 100.00" in red on the next bill for that customer, and appeared correctly on the Customer Dues page with village filtering and a working bill-history drill-down. `bench migrate` (needed for the new fields/Page) recreated the usual 4 duplicate workspaces again — caught and cleaned up immediately per the standing post-migrate checklist. No core file touched |

---

## 4. PENDING TASKS

**Immediate next (Phase 1, deliberately deferred, not blocked):**
- Item Group tree (`PRODUCT_MASTER_RULES.md` §2) — not created in the system yet.
- `Item Family` DocType + data (§3) — designed, not built. Open question:
  new flat DocType (like Staff Member/Brand) vs. Tags — leaned toward
  DocType in design doc, never got final user sign-off on that specific point.
- `Item Specification` child table + Spec Name master list (§4) — designed, not built.
- Barcode convention (§7) — designed (native, zero build needed), not wired
  into any real items since none exist yet.
- Real brand list, real supplier list — waiting on user-provided data, not invented.
- Real product catalog entry — the actual items the shop sells. Nothing
  exists yet; everything tested so far used throwaway test items that were
  cleaned up afterward.

**Phase 2 remainder:**
- Thermal + A4 print formats (buying price stripped, verified) — **not
  started at all**, see §8.
- Tendered-amount quick cash buttons (UX_STRATEGY.md §7) — deferred, nice-to-have.
- Decide whether Fix Stock deserves a Shop Mode button (currently reachable
  only via Desk search).

**New vision areas (added 2026-07-31, `UX_STRATEGY.md` §§9-13) — design
complete, zero implementation, explicitly not to be started without a
fresh go-ahead:**
- §9 Branding/design system — neutral color scale, type scale, spacing
  scale, elevation, wordmark — a CSS pass across existing files, not new files.
- §10 Complete billing simulation — a test plan, blocked on Product Master
  implementation + print formats both existing first.
- §11 Invoice/printing — Santu-branded thermal (80mm) + A4 Print Formats,
  plus a new "save PDF to dated folder" hook (Year/Month/Day) — no native
  equivalent for the folder part, needs building.
- §12 Continuous improvement process — already active, see
  `IMPROVEMENT_LOG.md`.
- §13 Loyalty program — **configure ERPNext's native Loyalty
  Program/Loyalty Point Entry, do not build anything custom.** Blocked on
  the user providing the actual earn-rate/redemption-value numbers
  (pricing logic, won't be guessed) and on upgrading the loyalty-program
  bug patch first — see §5 item 1's "upgrade needed" note.

**Phase 3 onward (not started):** Privacy Mode & Pricing (password gate,
buying price/margin visibility, price levels, price change logging), Phase
4 Inventory Depth, Phase 5 Customers & Suppliers, Phase 6 Dashboard &
Reports, Phase 7 Documents & Delivery, Phase 8 Convenience Features, Phase
9 Communication & Backup (WhatsApp, nightly backup), Phase 10 Polish &
Analytics. See `ROADMAP.md` for full detail on each.

**Open decisions still waiting on the user** (from `ROADMAP.md` "Open
Decisions" and the Product Master interview): Privacy Mode password policy,
thermal printer model, GST-invoicing-mandatory-or-optional policy, backup
destination, final category/subcategory tree confirmation for lines beyond
what's already confirmed, Compatible Items UX (reference note vs. active
cross-sell — flagged, never resolved).

---

## 5. KNOWN BUGS / ISSUES

1. **ERPNext core bug: `get_loyalty_programs()` malformed SQL.**
   `erpnext.selling.doctype.customer.customer.get_loyalty_programs()`
   builds a filter using a raw SQL expression as a dict key
   (`{"ifnull(to_date, ...)": [...]}`) that produces a MariaDB syntax
   error, breaking **every** Customer save that doesn't already have a
   `loyalty_program` set. **Fixed** via a monkey-patch in
   `santu_hardware/__init__.py` (not a core file edit) that makes the
   function return `[]`. Wrapped in try/except so a future ERPNext version
   renaming this function doesn't break app startup — just silently skips
   the patch, which would make the original bug reappear. If Customer
   creation starts failing again after an `erpnext` upgrade, check this first.
   ⚠️ **This patch now needs upgrading, not just leaving as-is** — a real
   Loyalty Program is planned (`UX_STRATEGY.md` §13), and as written this
   patch will silently block auto-opt-in forever by always reporting "no
   programs found" regardless of what's configured. See `IMPROVEMENT_LOG.md`
   2026-07-31 for the planned fix.

2. **Stock Reconciliation field name trap.** The field labeled "Difference
   Account" in the UI error message is actually named `expense_account`,
   not `difference_account`. Cost about 3 failed attempts to discover — if
   scripting Stock Reconciliation again, check `frappe.get_meta()` for the
   real fieldname rather than guessing from a label.

3. **`allow_zero_valuation_rate`.** A Stock Reconciliation row for an item
   with genuinely no valuation history (never purchased) needs
   `allow_zero_valuation_rate=1` set explicitly, or submission fails with
   "Valuation Rate required." Real shop items with purchase history won't
   hit this; only relevant for a brand-new item's first-ever stock entry.

4. **Administrator implicitly holds every Role, including Cashier.**
   `frappe.user.has_role("Cashier")` returns `true` for Administrator (and
   anyone with System Manager) regardless of actual role assignment. Any
   future role-gated client logic must check
   `has_role("X") && !has_role("System Manager")`, not just `has_role("X")`,
   or it will incorrectly fire for Owner/Admin accounts too. Already fixed
   in `kiosk_mode.js`'s Cashier redirect — but this will bite again if
   anyone adds new role-based logic without remembering it.

5. **Static asset caching during development.** `/assets/...` is served
   with `Cache-Control: max-age=43200` (12h) and no auto-versioning for
   `app_include_css`/`app_include_js`. Editing a CSS/JS file and rebuilding
   is not enough to see the change in a browser that already loaded the
   page — must bump `SANTU_ASSET_VERSION` in `hooks.py` (currently `15`),
   rebuild, and restart. Forgetting this step wastes significant time
   debugging a "fix" that appears not to work when it actually did.

6. **`frappe.db.get_list`/`get_all` filters must exclude `disabled`
   explicitly.** Discovered while auto-defaulting the Purchase Invoice
   warehouse — a filter of `{"is_group": 0}` alone still returns disabled
   warehouses; add `"disabled": 0` explicitly wherever "the one active X"
   logic matters.

7. **MariaDB root password.** Currently `7739802334` (confirmed working via
   direct test during this update). Early in the project there was a
   whole recovery saga (wrong password, skip-grant-tables recovery) — this
   is the current, correct, working password as of this writing. If it
   stops working, `brew services restart mariadb` +
   `mysqld_safe --skip-grant-tables` recovery is the documented fallback
   path used before.

8. **`bench console` heredoc sessions can print misleading output** when a
   Python exception occurs mid-script but a later independent statement in
   the same heredoc still runs and prints something that looks like
   success. Always verify state changes with a fresh, separate query
   after any console script that touched data, don't trust the last
   printed line alone.

9. **POS Invoice stock/GL posting is deferred until POS Closing Entry
   consolidation.** Not a bug — this is ERPNext's by-design architecture
   (POS Invoice has no `update_stock` field; only the consolidated Sales
   Invoice posts to the Bin and GL). Verified during the 2026-07-30 billing
   simulation. Practical implication: a cashier shift that's never closed
   leaves real stock counts and accounts unposted, even though every bill
   shows as "Paid." Worth surfacing as staff guidance ("close your shift
   daily") once real usage starts — not something to code around.

10. **Product Search shows no stock quantity.** The "Product Search" button
    (per the `UX_STRATEGY.md` journey design, meant to answer "kitna stock
    hai") routes to the generic `/app/item` list view, which has no stock
    column and doesn't share the `get_pos_reserved_qty()`-adjusted quantity
    logic the POS billing screen already uses correctly. Found during the
    2026-07-30 billing simulation. Not fixed yet — needs a custom Item list
    view/report reusing `get_pos_reserved_qty()` so the two screens never
    disagree about what's "available." See `IMPROVEMENT_LOG.md` 2026-07-30.

11. **Android: Invoice Settings print format shows a different shop address
    than Shop Profile.** Reported 2026-10-10 from the shop. A fix is already
    pushed but was not in the reporter's build: `invoice_settings_screen.dart`
    assembled the preview address from city/state/pincode only, dropping the
    street line, and fell through to the sample shop's address whenever those
    three were blank. It now calls `AppSettings.companyAddressLine()`, the same
    helper `a4_invoice_pdf.dart` and `thermal_receipt.dart` already used, so all
    three agree. Shop Profile reads and writes those same SharedPreferences
    keys, so there is no second store to reconcile. **Rebuild the APK and
    re-check before investigating further** — if the two still disagree after
    that, the cause is something new and not this.

12. **Android: "Scan & Pay" UPI QR prints wrong on the thermal slip.**
    Reported 2026-10-10 from the shop; exact symptom (garbage characters /
    unscannable / wrong amount) not yet pinned down. The `GS ( k` sequence in
    `ThermalReceipt._qr()` was checked command by command against the Epson
    spec — model select, module size, error-correction level, store and print
    are all well-formed, and the store length is `len(data)+3` as required. So
    suspect, in order: (a) the printer's firmware does not implement the native
    QR commands at all, which is common on cheap ESC/POS units and prints the
    payload as text instead — note the PC never hits this, as it sends a PNG
    through CUPS and lets that raster it; (b) module size is hard-coded at 6
    regardless of paper width, so a long `upi://` payload on a 58mm roll can
    print too dense or too wide to scan; (c) the content itself, since the
    amount is `thisDue > 0 ? thisDue : grandTotal`, which asks a fully-paid
    bill's reader to pay the whole total again.
    Diagnose first: compare the bill's QR against Printer Settings → Test
    Print, and check whether anything QR-shaped appears at all. If it is (a),
    the real fix is to encode the QR in-app and send it as a raster bitmap
    (`GS v 0`) rather than relying on printer firmware — which is what the PC
    effectively already does.

---

## 6. IMPORTANT COMMANDS TO RUN

**Start the site (from a cold machine restart):**
```bash
cd /Users/santuhardware/erpnext/frappe-bench
nohup bench start > /tmp/bench_start.log 2>&1 &
echo $! > /tmp/bench_start.pid
```

**After ANY Python file change** (hooks.py, api.py, doctype .py, install.py):
```bash
cd /Users/santuhardware/erpnext/frappe-bench
bench --site site1.local migrate   # only needed if a DocType/field changed
kill $(cat /tmp/bench_start.pid) 2>/dev/null; pkill -f "bench start"
sleep 3
pkill -f "redis-server 127.0.0.1:11000\|redis-server 127.0.0.1:13000"
sleep 2
nohup bench start > /tmp/bench_start.log 2>&1 &
echo $! > /tmp/bench_start.pid
sleep 15
```

**⚠️ After `bench migrate` specifically:** it recreates every renamed
workspace as a fresh duplicate (Users/ERPNext Settings/Receivables/
Payables all come back alongside Staff/Settings/Customer Dues/Supplier
Dues — see `IMPROVEMENT_LOG.md` 2026-07-30). Re-check and clean up:
```bash
bench --site site1.local console
>>> import frappe
>>> frappe.db.get_all("Workspace", filters={"public": 1}, fields=["name", "is_hidden"])
# delete any fresh "Users"/"ERPNext Settings"/"Receivables"/"Payables"
# duplicate (frappe.delete_doc("Workspace", name, force=True)), and
# is_hidden=1 anything else newly synced that doesn't belong in this
# shop's 7-workspace sidebar (Home/Accounting/Buying/Selling/Stock/
# Staff/Settings)
```

**After ANY CSS/JS change** — bump `SANTU_ASSET_VERSION` in `hooks.py`
first, then:
```bash
cd /Users/santuhardware/erpnext/frappe-bench
bench build --app santu_hardware
# then restart bench as above — build alone is not enough, the running
# workers need the restart to pick up hooks.py's new version string
```

**Console access (for data inspection/scripting):**
```bash
cd /Users/santuhardware/erpnext/frappe-bench
bench --site site1.local console
# always end scripts with quit() explicitly
```

**Clear cache** (after permission/role changes, or if something seems stale
despite a restart):
```bash
bench --site site1.local clear-cache
```

**Check bench is actually up:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/login --max-time 5
```

**Login:** `http://localhost:8000` — Administrator / Administrator.

---

## 7. DATABASE / SITE DETAILS

- Bench root: `/Users/santuhardware/erpnext/frappe-bench`
- Site: `site1.local` (only site, `serve_default_site: true` so plain
  `localhost:8000` works with no `/etc/hosts` entry needed)
- DB type: MariaDB 12.3.2, DB name in `sites/site1.local/site_config.json`
  (`db_name`, `db_password` — auto-generated per-site, don't need to know
  them by hand, `bench` reads them itself)
- MariaDB root password: `7739802334` (see §5 item 7)
- Redis: cache on `127.0.0.1:13000`, queue on `127.0.0.1:11000`
- Apps installed (in `sites/apps.txt`): `frappe`, `erpnext`,
  `india_compliance`, `santu_hardware`
- Company: "Santu Hardware", abbr `SH`, Country India, Currency INR,
  GSTIN `10BULPP3722N1ZG`, PAN `BULPP3722N`, Fiscal Year `2026-2027`
  (Apr–Mar)
- POS Profile: "Santu Hardware POS" — warehouse `Stores - SH`, customer
  `Walk-in Customer`, payment modes Cash/UPI/Card/Bank Transfer
- Only one active non-group Warehouse: `Stores - SH` (Finished
  Goods/WIP/Goods In Transit deliberately disabled, see §3)

---

## 8. PRINTER / PDF WORKFLOW STATUS

**Not started.** No thermal print format, no A4 print format, no WhatsApp
send integration exist yet. This is an explicit Phase 2 pending item
(`ROADMAP.md`) and a Phase 9 item for WhatsApp specifically. Whenever this
is picked up: `CODING_STANDARDS.md`'s testing checklist explicitly requires
verifying buying price/margin never leaks onto any print format — check
that specifically, don't just check that printing works. Needs a real
thermal printer model decided first (`ROADMAP.md` Open Decisions — not yet
answered by the user).

---

## 9. NEXT RECOMMENDED STEPS

1. **Implement Product Master** (`PRODUCT_MASTER_RULES.md` §2-§7) — Item
   Group tree, `Item Family` DocType, `Item Specification` child table +
   Spec Name master, wire up the barcode convention. This is pure
   implementation of an already-frozen design, no further design work needed.
2. **Enter real catalog data** — at minimum enough real items to make
   billing actually usable end-to-end (currently every test was done with
   throwaway items that got deleted afterward — there are zero real
   sellable items in the system right now).
3. **Print formats** (thermal + A4) — needs real Item/pricing data to be
   meaningfully testable, and needs the thermal printer model decision from
   the user first.

**2026-07-30 update — GST removed from the bill entirely.** Earlier the
same day, `included_in_print_rate` was set on the tax template so prices
display as GST-inclusive (grand total correct), but the user then flagged
via screenshot that SGST/CGST lines were STILL visible in the cart/bill —
"i dont want this gst anywhere in the bill, remove the gst". Fixed with two
layers: `strip_gst_line_items()` doc_event (`before_validate`+`validate`,
`api.py`/`hooks.py`) clears `taxes`/`taxes_and_charges` server-side, plus
`pos_no_gst.js` (new, in `app_include_js`) monkey-patches
`erpnext.taxes_and_totals.prototype.calculate_taxes_and_totals` to do the
same client-side — needed because the live POS cart total is computed
purely client-side before any save. Verified end-to-end: live cart (small
and large items), full checkout, submitted invoice, post-sale popup, and
thermal print preview all show zero tax lines. Full writeup in
`DESIGN_DECISIONS.md` (2026-07-30 entry). Note for future: if turnover
later crosses the GST-invoice-mandatory threshold, this will need
revisiting since a compliant Tax Invoice must show the breakup.

**2026-07-30 update — split payments now auto-balance, discount now has a
₹/% toggle.** Same-day follow-up, flagged mid-session: entering an amount
in a second payment mode (e.g. UPI ₹500) left Cash still holding the full
grand total instead of reducing to absorb the split, overshooting Paid
Amount — fixed with `pos_smart_payment_split.js` (new), which tops the
default payment mode (Cash) down to `grand_total - everything else`
whenever another mode's amount changes. Separately, the "Add Discount"
box only ever supported a percentage — `pos_discount_toggle.js` (new)
adds a %/₹ toggle so a flat rupee discount can be typed directly, writing
to core's existing `discount_amount` field. Both verified live through a
full checkout (₹45 item, ₹5 flat discount, ₹5 UPI + ₹35 Cash split,
submitted cleanly). Full writeup in `DESIGN_DECISIONS.md` (2026-07-30,
"Split payments auto-balance + rupee discount option" entry).

**2026-07-31 update — modern retail POS billing workflow overhaul.** Six
requests bundled together: (1) "Complete Order" now saves a DRAFT and
shows a Review Bill dialog (embedded PDF preview, Back to Bill/Continue
Editing/Print/Download PDF/Share WhatsApp, and a separate "Complete Sale"
that's the only thing that actually submits) instead of submitting
immediately — fixes the original bug where Preview's `window.open`
silently reused the same tab (confirmed via `tabs_context` — no second
tab was ever created), so pressing Back force-reloaded the SPA into a
fresh invoice; (2) clicking a cart row's price now opens a fast 2-field
inline editor (Rate + Discount) instead of the full 8-field Item Details
side panel; (3) line-item discounts now default to ₹ with an optional %
toggle; (4)/(5) rate/discount editing was actually OFF for everyone —
`allow_rate_change`/`allow_discount_change` were both unchecked on the POS
Profile, not a role restriction — flipped both on; (6) searching for a
product that doesn't exist now shows "+ Create New Item" (Name, Selling
Price, Category, Unit, Barcode, plus HSN/SAC since this shop's GST HSN
validation is on) — created non-stock (avoids an immediate negative-stock
block on a brand-new item with zero opening qty) and auto-added to the
bill. New files: `pos_review_before_finalize.js`, `pos_line_item_edit.js`,
`pos_quick_create_item.js`; `post_sale_popup.js` edited in place (same
window.open→Blob fix as the review dialog); one new `api.py` function
(`quick_create_item`). Verified live end-to-end (full writeup in
`DESIGN_DECISIONS.md`, 2026-07-31 entry) including a real core gotcha hit
along the way: `frm.save()` on an already-saved, non-dirty POS Invoice
hangs forever with no error — guarded with the same `is_dirty()` check
`save_and_checkout()` already uses.
4. **Phase 3 — Privacy Mode & Pricing** — needs the password-policy
   decision from the user (PIN vs. full password, `ROADMAP.md` Open
   Decisions) before building.
5. Consider whether Fix Stock needs a Shop Mode button once real usage
   patterns are known (currently reachable only via Desk search — see §4).
6. **Fix Product Search's missing stock visibility** (§5 item 10) — give it
   a real stock column using `get_pos_reserved_qty()`, same logic the POS
   billing screen already uses correctly. Small, self-contained, doesn't
   block on Product Master implementation.
