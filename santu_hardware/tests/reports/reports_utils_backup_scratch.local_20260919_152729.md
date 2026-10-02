# reports_utils_backup on scratch.local (2026-09-19 15:27) — FAILED

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 3, 'production_side_effects': 0}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| R. REPORTS (every entry on the Reports screen) | report 'Day Book' opens | null | null | PASS | General Ledger rows=948 |
| R. REPORTS (every entry on the Reports screen) |   Day Book debit = the ledger's debit for the period | 20078532.39 | 20078532.39 | PASS |  |
| R. REPORTS (every entry on the Reports screen) |   Day Book debit = credit | 20078532.39 | 20078532.39 | PASS |  |
| R. REPORTS (every entry on the Reports screen) | report 'All Transactions' opens | null | null | PASS | General Ledger rows=948 |
| R. REPORTS (every entry on the Reports screen) | report 'Profit And Loss' opens | null | null | PASS | Profit and Loss Statement rows=13 |
| R. REPORTS (every entry on the Reports screen) | report 'Bill Wise Profit' opens | null | null | PASS | Gross Profit rows=764 |
| R. REPORTS (every entry on the Reports screen) | report 'Cash Flow' opens | null | null | PASS | Cash Flow rows=18 |
| R. REPORTS (every entry on the Reports screen) | report 'Trial Balance Report' opens | null | null | PASS | Trial Balance rows=9 |
| R. REPORTS (every entry on the Reports screen) |   Trial Balance: closing debit = closing credit | 20078532.39 | 20078532.39 | PASS |  |
| R. REPORTS (every entry on the Reports screen) | report 'Balance Sheet' opens | null | null | PASS | Balance Sheet rows=16 |
| R. REPORTS (every entry on the Reports screen) | report 'Party Statement' opens | null | null | PASS | General Ledger rows=149 |
| R. REPORTS (every entry on the Reports screen) | report 'Party Wise Profit & Loss' opens | null | null | PASS | Gross Profit rows=44 |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | no difference | PASS |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {"File": 3, "Error Log": 3, "Property Setter": 1} | FAIL |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
