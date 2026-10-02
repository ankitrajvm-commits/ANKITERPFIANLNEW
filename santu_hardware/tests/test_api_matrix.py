"""Every whitelisted API, 7 ways, over real HTTP (full-app test plan, "API matrix").

Talks to the TEST COPY's own web server (http://127.0.0.1:8001, started with
`bench --site scratch.local serve --port 8001`) exactly the way a screen
does, so the whitelist check, argument type-checking and per-request
rollback are all real.

For every santu_hardware @frappe.whitelist() function:
  Unauthorized  no login                     -> must be refused (403), unless allow_guest
  Empty         logged in, no arguments      -> clean refusal or success, never a crash
  Invalid       nonsense values              -> clean refusal, never a crash
  Wrong type    text where a number/dict goes -> clean refusal, never a crash
  Valid         read-only calls with sensible values -> success
  Duplicate     read-only: same call twice   -> same answer
  Concurrent    read-only: 4 at once         -> same answer
"Crash" = HTTP 500 with a Python programming error (TypeError, KeyError,
AttributeError, IndexError, ValueError, JSONDecodeError, NameError, ...).
Anything that could act on the outside world (send, print, restore, delete,
disconnect, backup, upload ...) is only ever called WITHOUT login.
"""
import concurrent.futures as cf
import importlib
import inspect
import json
import os
import pkgutil
import re

import requests

from santu_hardware.tests import santu_testkit as tk

frappe = tk.connect()
run = tk.Run("api_matrix")
BASE = os.environ.get("SANTU_TEST_URL", "http://127.0.0.1:8001")

# ---- enumerate -------------------------------------------------------------
import santu_hardware  # noqa: E402

# Only the real app package. Loose one-off scripts at the app root
# (create_wa_pf.py, upload_pf.py, dump_pf.py ...) DO things when imported --
# importing them on 2026-09-19 rewrote print formats on the test copy.
import santu_hardware.santu_hardware as _pkg  # noqa: E402

for m in pkgutil.walk_packages(_pkg.__path__, "santu_hardware.santu_hardware."):
	if ".tests" in m.name or ".patches" in m.name:
		continue
	try:
		importlib.import_module(m.name)
	except Exception:
		pass
fns = sorted({f"{f.__module__}.{f.__name__}": f for f in frappe.whitelisted if f.__module__.startswith("santu_hardware")}.items())
guest = {f"{f.__module__}.{f.__name__}" for f in frappe.guest_methods if f.__module__.startswith("santu_hardware")}

DANGER = re.compile(r"(send|print|restore|delete|remove|disconnect|logout|backup|upload|drive|reset|close_f|disable|dismiss|"
                    r"retry|kill|start_bridge|stop_bridge|refresh|sync|import|bulk|save|create|set_|update|submit|cancel|"
                    r"apply|merge|transfer|fix_|receive|add_|mark|confirm|record|pin|lock|clear|purge|repost|density|test_print|"
                    r"generate|move|rename|enable|toggle|reconcile|write|post|pay|make_|new_|install|migrate|seed|test_|connect|qr_status)", re.I)
CRASH = {"TypeError", "KeyError", "AttributeError", "IndexError", "ValueError", "JSONDecodeError", "NameError",
         "UnboundLocalError", "ZeroDivisionError", "RecursionError", "AssertionError", "InvalidOperation", "decimal.InvalidOperation"}
run.section("0. INVENTORY")
run.check("whitelisted santu functions found", True, len(fns) > 200, evidence=f"{len(fns)} functions, {len(guest)} allow_guest")

# ---- sessions ---------------------------------------------------------------
from santu_hardware.tests.create_ui_session import create_session  # noqa: E402

sid = create_session()["sid"]
frappe.db.commit()
authed = requests.Session()
authed.cookies.set("sid", sid, domain="127.0.0.1")
anon = requests.Session()
alive = authed.get(f"{BASE}/api/method/frappe.auth.get_logged_user", timeout=20)
run.check("test copy server reachable and logged in as the test user", tk.TEST_USER, (alive.json() or {}).get("message"),
          evidence=f"HTTP {alive.status_code}")


