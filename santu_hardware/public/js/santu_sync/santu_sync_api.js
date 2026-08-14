/* global frappe, santu_sync */
frappe.provide("santu_sync");

santu_sync.api = {
	dashboard() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.get_sync_backup_dashboard");
	},
	backupSettings() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.get_backup_settings");
	},
	saveBackupSettings(s) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.save_backup_settings", { settings: s });
	},
	history() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.list_backup_history");
	},
	createBackup(include_files = true) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.create_manual_backup", { include_files });
	},
	deleteBackup(name) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.remove_backup", { backup_log_name: name });
	},
	restoreBackup(name, confirm_text) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.restore_site_backup", {
			backup_log_name: name,
			confirm_text,
		});
	},
	downloadUrl(name, file_type = "database") {
		return `/api/method/santu_hardware.santu_hardware.sync_backup_api.download_backup?backup_log_name=${encodeURIComponent(name)}&file_type=${file_type}`;
	},
	gdrive() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.get_google_drive_info");
	},
	gdriveAuth() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.get_google_drive_auth_url");
	},
	gdriveUpload() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.upload_backup_to_drive");
	},
	staff() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.list_staff_users");
	},
	roles() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.list_role_groups");
	},
	saveRoles(user, roles) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.save_user_roles", { user, roles });
	},
	disableUser(user) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.disable_user_access", { user });
	},
	syncSettings() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.get_sync_settings");
	},
	saveSyncSettings(s) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.save_sync_settings", { settings: s });
	},
};
