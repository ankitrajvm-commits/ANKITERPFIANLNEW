"""Permission matrix: who can do what (full-app test plan, part N).

TEST COPY only. Five TEST users with the shop's role groups
(backup_service.ROLE_GROUPS) each try every sensitive action over real HTTP
against the test copy's server (127.0.0.1:8001). The result is a matrix of
ALLOWED / REFUSED per role x action, compared with a proposed policy.
Whatever the policy is, one thing is not negotiable and FAILS the run: a
user with no roles, or a read-only user, being able to change anything.
Other deviations are FINDINGs for Ankit to decide.
"""
import json
import os

import requests

from santu_hardware.tests import santu_testkit as tk

frappe = tk.connect()
from frappe.sessions import Session  # noqa: E402

run = tk.Run("permissions")
BASE = os.environ.get("SANTU_TEST_URL", "http://127.0.0.1:8001")
A = "santu_hardware.santu_hardware.api."
UA = "santu_hardware.santu_hardware.utilities_api."
SB = "santu_hardware.santu_hardware.sync_backup_api."

USERS = {
	"admin":      ("test.perm.admin@santuhardware.local", ["System Manager", "Sales Manager", "Sales User", "Accounts Manager",
	                                                        "Accounts User", "Stock Manager", "Stock User", "Item Manager", "Purchase Manager", "Purchase User"]),
	"accountant": ("test.perm.accountant@santuhardware.local", ["Accounts User", "Accounts Manager", "Sales User", "Report Manager", "Analytics"]),
	"salesman":   ("test.perm.salesman@santuhardware.local", ["Sales User", "Stock User"]),
	"restricted": ("test.perm.restricted@santuhardware.local", ["Sales User"]),
	"readonly":   ("test.perm.readonly@santuhardware.local", []),
}
# proposed policy (Y = should be allowed) -- Ankit decides; deviations are FINDINGs
POLICY = {
	#                 admin acct  sales restr  ro
	"view_bills":     "Y     Y     Y     Y     Y",
	"create_bill":    "Y     Y     Y     Y     N",
	"submit_bill":    "Y     Y     Y     Y     N",
	"take_payment":   "Y     Y     Y     N     N",
	"edit_bill":      "Y     Y     N     N     N",
	"cancel_bill":    "Y     Y     N     N     N",
	"delete_bill":    "Y     N     N     N     N",
	"fix_stock":      "Y     N     N     N     N",
	"new_item":       "Y     N     Y     N     N",
	"export_items":   "Y     Y     N     N     N",
	"shop_settings":  "Y     N     N     N     N",
	"loyalty_settings": "Y   N     N     N     N",
	"backup":         "Y     N     N     N     N",
	"restore_backup": "Y     N     N     N     N",
}
ROLES = list(USERS)
WRITE_ACTIONS = [k for k in POLICY if k != "view_bills"]

# ---- setup -------------------------------------------------------------------
run.section("0. SETUP (TEST users, TEST item, TEST bills)")
for key, (email, roles) in USERS.items():
	if not frappe.db.exists("User", email):
		u = frappe.new_doc("User")
		u.email, u.first_name, u.user_type, u.send_welcome_email = email, f"TEST PERM {key}", "System User", 0
		u.flags.no_welcome_mail = True
		u.insert(ignore_permissions=True)
	u = frappe.get_doc("User", email)
	u.roles = []
	for r in roles:
		if frappe.db.exists("Role", r):
			u.append("roles", {"role": r})
	u.user_type = "System User"
	u.save(ignore_permissions=True)
frappe.db.commit()
ITEM = "TEST-PERM-ITEM"
if not frappe.db.exists("Item", ITEM):
	frappe.get_doc({"doctype": "Item", "item_code": ITEM, "item_name": "TEST PERM ITEM", "item_group": "Products", "stock_uom": "Nos",
	                "is_stock_item": 1, "gst_hsn_code": frappe.db.get_value("Item", {"gst_hsn_code": ["is", "set"], "name": ["not like", "TEST%"]}, "gst_hsn_code")
	                }).insert(ignore_permissions=True)
	frappe.get_doc({"doctype": "Item Price", "item_code": ITEM, "price_list": "Standard Selling", "price_list_rate": 10, "selling": 1}).insert(ignore_permissions=True)
if not frappe.db.exists("Customer", "TEST PERM GRAHAK"):
	frappe.get_doc({"doctype": "Customer", "customer_name": "TEST PERM GRAHAK", "customer_group": "Individual", "territory": "India",
	                "mobile_no": "9000000031"}).insert(ignore_permissions=True)
