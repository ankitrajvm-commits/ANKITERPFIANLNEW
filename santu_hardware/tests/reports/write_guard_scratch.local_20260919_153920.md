# write_guard on scratch.local (2026-09-19 15:39) — FAILED

Gate: {'functional_failures': 119, 'invariant_failures': 0, 'test_residue': 0, 'production_side_effects': 1}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. SESSION | no-role TEST user is logged in | test.norole@santuhardware.local | test.norole@santuhardware.local | PASS |  |
| A. WRITERS (must refuse a user with no roles) | every writing API refuses a user with no roles | [] | ["_fifo_pending_amounts", "_json_arg", "add_item_uom_conversion", "add_manual_due", "add_uom_conversion", "app_lock_device_forget", "app_lock_touch_id_register_ | FAIL | 266 called, 20 skipped (bridge / guest) |
| A. WRITERS (must refuse a user with no roles) | open writer: _fifo_pending_amounts | REFUSED | HTTP 500 TypeError TypeError: _fifo_pending_amounts() missing 2 required positional arguments: 'party_type' a | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: _json_arg | REFUSED | HTTP 500 TypeError TypeError: _json_arg() missing 1 required positional argument: 'value' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: add_item_uom_conversion | REFUSED | HTTP 500 TypeError TypeError: add_item_uom_conversion() missing 3 required positional arguments: 'item_code', | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: add_manual_due | REFUSED | HTTP 500 TypeError TypeError: add_manual_due() missing 2 required positional arguments: 'customer' and 'amoun | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: add_uom_conversion | REFUSED | HTTP 500 TypeError TypeError: add_uom_conversion() missing 3 required positional arguments: 'from_uom', 'to_u | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: app_lock_device_forget | REFUSED | HTTP 417 ValidationError ["{\"message\": \"Sirf System Manager fingerprint unlock hata sakta hai.\", \"title\": \"M | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: app_lock_touch_id_register_finish | REFUSED | HTTP 500 TypeError TypeError: app_lock_touch_id_register_finish() missing 3 required positional arguments: 'c | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: app_lock_touch_id_register_options | REFUSED | HTTP 417 ValidationError ["{\"message\": \"Sirf System Manager fingerprint unlock set kar sakta hai.\", \"title\":  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: apply_printer_density | REFUSED | HTTP 500 TypeError TypeError: apply_printer_density() missing 2 required positional arguments: 'printer_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: attach_barcode_to_item | REFUSED | HTTP 500 TypeError TypeError: attach_barcode_to_item() missing 2 required positional arguments: 'item_code' a | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_brand | REFUSED | HTTP 500 TypeError TypeError: create_brand() missing 1 required positional argument: 'brand_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_customer_full | REFUSED | HTTP 500 TypeError TypeError: create_customer_full() missing 1 required positional argument: 'party' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_item_master | REFUSED | HTTP 500 TypeError TypeError: create_item_master() missing 2 required positional arguments: 'doctype' and 'na | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_payment_entry | REFUSED | HTTP 500 TypeError TypeError: create_payment_entry() missing 4 required positional arguments: 'party_type', ' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_payment_mode | REFUSED | HTTP 500 TypeError TypeError: create_payment_mode() missing 1 required positional argument: 'mode_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_purchase_invoices_from_bills | REFUSED | HTTP 500 TypeError TypeError: create_purchase_invoices_from_bills() missing 1 required positional argument: ' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_return_refund_payment | REFUSED | HTTP 500 TypeError TypeError: create_return_refund_payment() missing 2 required positional arguments: 'doctyp | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_staff_user | REFUSED | HTTP 500 TypeError TypeError: create_staff_user() missing 2 required positional arguments: 'full_name' and 'e | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_supplier_full | REFUSED | HTTP 500 TypeError TypeError: create_supplier_full() missing 1 required positional argument: 'party' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: delete_item | REFUSED | HTTP 500 TypeError TypeError: delete_item() missing 1 required positional argument: 'item_code' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: delete_party | REFUSED | HTTP 500 TypeError TypeError: delete_party() missing 2 required positional arguments: 'party_type' and 'party | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: delete_quotation | REFUSED | HTTP 500 TypeError TypeError: delete_quotation() missing 1 required positional argument: 'name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: delete_sale_invoice | REFUSED | HTTP 417 ValidationError ["{\"message\": \"Document name is required\", \"title\": \"Message\", \"indicator\": \"re | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: edit_submitted_document | REFUSED | HTTP 500 TypeError TypeError: edit_submitted_document() missing 3 required positional arguments: 'doctype', ' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: edit_submitted_sale_invoice | REFUSED | HTTP 500 TypeError TypeError: edit_submitted_sale_invoice() missing 2 required positional arguments: 'invoice | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: fill_missing_item_master_data | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: fix_stock | REFUSED | HTTP 500 TypeError TypeError: fix_stock() missing 3 required positional arguments: 'item_code', 'new_qty', an | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: force_overwrite_item_unit | REFUSED | HTTP 500 TypeError TypeError: force_overwrite_item_unit() missing 1 required positional argument: 'item_code' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: item_batches | REFUSED | HTTP 500 TypeError TypeError: item_batches() missing 1 required positional argument: 'item_code' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: item_uoms | REFUSED | HTTP 500 TypeError TypeError: item_uoms() missing 1 required positional argument: 'item_code' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: items_with_same_name | REFUSED | HTTP 500 TypeError TypeError: items_with_same_name() missing 1 required positional argument: 'item_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: party_first_transaction_date | REFUSED | HTTP 500 TypeError TypeError: party_first_transaction_date() missing 2 required positional arguments: 'party_ | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: print_density_test | REFUSED | HTTP 417 TestUserPrintBlocked santu_hardware.santu_hardware.print_service.TestUserPrintBlocked: Only the live shop site  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: push_bill_row_to_master | REFUSED | HTTP 500 TypeError TypeError: push_bill_row_to_master() missing 1 required positional argument: 'item_code' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: quick_create_item | REFUSED | HTTP 500 TypeError TypeError: quick_create_item() missing 2 required positional arguments: 'item_name' and 's | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: receive_stock_simple | REFUSED | HTTP 500 TypeError TypeError: receive_stock_simple() missing 2 required positional arguments: 'item_code' and | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: rename_item_master | REFUSED | HTTP 500 TypeError TypeError: rename_item_master() missing 3 required positional arguments: 'doctype', 'old_n | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: reset_loyalty_points_before_today | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: sale_uom_options | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_delivery_note | REFUSED | HTTP 500 TypeError TypeError: save_delivery_note() missing 1 required positional argument: 'challan_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_expense | REFUSED | HTTP 500 TypeError TypeError: save_expense() missing 1 required positional argument: 'expense_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_item | REFUSED | HTTP 500 TypeError TypeError: save_item() missing 1 required positional argument: 'item_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_party_transfer | REFUSED | HTTP 500 TypeError TypeError: save_party_transfer() missing 1 required positional argument: 'transfer_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_purchase_invoice | REFUSED | HTTP 500 TypeError TypeError: save_purchase_invoice() missing 1 required positional argument: 'invoice_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_purchase_order | REFUSED | HTTP 500 TypeError TypeError: save_purchase_order() missing 1 required positional argument: 'order_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_purchase_return | REFUSED | HTTP 500 TypeError TypeError: save_purchase_return() missing 1 required positional argument: 'return_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_quotation | REFUSED | HTTP 500 TypeError TypeError: save_quotation() missing 1 required positional argument: 'quotation_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_sale_invoice | REFUSED | HTTP 500 TypeError TypeError: save_sale_invoice() missing 1 required positional argument: 'invoice_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_sales_order | REFUSED | HTTP 500 TypeError TypeError: save_sales_order() missing 1 required positional argument: 'order_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_sales_return | REFUSED | HTTP 500 TypeError TypeError: save_sales_return() missing 1 required positional argument: 'return_json' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_app_lock_pin | REFUSED | HTTP 417 ValidationError ["{\"message\": \"Only a System Manager can change the app login PIN.\", \"title\": \"Mess | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_document_template | REFUSED | HTTP 500 TypeError TypeError: set_document_template() missing 3 required positional arguments: 'library', 'do | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_item_stock | REFUSED | HTTP 500 TypeError TypeError: set_item_stock() missing 2 required positional arguments: 'item_code' and 'new_ | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_payment_mode_enabled | REFUSED | HTTP 500 TypeError TypeError: set_payment_mode_enabled() missing 2 required positional arguments: 'mode' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_printer_density | REFUSED | HTTP 500 TypeError TypeError: set_printer_density() missing 2 required positional arguments: 'printer_name' a | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: set_privacy_pin | REFUSED | HTTP 500 TypeError TypeError: set_privacy_pin() missing 1 required positional argument: 'new_pin' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: touch_id_login_finish | REFUSED | HTTP 500 TypeError TypeError: touch_id_login_finish() missing 4 required positional arguments: 'credential_id | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: touch_id_login_options | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: touch_id_register_finish | REFUSED | HTTP 500 TypeError TypeError: touch_id_register_finish() missing 3 required positional arguments: 'credential | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: touch_id_register_options | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: uom_abbr | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_customer_note | REFUSED | HTTP 500 TypeError TypeError: update_customer_note() missing 2 required positional arguments: 'customer' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_item_field | REFUSED | HTTP 500 TypeError TypeError: update_item_field() missing 2 required positional arguments: 'item_code' and 'f | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_item_rate | REFUSED | HTTP 500 TypeError TypeError: update_item_rate() missing 3 required positional arguments: 'item_code', 'kind' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_party_details | REFUSED | HTTP 500 TypeError TypeError: update_party_details() missing 2 required positional arguments: 'party_type' an | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_party_phone | REFUSED | HTTP 500 TypeError TypeError: update_party_phone() missing 3 required positional arguments: 'party_type', 'pa | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_shop_profile | REFUSED | HTTP 500 TypeError TypeError: update_shop_profile() missing 1 required positional argument: 'company' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: update_supplier_note | REFUSED | HTTP 500 TypeError TypeError: update_supplier_note() missing 2 required positional arguments: 'supplier' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: recent_bugs | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: report_browser_errors | REFUSED | HTTP 500 TypeError TypeError: report_browser_errors() missing 1 required positional argument: 'errors' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: report_bug_from_user | REFUSED | HTTP 500 TypeError TypeError: report_bug_from_user() missing 1 required positional argument: 'what_happened' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: unread_bug_count | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_dashboard_widgets | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: apply_fix | REFUSED | HTTP 500 TypeError TypeError: apply_fix() missing 1 required positional argument: 'fix' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: fix_everything | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: run_checks | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: fetch_item_highlight_rules | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_item_highlight_rules | REFUSED | HTTP 500 TypeError TypeError: save_item_highlight_rules() missing 1 required positional argument: 'rules' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: confirm_print_job | REFUSED | HTTP 500 TypeError TypeError: confirm_print_job() missing 1 required positional argument: 'job_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_print_job | REFUSED | HTTP 500 TypeError TypeError: create_print_job() missing 2 required positional arguments: 'invoice_doctype' a | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: dismiss_print_jobs | REFUSED | HTTP 500 TypeError TypeError: dismiss_print_jobs() missing 1 required positional argument: 'job_names' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: open_print_jobs | REFUSED | HTTP 200   | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: print_customer_khata | REFUSED | HTTP 500 TypeError TypeError: print_customer_khata() missing 1 required positional argument: 'customer' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: print_supplier_khata | REFUSED | HTTP 500 TypeError TypeError: print_supplier_khata() missing 1 required positional argument: 'supplier' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: print_via_cups | REFUSED | HTTP 500 TypeError TypeError: print_via_cups() missing 2 required positional arguments: 'invoice_doctype' and | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: print_via_usb | REFUSED | HTTP 500 TypeError TypeError: print_via_usb() missing 2 required positional arguments: 'invoice_doctype' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: record_print_attempt | REFUSED | HTTP 500 TypeError TypeError: record_print_attempt() missing 2 required positional arguments: 'job_name' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: retry_print_job | REFUSED | HTTP 500 TypeError TypeError: retry_print_job() missing 1 required positional argument: 'job_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: test_print | REFUSED | HTTP 417 TestUserPrintBlocked santu_hardware.santu_hardware.print_service.TestUserPrintBlocked: Only the live shop site  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: disable_user_access | REFUSED | HTTP 500 TypeError TypeError: disable_user_access() missing 1 required positional argument: 'user' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: remove_backup | REFUSED | HTTP 500 TypeError TypeError: remove_backup() missing 1 required positional argument: 'backup_log_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: restore_site_backup | REFUSED | HTTP 500 TypeError TypeError: restore_site_backup() missing 2 required positional arguments: 'backup_log_name | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_user_roles | REFUSED | HTTP 500 TypeError TypeError: save_user_roles() missing 2 required positional arguments: 'user' and 'roles' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: retry_whatsapp_message | REFUSED | HTTP 500 TypeError TypeError: retry_whatsapp_message() missing 1 required positional argument: 'log_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_whatsapp_message | REFUSED | HTTP 500 TypeError TypeError: send_whatsapp_message() missing 2 required positional arguments: 'doctype' and  | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: bulk_update_items | REFUSED | HTTP 500 TypeError TypeError: bulk_update_items() missing 1 required positional argument: 'updates' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: generate_barcode_labels | REFUSED | HTTP 500 TypeError TypeError: generate_barcode_labels() missing 1 required positional argument: 'items' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: import_items_valid | REFUSED | HTTP 500 TypeError TypeError: import_items_valid() missing 1 required positional argument: 'rows' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: import_parties | REFUSED | HTTP 500 TypeError TypeError: import_parties() missing 1 required positional argument: 'rows' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: match_pdf_items_for_bulk_update | REFUSED | HTTP 500 TypeError TypeError: match_pdf_items_for_bulk_update() missing 1 required positional argument: 'file | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: parse_items_import_file | REFUSED | HTTP 500 TypeError TypeError: parse_items_import_file() missing 1 required positional argument: 'file_url' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: parse_items_import_file_from_pdf | REFUSED | HTTP 500 TypeError TypeError: parse_items_import_file_from_pdf() missing 1 required positional argument: 'fil | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: parse_parties_import_file | REFUSED | HTTP 500 TypeError TypeError: parse_parties_import_file() missing 1 required positional argument: 'file_url' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: restore_deleted_document | REFUSED | HTTP 500 TypeError TypeError: restore_deleted_document() missing 1 required positional argument: 'name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_business_setup | REFUSED | HTTP 500 TypeError TypeError: save_business_setup() missing 1 required positional argument: 'data' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: delete_voice_rule | REFUSED | HTTP 500 TypeError TypeError: delete_voice_rule() missing 1 required positional argument: 'rule_id' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: save_voice_rule | REFUSED | HTTP 500 TypeError TypeError: save_voice_rule() missing 2 required positional arguments: 'phrase' and 'target | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: test_voice_query | REFUSED | HTTP 500 TypeError TypeError: test_voice_query() missing 1 required positional argument: 'query' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: train_item_voice_alias | REFUSED | HTTP 500 TypeError TypeError: train_item_voice_alias() missing 2 required positional arguments: 'item_code' a | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: create_contact | REFUSED | HTTP 500 TypeError TypeError: create_contact() missing 2 required positional arguments: 'display_name' and 'p | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: link_party | REFUSED | HTTP 500 TypeError TypeError: link_party() missing 3 required positional arguments: 'phone', 'party_type', an | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: retry_message | REFUSED | HTTP 500 TypeError TypeError: retry_message() missing 1 required positional argument: 'chat_name' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_customer_khata | REFUSED | HTTP 500 TypeError TypeError: send_customer_khata() missing 1 required positional argument: 'customer' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_message | REFUSED | HTTP 500 TypeError TypeError: send_message() missing 2 required positional arguments: 'phone' and 'message' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_reminder | REFUSED | HTTP 500 TypeError TypeError: send_reminder() missing 2 required positional arguments: 'party_type' and 'part | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_statement | REFUSED | HTTP 500 TypeError TypeError: send_statement() missing 2 required positional arguments: 'party_type' and 'par | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_supplier_khata | REFUSED | HTTP 500 TypeError TypeError: send_supplier_khata() missing 1 required positional argument: 'supplier' | FAIL |  |
| A. WRITERS (must refuse a user with no roles) | open writer: send_transaction | REFUSED | HTTP 500 TypeError TypeError: send_transaction() missing 2 required positional arguments: 'doctype' and 'name | FAIL |  |
| B. READERS (shop data readable with no role -- for review) | readers that answer a user with no roles (listed for Ankit) | true | true | PASS | ["bill_label", "check_privacy_mode_pin", "download_customer_khata", "download_supplier_khata", "export_santu_report", "find_item_by_barcode", "format_bill_no",  |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"single:Santu Backup Settings": {"created": [], "deleted": [], "changed": ["auto_backup_enabled"], "counts": [0, 0, 1]}} | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
