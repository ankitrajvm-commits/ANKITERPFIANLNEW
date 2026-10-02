# write_guard on scratch.local (2026-09-19 15:40) — SAFE

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 0, 'production_side_effects': 0}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. SESSION | no-role TEST user is logged in | test.norole@santuhardware.local | test.norole@santuhardware.local | PASS |  |
| A. WRITERS (must refuse a user with no roles) | every writing API refuses a user with no roles | [] | [] | PASS | 266 called, 20 skipped (bridge / guest) |
| B. READERS (shop data readable with no role -- for review) | readers that answer a user with no roles (listed for Ankit) | true | true | PASS | [] |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | no difference | PASS |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
