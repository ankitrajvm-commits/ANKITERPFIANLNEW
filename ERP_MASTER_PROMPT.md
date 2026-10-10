# ERP_MASTER_PROMPT.md
## Santu Hardware — Custom ERPNext System
### The Master Brain — Read This First, Every Session

> This is the entry-point document. It holds the philosophy, the non-negotiable
> rules, and pointers to five companion documents that hold the details. Claude Code
> must read this file completely at the start of every session before touching any
> code, and must skim the linked companion file relevant to the current task before
> implementing anything in that area.

---

## 0. DOCUMENT MAP

This project's brain is split across 12 files, kept at the repo root:

| File | Purpose |
|---|---|
| `ERP_MASTER_PROMPT.md` | This file — philosophy, golden rules, AI behaviour, decision matrix |
| `BUSINESS_RULES.md` | Domain rules — billing, pricing/privacy, inventory, customers, payments |
| `UI_GUIDELINES.md` | Shop Mode design, dashboard, design system, UX rules |
| `DATABASE_RULES.md` | DocType design, folder structure, naming conventions, data model |
| `PRODUCT_MASTER_RULES.md` | Category/brand/UOM/variant/price-level/GST/barcode architecture for the product catalog — as important as `BUSINESS_RULES.md` since the catalog is the core of a hardware ERP |
| `UX_STRATEGY.md` | User journeys, workflow redesign, screen hierarchy, branding/design system, printing, loyalty — the product vision layer on top of the data model |
| `ROADMAP.md` | Phase 1→10 build plan, future feature ideas, open decisions |
| `CODING_STANDARDS.md` | Code quality rules, testing checklist, response format, things never to do |
| `AI_OPERATING_RULES.md` | **Read this before your first edit, every session.** How to work on *this machine and this database* — the two app copies that must be kept in sync, what is safe to run against the shop's live data, where values actually live (selling price is not on the Item), Hinglish-only messages, and the Frappe mechanics that bite. Every rule in it exists because ignoring it already cost time or data. |
| `PROJECT_STATUS.md` | **Read this one first, always.** Living snapshot of exact current state — structure, what's done, every customization, pending tasks, known bugs, commands, so a new session needs zero prior context |
| `IMPROVEMENT_LOG.md` | Running log of problems found + fixed + future ideas while building — not a plan, a record |
| `CORE_PATCHES.md` | **Required reading before touching any ERPNext/Frappe core file.** Running log of every core modification — file, reason, before/after, impact, rollback. See §8.1's Core Modification Policy. |
| `DESIGN_DECISIONS.md` | Record of every screen/workflow redesign — original problem, alternatives considered and why rejected, chosen solution, before/after screenshots, measurable UX improvement (clicks/fields/dialogs/decisions/time). See §5.1's redesign mandate. |

Read this file fully every session, and `AI_OPERATING_RULES.md` before your
first edit. Read the relevant companion file(s) before starting work on that
area. If a companion file doesn't yet cover something needed,
propose an addition to it before coding — don't let undocumented decisions pile up.

Process rule (added 2026-07-30, after Phase 2 UI work started before Product
Master architecture was frozen): before starting any new phase, explicitly
review the previous phase for architectural gaps and resolve them — don't
chain phases just because the previous checklist has ticks on it.

---

## 1. PRIMARY OBJECTIVE — THE GOLDEN RULE

```text
This project is NOT a coding project.
This is a product.

Every decision should improve:
- Simplicity
- Speed
- Reliability
- Profitability
- User Experience

If a feature makes the software more complex than its benefit,
DO NOT IMPLEMENT IT.

Always challenge unnecessary complexity.
Think like a product designer building POS software for a hardware store —
not an enterprise architect building SAP.
```

Everything else in these 6 documents is downstream of this rule. When in doubt,
come back to this.

---

## 2. VISION & CONTEXT (Short Version — full detail in BUSINESS_RULES.md)

**Business:** Santu Hardware — single hardware/electrical/paints/plumbing/sanitary/
water-tank store, Isuapur, Bihar. Family-run 50 years, being digitized now.

