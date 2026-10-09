"""Write-guard sweep: can a logged-in user with NO roles change anything?

TEST COPY only (http://127.0.0.1:8001). One TEST user with no roles calls
every whitelisted santu function that writes (by name), with no arguments.
A permission refusal = GUARDED. Anything else (success, or a validation
error that proves the code ran past the door) = UNGUARDED -> FAIL.
Getters are reported separately (reading shop data without a role).
WhatsApp-bridge controls are never called: the bridge is the live shop's.
"""
import importlib
import os
import pkgutil
import re
from types import SimpleNamespace

import requests

from santu_hardware.tests import santu_testkit as tk

frappe = tk.connect()
from frappe.sessions import Session  # noqa: E402

run = tk.Run("write_guard")
BASE = os.environ.get("SANTU_TEST_URL", "http://127.0.0.1:8001")
EMAIL = "test.norole@santuhardware.local"

import santu_hardware.santu_hardware as _pkg  # noqa: E402

for m in pkgutil.walk_packages(_pkg.__path__, "santu_hardware.santu_hardware."):
	if ".tests" in m.name or ".patches" in m.name:
		continue
	try:
		importlib.import_module(m.name)
	except Exception:
		pass
fns = sorted({f"{f.__module__}.{f.__name__}": f for f in frappe.whitelisted if f.__module__.startswith("santu_hardware")}.items())
guest = {f"{f.__module__}.{f.__name__}" for f in frappe.guest_methods}
NEVER = re.compile(r"(bridge|disconnect|logout|refresh|start_|stop_|qr_|connect|kill|restart|reboot)", re.I)
READ = re.compile(r"^(get_|list_|search_|read_|find_|lookup_|check_|preview|has_|is_|format_|verify_|count_|download_|export_|items_uoms|party_address_line|bill_label|receipt_label)", re.I)

frappe.set_user("Administrator")
if not frappe.db.exists("User", EMAIL):
	u = frappe.new_doc("User")
	u.email, u.first_name, u.user_type, u.send_welcome_email = EMAIL, "TEST NOROLE", "System User", 0
	u.flags.no_welcome_mail = True
	u.insert(ignore_permissions=True)
frappe.db.commit()
frappe.local.request_ip = "127.0.0.1"
frappe.local.form_dict = frappe._dict()
frappe.local.request = SimpleNamespace(cookies={"sid": "Guest"})
sid = Session(user=EMAIL, resume=False, full_name="TEST NOROLE", user_type="System User").sid
frappe.db.commit()
frappe.set_user(tk.TEST_USER)
rs = requests.Session()
rs.cookies.set("sid", sid, domain="127.0.0.1")
run.section("0. SESSION")
run.check("no-role TEST user is logged in", EMAIL, rs.get(f"{BASE}/api/method/frappe.auth.get_logged_user", timeout=20).json().get("message"))


def refused(status, body):
	exc = (body.get("exc_type") or "") + str(body.get("exception") or "")
	sm = str(body.get("_server_messages") or "")
	return status in (401, 403) or "PermissionError" in exc or "not permitted" in (exc + sm).lower() or \
		"does not have doctype access" in sm or "Insufficient Permission" in sm or "No permission" in sm


writers_open, readers_open, skipped = [], [], []
for path, fn in fns:
	name = fn.__name__
	if path in guest or NEVER.search(name):
		skipped.append(name)
		continue
	try:
		r = rs.post(f"{BASE}/api/method/{path}", data={}, timeout=60)
		body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
	except Exception as e:  # noqa: BLE001
		body, r = {"exception": str(e)}, SimpleNamespace(status_code=0)
	if refused(r.status_code, body):
		continue
	why = f"HTTP {r.status_code} {(body.get('exc_type') or '')} {str(body.get('_server_messages') or body.get('exception') or '')[:90]}"
	(readers_open if READ.match(name) else writers_open).append((name, why))

run.section("A. WRITERS (must refuse a user with no roles)")
run.check("every writing API refuses a user with no roles", [], [w[0] for w in writers_open], ok=not writers_open,
          evidence=f"{len(fns) - len(skipped)} called, {len(skipped)} skipped (bridge / guest)")
for n, why in writers_open:
	run.check(f"open writer: {n}", "REFUSED", why, ok=False)
run.section("B. READERS (shop data readable with no role -- for review)")
run.check("readers that answer a user with no roles (listed for Ankit)", True, True, evidence=[r[0] for r in readers_open])

frappe.set_user("Administrator")
frappe.db.rollback()
for dt in ("Version", "Comment", "Access Log", "Error Log", "Santu Bug Report", "Deleted Document", "File", "Notification Settings", "DocShare"):
	if frappe.db.table_exists(dt):
		frappe.db.commit()
		frappe.db.sql(f"delete from `tab{dt}` where owner=%s", EMAIL)
for c in frappe.get_all("Contact", {"email_id": EMAIL}, pluck="name"):
	frappe.delete_doc("Contact", c, force=1, ignore_permissions=True)
frappe.db.sql("delete from tabSessions where user=%s", EMAIL)
frappe.delete_doc("User", EMAIL, force=1, ignore_permissions=True)
frappe.db.commit()
frappe.set_user(tk.TEST_USER)
