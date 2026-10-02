"""The one user every automated test and test script runs as -- never
Administrator (2026-09-10 direct request: "jab v test karna to administrator
se mat kr, ek test user bana de... sab, delete and all, taki tu unhe pehchan
kr sake ki kon sa tune banaya hai").

Frappe stamps `owner` and `modified_by` from the session user, and a delete
leaves a Deleted Document whose `owner` is whoever deleted it. Running as
this user means every record a test made, changed or removed carries this
name, so test work can be told apart from the shop's own work at a glance --
the thing that was impossible on 2026-09-08, when test cleanup deleted real
bills and the only clue left was how many seconds each one had lived.

The user has NO password: nobody can log into the screens with it. Scripts
switch to it in-process with frappe.set_user().
"""
import frappe

TEST_USER = "claude.test@santuhardware.local"

# Everything Administrator can do for app work, minus the roles that are
# special, automatic, or turn a user into a portal/website user.
_SKIP_ROLES = {"Administrator", "Guest", "All", "Customer", "Supplier"}


def ensure_test_user() -> str:
	"""Create the test user if missing and keep its roles in step with
	Administrator's (so a new module's role is picked up automatically)."""
	frappe.set_user("Administrator")  # only to create/update the user itself
	want = sorted(r for r in frappe.get_roles("Administrator") if r not in _SKIP_ROLES)
	if not frappe.db.exists("User", TEST_USER):
		u = frappe.new_doc("User")
		u.email = TEST_USER
		u.first_name = "Claude"
		u.last_name = "Test"
		u.user_type = "System User"
		u.enabled = 1
		u.send_welcome_email = 0
		for r in want:
			u.append("roles", {"role": r})
		u.flags.ignore_permissions = True
		u.flags.no_welcome_mail = True
		u.insert(ignore_permissions=True)
	else:
		u = frappe.get_doc("User", TEST_USER)
		have = {r.role for r in u.roles}
		missing = [r for r in want if r not in have]
		if missing or not u.enabled:
			u.enabled = 1
			for r in missing:
				u.append("roles", {"role": r})
			try:
				u.save(ignore_permissions=True)
			except frappe.QueryDeadlockError:
				# another test process is updating the same user right now
				frappe.db.rollback()
	frappe.db.commit()
	return TEST_USER


def use_test_user() -> str:
	"""Make the rest of this process act as the test user."""
	user = ensure_test_user()
	frappe.set_user(user)
	return user


# Records the test user leaves behind even after its bills/items are deleted:
# cancelled ledger rows, repost jobs, recycle-bin entries, audit logs. Found
# 2026-09-18: ~6,000 such rows from earlier runs. Only rows that are provably
# harmless to drop (cancelled / delinked / logs) are touched, and only the
# test user's own. The real WhatsApp message a test once sent is kept as the
# true record of what reached the customer.
TEST_PARTY_NAMES = ("TEST GRAHAK", "ZZ TEST GRAHAK", "Test Ramesh Khata", "Ramesh Kumar")
_KEEP_CHAT = ("Santu WhatsApp Chat Message", "SWC-20260910-00934")


def purge_test_residue() -> None:
	# a fresh read view first: at exit the open transaction can be stale and
	# MariaDB answers the deletes with 1020 "Record has changed"
	for _attempt in range(3):
		try:
			frappe.db.rollback()
			_purge_test_residue()
			return
		except frappe.QueryDeadlockError:
			frappe.db.rollback()


def _purge_test_residue() -> None:
	U = TEST_USER
	q = frappe.db.sql
	q("delete from `tabGL Entry` where owner=%s and is_cancelled=1", U)
	q("delete from `tabStock Ledger Entry` where owner=%s and is_cancelled=1", U)
	q("delete from `tabPayment Ledger Entry` where owner=%s and delinked=1", U)
	q("delete from `tabRepost Item Valuation` where owner=%s and status in ('Queued','Skipped','Completed','Failed')", U)
	q("delete from `tabDeleted Document` where owner=%s", U)
	q("delete from `tabVersion` where owner=%s", U)
	q("delete from `tabAccess Log` where owner=%s", U)
	q("delete from `tabComment` where owner=%s and not (reference_doctype=%s and reference_name=%s)", (U, *_KEEP_CHAT))
	# loyalty rows whose bill no longer exists
	for name, dt, inv in q("select name, invoice_type, invoice from `tabLoyalty Point Entry` where owner=%s", U):
		if not (dt and inv and frappe.db.exists(dt, inv)):
			q("delete from `tabLoyalty Point Entry` where name=%s", name)
	# Test parties, once deleted, can still leave cancelled ledger rows and
	# loyalty rows behind (1,822 + 1,822 + 86 found 2026-09-18, from runs
	# before the test user existed). Only if the party itself is gone.
	for party in TEST_PARTY_NAMES:
		if frappe.db.exists("Customer", party) or frappe.db.exists("Supplier", party):
			continue
		q("delete from `tabGL Entry` where party=%s and is_cancelled=1", party)
		q("delete from `tabPayment Ledger Entry` where party=%s and delinked=1", party)
		q("delete from `tabLoyalty Point Entry` where customer=%s", party)
	# logs / exports / UI column tweaks made while testing
	q("delete from `tabError Log` where owner=%s", U)
	q("delete from `tabSantu Bug Report` where owner=%s", U)
	q("delete from `tabProperty Setter` where owner=%s", U)
	for fname in frappe.get_all("File", {"owner": U, "attached_to_name": ["!=", _KEEP_CHAT[1]]}, pluck="name"):
		try:
			frappe.delete_doc("File", fname, force=1, ignore_permissions=True)
		except Exception:
			q("delete from `tabFile` where name=%s", fname)
	if frappe.db.table_exists("Santu Loyalty Pending Point"):
		q("delete from `tabSantu Loyalty Pending Point` where owner=%s", U)
	# deleting files above writes fresh Deleted Document rows -- sweep again
	q("delete from `tabDeleted Document` where owner=%s", U)
	frappe.db.commit()


def use_test_user_with_cleanup() -> str:
	"""use_test_user() + purge_test_residue() when the process exits."""
	import atexit

	atexit.register(purge_test_residue)
	return use_test_user()
