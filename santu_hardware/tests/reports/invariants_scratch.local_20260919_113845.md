# invariants on scratch.local (2026-09-19 11:38) — FAILED

Gate: {'functional_failures': 0, 'invariant_failures': 2, 'test_residue': 0, 'production_side_effects': 1}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| INVARIANT 1. STOCK: Bin = what the stock ledger says | every Bin qty equals its last stock-ledger balance | 0 | 0 | PASS | [] |
| INVARIANT 1. STOCK: Bin = what the stock ledger says | no Bin shows stock without any stock-ledger entry | 0 | 0 | PASS | [] |
| INVARIANT 2. BOOKS: every voucher balances (debit = credit) | no voucher with debit != credit | 0 | 0 | PASS | [] |
| INVARIANT 2. BOOKS: every voucher balances (debit = credit) | whole ledger balances | 0.0 | 0.0 | PASS |  |
| INVARIANT 3. UDHAAR: bill outstanding = payment ledger | every submitted bill's outstanding matches its payment ledger | 0 | 0 | PASS | [] |
| INVARIANT 3. UDHAAR: bill outstanding = payment ledger | no normal bill has a negative outstanding (over-paid without advance) | 0 | 0 | PASS | [] |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | no bill number used by two LIVE (submitted) bills | 0 | 0 | PASS | [] |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | bill counter sits on the last bill number | 872 | 872 | PASS |  |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | estimate counter sits on the last estimate number | 1598 | 1598 | PASS |  |
| INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top | no gap in the last 60 bill numbers | [] | [815, 816, 827, 828, 829, 830, 831, 832] | FAIL |  |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | no Loyalty Point Entry for a deleted bill | 0 | 10 | FAIL | [["04egvq7h2k", "SINV-26-00082", "Walk-in Customer", 2.0], ["0mbn3mon0b", "SINV-26-00130", "Walk-in Customer", 1.0], ["1ao52113vu", "SINV-26-00175", "Walk-in Cu |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | no pending-points row for a deleted bill | 0 | 0 | PASS | [] |
| INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone | walk-in (SALES) never earns points | 0 | 0 | PASS |  |
| INVARIANT 6. MASTER DATA | no service (non-stock) items except Udhaar / Purana Baki | 0 | 0 | PASS | [] |
| INVARIANT 6. MASTER DATA | no unit refuses a fraction (9.5 Nos) | 0 | 0 | PASS |  |
| INVARIANT 6. MASTER DATA | no draft bill older than 30 days left hanging | 0 | 0 | PASS | [] |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"Contact": {"created": [], "deleted": [], "changed": ["Claude Test"], "counts": [0, 0, 1]}} | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
