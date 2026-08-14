"""Scheduled tasks for Santu Hardware."""

import frappe
from frappe.utils import get_datetime, now_datetime


def run_auto_backup_check():
	"""Hourly check — run auto backup if due."""
	settings = frappe.get_single("Santu Backup Settings")
	if not frappe.utils.cint(settings.auto_backup_enabled):
		return

	next_run = settings.next_backup_on
	if not next_run:
		from santu_hardware.santu_hardware.backup_service import compute_next_backup_time

		settings.next_backup_on = compute_next_backup_time(settings)
		settings.save(ignore_permissions=True)
		return

	if get_datetime(now_datetime()) < get_datetime(next_run):
		return

	if settings.backup_frequency == "Weekly":
		if settings.last_backup_on:
			from frappe.utils import add_days

			if get_datetime(now_datetime()) < add_days(get_datetime(settings.last_backup_on), 7):
				return

	try:
		from santu_hardware.santu_hardware.backup_service import create_site_backup

		create_site_backup(
			backup_type="Automatic",
			include_files=frappe.utils.cint(settings.include_files),
		)
	except Exception:
		frappe.log_error(title="Auto backup failed", message=frappe.get_traceback())
