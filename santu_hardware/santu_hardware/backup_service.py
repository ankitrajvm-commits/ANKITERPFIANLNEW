"""Backup and restore service using Frappe's native backup mechanisms."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import frappe
from frappe.utils import cint, get_datetime, get_files_path, get_site_path, now_datetime
from frappe.utils.backups import get_backup_path, new_backup


def _require_system_manager():
	frappe.only_for("System Manager")


def _file_size(path: str | None) -> int:
	if not path or not os.path.isfile(path):
		return 0
	return os.path.getsize(path)


def _total_backup_size(db_path, files_path, private_path, config_path) -> int:
	return sum(_file_size(p) for p in (db_path, files_path, private_path, config_path))


def _validate_backup_path(path: str) -> str:
	"""Ensure path is inside site backups directory."""
	if not path:
		frappe.throw("Invalid backup path")
	abs_path = os.path.abspath(path)
	allowed_roots = [
		os.path.abspath(get_backup_path()),
		os.path.abspath(get_site_path("private", "backups")),
	]
	if not any(abs_path.startswith(root) for root in allowed_roots):
		frappe.throw("Backup file path is not allowed")
	if not os.path.isfile(abs_path):
		frappe.throw("Backup file not found")
	return abs_path


def create_site_backup(backup_type: str = "Manual", include_files: bool = True, location: str = "Local Server"):
	"""Create a real Frappe site backup and log it."""
	_require_system_manager()

	log = frappe.get_doc(
		{
			"doctype": "Santu Backup Log",
			"backup_type": backup_type,
			"location": location,
			"status": "In Progress",
			"created_by_user": frappe.session.user,
		}
	)
	log.insert(ignore_permissions=True)
	frappe.db.commit()

	try:
		odb = new_backup(force=True, ignore_files=not include_files)
		db_path = odb.backup_path_db
		files_path = odb.backup_path_files if include_files else None
		private_path = odb.backup_path_private_files if include_files else None
		config_path = odb.backup_path_conf

		total_size = _total_backup_size(db_path, files_path, private_path, config_path)
		log.db_set(
			{
				"status": "Success",
				"database_file": db_path,
				"files_path": files_path,
				"private_files_path": private_path,
				"config_path": config_path,
				"file_size": total_size,
			}
		)

		settings = frappe.get_single("Santu Backup Settings")
		settings.last_backup_on = now_datetime()
		settings.last_backup_status = "Success"
		settings.next_backup_on = compute_next_backup_time(settings)
		settings.save(ignore_permissions=True)

		_cleanup_old_backups(cint(settings.retention_count) or 10)
		frappe.db.commit()

		return log.name
	except Exception as e:
		log.db_set({"status": "Failed", "error_message": str(e)[:500]})
		settings = frappe.get_single("Santu Backup Settings")
		settings.last_backup_status = "Failed"
		settings.save(ignore_permissions=True)
		frappe.db.commit()
		frappe.log_error(title="Santu Backup Failed", message=frappe.get_traceback())
		raise


def compute_next_backup_time(settings=None):
	settings = settings or frappe.get_single("Santu Backup Settings")
	if not settings.auto_backup_enabled:
		return None

	now = get_datetime(now_datetime())
	backup_time = settings.backup_time or "02:00:00"
	try:
		hour, minute, second = [int(x) for x in str(backup_time).split(":")]
	except (ValueError, AttributeError):
		hour, minute, second = 2, 0, 0

	candidate = now.replace(hour=hour, minute=minute, second=second, microsecond=0)
	if candidate <= now:
		if settings.backup_frequency == "Weekly":
			candidate += timedelta(days=7)
		else:
			candidate += timedelta(days=1)
	return candidate


def _cleanup_old_backups(retention: int):
	logs = frappe.get_all(
		"Santu Backup Log",
		filters={"status": "Success", "location": "Local Server"},
		fields=["name", "database_file", "files_path", "private_files_path", "config_path"],
		order_by="creation desc",
	)
	for entry in logs[retention:]:
		for path in (entry.database_file, entry.files_path, entry.private_files_path, entry.config_path):
			try:
				if path and os.path.isfile(path):
					os.remove(path)
			except OSError:
				pass
		frappe.delete_doc("Santu Backup Log", entry.name, ignore_permissions=True)


def get_backup_history(limit: int = 50):
	rows = frappe.get_all(
		"Santu Backup Log",
		fields=[
			"name",
			"creation",
			"backup_type",
			"location",
			"status",
			"file_size",
			"created_by_user",
			"error_message",
		],
		order_by="creation desc",
		limit_page_length=limit,
	)
	for r in rows:
		r["size_label"] = _format_size(r.get("file_size") or 0)
		r["date_label"] = frappe.format_value(r.creation, {"fieldtype": "Datetime"})
	return rows


def _format_size(num_bytes: int) -> str:
	if num_bytes >= 1024 * 1024:
		return f"{num_bytes / (1024 * 1024):.1f} MB"
	if num_bytes >= 1024:
		return f"{num_bytes / 1024:.1f} KB"
	return f"{num_bytes} B"


def download_backup_file(backup_log_name: str, file_type: str = "database"):
	_require_system_manager()
	log = frappe.get_doc("Santu Backup Log", backup_log_name)
	path_map = {
		"database": log.database_file,
		"files": log.files_path,
		"private": log.private_files_path,
		"config": log.config_path,
	}
	path = _validate_backup_path(path_map.get(file_type) or log.database_file)
	frappe.local.response.filename = os.path.basename(path)
	frappe.local.response.filecontent = open(path, "rb").read()
	frappe.local.response.type = "download"


def delete_backup(backup_log_name: str):
	_require_system_manager()
	log = frappe.get_doc("Santu Backup Log", backup_log_name)
	for path in (log.database_file, log.files_path, log.private_files_path, log.config_path):
		try:
			if path and os.path.isfile(path):
				os.remove(path)
		except OSError:
			pass
	frappe.delete_doc("Santu Backup Log", backup_log_name, ignore_permissions=True)
	return {"ok": True}


def restore_backup(backup_log_name: str, confirm_text: str):
	"""Restore with safety backup. Admin only. Runs via bench in background."""
	_require_system_manager()
	if confirm_text != "RESTORE":
		frappe.throw("Type RESTORE to confirm database restoration")

	log = frappe.get_doc("Santu Backup Log", backup_log_name)
	db_path = _validate_backup_path(log.database_file)

	# Safety backup first
	safety_name = create_site_backup(backup_type="Manual", include_files=True)
	frappe.enqueue(
		"santu_hardware.santu_hardware.backup_service._execute_restore",
		queue="long",
		timeout=3600,
		db_path=db_path,
		files_path=log.files_path,
		private_path=log.private_files_path,
		backup_log_name=backup_log_name,
		safety_backup=safety_name,
	)
	return {"queued": True, "safety_backup": safety_name}


def _execute_restore(db_path, files_path, private_path, backup_log_name, safety_backup):
	import subprocess

	bench_path = frappe.utils.get_bench_path()
	site = frappe.local.site
	cmd = ["bench", "--site", site, "restore", db_path]
	if files_path and os.path.isfile(files_path):
		cmd.extend(["--with-public-files", files_path])
	if private_path and os.path.isfile(private_path):
		cmd.extend(["--with-private-files", private_path])

	proc = subprocess.run(cmd, cwd=bench_path, capture_output=True, text=True)
	if proc.returncode != 0:
		frappe.log_error(
			title=f"Restore failed for {backup_log_name}",
			message=proc.stdout + "\n" + proc.stderr,
		)
		raise frappe.ValidationError(f"Restore failed. Safety backup: {safety_backup}")


def get_google_drive_status():
	gd = frappe.get_single("Google Drive")
	connected = bool(gd.get_password("refresh_token", raise_exception=False)) if gd else False
	return {
		"available": bool(frappe.db.exists("DocType", "Google Drive")),
		"connected": connected and cint(gd.enable),
		"refresh_token_set": connected,
		"enabled": cint(gd.enable) if gd else 0,
		"frequency": gd.frequency or "",
		"email": gd.email or "",
		"last_backup_on": gd.last_backup_on,
		"backup_folder_name": gd.backup_folder_name or "Frappe Backups",
		"file_backup": cint(gd.file_backup) if gd else 0,
	}


def trigger_google_drive_backup():
	_require_system_manager()
	gd = frappe.get_single("Google Drive")
	if not gd.get_password("refresh_token", raise_exception=False):
		frappe.throw("Google Drive is not connected. Configure OAuth in Integrations first.")
	from frappe.integrations.doctype.google_drive.google_drive import take_backup

	take_backup()
	return {"queued": True}


def get_staff_users():
	_require_system_manager()
	users = frappe.get_all(
		"User",
		filters={"name": ["not in", ["Guest", "Administrator"]], "enabled": 1},
		fields=["name", "full_name", "email", "last_active", "user_type"],
		order_by="full_name asc",
	)
	for u in users:
		roles = frappe.get_roles(u.name)
		u["roles"] = ", ".join(roles)
		u["status"] = "Active" if u.get("enabled", 1) else "Disabled"
		u["last_login"] = frappe.format_value(u.last_active, {"fieldtype": "Datetime"}) if u.last_active else "—"
	return users


ROLE_GROUPS = {
	"Sales": ["Sales User", "Sales Manager"],
	"Purchase": ["Purchase User", "Purchase Manager"],
	"Inventory": ["Stock User", "Stock Manager", "Item Manager"],
	"Accounting": ["Accounts User", "Accounts Manager"],
	"Reports": ["Analytics", "Report Manager"],
}


def get_role_groups():
	_require_system_manager()
	out = []
	for group, roles in ROLE_GROUPS.items():
		out.append({"group": group, "roles": roles, "existing": [r for r in roles if frappe.db.exists("Role", r)]})
	return out


def update_user_roles(user: str, roles: list):
	_require_system_manager()
	user_doc = frappe.get_doc("User", user)
	user_doc.roles = []
	for role in roles:
		if frappe.db.exists("Role", role):
			user_doc.append("roles", {"role": role})
	user_doc.save(ignore_permissions=True)
	return {"ok": True}


def get_sync_dashboard():
	sync = frappe.get_single("Santu Sync Settings")
	backup = frappe.get_single("Santu Backup Settings")
	gdrive = get_google_drive_status()

	cloud_configured = bool((sync.cloud_sync_url or "").strip())
	sync_status = "Disabled"
	if sync.sync_enabled:
		sync_status = sync.last_sync_status or ("Not Configured" if not cloud_configured else "Synced")

	return {
		"sync": {
			"enabled": cint(sync.sync_enabled),
			"staff_sharing_enabled": cint(sync.staff_sharing_enabled),
			"cloud_configured": cloud_configured,
			"cloud_sync_url": sync.cloud_sync_url or "",
			"last_sync_on": sync.last_sync_on,
			"next_sync_on": sync.next_sync_on,
			"status": sync_status,
			"pending_changes": cint(sync.pending_changes),
			"last_error": sync.last_sync_error or "",
		},
		"backup": {
			"auto_enabled": cint(backup.auto_backup_enabled),
			"last_backup_on": backup.last_backup_on,
			"next_backup_on": backup.next_backup_on,
			"last_status": backup.last_backup_status or "Never",
			"frequency": backup.backup_frequency,
			"retention": backup.retention_count,
		},
		"google_drive": gdrive,
		"current_user": frappe.session.user,
	}
