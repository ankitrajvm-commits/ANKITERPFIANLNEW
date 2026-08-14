# Item Screen Redesign — Proposal (design only, not implemented)

**Status:** design document, no code changed. Per explicit instruction: preserve every
existing ERPNext capability, redesign discoverability/hierarchy/terminology only.

**Companion artifact:** a visual mockup of the redesigned layout was published alongside
this document — see the link shared in chat. This file is the reasoning behind it.

---

## 0. What's actually on the screen today (ground truth, not assumption)

Before redesigning anything, the current Item form was read in full
(`item.json` + `item.js`) rather than assumed from memory. The real inventory:

- **107 field definitions** across **10 tabs**: Details (26 fields), Dashboard (0 static —
  a dynamically-injected stock widget), Inventory (24), Variants (3), Accounting (8),
  Purchasing (17), Sales (7), Tax (1), Quality (3), Manufacturing (8).
- **8 child tables** (UOMs, Barcodes, Reorder Levels, Variant Attributes, Item Defaults,
  Supplier Items, Customer Items, Item Tax).
- **24 fields already have `depends_on` conditional visibility** — core already does
  progressive disclosure in places; the redesign should strengthen that pattern, not
  invent a parallel one.
- Frappe's own built-in onboarding tour for this doctype highlights exactly eight fields:
  `item_code`, `item_group`, `is_stock_item`, `include_item_in_manufacturing`,
  `opening_stock`, `valuation_rate`, `standard_rate`, `item_defaults`. That's effectively
  ERPNext's own implicit ranking of "what matters most" — strong signal, reused below.
- **The single biggest finding:** there is no persistent "current selling price" field on
  Item at all. `standard_rate` only appears while creating a brand-new item
  (`depends_on: eval:doc.__islocal`) — the instant it's saved, the field disappears from
  the form. Ongoing price lives in a separate doctype (**Item Price**), reached only via
  an "Add / Edit Prices" button buried in the Actions menu that routes to a filtered list
  view. **A shop owner today cannot see or change what they charge for a saved item
  without leaving the Item form entirely.** This is the root cause the CP/SP/Margin/Profit
  request is really asking to fix — not a labeling problem, a missing-surface problem.
- There is **no margin or profit field anywhere in core** (confirmed by grep — zero
  matches). It has to be computed client-side from whatever CP/SP resolve to.

---

## 1. The core reframe: an Overview, not a form

The present screen is a form with tabs. The redesign treats it as a **product record with
a form attached** — the same shift Shopify/Square/Lightspeed all made over the ERP-grid
era. Concretely: the page opens on an **Overview** that is not a tab at all — it's what
you see before choosing one — built from three always-visible cards. Everything else
(the existing 10 tabs) still exists, just re-grouped and demoted to "reached on purpose,"
not "scrolled past by accident."

