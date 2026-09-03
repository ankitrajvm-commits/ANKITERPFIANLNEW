# IMPROVEMENT_LOG.md — Santu Hardware
### Running Log: Problems Found, Solutions Applied, Future Ideas

> Living document, updated continuously while building — not just for
> planned features, but anything noticed along the way (UI inconsistency,
> extra clicks, confusing layout, performance, a bug). Per
> `UX_STRATEGY.md` §12. Newest entries at the top.

---

## 2026-08-31 — Voice Search (Speech to Text) across POS and Topbar

- **Problem:** The user requested an easier way to search for items without typing, specifically through voice dictation ("voice to text") to speed up billing when hands are full.
- **Solution applied:** Implemented a new `santu_voice_search.js` module that injects a microphone icon into all `.santu-bill-search`, `.santu-topbar-search`, and `.santu-bg-item-search` inputs. When clicked, it activates the browser's native `SpeechRecognition`. Fixed Safari compatibility by instantiating a new `SpeechRecognition` instance on every click and relying on the system default dictation language (removed `hi-IN` hardcode) to prevent silent failures. Dispatched native `input` and `change` events so frontend frameworks correctly register the dictated text as if it was typed.
- **Future idea:** If voice accuracy needs improvement, we could implement a fuzzy matching algorithm on the frontend that compares the transcribed text (which might mishear technical hardware terms) with the actual item master list.

## 2026-08-31 — Dynamic Logo Size Controls (Sliders) for Print Formats

- **Problem:** Logo uploaded for bills looked disproportionate (too small or too much white space) on thermal and A4 bills, and the user requested manual control over the sizes on both A4 and Thermal bills separately.
- **Solution applied:** Added `thermal_logo_width` and `a4_logo_width` integer fields to `Santu POS Settings`. Built interactive range sliders in `santu_printer_settings.js` that update the backend settings and trigger live previews immediately. Wrote a Python script to patch all 15+ existing thermal and A4 print formats to use these dynamic settings instead of hardcoded `width` CSS values.
- **Future idea:** If more layout controls are requested, adding margin/padding sliders could be done using the exact same pattern.

## 2026-07-30 — New DocType controller `.py` must define a real class, or `bench migrate` silently deletes it

- **Problem:** Created `Santu POS Settings` (a Single DocType) with a
  controller `.py` file containing only a comment, no class — matching
  what I'd assumed was fine from a Page's controller file convention.
  `bench migrate` synced the DocType successfully but then, in the same
  run, its own orphan-cleanup pass (`remove_orphan_doctypes()` in
  `frappe/model/sync.py`) deleted it again — reproduced twice, no error
  surfaced, just a quiet "Orphaned DocType(s) found" line easy to miss.
- **Root cause (found by reading `frappe/model/base_document.py`
  `import_controller()`):** the orphan check imports every DocType's
  controller module and does `getattr(module, "SantuPOSSettings", None)`
  (class name = doctype name with spaces/hyphens stripped) — if that class
  doesn't exist, it raises `ImportError`, which the caller treats as proof
  the DocType is stale code with no backing file, and deletes the DB
  record. A comment-only `.py` file looks identical to "this doctype's
  code was removed" from that check's point of view.
- **Solution applied:** added `class SantuPOSSettings(Document): pass` —
  matches the existing `Staff Member` doctype's controller, which already
  had this right (`StaffMember(Document)`). Fixed and verified by
  re-running `bench migrate` clean.
- **Future idea:** any new DocType (not Page — Pages aren't checked by
  this code path) needs a real `class <PascalCaseDocName>(Document): pass`
  in its controller file, never just a comment, even when there's no
  custom logic to add yet.

## 2026-07-30 — Native ERPNext bug: POS Item Details loses focus mid-edit

- **Problem:** While building POS search-bar auto-focus (ROADMAP.md Phase
  2.5 Stage 2), testing surfaced a pre-existing native bug: the POS Item
  Details panel (opened by clicking a cart row) blurs its active input
  field to `<body>` after a few seconds, even mid-edit on the Rate field —
  almost certainly the live "Available Qty" refresh re-rendering the whole
  panel. **Confirmed pre-existing, not caused by our customization** — it
  reproduces identically with the new auto-focus code fully disabled.
  Real impact: a cashier who pauses briefly while typing a price override
  finds their cursor gone and has to re-click the field.
