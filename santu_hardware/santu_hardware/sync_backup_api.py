"""Whitelisted APIs for Sync, Share & Backup module."""

import frappe

from santu_hardware.santu_hardware.backup_service import (
	compute_next_backup_time,
	create_site_backup,
	delete_backup,
	download_backup_file,
	get_backup_history,
	get_google_drive_status,
	get_role_groups,
	get_staff_users,
	get_sync_dashboard,
	restore_backup,
	trigger_google_drive_backup,
	update_user_roles,
)


@frappe.whitelist()
def get_sync_backup_dashboard():
	return get_sync_dashboard()


@frappe.whitelist()
def get_backup_settings():
	frappe.only_for("System Manager")
	s = frappe.get_single("Santu Backup Settings")
	return {
		"auto_backup_enabled": s.auto_backup_enabled,
		"backup_frequency": s.backup_frequency,
		"backup_time": s.backup_time,
		"retention_count": s.retention_count,
		"include_files": s.include_files,
		"last_backup_on": s.last_backup_on,
		"next_backup_on": s.next_backup_on,
		"last_backup_status": s.last_backup_status or "Never",
	}


@frappe.whitelist()
def save_backup_settings(settings=None):
	frappe.only_for("System Manager")
	if isinstance(settings, str):
		settings = frappe.parse_json(settings)
	settings = settings or {}
	s = frappe.get_single("Santu Backup Settings")
	for field in ("auto_backup_enabled", "backup_frequency", "backup_time", "retention_count", "include_files"):
		if field in settings:
			s.set(field, settings[field])
	s.next_backup_on = compute_next_backup_time(s)
	s.save(ignore_permissions=True)
	return get_backup_settings()


@frappe.whitelist()
def list_backup_history():
	frappe.only_for("System Manager")
	return get_backup_history()


@frappe.whitelist()
def create_manual_backup(include_files=None):
	frappe.only_for("System Manager")
	name = create_site_backup(
		backup_type="Manual",
		include_files=frappe.utils.cint(include_files) if include_files is not None else True,
	)
	return {"name": name, "message": "Backup created successfully"}


@frappe.whitelist()
def download_backup(backup_log_name, file_type="database"):
	download_backup_file(backup_log_name, file_type)


@frappe.whitelist()
def remove_backup(backup_log_name):
	frappe.only_for("System Manager")
	return delete_backup(backup_log_name)


@frappe.whitelist()
def restore_site_backup(backup_log_name, confirm_text):
	frappe.only_for("System Manager")
	return restore_backup(backup_log_name, confirm_text)


@frappe.whitelist()
def get_google_drive_info():
	frappe.only_for("System Manager")
	return get_google_drive_status()


@frappe.whitelist()
def upload_backup_to_drive():
	frappe.only_for("System Manager")
	return trigger_google_drive_backup()


@frappe.whitelist()
def get_google_drive_auth_url():
	frappe.only_for("System Manager")
	from frappe.integrations.doctype.google_drive.google_drive import authorize_access

	return authorize_access()


@frappe.whitelist()
def list_staff_users():
	return get_staff_users()


@frappe.whitelist()
def list_role_groups():
	return get_role_groups()


@frappe.whitelist()
def save_user_roles(user, roles):
	if isinstance(roles, str):
		roles = frappe.parse_json(roles)
	return update_user_roles(user, roles)


@frappe.whitelist()
def get_sync_settings():
	frappe.only_for("System Manager")
	s = frappe.get_single("Santu Sync Settings")
	return {
		"sync_enabled": s.sync_enabled,
		"staff_sharing_enabled": s.staff_sharing_enabled,
		"cloud_sync_url": s.cloud_sync_url or "",
		"last_sync_on": s.last_sync_on,
		"next_sync_on": s.next_sync_on,
		"last_sync_status": s.last_sync_status or "Not Configured",
		"last_sync_error": s.last_sync_error or "",
		"pending_changes": s.pending_changes,
	}


@frappe.whitelist()
def save_sync_settings(settings=None):
	frappe.only_for("System Manager")
	if isinstance(settings, str):
		settings = frappe.parse_json(settings)
	settings = settings or {}
	s = frappe.get_single("Santu Sync Settings")
	for field in ("sync_enabled", "staff_sharing_enabled", "cloud_sync_url"):
		if field in settings:
			s.set(field, settings[field])

	if s.sync_enabled and not (s.cloud_sync_url or "").strip():
		s.last_sync_status = "Not Configured"
	elif s.sync_enabled:
		s.last_sync_status = "Synced"
		s.last_sync_on = frappe.utils.now_datetime()
	else:
		s.last_sync_status = "Disabled"

	s.save(ignore_permissions=True)
	return get_sync_settings()


@frappe.whitelist()
def disable_user_access(user):
	frappe.only_for("System Manager")
	frappe.db.set_value("User", user, "enabled", 0)
	return {"ok": True}