### What the user needs first (the Overview, no clicks)
1. **Identity** — photo, name, code, category, active/disabled, track-inventory toggle.
2. **Pricing & Profit** — CP, SP, Margin %, Profit ₹, all inline-editable, live-recalculating.
3. **Stock & Availability** — on-hand qty, reorder point, unit, barcode (only shown at all
   if "track inventory" is on — reusing the existing `is_stock_item` gate, just moved up
   from tab #3 to the thing that decides what the Overview itself contains).

### What can wait (behind a tab click, but one click, not a hunt)
Description & brand, UOM conversions, supplier list, GST/HSN, quality inspection flags.

### What's rare (behind "Advanced", explicitly labeled, never silently hidden)
Multi-company accounting defaults, deferred revenue/expense, manufacturing/BOM,
variants/attributes, serial & batch tracking, customs/foreign trade, asset fields.
"Rare for a hardware shop" is not "removed" — every one of these is one section-header
click away, in the same screen, not a different menu.

---

## 2. Card 1 — Identity (replaces the top of "Details")

| Today | Redesign |
|---|---|
| `item_code` / `item_name` as two plain Data fields, no visual priority | Photo left, Item Name large and bold, Item Code as a smaller monospace line under it (both still inline-editable — same fields, `item_code`/`item_name`, just styled by role instead of form order) |
| `item_group` — a bare Link field | Rendered as a colored category pill, click to change (same field) |
| `disabled` — "Disabled" checkbox, unchecked = active (double-negative phrasing) | Reframed as a positive **Active/Inactive** status pill (same field, inverted label only — `disabled=0` shows "Active") |
| `is_stock_item` — "Maintain Stock" checkbox, mid-form | Promoted to a top-level **"Track Inventory"** toggle right in this card, because it's the one field that decides whether the Stock card exists below at all — it needs to be seen before, not discovered after, a shop owner wonders where their stock numbers went |
| `image` — hidden:1 in the JSON, set via the image-field mechanism, no visible upload affordance in the form body itself | A real photo tile with an empty state ("+ Add Photo") — same underlying field, just given an actual place to live instead of only existing as document metadata |

---

## 3. Card 2 — Pricing & Profit (the explicit ask; the new surface that doesn't exist today)

This is the card that answers "what do I sell it for and what do I make." Four numbers,
all in one row, all editable, all recalculating off each other in real time:

```
Cost Price (CP)   Selling Price (SP)   Margin %   Profit ₹
   ₹ 120              ₹ 185            35.1%       ₹ 65
```

**Field mapping (this is the part that needs real backend thought, not just a label swap):**

- **CP** shows `last_purchase_rate` when it's populated (a real, system-tracked number
  from actual purchase transactions) — falling back to `valuation_rate` when there's no
  purchase history yet, labeled "estimated" in that case so it's never presented as more
  certain than it is. `last_purchase_rate` is `read_only: 1` in core (system-set from POs)
  — for items bought outside a formal PO flow, CP would need to become directly editable
  here, which is a real behavior change from core and should be scoped as its own decision
  before implementation, not assumed.
- **SP** is the current rate on the shop's default Selling Price List — read AND written
  through the same **Item Price** record the existing "Add / Edit Prices" button already
  manages. Editing SP here transparently upserts that Item Price instead of asking the
  owner to know Item Price exists as a separate concept. This is the fix for the
  "disappears after save" problem: the persistent price now lives visibly here, always,
  whether the item is new or ten years old.
- **Margin %** = `(SP − CP) / SP × 100`. **Markup %** = `(SP − CP) / CP × 100`. These are
  genuinely different numbers and retailers use both for different reasons — the request
  named both terms ("Margin, or Markup"), so the redesign doesn't collapse them into one.
  Margin is the primary stat shown (it answers "what fraction of the sale is profit," the
  more common day-to-day question); Markup is one tap away as a labeled toggle next to it,
  not a second permanently-visible number competing for the same attention.
- **Profit ₹** = `SP − CP`, shown as a plain rupee amount alongside the percentage — the
  request asked for both, since "35% margin" and "₹65 profit" answer different questions
  (a shop owner comparing two SKUs cares about the rupee amount; comparing pricing
  strategy across a whole category cares about the percentage).
- **Editing any one of the four recalculates the others live** — type a target Margin %,
  SP updates to match; type a Profit ₹ target, SP updates to match; type a new CP, both
  Margin and Profit update against the existing SP. This is the "real-time recalculation"
  the request specifically asked for.

**Below the four numbers, a small secondary link:** "Manage price lists & bulk pricing →"
— opens the existing Item Price list view, unchanged, for the wholesale / multi-price-list
/ multi-UOM-price scenarios the four-number summary deliberately doesn't try to replace.
Nothing about multi-price-list capability is removed; it's one click further because it's
materially rarer than "what do I charge today."

---

## 4. Card 3 — Stock & Availability (only rendered if "Track Inventory" is on)

