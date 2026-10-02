# invariants on site1.local (2026-09-21 12:33) — SAFE

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 0, 'production_side_effects': 0}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| INVARIANT 1. STOCK: Bin = what the stock ledger says | every Bin qty equals its last stock-ledger balance | 0 | 0 | PASS | [] |
| INVARIANT 1. STOCK: Bin = what the stock ledger says | no Bin shows stock without any stock-ledger entry | 0 | 0 | PASS | [] |
| INVARIANT 2. BOOKS: every voucher balances (debit = credit) | no voucher with debit != credit | 0 | 0 | PASS | [] |
| INVARIANT 2. BOOKS: every voucher balances (debit = credit) | whole ledger balances | 0.0 | 0.0 | PASS |  |
| INVARIANT 3. UDHAAR: bill outstanding = payment ledger | every submitted bill's outstanding matches its payment ledger | 0 | 0 | PASS | [] |
| INVARIANT 3. UDHAAR: bill outstanding = payment ledger | no normal bill has a negative outstanding (over-paid without advance) | 0 | 0 | PASS | [] |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | no bill number used by two LIVE (submitted) bills | 0 | 0 | PASS | [] |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | bill counter sits on the last bill number | 889 | 889 | PASS |  |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | estimate counter sits on the last estimate number | 1598 | 1598 | PASS |  |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | no NEW gap in the last 60 bill numbers | [] | [] | PASS | known old gaps: [829, 830, 831, 832, 887] |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | no NEW Loyalty Point Entry for a deleted bill | 0 | 0 | PASS | 0 known old rows |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | no pending-points row for a deleted bill | 0 | 0 | PASS | [] |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | walk-in (SALES) never earns points | 0 | 0 | PASS |  |
| INVARIANT 6. MASTER DATA | no service (non-stock) items except Udhaar / Purana Baki | 0 | 0 | PASS | [] |
| INVARIANT 6. MASTER DATA | no unit refuses a fraction (9.5 Nos) | 0 | 0 | PASS |  |
| INVARIANT 6. MASTER DATA | no draft bill older than 30 days left hanging | 0 | 0 | PASS | [] |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | no difference | PASS |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
