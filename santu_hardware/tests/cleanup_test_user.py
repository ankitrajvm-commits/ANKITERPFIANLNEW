"""Remove EVERYTHING the test user made on a site (default: the test copy).

Used after browser (UI) test runs, where the page itself creates bills,
payments, challans... Cancels submitted documents newest-first (returns and
amendments before their originals), deletes them, then TEST items / parties,
then the residue sweep, then puts the bill / estimate counters back.

  cd frappe-bench/sites && ../env/bin/python ../apps/santu_hardware/santu_hardware/tests/cleanup_test_user.py
"""
import os

import frappe

SITE = os.environ.get("SANTU_TEST_SITE", "scratch.local")
U = "claude.test@santuhardware.local"

DOC_ORDER = ("Payment Entry", "Journal Entry", "Sales Invoice", "Sales Invoice", "Delivery Note", "Sales Order",
             "Quotation", "Purchase Invoice", "Purchase Invoice", "Purchase Order", "Stock Reconciliation",
             "Stock Entry", "Santu Print Job")


def main():
	if not getattr(frappe.local, "site", None):
		frappe.init(site=SITE)
		frappe.connect()
	frappe.set_user(U)
	problems = []
	for dt in DOC_ORDER:
		if not frappe.db.table_exists(dt):
			continue
		order = "is_return desc, creation desc" if frappe.db.has_column(dt, "is_return") else "creation desc"
		for n in frappe.get_all(dt, {"owner": U}, pluck="name", order_by=order):
			try:
				d = frappe.get_doc(dt, n)
				if d.docstatus == 1:
					d.flags.ignore_permissions = True
					d.cancel()
					frappe.db.commit()
				frappe.delete_doc(dt, n, force=1, ignore_permissions=True)
				frappe.db.commit()
			except Exception as e:  # noqa: BLE001
				frappe.db.rollback()
				problems.append((dt, n, str(e)[:120]))
	for code in frappe.get_all("Item", {"owner": U, "name": ["like", "TEST%"]}, pluck="name"):
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
	from santu_hardware.tests.claude_test_user import purge_test_residue
	from santu_hardware.tests.santu_testkit import restore_counters, test_residue
	restore_counters()
	purge_test_residue()
	print("problems:", problems)
	print("residue:", test_residue())


if __name__ == "__main__":
	main()