Replaces the current split between a mostly-empty "Dashboard" tab (which turned out to
contain nothing but a dynamically-injected stock-levels widget nobody would think to
click into) and the dense 24-field "Inventory" tab.

```
On Hand: 137 Nos          Reorder at: 20 Nos          Unit: Nos
[ Scan or type barcode                                        ]
Stock Ledger →   Stock Balance →   Advanced reorder rules →
```

- **On Hand** — the exact widget currently hidden inside the Dashboard tab
  (`erpnext.stock.ItemDashboard`), surfaced directly instead of requiring a tab click to
  discover it exists at all.
- **Reorder at** — today this is a full per-warehouse table (`Item Reorder`: warehouse
  group, warehouse, reorder level, reorder qty, material request type) — correct for a
  multi-warehouse operation, real overkill for a single-shop reorder point. Shown here as
  one plain number (the single-warehouse case, which is this shop's actual situation and
  probably most small retailers'); "Advanced reorder rules →" opens the full table
  unchanged for anyone who does have multiple warehouses.
- **Barcode** — given a real scan-sized input field instead of living inside a child table
  grid row, since it's a during-a-sale action, not a back-office data-entry one.
- **Stock Ledger / Stock Balance** — the two existing report shortcuts (currently toolbar
  buttons only visible once you know to look at the top action bar) surfaced as plain
  links right where the numbers they explain already are.
- Serial/batch tracking (`has_serial_no`, `has_batch_no`, and their dependent fields) stay
  exactly where core already puts the gating logic — two clearly-labeled toggles
  ("This item has serial numbers" / "This item is tracked in batches"), each with a
  one-line plain-English explanation, revealing their dependent fields only once switched
  on. Core already does the show/hide; the redesign's only change is writing the toggle
  labels in plain language and adding the one-line "why would I turn this on" explanation
  that's currently absent.

---

## 5. Tabs, reduced and regrouped around mental model, not ERP module boundaries

| Today (10 tabs) | Redesign (5 destinations) | What moved where and why |
|---|---|---|
| Details | **Overview** (not a tab — see above) + **More Details** tab | Identity/pricing/stock fields promoted to Overview; `description`, `brand`, UOM conversions stay as a genuine secondary "More Details" tab — real product info, just not needed on every glance |
| Dashboard | *(absorbed into Overview's Stock card)* | The tab itself goes away — it had no content of its own besides the widget, which now lives where it's actually useful |
| Inventory | *(absorbed into Overview's Stock card + "More Details")* | Reorder/barcode/on-hand promoted as above; shelf life, warranty period, weight fold into "More Details" (genuinely occasional-use, not hidden — just not front-row) |
| Variants | **Advanced** | Template/variant management is a real, powerful feature — and a small minority of SKUs in a hardware shop (paint colors, maybe) use it. Kept fully intact, one section-expand away |
| Accounting | **Advanced** | Multi-company account/cost-center defaults — single-company shops never touch this; multi-branch or franchise operations still reach it exactly as before |
| Purchasing | **Suppliers & Purchasing** tab | Kept as its own tab (not "Advanced") — supplier list, lead time, min order qty are genuinely everyday for a shop that reorders stock regularly; just written in plainer labels |
| Sales | *(merged: max discount → "More Details"; customer-specific pricing → Advanced)* | `is_sales_item`/`sales_uom` fold into Overview logic; customer-specific item codes are a real but rare B2B feature → Advanced |
| Tax | **Tax & Compliance** tab | Was a single-field tab ("Taxes" child table) with a technical label — kept as its own tab since GST/HSN is legally mandatory for every item in this market, but relabeled in plain language ("GST Rate Classification") instead of the raw doctype name |
| Quality | **Advanced** | Inspection-required flags — real for regulated/manufacturing shops, essentially unused by a retail hardware counter |
| Manufacturing | **Advanced** | BOM, sub-contracting — a different business model entirely from "buy and resell"; fully preserved for the ERPNext installs that do need it |

**Result: 2 always-visible tabs (More Details, Suppliers & Purchasing) + 1 compliance tab
(Tax & Compliance) + 1 single "Advanced" destination** that expands into the original six
tabs' worth of content as clearly-labeled collapsed sections — nothing removed, nothing
requires hunting through a strip of 10 look-alike tabs to find out which one has what you
need.

---

## 6. Terminology pass (ERP → retail, field-by-field, nothing renamed at the data layer)

| Core label | Redesign label |
|---|---|
| Maintain Stock | Track Inventory |
| Standard Selling Rate | Selling Price |
| Valuation Rate | Cost Price *(estimated)* |
| Last Purchase Rate | Cost Price *(from last purchase)* |
| Disabled (checkbox, unchecked=active) | Active / Inactive (status pill) |
| Default Unit of Measure | Unit |
| Min Order Qty | Minimum Order Quantity |
| Item Defaults (child table) | *(inside Advanced)* Accounts & Warehouses by Company |
| Has Batch No / Has Serial No | "Tracked in batches" / "Has serial numbers" + one-line explanation |
| GST HSN / Item Tax Template | GST Rate Classification (HSN/SAC) |
| Reorder level based on Warehouse | Advanced Reorder Rules |

None of these are schema changes — every one is a `label` on an existing field, or a
section heading. The doctype, field names, and stored data are untouched.

---

## 7. Editing flow

Today, editing anything requires: find the right tab among 10 → find the right section
within it → click into a form field → tab away or explicitly save. The redesign keeps
Frappe's real-time-save model but makes the highest-frequency edits (price, stock toggle,
category) inline on the Overview — click the number, type, it's saved, no tab navigation
for the 80% case. Everything inside a tab still behaves exactly like today's form (this
is not proposing a new save mechanism, only a shorter path to the fields people touch
most).

---

## 8. Empty states

- **No photo yet:** a plain "+" tile with "Add Photo," not a broken-image icon or blank
  gray box.
- **Brand-new item, no stock history:** the Stock card shows "No stock yet — Add opening
  stock" as a direct action (reusing the existing `opening_stock` field, which today is
  itself hidden behind a `depends_on` most people never notice governs its own visibility).
