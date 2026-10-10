# DESIGN_DECISIONS.md — Santu Hardware
### Every Screen/Workflow Redesign — Problem, Alternatives, Decision, Measurable Result

> Companion to `UI_GUIDELINES.md` §5 and `ERP_MASTER_PROMPT.md` §2.1. Every
> redesign gets an entry here — not just what changed, but what else was
> considered and why it lost. The goal is that every design decision on
> this project is defendable months later, not just remembered. Newest
> entries at the top.
>
> **On screenshots:** this project doesn't have a mechanism to save
> browser-tool screenshots to disk as files automatically — before/after
> visuals for the entries below were shown live in the conversation on the
> date noted, not attached as image files. If a future session has a way
> to persist screenshots to `assets/design_decisions/` alongside this file,
> switch to real attached images going forward; until then, before/after
> is described precisely enough (exact labels, counts, layout) to be
> reconstructed and verified against the live system at any time.

---

## 2026-09-23 — Print library: every document, several layouts each

- **Original problem:** a return printed as a sale ("return item ka thermal
  bill invoice se likha aa raha hai"), and Invoice Settings listed seven
  document types where several had exactly one layout — or none. Sales Order
  and Receive Stock had no print format at all, and the A4 library showed six
  style cards backed by a single format.
- **Alternatives considered:**
  1. Hand-write each new layout — rejected: ~60 formats, and every future fix
     would have to be repeated in each one.
  2. One format with a `style` URL parameter — does not work: a Print Format
     cannot read query parameters (this is why the old A4 cards all previewed
     the same bill).
  3. **Chosen:** generate each variant as a real Print Format from the
     document's own base, applying a CSS wrapper, an optional banner and an
     optional item-code line. Same mechanism the eleven thermal Sale Bill
     layouts already used, so preview and real print stay identical.
- **Measurable result:** 89 Santu formats on live (was 25). Every one renders
  against a real document — 88 renders, 0 failures — and no printed line shows
  a negative number for a return. Invoice Settings now lists 11 document types;
  each shows only the layouts it really has.
- **Note:** a document type with no document yet (Sales Order on live) says so
  in the preview instead of showing another document's layout.

---

## 2026-09-23 — Parties panel: every transaction, not just sales

- **Original problem:** the Parties detail panel listed sales only (Purchase
  Invoice for a supplier). A payment received, a return, a purana-baki entry
  or a party transfer simply did not appear, so the panel disagreed with the
  khata sitting next to it and with the "Owes you" figure above it. Ankit:
  "showing all the credit, debit in the transactions".
- **Alternatives considered:**
  1. Add a few more doctype queries (Payment Entry, credit notes) next to the
     existing ones — rejected: that is how the panel drifted in the first
     place; the next new voucher type would be missing again.
  2. Reuse `get_customer_khata` — rejected: it is date-windowed, carries item
     summaries the panel does not show, and itself only knows three doctypes.
  3. **Chosen:** read the ledger. Every GL Entry booked against the party,
     grouped per voucher, with debit/credit and a running balance. Whatever
     moved the party's balance shows up; drafts and non-financial documents
     (quotation, challan) still do not.
- **Measurable result:** on live (read-only) the panel's running balance equals
  the app's own outstanding for every party checked — Aman Singh ₹12,387.50,
  Hirdya Ray ₹5,280, Sabre Alam ₹1,739.60 — and Aman Singh's ₹5,000 payment,
  invisible before, now shows. Return / Payment In / Payment Out rows verified
  on three real parties with returns; supplier side and transfers verified on
  the test copy with TEST-named records, which were deleted afterwards
  (residue sweep clean).
- **Known gap, deliberately not changed:** `get_party_net_due` still counts
  invoices and advances only, so a Party Transfer journal moves the panel's
  balance but not the "Owes you" total. No party-transfer journals exist on
  live today. Raised with Ankit rather than changed, because that number feeds
  Customer Dues, the dashboard and the Payment screens.

---

## 2026-09-21 — Item entry: keep the new line in sight (sticky search, no scroll jitter)

- **Original problem:** three separate reports in one day, all from adding an
  item to a bill: (a) the screen went "upar niche upar niche, mobile jaise
  hang"; (b) the new item landed below the fold and had to be scrolled to;
  (c) once the view did follow it, the search box scrolled off the top, so
  every next item meant scrolling back up.
- **What was actually happening (measured live):** `$search.focus()` yanked the
  page 3085px up; `santu_scroll_row_into_view` then pulled it back down with
  TWO smooth animations (wrapper, then a page-level `scrollIntoView` measured
  mid-animation), and every quick add queued another one. Separately, a
  wrapper that reported itself scrollable for one frame made the helper record
  "handled" and never scroll the page at all.
- **Alternatives considered:**
  1. Keep appending at the bottom and only fix the scrolling — rejected: even
     perfect scrolling means the eye travels down the list on every item.
  2. Make the grid its own scroll box at every window size — rejected: the
     stacked layout (<1200px) deliberately lets the page grow, and forcing an
     inner scrollbar hides the totals.
  3. Newest line at the TOP (`unshift`) — built and tested on all 8 screens,
     then **rejected by Ankit the same day**: the bill must stay in the order it
     was billed. "Jo naya saman add ho wo niche hi add ho, aur wo mere samne
     dikhe."
  4. **Chosen:** keep appending at the bottom, but make the screen carry the
     operator to the new row by itself — sticky search bar on both bar types,
     plus an instant, single, cancellable row reveal that subtracts the pinned
     bar's height. Nothing to scroll, in either direction.
- **Measurable result:** 8 item-entry screens, 12 items each at 1024x700 —
  direction changes in scroll position 0, every new row visible below the bar,
  search box visible after every add, on all 8 screens. Saved bill on the test
  copy kept the entry order with totals intact (₹1,560.40 = sum of lines).
- **Rule written down:** `UI_GUIDELINES.md` §2.1.

---

## 2026-07-30 — Number-card widget-title truncation (Accounting dashboard)

- **Original problem:** Number Card widgets on the Accounting workspace
  ("Total Outgoing Bills," "Total Incoming Payment," etc.) truncated to
  unreadable ALL-CAPS fragments ("TOTAL INCOMING PAYME...") at the
  4-per-row width.
- **Alternatives considered:**
  1. Rename the cards to shorter plain-language labels ("Sales,"
     "Purchases," "Payments Received," "Payments Made") — **tried first**,
     rejected after discovery: editing `Workspace.number_cards[].label`
     away from its original value silently breaks that widget's render
     entirely (reproduced twice, confirmed by reverting). Not safe.
  2. Reduce to 2-per-row so each card has more width — rejected: wastes
     vertical space and doesn't fix the root problem (labels are long
     regardless of card width; a longer dashboard doesn't help someone
     glancing at their phone-width laptop screen).
  3. Let the title wrap to two lines instead of truncating — **chosen.**
- **Chosen solution:** CSS-only (`design_system.css`): `.widget.number-
  widget-box .widget-title .ellipsis { white-space: normal; overflow:
  visible; text-overflow: unset; }`. Zero data-model risk.
- **Why the others were rejected:** #1 is the *better* long-term fix (the
  labels really are ERP jargon that should eventually become "Sales"/
  "Purchases") but isn't safe without first understanding the Frappe
  Workspace controller's actual invariant — noted as a real future task,
  not abandoned. #2 doesn't address the actual complaint.
- **Before/after:** shown live in the session, 2026-07-30. Before: "TOTAL
  OUTGOING PAYM..." (cut off mid-word). After: "TOTAL OUTGOING PAYMENT"
  wrapped cleanly across two lines, fully readable.
- **Measurable improvement:**
  ```
  Old: title unreadable without hovering for a tooltip (0 of 4 cards fully legible)
  New: 4 of 4 cards fully legible at a glance, 0 clicks/hovers needed
  ```
- **Core or app-only:** custom-app CSS only. `CORE_PATCHES.md` not needed.

---

## 2026-07-30 — Desk Sidebar & Workspace Navigation

- **Original problem:** Sidebar mixed real business areas (Accounting,
  Stock) with pure IT/ERP jargon ("Users," "ERPNext Settings" — literally
  naming the underlying software), accounting jargon ("Payables,"
  "Receivables"), and a "Tools" entry containing ~25 generic Frappe admin
  utilities (Auto Repeat, Milestone, Email Domain, Print Format Builder…)
  with no hint what was inside. Every workspace (Accounting, Buying,
  Selling, Stock) also opened onto a repeatable "Let's Set Up..."
  onboarding checklist with a "Watch Tutorial" button.
- **Alternatives considered:**
  1. Redirect Administrator straight to Shop Mode, no Desk sidebar at all
     — **rejected**, but not by my own judgment: explicitly decided
     against by direct instruction in this session (owner chose "keep
     standard Desk, just decluttered" over "Shop Mode by default" when
     asked). Recorded here so a future session doesn't silently redo this
     debate.
  2. Translate every sidebar label into shop language, including
     "Accounting" → "Money," "Buying" → "What I Buy," etc. — **rejected**:
     over-translating risks confusing the owner's own accountant/CA, who
     will use real accounting terms when reviewing books. Standard terms
     that are already plain English (Accounting, Buying, Selling, Stock)
     were left alone; only genuine IT-speak or unclear jargon was renamed.
  3. Delete the "Tools" workspace outright vs. hide it — **chose hide**
     (`Workspace.is_hidden=1`) over delete: reversible, and some of what's
     inside (Data Import, Backups) may become genuinely useful later
     (e.g., bulk catalog entry in Roadmap Stage 3).
- **Chosen solution:** `Workspace.is_hidden=1` on "Tools"; `title`/`label`
  renames: Users→Staff, ERPNext Settings→Settings, Receivables→Customer
  Dues, Payables→Supplier Dues (docnames unchanged, only display labels);
  onboarding banner block removed from Accounting/Buying/Selling/Stock
  `Workspace.content` (same technique already used on Home).
- **Before/after:** shown live in the session, 2026-07-30. Before sidebar:
  Home, Accounting, Buying, Selling, Stock, Assets, Manufacturing,
  Quality, Projects, Support, Users, Website, CRM, Tools, ERPNext
  Settings, Integrations, ERPNext Integrations (17 items, most irrelevant
  to a single hardware shop — 9 of these were already hidden in an earlier
  pass the same day). After this pass: Home, Accounting, Buying, Selling,
  Stock, Staff, Settings (7 items, all relevant, all plain language).
- **Measurable improvement:**
  ```
  Old: 8 visible sidebar items (post earlier declutter), 2 in IT jargon, 1 unlabeled dumping ground
  New: 7 visible sidebar items, 0 in IT jargon, 0 unlabeled
  Old: onboarding banner + "Dismiss" click required on 4 separate workspaces
  New: 0 onboarding banners, 0 dismiss clicks, ever
  ```
- **Core or app-only:** entirely native `Workspace` doc data changes +
  earlier CSS. `CORE_PATCHES.md` not needed.
- **Could this go further:** yes — Accounting's own workspace (Journal
  Entry, Trial Balance, Chart of Accounts) is still deep ERP terminology.
  Left as-is deliberately: this is Owner-only Admin Mode, and an owner's
  accountant will expect standard accounting vocabulary there. Flagged,
  not forgotten, if real usage shows it's still a problem.

---

## 2026-07-30 — Login Screen

- **Original problem:** "Login to Frappe" (wrong/generic product name),
  generic "F" logo, a top navbar with an unrelated "Home" link to a public
  website this project doesn't use, a footer with a newsletter-signup box
  and "Powered by ERPNext," a "Create Account" link that led to a
  permanent "Signup Disabled" dead end (signup was already off site-wide),
  and a third login method ("Login with Email Link") alongside password
  login — three things to evaluate before typing anything.