frappe.db.commit()
import santu_hardware.santu_hardware.api as a  # noqa: E402

BILL = {"customer": "SALES", "payment_mode": "cash", "paid_amount": 10, "payments": [{"mode_of_payment": "Cash", "amount": 10}],
        "items": [{"item_code": ITEM, "qty": 1, "rate": 10, "uom": "Nos"}]}


def victim_bill():
	"""a submitted TEST bill made by the (test) owner, for cancel/edit/delete attempts"""
	r = a.save_sale_invoice(json.dumps(BILL), submit=1)
	frappe.db.commit()
	return r["name"]


sessions = {}
for key, (email, _) in USERS.items():
	from types import SimpleNamespace

	frappe.local.request_ip = "127.0.0.1"
	frappe.local.form_dict = frappe._dict()
	frappe.local.request = SimpleNamespace(cookies={"sid": "Guest"})
	s = Session(user=email, resume=False, full_name=f"TEST PERM {key}", user_type="System User")
	frappe.db.commit()
	rs = requests.Session()
	rs.cookies.set("sid", s.sid, domain="127.0.0.1")
	who = rs.get(f"{BASE}/api/method/frappe.auth.get_logged_user", timeout=20).json().get("message")
	run.check(f"session for {key}", email, who)
	sessions[key] = rs
frappe.set_user(tk.TEST_USER)


def http(rs, method, data):
	r = rs.post(f"{BASE}/api/method/{method}", data={k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in data.items()}, timeout=120)
	try:
		body = r.json()
	except Exception:
		body = {}
	return r.status_code, body


def allowed(status, body):
	"""True = the action went through; False = refused (permission)."""
	if status == 200:
		return True
	exc = (body.get("exc_type") or "") + str(body.get("exception") or "")
	sm = str(body.get("_server_messages") or "")
	if (status in (401, 403) or "PermissionError" in exc or "not permitted" in exc.lower() or "Not permitted" in sm
	        or "does not have doctype access" in sm or "Insufficient Permission" in sm):
		return False
	return None  # some other error: neither proven allowed nor refused


# ---- actions ------------------------------------------------------------------
def act(action, rs):
	if action == "view_bills":
		return http(rs, "frappe.client.get_list", {"doctype": "Sales Invoice", "limit_page_length": 1})
	if action == "create_bill":
		return http(rs, A + "save_sale_invoice", {"invoice_json": BILL, "submit": 0})
	if action == "submit_bill":
		return http(rs, A + "save_sale_invoice", {"invoice_json": BILL, "submit": 1})
	if action == "take_payment":
		return http(rs, A + "create_payment_entry", {"party_type": "Customer", "party": "TEST PERM GRAHAK", "amount": 1, "mode_of_payment": "Cash"})
	if action == "edit_bill":
		v = victim_bill()
		return http(rs, A + "edit_submitted_sale_invoice", {"invoice_name": v, "invoice_json": dict(BILL, items=[dict(BILL["items"][0], qty=2)], paid_amount=20,
		                                                                                               payments=[{"mode_of_payment": "Cash", "amount": 20}])})
	if action == "cancel_bill":
		v = victim_bill()
		return http(rs, "frappe.client.cancel", {"doctype": "Sales Invoice", "name": v})
	if action == "delete_bill":
		v = victim_bill()
		st, body = http(rs, A + "delete_sale_invoice", {"doctype": "Sales Invoice", "name": v})
		frappe.db.commit()
		after = frappe.db.get_value("Sales Invoice", v, "docstatus")
		body["_bill_after"] = after  # None = deleted, 2 = cancelled, 1 = untouched
		if st != 200 and after != 1:
			body["exc_type"] = "HALF-DONE: refused but the bill was changed (docstatus %s)" % after
		return st, body
	if action == "fix_stock":
		return http(rs, A + "fix_stock", {"item_code": ITEM, "new_qty": 7, "reason": "TEST perm"})
	if action == "new_item":
		return http(rs, A + "quick_create_item", {"item_name": f"TEST PERM NEW {frappe.generate_hash(length=5)}", "selling_price": 5,
		                                          "item_group": "Products", "uom": "Nos", "opening_qty": 1, "cost_price": 3, "require_opening_qty": 1})
	if action == "export_items":
		return http(rs, UA + "export_items_file", {})
	if action == "shop_settings":
		cur = frappe.get_attr(UA + "get_business_setup")()
		return http(rs, UA + "save_business_setup", {"data": cur})
	if action == "loyalty_settings":
		st = frappe.get_attr(A + "get_loyalty_settings")()
		from frappe.utils import cint, flt
		return http(rs, A + "update_loyalty_settings", {"enabled": cint(st.get("enabled")), "spend_per_point": flt(st.get("spend_per_point") or 100),
		                                                 "point_value": flt(st.get("point_value") or 1), "expiry_months": cint(st.get("expiry_months") or 24)})
	if action == "backup":
		return http(rs, SB + "create_manual_backup", {"include_files": 0})
	if action == "restore_backup":
		return http(rs, SB + "restore_site_backup", {"backup_log_name": "TEST-NONE", "confirm_text": "TEST"})


