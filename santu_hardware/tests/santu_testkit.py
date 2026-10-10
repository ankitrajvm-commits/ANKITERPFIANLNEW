"""Shared harness for the full-app test plan (2026-09-19).

Every suite built on this gets, for free:
  * the TEST site (scratch.local by default -- never the live shop) and the
    test user, with purge_test_residue at exit;
  * check(name, expected, actual) rows recorded as
    Expected -> Actual -> PASS/FAIL -> Evidence, written to tests/reports/;
  * the DATA-ISOLATION GATE: a fingerprint of every real (non-TEST) record
    taken at start and compared at the end -- one real record created,
    changed or deleted fails the whole run, however many checks passed;
  * the PRODUCTION GATE numbers: functional failures, invariant failures,
    test residue, production side-effects (printer / WhatsApp / counters).
"""
from __future__ import annotations

import atexit
import datetime
import hashlib
import json
import os
import subprocess

import frappe

TEST_USER = "claude.test@santuhardware.local"
SITE = os.environ.get("SANTU_TEST_SITE", "scratch.local")
REPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")

# Real data the tests must never touch. Filter = what counts as "not test".
_GUARDED = {
	"Customer": "name not like 'TEST%%' and name not like 'ZZ%%'",
	"Supplier": "name not like 'TEST%%' and name not like 'ZZ%%'",
	"Item": "name not like 'TEST%%' and name not like 'ZZ%%'",
	"Item Price": "item_code not like 'TEST%%' and item_code not like 'ZZ%%'",
	"Bin": "item_code not like 'TEST%%' and item_code not like 'ZZ%%'",
	"Sales Invoice": "owner != %(u)s",
	"POS Invoice": "owner != %(u)s",
	"Purchase Invoice": "owner != %(u)s",
	"Payment Entry": "owner != %(u)s",
	"Journal Entry": "owner != %(u)s",
	"Delivery Note": "owner != %(u)s",
	"Quotation": "owner != %(u)s",
	"Sales Order": "owner != %(u)s",
	"Purchase Order": "owner != %(u)s",
	"Stock Entry": "owner != %(u)s",
	"Stock Reconciliation": "owner != %(u)s",
	"Address": "owner != %(u)s",
	"Contact": "owner != %(u)s and ifnull(email_id,'') != %(u)s",
	"Loyalty Point Entry": "owner != %(u)s",
	"Santu Loyalty Pending Point": "owner != %(u)s",
	"Print Format": "1=1",
	"Santu Print Job": "1=1",
}
_GUARDED_SINGLES = ("Santu POS Settings", "Santu Backup Settings", "Stock Settings",
                    "Santu Transaction Message Settings", "Santu WhatsApp Settings")


def connect(site: str = SITE):
	frappe.init(site=site)
	frappe.connect()
	from santu_hardware.tests.claude_test_user import use_test_user_with_cleanup
	use_test_user_with_cleanup()
	return frappe


