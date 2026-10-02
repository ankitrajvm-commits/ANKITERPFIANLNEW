# failure_first on scratch.local (2026-09-19 11:41) — FAILED

Gate: {'functional_failures': 12, 'invariant_failures': 0, 'test_residue': 3, 'production_side_effects': 1}

| Section | Check | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0. SETUP (TEST fixtures) | fixtures ready | true | true | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 1 opening 100 @ Rs10: Bin qty | 100 | 100.0 | PASS | SLE sum qty=100.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 1 opening 100 @ Rs10: Bin qty = sum of stock ledger | 100.0 | 100.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 1 opening 100 @ Rs10: Bin value = sum of stock-ledger value | 1000.0 | 1000.0 | PASS | rate=10.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 1 opening 100 @ Rs10: stock value | 1000 | 1000.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 2 purchase 50 @ Rs16: Bin qty | 150 | 150.0 | PASS | SLE sum qty=150.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 2 purchase 50 @ Rs16: Bin qty = sum of stock ledger | 150.0 | 150.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 2 purchase 50 @ Rs16: Bin value = sum of stock-ledger value | 1800.0 | 1800.0 | PASS | rate=12.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 2 purchase 50 @ Rs16: stock value | 1800 | 1800.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 3 sale 30 (moving avg Rs12): Bin qty | 120 | 120.0 | PASS | SLE sum qty=120.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 3 sale 30 (moving avg Rs12): Bin qty = sum of stock ledger | 120.0 | 120.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 3 sale 30 (moving avg Rs12): Bin value = sum of stock-ledger value | 1500.0 | 1500.0 | PASS | rate=12.5 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 3 sale 30 (moving avg Rs12): stock value | 1440 | 1500.0 | FAIL |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 4 sales return 10: Bin qty | 130 | 130.0 | PASS | SLE sum qty=130.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 4 sales return 10: Bin qty = sum of stock ledger | 130.0 | 130.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 4 sales return 10: Bin value = sum of stock-ledger value | 1600.0 | 1600.0 | PASS | rate=12.3077 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 4 sales return 10: stock value | 1560 | 1600.0 | FAIL |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 5 purchase return 20: Bin qty | 110 | 110.0 | PASS | SLE sum qty=110.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 5 purchase return 20: Bin qty = sum of stock ledger | 110.0 | 110.0 | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 5 purchase return 20: Bin value = sum of stock-ledger value | 1280.0 | 1280.0 | PASS | rate=11.6364 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 6 adjustment (fix_stock to 105) accepted | null | null | PASS |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 6 after adjustment: Bin qty | 105 | 105.0 | PASS | SLE sum qty=110.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 6 after adjustment: Bin qty = sum of stock ledger | 110.0 | 105.0 | FAIL |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 6 after adjustment: Bin value = sum of stock-ledger value | 1221.82 | 1221.82 | PASS | rate=11.6364 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 7 edit bill (30 -> 25) = cancel + re-submit | null | null | PASS | SINV-26-01136-1 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 7 after edit (5 back on the shelf): Bin qty | 110 | 80.0 | FAIL | SLE sum qty=115.0 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 7 after edit (5 back on the shelf): Bin qty = sum of stock ledger | 115.0 | 80.0 | FAIL |  |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 7 after edit (5 back on the shelf): Bin value = sum of stock-ledger value | 1230.91 | 930.91 | FAIL | rate=11.6364 |
| L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified) | 7 edited bill keeps its number | 873 | 873 | PASS |  |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | customer ledger (GL) = billed - paid - payments | 125.0 | 125.0 | PASS | billed=465.0 paid_with_bills=40.0 payments=300.0 refunds=0 |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | payment ledger = customer ledger | 125.0 | 125.0 | PASS |  |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | khata shown to the shop = customer ledger | 125.0 | 125.0 | PASS |  |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | stock account in the books = stock value moved by the same vouchers | 501184.36 | 501184.36 | PASS |  |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | every TEST voucher balances | 0 | 0 | PASS | [] |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | discount of Rs10 shows as total - grand total | 10.0 | 0.0 | FAIL |  |
| M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers) | bill SINV-26-01137: outstanding = payment ledger | 0.0 | -250.0 | FAIL |  |
| H. CONCURRENCY / RACE | same bill cancelled from 2 places at once: bill ends cancelled exactly once | 2 | 2 | PASS | ok=1 refused=['(1020, "Record has changed since last read in table \'tabsales invoice\'; try restarting transaction")'] |
| H. CONCURRENCY / RACE |   ...and its stock came back once, not twice | 1 | 1 | PASS |  |
| H. CONCURRENCY / RACE | same bill edited from 2 places at once: ONE live bill with that number | 1 | 1 | PASS | live=['SINV-26-01140-1'] ok=1 refused=['Bill abhi kisi aur kaam me lagi hui thi, isliye sudhaar nahi ho paya. Ek baar au'] |
| H. CONCURRENCY / RACE | 4 users x 60 lines x 1.5 qty x discount x udhaar at once: all 4 saved | 4 | 4 | PASS | [] |
| H. CONCURRENCY / RACE |   ...4 different bill numbers | 4 | 4 | PASS | [878, 879, 880, 881] |
| H. CONCURRENCY / RACE |   ...stock went down by exactly 4 x 60 x 1.5 = 360 | 99637.0 | 99637.0 | PASS |  |
| J. IDEMPOTENCY / DOUBLE-CLICK (server side) | same offline bill sent 3 times AT ONCE -> exactly one bill | 1 | 1 | PASS | results=['SINV-26-01145', 'SINV-26-01145', 'SINV-26-01145'] errors=[] |
| J. IDEMPOTENCY / DOUBLE-CLICK (server side) | FINDING: Payment In called twice with the same data | 1 (if a request key existed) | 2 | PASS | server has no request key; the screen's button lock is the only guard -> tested in the UI pass |
| K. BOUNDARY / FUZZ | Rs 0.01 line: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | Rs 0.01 line: total right | 0.01 | 0.01 | PASS |  |
| K. BOUNDARY / FUZZ | Rs 99,99,99,999 line: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | Rs 99,99,99,999 line: total right | 999999999.0 | 999999999.0 | PASS |  |
| K. BOUNDARY / FUZZ | qty 0.01: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | qty 0.01: total right | 0.5 | 0.5 | PASS |  |
| K. BOUNDARY / FUZZ | qty 10,00,000: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | qty 10,00,000: total right | 1000000.0 | 1000000.0 | PASS |  |
| K. BOUNDARY / FUZZ | 100% discount: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | 100% discount: total right | 0.0 | 0.0 | PASS |  |
| K. BOUNDARY / FUZZ | 100 lines: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | 100 lines: total right | 5050.0 | 5050.0 | PASS |  |
| K. BOUNDARY / FUZZ | 500 lines: bill saves | null | null | PASS |  |
| K. BOUNDARY / FUZZ | 500 lines: total right | 500.0 | 500.0 | PASS |  |
| K. BOUNDARY / FUZZ | negative qty on a sale is refused | true | true | PASS | TEST-FUZZ ki qty sahi daaliye. |
| K. BOUNDARY / FUZZ | negative rate is refused | true | true | PASS | TEST-FUZZ ka rate sahi daaliye. |
| K. BOUNDARY / FUZZ | unknown item is refused | true | true | PASS | Item TEST-DOES-NOT-EXIST not found |
| K. BOUNDARY / FUZZ | customer with emoji / Hindi / HTML / SQL-looking name is saved | true | false | FAIL | Name cannot contain special characters like '<', '>' |
| K. BOUNDARY / FUZZ | bad phone '12345' is refused | true | false | FAIL | TEST PHONE 12345 |
| K. BOUNDARY / FUZZ | bad phone 'abcdefghij' is refused | true | true | PASS | abcdefghij is not a valid Phone Number |
| K. BOUNDARY / FUZZ | bad phone '99999999999999' is refused | true | false | FAIL | TEST PHONE 99999999999999 |
| K. BOUNDARY / FUZZ | same new item created twice -> not two items | 1 | 0 | FAIL | e1=Abhi kitna hai? — stock batana zaroori hai naya saman banane ke liye. e2=Abhi kitna hai? — stock batana zaroori hai naya saman banane ke liye. items=[] |
| O. RECOVERY / ROLLBACK (failure injected half-way) | bill whose ledger posting fails is refused | true | true | PASS | TEST injected ledger failure |
| O. RECOVERY / ROLLBACK (failure injected half-way) |   ...no half-saved bill left | 11 | 11 | PASS | [{"name": "SINV-26-01144", "docstatus": 1}, {"name": "SINV-26-01143", "docstatus": 1}] |
| O. RECOVERY / ROLLBACK (failure injected half-way) |   ...no stock moved | 247 | 247 | PASS |  |
| O. RECOVERY / ROLLBACK (failure injected half-way) |   ...no bill number burned | 889 | 889 | PASS |  |
| O. RECOVERY / ROLLBACK (failure injected half-way) | return whose stock posting fails is refused | true | true | PASS | TEST injected stock failure |
| O. RECOVERY / ROLLBACK (failure injected half-way) |   ...no half-saved return left | 1 | 1 | PASS |  |
| GATES | DATA ISOLATION: no real record created / changed / deleted | no difference | {"series": {"created": [], "deleted": [], "changed": ["SANTU-BILL-NO"], "counts": [0, 0, 1]}} | FAIL |  |
| GATES | TEST RESIDUE: nothing of the test user left behind | {} | {"Sales Invoice": 1, "File": 4, "GL Entry": 3} | FAIL |  |
| GATES | PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched | {} | {} | PASS |  |