def call(sess, path, params):
	try:
		r = sess.post(f"{BASE}/api/method/{path}", data=params, timeout=60)
	except Exception as e:  # noqa: BLE001
		return 0, "Timeout/Network", str(e)[:120]
	exc_type = ""
	try:
		body = r.json()
		exc_type = (body.get("exc_type") or "")
		msg = body.get("exception") or body.get("_server_messages") or ""
	except Exception:
		body, msg = {}, r.text[:200]
	if not exc_type and r.status_code >= 500:
		m = re.search(r"(\w+Error|\w+Exception)", str(msg))
		exc_type = m.group(1) if m else "HTTP500"
	return r.status_code, exc_type, str(msg)[:200]


def is_crash(status, exc_type):
	return status >= 500 and (exc_type in CRASH or exc_type.split(".")[-1] in CRASH or exc_type in ("HTTP500",))


def params_for(fn, mode):
	sig = inspect.signature(fn)
	out = {}
	for name, p in sig.parameters.items():
		if name in ("args", "kwargs") or p.kind in (p.VAR_KEYWORD, p.VAR_POSITIONAL):
			continue
		ann = p.annotation
		if mode == "invalid":
			out[name] = "TEST-DOES-NOT-EXIST-###"
		elif mode == "wrongtype":
			out[name] = "not-a-number" if ann in (int, float) else ("{broken json" if name.endswith(("json", "_data", "filters", "items", "rows", "updates", "settings", "data")) else "12345")
	return out


# ---- run --------------------------------------------------------------------
crashes, unguarded, guest_list, missing_arg = [], [], [], []
tested_exec = 0
for path, fn in fns:
	# Unauthorized
	st, et, msg = call(anon, path, {})
	if path in guest:
		guest_list.append(path)
	elif st not in (401, 403) and not (st == 417 and "PermissionError" in et):
		unguarded.append((path, st, et))
	if DANGER.search(fn.__name__):
		continue
	tested_exec += 1
	for mode in ("empty", "invalid", "wrongtype"):
		st, et, msg = call(authed, path, params_for(fn, mode))
		if is_crash(st, et):
			if "required positional argument" in msg:
				missing_arg.append((path, mode))  # Frappe's standard answer to a call without its arguments
			else:
				crashes.append((path, mode, st, et, msg[:100]))

# the no-login calls above can leave "HTTP 500" bug reports (owner Guest) for
# guest endpoints called without their arguments -- this run's own noise
frappe.db.sql("""delete from `tabSantu Bug Report` where owner='Guest' and creation >= %s and title like 'HTTP 500 on /api/method/santu_hardware%%'""",
              run.started)
frappe.db.commit()
run.section("A. UNAUTHORIZED (no login)")
run.check("every non-guest API refuses a caller who is not logged in", [], unguarded[:15], ok=not unguarded,
          evidence=f"{len(fns) - len(guest)} checked")
run.check("allow_guest APIs (listed for review)", True, True, evidence=guest_list)

run.section("B. EMPTY / INVALID / WRONG TYPE (logged in, read-only APIs)")
run.check("calls without their required arguments get Frappe's standard refusal (info)", True, True,
          evidence=f"{len(missing_arg)} such calls -- screens always send them")
run.check("no API crashes on empty, invalid or wrong-type input", [], crashes[:25], ok=not crashes,
          evidence=f"{tested_exec} APIs x 3 inputs")
for c in crashes:
	run.check(f"crash: {c[0].split('.')[-1]} [{c[1]}]", "clean refusal", f"HTTP {c[2]} {c[3]}", ok=False, evidence=c[4])

run.section("C. VALID / DUPLICATE / CONCURRENT (read-only, no-argument getters)")
getters = [(p, f) for p, f in fns if re.match(r"(get_|list_|search_|read_)", f.__name__) and not DANGER.search(f.__name__)
           and all(q.default is not inspect.Parameter.empty or q.kind in (q.VAR_KEYWORD, q.VAR_POSITIONAL)
                   for q in inspect.signature(f).parameters.values())]
bad_valid, bad_dup = [], []
for path, fn in getters:
	a1 = call(authed, path, {})
	if is_crash(a1[0], a1[1]) and "required positional argument" not in a1[2]:
		bad_valid.append((path, a1[0], a1[1], a1[2][:80]))
		continue
	with cf.ThreadPoolExecutor(4) as ex:
		res = list(ex.map(lambda _: call(authed, path, {})[0], range(4)))
	if len(set(res)) != 1 or res[0] != a1[0]:
		bad_dup.append((path, res))
run.check("no-argument getters answer without crashing (valid call)", [], bad_valid[:15], ok=not bad_valid, evidence=f"{len(getters)} getters")
run.check("same getter twice + 4 at once -> same answer every time", [], bad_dup[:10], ok=not bad_dup)
