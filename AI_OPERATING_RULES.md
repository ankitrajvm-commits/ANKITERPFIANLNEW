# AI_OPERATING_RULES.md — Santu Hardware
### How to actually work on this app without breaking the shop

> Companion to `ERP_MASTER_PROMPT.md` (philosophy) and `CODING_STANDARDS.md`
> (code quality). **This file is the operational layer**: the things that are
> true about *this machine and this database*, which no amount of general
> ERPNext knowledge will tell you. Every rule below exists because ignoring it
> already cost real time or real data at least once.
>
> Read this before your first edit of a session.

---

## 0. THE ANDROID APP IS THE ONLY THING WE CHANGE RIGHT NOW

Current scope, stated 2026-10-10: **work goes into
`SantuHardwareApp/mobile/` only. Do not fix the PC app.**

The PC side — `santu_hardware/` (the Frappe app, its print formats,
`print_service.py`, the Desk pages and their JS/CSS) — is a **read-only
reference**. Copy from it freely: it is the source of truth for how a thermal
slip, an A4 bill, a loyalty rule or a khata statement is supposed to come out,
and parity with it is the goal. That is what the Flutter app's print paths were
ported from.

So, when a PC-side bug turns up while working on the Android app:

- **Do** write it down (`PROJECT_STATUS.md` §5) and say so.
- **Don't** edit PC files to fix it. Not even a one-liner, not even an obvious
  one. It is out of scope and it puts the running shop at risk for no gain.

The one exception is mechanical, not a fix: resolving conflicts when the base
branch is merged in touches whatever files that merge touched, PC files
included. That is reconciling someone else's change, not repairing the PC app.

---

## 1. YOUR EDIT PROBABLY ISN'T RUNNING YET

There are **two copies of the app** on this Mac:

| Path | What it is |
|---|---|
| `~/erpnext/santu_hardware/` | the **git repo** — where you edit |
| `~/erpnext/frappe-bench/apps/santu_hardware/santu_hardware/` | the **running copy** — what the server actually serves |

They are **not** symlinked to each other. `sites/assets/santu_hardware` points
at the *running* copy. So an edit in the repo changes nothing until you copy it
across:

```bash
cp <repo-file> ~/erpnext/frappe-bench/apps/santu_hardware/santu_hardware/<same-relative-path>
```

After any batch of edits, prove the two are identical — this must print `0`:

```bash
cd ~/erpnext && diff -rq santu_hardware frappe-bench/apps/santu_hardware/santu_hardware \
  -x '*.pyc' -x __pycache__ | grep -c "^Files"
```

**Before copying, check you are not overwriting newer work in the running
copy.** Run the same `diff -rq` *first*: the only files that differ should be
the ones you just edited.

Other facts about this environment:

