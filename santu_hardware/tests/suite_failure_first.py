"""Failure-first billing suite (full-app test plan, parts H J K L M O).

Runs on the TEST COPY (scratch.local) by default. Everything it makes is
named TEST... and removed at the end; the testkit gates fail the run if one
real record moves.

  H  concurrency / race          -> same bill cancelled / edited at once, 4 x 60-line bills
  J  idempotency / double click  -> offline key, repeated calls
  K  boundary / fuzz             -> tiny/huge amounts & qty, odd text, bad phone, duplicates
  L  stock accounting chain      -> opening, purchase, sale, return, purchase return, adjust, cancel, amend
  M  financial reconciliation    -> bills <-> payments <-> outstanding <-> ledger <-> cash <-> stock value
  O  recovery / rollback         -> a failure half-way leaves nothing behind
"""
import json
import os
import subprocess
import sys

from santu_hardware.tests import santu_testkit as tk

frappe = tk.connect()
from frappe.utils import flt, today  # noqa: E402

import santu_hardware.santu_hardware.api as a  # noqa: E402

run = tk.Run("failure_first")
U = tk.TEST_USER
COMPANY = frappe.defaults.get_user_default("Company") or "Santu Hardware"
WH = a.default_selling_warehouse(COMPANY)
CUST, SUPP = "TEST GRAHAK", "TEST MAHAJAN"
MADE = []  # (doctype, name) in creation order


def track(dt, name):
	if name:
		MADE.append((dt, name))
	return name


def err(fn):
	try:
		fn()
		return None
	except Exception as e:  # noqa: BLE001
		frappe.db.rollback()
		return str(e)[:300]


def bin_state(item):
	b = frappe.db.get_value("Bin", {"item_code": item, "warehouse": WH}, ["actual_qty", "stock_value", "valuation_rate"], as_dict=True)
	return b or frappe._dict(actual_qty=0, stock_value=0, valuation_rate=0)


def sle_sum(item):
	"""(last qty_after_transaction, sum of value moved). A stock count posts
	its SLE with actual_qty 0 and an absolute qty_after_transaction, so the
	running balance -- not a sum of movements -- is the ledger's own answer."""
	last = frappe.db.sql("""select qty_after_transaction from `tabStock Ledger Entry` where item_code=%s and warehouse=%s
		and is_cancelled=0 order by posting_date desc, posting_time desc, creation desc limit 1""", (item, WH))
	v = frappe.db.sql("""select ifnull(sum(stock_value_difference),0) from `tabStock Ledger Entry`
		where item_code=%s and warehouse=%s and is_cancelled=0""", (item, WH))[0][0]
	return flt(last[0][0]) if last else 0.0, flt(v, 2)


def make_item(code, name, price=100, valuation=0):
	if not frappe.db.exists("Item", code):
		frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": name, "item_group": "Products",
		                "stock_uom": "Nos", "is_stock_item": 1, "valuation_rate": valuation,
		                "gst_hsn_code": frappe.db.get_value("Item", {"gst_hsn_code": ["is", "set"], "name": ["not like", "TEST%"]}, "gst_hsn_code")
		                }).insert(ignore_permissions=True)
		frappe.get_doc({"doctype": "Item Price", "item_code": code, "price_list": "Standard Selling",
		                "price_list_rate": price, "selling": 1}).insert(ignore_permissions=True)
	return code


def bill(items, customer="SALES", mode="cash", paid=None, submit=1, **extra):
	total = sum(flt(i["qty"]) * flt(i["rate"]) - flt(i.get("discount_amount")) for i in items)
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
	track("Sales Invoice", r["name"])
	return frappe.get_doc("Sales Invoice", r["name"])


def _run_reposts():
	"""Backdated edits queue a stock re-valuation that the scheduler runs on
	the live site; the test copy's scheduler is paused on purpose, so run the
	queued ones for this test's items here."""
	from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import repost
	for n in frappe.get_all("Repost Item Valuation", {"status": ["in", ["Queued", "In Progress"]], "docstatus": 1}, pluck="name"):
		d = frappe.get_doc("Repost Item Valuation", n)
		if (d.item_code or "").startswith("TEST") or d.voucher_no in [x for _, x in MADE]:
			repost(d)
	frappe.db.commit()