matrix = {}
for action in POLICY:
	run.section(f"ACTION: {action}")
	want = POLICY[action].split()
	for i, key in enumerate(ROLES):
		frappe.set_user(tk.TEST_USER)
		try:
			st, body = act(action, sessions[key])
			res = allowed(st, body)
		except Exception as e:  # noqa: BLE001
			st, body, res = 0, {"exception": str(e)[:120]}, None
		frappe.db.commit()
		matrix.setdefault(action, {})[key] = {True: "ALLOWED", False: "REFUSED", None: f"ERROR {st}"}[res]
		expect = want[i] == "Y"
		ev = ((body.get("exc_type") or "") + " " + str(body.get("_server_messages") or body.get("exception") or "")[:160]
		      + (f" bill_after={body.get('_bill_after')}" if "_bill_after" in body else "")) if res is not True else ""
		must_block = key == "readonly" and action in WRITE_ACTIONS
		if "HALF-DONE" in str(body.get("exc_type")):
			must_block = True  # a refusal that still changed the bill is never acceptable
		if res is None:
			run.check(f"{key}: {action}", "ALLOWED" if expect else "REFUSED", f"ERROR {st}", ok=False, evidence=ev,
			          finding=not must_block)
		else:
			run.check(f"{key}: {action}", "ALLOWED" if expect else "REFUSED", "ALLOWED" if res else "REFUSED",
			          ok=(res == expect), evidence=ev, finding=not must_block)

run.section("MATRIX")
print("  action".ljust(20) + "".join(k.ljust(12) for k in ROLES))
for action, row in matrix.items():
	print("  " + action.ljust(18) + "".join(row[k].ljust(12) for k in ROLES))
run.check("matrix recorded", True, True, evidence=json.dumps(matrix))

# ---- cleanup -------------------------------------------------------------------
run.section("CLEANUP")
frappe.db.rollback()  # fresh read view (stale ones answer deletes with 1020)
frappe.set_user("Administrator")
for key, (email, _) in USERS.items():
	for dt in ("Payment Entry", "Sales Invoice", "Sales Invoice", "Stock Reconciliation", "Stock Entry"):
		for n in frappe.get_all(dt, {"owner": email}, pluck="name", order_by="creation desc"):
			try:
				d = frappe.get_doc(dt, n)
				if d.docstatus == 1:
					d.flags.ignore_permissions = True
					d.cancel()
				frappe.delete_doc(dt, n, force=1, ignore_permissions=True)
				frappe.db.commit()
			except Exception as ex:  # noqa: BLE001
				frappe.db.rollback()
				print("  cleanup:", dt, n, str(ex)[:100])
	for n in frappe.get_all("Item", {"owner": email}, pluck="name"):
		for t in ("Stock Ledger Entry", "Bin", "Item Price"):
			frappe.db.sql(f"delete from `tab{t}` where item_code=%s", n)
		frappe.delete_doc("Item", n, force=1, ignore_permissions=True)
	for dt in ("Santu Backup Log", "Deleted Document", "Version", "Comment", "Access Log", "Error Log", "Santu Bug Report", "File", "GL Entry",
	           "Stock Ledger Entry", "Payment Ledger Entry", "Repost Item Valuation"):
		if frappe.db.table_exists(dt):
			frappe.db.commit()
			frappe.db.sql(f"delete from `tab{dt}` where owner=%s", email)
	frappe.db.sql("delete from tabSessions where user=%s", email)
	for c in frappe.get_all("Contact", {"email_id": email}, pluck="name"):
		frappe.delete_doc("Contact", c, force=1, ignore_permissions=True)
	frappe.delete_doc("User", email, force=1, ignore_permissions=True)
	frappe.db.commit()
frappe.set_user(tk.TEST_USER)
from santu_hardware.tests.cleanup_test_user import main as _cleanup_test_user  # noqa: E402

frappe.db.commit()
_cleanup_test_user()
