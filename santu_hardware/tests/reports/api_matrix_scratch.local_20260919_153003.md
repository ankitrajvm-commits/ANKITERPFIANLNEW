# api_matrix on scratch.local (2026-09-19 15:30) — FAILED

Gate: {'functional_failures': 14, 'invariant_failures': 0, 'test_residue': 2, 'production_side_effects': 2}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. INVENTORY | whitelisted santu functions found | true | true | PASS | 286 functions, 9 allow_guest |
| 0. INVENTORY | test copy server reachable and logged in as the test user | claude.test@santuhardware.local | claude.test@santuhardware.local | PASS | HTTP 200 |
| A. UNAUTHORIZED (no login) | every non-guest API refuses a caller who is not logged in | [] | [] | PASS | 277 checked |
| A. UNAUTHORIZED (no login) | allow_guest APIs (listed for review) | true | true | PASS | ["santu_hardware.santu_hardware.api.app_lock_device_login", "santu_hardware.santu_hardware.api.app_lock_device_register", "santu_hardware.santu_hardware.api.app |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | calls without their required arguments get Frappe's standard refusal (info) | true | true | PASS | 72 such calls -- screens always send them |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | no API crashes on empty, invalid or wrong-type input | [] | [["santu_hardware.santu_hardware.api.export_santu_report", "invalid", 500, "JSONDecodeError", "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (c | FAIL | 143 APIs x 3 inputs |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: export_santu_report [invalid] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0) |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: export_santu_report [wrongtype] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (ch |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: items_uoms [wrongtype] | clean refusal | HTTP 500 TypeError | FAIL | TypeError: 'int' object is not iterable |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: run_santu_report [invalid] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0) |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: run_santu_report [wrongtype] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (ch |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: report_browser_errors [invalid] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0) |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: report_browser_errors [wrongtype] | clean refusal | HTTP 500 TypeError | FAIL | TypeError: 'int' object is not iterable |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: get_message_history [invalid] | clean refusal | HTTP 500 ValueError | FAIL | ValueError: invalid literal for int() with base 10: 'TEST-DOES-NOT-EXIST-###' |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: export_items_file [invalid] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0) |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: export_items_file [wrongtype] | clean refusal | HTTP 500 JSONDecodeError | FAIL | json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (ch |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: get_catalog_items_for_training [invalid] | clean refusal | HTTP 500 ValueError | FAIL | ValueError: invalid literal for int() with base 10: 'TEST-DOES-NOT-EXIST-###' |
| B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs) | crash: get_chats [invalid] | clean refusal | HTTP 500 ValueError | FAIL | ValueError: invalid literal for int() with base 10: 'TEST-DOES-NOT-EXIST-###' |
| C. VALID / DUPLICATE / CONCURRENT (read-only, no-argument getters) | no-argument getters answer (valid call) | [] | [["santu_hardware.santu_hardware.api.get_purchase_item_row", 404, "DoesNotExistError", "[\"{\\\"message\\\": \\\"Item None not found\\\", \\\"title\\\": \\\"Mes | FAIL | 52 getters |
| C. VALID / DUPLICATE / CONCURRENT (read-only, no-argument getters) | same getter twice + 4 at once -> same success every time | [] | [] | PASS |  |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"Print Format": {"created": [], "deleted": [], "changed": ["Santu Hardware Thermal Bill", "Santu Hardware Thermal Bill (Sales Invoice)"], "counts": [0, 0, 2]}, | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {"Santu Bug Report": 80, "Print Format": 5} | FAIL |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