PAR_HEADER = r'''
import frappe, json, sys
frappe.init(site=%r); frappe.connect()
frappe.set_user(%r)
import santu_hardware.santu_hardware.api as a
''' % (tk.SITE, U)


def parallel(body: str, n: int):
	"""Run the same snippet in n separate processes at once. Each prints
	RESULT <json> or ERROR <text>."""
	code = PAR_HEADER + "try:\n" + "\n".join("    " + ln for ln in body.strip().splitlines()) + \
		"\nexcept Exception as e:\n    frappe.db.rollback(); print('ERROR', str(e)[:200].replace(chr(10),' '))\n"
	procs = [subprocess.Popen([sys.executable, "-c", code], cwd=os.getcwd(), stdout=subprocess.PIPE,
	                          stderr=subprocess.STDOUT, text=True) for _ in range(n)]
	outs = [p.communicate(timeout=600)[0] for p in procs]
	res, errs = [], []
	for o in outs:
		lines = [ln for ln in o.splitlines() if ln.startswith(("RESULT ", "ERROR "))]
		if not lines:
			errs.append(o[-300:])
		for ln in lines:
			(res if ln.startswith("RESULT") else errs).append(ln.split(" ", 1)[1])
	frappe.db.commit()  # fresh read view: other processes wrote these
	return res, errs