- `developer_mode` is on, so the web process **auto-reloads Python** (werkzeug).
  You do not need to restart the bench for a `.py` change — confirm with
  `ps -ef | grep "frappe serve"` (the child process's start time updates).
- CSS/JS are served with a `?v=SANTU_ASSET_VERSION` stamp that is **per
  process**, so they refresh on that same reload.
- There is a **second erpnext tree** at `~/Desktop/erpnext`. That one holds the
  Mac app (Swift) sources. The **bench/server is `~/erpnext`** — web work never
  belongs in the Desktop tree.
- The app runs on one Mac at `http://localhost:8000`. No HTTPS, no proxy, no
  phone. Anything needing a secure context (camera, WebAuthn) will not work.

---

## 2. `site1.local` IS THE SHOP'S REAL DATA

Not a dev database. Real bills, real customers, real money.

- `scratch.local` exists for heavy testing (a silenced copy). Prefer it for
  anything that writes a lot. It is not reachable by hostname from a browser
  without an `/etc/hosts` entry — drive it from a script instead.
- **Never blanket-delete.** No `DELETE FROM tab<X>`, no "clear the table",
  no deleting by date range. Target **exact record names**, and assert what
  you are about to delete before deleting it. (30 real barcodes were wiped
  three times this way.)
- **Snapshot before, verify after** whenever you touch stock or accounts:
  capture every `tabBin` qty and the GL debit/credit totals, then prove only
  the intended row moved.
- **Submit commits.** A savepoint will not protect you around `.submit()`.
  To undo a submitted document: cancel it, delete it, then check your Bin/GL
  snapshot.
- A rollback-based probe *is* safe for read-mostly work: monkeypatch
  `frappe.db.commit` to a no-op, call the function, inspect, then
  `frappe.db.rollback()`. Use this to answer "what would this do?" questions.

### Test hygiene

- Test records are named `TEST…` / `ZZ…` and are **deleted in the same run**.
- Tests sell **only TEST items**. A cancelled test sale of a real item still
  triggers a stock repost that can hit a live sale.
- Tests use **ZZ TEST GRAHAK**, never a real party. (`ANUP SHARMA`,
  `RAJU KR SHARMA` and friends are real customers.)
- Tests **never print** and **never send WhatsApp** to a real number. Grep a
  suite for `send_`/print routes before running it.
- Test invoices **burn real bill numbers** (`santu_bill_no`). Snapshot and
  restore the series, or the shop sees a gap in its bill book.
- Sweep residue by owner across **all** doctypes afterwards — cancelled GL and
  SLE rows, repost jobs and the Recycle Bin all survive a naive cleanup. One
  force-deleted test item left an orphan ledger entry that broke the entire
  Stock Ledger report for weeks.
- Run as `claude.test@santuhardware.local` where possible, not Administrator.

---

## 3. WHERE THE DATA ACTUALLY LIVES (THE TRAPS)

Reading the "obvious" field returns the wrong answer for most of these:

| You want | Read this | NOT this |
|---|---|---|
| Selling price | `Item Price` (Standard Selling) | `Item.standard_rate` — empty on ~76% of items |
| Cost / CP | `Bin.valuation_rate` (weighted avg) | `Item.valuation_rate` — **0 on every item here** |
| Counter sales | `Sales Invoice` | `POS Invoice` — that table is empty; a POS-only query returns zero |
| Batch quantity | Serial and Batch Bundle (v15) | `SLE.batch_no` |
| The shop's bill number | `santu_bill_no` | the `SINV-…` docname — never show it to anyone |
| Party name on a bill | `party_address_line()` | `Address.city` — it holds the party name, never print it |

Other domain facts:

- Phone numbers are stored as **plain 10 digits**, no `91`, no `+91`, no `0`.
  Entry accepts any of those forms and strips them; `normalize_indian_phone()`
  adds `91` **only** at the moment of sending to WhatsApp. Every party in the
  database is currently 10 digits — keep it that way.
- Every Item must be `is_stock_item = 1`. The only exception is
  Udhaar / Purana Baki.
- Walk-in trade is the party **"SALES"** — a bucket, not a person: no reward
  points, no udhaar.
- Negative stock is **normal here** (goods sell off the shelf before the
  purchase is entered) and `allow_negative_stock` is on. Report it as a
  warning, never as an error.

---

## 4. WHAT THE OPERATOR SEES

The people running this are the owner's brothers. Judge every screen by
whether they can use it unaided. No accounting jargon, ever.

- **Every error, warning and confirm is in Hinglish** — plain Hindi words in
  Roman letters ("Stock kam hai", "Kya karein", "Ijazat nahi hai"). **Never
  Devanagari** (changed 2026-09-25).
- `public/js/santu_hindi_errors.js` sits in front of `frappe.msgprint` and
  `frappe.confirm` and reframes known errors into **Kya hua / Kya karein**.
  If you are writing a plain yes/no question, wrap it in
  `<div class="santu-plain">…</div>` so it is not dressed up as a failure.
- **Customer-facing** WhatsApp text (payment reminders, bill messages) stays in
  Devanagari Hindi — that is for the customer, not the counter.
- Never auto-print. Always ask first.

---

## 5. VERIFYING — LOOK, DON'T ASSUME

- **Verify visually and by hit-test**, not by counting DOM nodes. A dropdown
  that is present in the DOM can be completely clipped and invisible.
- Screenshot at the **native** preset. A custom `resize_window` letterboxes the
  capture and invents a white cut-off band that is not really there.
- For print work, check the **rendered PDF**, not the HTML. wkhtmltopdf has no
  flexbox and silently collapses flex layouts.
- After a UI fix, actually exercise the flow — a page that renders is not a
  feature that works.

---

## 6. FRAPPE MECHANICS THAT BITE

- **Anything the UI calls over HTTP needs `@frappe.whitelist()`.** A missing
  decorator shows the operator "Ijazat nahi hai" and nothing else. Every
  custom report on the Reports screen was dead for this exact reason.
- **Optional arguments need defaults** — Frappe validates the signature before
  the body runs.
- **Frappe silently drops unknown kwargs.** Add a parameter to a whitelisted
  function and forget to restart/sync, and the call still succeeds while your
  argument vanishes — which can mean a message going to the wrong person.
- A full `.save()` of a **Single** doctype from a long job throws MySQL 1020.
  Use `frappe.db.set_value` instead.
- **Two page scripts must not declare the same top-level `const`.** The Desk is
  a single page app; a duplicate name is a SyntaxError that blanks the screen
  until reload. Scan after touching any page JS.
- A page's global object (`santu_billing_page`, …) only exists **after that
  screen has been visited** in the session.
- The service worker must stay same-origin and STATIC-only. It once silently
  killed socket.io realtime.

---

## 7. BEFORE YOU SAY IT'S DONE

- The two copies are in sync (`diff -rq` prints `0`).
- Every screen you touched still renders with **zero JS errors**.
- You exercised the actual flow, not just the page load.
- Anything you created while testing is gone, verified by a re-query.
- `CHANGELOG.md` has a plain-Hindi entry — that file is the shop's workbook and
  is written for the owner, not for developers.
- You reported honestly what you could **not** verify. Saying "I could not test
  this" is always better than implying you did.
