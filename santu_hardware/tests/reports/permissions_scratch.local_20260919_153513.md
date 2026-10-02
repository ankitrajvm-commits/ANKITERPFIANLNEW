# permissions on scratch.local (2026-09-19 15:35) — FAILED

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 9, 'production_side_effects': 0}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | no difference | PASS |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {"Item": 1, "Customer": 1, "Notification Settings": 5, "User": 5, "Item Price": 1, "Contact": 3, "DocShare": 5, "Item named TEST%": 1, "Customer named TEST%": 1 | FAIL |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
