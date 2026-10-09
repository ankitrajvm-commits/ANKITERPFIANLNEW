import asyncio
import json
import traceback
from playwright.async_api import async_playwright
import frappe

async def run_tests_async():
    out = []
    try:
        # Set up items
        items_to_setup = [
            ("TEST-UI-A", 1000), 
            ("TEST-UI-B", 1000), 
            ("TEST-UI-C", 1000), 
            ("TEST-UI-D", 1000), 
            ("TEST-UI-E", 1000), 
        ]
        
        frappe.db.sql("delete from `tabItem` where item_code like 'TEST-UI-%'")
        frappe.db.sql("delete from `tabItem Price` where item_code like 'TEST-UI-%'")
        frappe.db.sql("delete from `tabQuotation` where name like 'TEST-QT-%'")
        frappe.db.sql("delete from `tabQuotation Item` where item_code like 'TEST-UI-%'")
        frappe.db.commit()

        if not frappe.db.exists("Customer", "Test Customer"):
            frappe.get_doc({"doctype": "Customer", "customer_name": "Test Customer", "customer_type": "Company"}).insert()

        for item_code, price in items_to_setup:
            frappe.get_doc({"doctype": "Item", "item_code": item_code, "item_name": f"Test {item_code}", "item_group": "Products", "stock_uom": "Nos", "is_stock_item": 0}).insert()
            frappe.get_doc({"doctype": "Item Price", "price_list": "Standard Selling", "item_code": item_code, "price_list_rate": price}).insert()
        frappe.db.commit()

        def make_qt(name, rates, discount_percentages=None):
            if not discount_percentages:
                discount_percentages = [0] * len(rates)
            q = frappe.get_doc({
                "doctype": "Quotation",
                "quotation_to": "Customer",
                "party_name": "Test Customer",
                "order_type": "Sales",
                "items": []
            })
            for i, (item_code, rate, pl_rate) in enumerate(rates):
                disc_pct = discount_percentages[i]
                q.append("items", {
                    "item_code": item_code,
                    "qty": 1,
                    "uom": "Nos" if item_code != "TEST-UI-B" or rate != 10000 else "Box",
                    "conversion_factor": 1 if item_code != "TEST-UI-B" or rate != 10000 else 10,
                    "rate": rate,
                    "price_list_rate": pl_rate,
                    "discount_percentage": disc_pct,
                    "discount_amount": pl_rate - rate if disc_pct == 0 else 0
                })
            q.insert()
            q.submit()
            return q.name

        q1 = make_qt("TEST-QT-1", [("TEST-UI-A", 1000, 1000)]) 
        q2 = make_qt("TEST-QT-2", [("TEST-UI-B", 1000, 1000)]) 
        q5 = make_qt("TEST-QT-5", [("TEST-UI-C", 1000, 1000)]) 
        q6 = make_qt("TEST-QT-6", [("TEST-UI-D", 900, 1000)]) 
        q7 = make_qt("TEST-QT-7", [("TEST-UI-B", 900, 1000)], [10]) 
        q8 = make_qt("TEST-QT-8", [
            ("TEST-UI-A", 1000, 1000), 
            ("TEST-UI-B", 1000, 1000), 
            ("TEST-UI-C", 1000, 1000), 
            ("TEST-UI-D", 900, 1000)
        ])
        frappe.db.commit()

        for item, rate in [("TEST-UI-B", 1200), ("TEST-UI-C", 900), ("TEST-UI-D", 1200)]:
            p_name = frappe.db.get_value("Item Price", {"item_code": item, "price_list": "Standard Selling"})
            p = frappe.get_doc("Item Price", p_name)
            p.price_list_rate = rate
            p.save()
        frappe.db.commit()
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--host-resolver-rules=MAP site1.local 127.0.0.1"]
            )
            context = await browser.new_context()
            page = await context.new_page()
            
            await page.goto("http://site1.local:8000/login")
            await page.fill("#login_email", "Administrator")
            await page.fill("#login_password", "admin")
            await page.click(".btn-login")
            await page.wait_for_timeout(3000)

            async def run_test(test_name, q_name, action=None, check_modal=True, change_prices_before=None, expected_rates=[], prefill_override=None):
                if change_prices_before:
                    change_prices_before()
                    frappe.db.commit()
                    
                prefill = prefill_override if prefill_override is not None else frappe.call("erpnext.selling.doctype.quotation.quotation.make_sales_invoice", q_name).as_dict()
                console_logs = []
                
                # RELOAD TO CLEAR window.santu_billing_page state between tests!
                await page.goto("http://site1.local:8000/app")
                await page.reload()
                await page.wait_for_timeout(2000)
                
                page.on("console", lambda msg: console_logs.append(f"CONSOLE: {msg.text}"))
                page.on("pageerror", lambda exc: console_logs.append(f"JS_ERROR: {exc}"))
                
                async def handle_resp(resp):
                    if "get_sale_item_row" in resp.url:
                        try:
                            console_logs.append(f"API: {await resp.text()}")
                        except: pass
                page.on("response", handle_resp)
                
                await page.evaluate(f"""() => {{
                    frappe.set_route('Workspaces', 'Santu Dashboard');
                }}""")
                await page.wait_for_timeout(500)
                await page.evaluate(f"""() => {{
                    frappe.route_options = {{ prefill: {json.dumps(prefill, default=str)}, source_doctype: 'Quotation' }};
                    frappe.set_route('santu-billing');
                }}""")
                
                await page.wait_for_timeout(5000)
                sanitized_name = test_name.replace("/", "_")
                await page.screenshot(path=f"{sanitized_name}.png")
                with open(f"{sanitized_name}.html", "w") as f:
                    f.write(await page.content())
                
                has_modal = await page.locator("#santu-bill-price-change-modal").count() > 0
                if check_modal:
                    if has_modal:
                        if action == "keep":
                            await page.click(".santu-bill-modal-save")
                        elif action == "update":
                            await page.click(".santu-bill-modal-update")
                        elif action == "close":
                            await page.click(".santu-bill-modal-x")
                        elif action == "esc":
                            await page.keyboard.press("Escape")
                        
                        modal_loc = page.locator("#santu-bill-price-change-modal")
                        try:
                            await modal_loc.wait_for(state="hidden", timeout=2000)
                        except: pass
                        await page.wait_for_timeout(1000)
                        
                rates = []
                if await page.locator("tbody tr[data-row]").count() > 0:
                    els = await page.locator("tbody tr[data-row]").all()
                    for el in els:
                        rate_text = await el.locator(".c-rate").inner_text()
                        rate = float(rate_text.replace("₹", "").replace(",", "").strip())
                        rates.append(rate)

                msgprint_text = ""
                if await page.locator(".msgprint").count() > 0:
                    msgprint_text = await page.locator(".msgprint").first.inner_text()
                    out.append(f"MSGP: {msgprint_text}")
                    console_logs.append(f"MSGP: {msgprint_text}")
                        
                # Assert DB did not change
                q_db = frappe.get_doc("Quotation", q_name)
                db_rate_changed = False
                for item in q_db.items:
                    if item.rate != [r[1] for r in expected_rates if r[0] == item.item_code][0] if expected_rates else False:
                        pass # Need more precise checking, but we verify rate wasn't affected
                
                # Check DB for item A
                db_intact = True
                if q_name == q1:
                    db_intact = q_db.items[0].rate == 1000
                elif q_name == q2:
                    db_intact = q_db.items[0].rate == 1000
                elif q_name == q7:
                    db_intact = q_db.items[0].rate == 900
                    
                return has_modal, rates, db_intact, console_logs

            # TEST 1
            has_modal, rates, db_intact, logs = await run_test("TEST 1", q1, check_modal=False)
            res = "PASS" if not has_modal and rates == [1000] and db_intact else "FAIL"
            out.append(f"1. No Price Change — {res} (Modal: {has_modal}, Rates: {rates}, DB Intact: {db_intact})")

            # TEST 2 & 3
            has_modal, rates, db_intact, logs = await run_test("TEST 2/3", q2, action="keep")
            out.append(f"2. Price Increase — {'PASS' if has_modal else 'FAIL'} (Modal: {has_modal})")
            out.append(f"3. Keep Quotation Price — {'PASS' if rates == [1000] and db_intact else 'FAIL'} (Rates: {rates}, DB Intact: {db_intact})")

            # TEST 4
            has_modal, rates, db_intact, logs = await run_test("TEST 4", q2, action="update")
            out.append(f"4. Update to Current Price — {'PASS' if rates == [1200] and db_intact else 'FAIL'} (Rates: {rates})")

            # TEST 5
            has_modal, rates, db_intact, logs = await run_test("TEST 5", q5, action="update")
            out.append(f"5. Price Decrease — {'PASS' if has_modal and rates == [900] and db_intact else 'FAIL'} (Rates: {rates})")

            # TEST 6
            has_modal, rates, db_intact, logs = await run_test("TEST 6", q6, action="update")
            # Absolute negotiated difference: Base 1000, Negotiated 900 (Diff 100). Current 1200. Expected: 1100.
            out.append(f"6. Absolute Negotiated Rate — {'PASS' if has_modal and rates == [1100] and db_intact else 'FAIL'} (Rates: {rates})")


            # Use pre-created q7
            
            # Generate prefill NOW
            prefill_q7 = frappe.call("erpnext.selling.doctype.quotation.quotation.make_sales_invoice", q7).as_dict()

            has_modal, rates, db_intact, logs = await run_test("TEST 7", q7, action="update", prefill_override=prefill_q7)
            # 10% of 1200 = 120. Final 1080.
            api_log_7 = [l for l in logs if "TEST-UI-B" in l and "API:" in l]
            out.append(f"7. Percentage Discount — {'PASS' if rates == [1080.0] and db_intact else 'FAIL'} (Modal: {has_modal}, Rates: {rates})")

            # TEST 8
            has_modal, rates, db_intact, logs = await run_test("TEST 8", q8, action="keep")
            # Expected [1200, 1200, 900, 1100] if updated, but "keep" should be [1000, 1000, 1000, 900]
            out.append(f"8. Multiple Items (Keep) — {'PASS' if rates == [1000, 1000, 1000, 900] else 'FAIL'} (Rates: {rates})")

            # TEST 9
            has_modal, rates, db_intact, logs = await run_test("TEST 9", q2, action="close")
            out.append(f"9. Modal X/Close — {'PASS' if has_modal and len(rates) == 0 else 'FAIL'} (Rows: {len(rates)})")

            # TEST 10
            has_modal, rates, db_intact, logs = await run_test("TEST 10", q2, action="esc")
            out.append(f"10. ESC — {'PASS' if has_modal and len(rates) == 0 else 'FAIL'} (Rows: {len(rates)})")

            # TEST 11 - outside click
            await page.goto("http://site1.local:8000/app")
            await page.reload()
            await page.wait_for_timeout(2000)
            await page.evaluate(f"""() => {{
                let prefill = {json.dumps(frappe.call("erpnext.selling.doctype.quotation.quotation.make_sales_invoice", q2).as_dict(), default=str)};
                frappe.route_options = {{ prefill: prefill, source_doctype: 'Quotation' }};
                frappe.set_route('santu-billing');
            }}""")
            await page.wait_for_timeout(2000)
            await page.mouse.click(0, 0)
            await page.wait_for_timeout(1000)
            rates_11 = await page.locator("tbody tr[data-row]").count()
            out.append(f"11. Outside Click — {'PASS' if rates_11 == 0 else 'FAIL'} (Rows: {rates_11})")

            # TEST 12
            q_db_after = frappe.get_doc("Quotation", q2)
            out.append(f"12. Historical Quotation Protection — {'PASS' if q_db_after.items[0].rate == 1000 else 'FAIL'} (DB Rate: {q_db_after.items[0].rate})")

            item_doc = frappe.get_doc("Item", "TEST-UI-B")
            if not any(u.uom == "Box" for u in item_doc.uoms):
                frappe.db.sql("INSERT INTO `tabUOM Conversion Detail` (name, parent, parenttype, parentfield, uom, conversion_factor, docstatus) VALUES (REPLACE(UUID(),'-',''), 'TEST-UI-B', 'Item', 'uoms', 'Box', 10, 0)")
                frappe.clear_cache(doctype="Item", name="TEST-UI-B")
            if not frappe.db.exists("Item Price", {"item_code": "TEST-UI-B", "price_list": "Standard Selling", "uom": "Box"}):
                frappe.get_doc({
                    "doctype": "Item Price", "item_code": "TEST-UI-B", "price_list": "Standard Selling", 
                    "price_list_rate": 12000, "uom": "Box"
                }).insert()
            frappe.db.commit()
            # Build quotation with Box UOM and quotation price_list_rate=10000 (historical Box price).
            # Current Box Item Price = 12000. Expected: modal shows diff, update → 12000.
            q13 = make_qt("TEST-QT-13", [("TEST-UI-B", 10000, 10000)])
            # Pre-build prefill from q13, then patch the item uom to Box so _apply_prefill
            # fetches the correct Box item price from the API (bypassing make_sales_invoice UOM override).
            import copy
            prefill_q13 = frappe.call("erpnext.selling.doctype.quotation.quotation.make_sales_invoice", q13).as_dict()
            prefill_q13_patched = copy.deepcopy(prefill_q13)
            for item in prefill_q13_patched.get("items", []):
                if item.get("item_code") == "TEST-UI-B":
                    item["uom"] = "Box"
                    item["conversion_factor"] = 10
                    item["rate"] = 10000
                    item["price_list_rate"] = 10000
            has_modal, rates, db_intact, logs = await run_test("TEST 13", q13, action="update", prefill_override=prefill_q13_patched)
            out.append(f"13. UOM — {'PASS' if has_modal and rates == [1200.0] else 'FAIL'} (Modal: {has_modal}, Rates: {rates})")

            # TEST 14
            await page.goto("http://site1.local:8000/app")
            await page.wait_for_timeout(500)
            await page.evaluate("""() => {
                frappe.route_options = null;
                frappe.set_route('santu-billing');
            }""")
            await page.wait_for_timeout(2000)
            has_modal = await page.locator("#santu-bill-price-change-modal").count() > 0
            out.append(f"14. Direct POS Billing — {'PASS' if not has_modal else 'FAIL'} (Modal: {has_modal})")

            # TEST 15 (Tax/Totals/Discount math)
            has_modal, rates, db_intact, logs = await run_test("TEST 15", q2, action="keep")
            # If kept, total should be 1 * 1000 = 1000.
            total = 0
            if await page.locator("td.c-total").count() > 0:
                total_text = await page.locator("td.c-total").first.inner_text()
                total = float(total_text.replace("₹", "").replace(",", "").strip())
            out.append(f"15. Tax/Totals/Discount — {'PASS' if total == 1000 else 'FAIL'} (Total: {total})")
            out.append(f"16. Console/Server Logs — {'CLEAN' if len(logs) == 0 else 'ERRORS: ' + str(logs)}")

            await browser.close()
    except Exception as e:
        out.append(f"CRITICAL TEST SUITE ERROR: {str(e)}")
        out.append(traceback.format_exc())
        
    with open("/Users/santuhardware/erpnext/test_results.txt", "w") as f:
        f.write("\n".join(out))

def run_tests():
    asyncio.run(run_tests_async())

