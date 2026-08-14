# UX_STRATEGY.md — Santu Hardware
### Complete UX Strategy, User Journeys, Workflow, Screen Hierarchy, Product Vision

> **STATUS: §§0-8 APPROVED & IMPLEMENTED 2026-07-31** (see `ROADMAP.md`
> Phase 2). §§10-13 (billing simulation test plan, invoice/printing,
> Continuous Improvement process, loyalty program) still **design/research
> only**. **§9 (Branding & Design System) is now being implemented as of
> 2026-07-30** — see `ROADMAP.md` "Phase 2.5 — Foundation & Critical-
> Workflow Redesign" for the exact build sequence, driven by the 2026-07-30
> policy change: this is now a long-term commercial product ("Santu
> Hardware ERP"), core ERPNext/Frappe modification is allowed where it
> genuinely improves UX (`ERP_MASTER_PROMPT.md` §8.1), and the benchmark is
> Apple/Shopify POS/Square/Google Pay/WhatsApp — not ERPNext's own defaults.
> Companion to `UI_GUIDELINES.md`.

---

## 0. PRODUCT VISION

Santu Hardware's software is not an ERP with a friendlier skin. It is retail
software that happens to be *built on* ERPNext for reliability, the way a
modern car happens to run on an engine the driver never thinks about. Every
screen is judged by one test: **can a Class 7 student learn and use it
within 10 minutes?** If a screen makes anyone feel like they're "doing
enterprise software," that screen has failed — regardless of whether the
data underneath is correct.

---

## 1. USER JOURNEYS — every role, from first principles

Six roles were named. One of them (Future Employee) turned out not to need
its own screens — see why below. For the other five: what they want, what
they don't need, what slows them down, what causes mistakes, what should
just happen automatically.

### 1.1 Shop Owner (Santu / family)
- **Goal:** Know the business is healthy without digging for it; step in to
  bill or override when needed; make the decisions only an owner should make.
- **Needs:** Today's sales/profit at a glance, low-stock alerts, outstanding
  dues, cash position — pushed to them, not queried by them.
- **Doesn't need:** Row-by-row transaction browsing during a normal check-in;
  cashier-level minutiae unless actively investigating something.
- **Slows them down:** Having to remember to go check something. The right
  design makes the business tell the owner what needs attention, not the
  other way round.
- **Mistakes to prevent:** Missing a stockout until it costs a sale; not
  noticing a customer's outstanding balance growing; losing track of margin
  erosion from repeated price overrides.
- **Default landing:** Dashboard — big numbers, minimal navigation, Privacy
  Mode toggle prominent since the Owner is the one who unlocks it.

### 1.2 Cashier / Counter Staff
- **Goal:** Bill correctly, as fast as possible, with effectively zero training.
- **Needs:** Search, cart, selling price, payment, print. That's the entire job.
- **Doesn't need:** Buying price, margin, ledger accounts, warehouse
  selection, any settings screen, a customer's full history — at most a
  name/phone and an outstanding balance if it's a credit sale.
- **Slows them down:** Any field that isn't strictly required for *this*
  sale. Confirmation dialogs for routine, reversible actions. Needing to
  remember a keyboard shortcut nobody taught them.
- **Mistakes to prevent:** Wrong item picked among visually similar
  products (paint sizes/colors); wrong unit (Box vs. loose piece); an unpaid
  balance that isn't obvious on-screen or on the printed bill.
- **Default:** See §4.1 — this is the role the biggest new idea applies to.

### 1.3 Purchase Operator (whoever receives stock — often the Owner)
- **Goal:** Get delivered stock into the system accurately, fast, when the
  truck is standing there.
- **Needs:** The same search/scan component as billing (one mental model,
  less training), quantity received, buying rate, supplier.
- **Doesn't need:** ERPNext's default 3-document chain (Purchase Order →
  Purchase Receipt → Purchase Invoice) — that exists for organizations with
  separate approval/receiving/invoicing teams. This shop has one person
  doing all three at once. See §4.3.
- **Slows them down:** Warehouse selection when there's only one warehouse;
  being forced through a PO step for a delivery that already physically arrived.
- **Mistakes to prevent:** Wrong quantity vs. what's actually on the truck;
  a buying price entered as a typo (e.g. an extra zero) silently wrecking
  margin — worth a soft warning when a new buying price is far from the last
  one, not a hard block.

### 1.4 Inventory Manager (usually the Owner, wearing a different hat)
- **Goal:** Know what's low before it's a problem; fix stock miscounts
  without ceremony.
- **Needs:** A proactive low-stock list, a lightweight stock-correction
  flow, an item's history when investigating something specific.
- **Doesn't need:** Multi-warehouse transfer logic — single shop, single
  warehouse, no transfer workflow needed at all right now.
- **Slows them down:** ERPNext's Stock Reconciliation form is built for
  bulk enterprise recounts (many fields, many items at once) — using it to
  fix "we broke two of these" is using a forklift to move a chair.
- **Mistakes to prevent:** A stock adjustment made with no reason recorded —
  cheap to require (one dropdown: Damage / Theft / Count Correction / Other),
  expensive to skip (nobody remembers why stock dropped three months later).

### 1.5 Accountant
- **Goal:** Books are accurate and GST-return-ready; no re-keying.
- **Needs:** GST summary, expense log, receivables/payables — all computed
  automatically from what billing/purchase already posted.
- **Doesn't need:** Any billing/purchase UI at all — pure read/report consumer.
- **Honest note:** for a business this size, this role may not be a distinct
  *daily* persona at all — it might just be the Owner once a month, or an
  external CA who visits periodically. Not designing dedicated daily screens
  for a role that might not show up daily — that would be optimizing for a
  feature, not a real need, which is exactly what was asked not to do.
  Revisit if a real second person takes this on.

### 1.6 "Future Employee" — collapses into testing the Cashier design
A new hire in year 3 needs the software to be self-evident within one
shift. That's not a 6th set of screens — it's a **test of whether §1.2's
design actually holds up** for someone with zero context. If the Cashier
journey passes the 10-minute test for a total stranger, this role is
already served. Treating it as a separate persona would have meant
designing the same screens twice.

---

## 2. A DAY IN THE LIFE (unchanged from the first pass, still the grounding narrative)

Opening: one person, one number (starting cash), the register is "on."
Through the day: the same loop repeats hundreds of times — customer names a
product, cashier finds it, price sometimes gets adjusted, payment is mostly
cash, bill prints, screen is ready for the next person within seconds —
interrupted constantly by stock-check questions, Udhaar payments with no
items involved, a delivery arriving mid-afternoon, a contractor's larger
order. Closing: cash count against system total, the one moment of the day
where a silent mismatch is genuinely stressful.

**The number that should drive every design decision:** one screen
(billing) gets used hundreds of times a day; everything else gets used a
handful of times. Visual weight and speed budget should follow that ratio —
right now, per §5's findings, it doesn't.

---

## 3. CORE DESIGN PRINCIPLES (unchanged, still the test for every decision below)

One dominant action per screen · barcode/keyboard first, mouse optional ·
no modals for routine, reversible actions · mistakes should be cheap, not
confirmed · progressive disclosure (advanced stuff one tap away, never
default-visible) · big obvious colorful feedback · role-aware defaults.

---

## 4. CHALLENGING EVERY ASSUMPTION — including my own earlier ones

This is where "forget ERP patterns" actually gets applied, not just stated.

### 4.1 Biggest idea: there is no "New Bill" button

ERPNext's mental model is "create a new document." A modern POS's mental
model is "the register is open and ready" — there's no discrete moment of
*starting* a sale, because the screen is *always* mid-readiness for one.

**Proposal:** for the Cashier role, the software's resting state — what's on
screen the instant nothing else is happening — simply *is* an empty bill,
cursor in the search box. Finishing a sale doesn't navigate anywhere; it
just clears back to that same resting state. This removes one click,
repeated hundreds of times a day, and removes a decision ("do I need to
press New Bill first?") that a brand-new employee currently has to be taught.

This directly contradicts the Shop Mode home screen I already built in
Phase 2 (8 buttons, New Bill among them, tapped every time). I'm not
quietly walking that back — flagging it explicitly: **the Owner role
probably still wants the 8-button hub as their landing screen (they're not
billing 200 times a day), but the Cashier role likely shouldn't see a menu
before billing at all.** This is the same role-based-landing idea from the
last round, sharpened: it's not just "which screen loads first," it's "does
this role even have a concept of 'navigating to' billing, or is billing
just where they always are."

### 4.2 Login shouldn't mean typing a password every shift — but it can't mean no attribution either

Considered: one shared Frappe login for the whole shop, since
`BUSINESS_RULES.md` §1 describes single-shop, single-session use — this
would remove password friction entirely.

**Rejected, and here's why I caught it myself:** `BUSINESS_RULES.md` §3.4
requires every price override to log *who* changed it. A shared login
makes that attribution meaningless — the log would say "Administrator" did
everything, forever. Convenience would have silently broken an already-
committed business rule.

**Better alternative:** a "who's on shift" tile-tap selector at the start of
a shift (large name tiles, tap yours, no password) instead of full
email+password login. Keeps per-person attribution for the price-override
log while removing the actual friction (typing credentials), which was
never really about the password, it was about the *typing*.

### 4.3 Purchase: one step, not three

ERPNext's Purchase Order → Purchase Receipt → Purchase Invoice chain exists
for organizations where different people request, receive, and pay. Here,
one person does all three the moment the truck arrives. Proposal: a single
"Record Purchase" screen (posts as a Purchase Invoice directly), skipping
the PO/Receipt formality entirely for this shop's actual buying pattern —
not a UI simplification bolted onto the 3-document flow, but skipping two
of the three documents altogether. The multi-document chain stays available
in Admin Mode for the rare case it's ever needed (a real future PO with a
supplier), it's just never the default path.

### 4.4 Walk-in customers should stay genuinely anonymous

Considered: auto-create a "Walk-in" Customer record per sale for
consistency. Rejected — that's the ERP instinct (everything should be a
record), not the shop's actual need. A truly anonymous cash sale doesn't
need a Customer record at all; only create one when there's an actual
reason (credit, a phone number worth keeping for follow-up, a regular/
contractor price tier). Keeps the Customer list meaningful instead of
filling with thousands of identical "Walk-in" rows that answer no question.