class Run:
	"""One suite run: checks, evidence, gates, report."""

	def __init__(self, suite: str):
		self.suite = suite
		self.rows: list[dict] = []
		self.section_name = ""
		self.started = datetime.datetime.now()
		self.snapshot = fingerprint_real_data()
		self.side_before = side_effect_counters()
		atexit.register(self.finish)
		self._finished = False

	# ---- checks ---------------------------------------------------------
	def section(self, title: str):
		self.section_name = title
		print("\n" + "=" * 78 + "\n" + title + "\n" + "=" * 78)

	def check(self, name, expected, actual, ok=None, evidence="", db_impact="", finding=False):
		"""finding=True: a real gap whose fix would change how the shop works
		-- recorded as FINDING for Ankit to decide, not counted as a failure."""
		if ok is None:
			ok = expected == actual
		result = "PASS" if ok else ("FINDING" if finding else "FAIL")
		row = {"section": self.section_name, "name": name, "expected": _s(expected), "actual": _s(actual),
		       "result": result, "evidence": _s(evidence), "db_impact": _s(db_impact)}
		self.rows.append(row)
		mark = result
		line = f"  {mark}  {name}"
		if not ok:
			line += f"\n        expected: {row['expected'][:200]}\n        actual:   {row['actual'][:200]}"
			if evidence:
				line += f"\n        evidence: {row['evidence'][:300]}"
			if db_impact:
				line += f"\n        db impact: {row['db_impact'][:200]}"
		if evidence and ok:
			line += f"   [{row['evidence'][:120]}]"
		print(line)
		return ok

	@property
	def failed(self):
		return [r for r in self.rows if r["result"] == "FAIL"]

	# ---- end of run -----------------------------------------------------
	def finish(self):
		if self._finished:
			return
		self._finished = True
		try:
			frappe.db.rollback()
		except Exception:
			pass
		self.section("GATES")
		try:
			from santu_hardware.tests.claude_test_user import purge_test_residue
			restore_counters()
			purge_test_residue()
		except Exception as e:
			print("  purge problem:", str(e)[:200])
		diff = diff_real_data(self.snapshot, fingerprint_real_data())
		isolation_ok = self.check("DATA ISOLATION: no real record created / changed / deleted",
		                          "no difference", diff or "no difference", ok=not diff)
		residue = test_residue()
		self.check("TEST RESIDUE: nothing of the test user left behind", {}, residue, ok=not residue)
		side = side_effects_since(self.side_before)
		self.check("PRODUCTION SIDE-EFFECTS: printer / WhatsApp / counters untouched", {}, side, ok=not side)
		functional = [r for r in self.rows if r["result"] == "FAIL" and not r["section"].startswith(("GATES", "INVARIANT"))]
		invariant = [r for r in self.rows if r["result"] == "FAIL" and r["section"].startswith("INVARIANT")]
		gate = {
			"functional_failures": len(functional),
			"invariant_failures": len(invariant),
			"test_residue": len(residue),
			"production_side_effects": len(side) + (0 if isolation_ok else len(diff)),
		}
		verdict = "SAFE" if not any(gate.values()) else "FAILED"
		print("\n" + "=" * 78)
		findings = [r for r in self.rows if r["result"] == "FINDING"]
		print(f"{self.suite}: PASS {len(self.rows) - len(self.failed) - len(findings)}  FAIL {len(self.failed)}  FINDINGS {len(findings)}   GATE {gate}   => {verdict}")
		for r in findings:
			print(f"  FINDING: {r['name']} -> {r['actual'][:120]}")
		print("=" * 78)
		self._write(gate, verdict)

	def _write(self, gate, verdict):
		os.makedirs(REPORT_DIR, exist_ok=True)
		stamp = self.started.strftime("%Y%m%d_%H%M%S")
		base = os.path.join(REPORT_DIR, f"{self.suite}_{SITE}_{stamp}")
		with open(base + ".json", "w") as fh:
			json.dump({"suite": self.suite, "site": SITE, "started": str(self.started), "gate": gate,
			           "verdict": verdict, "rows": self.rows}, fh, indent=1, ensure_ascii=False)
		with open(base + ".md", "w") as fh:
			fh.write(f"# {self.suite} on {SITE} ({self.started:%Y-%m-%d %H:%M}) — {verdict}\n\n")
			fh.write(f"Gate: {gate}\n\n| Section | Check | Expected | Actual | Result | Evidence |\n|---|---|---|---|---|---|\n")
			for r in self.rows:
				fh.write("| " + " | ".join(x.replace("|", "/").replace("\n", " ")[:160] for x in
				         (r["section"], r["name"], r["expected"], r["actual"], r["result"], r["evidence"] or r["db_impact"])) + " |\n")
		print(f"report: {base}.md")


def _s(v):
	if isinstance(v, str):
		return v
	try:
		return json.dumps(v, default=str, ensure_ascii=False)
	except Exception:
		return str(v)


# ---- data-isolation fingerprint -------------------------------------------
def fingerprint_real_data() -> dict:
	fp = {}
	for dt, cond in _GUARDED.items():
		if not frappe.db.table_exists(dt):
			continue
		cols = "name, modified, docstatus" if frappe.db.has_column(dt, "docstatus") else "name, modified"
		if dt == "Bin":
			cols = "name, modified, actual_qty, valuation_rate"
		rows = frappe.db.sql(f"select {cols} from `tab{dt}` where {cond} order by name", {"u": TEST_USER})
		fp[dt] = {r[0]: hashlib.md5(repr(r[1:]).encode()).hexdigest()[:10] for r in rows}
	for dt in _GUARDED_SINGLES:
		rows = frappe.db.sql("select field, value from tabSingles where doctype=%s order by field", dt)
		fp["single:" + dt] = {f: hashlib.md5(repr(v).encode()).hexdigest()[:10] for f, v in rows}
	fp["series"] = {n: str(c) for n, c in frappe.db.sql("select name, current from tabSeries where name like 'SANTU%%'")}
	return fp