try:
	# ------------------------------------------------------------------ setup
	run.section("0. SETUP (TEST fixtures)")
	if not frappe.db.exists("Customer", CUST):
		frappe.get_doc({"doctype": "Customer", "customer_name": CUST, "customer_group": "Individual",
		                "territory": "India", "mobile_no": "9000000001"}).insert(ignore_permissions=True)
	if not frappe.db.exists("Supplier", SUPP):
		frappe.get_doc({"doctype": "Supplier", "supplier_name": SUPP, "supplier_group": frappe.db.get_value("Supplier Group", {}, "name"),
		                "mobile_no": "9000000002"}).insert(ignore_permissions=True)
	CHAIN = make_item("TEST-CHAIN", "TEST CHAIN ITEM", 25)
	RACE = make_item("TEST-RACE", "TEST RACE ITEM", 10)
	FUZZ = make_item("TEST-FUZZ", "TEST FUZZ ITEM", 50)
	frappe.db.commit()
	r = a.receive_stock_simple(RACE, 100000, 5); frappe.db.commit()
	track("Stock Entry", (r or {}).get("name") or (r or {}).get("stock_entry"))
	run.check("fixtures ready", True, all(frappe.db.exists("Item", i) for i in (CHAIN, RACE, FUZZ)))

	# ------------------------------------------------------ L. stock chain
	run.section("L. STOCK ACCOUNTING CHAIN (one TEST item, every step verified)")

	def step(label, exp_qty, exp_value=None):
		b = bin_state(CHAIN)
		q, v = sle_sum(CHAIN)
		run.check(f"{label}: Bin qty", exp_qty, flt(b.actual_qty), evidence=f"SLE sum qty={q}")
		run.check(f"{label}: Bin qty = stock-ledger balance", q, flt(b.actual_qty))
		run.check(f"{label}: Bin value = sum of stock-ledger value", v, flt(b.stock_value, 2),
		          ok=abs(v - flt(b.stock_value)) < 0.05, evidence=f"rate={flt(b.valuation_rate, 4)}")
		if exp_value is not None:
			run.check(f"{label}: stock value", exp_value, flt(b.stock_value, 2), ok=abs(exp_value - flt(b.stock_value)) < 0.05)

	r = a.receive_stock_simple(CHAIN, 100, 10); frappe.db.commit()
	track("Stock Entry", frappe.db.get_value("Stock Entry Detail", {"item_code": CHAIN}, "parent", order_by="creation desc"))
	step("1 opening 100 @ Rs10", 100, 1000)
	pi = a.save_purchase_invoice(json.dumps({"supplier": SUPP, "company": COMPANY, "warehouse": WH, "update_stock": 1,
	                                         "payment_mode": "credit", "bill_no": "TEST-PB-1", "bill_date": today(),
	                                         "items": [{"item_code": CHAIN, "qty": 50, "rate": 16, "uom": "Nos"}]}), submit=1)
	frappe.db.commit(); PI = track("Purchase Invoice", pi.get("name"))
	step("2 purchase 50 @ Rs16", 150, 1800)
	s1 = bill([{"item_code": CHAIN, "qty": 30, "rate": 25}], customer=CUST, mode="credit")
	step("3 sale 30 (FIFO: 30 of the Rs10 lot)", 120, 1500)
	rt = a.save_sales_return(json.dumps({"customer": CUST, "company": COMPANY, "warehouse": WH, "return_against": s1.name,
	                                     "items": [{"item_code": CHAIN, "qty": 10, "rate": 25, "uom": "Nos"}]}), submit=1)
	frappe.db.commit(); track("Sales Invoice", rt.get("name"))
	step("4 sales return 10 (back at Rs10)", 130, 1600)
	pr = a.save_purchase_return(json.dumps({"supplier": SUPP, "company": COMPANY, "warehouse": WH, "return_against": PI,
	                                        "items": [{"item_code": CHAIN, "qty": 20, "rate": 16, "uom": "Nos"}]}), submit=1)
	frappe.db.commit(); track("Purchase Invoice", pr.get("name"))
	step("5 purchase return 20 (Rs16 lot)", 110, 1280)
	e = err(lambda: a.fix_stock(CHAIN, 105, "TEST count")); frappe.db.commit()
	for n in frappe.get_all("Stock Reconciliation Item", {"item_code": CHAIN}, pluck="parent", distinct=True):
		track("Stock Reconciliation", n)
	run.check("6 adjustment (fix_stock to 105) accepted", None, e)
	step("6 after adjustment", 105)
	s1 = frappe.get_doc("Sales Invoice", s1.name)
	e = err(lambda: (a.edit_submitted_sale_invoice(s1.name, json.dumps({
		"customer": CUST, "company": COMPANY, "warehouse": WH, "payment_mode": "credit", "paid_amount": 0,
		"items": [{"item_code": CHAIN, "qty": 25, "rate": 25, "uom": "Nos"}]})), frappe.db.commit()))
	amended = frappe.db.get_value("Sales Invoice", {"amended_from": s1.name}, "name")
	track("Sales Invoice", amended)
	run.check("7 edit bill (30 -> 25) = cancel + re-submit", None, e, evidence=amended)
	_run_reposts()
	step("7 after edit: the count (105) already saw this bill -> stays 105", 105)
	_ret = frappe.db.get_value("Sales Invoice", rt.get("name"), ["return_against", "outstanding_amount"], as_dict=True)
	_ret_ple = frappe.db.sql("""select against_voucher_no, sum(amount) from `tabPayment Ledger Entry` where voucher_no=%s
		and delinked=0 group by against_voucher_no""", rt.get("name"))
	run.check("7 the earlier return now points at the edited bill", amended, _ret.return_against, evidence=f"return PLE={_ret_ple}")
	run.check("7 ...and its Rs250 credit is set against the edited bill (not left floating)", amended,
	          _ret_ple[0][0] if _ret_ple else None, finding=True,
	          evidence="customer total stays right either way; only the per-bill view differs")
	run.check("7 edited bill keeps its number", s1.santu_bill_no, frappe.db.get_value("Sales Invoice", amended, "santu_bill_no"))

	# ------------------------------------------------ M. reconciliation
	run.section("M. FINANCIAL RECONCILIATION (TEST GRAHAK + TEST vouchers)")
	b2 = bill([{"item_code": CHAIN, "qty": 4, "rate": 25, "discount_amount": 10}], customer=CUST, mode="cash", paid=40)
	pe = a.create_payment_entry("Customer", CUST, 300, "Cash", today(), "TEST-PAY-1", None, "TEST payment"); frappe.db.commit()
	PE = track("Payment Entry", (pe or {}).get("name") if isinstance(pe, dict) else pe)
	sis = frappe.get_all("Sales Invoice", {"customer": CUST, "docstatus": 1}, ["name", "grand_total", "outstanding_amount", "is_return", "paid_amount"])
	billed = sum(flt(s.grand_total) for s in sis)
	paid_with_bills = sum(flt(s.paid_amount) for s in sis if not s.is_return)
	pays = sum(flt(p) for p in frappe.get_all("Payment Entry", {"party": CUST, "docstatus": 1, "payment_type": "Receive"}, pluck="paid_amount"))
	refunds = sum(flt(p) for p in frappe.get_all("Payment Entry", {"party": CUST, "docstatus": 1, "payment_type": "Pay"}, pluck="paid_amount"))
	expected_due = flt(billed - paid_with_bills - pays + refunds, 2)
	gl_bal = flt(frappe.db.sql("""select ifnull(sum(debit-credit),0) from `tabGL Entry` where party_type='Customer'
		and party=%s and is_cancelled=0""", CUST)[0][0], 2)
	ple_bal = flt(frappe.db.sql("""select ifnull(sum(amount),0) from `tabPayment Ledger Entry` where party_type='Customer'
		and party=%s and delinked=0""", CUST)[0][0], 2)
	khata = a.get_customer_khata(CUST)
	khata_due = flt((khata or {}).get("closing_balance", (khata or {}).get("due_amount", 0)), 2)
	run.check("customer ledger (GL) = billed - paid - payments", expected_due, gl_bal, ok=abs(expected_due - gl_bal) < 0.05,
	          evidence=f"billed={billed} paid_with_bills={paid_with_bills} payments={pays} refunds={refunds}")
	run.check("payment ledger = customer ledger", gl_bal, ple_bal, ok=abs(gl_bal - ple_bal) < 0.05)
	run.check("khata shown to the shop = customer ledger", gl_bal, khata_due, ok=abs(gl_bal - khata_due) < 0.05)
	vouchers = [n for d, n in MADE if d in ("Sales Invoice", "Payment Entry", "Purchase Invoice", "Stock Entry", "Stock Reconciliation")]
	stock_acc = frappe.db.get_value("Account", {"account_type": "Stock", "is_group": 0, "company": COMPANY}, "name")
	gl_stock = flt(frappe.db.sql("""select ifnull(sum(debit-credit),0) from `tabGL Entry` where account=%s and is_cancelled=0
		and voucher_no in %s""", (stock_acc, tuple(vouchers) or ("x",)))[0][0], 2)
	sle_val = flt(frappe.db.sql("""select ifnull(sum(stock_value_difference),0) from `tabStock Ledger Entry` where is_cancelled=0
		and voucher_no in %s""", (tuple(vouchers) or ("x",),))[0][0], 2)
	run.check("stock account in the books = stock value moved by the same vouchers", sle_val, gl_stock, ok=abs(sle_val - gl_stock) < 0.5)
	unbal = frappe.db.sql("""select voucher_no, sum(debit)-sum(credit) from `tabGL Entry` where is_cancelled=0 and voucher_no in %s
		group by voucher_no having abs(sum(debit)-sum(credit)) > 0.01""", (tuple(vouchers),))
	run.check("every TEST voucher balances", 0, len(unbal), evidence=unbal[:3])
	disc = frappe.db.get_value("Sales Invoice", b2.name, ["total", "grand_total"], as_dict=True)
	run.check("Rs10 discount on 4 x Rs25 -> bill is Rs90 (discount folded into the rate by design)", 90.0,
	          flt(disc.grand_total), ok=abs(flt(disc.grand_total) - 90) < 0.51)
	for si in frappe.get_all("Sales Invoice", {"name": ["in", [n for d, n in MADE if d == "Sales Invoice"]], "docstatus": 1, "is_return": 0},
	                         ["name", "outstanding_amount"]):
		ple = flt(frappe.db.sql("select ifnull(sum(amount),0) from `tabPayment Ledger Entry` where against_voucher_no=%s and delinked=0", si.name)[0][0])
		if abs(ple - flt(si.outstanding_amount)) > 0.05:
			rows = frappe.db.sql("""select voucher_type, voucher_no, amount, delinked from `tabPayment Ledger Entry`
				where against_voucher_no=%s""", si.name)
			d = frappe.db.get_value("Sales Invoice", si.name, ["santu_bill_no", "grand_total", "paid_amount", "is_return", "return_against", "amended_from"], as_dict=True)
			run.check(f"bill {si.name}: outstanding = payment ledger", flt(si.outstanding_amount), ple, ok=False,
			          evidence=f"{d} PLE={rows}")

	# ------------------------------------------------------ H. concurrency
	run.section("H. CONCURRENCY / RACE")
	victim = bill([{"item_code": RACE, "qty": 1, "rate": 10}], customer=CUST, mode="credit")
	res, errs = parallel(f'''
d = frappe.get_doc("Sales Invoice", {victim.name!r}); d.flags.ignore_permissions = True; d.cancel(); frappe.db.commit()
print("RESULT", "cancelled")''', 2)
	run.check("same bill cancelled from 2 places at once: bill ends cancelled exactly once",
	          2, frappe.db.get_value("Sales Invoice", victim.name, "docstatus"),
	          evidence=f"ok={len(res)} refused={errs[:1]}")
	run.check("  ...and its stock came back once, not twice", 1,
	          len(frappe.get_all("Stock Ledger Entry", {"voucher_no": victim.name, "actual_qty": [">", 0]})))
	victim = bill([{"item_code": RACE, "qty": 2, "rate": 10}], customer=CUST, mode="credit")
	vb = victim.santu_bill_no
	res, errs = parallel(f'''
r = a.edit_submitted_sale_invoice({victim.name!r}, json.dumps({{"customer": {CUST!r}, "payment_mode": "credit", "paid_amount": 0,
    "items": [{{"item_code": {RACE!r}, "qty": 3, "rate": 10, "uom": "Nos"}}]}}))
frappe.db.commit(); print("RESULT", json.dumps(r, default=str)[:80])''', 2)
	live = frappe.get_all("Sales Invoice", {"santu_bill_no": vb, "docstatus": 1}, pluck="name")
	for n in frappe.get_all("Sales Invoice", {"santu_bill_no": vb}, pluck="name"):
		track("Sales Invoice", n)
	run.check("same bill edited from 2 places at once: ONE live bill with that number", 1, len(live),
	          evidence=f"live={live} ok={len(res)} refused={[e[:80] for e in errs][:1]}")
	before_qty = flt(bin_state(RACE).actual_qty)
	lines = [{"item_code": RACE, "qty": 1.5, "rate": 10, "uom": "Nos", "discount_amount": 1} for _ in range(60)]
	res, errs = parallel(f'''
r = a.save_sale_invoice(json.dumps({{"customer": {CUST!r}, "payment_mode": "credit", "paid_amount": 0, "items": {json.dumps(lines)}}}), submit=1)
frappe.db.commit(); print("RESULT", r["name"])''', 4)
	for n in res:
		track("Sales Invoice", n)
	nums = sorted(int(frappe.db.get_value("Sales Invoice", n, "santu_bill_no") or 0) for n in res)
	run.check("4 users x 60 lines x 1.5 qty x discount x udhaar at once: all 4 saved", 4, len(res), evidence=errs[:1])
	run.check("  ...4 different bill numbers", 4, len(set(nums)), evidence=nums)
	run.check("  ...stock went down by exactly 4 x 60 x 1.5 = 360", flt(before_qty - 360), flt(bin_state(RACE).actual_qty))

	# --------------------------------------------------- J. idempotency
	run.section("J. IDEMPOTENCY / DOUBLE-CLICK (server side)")
	key = f"TEST-OFFKEY-{frappe.generate_hash(length=6)}"
	res, errs = parallel(f'''
r = a.save_sale_invoice(json.dumps({{"customer": "SALES", "payment_mode": "cash", "paid_amount": 10, "offline_key": {key!r},
    "payments": [{{"mode_of_payment": "Cash", "amount": 10}}], "items": [{{"item_code": {RACE!r}, "qty": 1, "rate": 10, "uom": "Nos"}}]}}), submit=1)
frappe.db.commit(); print("RESULT", r["name"])''', 3)
	for n in res:
		track("Sales Invoice", n)
	made = frappe.get_all("Sales Invoice", {"custom_offline_key": key}, pluck="name") if frappe.db.has_column("Sales Invoice", "custom_offline_key") else []
	for n in made:
		track("Sales Invoice", n)
	run.check("same offline bill sent 3 times AT ONCE -> exactly one bill", 1, len(made), evidence=f"results={res} errors={errs[:1]}")
	# payments / receive stock carry no request key yet: record what a double
	# call does today (finding, decided with Ankit before adding a guard)
	p_before = frappe.db.count("Payment Entry", {"party": CUST, "docstatus": 1})
	pkey = f"TEST-PK-{frappe.generate_hash(length=8)}"
	res, errs = parallel(f'''
r = a.create_payment_entry("Customer", {CUST!r}, 7, "Cash", None, None, None, "TEST double", request_key={pkey!r})
frappe.db.commit(); print("RESULT", r["name"])''', 4)
	for n in res:
		track("Payment Entry", n)
	made_p = frappe.get_all("Payment Entry", {"custom_request_key": pkey, "docstatus": 1}, pluck="name")
	run.check("Payment In saved 4 times AT ONCE with one key -> exactly one payment", 1, len(made_p),
	          evidence=f"answers={sorted(set(res))} errors={errs[:1]}")
	run.check("  ...all 4 answers point at that one payment", 1, len(set(res)), evidence=res)
	r2 = a.create_payment_entry("Customer", CUST, 8, "Cash", None, None, None, "TEST new amount", request_key=pkey); frappe.db.commit()
	track("Payment Entry", r2["name"])
	run.check("a DIFFERENT amount under an old key is a new payment", True, r2["name"] not in made_p)
	r3 = a.create_payment_entry("Customer", CUST, 9, "Cash", None, None, None, "TEST no key"); frappe.db.commit()
	track("Payment Entry", r3["name"])
	run.check("no key (old callers) still saves normally", True, bool(r3.get("name")))

	# ---------------------------------------------------- K. boundaries
	run.section("K. BOUNDARY / FUZZ")
	cases = [
		("Rs 0.01 line", [{"item_code": FUZZ, "qty": 1, "rate": 0.01}], None),
		("Rs 99,99,99,999 line", [{"item_code": FUZZ, "qty": 1, "rate": 999999999}], None),
		("qty 0.01", [{"item_code": FUZZ, "qty": 0.01, "rate": 50}], None),
		("qty 10,00,000", [{"item_code": FUZZ, "qty": 1000000, "rate": 1}], None),
		("100% discount", [{"item_code": FUZZ, "qty": 1, "rate": 50, "discount_amount": 50}], None),
		("100 lines", [{"item_code": FUZZ, "qty": 1, "rate": 1 + k} for k in range(100)], None),
		("500 lines", [{"item_code": FUZZ, "qty": 1, "rate": 1} for _ in range(500)], None),
	]
	for label, items, _ in cases:
		d = None
		e = err(lambda: globals().__setitem__("d", bill(items)))
		exp_total = sum(flt(i["qty"]) * flt(i["rate"]) - flt(i.get("discount_amount")) for i in items)
		run.check(f"{label}: bill saves", None, e)
		if d:
			run.check(f"{label}: total right", round(exp_total, 2), flt(d.grand_total, 2),
			          ok=abs(flt(d.grand_total) - exp_total) <= max(0.51, exp_total * 1e-9))
	e = err(lambda: bill([{"item_code": FUZZ, "qty": -1, "rate": 50}]))
	run.check("negative qty on a sale is refused", True, e is not None, evidence=e)
	e = err(lambda: bill([{"item_code": FUZZ, "qty": 1, "rate": -5}]))
	run.check("negative rate is refused", True, e is not None, evidence=e)
	e = err(lambda: bill([{"item_code": "TEST-DOES-NOT-EXIST", "qty": 1, "rate": 5}]))
	run.check("unknown item is refused", True, e is not None, evidence=e)
	e = err(lambda: a.create_customer_full(json.dumps({"customer_name": "TEST <script>x</script>", "phone": "9000000004", "address": "TEST"})))
	run.check("name with < > is refused (can never reach a bill as code)", True, e is not None, evidence=e)
	odd = 'TEST \'; DROP TABLE x;-- 😀 हार्डवेयर & "q" #1 / (Pvt)'
	c = None
	e = err(lambda: globals().__setitem__("c", a.create_customer_full(json.dumps({"customer_name": odd, "phone": "9000000003", "address": "TEST gaon <i>x</i>"}))))
	frappe.db.commit()
	oc = frappe.db.get_value("Customer", {"mobile_no": "9000000003"}, "name")
	run.check("customer with emoji / Hindi / HTML / SQL-looking name is saved", True, bool(oc), evidence=e or oc or c)
	if oc:
		ob = None
		e = err(lambda: globals().__setitem__("ob", bill([{"item_code": FUZZ, "qty": 1, "rate": 50}], customer=oc, mode="cash")))
		run.check("  ...and can be billed", None, e)
		if ob:
			with a._print_request_context():
				h = frappe.get_print("Sales Invoice", ob.name, print_format="Santu Hardware Thermal Bill (Sales Invoice)")
			run.check("  ...the bill prints the Hindi / emoji name", True, "हार्डवेयर" in h)
	for bad_phone in ("12345", "abcdefghij", "99999999999999"):
		e = err(lambda: a.create_customer_full(json.dumps({"customer_name": f"TEST PHONE {bad_phone}", "phone": bad_phone, "address": "TEST"})))
		frappe.db.commit()
		made_c = frappe.db.get_value("Customer", {"customer_name": f"TEST PHONE {bad_phone}"}, "name")
		run.check(f"bad phone {bad_phone!r} is refused, in Hindi", True,
		          e is not None and not made_c and "10 अंक" in (e or ""), evidence=e or made_c)
	for good_phone, stored in (("+91 98765 43210", "9876543210"), ("09876543211", "9876543211")):
		e = err(lambda: a.create_customer_full(json.dumps({"customer_name": f"TEST PHONE OK {stored}", "phone": good_phone, "address": "TEST"})))
		frappe.db.commit()
		run.check(f"phone {good_phone!r} is cleaned to 10 digits", stored,
		          frappe.db.get_value("Customer", {"customer_name": f"TEST PHONE OK {stored}"}, "mobile_no"), evidence=e)
	_qc = dict(item_name="TEST DUP ITEM", selling_price=5, item_group="Products", uom="Nos", opening_qty=1, cost_price=3, require_opening_qty=1)
	e1 = err(lambda: (a.quick_create_item(**_qc), frappe.db.commit()))
	e2 = err(lambda: (a.quick_create_item(**_qc), frappe.db.commit()))
	dups = frappe.get_all("Item", {"item_name": ["like", "%TEST DUP ITEM%"]}, pluck="name")
	run.check("same new item created twice -> not two items", 1, len(dups), evidence=f"e1={e1} e2={e2} items={dups}")
	run.check("  ...the second attempt names the existing item, in Hindi", True, bool(e2) and "पहले से है" in e2, evidence=e2)

	# ------------------------------------------------------ O. rollback
	run.section("O. RECOVERY / ROLLBACK (failure injected half-way)")
	import erpnext.accounts.general_ledger as gl
	counter_before = frappe.db.sql("select current from tabSeries where name='SANTU-BILL-NO'")[0][0]
	si_before = frappe.db.count("Sales Invoice", {"customer": CUST})
	sle_before = frappe.db.count("Stock Ledger Entry", {"item_code": RACE})
	orig = gl.make_gl_entries

	def boom(*x, **k):
		raise RuntimeError("TEST injected ledger failure")
	gl.make_gl_entries = boom
	try:
		import erpnext.controllers.stock_controller as sc
		sc_orig = getattr(sc, "make_gl_entries", None)
		if sc_orig:
			sc.make_gl_entries = boom
		import erpnext.accounts.doctype.sales_invoice.sales_invoice as sim
		sim_orig = getattr(sim, "make_gl_entries", None)
		if sim_orig:
			sim.make_gl_entries = boom
		e = err(lambda: bill([{"item_code": RACE, "qty": 7, "rate": 10}], customer=CUST, mode="credit"))
	finally:
		gl.make_gl_entries = orig
		if sc_orig:
			sc.make_gl_entries = sc_orig
		if sim_orig:
			sim.make_gl_entries = sim_orig
	frappe.db.commit()
	run.check("bill whose ledger posting fails is refused", True, e is not None, evidence=e)
	run.check("  ...no half-saved bill left", si_before, frappe.db.count("Sales Invoice", {"customer": CUST}),
	          db_impact=frappe.get_all("Sales Invoice", {"customer": CUST}, ["name", "docstatus"], order_by="creation desc", limit=2))
	run.check("  ...no stock moved", sle_before, frappe.db.count("Stock Ledger Entry", {"item_code": RACE}))
	run.check("  ...no bill number burned", counter_before, frappe.db.sql("select current from tabSeries where name='SANTU-BILL-NO'")[0][0])

	import erpnext.stock.stock_ledger as sl
	sl_orig = sl.make_sl_entries

	def boom2(*x, **k):
		raise RuntimeError("TEST injected stock failure")
	import erpnext.controllers.stock_controller as sc2
	sc2_orig = getattr(sc2, "make_sl_entries", None)
	sl.make_sl_entries = boom2
	if sc2_orig:
		sc2.make_sl_entries = boom2
	try:
		ret_before = frappe.db.count("Sales Invoice", {"customer": CUST, "is_return": 1})
		base = frappe.get_all("Sales Invoice", {"customer": CUST, "docstatus": 1, "is_return": 0}, pluck="name", limit=1)
		e = err(lambda: a.save_sales_return(json.dumps({"customer": CUST, "company": COMPANY, "warehouse": WH,
		                                                  "items": [{"item_code": RACE, "qty": 1, "rate": 10, "uom": "Nos"}]}), submit=1))
	finally:
		sl.make_sl_entries = sl_orig
		if sc2_orig:
			sc2.make_sl_entries = sc2_orig
	frappe.db.commit()
	run.check("return whose stock posting fails is refused", True, e is not None, evidence=e)
	run.check("  ...no half-saved return left", ret_before, frappe.db.count("Sales Invoice", {"customer": CUST, "is_return": 1}))