- **Alternatives considered:**
  1. Fully custom login page template (core Frappe file edit) — considered
     first given "make it feel like Apple/WhatsApp." **Rejected**: native
     `Website Settings` fields (`app_name`, `app_logo`, `favicon`,
     `show_footer_on_login`) plus a `System Settings` toggle
     (`login_with_email_link`) already achieve full branding and
     simplification with zero core risk and zero upgrade risk. Reaching
     for core here would have violated `ERP_MASTER_PROMPT.md` §8.1's
     "prefer the custom app first" rule for no real benefit.
  2. Keep "Login with Email Link" as a second option for an owner who
     might not remember a password — **rejected**: "Forgot Password?" already
     covers recovery; a second *initial* login method is a decision on the
     very first screen a user ever sees, which is exactly what the "if a
     user pauses to think, simplify it" principle argues against.
  3. Hide the password field entirely in favor of a PIN pad (matching the
     tile-based Shift-Start flow cashiers already use) — **deferred, not
     rejected**: today there is exactly one real login account
     (Administrator). A PIN/passwordless flow is worth designing once
     real staff System User accounts exist and their login pattern is
     actually observed, not speculatively now.
- **Chosen solution:** `login.css` (scoped to `#page-login`) + native
  `Website Settings`/`System Settings` fields. New "SH" monogram SVG logo
  (`public/images/logo.svg`) in the brand indigo.
- **Before/after:** shown live in the session, 2026-07-30 (verified by an
  actual logout → login round trip, not just visually). Before: "Login to
  Frappe," generic navbar+footer, 3 apparent login paths (password / email
  link / the dead signup link). After: "Login to Santu Hardware," branded
  mark, single card, exactly 1 login path.
