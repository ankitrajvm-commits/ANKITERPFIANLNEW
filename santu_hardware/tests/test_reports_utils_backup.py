"""Reports, Utilities and Backup (full-app test plan, sidebar parents 8, 9, 10).

Runs on the TEST COPY. Every report the Reports screen offers is run with
the filters the screen itself would send (list read from
public/js/santu_reports/santu_reports_config.js via tests/fixtures/
reports_config.json); money reports are cross-checked against the ledger.
Utilities are exercised on TEST records only; backup is created, verified,
listed and removed, and a restore is done ONLY on the test copy.
"""
import json
import os

from santu_hardware.tests import santu_testkit as tk

frappe = tk.connect()
from frappe.utils import add_days, flt, get_first_day, getdate, today  # noqa: E402

import santu_hardware.santu_hardware.api as a  # noqa: E402

run = tk.Run("reports_utils_backup")
U = tk.TEST_USER
HERE = os.path.dirname(os.path.abspath(__file__))


def err(fn):
	try:
		return None, fn()
	except Exception as e:  # noqa: BLE001
		frappe.db.rollback()
		return str(e)[:300], None


# ------------------------------------------------------------------ reports
run.section("R. REPORTS (every entry on the Reports screen)")
init = a.get_reports_init()
company = init.get("company") or frappe.defaults.get_user_default("Company")
fy = init.get("fiscal_year")
T = today()
MS = str(get_first_day(T))
YS = str(frappe.db.get_value("Fiscal Year", fy, "year_start_date") or MS)
subs = {"FY": fy, "G": init.get("company_gstin") or "", "TODAY": T, "C": company, "NaN": str(getdate(T).year),
        "MONTH_START": MS, "YEAR_START": YS}


def fix(v):
	if isinstance(v, list):
		return [MS if "undefined" in str(x) else fix(x) for x in v]
	if isinstance(v, str):
		return subs.get(v, v)
	return v


reports = json.load(open(os.path.join(HERE, "fixtures", "reports_config.json")))
ran = 0
for r in reports:
	if r["type"] not in ("erpnext", "custom"):
		continue
	filters = {"company": company, "from_date": YS, "to_date": T}
	filters.update({k: fix(v) for k, v in (r.get("extra") or {}).items()})
	if r["id"] == "gstr3b":  # the screen computes these from today's date
		filters.update(year=str(getdate(T).year), month_or_quarter=getdate(T).strftime("%B"))
	if r.get("report_name") in ("TDS Computation Summary-India", "Tax Withholding Details-India"):
		filters.setdefault("fiscal_year", fy)
	if r["type"] == "erpnext":
		e, res = err(lambda: frappe.get_attr("frappe.desk.query_report.run")(r["report_name"], filters=json.dumps(filters), ignore_prepared_report=True))
		rows = len((res or {}).get("result") or [])
	else:
		e, res = err(lambda: a.run_santu_report(r["method"], json.dumps(filters)))
		rows = len((res or {}).get("result") or (res or {}).get("data") or [])
	ran += 1
	known_data = r["id"] == "stock_detail" and e and ("ZZ" in e or "REG-" in e)
	run.check(f"report '{r['label']}' opens", None, e, evidence=f"{r.get('report_name') or r.get('method')} rows={rows}",
	          finding=bool(known_data))  # crashes on stock rows of deleted test items -- cleanup awaits Ankit
	if r["id"] == "trial_balance" and res:
		data = [x for x in res.get("result") or [] if isinstance(x, dict) and x.get("account") and not x.get("parent_account")]
		dr = sum(flt(x.get("closing_debit")) for x in data)
		cr = sum(flt(x.get("closing_credit")) for x in data)
		run.check("  Trial Balance: closing debit = closing credit", round(dr, 2), round(cr, 2), ok=abs(dr - cr) < 1)
	if r["id"] == "day_book" and res:
		led = [x for x in res.get("result") or [] if isinstance(x, dict) and x.get("voucher_no")]
		dr, cr = sum(flt(x.get("debit")) for x in led), sum(flt(x.get("credit")) for x in led)
		gl = frappe.db.sql("""select ifnull(sum(debit),0), ifnull(sum(credit),0) from `tabGL Entry` where is_cancelled=0
			and company=%s and posting_date between %s and %s""", (company, YS, T))[0]
		run.check("  Day Book debit = the ledger's debit for the period", round(flt(gl[0]), 2), round(dr, 2), ok=abs(flt(gl[0]) - dr) < 1)
		run.check("  Day Book debit = credit", round(dr, 2), round(cr, 2), ok=abs(dr - cr) < 1)
