# api_matrix on scratch.local (2026-09-19 15:32) — FAILED

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 0, 'production_side_effects': 1}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. INVENTORY | whitelisted santu functions found | true | true | PASS | 286 functions, 9 allow_guest |
| 0. INVENTORY | test copy server reachable and logged in as the test user | claude.test@santuhardware.local | claude.test@santuhardware.local | PASS | HTTP 200 |
| A. UNAUTHORIZED (no login) | every non-guest API refuses a caller who is not logged in | [] | [] | PASS | 277 checked |
| A. UNAUTHORIZED (no login) | allow_guest APIs (listed for review) | true | true | PASS | ["santu_hardware.santu_hardware.api.app_lock_device_login", "santu_hardware.santu_hardware.api.app_lock_device_register", "santu_hardware.santu_hardware.api.app |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | calls without their required arguments get Frappe's standard refusal (info) | true | true | PASS | 72 such calls -- screens always send them |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | no API crashes on empty, invalid or wrong-type input | [] | [] | PASS | 143 APIs x 3 inputs |
| C. VALID / DUPLICATE / CONCURRENT (read-only, no-argument getters) | no-argument getters answer without crashing (valid call) | [] | [] | PASS | 52 getters |
| C. VALID / DUPLICATE / CONCURRENT (read-only, no-argument getters) | same getter twice + 4 at once -> same answer every time | [] | [] | PASS |  |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"single:Santu WhatsApp Settings": {"created": [], "deleted": [], "changed": ["enabled", "last_test_on"], "counts": [0, 0, 2]}} | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
