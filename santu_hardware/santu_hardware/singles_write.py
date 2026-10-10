"""Safe writes to Single doctypes.

Every Single in the site shares ONE table, `tabSingles`. Two processes
touching any Single at the same moment (the nightly backup, the WhatsApp
status poll, the counter changing a setting) make MariaDB throw 1020
"Record has changed since last read in table 'tabsingles'". That killed
verified backups and the WhatsApp QR poll (BUG-20260911/13, 2026-09-18).

set_single_fields() writes only the fields that really changed, in a fresh
transaction, and retries a few times on 1020 instead of failing.
"""
import time

import frappe


def set_single_fields(doctype: str, values: dict, retries: int = 5) -> bool:
	"""Write only changed fields of a Single; commit; retry on 1020.

	Commits whatever the caller already did first -- callers use this at
	points where their earlier work (a backup log row, etc.) must stay saved.
	"""
	for attempt in range(retries):
		try:
			frappe.db.commit()  # fresh read view: a stale one is what 1020 is about
			current = frappe.db.get_singles_dict(doctype)
			changed = {k: v for k, v in values.items() if str(current.get(k) if current.get(k) is not None else "") != str(v if v is not None else "")}
			if changed:
				frappe.db.set_value(doctype, None, changed, update_modified=False)
			frappe.db.commit()
			return bool(changed)
		except frappe.QueryDeadlockError:
			frappe.db.rollback()
			if attempt == retries - 1:
				raise
			time.sleep(0.3 * (attempt + 1))
	return False
