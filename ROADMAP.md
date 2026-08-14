# ROADMAP.md — Santu Hardware
### Phase 1 → 10 Build Plan, Future Ideas, Open Decisions

> Companion to `ERP_MASTER_PROMPT.md`. Build phase-by-phase — never attempt to build
> the whole system in one pass. Each phase should be fully working and tested
> (see `CODING_STANDARDS.md` checklist) before moving to the next.
>
> **2026-07-30 policy change:** core ERPNext/Frappe modification is now allowed
> where it meaningfully improves UX — see `ERP_MASTER_PROMPT.md` §8.1 and
> `CORE_PATCHES.md`. Every phase below should be read with that in mind: "done"
> now means "as simple as it can genuinely be," not just "works using ERPNext's
> default screens."

---

## PHASE 1 — Foundation

**Design complete, implementation pending.** Product Master architecture is
now frozen at v1.0 (`PRODUCT_MASTER_RULES.md`) after a full interview +
100-product stress test. What's left in Phase 1 is *building* what was
designed (creating the actual Item Groups/Family records/Specification
master/custom fields in the system) — tracked as its own step below so it
doesn't get silently skipped before Phase 2 resumes.

- [x] Install ERPNext + create `santu_hardware` custom app
- [x] Company profile, GST settings — Company "Santu Hardware" (abbr SH, Bihar,
      GSTIN 10BULPP3722N1ZG), `india_compliance` app installed for native
      GST/HSN support (see `DATABASE_RULES.md` §1.1), Fiscal Year 2026-2027 (Apr–Mar)
- [x] Base Units of Measure created — Nos/Litre/Box/Bundle/Packet/Can, and the
      native conversion-factor mechanism verified working (1 Box = 20 Nos tested)
- [x] Rack/Shelf/Bin custom fields on Item (`DATABASE_RULES.md` §4)
- [x] **Product Master architecture — design frozen v1.0** — full interview,
      100-product stress test, Decision Matrix elimination on every custom
      addition. See `PRODUCT_MASTER_RULES.md`.
- [ ] **Product Master — implementation** — still not built: Item Group tree
      (§2), `Item Family` DocType + data (§3), `Item Specification` child
      table + Spec Name master (§4), Barcode convention wired up (§7).
      Deliberately deferred, not blocked by anything technical — direction
      2026-07-31 explicitly moved priority to UX/workflow first (Phase 2
      below), catalog data entry resumes after.
- [ ] Brand list entered (real data, not yet provided)
- [ ] Supplier structure (native, ready — full list is Phase 5)

## PHASE 2 — Core Billing (Shop Mode MVP)

**UX architecture implemented 2026-07-31**, approved via `UX_STRATEGY.md`.
Product Master catalog data entry (Phase 1, above) still needs to happen
before real billing is usable end-to-end — what's below is the *workflow
shell*, tested with throwaway items, not real inventory.

- [x] Shop Mode home screen (8 buttons) — custom Page at `/app/shop-mode`,
      New Bill rendered as a full-width brand-color banner vs. the other 7
      equal-weight buttons (UX_STRATEGY.md SS5 finding 5)
- [x] Payment modes: Cash, UPI, Card set up (Credit = leaving a POS Invoice
      partially/fully unpaid against the Customer's outstanding balance —
      native ERPNext behaviour, not a separate Mode of Payment); POS Profile
      "Santu Hardware POS" created and verified end-to-end
- [x] Billing screen: native POS already does barcode/name search and inline
      qty/price edit out of the box (BUSINESS_RULES.md SS2.2) — re-skinned
      per UX_STRATEGY.md SS6: Desk chrome hidden, page retitled "New Bill",
      "Open Form View"/"Save as Draft" removed from the menu, brand color
      applied
- [x] **Cashier role + billing-as-resting-state** (UX_STRATEGY.md SS4.1) —
      dedicated `Cashier` role lands directly on Point of Sale, no "New
      Bill" click; Administrator/Owner unaffected (verified explicitly —
      Administrator implicitly holds every role including Cashier, fixed by
      requiring Cashier-without-System-Manager)
- [x] **Shift-start tile selector** (SS4.2) — `Staff Member` DocType +
      tap-a-name screen, no password; feeds the status bar now, feeds
      Phase 3 price-override attribution later
- [x] **Persistent status bar** (SS5 finding 6) — who's billing, register
      open/closed (polls live, updates without a page reload), Privacy Mode
      placeholder pending Phase 3