- **No cost price known yet (new item, no purchases):** CP shows "Not set" rather than
  ₹0.00 — ₹0 cost silently implies 100% margin, which is misleading, not just an
  unfilled field.

---

## 9. What this proposal deliberately does NOT change

- No field is removed, renamed at the schema level, or made unreachable.
- No doctype, permission, or report is touched.
- The full child-table/grid editing experience is preserved as-is inside "Advanced" and
  the two remaining tabs — power users who already know this screen lose nothing.
- Print formats, list views, and every existing custom button (Stock Balance, Stock
  Ledger, Duplicate, Add/Edit Prices, variant creation dialogs, "Make" quick-entry
  shortcuts for Quotation/Sales Order/etc.) stay exactly where core puts them; none of
  this proposal's scope touches the toolbar.

---

## 10. Open questions before this could move to implementation

1. **CP editability**: making Cost Price directly editable for non-PO-tracked items is a
   real behavior change to a `read_only: 1` core field (`last_purchase_rate`) — needs an
   explicit decision on whether/how that write path should work (a manual override field,
   or genuinely unlocking the core field) before any code is written.
2. **Default price list assumption**: the SP card assumes a single "default" selling price
   list per shop (true for Santu Hardware today — `Standard Selling`) — multi-price-list
   shops would need the card to either pick one explicitly or show a selector, which
   changes the "four numbers, no clicks" simplicity this proposal is built around.
3. **Single-warehouse assumption**: the simplified "Reorder at: N" number assumes one
   warehouse (also true today) — a shop that adds a second warehouse would need the
   Advanced per-warehouse table to become the primary view again, not a fallback.

These are flagged, not answered, per the instruction to design without implementing.
