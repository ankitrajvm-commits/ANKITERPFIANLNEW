__version__ = "0.0.1"


def _patch_loyalty_program_query():
	"""Work around a pre-existing ERPNext core bug, not a Frappe/core file edit.

	erpnext.selling.doctype.customer.customer.get_loyalty_programs() builds a
	filter using a raw SQL expression as a dict key
	(``{"ifnull(to_date, ...)": [...]}``) that produces malformed SQL on this
	MariaDB version, breaking *every* Customer save that doesn't already have
	a loyalty_program set.

	2026-07-30: this shop now has a real Loyalty Program (reward points on
	the printed bill, direct request), so the earlier fix — short-circuit to
	"no programs found", logged in IMPROVEMENT_LOG.md 2026-07-31 as needing
	an upgrade once loyalty was actually wanted — would silently block
	auto-opt-in from ever working. Replaced with the fix IMPROVEMENT_LOG.md
	itself recommended: the same filtering logic, reimplemented in plain
	Python instead of the raw-SQL-as-dict-key pattern that broke in the
	first place. Avoids the bug class entirely rather than re-triggering it.
	Wrapped defensively so a future ERPNext version renaming/removing this
	function doesn't break app startup, just silently skips the patch.
	"""
	try:
		import erpnext.selling.doctype.customer.customer as customer_module

		customer_module.get_loyalty_programs = _get_loyalty_programs_safe
	except (ImportError, AttributeError):
		pass


def _get_loyalty_programs_safe(doc):
	"""Same result as core's `get_loyalty_programs()`, without the raw-SQL
	dict-key filter that produces malformed SQL on this MariaDB version —
	the expiry-date check is done in Python instead."""
	import frappe
	from frappe.utils import getdate, today

	loyalty_programs = frappe.get_all(
		"Loyalty Program",
		fields=["name", "customer_group", "customer_territory", "to_date"],
		filters={"auto_opt_in": 1, "from_date": ["<=", today()]},
	)

	today_date = getdate()
	lp_details = []
	for lp in loyalty_programs:
		if lp.to_date and getdate(lp.to_date) < today_date:
			continue

		from erpnext.selling.doctype.customer.customer import get_nested_links

		if (
			not lp.customer_group
			or doc.customer_group
			in get_nested_links("Customer Group", lp.customer_group, doc.flags.ignore_permissions)
		) and (
			not lp.customer_territory
			or doc.territory
			in get_nested_links("Territory", lp.customer_territory, doc.flags.ignore_permissions)
		):
			lp_details.append(lp.name)

	return lp_details


_patch_loyalty_program_query()