**What we're building:** A single-shop, single-computer, offline-first billing +
inventory system on top of ERPNext/Frappe, running locally on one **MacBook Air M5,
15-inch**. No multi-branch, no multi-company, no cloud dependency for daily billing.

**Product ambition (added 2026-07-30):** this is being built as **"Santu Hardware
ERP"** — a long-term commercial-quality product, not a one-off customization for
this shop alone. The bar is Apple Settings / WhatsApp / Google Pay / Shopify POS —
software that feels obviously simpler than a traditional ERP, not "ERPNext with a
coat of paint." ERPNext's default UI is not sacred: question every screen, every
click, every form, every menu. If a screen can be simpler, redesign it — including,
where genuinely necessary, modifying ERPNext/Frappe core (see §8.1's Core
Modification Policy for exactly how). Don't wait for approval on UX fixes that are
obviously improvements (confusing UI, unnecessary options, duplicate workflows) —
fix them and report at the next milestone per §8.1.

**2.1 The "from scratch" test (added 2026-07-30).** Don't ask "how can I improve
this ERPNext screen?" — ask **"if I were building Santu Hardware ERP from scratch
in 2026, would I build this screen this way?"** If no, redesign it, including the
underlying workflow, not just its appearance — question whether multiple pages
should become one page, whether a form should become a side panel, whether a table
should become cards, whether a dashboard should become an action center. Concrete
principles: eliminate hesitation (if a user pauses to think, simplify it —
"redesign it" is the answer, not "add a tooltip"); eliminate jargon (never assume
accounting/ERP vocabulary); eliminate unnecessary navigation (the most-used actions
are never more than one click away); design for touch (assume this eventually runs
on a POS terminal/touchscreen, even before that's built); prefer removing
complexity over hiding it. Every redesign gets a **measurable before/after** —
clicks, fields, dialogs, decisions, and completion time, honestly reported even
when the improvement is modest or is about clarity/decision-count rather than
click-count. Every redesign gets an entry in `DESIGN_DECISIONS.md` — problem,
alternatives considered and why each was rejected, chosen solution, before/after
screenshots, measurable improvement. Full checklist and review format:
`UI_GUIDELINES.md` §5.

**The test that matters most:**
> If a Class 7 student cannot generate a bill within 10 minutes of first seeing the
> screen — barcode scan karke ya product naam type karke — the design has failed.

---

## 3. NEVER ASSUME

```text
NEVER ASSUME.

If anything is unclear:
STOP. Ask me first.

Never guess.
Never invent business rules.
Never create workflows without my approval.

One wrong assumption can affect thousands of future invoices.
```

This applies especially to: pricing logic, GST/tax handling, what's visible to
cashiers vs owner, and anything touching money or stock quantities. Guessing here is
expensive to undo later.

---

## 4. PRODUCT QUALITY RULES

```text
Every feature must satisfy ALL of these:
✔ Fast
✔ Beautiful
✔ Simple
✔ Reliable
✔ Upgrade Safe
✔ Offline First
✔ Mobile Friendly (future-proofed, even if not built yet)
✔ Easily Maintainable

If any condition fails, redesign the feature — don't ship it as-is.
```

---

## 5. UX RULES

```text
Every screen should answer: "What is the user trying to do?"
Then remove everything that doesn't help that goal.

If one click can become zero clicks, do it.
If two clicks can become one click, do it.
If one page can become one popup, do it.

Avoid unnecessary navigation.
```

Full design system and screen-by-screen guidance lives in `UI_GUIDELINES.md`.

---

## 6. AI BEHAVIOUR RULES

```text
Do not become a Yes Man.

If my request is bad, tell me.
If my architecture is poor, improve it.
If ERPNext already has a better solution, explain why.

Always prioritize long-term maintainability over speed of shipping.
```

```text
Never generate code immediately.
Spend 80% of the time thinking.
Spend 20% of the time coding.

Good architecture is more valuable than fast coding.
```

Concretely: for anything non-trivial, Claude should first write out the plan (using
Section 7's decision matrix where relevant) and get explicit go-ahead before
generating the implementation, unless the task is a small, obviously-scoped fix.

---

## 7. PRODUCT DECISION MATRIX (Fill This Before Any Non-Trivial Feature)

Before implementing anything beyond a trivial fix, Claude fills this table in its
response and waits for confirmation if the answer isn't obviously "build it":

| Question | Answer |
|---|---|
| Does ERPNext already support this? | |
| Can we reuse an existing feature instead of building new? | |
| Why does this need customization at all? | |
| Business value (in plain terms)? | |
| Complexity (Low / Medium / High)? | |
| Upgrade risk (does it survive `bench update`)? | |
| Is there a simpler alternative? | |
| Final recommendation? | |

This single table prevents most unnecessary customization — the most common way
small-business ERP projects turn into unmaintainable messes.

---

## 8. AI RULES — TECHNICAL BASELINE

### 8.1 Core Modification Policy (added 2026-07-30 — supersedes the old blanket ban)

Core (ERPNext/Frappe) modification is **allowed** when it produces a significantly
better user experience than the custom app alone can achieve — but only under this
protocol, no exceptions:

1. **Six things are absolutely non-negotiable, no matter how good the UX payoff
   looks:** accounting correctness, stock/inventory integrity, GST/taxation
   correctness, the permissions system, the workflow engine, and database
   integrity. If a proposed change risks any of these, don't make it — redesign
   the approach instead.
2. **Prefer the custom app first.** Hooks, client scripts, Property Setters,
   overrides, monkey-patches in `santu_hardware/__init__.py` — reach for core
   files only when the custom app genuinely cannot achieve the same result.
3. **Every core file edit must be tagged inline** with `# SANTU CUSTOMIZATION`
   (or the JS/HTML equivalent) directly above the changed lines, so anyone
   reading the core file later can immediately spot what's non-stock.
4. **Every core file edit must get an entry in `CORE_PATCHES.md`** — file
   modified, reason, before, after, impact, rollback instructions. No core edit
   ships without this. `CORE_PATCHES.md` is required reading before touching any
   core file, so past decisions aren't relitigated or accidentally reverted.
5. **Small, logical commits per core change** — not one large commit bundling
   several unrelated core edits.
6. **Report at the next milestone**: what changed, why it's better, whether it
   touched only the custom app or core too, and any future maintenance/upgrade
   impact (does it survive `bench update`?).

1. Follow Frappe v15 best practices; keep upgrade compatibility — this matters
   *more*, not less, once core files are in play.
2. Before writing code, check if ERPNext already has this feature natively — fill the
   Decision Matrix (Section 7).
3. Do not over-engineer. This is a single-shop tool, not a SaaS product — but see
   the product-ambition note in §2: build it to the quality bar of something that
   *could* scale, without speculatively building features it doesn't need yet.
4. Write production-quality, commented code — comments explain *why* (the business
   reason), not just *what*.
5. Full response format and testing checklist: see `CODING_STANDARDS.md`.

---

## 9. QUICK RULE SUMMARY (Pin This)

- Golden Rule: product thinking > code output
- Never assume — stop and ask
- Buying price = Privacy Mode only, always (`BUSINESS_RULES.md` §Pricing)
- Selling price = always visible, always inline-editable (`BUSINESS_RULES.md` §Billing)
- Class 7 simplicity test on every screen (`UI_GUIDELINES.md`)
- Fill the Decision Matrix before building anything non-trivial
- 80% thinking, 20% coding
- Core modification is allowed when it's genuinely the best UX path — but only
  with a `SANTU CUSTOMIZATION` tag + a `CORE_PATCHES.md` entry, and never at the
  cost of accounting/stock/GST/permissions/workflow-engine/DB integrity (§8.1)

---

*This file is the entry point only. For implementation detail, always go to the
relevant companion file — see the Document Map in Section 0.*
