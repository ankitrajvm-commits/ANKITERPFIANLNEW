# CORE_PATCHES.md — Santu Hardware
### Every ERPNext/Frappe Core File Modification — Required Reading Before Touching Core

> Companion to `ERP_MASTER_PROMPT.md` §8.1 (Core Modification Policy) and
> `CODING_STANDARDS.md` §3.5. As of 2026-07-30, core modification is allowed
> when it produces a significantly better user experience than the custom
> app alone can achieve — but **every single core edit must be logged here**,
> tagged inline with `# SANTU CUSTOMIZATION` (or the JS/HTML equivalent), and
> committed on its own. No exceptions.
>
> Six things are absolutely non-negotiable regardless of UX payoff: accounting
> correctness, stock/inventory integrity, GST/taxation correctness,
> permissions, the workflow engine, and database integrity. Every patch below
> must state how it avoids risking these.
>
> **Read this file fully before making any core edit** — check whether a
> similar patch already exists, whether a past patch was reverted and why,
> and whether the file you're about to touch already carries a
> `SANTU CUSTOMIZATION` marker from an earlier session.

---

## STATUS: No core patches yet

Everything built so far lives entirely inside the `santu_hardware` custom app
(hooks, client scripts, Property Setters, monkey-patches in
`santu_hardware/__init__.py`) — zero ERPNext/Frappe core files have been
edited. This file exists ahead of the first patch so the protocol is in place
before it's needed.

---

## TEMPLATE FOR NEW ENTRIES

Copy this for every core file change, newest entries at the top.

```
## YYYY-MM-DD — Short title

- **File modified:** `apps/<app>/<path>/to/file.py` (or .js/.html/.json)
- **Reason:** why the custom app (hooks, client scripts, Property Setters,
  overrides) genuinely couldn't achieve this, and why the UX payoff justifies
  a core edit.
- **Before:**
  ```<language>
  <original code>
  ```
- **After:**
  ```<language>
  # SANTU CUSTOMIZATION: <one-line reason>
  <new code>
  ```
- **Impact:** what this changes for the user, and confirmation it does not
  affect accounting / stock / GST / permissions / workflow engine / DB
  integrity.
- **Upgrade risk:** does this survive `bench update`? If the file is
  overwritten by an ERPNext/Frappe update, what breaks, and how would a
  future session detect it broke (e.g., a specific error message or missing
  behavior to watch for)?
- **Rollback instructions:** exact steps (e.g., `git diff`/`git checkout` on
  the specific file inside `apps/erpnext` or `apps/frappe`, or restore-from
  the "Before" block above) to fully undo this patch.
```
