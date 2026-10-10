# UI_GUIDELINES.md — Santu Hardware
### Shop Mode Design, Dashboard, Design System

> Companion to `ERP_MASTER_PROMPT.md`. The UX Rules in the master file (one click →
> zero clicks, etc.) apply to everything below.

---

## 1. TWO MODES

- **Shop Mode** — what staff sees daily. 8 large buttons, nothing else.
- **Admin Mode** — full ERPNext Desk, owner-only, rarely opened.

Daily staff should never need to see raw ERPNext DocType lists, module lists, or
Desk navigation. If a staff member is in Admin Mode, something in the design has
failed — the goal is that they never need to go there.

### 1.1 Shop Mode home screen

```
🧾 New Bill (full width)
📦 Purchase   👤 Customer      🔍 Product Search  📊 Dashboard
📋 Reports    💰 Expenses      🔒 Close Counter   ⚙️ Settings
```

Purchase/Expenses go straight to a fresh entry form (not a list — added
2026-07-30, matches New Bill's pattern; see `DESIGN_DECISIONS.md`). Close
Counter added 2026-07-30 — was previously only reachable via a hidden Desk
menu shortcut, not visible anywhere in Shop Mode.

Large, icon + text labeled, touch-friendly buttons. This is the first screen on
launch, always.

---

## 2. BILLING SCREEN LAYOUT PRINCIPLES

- Product entry field is the primary focus on screen load (cursor auto-focused,
  ready for barcode scan or typing).
- Line items list directly below, each row inline-editable (qty, price, discount,
  delete) — no modal, no separate page, per `BUSINESS_RULES.md` §2.2.
- Payment and print/send actions clearly separated at the bottom — always visible,
  never requiring scroll on a normal-length bill.
- Privacy Mode toggle/indicator small and unobtrusive when locked, clearly visible
  when unlocked (so staff always know the state).

### 2.1 Item entry order and scrolling (hard rule, 2026-09-21)

Applies to EVERY screen where items are added to a document — Billing (POS),
Estimate/Quotation, Sales Return, Purchase Return, Sales Order, Delivery Challan,
Purchase Bill, Purchase Order:

1. **New lines are appended at the BOTTOM**, in the order they were entered — the
   bill reads the way it was billed, on screen and on paper. (A "newest on top"
   variant was tried on 2026-09-21 and rejected the same day by Ankit.)
2. **The item just added must be in sight without touching the scrollbar.** After
   every add the screen brings that row into view by itself — the operator never
   scrolls to find what they just added.
3. **The item search box stays on screen** (`position: sticky; top: 0`) while the
   list grows, so the next item never requires scrolling back up either. Adding a
   row must leave both the new row AND the search box visible.
4. **Adding an item must not move the view up and down.** Focus the search box with
   `focus({ preventScroll: true })`, and keep the row-reveal instant and single —
   no `behavior: "smooth"`, no second scroll a frame later, and cancel any pending
   reveal before starting a new one (`window.santu_scroll_row_into_view`).

---

## 3. DASHBOARD

Cards to show, in colorful, glanceable card format with small graphs where useful:

Today's Sales, Today's Profit *(Privacy Mode)*, Today's Purchase, Cash in Drawer,
Today's Expenses, Pending Payments (customer dues), Supplier Dues, Low Stock Items,
Out of Stock Items, Fast Selling Products, Slow Moving Products, New Customers,
Recent Bills, Recent Purchases, Pending Deliveries/Orders, UPI/Card/Cash Collection
Today.

Anything profit/margin-linked follows the same Privacy Mode gating as billing.

---

## 4. DESIGN SYSTEM

### 4.1 Typography
- Large, highly readable fonts. Minimum 16px body text on the billing screen.
- Product names never truncated in a way that causes ambiguity (e.g., two similar
  paint sizes must remain distinguishable).

### 4.2 Buttons
- Large, touch-friendly, icon **+ text** (never icon-only — text ensures Class 7
  readability without memorizing icon meanings).

### 4.3 Color coding
- Green = money in / profit / paid
- Red = dues / low stock / loss
- Blue = neutral actions (search, add)
- Amber/Orange = warnings (low stock, price change)

Use consistently across dashboard, reports, and alerts — color should let the owner
scan the dashboard in 5 seconds and know what needs attention.

### 4.4 Modes
- Dark Mode + Light Mode supported, defaulting to macOS system setting.

### 4.5 Spacing
- Generous padding throughout. This is a shop-counter tool, not a dense spreadsheet
  — nothing should feel cramped or require zooming in.

### 4.6 Icons
- Simple, universally understood icons only. No abstract enterprise iconography that
  requires training to interpret.

---

## 5. SCREEN-BY-SCREEN "REMOVE EVERYTHING THAT DOESN'T HELP" CHECK

For every new screen built, apply the UX Rules from the master file explicitly:

1. What is the user trying to do on this screen? (state it in one sentence)
2. List every element currently planned for the screen.
3. For each element, ask: does it help the stated goal? If not, remove or move it
   elsewhere (e.g., Admin Mode).
4. Count clicks for the primary action. Can it be reduced?

This check should be done before implementation, not after — see the Product
Decision Matrix in `ERP_MASTER_PROMPT.md` §7 for feature-level decisions; this is
the screen-level equivalent.

### 5.1 Deeper question set (added 2026-07-30) — don't stop at visual cleanup

Visual redesign alone is not enough. **If a user has to think for even 2
seconds, the interface should probably be redesigned** — the workflow
itself, not just its appearance. For every screen, ask all of these, not
just the four above:

- Can this be done with fewer clicks?
- Can this be done with fewer fields?
- Can this be done with fewer popups?
- Can this be done with fewer decisions?
- Can this be done with larger touch targets?
- Can defaults remove manual input?
- Can barcode scanning replace typing?
- Can keyboard shortcuts replace mouse movement?
- Can the next action be automatically suggested?

Optimize for shop owners, cashiers, helpers, family members, and temporary
staff — assume **zero prior ERP experience**, not "an ERP user who needs a
nicer skin." Don't hesitate to replace an entire ERPNext workflow if the
result is significantly better; the goal is the best hardware store
software, not a better-looking ERPNext.

The test for every screen (`ERP_MASTER_PROMPT.md` §2.1): **"If I were
building Santu Hardware ERP from scratch in 2026, would I build this
screen this way?"** If no, redesign it — the workflow, not just its look.
Question whether multiple pages should become one page, a form a side
panel, a table a set of cards, a dashboard an action center. Design for
touch — assume this eventually runs on a POS terminal/touchscreen.

### 5.2 Required UX review format (added 2026-07-30)

For every screen/workflow redesigned, report it in this structure (per
`ERP_MASTER_PROMPT.md` §2's milestone-reporting requirement):

1. **Problems in the original ERPNext screen.**
2. **Why users struggle** — specifically, in the terms of the actual users
   (owner/cashier/helper/temp staff), not abstract UX theory.
3. **What changed.**
4. **Time/click reduction** — concrete, e.g. "4 clicks → 1" or "reads in
   under 2 seconds now vs. required scrolling before."
5. **How it was achieved** — native configuration, custom app, or core
   modification (and if core, the `CORE_PATCHES.md` entry it corresponds to).
6. **Whether an even better design is possible** — don't present a change
   as final if a further improvement is visible but out of scope for now;
   name it so it isn't lost.

Report the click/field/dialog/decision/time reduction concretely, in the
"Old → New" format, e.g.:

```
Old: 8 clicks · 4 dialogs · 19 fields · 42 seconds
New: 3 clicks · 0 dialogs · 7 fields · 12 seconds
```

Report honestly even when the improvement is modest, or is about clarity/
decision-count rather than raw click-count — a fabricated number is worse
than an honest "clicks unchanged, but the decision to make on this screen
dropped from 3 options to 1." Every redesign also gets a full entry in
`DESIGN_DECISIONS.md` — problem, alternatives considered and why each was
rejected, chosen solution, before/after screenshots, measurable
improvement. See that file's template.

---

## 6. FUTURE: MOBILE FRIENDLINESS

Not built in Phase 1, but design choices now should not block a future mobile/tablet
companion view (e.g., owner checking dashboard from phone). Avoid layouts that only
work at a fixed desktop resolution where reasonably avoidable.
