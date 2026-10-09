"""Billing torture test (2026-09-19 request: "extreme test ... stock 0 ho phir
v warning ke saath bill ho jay ya stock ka cp add naa ho phir v bill ho jaye,
billing me koi dikkat naa aaye").

Rules this file keeps:
  * runs as the test user, never Administrator
  * every record it makes is named TEST... and is deleted at the end
  * it only ever sells TEST items -- no real item's stock is touched
  * bill / estimate counters are put back on the last real number
  * nothing is printed and nothing is sent (no WhatsApp, no printer)

Run:  cd frappe-bench/sites && ../env/bin/python ../apps/santu_hardware/santu_hardware/tests/suite_billing_extreme.py
"""
import json
import os
import subprocess
import sys
import time

import frappe

frappe.init(site=__import__("os").environ.get("SANTU_TEST_SITE", "scratch.local"))
frappe.connect()
from santu_hardware.tests.claude_test_user import TEST_USER, use_test_user_with_cleanup  # noqa: E402

use_test_user_with_cleanup()

from frappe.utils import flt, today  # noqa: E402

import santu_hardware.santu_hardware.api as a  # noqa: E402

PASS, FAIL = [], []


def check(name, ok, detail=""):
	(PASS if ok else FAIL).append(name)
	print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   [{str(detail)[:220]}]" if detail != "" else ""))


def section(t):
	print("\n" + "=" * 74 + "\n" + t + "\n" + "=" * 74)


def err(fn):
	try:
		fn()
		return None
	except Exception as e:  # noqa: BLE001
		frappe.db.rollback()
		return str(e)[:300]


COMPANY = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
WH = a.default_selling_warehouse(COMPANY)
CUST = "TEST GRAHAK"
MADE = {"Sales Invoice": [], "Delivery Note": [], "Stock Entry": [], "Stock Reconciliation": []}
SERIES = ("SANTU-BILL-NO", "SANTU-ESTIMATE-NO")
_series_before = {s: frappe.db.sql("select current from tabSeries where name=%s", s)[0][0] for s in SERIES}
_real_bins = {r.name: (r.actual_qty, r.valuation_rate) for r in frappe.get_all("Bin", fields=["name", "actual_qty", "valuation_rate"])}
_lp_before = int(subprocess.run(["sh", "-c", "lpstat -W completed -o 2>/dev/null | wc -l"], capture_output=True, text=True).stdout.strip() or 0)
_wa_before = frappe.db.count("Santu WhatsApp Message Log")


# ---------------------------------------------------------------- fixtures
def make_item(code, name, price, uom="Nos", valuation=0):
	if not frappe.db.exists("Item", code):
		frappe.get_doc({
			"doctype": "Item", "item_code": code, "item_name": name, "item_group": "Products",
			"stock_uom": uom, "is_stock_item": 1, "valuation_rate": valuation, "include_item_in_manufacturing": 0,
		}).insert(ignore_permissions=True)
		frappe.get_doc({"doctype": "Item Price", "item_code": code, "price_list": "Standard Selling",
		                "price_list_rate": price, "selling": 1}).insert(ignore_permissions=True)
	return code


def receive(code, qty, rate):
	se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Receipt", "company": COMPANY,
	                     "items": [{"item_code": code, "qty": qty, "t_warehouse": WH, "basic_rate": rate,
	                                "allow_zero_valuation_rate": 0 if rate else 1}]})
	se.insert(ignore_permissions=True); se.submit(); MADE["Stock Entry"].append(se.name)


def count_at_zero(code, qty):
	sr = frappe.get_doc({"doctype": "Stock Reconciliation", "company": COMPANY, "purpose": "Stock Reconciliation",
	                     "items": [{"item_code": code, "warehouse": WH, "qty": qty, "valuation_rate": 0,
	                                "allow_zero_valuation_rate": 1}]})
	sr.insert(ignore_permissions=True); sr.submit(); MADE["Stock Reconciliation"].append(sr.name)