- **Solution applied:** none yet. Our own new auto-focus code was updated
  to check `.item-details-container` isn't open before ever touching focus,
  so it can't compound this bug — but the underlying native re-render issue
  is untouched.
- **Future idea:** find what triggers the Item Details re-render (likely
  ERPNext's own POS availability-refresh interval) and either debounce it
  while a field inside the panel has focus, or preserve cursor position
  across the re-render. Would need to patch ERPNext core
  (`pos_item_details.js` or similar) — a `CORE_PATCHES.md`-governed change,
  not a quick fix; worth doing once Stage 2's POS work reaches payment/
  price-override polish specifically.

## 2026-07-30 — Editing `Workspace.number_cards[].label` silently breaks that widget's rendering

- **Problem:** Tried to fix genuinely confusing/truncated Number Card
  widget titles on the Accounting workspace ("TOTAL INCOMING PAYME...",
  ALL-CAPS truncated jargon) by renaming them to plain business language
  ("Sales", "Purchases", "Payments Received", "Payments Made"). Renamed
  both the underlying `Number Card` doctype's `label` field (confirmed via
  direct DB read and a fresh unauthenticated `curl` — fully correct) and,
  once that didn't visually update, the `Workspace.number_cards[]` child
  table row's own `label` (a separate denormalized snapshot Frappe keeps
  on the Workspace doc itself, which is what actually renders — the two
  can disagree). Editing the child-table `label` to anything other than
  its original value made all four number-card widgets **silently vanish**
  from the page (no console error, no server error) — reproduced twice,
  confirmed the cause by reverting the label and watching them reappear
  immediately.
- **Solution applied:** reverted both the `Number Card` doctype labels and
  the `Workspace.number_cards[]` snapshot to their original text. Fixed
  the actual readability problem (truncation) with CSS instead —
  `design_system.css` now lets `.widget.number-widget-box .widget-title
  .ellipsis` wrap to two lines rather than ellipsis-truncate. Zero data
  model risk, same visual outcome (full text readable), ships as a normal
  custom-app CSS change.
- **Future idea:** if renaming a Number Card's title is ever genuinely
  needed, don't hand-edit `Workspace.number_cards[]` — likely need to
  either recreate the widget via the Desk "Edit Workspace" UI (which
  presumably keeps every linked field in sync correctly, unlike a raw
  script edit) or investigate the Workspace controller's `validate()`
  further to find the actual invariant that broke. Not investigated
  further this round since the CSS fix fully resolved the underlying
  readability complaint without the risk.

## 2026-07-30 — Desk sidebar declutter: `Module Profile`/`block_modules` is a dead end, `Workspace.is_hidden` is the real switch

- **Problem:** Owner asked why the standard ERPNext Desk (landed on by
  Administrator) looks completely different from Shop Mode, and asked for
  it decluttered — hide modules a single hardware shop never uses
  (Manufacturing, Quality, Projects, Assets, CRM, Website, Support,
  Integrations, ERPNext Integrations). First attempt: created a `Module
  Profile` ("Santu Hardware Shop") with those 9 modules in
  `block_modules`, assigned it to the Administrator `User`. This looked
  right (it's the field the standard Frappe UI itself exposes for exactly
  this purpose) but had **zero effect** on the sidebar after a cache clear
  and hard reload — confirmed via `frappe.boot.user.allow_modules` in the
  browser console, still listing every module.
- **Root cause (found by reading `frappe/utils/user.py`
  `UserPermissions.build_permissions()`):** `allow_modules` is filtered by
  `get_active_modules()` from `frappe.core.doctype.domain_settings` — the
  site-wide "Domain" feature (Manufacturing/Education/etc. as a whole-site
  toggle), not by `block_modules` at all. `block_modules` exists but isn't
  read anywhere in this path. The Desk sidebar itself is built straight
  from `Workspace` documents where `public=1`, independent of both of the
  above.
- **Solution applied:** used `Workspace.is_hidden` (a field that exists
  specifically for this) — set `is_hidden=1` on the 9 unwanted module
  workspaces plus `Build` and `Welcome Workspace` (both filed under the
  `Core` module, too broad to block wholesale even if module-blocking had
  worked). Also cleaned `Workspace "Home"`'s own `content`/`links` to drop
  the now-orphaned CRM shortcut card and the onboarding banner. Left the
  `Module Profile` assignment in place since it's harmless, just not the
  mechanism that did the actual work.