- [x] **Walk-in Customer default** (SS4.4) — one generic record, set as
      POS Profile default, cashier never has to pick a customer for a plain
      cash sale
- [x] **Single-step Purchase** (SS4.3) — Purchase Invoice defaults
      `update_stock=1` + the one active warehouse, combining receipt+invoice
      into one document instead of ERPNext's PO→Receipt→Invoice chain;
      irrelevant manufacturing warehouses (Finished Goods/WIP/Goods In
      Transit from the Standard COA template) disabled so the "only one
      warehouse" auto-default actually holds
- [x] **Fix Stock** (SS4.5) — lightweight dialog (item, actual qty, reason)
      posting a real Stock Reconciliation server-side; `Reason` custom field
      added since Stock Reconciliation has no native equivalent
- [ ] Thermal + A4 print formats (buying price stripped, verified) — not
      built yet, needs real Item Price data from Phase 1's catalog entry
- [ ] Tendered-amount quick buttons for cash payment (UX_STRATEGY.md SS7,
      still open) — deferred, not essential to a working billing loop

**Bugs found and fixed along the way** (not design issues, real defects
caught by testing before they'd have hit real usage): a pre-existing
ERPNext core bug in `get_loyalty_programs()` breaking every Customer save
(worked around via a documented monkey-patch, see `DATABASE_RULES.md` §4);
Stock Reconciliation's actual difference-account fieldname is
`expense_account`, not `difference_account` as the error message's label
implied; a brand-new item with zero valuation history needs
`allow_zero_valuation_rate` set explicitly.

**Process rule going forward** (per direct instruction 2026-07-30): before
starting any new phase, explicitly review the previous phase for architectural
issues and fix them first — don't chain phases blindly just because the
previous one's checklist is ticked.

## PHASE 2.5 — Foundation & Critical-Workflow Redesign (added 2026-07-30)

**Iterative product-design approach, not a data-first approach** — explicit
direction: don't wait for the full catalog before redesigning, and don't
separate "data entry" from "UI work." Populate each screen with realistic
hardware-store sample data *as it's redesigned*, to validate against
real-world scenarios rather than fake placeholders. Full catalog entry
(Phase 1's remaining Product Master data) comes **last**, only once the
core experience already feels excellent. Benchmark for every screen: Apple
Settings / Shopify POS / Square POS / Google Pay / WhatsApp — not ERPNext's
own defaults. Test: *"Could a 7th-class student run this shop without
training?"* If no, redesign again.

**Stage 1 — Foundation** (blocks everything else, do first):
- [ ] Design system tokens (colors, typography scale, spacing scale,
      elevation, button styles, icon conventions) — §9 of `UX_STRATEGY.md`
      is the starting spec, extend/revise as needed once applied for real
- [ ] Login screen
- [ ] Navigation / Sidebar (Desk)
- [ ] Home (both Shop Mode and the decluttered Desk Home — should feel like
      one product, not two)
- [ ] Global Search
- [ ] Mobile responsiveness pass

**Stage 2 — Business-critical workflows** (added priority order 2026-07-30):
1. [ ] Billing / POS — **highest priority, the heart of the product.**
   Barcode-first, keyboard-first, minimal popups, fast payment/print,
   return/exchange, built for continuous all-day use.
2. [ ] Product Creation — Quick Item Create (<30s for a typical hardware
   item) + Advanced Item Create (full ERPNext capability, not removed).
3. [ ] Customer Selection — walk-in / existing / new-in-seconds, no
   unnecessary mandatory fields.
4. [ ] Purchase Entry — barcode, qty, rate, GST, warehouse; nothing else
   unless genuinely needed.
5. [x] Product Search — done 2026-07-30, ranked, instant, see `DESIGN_DECISIONS.md`.
6. [ ] Stock Lookup — "inventory equivalent of Google": stock, reserved,
   selling price, purchase price, warehouse, last purchase, last sale, all
   in one place, no clicking through multiple screens.

Benchmark every redesign against Shopify POS / Square POS / Loyverse POS /
Zoho POS / Google Pay / WhatsApp — if ERPNext needs more steps than those,
redesign it. **Reuse over replace**: transform an existing ERPNext page
first; only build a new custom page when reuse genuinely can't get there
(Product Search needed a new page — ranking/instant-search isn't something
a list view can do; POS should stay the native doctype, reskinned further,
not rebuilt from scratch).

**Beginner Mode / Advanced Mode (added 2026-07-30):** every major workflow
should eventually offer both — Beginner shows only the minimum fields to
complete the task, Advanced keeps every ERP capability available. Hide
complexity, never remove it. The software scales new employee → cashier →
manager → owner without changing products.

**Guiding frame (added 2026-07-30):** redesign the whole daily journey, not
page-by-page — Open counter → Check today's sales → Sell (barcode/search →
cash/UPI/card → print) → Returns → Check stock → Receive supplier delivery
→ Purchase entry → Inventory adjustments → Close counter → Close day →
Reports. Every screen must earn its place against this journey; if it
doesn't serve one of these steps, question whether it should exist.
Benchmark: Apple / Shopify POS / Square POS / Google Pay / Notion / Linear
/ WhatsApp — if a redesigned screen still feels like ERP software, it's
not done. **Progressive simplification levels** (not all built yet):
Owner Mode (full Desk, Administrator, today) → Manager Mode (not yet
scoped) → Cashier Mode (exists — the Cashier role) → Ultra Simple Mode
(not yet built — near-zero-training tier for brand-new temp staff).
Process note: docs now target ~20% of effort, building/validating ~80% —
`DESIGN_DECISIONS.md`/UX-review entries should stay concise, not exhaustive.

**Stage 3 — Full catalog data entry** — only after Stage 1 + 2 feel
excellent. This is where the rest of Phase 1's Product Master
implementation (Item Group tree, Item Family, Item Specification, real
brand/supplier lists, full item catalog) actually happens.

Every change in this phase follows `ERP_MASTER_PROMPT.md` §8.1 (Core
Modification Policy) — custom app first, core only when genuinely
necessary, tagged + logged in `CORE_PATCHES.md` when it is. Report at each
milestone: what changed, why it's better, core vs. app-only, upgrade impact.

## PHASE 3 — Privacy Mode & Pricing
- Privacy Mode password gate + auto-lock
- Buying price, margin ₹/%, last purchase price (Privacy Mode only)
- Price levels: Retail / Wholesale / Contractor
- Price change logging

## PHASE 4 — Inventory Depth
- Purchase Entry, Purchase Return, Stock Adjustment, Damage Entry
- Low stock alerts, reorder level
- Item Ledger, Physical Stock Count

## PHASE 5 — Customers & Suppliers
- Customer types (Contractor/Electrician/Plumber/etc.)
- Outstanding/credit tracking, due reminders
- Supplier ledger and pending bills

## PHASE 6 — Dashboard & Reports
- Home dashboard cards + graphs
- Core reports: Daily Sales, Profit, GST, Stock Report, Top Products/Customers

## PHASE 7 — Documents & Delivery
- Quotation/Estimate, Delivery Challan, Credit/Debit Notes
- Optional delivery/loading/transport/labour charges on bill

## PHASE 8 — Convenience Features
- Recent bills reprint, Hold/Resume bill, Quotation→Invoice
- Favourite items, product image on billing screen
- Keyboard shortcuts (F2 search, F4 payment, F9 save & print)

## PHASE 9 — Communication & Backup
- WhatsApp invoice/estimate/reminder sharing
- Nightly automated local backup + restore drill

## PHASE 10 — Polish & Analytics
- Dark mode / theme refinement pass
- Advanced analytics (peak hours, category/brand-wise sales)
- Audit log review UI, price change report UI

---

## FUTURE FEATURE IDEAS (Not Yet Scheduled — Run Through Decision Matrix First)

- Voice search ("Asian Paint 20L")
- Barcode label printing (own labels for unbarcoded items)
- Combo packs (1 box = 10 pieces, sellable both ways)
- Purchase price history graph per item
- Smart typo-tolerant search
- Auto GST/HSN suggestion based on category
- Mobile companion view for owner (dashboard on phone)
- Plugin-style architecture for a hypothetical future second shop — only if it ever
  actually happens; do not build for this speculatively (violates Golden Rule)

---

## OPEN DECISIONS (Fill In As You Decide — Don't Let Claude Guess)

- [ ] Exact password policy for Privacy Mode (PIN vs full password)
- [ ] Which thermal printer model to standardize on
- [ ] Whether GST invoicing is mandatory for all bills or optional per customer
- [ ] Backup destination: external SSD vs cloud folder vs both
- [ ] Final list of product categories/sub-categories for initial data entry
- [ ] Privacy Mode auto-lock timeout duration