### 4.5 Stock correction deserves its own tiny flow, separate from Purchase and separate from ERPNext's Stock Reconciliation

"We broke two of these" and "a new delivery arrived" are different mental
events (one has no supplier/price attached, one does) but ERPNext's native
tools either force the heavy Reconciliation form or misuse Purchase for
something that isn't a purchase. Proposal: a small dedicated "Fix Stock"
action — item, quantity change, reason (dropdown) — nothing else.

### 4.6 What I'm *not* changing, on purpose

The Shop Mode / Admin Mode split stays — it's already the right mental
model (`UI_GUIDELINES.md` §1) and challenging it further would be change
for its own sake, not improvement. Native GL posting, stock ledger, GST
calculation stay completely untouched — only presentation changes, per §6's
Decision Matrix from the previous round.

---

## 5. WHAT TESTING THE ACTUAL BUILT UI FOUND

Screenshotted the live Shop Mode and Point of Sale screens rather than
reasoning about them in the abstract. Verdict: **structurally correct,
does not yet pass the Class 7 test.** Concrete, not vague:

| # | Finding | Why it matters |
|---|---|---|
| 1 | Full Frappe Desk chrome visible on both screens — generic "E" logo, command-palette search, notification bell, user avatar | None of this belongs in front of a cashier; it's the strongest visual signal that this is "enterprise software" |
| 2 | Page literally titled "Point of Sale" with breadcrumb "Accounting" | The underlying platform's vocabulary leaking straight through — a cashier should never read the word "Accounting" |
| 3 | Placeholder text visibly clipped — "Search by item cod[e]", "Select item g[roup]", "Search by customer name, phone," | Reads as broken, not just unfinished |
| 4 | The "···" menu mixes "Toggle Recent Orders" (genuinely useful) with "Close the POS" (ends the whole shift session) and "Open Form View" (raw ERPNext doc editor) — all at equal visual weight | A tired cashier could end their register by mis-tapping a menu item that should never have been one flat list |
| 5 | Shop Mode's 8 buttons are all identical size | Directly contradicts §2's "New Bill used ~100x more than Settings" — the screen itself hasn't caught up to the plan yet |
| 6 | No persistent status anywhere — no register-open indicator, no "who's billing," no Privacy Mode lock state | Forces the cashier to hold state in their head that the software should be holding for them |
| 7 | Generic Frappe-blue "Checkout" button | No visual identity of its own — same blue as every other Frappe app |