finally:
	# ----------------------------------------------------------- cleanup
	run.section("CLEANUP")
	frappe.db.rollback()
	# everything the test user made, newest first: returns / amendments before originals
	for dt in ("Payment Entry", "Sales Invoice", "Sales Invoice", "Delivery Note", "Purchase Invoice", "Purchase Invoice",
	           "Stock Reconciliation", "Stock Entry"):
		order = "is_return desc, creation desc" if dt in ("Sales Invoice", "Purchase Invoice") else "creation desc"
		names = frappe.get_all(dt, {"owner": U}, ["name"], order_by=order)
		for n in [x.name for x in names]:
			try:
				d = frappe.get_doc(dt, n)
				if d.docstatus == 1:
					d.flags.ignore_permissions = True
					d.cancel()
					frappe.db.commit()
				frappe.delete_doc(dt, n, force=1, ignore_permissions=True)
				frappe.db.commit()
			except Exception as ex:  # noqa: BLE001
				frappe.db.rollback()
				print("  cleanup:", dt, n, frappe.utils.strip_html(str(ex))[:300])
	for code in frappe.get_all("Item", {"name": ["like", "TEST%"], "owner": U}, pluck="name"):
		for t in ("Stock Ledger Entry", "Bin", "Item Price", "Repost Item Valuation"):
			frappe.db.sql(f"delete from `tab{t}` where item_code=%s", code)
		frappe.delete_doc("Item", code, force=1, ignore_permissions=True)
	for dt in ("Customer", "Supplier"):
		for p in frappe.get_all(dt, {"owner": U}, pluck="name"):
			for ldt in ("Contact", "Address"):
				for x in frappe.get_all("Dynamic Link", {"link_name": p, "parenttype": ldt}, pluck="parent"):
					frappe.delete_doc(ldt, x, force=1, ignore_permissions=True)
			frappe.db.sql("delete from `tabGL Entry` where party=%s", p)
			frappe.db.sql("delete from `tabPayment Ledger Entry` where party=%s", p)
			frappe.db.sql("delete from `tabLoyalty Point Entry` where customer=%s", p)
			frappe.delete_doc(dt, p, force=1, ignore_permissions=True)
	frappe.db.commit()
	tk.restore_counters()
