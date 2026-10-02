"""Data-health invariants (full-app test plan, part F). READ-ONLY -- safe on
the live site too:  SANTU_TEST_SITE=site1.local ../env/bin/python .../test_invariants.py

Each check states what the books must satisfy and shows the offending rows
as evidence. Sections start with "INVARIANT" so the gate counts them as data
failures, not functional ones.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from santu_hardware.tests import santu_testkit as tk  # noqa: E402

frappe = tk.connect()
from frappe.utils import flt  # noqa: E402

run = tk.Run("invariants")
TOL = 0.01


def invariants():
	run.section("INVARIANT 1. STOCK: Bin = what the stock ledger says")
	rows = frappe.db.sql("""
		select b.item_code, b.warehouse, b.actual_qty,
		  (select s.qty_after_transaction from `tabStock Ledger Entry` s
		    where s.item_code=b.item_code and s.warehouse=b.warehouse and s.is_cancelled=0
		    order by s.posting_date desc, s.posting_time desc, s.creation desc limit 1) as sle_qty
		from tabBin b""", as_dict=True)
	bad = [(r.item_code, r.warehouse, r.actual_qty, r.sle_qty) for r in rows
	       if r.sle_qty is not None and abs(flt(r.actual_qty) - flt(r.sle_qty)) > TOL]
	run.check("every Bin qty equals its last stock-ledger balance", 0, len(bad), evidence=bad[:5])
	no_sle = [(r.item_code, r.actual_qty) for r in rows if r.sle_qty is None and abs(flt(r.actual_qty)) > TOL]
	run.check("no Bin shows stock without any stock-ledger entry", 0, len(no_sle), evidence=no_sle[:5])

	run.section("INVARIANT 2. BOOKS: every voucher balances (debit = credit)")
	unb = frappe.db.sql("""
		select voucher_type, voucher_no, round(sum(debit)-sum(credit),2) d
		from `tabGL Entry` where is_cancelled=0 group by voucher_type, voucher_no
		having abs(sum(debit)-sum(credit)) > 0.05 limit 20""")
	run.check("no voucher with debit != credit", 0, len(unb), evidence=unb[:5])
	tot = frappe.db.sql("select round(sum(debit)-sum(credit),2) from `tabGL Entry` where is_cancelled=0")[0][0]
	run.check("whole ledger balances", 0.0, flt(tot), ok=abs(flt(tot)) < 0.05)

	run.section("INVARIANT 3. UDHAAR: bill outstanding = payment ledger")
	bad = frappe.db.sql("""
		select si.name, si.santu_bill_no, si.outstanding_amount,
		  (select ifnull(sum(p.amount),0) from `tabPayment Ledger Entry` p
		    where p.against_voucher_no=si.name and p.delinked=0) ple
		from `tabSales Invoice` si where si.docstatus=1 and si.is_return=0
		having abs(si.outstanding_amount - ple) > 0.05 limit 20""")
	run.check("every submitted bill's outstanding matches its payment ledger", 0, len(bad), evidence=bad[:5])
	neg = frappe.db.sql("select name, santu_bill_no, outstanding_amount from `tabSales Invoice` "
	                    "where docstatus=1 and is_return=0 and outstanding_amount < -0.05 limit 10")
	run.check("no normal bill has a negative outstanding (over-paid without advance)", 0, len(neg), evidence=neg[:5])

	run.section("INVARIANT 4. BILL NUMBERS: one live bill per number, counter on the top")
	dup = frappe.db.sql("""
		select santu_bill_no, group_concat(name) from `tabSales Invoice`
		where docstatus=1 and ifnull(santu_bill_no,0) > 0 group by santu_bill_no having count(*) > 1""")
	run.check("no bill number used by two LIVE (submitted) bills", 0, len(dup), evidence=dup[:5])
	top = int(frappe.db.sql("select ifnull(max(santu_bill_no),0) from `tabSales Invoice`")[0][0] or 0)
	cur = int(frappe.db.sql("select current from tabSeries where name='SANTU-BILL-NO'")[0][0])
	run.check("bill counter sits on the last bill number", top, cur)
	etop = int(frappe.db.sql("select ifnull(max(santu_bill_no),0) from tabQuotation")[0][0] or 0)
	ecur = int(frappe.db.sql("select current from tabSeries where name='SANTU-ESTIMATE-NO'")[0][0])
	run.check("estimate counter sits on the last estimate number", etop, ecur)
	# gaps since the plain numbering went live are reported, not failed: some
	# are historical (bills deleted by hand before the guards existed)
	nums = {r[0] for r in frappe.db.sql("select santu_bill_no from `tabSales Invoice` where ifnull(santu_bill_no,0) > 0")}
	# Known, investigated 2026-09-19 (see report): 827-832 were burned by test
	# runs on 6-8 Sept before the counter restore existed; 815/816 were bills
	# deleted on 5 Sept. Real bills 833+ are already in customers' hands, so
	# they cannot be renumbered. Any NEW gap still fails.
	# 887: the shop itself deleted that bill on 2026-09-20 (RAEESH ANSARI),
	# before deleting the last bill gave its number back.
	known = {815, 816, 827, 828, 829, 830, 831, 832, 887}
	recent_gaps = [n for n in range(max(1, top - 60), top + 1) if n not in nums]
	run.check("no NEW gap in the last 60 bill numbers", [], [g for g in recent_gaps if g not in known],
	          evidence=f"known old gaps: {sorted(known & set(recent_gaps))}")

	run.section("INVARIANT 5. REWARD POINTS: nothing points at a bill that is gone")
	orphan_lpe = frappe.db.sql("""select name, invoice, customer, loyalty_points from `tabLoyalty Point Entry` l
		where ifnull(invoice,'')!='' and not exists (select 1 from `tabSales Invoice` s where s.name=l.invoice) limit 10""")
	# 10 known rows from 19-21 Aug (9 x "Walk-in Customer", 1 x Manish singh
	# with 0 points) point at bills deleted in the August clean-up; kept until
	# Ankit decides. A new orphan still fails.
	known_lpe = {"04egvq7h2k", "0mbn3mon0b", "1ao52113vu", "1f4jeclmo6", "1glb6iddm4", "1mmfln6sgl",
	             "1pbpc7b68r", "1qr8olkuf3", "225utjt02r", "t1olv3q11d"}
	new_orphans = [r for r in orphan_lpe if r[0] not in known_lpe]
	run.check("no NEW Loyalty Point Entry for a deleted bill", 0, len(new_orphans), evidence=new_orphans[:5] or f"{len(orphan_lpe)} known old rows")
	orphan_pp = frappe.db.sql("""select name, invoice from `tabSantu Loyalty Pending Point` p
		where not exists (select 1 from `tabSales Invoice` s where s.name=p.invoice) limit 10""")
	run.check("no pending-points row for a deleted bill", 0, len(orphan_pp), evidence=orphan_pp[:5])
	walkin = frappe.db.sql("select count(*) from `tabLoyalty Point Entry` where customer='SALES' and loyalty_points > 0")[0][0]
	run.check("walk-in (SALES) never earns points", 0, walkin)

	run.section("INVARIANT 6. MASTER DATA")
	svc = frappe.db.sql("""select name from tabItem where disabled=0 and is_stock_item=0
		and name not in ('Udhaar','Purana Baki','UDHAAR','PURANA-BAKI') and item_name not like '%%udhaar%%'
		and item_name not like '%%baki%%' limit 10""")
	run.check("no service (non-stock) items except Udhaar / Purana Baki", 0, len(svc), evidence=svc[:5])
	locked = frappe.db.count("UOM", {"must_be_whole_number": 1})
	run.check("no unit refuses a fraction (9.5 Nos)", 0, locked)
	ghost = frappe.db.sql("""select name from `tabSales Invoice` where docstatus=0 and owner!=%s
		and creation < now() - interval 30 day limit 5""", tk.TEST_USER)
	run.check("no draft bill older than 30 days left hanging", 0, len(ghost), evidence=ghost)


invariants()