This list is the concrete implementation backlog once the UX architecture
is approved — not new design work, just the gap between what was planned
and what actually got built.

---

## 6. RE-SKIN, DON'T REBUILD (Decision Matrix, unchanged from previous round)

Keep native POS as the engine — correct tax/stock/accounting already, and
rebuilding it would be exactly the unnecessary complexity the Golden Rule
warns against. Aggressively re-skin the presentation layer through the
santu_hardware app's CSS/JS hooks (zero core file changes, upgrade-safe):
strip Desk chrome, rename ERP vocabulary to shop vocabulary, restructure
the "···" menu by risk level, enlarge everything, collapse checkout to the
one-click common case.

---

## 7. SCREEN-BY-SCREEN, UPDATED WITH §4's IDEAS

**Billing** — resting state for Cashier role (§4.1), not a button press.
Barcode match = instant add, zero clicks. Cart lines: large item name,
inline qty/price/unit, no delivery/loading charges visible until asked for.
Payment: Cash pre-selected, tendered-amount quick buttons with auto change
(still an open question from last round). Credit/Udhaar: one tap, no math
required of the cashier. Print/WhatsApp, then instant reset — cursor back
in search, no confirmation step.

**Shift start** — tile-tap "who's billing" (§4.2), not email+password.
Register opening reduced to one number.

