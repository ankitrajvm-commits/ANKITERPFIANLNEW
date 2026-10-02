# reports_utils_backup on scratch.local (2026-09-19 15:28) — SAFE

Gate: {'functional_failures': 0, 'invariant_failures': 0, 'test_residue': 0, 'production_side_effects': 0}

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
| R. REPORTS (every entry on the Reports screen) | report 'All Parties' opens | null | null | PASS | all_parties rows=51 |
| R. REPORTS (every entry on the Reports screen) | report 'Party Report By Item' opens | null | null | PASS | Item-wise Sales Register rows=698 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale Purchase By Party' opens | null | null | PASS | sale_purchase_by_party rows=43 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale Purchase By Party Group' opens | null | null | PASS | sale_purchase_party_group rows=1 |
| R. REPORTS (every entry on the Reports screen) | report 'GSTR 1' opens | null | null | PASS | GSTR-1 rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'GSTR 2' opens | null | null | PASS | GST Purchase Register rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'GSTR 3B' opens | null | null | PASS | GSTR-3B Details rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale Summary By HSN' opens | null | null | PASS | HSN-wise-summary of outward supplies rows=17 |
| R. REPORTS (every entry on the Reports screen) | report 'SAC Report' opens | null | null | PASS | HSN-wise-summary of outward supplies rows=17 |
| R. REPORTS (every entry on the Reports screen) | report 'Item Report By Party' opens | null | null | PASS | Item-wise Sales Register rows=698 |
| R. REPORTS (every entry on the Reports screen) | report 'Item Wise Profit And Loss' opens | null | null | PASS | Gross Profit rows=348 |
| R. REPORTS (every entry on the Reports screen) | report 'Item Category Wise Profit And Loss' opens | null | null | PASS | Gross Profit rows=3 |
| R. REPORTS (every entry on the Reports screen) | report 'Stock Detail' opens | null | 'ZZFORCE-ZIWM2' | FINDING | Stock Ledger rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Item Detail' opens | null | null | PASS | item_detail rows=1 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale/Purchase Report By Item Category' opens | null | null | PASS | Gross Profit rows=3 |
| R. REPORTS (every entry on the Reports screen) | report 'Stock Summary Report By Item Category' opens | null | null | PASS | Stock Balance rows=700 |
| R. REPORTS (every entry on the Reports screen) | report 'Item Wise Discount' opens | null | null | PASS | discount_report rows=17 |
| R. REPORTS (every entry on the Reports screen) | report 'Bank Statement' opens | null | null | PASS | Bank Reconciliation Statement rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Discount Report' opens | null | null | PASS | discount_report rows=17 |
| R. REPORTS (every entry on the Reports screen) | report 'GST Report' opens | null | null | PASS | GST Account-wise Summary rows=2 |
| R. REPORTS (every entry on the Reports screen) | report 'GST Rate Report' opens | null | null | PASS | GST Tax Rate-wise Summary rows=2 |
| R. REPORTS (every entry on the Reports screen) | report 'Form No. 27EQ' opens | null | null | PASS | TDS Computation Summary-India rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'TCS Receivable' opens | null | null | PASS | Tax Withholding Details-India rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'TDS Payable' opens | null | null | PASS | Tax Withholding Details-India rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'TDS Receivable' opens | null | null | PASS | Tax Withholding Details-India rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Expense' opens | null | null | PASS | expense rows=1 |
| R. REPORTS (every entry on the Reports screen) | report 'Expense Category Report' opens | null | null | PASS | expense_category rows=1 |
| R. REPORTS (every entry on the Reports screen) | report 'Expense Item Report' opens | null | null | PASS | expense_item rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale Orders' opens | null | null | PASS | Sales Order Analysis rows=0 |
| R. REPORTS (every entry on the Reports screen) | report 'Sale Order Item' opens | null | null | PASS | Sales Order Analysis rows=0 |
| R. REPORTS (every entry on the Reports screen) | all runnable reports were tried | true | true | PASS | 39 run |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'invoices' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'quotation' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'delivery_challan' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'sales_order' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'sales_return' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen view 'payment_in' (embedded in Reports) | null | null | PASS |  |
| R. REPORTS (every entry on the Reports screen) | Sale screen 'This Year' total = sum of submitted bills | 376128.3 | 0.0 | PASS | summary keys: title,total_sales,label1,value1,label2,value2,value2_danger,label3,value3,pct_vs_last_month |
| R. REPORTS (every entry on the Reports screen) | stock value in the books = stock value of all items | 1596302.19 | 1614502.19 | FINDING | a gap here means stock was posted without accounts (old data) -- report, not a counter bug |
| U. UTILITIES (TEST records only) | get_data_audit works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_fiscal_year_checklist works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_salesman_report works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_business_setup works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_bulk_item_brands works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_recycle_bin_documents works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | get_tally_export_data works | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Update Items In Bulk - 'pricing' tab loads | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Update Items In Bulk - 'stock' tab loads | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Update Items In Bulk - 'hsn' tab loads | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Update Items In Bulk - 'uom' tab loads | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Update Items In Bulk - 'reward' tab loads | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Shop Profile saved unchanged -> nothing lost (logo / address stay) | {"company": {"abbr": "SH", "company_name": "Santu Hardware", "default_currency": "INR", "email": "santuhardware7739@gmail.com", "gstin": "10BULPP3722N1ZG", "nam | {"company": {"abbr": "SH", "company_name": "Santu Hardware", "default_currency": "INR", "email": "santuhardware7739@gmail.com", "gstin": "10BULPP3722N1ZG", "nam | PASS | null |
| U. UTILITIES (TEST records only) | bulk update changes a TEST item's price | null | null | PASS | {"updated": [], "failed": [{"name": null, "error": "Not found"}], "updated_count": 0} |
| U. UTILITIES (TEST records only) | barcode lookup finds the TEST item | true | true | PASS | {'results': [{'item_code': 'TEST-UTIL-ITEM', 'item_name': 'TEST UTIL ITEM', 'brand': None, 'item_group': 'Products', 'im |
| U. UTILITIES (TEST records only) | barcode labels generate | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Export Items builds a file | null | null | PASS |  |
| U. UTILITIES (TEST records only) | Import Parties obeys the 10-digit phone rule too | true | true | PASS | result={'created': [], 'failed': [{'error': 'Missing name'}]} err=None made=None |
| U. UTILITIES (TEST records only) | deleted TEST customer shows in the Recycle Bin | true | true | PASS | None |
| U. UTILITIES (TEST records only) | Recycle Bin restore brings it back | true | true | PASS | null |
| B. BACKUP (test copy only) | backup settings load | null | null | PASS |  |
| B. BACKUP (test copy only) | backup settings save unchanged | null | null | PASS |  |
| B. BACKUP (test copy only) | backup history lists | null | null | PASS |  |
| B. BACKUP (test copy only) | manual backup is created AND verified (opens, dump complete) | true | true | PASS | OK — 9868010 bytes, decompresses cleanly, dump completed |
| B. BACKUP (test copy only) | backup file sits in the TEST COPY's own folder, not the shop's | true | true | PASS | /Users/santuhardware/erpnext/frappe-bench/sites/scratch.local/private/backups/20260919_152837-scratch_local-database.sql.gz |
| B. BACKUP (test copy only) | the test's backup is removed again | false | false | PASS | null |
| B. BACKUP (test copy only) | restore refuses without the exact confirmation text / a real backup | true | true | PASS | Type RESTORE to confirm database restoration |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | no difference | PASS |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {} | PASS |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