- **Future idea:** if per-role (not just per-user) Desk customization is
  ever needed — e.g. a future non-Cashier staff role that should see a
  different subset of modules than Administrator — `Workspace.roles`
  (a restrict-by-role child table on each Workspace doc) is the correct
  native mechanism, not `Module Profile`.

## 2026-07-30 — Complete Billing Simulation: full loop verified, two architectural gaps found

- **Problem:** Ran the `UX_STRATEGY.md` §10 billing simulation as a real
  end-to-end test through the browser UI (not a backend script) — price
  override, split payment, tax, POS Closing Entry consolidation, stock
  ledger, GL posting. Result: **the billing flow itself is correct** —
  Rate override (₹45→₹60) recalculated the line and totals correctly;
  split payment (Cash ₹300 + UPI ₹361 = ₹661) matched Grand Total exactly
  and posted to the right accounts (`Cash - SH`, `Bank Account - SH`) on
  consolidation; GST (SGST+CGST @ 9% each) computed correctly on every
  invoice; Bin `actual_qty` for both test items only decreased after the
  POS Closing Entry was submitted, not at POS Invoice submission time.
  Two things surfaced along the way that are real product gaps, not bugs
  in what was built:
  1. **POS Invoice stock/GL posting is deferred until POS Closing Entry
     consolidation** — by ERPNext design (POS Invoice has no
     `update_stock`; only the consolidated Sales Invoice posts). Until a
     cashier's shift is closed, submitted bills reduce the *displayed*
     "available" qty (via `get_pos_reserved_qty()` reservation logic) but
     not the actual Bin/GL. Correct behaviour, but means a shift that's
     never closed leaves real stock/accounts unposted — worth surfacing
     to the owner as "close your shift daily" guidance, not a code fix.
  2. **Product Search shows no stock at all** — the "Product Search"
     button (per `UX_STRATEGY.md` journey design, meant to answer "kitna
     stock hai") routes to the generic `/app/item` list view, which has
     no stock column and doesn't use the same
     `get_pos_reserved_qty()`-adjusted quantity the POS billing screen
     shows. Fails the use case it was designed for.
- **Solution applied:** none yet for either — (1) is a documentation/
  training note, not a code change; (2) needs a real fix (custom Item
  list view or report with a live stock column) — not built yet, tracked
  as a Phase 2 follow-up in `ROADMAP.md`.
- **Future idea:** for (2), reuse `get_pos_reserved_qty()` (already
  proven correct) instead of raw `Bin.actual_qty` so Product Search and
  the POS billing screen never disagree about what's "available."

## 2026-07-31 — Loyalty Program auto-opt-in patch needs upgrading

- **Problem:** `Customer.set_loyalty_program()`'s auto-detection query
  (`get_loyalty_programs()`) was patched in `santu_hardware/__init__.py`
  to always return `[]`, working around a pre-existing ERPNext SQL bug.
  Correct at the time (loyalty wasn't wanted, Customer creation was
  completely blocked). Now that a loyalty program is planned, this patch
  would silently prevent auto-opt-in from ever working.
- **Solution applied:** none yet — flagged in `UX_STRATEGY.md` §13,
  scheduled for when loyalty implementation begins.
- **Future idea:** rewrite the lookup in plain Python (fetch all Loyalty
  Program rows — there will only ever be a handful for one shop — and
  filter in Python) instead of the raw-SQL-filter-key pattern that broke
  in the first place. Avoids the bug class entirely rather than working
  around one instance of it.

## 2026-07-31 — Status bar and page title didn't update on internal POS state changes

- **Problem:** submitting the POS Opening Entry dialog doesn't fire a real
  Frappe route-change event (it's an internal state flip inside ERPNext's
  own POS controller), so the one-shot "rename title / hide menu items /
  refresh register status" logic only ran once, on page load, and went
  stale the moment the register actually opened.
- **Solution applied:** switched from one-shot retry bursts to persistent
  polling (title/menu every 2s, status bar every 8s) for as long as the
  kiosk route is active — every check is idempotent, so polling has no
  downside beyond the poll itself.
- **Future idea:** if ERPNext's POS controller ever exposes a real event
  hook for opening-entry submission, switch from polling to that — polling
  works but a real event would be cleaner.

## 2026-07-31 — Administrator caught by Cashier-only redirect logic

- **Problem:** `frappe.user.has_role("Cashier")` returns `true` for
  Administrator (and anyone with System Manager), since Administrator
  implicitly holds every role. The Cashier→billing redirect fired for
  Administrator too, breaking normal Desk navigation into Workspaces.
- **Solution applied:** redirect now requires
  `has_role("Cashier") && !has_role("System Manager")`.
- **Future idea:** any future role-gated client-side logic in this app
  must use the same pattern — worth a one-line convention note if this
  pattern gets used a third time.

## 2026-07-31 — Field name guessed from an error label, wrong

- **Problem:** Stock Reconciliation's validation error says "Difference
  Account must be a Asset/Liability type account" — assumed the fieldname
  was `difference_account` (matching the label) without checking the
  meta. It's actually `expense_account`. Cost several failed submit
  attempts before reading the source directly.
- **Solution applied:** fixed in `santu_hardware/api.py::fix_stock`.
- **Future idea:** standing practice going forward — check
  `frappe.get_meta()` for the real fieldname before setting any field
  whose name was inferred from a UI label, not derived from the schema.

## 2026-07-31 — Static asset caching hid real fixes during development

- **Problem:** `/assets/...` serves with a 12h `Cache-Control: max-age`,
  and `app_include_css`/`app_include_js` weren't auto-versioned. Editing
  CSS/JS and rebuilding wasn't enough — the browser kept serving the old
  file, making a correct fix look like it hadn't worked.
- **Solution applied:** added a manual `?v=SANTU_ASSET_VERSION` query
  string in `hooks.py`, bumped on every CSS/JS change.
- **Future idea:** if this app ever needs true production deployment
  automation, replace the manual version bump with a content-hash-based
  build step — not necessary for a single-shop, single-developer app
  right now (Golden Rule: don't build ahead of actual need).

## 2026-07-31 — Path-nesting mistake, repeated three times

- **Problem:** the app has two "santu_hardware" folder levels
  (`apps/santu_hardware/santu_hardware/` for hooks.py/public/setup, and
  `.../santu_hardware/santu_hardware/` for doctype/page/api.py). Wrote
  files to the wrong level three separate times across this session —
  each time the Write call "succeeded" with no error, the file just did
  nothing, silently.
- **Solution applied:** now verify every new file's location with `find`
  immediately after writing it, rather than trusting the write path was
  correct.
- **Future idea:** documented explicitly in `PROJECT_STATUS.md` §1 so a
  future session doesn't repeat this.

## 2026-07-30 — `Workspace.label` silently reverts on every save (root cause found)

- **Problem:** renamed 4 workspaces earlier (Users→Staff, ERPNext
  Settings→Settings, Receivables→Customer Dues, Payables→Supplier Dues)
  by editing `title` and `label` directly and calling `.save()`. `title`
  stuck, but `label` always reverted back to the original docname —
  even a no-op `.save()` with no explicit field change reverted it. This
  broke direct-URL routing: `/app/staff` returned "Page staff not
  found" (404), because the Desk resolves `/app/<route>` against the
  Workspace's `name`, which never actually changed — only the
  cosmetically-visible `title` had.
  Root cause: `Workspace.autoname = "field:label"`. Every save runs
  `Document._validate()` → `_sync_autoname_field()`
  (`frappe/model/base_document.py:1027`), which unconditionally forces
  `self.set(fieldname, self.name)` whenever `self.name != self.get(fieldname)`.
  For a `field:`-autoname doctype this is by design — the field is
  supposed to always equal `name`, and the only sanctioned way to change
  it is a real rename (which changes `name` itself), not a direct field
  edit. Editing `label` alone just describes what should happen; the
  next save always stomps it back to match the untouched `name`.
- **Solution applied:** used `frappe.rename_doc("Workspace", old_name,
  new_name, force=True)` for all 4 workspaces instead of editing
  `label` directly. `rename_doc` actually changes `name` and internally
  calls `update_autoname_field()` (`frappe/model/rename_doc.py:323`) to
  sync `label` to match — the reverse of the broken approach. Verified
  live: `/app/staff` and `/app/settings` now load directly with no
  redirect, sidebar labels unchanged, no other workspace referenced the
  renamed ones via `parent_page` (checked before renaming) so nothing
  else broke.
- **Future idea:** standing rule for this app — any doctype with
  `autoname: field:<x>` (Workspace is one; there may be others) must
  never have that field edited directly via `doc.<field> = ...; doc.save()`.
  Always use `frappe.rename_doc()` to change it. Worth checking
  `frappe.get_meta(doctype).autoname` before ever scripting a bulk field
  edit on an unfamiliar doctype.

## 2026-07-30 — POS Invoice never posts to Accounting on its own

- **Problem:** generated 10 real POS Invoices (submitted, status Paid) as
  requested demo data. They showed up correctly on the custom Dashboard
  (Today's Sales, Recent Bills), but the user reported them missing
  entirely from the Accounting workspace — Sales/Purchases number cards
  and the Profit and Loss chart still read ₹0. Confirmed by querying
  `GL Entry` directly: zero rows for any of the 10 POS Invoices.
  Root cause: `POSInvoice.on_submit()` (`erpnext/accounts/doctype/
  pos_invoice/pos_invoice.py:232`) only handles loyalty points, status,
  and serial/batch bundles — no `make_gl_entries()` call. This is by
  design in ERPNext: POS Invoice is intentionally lightweight at
  submit-time; it only reaches the General Ledger after a POS Closing
  Entry consolidates the shift's invoices into real `Sales Invoice`
  records (`consolidate_pos_invoices()` in `pos_invoice_merge_log.py`,
  triggered from `POSClosingEntry.on_submit()`). Sales Invoice is what
  actually posts GL Entries. The Accounting workspace's chart/number
  cards read Sales Invoice + GL Entry, not POS Invoice — so an
  un-consolidated POS Invoice is real and paid, but invisible to
  Accounting until the counter is closed.
- **Solution applied:** closed the existing open POS Opening Entry using
  ERPNext's own `make_closing_entry_from_opening()` helper
  (`pos_closing_entry.py:178` — the exact function ERPNext's own test
  suite uses to do this programmatically) rather than hand-building a
  closing entry or writing GL entries directly. Since there were exactly
  10 invoices, consolidation queued as a background job
  (`consolidate_pos_invoices()`'s own `>= 10` threshold) instead of
  running synchronously — completed within ~5s given the worker process
  was already running. Verified: all 10 POS Invoices got a
  `consolidated_invoice` pointing at a new Sales Invoice, 60 GL Entry
  rows created, Accounting workspace now shows Sales ₹13.36K and a
  populated Profit and Loss chart.
- **Future idea:** worth surfacing this in `PRODUCT_MASTER_RULES.md` or
  `BUSINESS_RULES.md` as an operating rule for real shop use: a shift's
  sales genuinely don't count as "accounted for" until Close Counter is
  run, so end-of-day discipline (not just end-of-shift cash counting)
  matters for the books, not only for the drawer. Not fixed here since
  it's real ERPNext behavior, not a bug in this app.

## 2026-07-30 — "Payments Received" number card always reads ₹0 for a POS-first shop

- **Problem:** user reported live via screenshot: Accounting workspace
  showed Sales ₹13.36K (correct) but Payments Received ₹0.00, despite
  all 10 demo bills being fully paid in cash. Root cause: the native
  "Payments Received" card (`Number Card` "Total Incoming Payment")
  sums `Payment Entry` where `payment_type = Receive` — but this shop's
  money is collected directly on the POS Invoice at the counter
  (`paid_amount`), consolidated straight into a Sales Invoice; no
  separate `Payment Entry` document is ever created for a normal
  counter sale. The card wasn't broken, it was measuring the wrong
  thing for this business model — it would show ₹0 forever regardless
  of real cash taken in, only reacting to manual bank-transfer-style
  Payment Entries (a rare case for this shop: a later credit-customer
  payoff).
- **Solution applied:** added `get_payments_received_total()` /
  `get_payments_made_total()` to `api.py` — each sums BOTH sources
  (`Sales Invoice.paid_amount` / `Purchase Invoice.paid_amount` for
  counter-captured payment, plus `Payment Entry` for later manual
  settlement), which never overlap since a given payment lives in
  exactly one of the two. Repointed both Number Cards to
  `type: "Custom"` with these methods (`document_type` kept set on each
  for the native permission-filtering check, which still requires it
  even in Custom mode) and `currency: "INR"` for correct ₹ formatting.
  Verified live: Payments Received now shows ₹13.36K, matching Sales;
  Payments Made correctly stays ₹0.00 (genuinely nothing paid to the
  supplier yet, matching the Dashboard's own Pending Supplier Payments
  figure).
- **Future idea:** if this shop's Chart of Accounts ever needs an
  auditable Payment Entry trail for every POS sale (e.g. for a stricter
  bank reconciliation workflow), that's a deliberate business-process
  change, not a UI fix — flag it as its own decision if requested rather
  than assumed here.

## 2026-07-30 — Desk page body wastes ~30% of a wide monitor

- **Problem:** reported live via screenshot on a large/full-screen
  display: heavy dead space on both sides of every Desk page. Root
  cause: Frappe wraps every Desk page body (workspace, list view, form
  — confirmed identical on all three) in Bootstrap's `.container`,
  hard-capped at `max-width: 1290px`. On a 1920px-wide screen that
  computes to ~315px of unused margin on each side, ~33% of the screen
  doing nothing.
- **Solution applied:** `.page-body.container { max-width: min(1600px, 96vw) !important; }`
  in `desk_theme.css` (Desk-wide, already loaded everywhere). Below
  ~1450px viewport width this is a no-op — the original 1290px cap
  already fit, verified unchanged at standard desktop size. Chosen
  `1600px` (not full-bleed/`100vw`) deliberately: text lines at
  100%-width on an ultrawide monitor become uncomfortably long to read;
  1600px is a meaningfully wider working area without turning every
  page into a single unbroken paragraph-width strip.
- **Future idea:** none — straightforward CSS fix, no further action
  needed unless a specific page's internal layout (e.g. a report table)
  wants to opt out and stay narrower.

## 2026-07-30 — `bench migrate` recreates every renamed workspace as a duplicate, every time

- **Problem:** ran `bench migrate` to add new fields to `Santu POS
  Settings` (unrelated, routine schema change). It silently brought
  back "Users", "ERPNext Settings", "Receivables", "Payables" in the
  sidebar — the exact 4 workspaces renamed earlier this project (to
  Staff/Settings/Customer Dues/Supplier Dues) via `frappe.rename_doc`
  to fix the `Workspace.label` auto-revert bug. Also surfaced "GST
  India" and "Financial Reports", two workspaces never deliberately
  added to this shop's decluttered sidebar.
  Root cause: `frappe/model/sync.py`'s `IMPORTABLE_DOCTYPES` includes
  `("desk", "workspace")` — every `bench migrate` walks every installed
  app's `<module>/workspace/*/*.json` fixture files and imports them
  by name. Since `frappe.rename_doc` changed the docname away from the
  fixture's own name ("Users" → "Staff"), the fixture importer no
  longer finds an existing "Users" doc to update — so it just creates
  a **fresh new one** from the on-disk default, sitting right alongside
  the correctly-renamed "Staff". This will happen on **every future
  `bench migrate`**, not just this once — renaming a fixture-backed
  workspace and running `bench migrate` afterward are structurally in
  tension, and there's no config flag to opt a single doc out of
  fixture resync.
- **Solution applied:** deleted the 4 freshly-recreated duplicates
  (zero customization, zero linked documents — safe) and set
  `is_hidden=1` on GST India and Financial Reports to match this shop's
  established 7-workspace sidebar (Home/Accounting/Buying/Selling/
  Stock/Staff/Settings). Verified `/app/staff` still resolves correctly
  after cleanup — the rename itself was untouched, only the duplicates
  needed removing.
- **Future idea:** this is a standing operational gotcha, not a
  one-time fix — **after any future `bench migrate` on this site**,
  re-check `frappe.db.get_all("Workspace", filters={"public": 1},
  fields=["name", "is_hidden"])` for unwanted duplicates of Users/
  ERPNext Settings/Receivables/Payables (and hide any newly-synced
  workspace from another app's update, e.g. a future GST India-style
  addition) before assuming the sidebar is still correct. Worth adding
  a one-line reminder to `PROJECT_STATUS.md`'s migrate/rebuild ritual
  section so this doesn't get rediscovered the hard way again.

## 2026-07-30 — Auto-save-PDF hook briefly blocked a real sale

- **Problem:** while building Phase 2 of the thermal-printing feature
  set (auto-save every invoice's PDF to a dated folder on submit), the
  first version wrapped only the `frappe.get_print()` call in
  try/except — the folder-creation call right after it was not
  protected. A real POS checkout (`ACC-PSINV-2026-00015`) hit a
  `posting_date`-arrives-as-a-string edge case in the unprotected part
  and surfaced as a blocking "Server Error" dialog on the actual
  checkout screen. Confirmed via console the sale itself still
  completed (`docstatus` was already 1 — Frappe's doc_event hooks run
  after the doc's own state is set), so no data was lost, but a real
  shop owner would have been alarmed mid-sale by an error that had
  nothing to do with whether their sale worked.
- **Solution applied:** two fixes. `frappe.utils.getdate()` now
  normalizes `posting_date` before use, regardless of whether it
  arrives as a string or a date object (the actual root cause). More
  importantly: the entire hook body is now one try/except, on principle
  — a background nice-to-have (auto-saving a PDF copy) must never be
  able to block or visibly frighten someone during a real sale, no
  matter what bug is hiding in it. Re-tested live: a second real
  checkout (`ACC-PSINV-2026-00016`) completed with a clean popup, no
  error, and the PDF correctly landed in
  `Home/Invoices/2026/July/2026-07-30/`.
- **Future idea:** standing rule for this app going forward — any
  `doc_events` hook attached to a real transaction's `on_submit` must
  wrap its ENTIRE body in try/except-and-log, never just the one call
  that seemed riskiest at write time. The riskiest line usually isn't
  the one you expect.

## 2026-07-30 — Real POS sales were adding GST on top despite the "prices are inclusive" rule

- **Problem:** user caught it directly during live testing: real sales
  through the actual POS screen (`ACC-PSINV-2026-00015` onward) showed
  SGST @ 9% + CGST @ 9% added ON TOP of the item rate (₹185 item →
  ₹218.30 total) — directly contradicting the standing rule from
  earlier this project ("price is inclusive of GST, no need to add GST
  after bill"). The 10 original demo invoices never showed this because
  they were created by a script that built the `taxes` table by hand
  and never triggered real tax-calculation logic — real POS checkouts
  go through the full pipeline and exposed the gap.
  Root cause: india_compliance auto-selects a default GST tax template
  (`Output GST In-state - SH`, matching company/customer state) on
  every real sale, independent of any POS Profile default — confirmed
  by inspecting the submitted invoice's `taxes_and_charges` field
  directly. Neither the items nor the POS Profile had an explicit tax
  template configured; india_compliance supplies one automatically
  regardless.
- **Solution applied:** NOT removing GST tracking (that would
  under-report real tax liability) — set `included_in_print_rate = 1`
  on both GST templates' tax rows (`Output GST In-state - SH`:
  SGST+CGST; `Output GST Out-state - SH`: IGST). This is the standard,
  textbook-correct ERPNext mechanism for "MRP already includes GST"
  retail pricing: the tax amount is back-calculated FROM the entered
  rate instead of added on top, so the customer-facing total exactly
  equals the typed price while GST is still correctly recorded in the
  GL for compliance. Verified live: a fresh ₹185 item sale now
  completes at exactly ₹185.00 grand total (was ₹218.30 before the
  fix), with SGST/CGST still shown as a proper backend breakdown
  (₹14.11 each, extracted from ₹185, not added to it) — confirmed on
  the payment screen, the completion popup, and the printed thermal
  bill.
- **Future idea:** if this shop ever adds an item whose price is
  genuinely NOT GST-inclusive (rare for retail, but possible for a
  B2B/bulk sale), the same template would incorrectly back-calculate
  tax from that rate too — worth a manual override reminder if that
  scenario comes up, not something to solve preemptively now.

---

## TEMPLATE FOR NEW ENTRIES

```
## YYYY-MM-DD — Short title

- **Problem:**
- **Solution applied:** (or "none yet — flagged for [where]")
- **Future idea:**
```