**Purchase** — single "Record Purchase" screen (§4.3), same search
component as billing.

**Stock correction** — separate tiny "Fix Stock" flow (§4.5): item, quantity
change, reason. Not Purchase, not full Stock Reconciliation.

**Customer** — Walk-in stays anonymous by default (§4.4); named customers
only created with a reason. Udhaar payment collection lives here (search
customer → see balance → collect), not as a 9th Shop Mode button.

**Dashboard / Reports** — Owner-facing, pre-built glanceable cards, not
ERPNext's raw report builder.

**Closing** — cash count vs. system total, large unmissable match/mismatch
indicator.

**Expenses** — same quick-add pattern as customer creation: amount +
category + one tap.

---

## 8. IMPLEMENTATION STATUS (as of 2026-07-31)

All of §4.1-§4.5 and every §5 finding: **approved and built.** See
`ROADMAP.md` Phase 2 for the checklist and `DATABASE_RULES.md` §4 for the
new DocType/Role/custom-field inventory this produced.

Verified two ways, not just visually: as a dedicated `Cashier` account (no
System Manager) and as Administrator/Owner — the two needed different
behavior (billing-as-resting-state only for Cashier) and testing caught a
real bug where Administrator's implicit all-roles status was triggering the
Cashier redirect too, fixed before it would have blocked Owner navigation.

**Still open, deliberately deferred, not blocking:**
- Tendered-amount quick cash buttons — nice-to-have, not essential to a
  working billing loop.
- Thermal/A4 print formats — needs real Item Price data from Phase 1's
  catalog entry to be meaningfully testable.
- Fix Stock isn't on the Shop Mode 8-button grid — reachable via Desk
  search for now; revisit if Inventory Manager usage shows it needs
  faster access.

---

## 9. BRANDING & VISUAL IDENTITY — DESIGN SYSTEM v1

**Not implemented yet.** The problem with what's live today isn't the brand
color itself (indigo `#3730a3` against white already measures well above
AA contrast for the buttons it's used on) — it's that nothing *else* has a
deliberate system: borders are Frappe's default light gray at low contrast
against white cards, there's no defined type scale (headings and totals use
whatever size the underlying Frappe element happened to have), and cards
are flat-bordered rather than having the soft elevation that reads as
"premium" rather than "default admin panel."

**Proposed system:**

**Neutrals** (replacing ad-hoc `var(--border-color, #d1d8dd)` references
scattered across the CSS with one deliberate scale):
`--santu-gray-50: #F9FAFB` (page background) · `--santu-gray-100: #F3F4F6`
(card hover) · `--santu-gray-200: #E5E7EB` (borders) · `--santu-gray-500:
#6B7280` (muted text) · `--santu-gray-900: #111827` (primary text).

**Brand & semantic** (semantic meanings unchanged from `UI_GUIDELINES.md`
§4.3 — this only makes the exact values deliberate instead of inherited
Frappe defaults): Primary `--santu-brand: #3730A3` / hover `#2C2483`
(kept, already tested). Success `#15803D`. Danger `#B91C1C`. Warning
`#B45309`. Each chosen to hold AA contrast on both white and the new
`--santu-gray-50` background.

