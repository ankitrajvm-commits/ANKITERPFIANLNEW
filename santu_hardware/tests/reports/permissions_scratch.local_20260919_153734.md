# permissions on scratch.local (2026-09-19 15:37) — FAILED

Gate: {'functional_failures': 1, 'invariant_failures': 0, 'test_residue': 13, 'production_side_effects': 1}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. SETUP (TEST users, TEST item, TEST bills) | session for admin | test.perm.admin@santuhardware.local | test.perm.admin@santuhardware.local | PASS |  |
| 0. SETUP (TEST users, TEST item, TEST bills) | session for accountant | test.perm.accountant@santuhardware.local | test.perm.accountant@santuhardware.local | PASS |  |
| 0. SETUP (TEST users, TEST item, TEST bills) | session for salesman | test.perm.salesman@santuhardware.local | test.perm.salesman@santuhardware.local | PASS |  |
| 0. SETUP (TEST users, TEST item, TEST bills) | session for restricted | test.perm.restricted@santuhardware.local | test.perm.restricted@santuhardware.local | PASS |  |
| 0. SETUP (TEST users, TEST item, TEST bills) | session for readonly | test.perm.readonly@santuhardware.local | test.perm.readonly@santuhardware.local | PASS |  |
| ACTION: view_bills | admin: view_bills | ALLOWED | ALLOWED | PASS |  |
| ACTION: view_bills | accountant: view_bills | ALLOWED | ALLOWED | PASS |  |
| ACTION: view_bills | salesman: view_bills | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: view_bills | restricted: view_bills | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: view_bills | readonly: view_bills | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: create_bill | admin: create_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: create_bill | accountant: create_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: create_bill | salesman: create_bill | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: create_bill | restricted: create_bill | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: create_bill | readonly: create_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User don't have permissions to select/read this account.\", \"title\": \"Message\", \"indicator\": \"red\", \"raise_exception\ |
| ACTION: submit_bill | admin: submit_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: submit_bill | accountant: submit_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: submit_bill | salesman: submit_bill | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: submit_bill | restricted: submit_bill | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: submit_bill | readonly: submit_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User don't have permissions to select/read this account.\", \"title\": \"Message\", \"indicator\": \"red\", \"raise_exception\ |
| ACTION: take_payment | admin: take_payment | ALLOWED | ALLOWED | PASS |  |
| ACTION: take_payment | accountant: take_payment | ALLOWED | ALLOWED | PASS |  |
| ACTION: take_payment | salesman: take_payment | ALLOWED | REFUSED | FINDING | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: take_payment | restricted: take_payment | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: take_payment | readonly: take_payment | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: edit_bill | admin: edit_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: edit_bill | accountant: edit_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: edit_bill | salesman: edit_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: edit_bill | restricted: edit_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: edit_bill | readonly: edit_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: cancel_bill | admin: cancel_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: cancel_bill | accountant: cancel_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: cancel_bill | salesman: cancel_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: cancel_bill | restricted: cancel_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: cancel_bill | readonly: cancel_bill | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: delete_bill | admin: delete_bill | ALLOWED | ALLOWED | PASS |  |
| ACTION: delete_bill | accountant: delete_bill | REFUSED | ALLOWED | FINDING |  |
| ACTION: delete_bill | salesman: delete_bill | REFUSED | REFUSED | PASS | ValidationError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: delete_bill | restricted: delete_bill | REFUSED | REFUSED | PASS | ValidationError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: delete_bill | readonly: delete_bill | REFUSED | REFUSED | PASS | ValidationError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: fix_stock | admin: fix_stock | ALLOWED | ALLOWED | PASS |  |
| ACTION: fix_stock | accountant: fix_stock | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.accountant@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: fix_stock | salesman: fix_stock | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.salesman@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: fix_stock | restricted: fix_stock | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.restricted@santuhardware.local</strong> does not have doctype access via role permission for document < |
| ACTION: fix_stock | readonly: fix_stock | REFUSED | REFUSED | PASS | PermissionError ["{\"message\": \"User <strong>test.perm.readonly@santuhardware.local</strong> does not have doctype access via role permission for document <st |
| ACTION: new_item | admin: new_item | ALLOWED | ALLOWED | PASS |  |
| ACTION: new_item | accountant: new_item | REFUSED | REFUSED | PASS | PermissionError  |
| ACTION: new_item | salesman: new_item | ALLOWED | ALLOWED | PASS |  |
| ACTION: new_item | restricted: new_item | REFUSED | REFUSED | PASS | PermissionError  |
| ACTION: new_item | readonly: new_item | REFUSED | REFUSED | PASS | PermissionError  |
| ACTION: export_items | admin: export_items | ALLOWED | ALLOWED | PASS |  |
| ACTION: export_items | accountant: export_items | ALLOWED | REFUSED | FINDING | PermissionError frappe.exceptions.PermissionError |
| ACTION: export_items | salesman: export_items | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: export_items | restricted: export_items | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: export_items | readonly: export_items | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: shop_settings | admin: shop_settings | ALLOWED | ALLOWED | PASS |  |
| ACTION: shop_settings | accountant: shop_settings | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: shop_settings | salesman: shop_settings | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: shop_settings | restricted: shop_settings | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: shop_settings | readonly: shop_settings | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: loyalty_settings | admin: loyalty_settings | ALLOWED | ALLOWED | PASS |  |
| ACTION: loyalty_settings | accountant: loyalty_settings | REFUSED | ALLOWED | FINDING |  |
| ACTION: loyalty_settings | salesman: loyalty_settings | REFUSED | ALLOWED | FINDING |  |
| ACTION: loyalty_settings | restricted: loyalty_settings | REFUSED | ALLOWED | FINDING |  |
| ACTION: loyalty_settings | readonly: loyalty_settings | REFUSED | ALLOWED | FAIL |  |
| ACTION: backup | admin: backup | ALLOWED | ALLOWED | PASS |  |
| ACTION: backup | accountant: backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: backup | salesman: backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: backup | restricted: backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: backup | readonly: backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: restore_backup | admin: restore_backup | ALLOWED | ERROR 417 | FINDING | ValidationError ["{\"message\": \"Type RESTORE to confirm database restoration\", \"title\": \"Message\", \"indicator\": \"red\", \"raise_exception\": 1, \"__fr |
| ACTION: restore_backup | accountant: restore_backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: restore_backup | salesman: restore_backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: restore_backup | restricted: restore_backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| ACTION: restore_backup | readonly: restore_backup | REFUSED | REFUSED | PASS | PermissionError frappe.exceptions.PermissionError |
| MATRIX | matrix recorded | true | true | PASS | {"view_bills": {"admin": "ALLOWED", "accountant": "ALLOWED", "salesman": "REFUSED", "restricted": "REFUSED", "readonly": "REFUSED"}, "create_bill": {"admin": "A |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"series": {"created": [], "deleted": [], "changed": ["SANTU-BILL-NO"], "counts": [0, 0, 1]}} | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {"Sales Invoice": 13, "Item": 1, "Customer": 1, "Stock Ledger Entry": 9, "Notification Settings": 2, "User": 2, "GL Entry": 36, "Item Price": 1, "Contact": 3, " | FAIL |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