def diff_real_data(before: dict, after: dict) -> dict:
	out = {}
	for key in set(before) | set(after):
		b, a = before.get(key, {}), after.get(key, {})
		created = sorted(set(a) - set(b))
		deleted = sorted(set(b) - set(a))
		changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
		if key.startswith("single:"):
			# last-run bookkeeping fields are allowed to move
			changed = [c for c in changed if c not in ("modified", "modified_by", "last_backup_on", "next_backup_on", "last_backup_status",
			                                          "connect_state", "connection_status", "last_sync_status")]
		if created or deleted or changed:
			out[key] = {"created": created[:5], "deleted": deleted[:5], "changed": changed[:5],
			            "counts": [len(created), len(deleted), len(changed)]}
	return out


def test_residue() -> dict:
	left = {}
	for dt in frappe.get_all("DocType", {"istable": 0, "issingle": 0, "is_virtual": 0}, pluck="name"):
		if dt in ("Santu Backup Log",) or not frappe.db.table_exists(dt):
			continue
		try:
			c = frappe.db.sql(f"select count(*) from `tab{dt}` where owner=%s", TEST_USER)[0][0]
		except Exception:
			continue
		if c:
			left[dt] = c
	# the one real WhatsApp a test once sent (2026-09-10) is kept on purpose
	for dt, n in (("Santu WhatsApp Chat Message", 1), ("Santu WhatsApp Contact", 1),
	              ("Santu WhatsApp Message Log", 1), ("File", 2), ("Comment", 2)):
		if left.get(dt, 0) <= n:
			left.pop(dt, None)
	for dt in ("Item", "Customer", "Supplier"):
		n = frappe.db.count(dt, {"name": ["like", "TEST%"]})
		if n:
			left[f"{dt} named TEST%"] = n
	return left


def _lp_count():
	try:
		out = subprocess.run(["sh", "-c", "lpstat -W completed -o 2>/dev/null | wc -l"], capture_output=True, text=True, timeout=10)
		return int(out.stdout.strip() or 0)
	except Exception:
		return -1


def _usb_count():
	try:
		path = os.path.join(frappe.utils.get_bench_path(), "logs", "santu_usb_prints.log")
		return sum(1 for _ in open(path)) if os.path.exists(path) else 0
	except Exception:
		return -1


def side_effect_counters() -> dict:
	return {
		"usb_prints": _usb_count(),
		"printer_jobs": _lp_count(),
		"whatsapp_logs": frappe.db.count("Santu WhatsApp Message Log"),
		"whatsapp_sent": frappe.db.count("Santu WhatsApp Message Log", {"status": "Sent"}),
	}


def side_effects_since(before: dict) -> dict:
	now = side_effect_counters()
	out = {k: [before[k], now[k]] for k in before if now.get(k) != before[k]}
	for s, dts in (("SANTU-BILL-NO", ("Sales Invoice", "POS Invoice")), ("SANTU-ESTIMATE-NO", ("Quotation",))):
		cur = frappe.db.sql("select current from tabSeries where name=%s", s)
		top = max(int(frappe.db.sql(f"select ifnull(max(santu_bill_no),0) from `tab{dt}`")[0][0] or 0) for dt in dts)
		if cur and int(cur[0][0]) != top:
			out[f"counter {s}"] = [int(cur[0][0]), top]
	return out


def restore_counters():
	"""Put bill / estimate counters back on the highest number that exists."""
	for s, dts in (("SANTU-BILL-NO", ("Sales Invoice", "POS Invoice")), ("SANTU-ESTIMATE-NO", ("Quotation",))):
		top = max(int(frappe.db.sql(f"select ifnull(max(santu_bill_no),0) from `tab{dt}`")[0][0] or 0) for dt in dts)
		frappe.db.sql("update tabSeries set current=%s where name=%s", (top, s))
	frappe.db.commit()