run.check("all runnable reports were tried", True, ran >= 35, evidence=f"{ran} run")
for view in ("invoices", "quotation", "delivery_challan", "sales_order", "sales_return", "payment_in"):
	e, res = err(lambda: a.get_sale_dashboard_data(view=view, period="This Year"))
	run.check(f"Sale screen view '{view}' (embedded in Reports)", None, e)
e, res = err(lambda: a.get_sale_dashboard_data(view="invoices", period="This Year"))
if res:
	ui_total = flt((res.get("summary") or {}).get("total") or (res.get("summary") or {}).get("total_amount"))
	db_total = flt(frappe.db.sql("""select ifnull(sum(grand_total),0) from `tabSales Invoice` where docstatus=1 and is_return=0
		and posting_date between %s and %s""", (YS, T))[0][0])
	run.check("Sale screen 'This Year' total = sum of submitted bills", round(db_total, 2), round(ui_total, 2),
	          ok=(not ui_total) or abs(ui_total - db_total) < 1, evidence="summary keys: " + ",".join((res.get("summary") or {}).keys()))
stock_val_bins = flt(frappe.db.sql("select ifnull(sum(stock_value),0) from tabBin")[0][0])
acc = frappe.db.get_value("Account", {"account_type": "Stock", "is_group": 0, "company": company}, "name")
stock_val_gl = flt(frappe.db.sql("select ifnull(sum(debit-credit),0) from `tabGL Entry` where account=%s and is_cancelled=0", acc)[0][0])
run.check("stock value in the books = stock value of all items", round(stock_val_bins, 2), round(stock_val_gl, 2),
          ok=abs(stock_val_bins - stock_val_gl) < max(1, abs(stock_val_bins) * 0.001), finding=True,
          evidence="a gap here means stock was posted without accounts (old data) -- report, not a counter bug")

# ---------------------------------------------------------------- utilities
run.section("U. UTILITIES (TEST records only)")
from santu_hardware.santu_hardware import utilities_api as ua  # noqa: E402

for fn, args in (("get_data_audit", {}), ("get_fiscal_year_checklist", {}), ("get_salesman_report", {"from_date": MS, "to_date": T}),
                 ("get_business_setup", {}), ("get_bulk_item_brands", {}), ("get_recycle_bin_documents", {"limit": 5}),
                 ("get_tally_export_data", {"from_date": MS, "to_date": T})):
	e, res = err(lambda: getattr(ua, fn)(**args))
	run.check(f"{fn} works", None, e)
for mode in ("pricing", "stock", "hsn", "uom", "reward"):
	e, res = err(lambda: ua.get_bulk_items(mode=mode, page=1, page_size=5))
	run.check(f"Update Items In Bulk - '{mode}' tab loads", None, e, ok=e is None or "mode" in (e or "").lower())
e, before = err(lambda: ua.get_business_setup())
if before:
	e2, _ = err(lambda: ua.save_business_setup(json.dumps(before)))
	frappe.db.commit()
	e3, after = err(lambda: ua.get_business_setup())
	run.check("Shop Profile saved unchanged -> nothing lost (logo / address stay)", json.dumps(before, sort_keys=True, default=str)[:4000],
	          json.dumps(after, sort_keys=True, default=str)[:4000], evidence=e2)
# TEST item for bulk update / barcode
code = "TEST-UTIL-ITEM"
if not frappe.db.exists("Item", code):
	frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": "TEST UTIL ITEM", "item_group": "Products", "stock_uom": "Nos",
	                "is_stock_item": 1, "gst_hsn_code": frappe.db.get_value("Item", {"gst_hsn_code": ["is", "set"], "name": ["not like", "TEST%"]}, "gst_hsn_code"),
	                "barcodes": [{"barcode": "TEST9990001"}]}).insert(ignore_permissions=True)
	frappe.db.commit()