**Typography scale** (all existing UI_GUIDELINES §4.1's "16px body
minimum" is a floor, not a ceiling — this fills in everything above it):
Display `32px/700` (Grand Total, the single number a cashier's eye should
land on first) · H1 `24px/700` (page titles — "New Bill," "Fix Stock") ·
H2 `18px/600` (section headers) · Body `16px/400` · Label `13px/600`,
uppercase, letter-spaced (status bar, meta text). Prices use tabular
figures so a column of amounts aligns visually.

**Spacing scale:** `4/8/12/16/24/32/48/64px` — mostly already what's in
use (the Shop Mode grid already uses 24/40px), formalizing it as a named
scale rather than case-by-case numbers so future screens stay consistent.

**Elevation:** cards move from a flat `1px solid border` to a soft shadow
(`0 1px 3px rgba(0,0,0,0.08)`) with a much lighter border, the visual
language most "modern POS" products actually use — a border alone reads as
a form; a shadow reads as an object sitting on a surface.

**Branding visibility:** "Santu Hardware" currently appears as plain text
in the Shop Mode header and as a colored pill on the POS screen. Proposal:
a consistent small wordmark/icon treatment (not necessarily a designed
logo — a simple monogram mark, e.g. a colored square with "SH", in the
brand color) used in both places plus the browser tab favicon, so the
brand is recognizable at a glance rather than read as text.

This is a systemic CSS pass across `shop_mode.css`/`kiosk_mode.css`
(extending, not replacing, what's already built) — sizeable enough that it
should be reviewed as a design before touching code, per the standing
instruction.

---

## 10. COMPLETE BILLING SIMULATION — TEST PLAN

**Blocked, not yet runnable.** This needs two things that don't exist yet:
real Product Master catalog data (Phase 1, still not implemented — see
`ROADMAP.md`) and a working print format (§11 below). Defining the test
plan now so it's ready to execute the moment those exist, rather than
improvising it later.

**Plan:** one demo customer (clearly marked as a test/demo record, same
practice as every throwaway test record this session — created, used,
then either kept if genuinely useful or deleted, never left ambiguous
about being real vs. fabricated data) buying **10+ different products**
spanning at least 4 categories (e.g. 2 paints, 2 pipe fittings, 2
electrical items, 2 fasteners, 2 sanitary items) at realistic Indian retail
prices. The test verifies, line by line:
- Correct GST/HSN rate applied per item (not a flat rate assumed for all).
- At least one inline price override (BUSINESS_RULES.md §2.2 — routine,
  not exceptional) and one line using a non-base UOM (e.g. 1 Box, not
  loose pieces) to prove the conversion factor posts correctly.
- Bill-level total, tax breakup, and rounding all correct.
- Stock levels for every line item decrease by exactly the right amount
  post-submit (checked via Bin/Stock Ledger Entry, not just visually).
- A split payment (part cash, part UPI) to prove the payment table handles
  more than the single-mode common case.
- Printed output (once §11 exists) contains no buying price/margin
  anywhere, per `CODING_STANDARDS.md`'s testing checklist.

This is an end-to-end user-experience test, run through the actual browser
UI as a cashier would, not a backend script — matching how every other
piece of Phase 2 was verified this session.

---

## 11. INVOICE & PRINTING EXPERIENCE

**Decision Matrix:**

| Question | Answer |
|---|---|
| Does ERPNext already support this? | Mostly yes — native Print Format system, native PDF generation, a POS Invoice print format already ships, and Frappe's Print Format doctype has a native `raw_printing`/`raw_commands` mechanism for direct ESC/POS thermal output (verified in the doctype schema, not assumed) |
| Reuse vs. build? | Reuse the entire print/PDF engine. The only genuinely new pieces: a Santu-branded print format (buying price stripped, verified), and automatic date-folder PDF archiving — neither exists natively |
| Complexity | Low for the print formats (configuration, not code); Low-Medium for date-folder archiving (one small hook) |
| Upgrade risk | None — Print Formats are data, the archiving hook is pure custom-app code |
| **Recommendation** | Build both, small and native-first |

**Thermal (Epson) — recommended path:** install Epson's official macOS
driver, register the printer normally in System Settings (same as any
other printer), create one Santu-branded Print Format sized for 80mm paper
(Print Format's "Custom" page-size option supports this natively), and
print via the existing native "Print Receipt" action in POS with that
format set as the POS Profile's default — the browser's print dialog
targets the thermal printer like any registered printer. This is the
*simplest* reliable path (zero new infrastructure, standard OS printing).
Frappe's `raw_printing`/ESC/POS mechanism is a genuine native upgrade path
if the simple approach proves too slow or unreliable in daily use — not
building it preemptively, since that would be solving a problem that
hasn't been observed yet (Golden Rule).

**A4:** a second Print Format on the same document (Sales/POS Invoice
already natively supports multiple Print Formats — picking one at print
time is a dropdown, not new mechanism), for contractors/bulk customers
who want a formal full-page document.

**PDF save + date-wise folders:** not native — needs one small hook: on
invoice submit, generate the PDF via Frappe's existing `get_pdf()` and
write it to `~/Santu Hardware Invoices/<Year>/<Month>/<Day>/<Invoice No>.pdf`.
Single responsibility, one function, justified since no native equivalent
organizes by date on the filesystem (Frappe's own File/attachment system
keeps everything in one flat per-document space, not a browsable folder
tree).

---

## 12. CONTINUOUS IMPROVEMENT PROCESS

Ongoing practice, not a one-time deliverable: while implementing anything
from here on, actively flag (and fix immediately if safe/small) UI
inconsistencies, extra clicks, confusing layouts, and performance issues
encountered along the way — not just the specific feature being built.
Tracked in **`IMPROVEMENT_LOG.md`** (new file, companion to this doc),
which already has real entries from this session's work, not starting
empty — every bug found and fixed while building Phase 2 (the loyalty
program SQL bug, the `expense_account` field-name trap, the Administrator
implicit-role bug, etc.) is logged there in Problem → Solution → Future
Idea format, cross-referenced with `PROJECT_STATUS.md` §5 where they
overlap.

---

## 13. CUSTOMER LOYALTY PROGRAM

**Decision Matrix:**

| Question | Answer |
|---|---|
| Does ERPNext already support this? | **Yes, fully** — verified against source, not assumed. `Loyalty Program` doctype (tiers, earn-rate collection rules, auto-opt-in), `Loyalty Point Entry` (per-transaction ledger), automatic point crediting on Sales/POS Invoice submit |
| Does it handle returns automatically? | **Yes** — a Sales Return against an invoice deletes and regenerates that invoice's point entry with the returned amount subtracted (`sales_invoice.py::make_loyalty_point_entry`) — genuine automatic reversal, confirmed in code, nothing to build |
| Customer ID via Name + Phone? | Already native — `Customer.mobile_no`, and POS's own customer search already searches "name, phone, email" (seen directly in the running UI) |
| Complexity to configure | Low — this is data/configuration (one Loyalty Program record with an earn rate), not code |
| **Recommendation** | **Configure the native feature. Do not build anything custom.** |

**Design:** Single Tier to start (Multiple Tier adds complexity — different
earn rates per spending threshold — with no stated need for it yet;
matches the Golden Rule, upgrade to tiers later only if a real reason
shows up). `auto_opt_in` enabled so every Customer qualifies without a
manual enrollment step, keeping it invisible/simple for both staff and
customer, per the requirement.

**Genuinely open, needs the user, not something I'll guess:** the actual
earn rate (₹ spent per point) and redemption value (₹ per point redeemed)
— this is pricing logic, exactly the category `ERP_MASTER_PROMPT.md` §3
says never to invent.

**Reconciliation — a real thing to fix before this can work correctly:**
earlier this session, `Customer.set_loyalty_program()`'s auto-detection
query (`get_loyalty_programs()`) hit a pre-existing ERPNext SQL bug that
broke every Customer save. It was patched to always return `[]` — the
right call at the time (loyalty wasn't wanted yet, and that unblocked
Customer creation entirely). **That patch now needs to be upgraded**, not
just left in place: as written, it will silently prevent auto-opt-in from
ever working, even once a real Loyalty Program exists, because it always
reports "no programs found" regardless of what's configured. The fix is
small (a corrected version of the same lookup, done in Python instead of
the malformed raw-SQL-filter-key approach, since the Loyalty Program table
will only ever hold a handful of rows for a single shop) — flagged here,
not fixed now, since implementation waits for the go-ahead.
