# CODING_STANDARDS.md — Santu Hardware
### Code Quality, Testing, Response Format, Things Never To Do

> Companion to `ERP_MASTER_PROMPT.md`. This is the operational checklist Claude
> follows on every single feature, every session.

---

## 1. RESPONSE FORMAT — EVERY FEATURE REQUEST

When implementing any non-trivial feature, respond in this exact structure:

1. **Requirement Understanding** — restate what's being asked, in plain terms
2. **Product Decision Matrix** (see `ERP_MASTER_PROMPT.md` §7) — filled in
2.5. **Core modification required?** — yes/no; if yes, which file(s), why the
     custom app can't achieve the same result, and confirmation it doesn't
     touch the six non-negotiables (§3.5)
3. **Better ERPNext-Native Approach** (if one exists) — explain before coding
4. **Implementation Plan** — step by step
5. **Files to Create**
6. **Files to Modify**
7. **Complete Code**
8. **Bench Commands** (migrate, build, restart, etc.)
9. **Testing Steps**
10. **Rollback Steps**
11. **Possible Risks**

For small, obviously-scoped fixes (typo, minor label change), this full format is
unnecessary — use judgment, but never skip it for anything touching pricing,
permissions, or stock logic.

---

## 2. GIT COMMIT STANDARDS

Format: `type(scope): short description`

Examples:
- `feat(billing): add inline price override on invoice line`
- `fix(privacy-mode): hide buying price from print format`
- `refactor(inventory): simplify unit conversion lookup`
- `docs(roadmap): mark phase 2 complete`

---

## 3. CODE QUALITY RULES

- Production-quality, commented code always — comments explain **why** (the
  business reason from `BUSINESS_RULES.md`), not just what the code does.
- One responsibility per file/function.
- No premature abstraction — this is a single-shop tool; don't build for
  hypothetical scale that will never arrive (violates the Golden Rule).
- Avoid N+1 queries; index barcode/SKU/item-name fields used in billing search.
- Sensitive fields (buying price, margin) must be excluded server-side/permission-
  level for cashier role — never just hidden client-side. See `DATABASE_RULES.md` §6.

---

## 3.5 CORE FILE MODIFICATION PROTOCOL (added 2026-07-30)

Per `ERP_MASTER_PROMPT.md` §8.1, core edits are allowed when they're genuinely
the best UX path — but every single one must follow all four steps, no
exceptions:

1. Confirm the custom app truly can't achieve the same result first (hooks,
   client scripts, Property Setters, overrides).
2. Tag the change inline with `# SANTU CUSTOMIZATION` (or JS/HTML equivalent)
   directly above the modified lines.
3. Add an entry to `CORE_PATCHES.md`: file, reason, before, after, impact,
   rollback instructions.
4. Commit it on its own — small, logical commits per core change, never
   bundled with unrelated edits.

Before writing the change, re-check it against the six non-negotiables:
accounting correctness, stock/inventory integrity, GST/taxation correctness,
permissions, the workflow engine, database integrity. If in doubt, don't —
find a custom-app-only way instead.

---

## 4. THINGS TO NEVER DO

- ❌ Never edit a core file without a `SANTU CUSTOMIZATION` tag + a
  `CORE_PATCHES.md` entry (see §3.5) — the custom app is still the default,
  core edits are the deliberate exception, not the norm
- ❌ Never touch a core file in a way that risks accounting, stock, GST/tax,
  permissions, the workflow engine, or database integrity — these six are
  absolute regardless of UX payoff
- ❌ Never show buying price outside Privacy Mode, anywhere, ever
- ❌ Never print buying price/margin on any customer-facing document
- ❌ Never require internet for core billing to function
- ❌ Never design a screen with more clicks than necessary
- ❌ Never expose full ERPNext Desk complexity to daily shop staff
- ❌ Never silently change core ERPNext behavior in a way that breaks future upgrades
- ❌ Never skip the Decision Matrix / plan-before-code step for non-trivial features
- ❌ Never over-engineer for scale this single shop will never reach
- ❌ Never guess at an unclear business rule — stop and ask (`ERP_MASTER_PROMPT.md` §3)

---

## 5. TESTING CHECKLIST (Before Marking Any Feature Done)

- [ ] Works fully offline (if not WhatsApp/backup-dependent)
- [ ] Billing flow completable in under 30 seconds for a simple 3-item bill
- [ ] Buying price confirmed invisible outside Privacy Mode (tested as cashier role,
      not just visually hidden — verify it isn't in the network payload either)
- [ ] Price override on a bill line works inline, no page navigation
- [ ] Multi-unit conversion tested (e.g., sell 3 pieces from a box-tracked item)
- [ ] Print format checked — no buying price/margin leaks onto invoice
- [ ] Works correctly after `bench migrate` (upgrade-safe)
- [ ] Tested on the actual MacBook Air M5 setup, not just dev assumptions
- [ ] Rollback steps documented and verified
- [ ] Decision Matrix was filled before building (for non-trivial features)
- [ ] If any core file was touched: `SANTU CUSTOMIZATION` tag present,
      `CORE_PATCHES.md` entry written, none of the six non-negotiables
      (accounting/stock/GST/permissions/workflow engine/DB integrity) affected

---

## 6. WHEN CLAUDE SHOULD PUSH BACK

Per `ERP_MASTER_PROMPT.md` §6 (AI Behaviour), Claude should explicitly flag —
before coding — if:
- A requested feature adds complexity disproportionate to its benefit
- A simpler ERPNext-native path exists
- The request would risk exposing buying price/margin data
- The request would add unnecessary clicks/navigation to a daily-use screen
- A business rule is ambiguous enough that guessing would be risky