def bill(items, customer="SALES", mode="cash", paid=None, submit=1, **extra):
	total = sum(flt(i["qty"]) * flt(i["rate"]) for i in items)
	payload = {"customer": customer, "company": COMPANY, "warehouse": WH, "payment_mode": mode,
	           "items": [dict({"uom": "Nos"}, **i) for i in items]}
	if mode == "cash":
		p = total if paid is None else paid
		payload.update(paid_amount=p, payments=[{"mode_of_payment": "Cash", "amount": p}])
	else:
		payload.update(paid_amount=paid or 0)
	payload.update(extra)
	r = a.save_sale_invoice(json.dumps(payload), submit=submit)
	frappe.db.commit()
	MADE["Sales Invoice"].append(r["name"])
	return frappe.get_doc("Sales Invoice", r["name"])


try:
	section("0. SETUP (all TEST-named)")
	if not frappe.db.exists("Customer", CUST):
		c = frappe.get_doc({"doctype": "Customer", "customer_name": CUST, "customer_group": "Individual",
		                    "territory": "India", "mobile_no": "9000000001"})
		c.insert(ignore_permissions=True)
	I_ZERO = make_item("TEST-ZERO-STOCK-NOCP", "TEST ZERO STOCK NO CP", 50)            # no stock, no cost
	I_RECO = make_item("TEST-COUNTED-AT-ZERO", "TEST COUNTED AT ZERO", 170)            # stock via count at Rs 0
	I_CP = make_item("TEST-WITH-CP", "TEST WITH CP", 100)                              # proper cost
	I_ITEMVR = make_item("TEST-ITEM-VR-ONLY", "TEST ITEM VR ONLY", 80, valuation=40)   # cost only on the Item
	I_LONG = make_item("TEST-LONG-NAME", "TEST " + "VERY LONG ITEM NAME PRINCE CPVC ELBOW 3/4\" " * 3, 25)
	frappe.db.commit()
	count_at_zero(I_RECO, 10)
	receive(I_CP, 20, 60)
	frappe.db.commit()
	check("TEST fixtures ready", all(frappe.db.exists("Item", i) for i in (I_ZERO, I_RECO, I_CP, I_ITEMVR, I_LONG)))

	section("1. STOCK 0 AND NO COST PRICE -- BILL MUST GO THROUGH")
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_ZERO, "qty": 2, "rate": 50}])))
	check("stock 0 + no CP: bill submits", e is None and d and d.docstatus == 1, e)
	if d:
		check("  line costed at zero (flag set), not refused", d.items[0].allow_zero_valuation_rate == 1)
		check("  stock goes minus (-2), as the warning says", flt(frappe.db.get_value("Bin", {"item_code": I_ZERO, "warehouse": WH}, "actual_qty")) == -2)
		check("  bill got a real bill number", int(d.santu_bill_no or 0) > 0)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_RECO, "qty": 1, "rate": 170}])))
	check("stock counted at Rs 0 (the AP-ROYAL-IVORY case): bill submits", e is None and d and d.docstatus == 1, e)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 3, "rate": 100}])))
	check("item WITH cost price: bill submits", e is None and d and d.docstatus == 1, e)
	if d:
		check("  its real cost is kept (flag NOT set)", not d.items[0].allow_zero_valuation_rate)
		sle_rate = flt(frappe.db.get_value("Stock Ledger Entry", {"voucher_no": d.name, "is_cancelled": 0}, "valuation_rate"))
		check("  stock ledger still values it at Rs 60", abs(sle_rate - 60) < 0.01, sle_rate)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_ITEMVR, "qty": 1, "rate": 80}])))
	check("cost only on the Item master, no stock: bill submits", e is None and d and d.docstatus == 1, e)
	if d:
		check("  Item-master cost is used, not zero", not d.items[0].allow_zero_valuation_rate)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_ZERO, "qty": 1, "rate": 50},
	                                                   {"item_code": I_CP, "qty": 1, "rate": 100},
	                                                   {"item_code": I_RECO, "qty": 1, "rate": 170}])))
	check("mixed bill (no-CP + CP + counted-at-0 lines together)", e is None and d and d.docstatus == 1, e)

	section("2. QUANTITIES, UNITS, DISCOUNTS")
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 9.5, "rate": 100}])))
	check("fraction qty 9.5 Nos", e is None and d and flt(d.items[0].qty) == 9.5, e)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 1, "rate": 100, "discount_amount": 10}])))
	check("line discount Rs 10 kept on the bill", e is None and d and abs(flt(d.grand_total) - 90) < 0.51, getattr(d, "grand_total", e))
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 1, "rate": 0}], paid=0)))
	check("free line (rate 0) stays free, not re-priced to MRP", e is None and d and flt(d.grand_total) == 0, getattr(d, "grand_total", e))
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_LONG, "qty": 1, "rate": 25}])))
	check("very long item name bills fine", e is None and d and d.docstatus == 1, e)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 1, "rate": 1}])))
	check("Rs 1 bill", e is None and d and flt(d.grand_total) == 1, e)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 1, "rate": 150000}])))
	check("Rs 1.5 lakh bill", e is None and d and flt(d.grand_total) == 150000, e)
	d = None
	many = [{"item_code": [I_ZERO, I_CP, I_RECO, I_ITEMVR][k % 4], "qty": 1, "rate": 10 + k} for k in range(60)]
	e = err(lambda: globals().__setitem__("d", bill(many)))
	check("60-line bill", e is None and d and len(d.items) == 60, e)

	section("3. PAYMENT MODES / UDHAAR / WALK-IN RULES")
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_ZERO, "qty": 1, "rate": 500}], customer=CUST, mode="credit")))
	check("udhaar bill for a customer with a phone", e is None and d and flt(d.outstanding_amount) == 500, e)
	d = None
	e = err(lambda: globals().__setitem__("d", bill([{"item_code": I_CP, "qty": 1, "rate": 400}], customer=CUST, mode="cash", paid=150)))
	check("part-paid bill: Rs 250 stays due", e is None and d and abs(flt(d.outstanding_amount) - 250) < 0.01, e)
	e = err(lambda: bill([{"item_code": I_CP, "qty": 1, "rate": 100}], customer="SALES", mode="credit"))
	check("walk-in (SALES) cannot leave udhaar -- still refused", e is not None and "udhaar" in e.lower(), e)
	e = err(lambda: bill([], customer="SALES"))
	check("empty bill refused with a plain message", e is not None and "saaman" in e.lower(), e)

	section("4. EDIT / RETURN / CHALLAN ON NO-COST ITEMS")
	orig = bill([{"item_code": I_ZERO, "qty": 3, "rate": 50}], customer=CUST, mode="cash")
	bno = orig.santu_bill_no
	e = err(lambda: a.edit_submitted_sale_invoice(orig.name, json.dumps({
		"customer": CUST, "company": COMPANY, "warehouse": WH, "payment_mode": "cash",
		"items": [{"item_code": I_ZERO, "qty": 4, "rate": 50, "uom": "Nos"}],
		"paid_amount": 200, "payments": [{"mode_of_payment": "Cash", "amount": 200}]})))
	frappe.db.commit()
	new_name = frappe.db.get_value("Sales Invoice", {"amended_from": orig.name, "docstatus": 1}, "name")
	if new_name:
		MADE["Sales Invoice"].append(new_name)
	check("edit a submitted no-CP bill", e is None and new_name, e)
	if new_name:
		check("  edited bill keeps its bill number", frappe.db.get_value("Sales Invoice", new_name, "santu_bill_no") == bno)
	ret = None
	e = err(lambda: globals().__setitem__("ret", a.save_sales_return(json.dumps({
		"customer": CUST, "company": COMPANY, "warehouse": WH, "return_against": new_name or orig.name,
		"items": [{"item_code": I_ZERO, "qty": 1, "rate": 50, "uom": "Nos"}]}), submit=1)))
	frappe.db.commit()
	if ret and ret.get("name"):
		MADE["Sales Invoice"].append(ret["name"])
	check("return of a no-CP item", e is None and ret and ret.get("name"), e)
	dn = None
	e = err(lambda: globals().__setitem__("dn", a.save_delivery_note(json.dumps({
		"customer": CUST, "company": COMPANY, "warehouse": WH,
		"items": [{"item_code": I_ZERO, "qty": 1, "rate": 50, "uom": "Nos"}]}), submit=1)))
	frappe.db.commit()
	if dn and dn.get("name"):
		MADE["Delivery Note"].append(dn["name"])
	check("delivery challan of a no-CP item", e is None and dn and dn.get("name"), e)

	section("5. SAFETY: DOUBLE-CLICK / OFFLINE RETRY / NUMBERS")
	k = f"TEST-OFFLINE-{int(time.time())}"
	b1 = bill([{"item_code": I_CP, "qty": 1, "rate": 100}], offline_key=k)
	b2 = None
	e = err(lambda: globals().__setitem__("b2", bill([{"item_code": I_CP, "qty": 1, "rate": 100}], offline_key=k)))
	check("same offline bill sent twice -> ONE bill, not two", b2 is not None and b1.name == b2.name, (b1.name, getattr(b2, "name", e)))
	nums = [bill([{"item_code": I_CP, "qty": 1, "rate": 10}]).santu_bill_no for _ in range(5)]
	check("5 bills in a row get 5 consecutive numbers", nums == list(range(nums[0], nums[0] + 5)), nums)

	# parallel: 4 processes save at the same instant
	script = r'''
import frappe, json, sys
frappe.init(site=__import__("os").environ.get("SANTU_TEST_SITE", "scratch.local")); frappe.connect()
from santu_hardware.tests.claude_test_user import TEST_USER; frappe.set_user(TEST_USER)
import santu_hardware.santu_hardware.api as a
wh = a.default_selling_warehouse(frappe.defaults.get_user_default("Company"))
r = a.save_sale_invoice(json.dumps({"customer": "SALES", "warehouse": wh, "payment_mode": "cash", "paid_amount": 10,
    "payments": [{"mode_of_payment": "Cash", "amount": 10}], "items": [{"item_code": "TEST-WITH-CP", "qty": 1, "rate": 10, "uom": "Nos"}]}), submit=1)
frappe.db.commit(); print("RESULT", r["name"])
'''
	procs = [subprocess.Popen([sys.executable, "-c", script], cwd=os.getcwd(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for _ in range(4)]
	outs = [p.communicate(timeout=300)[0] for p in procs]
	par = [ln.split()[1] for o in outs for ln in o.splitlines() if ln.startswith("RESULT")]
	MADE["Sales Invoice"].extend(par)
	frappe.db.commit()  # fresh read view: those bills were written by other processes
	pnums = sorted(int(frappe.db.get_value("Sales Invoice", n, "santu_bill_no") or 0) for n in par)
	check("4 bills saved at the same moment all succeed", len(par) == 4, [o[-200:] for o in outs if "RESULT" not in o])
	check("  ...with 4 different bill numbers (no duplicate)", len(set(pnums)) == len(pnums) == 4, pnums)

	section("6. PRINT OUTPUT OF THESE BILLS (rendered, NOT printed)")
	sample = [n for n in MADE["Sales Invoice"] if frappe.db.get_value("Sales Invoice", n, "is_return") == 0][:6]
	bad = []
	for n in sample:
		for pf in ("Santu Hardware Thermal Bill (Sales Invoice)", "Santu Hardware Bill (Sales Invoice)"):
			try:
				with a._print_request_context():
					h = frappe.get_print("Sales Invoice", n, print_format=pf)
				if "Traceback" in h or "Payment Mode" in h or "Not a Tax Invoice" in h:
					bad.append((n, pf, "content"))
			except Exception as ex:  # noqa: BLE001
				bad.append((n, pf, str(ex)[:80]))
	check("thermal + A4 print render for every kind of bill above", not bad, bad[:3])

	section("7. NOTHING REAL WAS TOUCHED")
	now_bins = {r.name: (r.actual_qty, r.valuation_rate) for r in frappe.get_all("Bin", fields=["name", "actual_qty", "valuation_rate"])}
	changed = [k for k, v in _real_bins.items() if k in now_bins and now_bins[k] != v
	           and not frappe.db.get_value("Bin", k, "item_code").startswith("TEST-")]
	check("no real item's stock or cost changed (only TEST items were sold)", not changed, changed[:5])
	lp_now = int(subprocess.run(["sh", "-c", "lpstat -W completed -o 2>/dev/null | wc -l"], capture_output=True, text=True).stdout.strip() or 0)
	check("nothing went to the printer", lp_now == _lp_before, (_lp_before, lp_now))
	check("no WhatsApp message went out", frappe.db.count("Santu WhatsApp Message Log") == _wa_before)

finally:
	section("CLEANUP")
	frappe.db.rollback()
	# returns first, then amended, then the rest; cancel then delete
	sis = list(dict.fromkeys(MADE["Sales Invoice"]))
	sis.sort(key=lambda n: (-(frappe.db.get_value("Sales Invoice", n, "is_return") or 0), -(1 if frappe.db.get_value("Sales Invoice", n, "amended_from") else 0)))
	for dt, names in (("Sales Invoice", sis), ("Delivery Note", MADE["Delivery Note"]),
	                  ("Stock Entry", MADE["Stock Entry"]), ("Stock Reconciliation", MADE["Stock Reconciliation"])):
		for n in names:
			try:
				if not frappe.db.exists(dt, n):
					continue
				d = frappe.get_doc(dt, n)
				assert d.owner == TEST_USER, f"{n} not ours"
				if d.docstatus == 1:
					d.flags.ignore_permissions = True
					d.cancel()
				frappe.db.commit()
				frappe.delete_doc(dt, n, force=1, ignore_permissions=True)
				frappe.db.commit()
			except Exception as ex:  # noqa: BLE001
				frappe.db.rollback()
				print("  cleanup problem:", dt, n, str(ex)[:150])
	# any cancelled original of an edited bill
	for n in frappe.get_all("Sales Invoice", {"owner": TEST_USER}, pluck="name"):
		try:
			d = frappe.get_doc("Sales Invoice", n)
			if d.docstatus == 1:
				d.flags.ignore_permissions = True; d.cancel(); frappe.db.commit()
			frappe.delete_doc("Sales Invoice", n, force=1, ignore_permissions=True); frappe.db.commit()
		except Exception as ex:  # noqa: BLE001
			frappe.db.rollback(); print("  cleanup problem:", n, str(ex)[:150])
	for code in frappe.get_all("Item", {"name": ["like", "TEST-%"], "owner": TEST_USER}, pluck="name"):
		frappe.db.sql("delete from `tabStock Ledger Entry` where item_code=%s", code)
		frappe.db.sql("delete from `tabBin` where item_code=%s", code)
		frappe.db.sql("delete from `tabItem Price` where item_code=%s", code)
		frappe.db.sql("delete from `tabSerial and Batch Bundle` where item_code=%s", code) if frappe.db.table_exists("Serial and Batch Bundle") else None
		frappe.delete_doc("Item", code, force=1, ignore_permissions=True)
	if frappe.db.exists("Customer", CUST) and frappe.db.get_value("Customer", CUST, "owner") == TEST_USER:
		for dt in ("Contact", "Address"):
			for p in frappe.get_all("Dynamic Link", {"link_doctype": "Customer", "link_name": CUST, "parenttype": dt}, pluck="parent"):
				frappe.delete_doc(dt, p, force=1, ignore_permissions=True)
		frappe.db.sql("delete from `tabGL Entry` where party=%s", CUST)
		frappe.db.sql("delete from `tabPayment Ledger Entry` where party=%s", CUST)
		frappe.db.sql("delete from `tabLoyalty Point Entry` where customer=%s", CUST)
		frappe.delete_doc("Customer", CUST, force=1, ignore_permissions=True)
	frappe.db.commit()
	for s, dts in (("SANTU-BILL-NO", ("Sales Invoice", "POS Invoice")), ("SANTU-ESTIMATE-NO", ("Quotation",))):
		top = max(int(frappe.db.sql(f"select ifnull(max(santu_bill_no),0) from `tab{dt}`")[0][0] or 0) for dt in dts)
		frappe.db.sql("update tabSeries set current=%s where name=%s", (top, s))
	frappe.db.commit()
	left = {dt: frappe.db.count(dt, {"owner": TEST_USER}) for dt in ("Sales Invoice", "Delivery Note", "Stock Entry", "Stock Reconciliation", "Item", "Customer")}
	check("cleanup: no TEST bill / challan / stock entry / item / customer left", not any(left.values()), left)
	now_ser = {s: frappe.db.sql("select current from tabSeries where name=%s", s)[0][0] for s in SERIES}
	check("bill + estimate counters back on the last real number", all(now_ser[s] >= _series_before[s] - 0 for s in SERIES)
	      and now_ser["SANTU-BILL-NO"] == int(frappe.db.sql("select ifnull(max(santu_bill_no),0) from `tabSales Invoice`")[0][0]), (_series_before, now_ser))

	print("\n" + "=" * 74)
	print(f"PASS: {len(PASS)}    FAIL: {len(FAIL)}")
	for f in FAIL:
		print("  - " + f)
	print("=" * 74)