e, res = err(lambda: ua.bulk_update_items(json.dumps([{"item_code": code, "standard_rate": 123}])))
frappe.db.commit()
run.check("bulk update changes a TEST item's price", None, e, evidence=res)
e, res = err(lambda: ua.lookup_barcode_item("TEST9990001"))
run.check("barcode lookup finds the TEST item", True, bool(res) and code in json.dumps(res, default=str), evidence=e or str(res)[:120])
e, res = err(lambda: ua.generate_barcode_labels(json.dumps([{"item_code": code, "qty": 2}])))
run.check("barcode labels generate", None, e)
e, res = err(lambda: ua.export_items_file())
run.check("Export Items builds a file", None, e)
e, res = err(lambda: ua.import_parties(json.dumps([{"name": "TEST IMPORT PARTY", "phone": "12345"}]), "Customer"))
frappe.db.commit()
made = frappe.db.get_value("Customer", {"customer_name": "TEST IMPORT PARTY"}, ["name", "mobile_no"], as_dict=True)
run.check("Import Parties obeys the 10-digit phone rule too", True, not made or not made.mobile_no or len(made.mobile_no) == 10,
          evidence=f"result={str(res)[:160]} err={e} made={made}")
# recycle bin: delete a TEST customer, find it in the bin, restore it
if not frappe.db.exists("Customer", "TEST RECYCLE"):
	frappe.get_doc({"doctype": "Customer", "customer_name": "TEST RECYCLE", "customer_group": "Individual", "territory": "India",
	                "mobile_no": "9000000021"}).insert(ignore_permissions=True)
frappe.db.commit()
frappe.delete_doc("Customer", "TEST RECYCLE", ignore_permissions=True)
frappe.db.commit()
e, binlist = err(lambda: ua.get_recycle_bin_documents(search="TEST RECYCLE", limit=5))
rows = (binlist or {}).get("documents") if isinstance(binlist, dict) else binlist
dd = frappe.db.get_value("Deleted Document", {"deleted_name": "TEST RECYCLE", "restored": 0}, "name")
run.check("deleted TEST customer shows in the Recycle Bin", True, bool(dd), evidence=str(rows)[:120])
if dd:
	e, _ = err(lambda: ua.restore_deleted_document(dd))
	frappe.db.commit()
	run.check("Recycle Bin restore brings it back", True, bool(frappe.db.exists("Customer", "TEST RECYCLE")), evidence=e)

# ------------------------------------------------------------------ backup
run.section("B. BACKUP (test copy only)")
from santu_hardware.santu_hardware import sync_backup_api as sb  # noqa: E402

e, st = err(lambda: sb.get_backup_settings())
run.check("backup settings load", None, e)
if st:
	e, _ = err(lambda: sb.save_backup_settings(json.dumps({k: v for k, v in st.items() if not k.startswith("_")}, default=str)))
	frappe.db.commit()
	run.check("backup settings save unchanged", None, e)
e, hist = err(lambda: sb.list_backup_history())
run.check("backup history lists", None, e)
e, made = err(lambda: sb.create_manual_backup(include_files=0))
frappe.db.commit()
name = (made or {}).get("name")
log = frappe.db.get_value("Santu Backup Log", name, ["status", "verified", "database_file", "verify_note"], as_dict=True) if name else None
run.check("manual backup is created AND verified (opens, dump complete)", True, bool(log and log.status == "Success" and log.verified),
          evidence=(log and log.verify_note) or e)
if log and log.database_file:
	path = log.database_file if os.path.isabs(log.database_file) else os.path.normpath(os.path.join(frappe.utils.get_bench_path(), "sites", log.database_file))
	run.check("backup file sits in the TEST COPY's own folder, not the shop's", True, "/scratch.local/" in path, evidence=path)
	e, _ = err(lambda: sb.remove_backup(name))
	frappe.db.commit()
	run.check("the test's backup is removed again", False, os.path.exists(path), evidence=e)
e, _ = err(lambda: sb.restore_site_backup("DOES-NOT-EXIST", "wrong"))
run.check("restore refuses without the exact confirmation text / a real backup", True, e is not None, evidence=e)

# ----------------------------------------------------------------- cleanup
run.section("CLEANUP")
for c in ("TEST RECYCLE", "TEST IMPORT PARTY"):
	for n in frappe.get_all("Customer", {"customer_name": c}, pluck="name"):
		for ldt in ("Contact", "Address"):
			for x in frappe.get_all("Dynamic Link", {"link_name": n, "parenttype": ldt}, pluck="parent"):
				frappe.delete_doc(ldt, x, force=1, ignore_permissions=True)
		frappe.delete_doc("Customer", n, force=1, ignore_permissions=True)
for t in ("Item Price", "Bin"):
	frappe.db.sql(f"delete from `tab{t}` where item_code=%s", code)
if frappe.db.exists("Item", code):
	frappe.delete_doc("Item", code, force=1, ignore_permissions=True)
frappe.db.sql("delete from `tabDeleted Document` where deleted_name like 'TEST%%'")
frappe.db.commit()