- **Measurable improvement:**
  ```
  Old: 3 login-related decisions visible on first screen (password / email-link / create-account), unbranded, navbar+footer noise
  New: 1 login path, 0 dead links, 0 unrelated chrome, branded
  ```
  Clicks for the actual login flow are unchanged (2 fields + 1 click) —
  reported honestly: this redesign's win is decision-count and trust
  (a stranger's login page vs. a recognizably "our" one), not click-count.
- **Core or app-only:** entirely native settings + custom-app CSS.
  `CORE_PATCHES.md` not needed.

---

## 2026-07-30 — Dashboard: full redesign from scratch (dedicated single-screen session)

- **Original problem:** the "Dashboard" tile pointed at the generic Desk
  Home workspace — record counts (Item: 7) and admin/config links (Chart
  of Accounts, Data Import). Answers "what data does ERPNext have," never
  "what do I need right now." See the UX audit table delivered at the
  start of this session for the full per-widget breakdown.
- **Alternatives considered:**
  1. Customize the existing Home workspace further (more color, reordered
     cards) — rejected: the underlying content is fundamentally the wrong
     content (admin links, not operational data), no amount of visual
     polish fixes that. This needed new data, not new paint.
  2. Build a client-side-only page that reads data via several separate
     `frappe.call`s (one per widget, matching how native workspace number
     cards each fetch independently) — rejected: slower (N round trips)
     and harder to keep consistent; a dashboard whose whole premise is
     "instant" shouldn't wait on 6 sequential requests.
  3. One new whitelisted method (`get_dashboard_data`) returning
     everything in a single call — **chosen**.
  4. For "Today's Sales": sum both POS Invoice and consolidated Sales
     Invoice — rejected after checking the consolidation architecture
     (already documented from earlier POS testing): a POS Invoice stays
     the authoritative sale record even after POS Closing Entry merges it
     into a Sales Invoice, so counting both double-counts every
     consolidated sale. POS Invoice alone, regardless of consolidation
     status, is correct.
  5. Low-stock threshold: build a new configurable setting — rejected for
     now (scope discipline: "dashboard only, nothing else," and no user
     has asked for this specific number to be tunable yet). Uses the
     native `Item Reorder` level when an item has one set, falls back to
     a constant default (5) otherwise — same heuristic already
     established in Product Search, kept consistent rather than inventing
     a second convention.
  6. Show Low Stock / Out of Stock cards always, with a "0" count when
     clean — rejected: an alert reading "Low Stock: 0" is not an alert,
     it's noise pretending to be information. Both cards render only when
     their count is greater than zero.
  7. Two separate tiles for "Open Counter" and "Close Counter" — rejected:
     only one is ever valid at a time; showing both asks the user to
     figure out which applies to them right now. One dynamic tile,
     decided server-side from actual register state.
- **Chosen solution:** new `Dashboard` Page (`santu_dashboard.js/.css`),
  one API call, four sections top to bottom in priority order: Fast
  Actions (Start New Sale featured, New Purchase, Search Product,
  Open/Close Counter) → Today (Sales/Collection/Pending Supplier Payments,
  green/neutral) → Needs Attention (Low Stock/Out of Stock, conditional,
  orange/red) → Recent Bills/Purchases (two columns, click to open).
  Shop Mode's "Dashboard" tile repointed from `/app` to the new page —
  the one necessary edit to a file outside this screen (wiring the entry
  point), not a redesign of Shop Mode itself.
- **Verified live**, every path: fresh state (all zeros, register-open
  correctly showed "Close Counter"); a real ₹53.10 sale updated Today's
  Sales/Collection and Recent Bills correctly in real time; a temporary
  stock adjustment confirmed both Out of Stock and Low Stock alerts render
  with correct color/count, then reverted; all test data cleaned up
  afterward (fake "today" numbers have no business being on the real
  dashboard, unlike the persistent demo catalog).
- **Before vs after:**
  ```
  Before: record counts + admin links — 0 of the 12 things an owner
          actually opens a dashboard for were present
  After:  4 fast actions, 3 live KPIs, conditional stock alerts, 2 recent-
          activity feeds — all 12 requested items present, nothing else
  Before: "today's sales" required: Sales Invoice list → filter by date →
          sum manually, or trust a report (4+ clicks, real thinking)
  After:  0 clicks, first thing on the screen
  Before: Open/Close Counter reachable only via a hidden Desk menu
          shortcut (Shift+Cmd+C) — not on this screen at all
  After:  1 click, and it's the correct one of the two, decided for you
  ```
- **Core or app-only:** entirely custom-app — one new Page, one new API
  method, one CSS file, one line changed in `shop_mode.js` (the tile's
  route). `CORE_PATCHES.md` not touched — nothing here required it.
- **Could this go further:** yes, named honestly: (1) low-stock threshold
  is a hardcoded default, not yet owner-configurable; (2) "Pending
  Supplier Payments" is all-time outstanding, not scoped to any period —
  correct for what "pending" means, but worth revisiting if the owner
  wants an aging breakdown later; (3) Recent Bills/Purchases are flat
  lists — fine at 5 rows, would want pagination if that number ever grows
  in a redesign brief; (4) the featured "Start New Sale" tile duplicates
  Shop Mode's own New Bill banner — both exist because Shop Mode and
  Dashboard currently serve overlapping "front door" roles; worth deciding
  later whether Dashboard replaces Shop Mode's landing entirely or the two
  stay deliberately redundant for different moments in the day.

## 2026-07-30 — Accounting workspace: UI-only redesign (dedicated session, no logic touched)

- **Original problem:** 9 card sections, 45+ links, most enterprise/multi-
  entity features (Multi Currency, Share Management, Subscription
  Management, Cost Center and Budgeting) with zero relevance to a single
  hardware shop; 4 number cards in ALL-CAPS ERP jargon ("TOTAL OUTGOING
  BILLS"); a dead "Learn Accounting" tutorial link; a "Dashboard" shortcut
  whose name collides with the app's own real Dashboard.
- **Alternatives considered:**
  1. Rename `Workspace.number_cards[].label` directly (the "correct"
     place to rename it) — rejected again: this is the exact edit that
     silently broke the widget's rendering earlier this session (logged
     2026-07-30 in `IMPROVEMENT_LOG.md`). Re-tried at a different layer
     instead of retrying the same broken approach.
  2. Pure DOM text replacement via `kiosk_mode.js`, scoped to the
     Accounting route, polled for idempotent re-application — **chosen**.
     Zero data risk, same visual outcome, and directly validates the
     `IMPROVEMENT_LOG.md` future-idea note left last time.
  3. Keep all 9 sections but visually de-emphasize the unused ones (gray
     out, collapse) — rejected: "does this help the owner" was the bar,
     not "does this look less prominent." An owner who will never open
     Share Management doesn't need it collapsed, they need it gone.
  4. Delete the underlying doctypes/features — never considered: this
     session's role was explicitly UI-only; hiding navigation links
     removes nothing functional, ERPNext's full accounting capability
     (multi-currency, budgeting, etc.) is untouched and reachable via
     direct URL or Desk search if ever needed.
- **Chosen solution:** removed 7 of 9 card sections (Tax Masters, Cost
  Center and Budgeting, Multi Currency, Banking, Opening and Closing,
  Subscription Management, Share Management) and trimmed the remaining 2
  (Accounting Masters, Payments) from 13 links down to 7; removed "Learn
  Accounting"; renamed "Dashboard" → "Financial Reports" (avoids collision
  with the product's own Dashboard); renamed all 4 number cards to plain
  language with green/amber color coding by money in/out.
- **Verified visually** (UI-only role — no workflow/calculation testing
  performed, per this session's explicit scope): full page screenshotted
  top to bottom before and after; confirmed no regression on Home
  (shares `kiosk_mode.js`).
- **Before vs after:**
  ```
  Before: 9 sections, 45+ links, 4 ALL-CAPS jargon number cards, 1 dead link
  After:  2 sections, 7 links, 4 plain-language color-coded number cards, 0 dead links
  ```
- **Core or app-only:** entirely custom-app / data-config — `Workspace`
  record edits (content blocks + links, the same safe technique already
  proven on Home) + `kiosk_mode.js`/new `accounting_workspace.css`.
  `CORE_PATCHES.md` not touched.
- **Could this go further:** yes — "Payment Term" and "Journal Entry" are
  still genuinely accountant-facing terms kept as-is deliberately (an
  owner's CA will expect the real terms, not a simplified paraphrase —
  same reasoning already applied to the sidebar redesign); worth
  revisiting only if real usage shows the owner (not the accountant)
  struggles with them specifically.

## 2026-07-30 — Buying workspace: UI-only redesign (dedicated session, no logic touched)

- **Original problem:** 8 sections/38+ links, most built around
  Purchase Order → Receipt → Invoice and Material Request/RFQ chains this
  shop deliberately bypasses (ROADMAP.md Phase 2 "Single-step Purchase" —
  a Purchase Invoice with `update_stock=1` replaces the whole chain,
  already implemented and in use). A "Purchase Order Trends" chart at the
  very top would always read flat zero, since no Purchase Order has ever
  existed here. "Purchase Invoice" — the document actually used — wasn't
  even a shortcut; "Purchase Order" — never used — was.
- **A judgment call, flagged rather than silently made:** the request
  listed "Purchase Orders" and "Purchase Receipts" among example
  prioritized items. Featuring them would contradict the shop's own
  already-established single-step-purchase decision (BUSINESS_RULES.md/
  ROADMAP.md), so this redesign prioritizes what the shop actually uses
  (Purchase Invoice, Supplier, purchase history) instead. Nothing was
  deleted — Purchase Order/Material Request remain fully reachable via
  Desk search if that workflow is ever deliberately turned on later.
- **Alternatives considered:**
  1. Rebuild the top chart to source Purchase Invoice instead of Purchase
     Order — rejected for this session: chart widgets are configuration
     data of the same general fragility class that broke a number card
     earlier (`IMPROVEMENT_LOG.md` 2026-07-30); removing a misleading
     always-zero chart is an unambiguous improvement on its own, rebuilding
     one is a separate, riskier task better done deliberately, not as a
     side effect of a UI cleanup pass.
  2. Color the 3 kept section cards with CSS `:nth-child` — rejected
     immediately, without even trying it this time: `:nth-of-type` already
     caused a real bug on the Home dashboard the same day (counts DOM
     siblings by tag/position, not by matching class). Used the same
     JS-index approach that fixed that bug instead
     (`santu_color_buying_cards()`), on the first attempt.
- **Chosen solution:** removed the Purchase Order Trends chart; shortcuts
  trimmed from 7 to 4 (removed Learn Procurement, Purchase Order, Purchase
  Order Analysis, Material Request, Dashboard; added Purchase Invoice and
  Supplier — the two actually-used destinations that were missing);
  8 card sections (Buying, Items & Pricing, Settings, Supplier, Supplier
  Scorecard, Key Reports, Other Reports, Regional) rebuilt into 3
  (Purchases, Suppliers, Products) with color accents (blue/green/purple).
- **Verified visually** (UI-only role, no workflow/calculation testing):
  full page before/after, confirmed no regression on Home or Accounting
  (all three now share `kiosk_mode.js`'s route-based styling functions).
- **Before vs after:**
  ```
  Before: 8 sections, 38+ links, a permanently-misleading chart, the
          actually-used document (Purchase Invoice) missing from shortcuts
  After:  3 sections, 8 links, no chart (removed rather than left wrong),
          Purchase Invoice and Supplier both one click away
  ```
- **Core or app-only:** entirely custom-app / data-config — `Workspace`
  record rebuild (content blocks, links, shortcuts) + new
  `buying_workspace.css` + one new function in `kiosk_mode.js`.
  `CORE_PATCHES.md` not touched.
- **Could this go further:** yes — if the shop ever does start using
  formal Material Requests (e.g., staff flagging reorders for owner
  approval) or multi-supplier RFQ comparison, those are one config change
  away, not rebuilt from scratch, since nothing was deleted, only hidden
  from the daily view.

## 2026-07-30 — Selling workspace: UI-only redesign (dedicated session, no logic touched)

- **Original problem:** 6 sections/50+ links built around a sales-team/
  multi-partner B2B model (Sales Partner, Sales Person, Blanket Order,
  Coupon Code, Campaign, target-variance reports) this single family-run
  shop doesn't have; a "Sales Order Trends" chart always reading zero
  (this shop bills directly at the counter, never uses Sales Order); ERP
  jargon throughout (POS Opening/Closing Entry, Accounts Receivable).
- **Alternatives considered:**
  1. Native `Workspace Shortcut.color` field for shortcut color-coding —
     **tried first**, since it's the field literally designed for this.
     Rejected after testing: set correctly in the data, but rendered with
     zero visible effect on the Desk workspace widget — not every native
     field does what its name implies. Fell back to the same scoped
     CSS + JS-by-attribute technique already proven on Home/Accounting/
     Buying, keyed off `aria-label` this time (shortcuts already carry a
     stable one, more reliable than an index).
  2. Delete everything not in the daily-use list, same as Accounting/
     Buying's aggressive trims — rejected for the *occasionally*-useful
     middle tier (Quotation, Sales Order, Territory, Sales Analytics):
     this session's instruction explicitly asked for an Advanced/Admin
     section, not deletion, for things that aren't daily but aren't
     irrelevant either. Reserved actual deletion for what's a genuinely
     different business model, not just lower-frequency (sales-team
     commission/scorecard/target-variance features — a single shop with
     no sales team has no use for any of them, ever).
  3. Rename `links`/`shortcuts` labels via JS DOM-override (the cautious
     approach used for Accounting's "Dashboard"→"Financial Reports") —
     **not needed this time**: Buying's successful custom-labeled
     shortcuts already proved direct label edits on `links`/`shortcuts`
     are safe (the earlier rendering bug was specific to
     `Workspace.number_cards[]`, a different, differently-coupled child
     table — Selling's workspace has no number cards at all). Renamed
     directly in the data instead, one less moving part.
- **Chosen solution:** removed the Sales Order Trends chart; rebuilt
  6 shortcuts into the requested plain-language set — New Sale, Customer,
  Bill, Payment Collection, Customer Dues, Returns (the last two newly
  added — "Accounts Receivable" and a returns view existed natively but
  weren't surfaced here at all); "New Sale" given the same brand-tinted
  visual weight as Shop Mode's New Bill banner and the Dashboard's Start
  New Sale tile, since it's the one action used dozens of times a day;
  6 sections rebuilt into 3 curated (Sales, Point of Sale, Products &
  Pricing) + 1 "Advanced" catch-all (dashed border, sunken background —
  visibly deprioritized, not deleted) holding everything occasionally
  useful; sales-team-only features removed outright.
- **Renamed:** Sales Invoice → **Bill**; POS Opening Entry → **Open
  Counter**; POS Closing Entry → **Close Counter**; Accounts Receivable →
  **Customer Dues** (as a new shortcut, this report wasn't linked from
  Selling before at all); Point of Sale (shortcut) → **New Sale**.
- **Verified visually** (UI-only role, no workflow/calculation testing):
  full page before/after; confirmed no regression on Home/Accounting/
  Buying (all four workspaces now share the same `kiosk_mode.js` route-
  based styling functions).
- **Before vs after:**
  ```
  Before: 6 sections, 50+ links, ERP jargon (POS Opening Entry, Accounts
          Receivable), a permanently-misleading chart, Returns/Customer
          Dues not reachable from this workspace at all
  After:  3 curated sections + 1 clearly-deprioritized Advanced section,
          26 links total, plain English throughout, 6 color-coded fast
          actions including 2 previously-missing ones (Returns, Customer Dues)
  ```
- **Core or app-only:** entirely custom-app / data-config — `Workspace`
  record rebuild (content, links, shortcuts) + new `selling_workspace.css`
  + one new function in `kiosk_mode.js`. `CORE_PATCHES.md` not touched.
- **Could this go further:** yes, named honestly: (1) "Today's Sales" /
  "Cash Collected" as live figures were deliberately *not* rebuilt here —
  the Dashboard already owns that exact data (`get_dashboard_data`,
  2026-07-30); duplicating it on Selling would mean two sources of truth
  for the same number. Worth a cross-link from Selling to Dashboard rather
  than a second implementation, if that's wanted. (2) "Delivery" wasn't
  added as a shortcut — this shop is walk-in retail with no shipping step;
  Delivery Note remains natively available if that ever changes. (3) The
  POS/billing screen itself is explicitly out of scope this round per
  direct instruction — not touched.

## 2026-07-30 — Stock workspace: UI-only redesign (dedicated session, no logic touched)

- **Original problem:** 8 sections/60+ links across serial/batch tracking,
  subcontracting, and international-trade fields never designed into this
  shop's simple catalog model (PRODUCT_MASTER_RULES.md); a "Warehouse wise
  Stock Value" chart comparing across warehouses this shop doesn't have
  more than one of (redundant with the "Total Stock Value" number card
  directly above it); ERP jargon (Stock Entry, Stock Balance, Warehouse).
- **Alternatives considered:**
  1. Rename the 3 number cards (Total Stock Value/Warehouses/Active
     Items) — considered, then **not done at all**: they're already
     genuinely plain language, and editing `Workspace.number_cards[]` is
     the exact field that broke a widget's rendering earlier this session
     (Accounting, 2026-07-30). No upside here to risk it — left completely
     untouched.
  2. Build fresh "Receive Stock" / "Add Product" forms — rejected: out of
     scope by direct instruction ("Do NOT continue to Item screens...
     Stock Entry forms"). Both shortcuts link to the existing native
     `/new` forms instead (same pattern as Shop Mode's Purchase tile).
  3. Point "Receive Stock" at a new Stock Entry "Material Receipt" — 
     rejected in favor of Purchase Invoice: this shop's actual receiving
     workflow is the single-step Purchase Invoice
     (ROADMAP.md Phase 2), already established for Buying's shortcuts;
     using a different document here would contradict that.
- **Chosen solution:** removed the Warehouse-wise chart; shortcuts
  rebuilt into 8 plain-language fast actions, two of which cross-link to
  this app's own pages instead of raw native equivalents (Search Product
  → the app's ranked Product Search; Fix Stock card link → the app's own
  simplified stock-correction dialog, not the raw Stock Reconciliation
  form); 8 sections rebuilt into 3 curated (Products, Stock, Reports) + 1
  "Advanced" catch-all (same dashed/deprioritized treatment as Selling —
  reused the exact same `santu_mark_advanced_section()` function rather
  than duplicating it).
- **Renamed:** Stock Entry → **Stock Movement**; Stock Balance →
  **Current Stock**; Stock Ledger → **Stock History**; Warehouse →
  **Storage**; Item (shortcut) → **Products**.
- **Removed entirely** (not even Advanced — a different catalog model,
  not just lower priority): Serial No/Batch tracking and its 3 expiry
  reports, Item Manufacturer, Item Alternative, Shipping Rule, Product
  Bundle, Customs Tariff Number, Subcontracted Raw Materials/Item To Be
  Received, and the cross-module trend reports (Delivery Note Trends,
  Purchase Receipt Trends, Sales/Purchase Order Analysis) already
  superseded by Accounting/Buying/Selling's own redesigned workspaces.
- **Verified visually** (UI-only role, no inventory-calculation testing):
  full page before/after; confirmed no regression on Home/Accounting/
  Buying/Selling (all five workspaces now share `kiosk_mode.js`'s
  route-based styling functions, with `santu_mark_advanced_section()`
  reused rather than reimplemented for Stock).
- **Before vs after:**
  ```
  Before: 8 sections, 60+ links, a redundant chart, ERP jargon throughout,
          the actual receiving workflow (Purchase Invoice) not linked
          from this workspace at all
  After:  3 curated sections + 1 clearly-deprioritized Advanced section,
          30 links, plain English throughout, 8 color-coded fast actions
          including 2 cross-links to this app's own simpler tools
  ```
- **Core or app-only:** entirely custom-app / data-config — `Workspace`
  record rebuild + new `stock_workspace.css` + reused (not duplicated)
  JS function. `CORE_PATCHES.md` not touched.
- **Could this go further:** yes — "Low Stock"/"Out of Stock" from the
  request's example list were deliberately not rebuilt here, same
  reasoning as Selling's Today's Sales: the Dashboard already owns that
  exact alert (`get_dashboard_data`, 2026-07-30), a second implementation
  here would just be a second source of truth for the same numbers.

## 2026-07-30 — Staff workspace: UI-only redesign (dedicated session, no logic touched)

- **Original problem:** 3 sections/13 links of IT/access-management
  jargon (Permission Manager, Role Permission for Page and Report,
  Activity Log, Access Log) — already smaller than the ERPNext business
  workspaces (this is core Frappe's "Users" module, not an ERPNext one),
  but still nothing here read as "manage my shop's staff."
- **A finding surfaced, not worked around:** the request's example list
  included Attendance, Leave, and Salary. Checked before building
  anything (confirming a doctype exists isn't "testing workflows," it's
  making sure a link isn't broken) — **`Attendance`, `Leave Application`,
  and `Salary Slip` don't exist in this installation at all.** ERPNext
  v15 split full HR/payroll into a separate `hrms` app that isn't
  installed here; only the base `Employee`, `Department`, and
  `Designation` doctypes ship with core ERPNext. No shortcuts were built
  for Attendance/Leave/Salary — a shortcut to a non-existent doctype is a
  broken link, not a feature. If those are wanted, installing `hrms` is
  an app-installation decision (`bench get-app hrms && bench install-app
  hrms`), explicitly outside a UI-only session's scope.
- **Also not done, per direct instruction:** no `User` or `Employee`
  records were created for Ankit Kumar, Manish Kumar, or Vinay Kumar.
  Real staff accounts and role assignments are a business/security
  decision ("DO NOT validate permissions... DO NOT verify role
  security"), not something to fabricate while redesigning a workspace
  page. The `Employees` shortcut currently reads "0" — correctly, since
  no Employee record exists yet; the UI is ready, the data entry is a
  separate, deliberate step for the owners themselves (or a future
  session, explicitly asked to do it).
- **Chosen solution:** shortcuts rebuilt into 6 plain-language actions
  (2 for staff logins, 2 for employee records, 1 for access levels, 1 for
  recent activity); 3 sections rebuilt into 2 curated (Staff; Logins &
  Access) + 1 "Advanced" catch-all (same reused
  `santu_mark_advanced_section()` pattern as Selling/Stock — third reuse,
  zero duplication).
- **Renamed:** User → **Staff Logins**; Role → **Access Levels**; Role
  Profile → **Permission Template**; Activity Log → **Recent Activity**.
- **Verified visually** (UI-only role, no permission/security testing):
  full page before/after; confirmed no regression on Stock (all six
  workspaces now share `kiosk_mode.js`'s route-based styling functions).
- **Before vs after:**
  ```
  Before: 3 sections, 13 links, pure IT/access jargon, no staff-directory
          concept surfaced at all despite Employee existing natively
  After:  2 curated sections + 1 Advanced, 18 links, plain English,
          6 color-coded fast actions covering both logins and employee records
  ```
- **Core or app-only:** entirely custom-app / data-config — `Workspace`
  record rebuild + new `staff_workspace.css` + reused JS function.
  `CORE_PATCHES.md` not touched. No app installation performed.
- **Could this go further:** yes, and it's the owners' call, not mine to
  assume: (1) install `hrms` if Attendance/Leave/Salary are actually
  wanted — a real scope decision with real maintenance implications, not
  a UI tweak; (2) once real Staff Member / User records exist for Ankit,
  Manish, and Vinay, the "Employees: 0" shortcut count becomes genuinely
  useful at a glance rather than a placeholder.

## 2026-07-30 — Desk-wide visual reskin ("it's looking old fashioned")

- **Original problem:** everything outside the screens already redesigned
  (Shop Mode, POS, login, search) still looked like stock Frappe — flat
  1px-border cards, boxy square buttons, cramped navbar/spacing, thin gray
  section dividers, small default checkboxes, generic blue accents.
- **Alternatives considered:**
  1. Rebuild each Desk screen as a custom page — rejected: "reuse over
     replace" (direct 2026-07-30 instruction) — a full CSS reskin gets the
     same visual outcome on every screen at once, safer and far less work
     than rebuilding working native functionality.
  2. Scope the reskin only to screens already touched — rejected: the
     complaint was Desk-wide (Owner's Admin Mode, forms, list views), not
     just Shop Mode/POS.
- **Chosen solution:** new `desk_theme.css`, loaded globally (unlike
  `kiosk_mode.css`/`shop_mode.css`, which are scoped) — soft-shadow cards,
  rounded buttons/inputs/pills, brand-colored focus rings and active tabs,
  `accent-color` on native checkboxes, taller pill-shaped navbar search,
  larger section headers, thin modern scrollbars, all built from the same
  `--santu-*` tokens as everything else.
- **Verified live** on Home, Item list, New Item form, and re-checked Shop
  Mode/POS/login for regressions — none found.
- **Core or app-only:** app-only, one new CSS file. `CORE_PATCHES.md` not
  needed — purely presentational, no JS/behavior change.
- **Could this go further:** yes, and it's open-ended by nature — this
  covers the highest-visibility surfaces (buttons, cards, forms, lists,
  nav) but a true "Notion/Linear" feel benefits from continued iteration
  as more specific screens get used for real work. Flagging rather than
  claiming this is a finished, final visual system.

## 2026-07-30 — POS: smart submit confirmation (Owner-directed redesign)

- **Original problem:** the generic "Permanently Submit ACC-PSINV-...?"
  popup fired on every completed sale — flagged last milestone, owner gave
  explicit rules rather than a plain yes/no: skip it for normal sales,
  keep it (with meaningful wording) for large amounts / high discounts /
  big credit sales, and let the owner tune the thresholds.
- **Alternatives considered:**
  1. Patch `pos_controller.js` (core) to call a different submit path that
     skips `frappe.confirm` entirely — rejected: touches core for
     something achievable without it, and core is harder to reason about
     for `bench update` safety.
  2. Monkey-patch `frappe.confirm` narrowly (matched only against the
     exact POS-submit message text, only on the point-of-sale route) —
     **chosen**. Same proven pattern already used for the loyalty-program
     bug workaround in this app. Custom-app only, every other confirm
     dialog anywhere else in Desk is untouched.
- **New config surface:** `Santu POS Settings` (Single DocType) — skip-
  confirmation toggle, large-sale threshold (₹50,000 default), discount
  limit (10% default), credit-sale limit (₹5,000 default). Reachable via
  Desk search today; a dedicated Settings screen is future work.
- **Two real bugs found and fixed while testing, not by inspection:**
  1. `frappe.confirm()` wraps its message in a `<p>` tag — per the HTML5
     spec, `<p>` auto-closes the instant it hits a block-level element.
     The first version used `<div>`s for layout, which silently corrupted
     the DOM (a stray "?" landed outside its own line). Fixed by using
     `<span>` styled as `display:block` instead.
  2. `frappe.format(value, {fieldtype:"Currency"})` returns HTML wrapped
     in `<div style='text-align:right'>...</div>`, not a plain string —
     stripping only the leading `₹` prefix left a literal trailing
     `</div>` in the text, which rendered as visible garbled text once
     escaped. Fixed by switching to the plain-string `format_currency()`
     global helper instead.
- **Verified live**, all three paths: a small normal sale (₹218) completed
  with zero popup; a ₹60,180 sale showed "Complete sale for ₹60,180.00? /
  Customer: Walk-in Customer / Items: 6 / Payment: Cash" with a "Large
  sale" warning; a ₹175 sale with a 20% manual discount showed the same
  meaningful format with a "Discount of 20% is above the usual limit"
  warning, despite the amount itself being small — confirming the risk
  checks are independent, not just amount-gated. Credit-sale-limit path
  implemented identically but not separately live-tested this round.
- **Measurable improvement:**
  ```
  Old: 1 popup + 1 click, every single sale, generic "Permanently Submit {docname}?" wording
  New: 0 popups for normal sales (the common case); popup only for large/high-discount/credit sales, with real business context instead of a docname
  ```
- **Core or app-only:** app-only. `CORE_PATCHES.md` not needed — the
  monkey-patch lives entirely in `pos_smart_confirm.js`.

## 2026-07-30 — POS: search bar auto-focus (Stage 2 audit, in progress)

- **Original problem:** the barcode/search field wasn't focused on page
  load — every fresh bill started with a wasted click before a scan could
  register. Real friction on a screen meant for continuous all-day use.
- **Alternatives considered:**
  1. Focus unconditionally on a poll tick — **tried, broke, fixed**: caught
     by testing, not inspection. A first version stole focus back to
     search even while someone was actively typing in the Item Details
     Rate field, because ERPNext's own live-stock refresh momentarily
     blurs that field to `<body>` — my poll saw the blur and grabbed it.
  2. Fixed: skip entirely whenever `.item-details-container` is open,
     regardless of momentary focus state.
- **Chosen solution:** `santu_autofocus_pos_search()` in `kiosk_mode.js`,
  guarded as above.
- **Found along the way, not yet acted on:** even with our fix fully
  disabled, the Rate field still loses focus to `<body>` on its own after
  ~5 seconds — a **pre-existing native ERPNext bug**, not caused by this
  customization (confirmed by isolation testing). Logged in
  `IMPROVEMENT_LOG.md`; fixing it properly means patching ERPNext's own
  Item Details re-render, a real `CORE_PATCHES.md`-governed change, not
  started yet.
- **Also found, flagged for a decision rather than acted on:** the
  "Permanently Submit ACC-PSINV-...?" confirmation dialog fires on
  *every single completed sale* — real cumulative friction against
  "minimal popups" at the volume this screen runs (BUSINESS_RULES.md
  implies dozens-hundreds/day). Technically removable without a core edit
  (auto-confirm the specific dialog client-side, same pattern already used
  for the POS Opening Entry dialog) — but this is the literal moment money
  and stock move, so it's a business-risk call (do we trust the two prior
  deliberate clicks — Checkout, then Complete Order — as enough, with no
  final check), not a pure design call. Flagged to the user rather than
  decided unilaterally, per `ERP_MASTER_PROMPT.md` §3.
- **Core or app-only:** app-only so far (the focus fix). The confirm-
  dialog question, if actioned, would also be app-only (client-side
  auto-confirm), not a core edit.

## 2026-07-30 — Product Search: ranked "Google for my shop inventory"

- **Original problem:** "Product Search" routed to the generic `/app/item`
  list — no stock shown, no ranking, required knowing ERPNext's exact item
  name. Fails "kitna stock hai" and "does 'pidilite' find Fevicol" outright.
- **Alternatives considered:**
  1. Elasticsearch/dedicated search index — rejected: a single shop's
     catalog (low thousands of items at most) doesn't need it; scoring
     every active item in Python per search is simpler, fully correct, and
     measured well under 100ms (Golden Rule: don't build ahead of need).
  2. Structured-only ranking (name/brand/category, no keyword field) —
     rejected: can't satisfy "pidilite finds Fevicol" — Pidilite is the
     manufacturer, not in the item name at all. Added one new field,
     `Item.custom_search_keywords`, as the lowest-weighted signal.
  3. Whole-string fuzzy match for typos — **tried, broke, fixed**:
     comparing a 5-letter typo against a full ~40-character item name
     tanked the similarity ratio (length-dominated), so "asain" returned
     nothing. Switched to per-word comparison; caught by actually testing
     the typo case, not by inspection.
- **Chosen solution:** new whitelisted `search_products` (weighted score:
  code > barcode > name > keywords > brand > category > fuzzy > partial),
  new `Product Search` page (instant as-you-type, barcode/exact-match
  auto-opens with no extra click), reusing the POS's own
  `get_pos_reserved_qty` so stock numbers never disagree between screens.
- **Verified live**, all product-requirement examples: "asian" → both
  Asian Paints products; "10mm" → both fastener products; "switch" → found
  a product with *no* "switch" in its item name (via category+keywords);
  "pidilite" and "fevicol" → the same product either way; a real barcode →
  single exact match, auto-highlighted; "asain" (typo) → found after the
  fix above; multi-word exact phrase → single auto-expanded match.
- **Measurable improvement:**
  ```
  Old: 0 of 5 example queries findable (generic list has no ranking/keyword matching)
  New: 8 of 8 tested queries (including a barcode and a misspelling) return the right product
  Old: no stock shown on this screen at all
  New: live stock shown, same source of truth as the POS screen
  Search latency measured live: 11-74ms per query (server round-trip)
  ```
- **Core or app-only:** custom-app only (one new Item field, one API
  method, one Page). `CORE_PATCHES.md` not needed.
- **Could this go further:** yes — Close Counter's demo/realistic data
  (7 items) was created to validate this and deliberately left in the
  system rather than cleaned up, since Stage 2 keeps needing sample data
  per ROADMAP.md's "populate as you redesign" instruction — flagging this
  departure from the earlier "always clean up test data" practice
  explicitly rather than silently changing it. Also: `custom_search_keywords`
  is populated by hand per item right now; real catalog entry (Stage 3)
  should decide whether this becomes a required field or stays optional.

## 2026-07-30 — Shop Mode: Close Counter + Purchase/Expenses click-path

- **Original problem:** Mapped against the full daily journey
  (`ROADMAP.md` Phase 2.5), "close the counter" — a genuine end-of-day
  step — had no visible path in Shop Mode at all; only a hidden Desk
  hamburger-menu shortcut (Shift+Cmd+C) a cashier would never find.
  Separately, "Purchase" and "Expenses" routed to LIST views (extra
  "+ New" click every time) while "New Bill" went straight to its
  creation screen — inconsistent for a screen whose entire purpose is
  "fewest clicks to the thing you actually do here."
- **Alternatives considered:**
  1. Auto-submit Close Counter with zero review — rejected: counting the
     cash drawer is a real verification step protecting the business, not
     busywork (§8.1 non-negotiable, accounting integrity over click-count).
  2. Fold Close Counter into an existing tile — rejected: it's a distinct,
     daily, high-stakes action; burying it defeats the point.
- **Chosen solution:** added a "🔒 Close Counter" tile routing to the
  native POS Closing Entry form (pre-fill-on-select, not auto-submitted);
  changed Purchase/Expenses routes from list → `/new` form directly.
- **Verified:** clicked through all three live — Purchase lands on a
  fresh form with single-step-purchase defaults intact; Close Counter
  reaches the form in 1 click, then 1 more click (select the one open
  entry) auto-fills Company/POS Profile/Cashier.
- **Measurable improvement:**
  ```
  Old: Close Counter unreachable without knowing a hidden keyboard shortcut
  New: 2 clicks total (tile → select opening entry), rest auto-filled
  Old: Purchase/Expenses = 2 clicks minimum (list, then "+ New")
  New: Purchase/Expenses = 1 click (straight to form)
  ```
- **Core or app-only:** custom-app only (`shop_mode.js`). No core touched.
- **Could this go further:** yes — Close Counter's form still isn't
  pre-filled on arrival (needs that one dropdown pick); a future pass
  could default to the sole open entry automatically when only one exists.
  Not done now to avoid silently picking the wrong shift if multiple ever
  exist.

## 2026-07-30 — Settings workspace UI redesign

- **Original problem:** the Settings workspace (`Workspace "Settings"`,
  formerly docname "ERPNext Settings") read like a developer control
  panel: 7 grey text-link shortcuts (System/Accounts/Stock/Selling/
  Buying Settings, Global Defaults, Print Settings) with zero visual
  hierarchy, then 6 cards (Module Settings, Email/Notifications,
  Website, Core, Printing, Workflow) exposing 36+ individual settings
  docs flatly, with no distinction between "opened weekly" (GST, invoice
  design, backups) and "opened once at install and never touched again"
  (Website Script, Newsletter, Workflow Action, Domain Settings,
  Manufacturing/CRM/Projects/Support Settings — none of which apply to
  a single hardware shop with no public website, no approval workflow,
  and no manufacturing/CRM/project/helpdesk module in use).
- **Alternatives considered:**
  1. Keep all 6 cards, just relabel — rejected: relabeling "Website
     Script" to something friendlier doesn't change that a shop owner
     should never see it at all.
  2. One giant flat list of renamed settings, no tiering — rejected:
     fails the "half its current size" and "one click" goals; GST & Tax
     would still be visually equal to Workflow Action.
  3. Move everything not in the 12-item example list into Advanced,
     including Accounting/Purchase/General Settings — rejected: those
     four are still genuinely used occasionally (tax rate changes,
     rounding rules, default warehouse), just not weekly; burying them
     next to Website Script would be as confusing as not tiering at all.
     Landed on a 3-tier structure instead (see below).
- **Chosen solution:** 3-tier structure.
  - **Tier 1 — "Your Shortcuts"** (10 emoji-led, color-coded hero
    tiles, the only things a shop owner needs "within seconds"): Shop
    Information (→ the Company record directly, not its list),
    GST & Tax, Billing Settings, Inventory Settings, Printer Settings,
    Payment Methods, Staff & Permissions, Warehouse Settings, Invoice
    Design (→ Print Format list pre-filtered to `doc_type=Sales
    Invoice` via a URL-type shortcut, so only the 8 relevant formats
    show, not all print formats in the system), Backup & Restore.
  - **Tier 2 — "More Settings" card:** General Settings, Accounting
    Settings, Purchase Settings, Default Preferences — real settings,
    just not weekly-frequency.
  - **Tier 3 — "Advanced"** (dashed-border treatment, reusing the same
    `santu_mark_advanced_section()` JS already shared across Selling/
    Stock/Staff — fourth reuse of that one function): Data tools
    (Import/Export/Bulk Update/Deleted Documents), all Email/
    Notification settings, all Website settings, Print Format
    Builder/Style, Workflow (all 3), Domain Settings, and the
    Manufacturing/CRM/Projects/Support module settings — none
    reachable inside 1-2 clicks of "Your Shortcuts", all still present
    for the rare case they're ever needed.
  - **"Security"** and **"Devices"** from the requested 12-item example
    list were deliberately not built as separate hero tiles: there is
    no `Security` doctype distinct from `System Settings` in core
    Frappe (session/password/2FA fields live inside System Settings
    itself — a second tile pointing at the same destination would be a
    fake duplicate, so it was folded into "General Settings" instead),
    and there is no `Devices` concept at all in vanilla ERPNext/Frappe
    (no connected-printer/scanner registry) — inventing a destination
    for it would ship a dead link. Same "never fabricate a destination"
    rule applied earlier to the Staff workspace's Attendance/Leave/
    Salary decision.
- **Verified:** clicked all 10 hero tiles live. Shop Information opens
  straight into the "Santu Hardware" company form (not its 1-row list).
  Invoice Design opens Print Format pre-filtered to Sales Invoice (8 of
  8 rows, confirmed via the list's own "8 of 8" counter). Payment
  Methods/Staff & Permissions/Warehouse Settings show live record-count
  badges (6/5/5) for free, since they're plain DocType-type shortcuts.
  Advanced card renders with the dashed/sunken treatment, matching
  Selling/Stock/Staff.
- **Measurable improvement:**
  ```
  Old: 7 flat shortcuts + 36+ links across 6 undifferentiated cards, no visual priority
  New: 10 color-coded hero tiles (1 click to any daily setting) + 4-item "More Settings" + 24-item "Advanced" (2 clicks, clearly deprioritized)
  Old: Company record required navigating Company list → open the one row (2 clicks)
  New: Shop Information tile → company form directly (1 click)
  Old: Print Format list showed all formats across every doctype, unfiltered
  New: Invoice Design shows only the 8 Sales Invoice formats
  ```
- **Core or app-only:** custom-app only — `Workspace "Settings"` data
  (shortcuts/links/cards rebuilt), new `settings_workspace.css`, one
  array entry added to the existing `santu_mark_advanced_section()`
  route-dispatch in `kiosk_mode.js`. No core file touched, no business
  logic touched.
- **Could this go further:** yes — "Staff & Permissions" currently
  points to the plain `Role` list (same destination the Staff
  workspace's "Access Levels" tile already uses); a combined
  role-editor experience tailored to "what can Vinay see" would be
  friendlier than the generic Role list/form, but that's a form-level
  change, out of scope for a workspace-only pass. Also: GST & Tax
  points at the india_compliance app's `GST Settings` doctype as-is,
  unrenamed/unsimplified internally — that doctype's own field labels
  are still ERPNext-standard technical language, a candidate for a
  future "redesign the settings forms themselves" pass if requested.

## 2026-07-30 — Bill/invoice PDF redesign

- **Original problem:** the default print output for a bill was
  india_compliance's stock "GST Tax Invoice" Print Format Builder
  template (`Sales Invoice.default_print_format`) — a formal, dense GST
  invoice layout (buyer/consignee blocks, tax breakup table, HSN
  summary) designed for B2B compliance paperwork, not a shop handing a
  customer their receipt. No print format was configured for `POS
  Invoice` at all (`default_print_format` was empty), so the actual
  daily "Start New Sale" flow had no clean, deliberate print output.
- **Alternatives considered:**
  1. Edit the existing GST Tax Invoice format in place — rejected: it's
     a `standard` (module-shipped) format from india_compliance; editing
     it directly gets silently overwritten on an app update, and its
     structure (Print Format Builder `format_data`, not raw HTML) isn't
     built for the kind of layout control this needed.
  2. One shared print format for both `Sales Invoice` and `POS
     Invoice` — not possible: a Print Format's `doc_type` is fixed to
     one doctype. Built two (`Santu Hardware Bill` for POS Invoice,
     `Santu Hardware Bill (Sales Invoice)` for Sales Invoice) sharing
     identical HTML/CSS, since the two doctypes carry near-identical
     fields (`customer_name`, `items`, `grand_total`, `in_words`,
     `company_address_display`).
- **Chosen solution:** new custom Jinja print formats — shop name large
  and bold top-left, address/GSTIN beneath it (via `frappe.db.get_value`
  in the template, not hardcoded), "TAX INVOICE" + bill number + date
  top-right, a clean item table (#, item, qty, rate, amount), a bold
  total row, amount-in-words, and a one-line footer ("Thank you for
  shopping with Santu Hardware! Prices shown are inclusive of applicable
  taxes.") — no tax breakup rows, matching the shop's GST-inclusive
  flat-pricing convention (2026-07-30 direct instruction). Set as the
  default on both `POS Invoice` and `Sales Invoice` DocTypes (matching
  how india_compliance itself had set the previous default — a direct
  field on the `DocType` record, not a Property Setter) and explicitly
  on `POS Profile.print_format` so the live billing screen picks it up
  too.
  **Layout built with `<table>`, not flexbox** — the first draft used
  `display:flex` for the header/total-row split; caught before shipping
  by test-rendering an actual PDF (`frappe.get_print(..., as_pdf=True)`)
  and reading the resulting CSS-parser warnings: wkhtmltopdf's rendering
  engine (Qt WebKit, effectively frozen ~2016) has no flexbox support at
  all. Rewrote both split-layouts as 2-column tables, which render
  identically in a live browser and are universally safe in wkhtmltopdf.
- **Verified:** rendered the print preview live for both a POS Invoice
  and its consolidated Sales Invoice — correct shop header, GSTIN,
  customer name, item/qty/rate/amount, bold total, amount in words, no
  duplicate/dead layout artifacts.
  **Could not verify the actual PDF file bit-for-bit** — this dev
  machine has no `wkhtmltopdf` binary installed at all (confirmed via
  `shutil.which`), and this Frappe build has no alternate Chrome-based
  `pdf_generator` option (`Print Settings` has no such field here). This
  is a pre-existing environment gap, unrelated to this design change.
  Does **not** block real shop use today: the printview page's own
  "Print" button uses the browser's native print engine (`window.print()`),
  completely independent of the server-side wkhtmltopdf pipeline — a
  real printer works right now. Only server-side PDF generation ("Get
  PDF" downloads, PDF email attachments) needs the binary. Downloaded
  and checksum-verified the official `wkhtmltopdf/packaging` release pkg
  at the user's explicit request, but installing it requires `sudo` —
  blocked by the harness's own permission classifier (a real system
  install needs the user's own password/interactive terminal), so the
  install command was handed back to the user rather than worked around.
  This machine is Apple Silicon and the last wkhtmltopdf macOS build
  predates native arm64 support, so Rosetta 2 is also required first.
- **Measurable improvement:**
  ```
  Old: no print format configured for POS Invoice at all (daily billing had no deliberate print output)
  Old: Sales Invoice defaulted to a dense B2B GST-compliance template (buyer/consignee blocks, tax breakup, HSN summary)
  New: one clean, on-brand receipt layout for both, GST-inclusive pricing shown with no confusing empty tax rows
  ```
- **Core or app-only:** custom-app only — two new `Print Format` records
  (`module: Santu Hardware`), `POS Invoice`/`Sales Invoice` DocType
  `default_print_format` field set, `POS Profile.print_format` set. No
  core file touched, `CORE_PATCHES.md` not needed.
- **Could this go further:** yes — no letterhead/logo image is used
  (Company has no `company_logo` set); a real shop logo would slot
  cleanly into the header once provided. Also: PDF file verification is
  still pending on this machine until wkhtmltopdf + Rosetta are
  installed by the user.

## 2026-07-30 — Thermal printing, auto PDF save, WhatsApp share, cash drawer (Phases 1–6)

- **Original problem:** the user handed over a full 6-phase spec for
  real shop hardware/messaging integration — Epson thermal printing,
  auto-PDF-save to date folders, WhatsApp invoice sharing, a Printer
  Settings screen, printing from every doctype, and reprint/duplicate —
  with an explicit priority order (printer → beautiful thermal invoice →
  auto PDF save → WhatsApp → cash drawer).
- **Two hard blockers clarified before writing any code** (see AskUserQuestion):
  1. A browser can't talk to a USB/network printer by itself — silent
     one-click printing needs QZ Tray, a free local desktop bridge
     service, running on the shop PC. User chose to build for this
     directly rather than start with the browser's plain Print dialog.
  2. True automatic WhatsApp sending needs a paid WhatsApp Business API
     account (Meta Cloud API / Twilio / Gupshup / Interakt) that this
     shop doesn't have. User confirmed: build the no-API version (a
     `wa.me` click-to-chat link, pre-filled message, PDF handed over to
     attach manually) instead.
- **What got built:**
  - Two new thermal print formats (`Santu Hardware Thermal Bill` for
    POS Invoice, `...(Sales Invoice)` for the consolidated record) —
    58mm/80mm, switchable live via a `Santu POS Settings` field, no
    flexbox (same wkhtmltopdf constraint as the A4 bill), inline SVG
    logo, UPI "scan to pay" QR (only when a UPI ID is configured — never
    fabricated), Code128 barcode of the invoice number, Paid/Payment Due
    status pill.
  - QR/barcode generation happens **server-side** (`pyqrcode` +
    `python-barcode`, both already present in this bench's venv),
    embedded as inline base64 `data:` URIs — a print format has no
    client-side JS execution to lean on the way a live page would.
    Discovered mid-build that print-rendering Jinja exposes
    `frappe.call` (`call_whitelisted_function`) by default, which is
    what makes calling back into `api.py` from inside a print format
    template possible at all.
  - `Santu POS Settings` (existing single doctype, extended rather than
    creating a new one) gained a Printer section (selected printer,
    paper width, copies, auto print, open cash drawer) and a Payments
    section (UPI ID) — with a "Detect Printers" button that calls QZ
    Tray live instead of offering a hardcoded Epson/XPrinter/TVS list,
    so it works with whatever's actually plugged in.
  - `thermal_print.js` — the QZ Tray bridge (connect / list printers /
    print a rendered PDF / send the ESC/POS cash-drawer-kick command).
    The connector library itself (`vendor_qz_tray.js`) is vendored into
    this app's own `public/js/`, not pulled from QZ's CDN — this shop is
    offline-first by design, so a print button can't depend on internet
    access.
  - `post_sale_popup.js` — fires on `POS Invoice` `on_submit` (a
    standard client-script hook; POS's screen builds a real
    `frappe.ui.form.Form` under the hood, confirmed by reading
    `pos_controller.js`, so this needed no core file touched). Shows
    amount/customer, Print/Preview/Save PDF, and — only when the
    customer has a phone number on file — Share on WhatsApp.
  - `save_invoice_pdf_to_dated_folder` (`api.py`, wired via `doc_events`
    in `hooks.py`) — auto-saves every submitted bill's PDF to
    `Invoices/YYYY/Month/YYYY-MM-DD/` in the File Manager, no manual
    save.
  - `print_everywhere.js` — adds a "Print (Thermal)" button to the
    Sales Invoice and POS Invoice Desk forms (reprinting later, not
    just right after the sale). Deliberately **not** rolled out to
    Purchase Invoice/Quotation yet — those need their own print format
    designed first (a "Paid"/scan-to-pay section makes no sense on a
    purchase or an estimate), not the bill format pointed at the wrong
    doctype.
- **A real bug caught and fixed during live testing, not before:** the
  first version of `save_invoice_pdf_to_dated_folder` only wrapped the
  PDF-generation call in try/except, not the folder-creation call after
  it. A real POS checkout (`ACC-PSINV-2026-00015`) hit a
  `posting_date`-arrives-as-a-string edge case in that unwrapped part
  and surfaced as a blocking "Server Error" dialog on the actual
  checkout screen — the sale itself still completed (`docstatus` was
  already 1, confirmed via console), but the visible error would have
  worried a real shop owner. Fixed two ways: `frappe.utils.getdate()`
  now normalizes the input, and the **entire** function body is one
  try/except — a background nice-to-have must never be able to block or
  visibly frighten someone during a real sale. Re-tested live
  (`ACC-PSINV-2026-00016`): clean popup, no error, PDF correctly landed
  in `Home/Invoices/2026/July/2026-07-30/`.
  Also caught: the WhatsApp button's phone-number check only looked at
  `contact_mobile` (a snapshot field that needs a linked Contact
  record), not the `Customer.mobile_no` fallback the print format
  already used — meaning it would've stayed hidden for customers who do
  have a number on file, exactly the population most likely to want it.
  Fixed to check both, verified live via console against a real
  customer record.
- **What could not be verified from here:** the actual QZ Tray →
  printer → paper path. This dev machine has no QZ Tray, no printer, no
  cash drawer. What IS verified: the JS fails cleanly and readably when
  QZ Tray isn't reachable ("Couldn't reach QZ Tray. Make sure it's
  installed and running..."), both from the Printer Settings "Detect
  Printers" button and from a raw JS console call — the whole client
  path up to the point where it needs real hardware is confirmed
  working. The remaining step is entirely on the shop PC: install QZ
  Tray, plug in the printer, run "Detect Printers," pick it, done.
- **Core or app-only:** custom-app only. Two new Print Format records,
  one vendored third-party JS library (`vendor_qz_tray.js`, LGPL-2.1,
  QZ Tray's own official connector), five new/extended app JS files, one
  `doc_events` hook, several new `api.py` methods. No core file touched.
- **Could this go further:** yes, per the user's own phased plan —
  Purchase Invoice/Quotation print formats (Phase 5 remainder), a real
  Messaging Service abstraction if this shop ever gets a WhatsApp
  Business API account (the `santu_share_on_whatsapp` function is
  already the one seam billing code depends on, deliberately, so that
  swap wouldn't touch the rest of the billing flow), and a "Duplicate"
  action alongside the current Reprint. Not built now — no signal this
  shop needs them yet, and building past what's asked isn't the goal.

## 2026-07-30 — POS: new-sale customer capture + item list view

- **Original problem:** two direct complaints. (1) "Creation of a new
  customer is not looking easy" — the native POS customer widget
  defaults silently to Walk-in Customer; creating/finding a real
  customer means clicking the avatar (which actually opens an editor
  for editing WALK-IN CUSTOMER's own contact fields, not creating
  anyone new) or using a separate search field, neither obvious. (2)
  Items showing as a tile grid ("FS", "UC", "AR"...) — user wanted a
  list instead.
- **Customer capture, chosen solution:** a dialog ("Who's this sale
  for?") fires the moment a new sale starts — on the very first load of
  the day and every "New Order" after completing one — asking Name +
  Phone. Phone is looked up against existing `Customer.mobile_no`
  first; a match reuses that customer (no name-typo duplicates from
  re-typing "Ramesh Verma" slightly differently), no match creates a
  new one on the spot. A "Walk-in Customer" button skips it entirely
  for quick counter sales that don't need a name on file.
  **Technical approach:** `frappe.ui.form.on("POS Invoice", {onload...})`
  — confirmed safe because `pos_controller.js` builds a real
  `frappe.ui.form.Form` under the hood (same fact already established
  building the post-sale popup), so this needed no core file touched.
  Setting `frm.doc.customer` alone doesn't refresh the cart's own
  "Walk-in Customer" summary card (a separately-rendered component with
  its own `customer_info` state) — replicated the exact sequence
  `pos_item_cart.js`'s native customer-field `onchange` uses
  (`fetch_customer_details` → `events.customer_details_updated` →
  `update_customer_section` → `update_totals_section`), reached via
  `window.cur_pos.cart` (`cur_pos` is set globally by `point_of_sale.js`
  itself: `window.cur_pos = wrapper.pos`).
- **Item list, chosen solution:** pure CSS restyle of the existing
  `ItemSelector` component (`.items-selector`/`.items-container`/
  `.item-wrapper`) from a CSS Grid of tiles into a single-column list —
  same DOM, same search/stock-badge/click-to-add behavior, just
  restyled. Two real snags hit and fixed live, not assumed correct on
  the first pass:
  1. First attempt targeted `.items-selector` for the grid-to-flex
     conversion; DevTools-style inspection showed the *actual* grid
     container is a nested `.items-container` — `.items-selector` is
     just an outer wrapper. Fixed by targeting both.
  2. After that fix, items stacked as a column but each row rendered as
     a tall, oddly-proportioned box — `.item-display.abbr`'s native
     `min-height: 128px` was overriding the new `height: 40px`
     (`min-height` beats `height` when both are set); needed an explicit
     `min-height`/`max-height` override too.
  3. Caught in a full checkout test, not before: a single-column list of
     10+ rows is taller than the grid's content ever was, and flex
     children default to `min-height: auto`, which silently defeats a
     parent's `overflow: hidden` clipping — without an explicit
     `min-height: 0` the list pushed the entire POS screen down,
     requiring a page-level scroll to reach the payment panel. Fixed by
     adding `min-height: 0` and switching to `overflow-y: auto` so the
     list scrolls within its own bounded panel instead.
- **Verified live, both paths:** phone `9835201122` correctly matched
  the existing "Ramesh Verma" (no duplicate created); a fresh phone
  created a new "Rajesh Prasad" customer, immediately usable, and the
  post-sale popup correctly showed "Share on WhatsApp" for that sale
  since the phone was now on file. Item list confirmed scrollable
  within its own panel, click-to-add and search unaffected, no
  console errors.
- **Core or app-only:** custom-app only — one new API method
  (`get_or_create_customer_by_phone`), one new JS file
  (`pos_customer_capture.js`), one new CSS file (`pos_item_list.css`).
  No core file touched.
- **Could this go further:** yes — the dialog currently has no "is this
  really a new person, or did you mean an existing similarly-named
  customer" fuzzy-match safety net the way the Manish Raj/Manish Kumar
  staff-record mixup was caught earlier in this project; for now it
  trusts the phone number as the sole source of truth, which is a
  reasonable default but not foolproof (a shared family phone, a
  customer who changed numbers).

## 2026-07-30 — Bill v3: numeric bill no, due date, HSN, balances, rewards, village + Customer Dues page

- **Original problem:** an 8-point spec for the printed bill and a new
  village-based dues-tracking screen: state (Bihar) + village on the
  bill, a numeric bill number instead of the full docname, a due date
  capped at +2 days, a proper #/name/qty/price/amount item table with a
  total-quantity line, a running account summary (previous/received/
  current balance), loyalty points earned/total, a missing "TAX
  INVOICE" label on the thermal format, one more standard element of my
  own judgment, and a searchable-by-name, village-filterable page
  listing every customer's dues with their full bill history attached.
- **Village + state:** new `santu_village` custom field on `Customer`
  (Custom Field, core doctype — can't edit the doctype JSON directly).
  Wired into the same new-sale capture dialog built earlier this
  session (`pos_customer_capture.js`) so it's collected at the point a
  customer is created, not a separate data-entry step later. State is
  NOT a new field — read live from the customer's existing primary
  Address record (already Bihar for all real customers), with "Bihar"
  as the literal fallback only if a customer has no address on file at
  all (never fabricated as the ONLY source — always tries the real
  address first).
- **Numeric bill number:** new `santu_bill_no` custom field (Int) on
  both POS Invoice and Sales Invoice, assigned via
  `frappe.model.naming.getseries()` — Frappe's own atomic, row-locked
  counter primitive (the same mechanism core naming series use), so two
  simultaneous checkouts can never collide on the same number. Assigned
  in `before_submit` (not `on_submit`) specifically so the number is
  already part of the document by the time the PDF auto-save hook
  renders it right after. Old invoices from earlier this session
  correctly show "-" (the field didn't exist when they were created) —
  not backfilled, since a real shop's bill numbers should reflect when
  numbering actually started, not be invented retroactively.
- **Due date:** `before_submit` hook caps `due_date` at
  `posting_date + 2` days whenever it's unset or later than that — same
  function as the bill number (`apply_billing_defaults`), one
  `doc_events` entry for both.
- **Bill layout — item table, total qty, HSN:** rebuilt both the A4 and
  thermal formats with a proper # / Item / HSN / Qty / Rate / Amount
  table and a Total Qty line (`doc.items | sum(attribute="qty")` — a
  built-in Jinja filter, no new Python needed). HSN per item is the
  "something required that I know" addition — a real Indian GST
  requirement above certain turnover, and the field was already sitting
  on every item row (`item.gst_hsn_code`, populated automatically by
  india_compliance) — genuinely free to add, not extra work invented
  for its own sake. Also added a standard retail disclaimer ("Goods
  once sold will not be taken back or exchanged. E&OE.") to the footer.
- **Account summary (previous/received/current balance):** new
  `get_customer_balance_summary()` in `api.py` — sums `outstanding_
  amount` across the customer's Sales Invoices (the accounting-final
  record) plus any POS Invoice that hasn't been consolidated into one
  yet (today's not-yet-closed sales), explicitly excluding the invoice
  currently being printed and excluding already-consolidated POS
  Invoices so a bill's dues are never counted twice. Verified live with
  a real ₹100 unpaid credit sale: "Previous Balance: Rs. 100.00,
  Current Balance: Rs. 100.00" (shown in red), correctly zero for a
  fully-paid customer.
- **Reward points:** required actually finishing a Loyalty Program
  first (see below) — `get_customer_loyalty_summary()` reads the real
  `Loyalty Point Entry` created by ERPNext's own POS submit flow for
  "earned this bill" (NOT `doc.loyalty_points`, which tracks
  REDEMPTION used as payment on an invoice, not points earned — a real
  field-semantics mistake caught by checking the actual DB value before
  trusting the obvious-looking field name) and sums all of a customer's
  entries for "total points." Verified live: an ₹8,500 sale correctly
  earned 85 points (collection factor: 100 spent = 1 point).
- **Loyalty Program had to be un-blocked first:** `__init__.py` carried
  a monkey-patch (from earlier this session) that permanently
  short-circuited `get_loyalty_programs()` to return `[]`, working
  around a real ERPNext core bug (a raw-SQL-expression-as-filter-dict-key
  that breaks on this MariaDB version) — logged at the time as "upgrade
  when loyalty is actually wanted." That's now. Replaced the stub with
  a plain-Python reimplementation of the same filtering logic (fetch
  all Loyalty Program rows, filter expiry/customer-group/territory in
  Python instead of via the broken raw-SQL pattern) — avoids the bug
  class entirely rather than re-triggering it. Verified live: a
  Customer save no longer errors, and a brand-new customer correctly
  auto-opts into "Santu Hardware Rewards".
- **"TAX INVOICE" on thermal:** was present on the A4 format from the
  start but genuinely missing from the thermal one — added.
- **Customer Dues by Village page:** new custom Page (`/app/santu-
  customer-dues`, same pattern as the existing Dashboard page) —
  search-by-name, a village filter dropdown (populated from real
  `Customer.santu_village` values, not a hardcoded list), one row per
  customer with any outstanding balance (reusing the exact same balance
  query the printed bill uses, so the two can never disagree), sorted
  highest-due-first. Clicking a customer opens every one of their bills
  (Sales Invoice + not-yet-consolidated POS Invoice, combined and
  date-sorted — a shop owner doesn't care which internal doctype a
  bill happens to be in) in one dialog, each row linking straight to
  the real document. Added as the first, most prominent shortcut tile
  on the Accounting workspace. Verified live: village filter correctly
  narrows/excludes, bill drill-down shows both a paid and an unpaid
  bill for the same customer with correct status pills, clicking
  through opens the real record.
- **A recurring gotcha hit again, same fix as before:** `bench migrate`
  (needed for the new custom fields and the new Page) once again
  recreated Users/ERPNext Settings/Receivables/Payables as fresh
  duplicates (see the 2026-07-30 IMPROVEMENT_LOG.md entry on this same
  bug from earlier the same day) — caught and cleaned up immediately
  per the now-standing post-migrate checklist in `PROJECT_STATUS.md`,
  not rediscovered from scratch.
- **Core or app-only:** custom-app only — 3 new Custom Fields
  (`Customer.santu_village`, `POS Invoice.santu_bill_no`,
  `Sales Invoice.santu_bill_no`), one new Loyalty Program record, one
  upgraded (not new) core-bug-workaround patch, one new Page (json/py/
  js), ~150 lines of new `api.py` functions, one `doc_events` hook, two
  print formats rewritten. No core file touched.
- **Could this go further:** yes — no fuzzy-match safety net on the
  new-customer dialog (a shared family phone or a changed number could
  still create a near-duplicate by name); redemption isn't wired up
  (points accumulate and display, but there's no "pay with points" flow
  yet — no signal this shop wants that today, matching the Loyalty
  Program's `expense_account` deliberately left blank); the Customer
  Dues page doesn't yet show a "days overdue" figure alongside the
  amount, which a real collections workflow would likely want next.

## 2026-07-30 — Remove GST/SGST/CGST lines from the bill entirely

- **Original problem:** earlier the same day, "prices are inclusive of
  GST, don't add extra" was fixed by setting `included_in_print_rate`
  on the tax template, which back-calculates tax FROM the entered rate
  instead of adding on top — the grand total was correct, but the cart
  and bill still showed a "SGST @ 9% / CGST @ 9%" breakdown. The user
  then sent a live screenshot of exactly that breakdown and said
  plainly: "i dont want this gst anywhere in the bill, remove the gst"
  — a correction that the total-only fix wasn't what was actually
  asked for.
- **Alternatives considered:**
  1. Blank out the POS Profile's default tax template — rejected:
     india_compliance's `before_validate`/`validate` hooks
     (`gst_india/overrides/transaction.py`) auto-select a template
     from company/customer state match on every POS/Sales Invoice,
     completely independent of the POS Profile.
  2. Server-side `doc_events` only (`before_validate`/`validate`
     clearing `doc.taxes`) — implemented first, rebuilt, tested live:
     did NOT work. The on-screen cart total while a sale is still being
     built is computed purely client-side by `erpnext.taxes_and_totals`
     (`taxes_and_totals.js`), which never touches server doc_events
     until actual save/submit — confirmed live, SGST/CGST still showed
     on a ₹185 item before any save.
  3. Remove india_compliance entirely — rejected: it's still needed
     for GSTIN/HSN fields and e-invoicing infrastructure even if this
     shop doesn't show tax breakup on the bill.
- **Chosen solution:** both layers, since each covers a different
  moment in the flow. Server-side: `strip_gst_line_items()` in
  `api.py`, wired as `before_validate` AND `validate` for
  `("POS Invoice", "Sales Invoice")` — clears `taxes_and_charges` and
  `taxes` every time, relying on `santu_hardware` being last in
  `sites/apps.txt` so its `doc_events` run after india_compliance's for
  the same event ("clear what they just set" rather than fighting to
  prevent the selection at its source). Client-side: new
  `pos_no_gst.js` monkey-patches
  `erpnext.taxes_and_totals.prototype.calculate_taxes_and_totals` (the
  one choke-point method every cart change routes through — item add,
  qty change, customer change) to clear `frm.doc.taxes` /
  `taxes_and_charges` immediately before every recalculation, same
  safe non-invasive prototype-patch pattern as `pos_smart_confirm.js`.
- **Verified live:** added Fevicol (₹185) — no tax lines, Net Total =
  Grand Total = ₹185.00 exactly. Added a second, much larger item
  (Asian Paints Royale ₹8,500) to rule out any amount-dependent
  behavior — cart correctly showed Net Total = Grand Total = ₹8,850.00,
  still zero tax lines. Ran a full checkout (Cash payment, exact
  amount) — submitted invoice ACC-PSINV-2026-00026 created cleanly at
  ₹8,850.00, no validation errors from `strip_gst_line_items` running
  alongside `apply_billing_defaults` in the same submit. Post-sale
  popup and the actual print preview (thermal format) both confirmed:
  item table, HSN codes, Total Qty, TOTAL ₹8,850.00, account summary,
  88 reward points earned — no SGST/CGST/IGST anywhere.
- **Core or app-only:** custom-app only — one new `doc_events` pair
  (reusing the existing hook dict) and one new `app_include_js` file.
  No core or india_compliance file touched.
- **Could this go further:** yes — if this shop's turnover later
  crosses the GST-invoice-mandatory threshold, this fix will need
  reverting (or made conditional) since a compliant "Tax Invoice" is
  legally required to show the tax breakup, not just an inclusive
  total; worth flagging to the user before that day arrives rather
  than silently breaking compliance.

## 2026-07-30 — Split payments auto-balance + rupee discount option

- **Original problem:** two issues flagged together, mid-session, from a
  live screenshot of the payment screen: (1) "only cash option is
  showing as default, u hav to select if cash is 8500 and upi is
  entered 500 then cash should be 8000 as total amount is 8500" — the
  native payment screen auto-fills Cash with the FULL grand total the
  moment it's selected, but typing an amount into a second mode (UPI)
  just adds a second row on top instead of the two splitting the total,
  so Paid Amount overshoots and the cashier has to manually delete
  digits from Cash to fix it (which is what the earlier GST-verification
  checkout in this same session had to do, by hand, digit by digit).
  (2) "in discount there should be 2 option percentage or discount in
  rs" — the native "Add Discount" widget only ever writes
  `additional_discount_percentage`; there's no way to type a flat
  rupee-amount discount, even though the core doctype already has a
  `discount_amount` field the totals engine understands natively.
- **Alternatives considered:**
  1. For the payment split — recompute the default row inside the
     existing per-control `onchange` in `pos_payment.js` — rejected
     without touching core: that handler is a closure defined inline
     inside `render_payment_mode_dom`, not a separately overridable
     method, so patching it means re-declaring the whole 60-line
     render function just to change 5 lines.
  2. For the payment split — a fresh `frappe.ui.form.on("Sales Invoice
     Payment", "amount", ...)` listener — chosen: `frappe.ui.form.on`
     appends listeners rather than replacing them, and `pos_payment.js`
     itself already listens on this exact child doctype/fieldname (for
     loyalty-redemption sync), confirmed via `POS Invoice.payments`
     field options — so this runs alongside core, not against it.
  3. For the discount toggle — prototype-patch
     `erpnext.PointOfSale.ItemCart` the same way `pos_no_gst.js`
     patches `erpnext.taxes_and_totals` — tried first, and the class
     didn't exist yet when the patch ran: `pos_item_cart.js` lives in
     the POS page's own lazy-loaded bundle, not the main desk bundle
     `app_include_js` executes alongside, so a one-shot guarded patch
     silently no-opped (confirmed live: native single-field box kept
     showing, no toggle). Fixed by polling every 200ms until the class
     exists, then patching once and clearing the interval.
- **Chosen solution:** `pos_smart_payment_split.js` (new) — on every
  non-default payment row's `amount` change, sets the default row
  (Cash) to `max(0, grand_total - sum of every other row)`, guarded
  against recursion so editing Cash directly, or the handler's own
  top-up, never re-triggers itself. `pos_discount_toggle.js` (new) —
  overrides `show_discount_control`/`hide_discount_control` to render a
  %/₹ toggle; whichever mode is picked writes to
  `additional_discount_percentage` or `discount_amount` and zeroes the
  other, so the two can never both be set at once and disagree.
  `hide_discount_control` reads both fields fresh from `frm.doc` rather
  than trusting its argument, since core calls it as
  `this.hide_discount_control(frm.doc.additional_discount_percentage)`
  on every cart refresh — trusting only that argument would show empty
  "Add Discount" even when a rupee discount was the one actually set.
- **Verified live:** Cash defaulted to ₹40.00 on a ₹45 item with a ₹5
  flat discount applied via the new ₹ toggle (net ₹40 correctly, "Add
  Discount" showed "Additional ₹5.00 discount applied"); selecting UPI
  and entering ₹5 correctly dropped Cash to ₹35.00 with Paid Amount
  staying at ₹40.00 (matching grand total, not overshooting to ₹45).
  Completed the order — ACC-PSINV-2026-00027 submitted cleanly, printed
  bill shows TOTAL ₹40.00, Paid ₹40.00, no GST lines (both this fix and
  the earlier same-day GST removal holding together correctly).
- **Core or app-only:** custom-app only — two new `app_include_js`
  files, no core file touched, no new doc_events.
- **Could this go further:** yes — the split logic always tops up
  whichever mode is flagged `default` in the POS Profile (Cash here);
  if a shop ever wants a different mode to be the "absorb the
  remainder" one, that'd need to be a setting rather than hardcoded to
  `default`. The discount toggle also doesn't validate a rupee discount
  against the cart total (e.g. entering more than the net total) the
  way the percentage mode validates against 100% — core's own
  `discount_amount` field doesn't validate that either, so this matches
  existing behavior rather than being a new gap.

## 2026-07-31 — Modern retail POS billing workflow overhaul

- **Original problem:** six issues raised together, framed as "redesign
  this entire billing workflow to feel like a modern retail POS": (1)
  clicking Preview after a sale, then pressing Back, immediately dropped
  the cashier into "New Sale" with no way back to the bill just made;
  (2) editing a line item's price required a heavy multi-field side
  panel, not a direct click on the price; (3) discounts only existed at
  the whole-bill level, and only as a percentage; (4)/(5) rate/discount
  editing turned out to be OFF entirely — for every user, not just
  restricted to admins; (6) a product not yet in the system forced
  leaving the billing screen to create it via the full Item form.
- **Alternatives considered:**
  1. For (1) — keep "Complete Order" as an immediate final submit and
     just fix the Preview button's navigation — rejected: the request
     explicitly asks to "make changes before finally completing the
     sale," which needs actual pre-submit editability, not just a safer
     Preview button.
  2. For (2) — extend the existing "Item Details" side panel to make its
     Rate field more prominent — rejected: the panel shows 8 fields
     (qty, uom, rate, discount_percentage, warehouse, actual_qty,
     price_list_rate, conversion_factor) for what's usually a one-field
     edit; the ask was specifically "no need for a separate pencil/edit
     icon," i.e. a faster, narrower surface, not a rearranged version of
     the same wide one.
  3. For (3) — route the new line-item discount through
     `cur_pos.on_cart_update` (the same call the numpad/side-panel use)
     — tried first, silently did nothing: traced live to
     `on_cart_update`'s `is_current_item_being_edited` gate, which only
     passes when the Item Details panel is the thing currently open for
     that exact row. This inline editor deliberately never opens that
     panel, so the gate always failed. Fixed by calling the two lines
     `on_cart_update` itself calls once the gate passes
     (`frappe.model.set_value` + `update_cart_html`) directly instead.
  4. For (6) — a fully custom item-creation dialog + duplicate search
     endpoint — rejected: `erpnext.utils.create_new_doc` /
     `frappe.ui.form.make_quick_entry` exist for this, but ask for far
     more fields (weight, brand, min order qty, HSN, tax template...)
     than a counter sale needs; built a minimal purpose-built create
     path instead, mirroring `get_or_create_customer_by_phone`'s
     already-proven pattern.
- **Chosen solution — six new `app_include_js` files, no core edits:**
  - `pos_review_before_finalize.js`: reassigns
    `cur_pos.payment.events.submit_invoice` (a plain object property set
    once in `pos_controller.js init_payments()`, not a prototype method
    — patched on the already-constructed singleton via polling for
    `cur_pos.payment` to exist, rather than prototype-patching a class
    that doesn't apply here) so "Complete Order" now does `frm.save()`
    (draft) and shows a Review Bill dialog — embedded PDF preview (via
    the same `get_invoice_pdf_base64` endpoint QZ printing already
    uses, as a `data:` URI iframe — no window/tab involved at all),
    "← Back to Bill" / "Continue Editing" (both just call the existing
    `payment.edit_cart()` — genuinely re-opens the still-draft, still-
    editable invoice), "Print", "Download PDF" (Blob + `<a download>`,
    no `window.open`), "Share on WhatsApp" (shown only when a mobile
    number is on file), a native dialog × for "Close", and a clearly
    distinct primary "Complete Sale" that's the only thing that actually
    calls `frm.savesubmit()`.
  - `post_sale_popup.js` (existing file, fixed in place): its own
    Preview/Save PDF buttons switched from `window.open(url, "_blank")`
    to the same base64-PDF-Blob approach — root cause of the original
    bug, confirmed live in THIS session's own Browser pane
    (`tabs_context` showed no second tab was ever created after
    clicking Preview, meaning `_blank` was silently coerced into the
    same tab): that turns "open a preview" into a full navigation away
    from the POS single-page app, and pressing Back then force-reloads
    `/app/point-of-sale`, booting a brand-new invoice whose `onload`
    hook (`pos_customer_capture.js`) immediately shows "Who's this sale
    for?" — exactly the reported symptom.
  - `pos_line_item_edit.js`: clicking a cart row's price (event
    delegation on the `.item-rate-amount` element, capture-phase —
    bubble-phase `stopPropagation` was tried first and didn't work: the
    native row-click handler is delegated on `$cart_items_wrapper`,
    CLOSER to the target than any bubble-phase listener on `document`,
    so it fired first regardless; capture phase runs top-down before
    that, so stopping it there actually pre-empts the native handler)
    opens a compact 2-field inline editor: Rate, and Discount defaulting
    to ₹ with a %/₹ toggle (confirmed live: a first version's ternary
    for the default mode was inverted, defaulting to % — fixed to always
    start at ₹ unless a % discount is already the active one on that
    row, per "cashiers usually negotiate in rupees, not percentages").
  - `pos_quick_create_item.js`: wraps `render_item_list` to show a
    "+ Create New Item" affordance when a search returns nothing —
    which needed its own fix first: core's `get_items()`
    (`point_of_sale.py`) returns `{"items": [...]}` when its SQL query
    finds rows but a BARE `[]` when it finds none (read directly in
    source, lines 141/197/255) — `filter_items`'s
    `const { items } = message` destructure then silently gets
    `items = undefined` for the zero-results case, and the ORIGINAL
    `render_item_list`'s `.forEach` throws on that before this wrapper's
    own empty-state code ever runs. Coerced to an array in the wrapper
    rather than patching core. The create dialog (Name, Selling Price
    required, Category/Unit/Barcode optional, per the request) also
    needed an HSN/SAC field added beyond that original list — not
    optional in effect, since this shop already runs with
    india_compliance's HSN validation on
    (`GST Settings.validate_hsn_code`, `min_hsn_digits = 6`, confirmed
    via `bench console`) and item creation hard-fails without it; left
    optional in the UI (a cashier quick-adding an item mid-sale often
    won't know it) rather than inventing a fake code to dodge a real GST
    requirement — leaving it blank reproduces the same error the shop
    would get creating this item any other way. New server function
    `quick_create_item()` (`api.py`) creates the Item as `is_stock_item
    = 0` deliberately: this shop's `Stock Settings.allow_negative_stock`
    is off, and a brand-new item has zero stock on hand, so a
    stock-tracked item would fail the exact same negative-stock check
    immediately on being added to the cart — defeating "should be
    automatically added to the current bill." Also creates a matching
    `Item Price` record (POS reads price from Item Price, not
    `Item.standard_rate`, confirmed by reading `get_items()`).
  - Items 4/5 (rate/discount editing restricted): turned out to be a
    single POS Profile misconfiguration, not code — `allow_rate_change`
    and `allow_discount_change` were both `0` (confirmed via `bench
    console`), gating BOTH the native Item Details panel's fields
    (`pos_item_details.js` sets `read_only = !allow_rate_change` etc.)
    and the new inline editor uniformly for every user of this profile,
    not per-role — flipping both to `1` was the entire fix. Separately
    confirmed by reading `taxes_and_totals.js`/`transaction.js`: no
    rate/discount edit path anywhere in POS ever writes back to
    `Item.standard_rate` or creates/modifies a Pricing Rule — edits are
    child-table-row-scoped by construction, not something this session
    added a guarantee for.
- **Verified live, full loop:** ₹45 item → Complete Order → draft-saved
  Review Bill dialog (valid embedded PDF confirmed via
  `data:application/pdf;base64,JVBERi0xLjQK...`, the real PDF magic
  bytes) → "Back to Bill" → added a second ₹185 item (proving the
  invoice was still genuinely a draft, not display-only) → Checkout
  again → Review Bill reopened at ₹230 → "Complete Sale" →
  ACC-PSINV-2026-00029 submitted → native post-sale popup and Order
  Summary both correctly show ₹230.00 → clicked Preview from THAT popup
  too (post-submit path) → in-page dialog, `tabs_context` confirmed
  still exactly one tab open → New Order correctly starts a fresh bill.
  Line-item editing verified separately: direct rate override (₹45→₹42)
  and ₹5 flat discount (₹45→₹40) both applied and recalculated
  correctly. Quick-create verified: "Godrej Door Handle" created with a
  real HSN (autocomplete against `GST HSN Code` confirmed working),
  auto-added to the cart at ₹150, and confirmed searchable again
  afterward (persists for future bills, not just this one).
- **A real bug hit and fixed along the way:** `frm.save()` called on an
  already-saved, non-dirty POS Invoice hangs forever — never resolves,
  never rejects, no network request fires at all (confirmed by direct
  console testing). Core's own `save_and_checkout()`
  (`pos_controller.js`) already guards this exact call with
  `frm.is_dirty()` for this reason; `pos_review_before_finalize.js`
  matches that guard rather than re-discovering the hang as a fresh
  mystery next time.
- **Core or app-only:** custom-app only — five new `app_include_js`
  files, one existing one edited in place (`post_sale_popup.js`), one
  new whitelisted `api.py` function, one POS Profile config change (two
  checkboxes). No core file touched.
- **Could this go further:** yes — the Review Bill dialog's PDF preview
  needs a real PDF-capable viewport to see (this session's own testing
  Browser pane doesn't render inline data-URI PDFs, confirmed via the
  file's magic bytes instead); "Close" on the Review Bill dialog and
  "Back to Bill"/"Continue Editing" are all currently the same action
  under different labels, matching the request literally rather than
  inventing three distinct behaviors that aren't obviously needed yet;
  the quick-create dialog doesn't fuzzy-match against existing items
  first (a cashier could still accidentally create "Fevicol SR 998" as
  a near-duplicate of "Fevicol SR998"), same class of gap already noted
  for the customer-capture dialog earlier this project.

---

## TEMPLATE FOR NEW ENTRIES

```
## YYYY-MM-DD — Screen/workflow name

- **Original problem:**
- **Alternatives considered:**
  1. ... — rejected because ...
  2. ... — rejected because ...
- **Chosen solution:**
- **Before/after:** (screenshot or precise description)
- **Measurable improvement:**
  ```
  Old: X clicks · Y dialogs · Z fields · Ns
  New: X clicks · Y dialogs · Z fields · Ns
  ```
- **Core or app-only:** (and `CORE_PATCHES.md` entry if core)
- **Could this go further:** (name it even if out of scope now)
```
