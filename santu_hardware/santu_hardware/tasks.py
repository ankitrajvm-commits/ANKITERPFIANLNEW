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


# The counter runs roughly 8am–10pm. A snapshot outside those hours would
# only duplicate the nightly full backup.
SNAPSHOT_START_HOUR = 8
SNAPSHOT_END_HOUR = 22


def run_backup_snapshot():
	"""Database-only snapshot every two hours while the shop is open.

	A once-a-night backup means a power cut at 9pm loses a full day of
	bills. The dump is under 2 MB, so taking one every two hours costs
	nothing and caps the worst case at two hours of sales.
	"""
	settings = frappe.get_single("Santu Backup Settings")
	if not frappe.utils.cint(settings.auto_backup_enabled):
		return

	hour = now_datetime().hour
	if hour < SNAPSHOT_START_HOUR or hour > SNAPSHOT_END_HOUR:
		return

	try:
		from santu_hardware.santu_hardware.backup_service import create_site_backup

		create_site_backup(backup_type="Snapshot", include_files=False)
	except Exception:
		frappe.log_error(title="Backup snapshot failed", message=frappe.get_traceback())


# How stale the last full backup has to be before the launchd safety net
# decides the scheduler is not doing its job.
# The normal scheduler is hourly.  launchd checks a little later in every
# hour, so one hour is enough to detect a missed run without creating a
# second copy when the scheduler is healthy.
SAFETY_NET_STALE_HOURS = 1


def run_safety_net_backup():
	"""Full backup taken from launchd when the scheduler has not managed one.

	Called by scripts/santu_backup_safety_net.sh. It is deliberately a
	no-op on a healthy machine — the point is only to cover the case where
	the scheduler has silently stopped, which looks identical to a working
	one from inside the app.
	"""
	from frappe.utils import add_to_date

	settings = frappe.get_single("Santu Backup Settings")
	if not frappe.utils.cint(settings.auto_backup_enabled):
		print("auto backup disabled — nothing to do")
		return

	last = settings.last_backup_on
	if last and get_datetime(last) > get_datetime(
		add_to_date(now_datetime(), hours=-SAFETY_NET_STALE_HOURS)
	):
		print(f"scheduler already backed up at {last} — safety net not needed")
		return

	print(f"last full backup was {last or 'never'} — taking one now")
	from santu_hardware.santu_hardware.backup_service import create_site_backup

	name = create_site_backup(
		backup_type="Automatic",
		include_files=frappe.utils.cint(settings.include_files),
	)
	print(f"safety-net backup created: {name}")
