"""One command that runs the suites and prints one verdict.

    cd frappe-bench/sites
    ../env/bin/python ../apps/santu_hardware/santu_hardware/tests/run_all.py

The suites have existed since 2026-09-19 but had to be remembered and invoked
one by one, so they stopped being run at all -- the last reports are dated
19 September, and in the eighteen days after it four "Edit" buttons sat dead
on the View screen without anyone noticing (2026-10-07). A suite nobody runs
is not a safety net, so this makes running them a single command.

    --quick   the fast, read-only ones only (default; good before a commit)
    --full    everything, including the slow write suites
    --live    also run the READ-ONLY suites against the live shop

Safety, unchanged from the suites themselves:
  * write suites run on the TEST COPY (scratch.local) and nowhere else -- the
    --live flag refuses to carry them;
  * each suite still enforces its own data-isolation and residue gates;
  * a suite that crashes is a FAILURE, never a silent skip.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON = os.path.join(HERE, "..", "..", "..", "..", "env", "bin", "python")
SITES = os.path.join(HERE, "..", "..", "..", "..", "sites")

# read_only: safe to point at the live shop as well as the test copy.
# slow: only in --full, because these take minutes rather than seconds.
# Two suites drive the app over real HTTP against the TEST COPY's own web
# server. Without it they cannot run at all: every call is refused, every
# check fails, and their fixtures are left behind -- which is exactly how four
# suites in a row came to report a residue failure that was really this
# (2026-10-07). Start it in another terminal first:
#     cd frappe-bench && bench serve --port 8001 --site scratch.local
SCRATCH_HTTP = ("127.0.0.1", 8001)

# Named suite_*.py, not test_*.py, on purpose. `bench run-tests --app
# santu_hardware` imports every test_*.py it can find, and these are
# standalone scripts that run their whole body on import and expect a live
# site and HTTP server -- CI exploded on the first one it touched
# ("Connection refused ... port 8001", 2026-10-07). Keep the prefix.
SUITES = [
	{"file": "suite_invariants.py", "read_only": True, "slow": False,
	 "what": "Data health: stock = ledger, GL balances, bill numbers, reward points"},
	{"file": "suite_session_2026_09_05.py", "read_only": True, "slow": False,
	 "what": "Regression: every fix from the 2026-09-05 session onwards"},
	{"file": "suite_write_guard.py", "read_only": False, "slow": False,
	 "what": "A user with no roles must not be able to change anything"},
	{"file": "suite_permissions.py", "read_only": False, "needs_http": True, "slow": False,
	 "what": "Permission matrix: who can view / create / submit / cancel / delete"},
	{"file": "suite_reports_utils_backup.py", "read_only": False, "slow": False,
	 "what": "Reports, Utilities and Backup screens"},
	{"file": "suite_billing_extreme.py", "read_only": False, "slow": True,
	 "what": "Billing torture: zero stock, fractions, discounts, 60-line bills"},
	{"file": "suite_failure_first.py", "read_only": False, "slow": True,
	 "what": "Concurrency, idempotency, fuzz, stock chain, reconciliation, rollback"},
	{"file": "suite_api_matrix.py", "read_only": False, "needs_http": True, "slow": True,
	 "what": "Every whitelisted API, seven ways, over real HTTP"},
]

# Two summary shapes exist, because the suites were written months apart:
#   testkit  : "invariants: PASS 18  FAIL 1  FINDINGS 0  GATE {...}  => FAILED"
#   standalone: "PASS: 534    FAIL: 1"
# The runner has to read both, or a perfectly healthy suite is reported as
# CRASHED purely for printing its total differently (2026-10-07).
SUMMARY_GATED = re.compile(r"PASS (\d+)\s+FAIL (\d+)(?:\s+FINDINGS (\d+))?.*?=>\s*(\w+)", re.S)
SUMMARY_PLAIN = re.compile(r"^PASS:\s*(\d+)\s+FAIL:\s*(\d+)\s*$", re.M)


def _scratch_http_up() -> bool:
	"""Is the test copy's web server listening? Checked rather than assumed, so
	an HTTP suite is skipped with a reason instead of failing meaninglessly."""
	import socket

	try:
		with socket.create_connection(SCRATCH_HTTP, timeout=1.5):
			return True
	except OSError:
		return False


def run_one(suite: str, site: str, timeout: int) -> dict:
	started = time.time()
	env = dict(os.environ, SANTU_TEST_SITE=site)
	try:
		p = subprocess.run(
			[os.path.abspath(PYTHON), os.path.join(HERE, suite)],
			cwd=os.path.abspath(SITES),
			env=env,
			capture_output=True,
			text=True,
			timeout=timeout,
		)
		out = (p.stdout or "") + (p.stderr or "")
		rc = p.returncode
	except subprocess.TimeoutExpired:
		return {"suite": suite, "site": site, "verdict": "TIMEOUT", "passed": 0,
		        "failed": 0, "secs": time.time() - started,
		        "note": f"no result after {timeout}s"}

	m = None
	for m in SUMMARY_GATED.finditer(out):
		pass  # the LAST summary is the suite's own, not a sub-section's
	if m is None:
		plain = None
		for plain in SUMMARY_PLAIN.finditer(out):
			pass
		if plain:
			passed, failed = int(plain.group(1)), int(plain.group(2))
			return {"suite": suite, "site": site,
			        "verdict": "SAFE" if not failed else "FAILED",
			        "passed": passed, "failed": failed, "findings": 0,
			        "secs": time.time() - started, "note": ""}
	if not m:
		# A suite that dies before printing its summary has still failed --
		# the old habit of reading "no output" as "nothing to report" is
		# exactly how a broken suite goes unnoticed.
		tail = "\n".join([ln for ln in out.strip().splitlines() if ln.strip()][-3:])
		return {"suite": suite, "site": site, "verdict": "CRASHED", "passed": 0,
		        "failed": 0, "secs": time.time() - started,
		        "note": tail[:300] or f"exit code {rc}, no output"}

	passed, failed, findings, verdict = m.group(1), m.group(2), m.group(3), m.group(4)
	return {"suite": suite, "site": site, "verdict": verdict, "passed": int(passed),
	        "failed": int(failed), "findings": int(findings or 0),
	        "secs": time.time() - started, "note": ""}


def main() -> int:
	ap = argparse.ArgumentParser(description="Run the Santu Hardware test suites.")
	ap.add_argument("--full", action="store_true", help="include the slow write suites")
	ap.add_argument("--live", action="store_true", help="also run the read-only suites on the live shop")
	ap.add_argument("--timeout", type=int, default=1800, help="seconds per suite (default 1800)")
	ap.add_argument("--only", help="run just the suites whose filename contains this")
	args = ap.parse_args()

	chosen = [s for s in SUITES if args.full or not s["slow"]]

	if not _scratch_http_up():
		skipped = [s["file"] for s in chosen if s.get("needs_http")]
		if skipped:
			print("\n  !! The test copy's web server is not running on "
			      f"{SCRATCH_HTTP[0]}:{SCRATCH_HTTP[1]}, so these are SKIPPED, not run:")
			for f in skipped:
				print(f"       {f}")
			print("     Start it in another terminal and run again:")
			print("       cd frappe-bench && bench serve --port 8001 --site scratch.local\n")
		chosen = [s for s in chosen if not s.get("needs_http")]
	if args.only:
		chosen = [s for s in chosen if args.only in s["file"]]
	missing = [s["file"] for s in chosen if not os.path.isfile(os.path.join(HERE, s["file"]))]
	for f in missing:
		print(f"  !! {f} is listed here but not on disk")
	chosen = [s for s in chosen if s["file"] not in missing]

	jobs = [(s, "scratch.local") for s in chosen]
	if args.live:
		# Read-only suites only. A write suite on the live shop would create
		# real bills and burn real bill numbers.
		jobs += [(s, "site1.local") for s in chosen if s["read_only"]]

	print("=" * 78)
	print(f"Santu Hardware tests — {len(jobs)} run(s)"
	      f"{'  (including the slow ones)' if args.full else '  (quick set)'}")
	print("=" * 78)

	results = []
	for suite, site in jobs:
		print(f"\n▶ {suite['file']}  on {site}")
		print(f"  {suite['what']}")
		r = run_one(suite["file"], site, args.timeout)
		results.append(r)
		mark = "ok " if r["verdict"] == "SAFE" else "!! "
		detail = f"PASS {r['passed']}  FAIL {r['failed']}"
		print(f"  {mark}{r['verdict']}  {detail}  ({r['secs']:.0f}s)")
		if r["note"]:
			print(f"     {r['note']}")

	bad = [r for r in results if r["verdict"] != "SAFE"]
	print("\n" + "=" * 78)
	print(f"{len(results) - len(bad)} of {len(results)} clean"
	      f"   |   total PASS {sum(r['passed'] for r in results)}"
	      f"   FAIL {sum(r['failed'] for r in results)}")
	for r in bad:
		print(f"   !! {r['suite']} on {r['site']}: {r['verdict']}"
		      f" ({r['failed']} failing check(s))")
	print("reports: tests/reports/")
	print("=" * 78)
	return 1 if bad else 0


if __name__ == "__main__":
	sys.exit(main())
