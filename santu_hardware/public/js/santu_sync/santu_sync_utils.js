/* global santu_sync */
frappe.provide("santu_sync");

santu_sync.VIEWS = {
	sync_share: { title: "Sync & Share", label: "Sync & Share" },
	auto_backup: { title: "Auto Backup", label: "Auto Backup" },
	backup_computer: { title: "Backup To Computer", label: "Backup To Computer" },
	backup_drive: { title: "Backup To Drive", label: "Backup To Drive" },
	restore_backup: { title: "Restore Backup", label: "Restore Backup" },
};

santu_sync.utils = {
	get_view() {
		return (frappe.route_options && frappe.route_options.view) || sessionStorage.getItem("santu_sync_view") || "sync_share";
	},
	format_size(bytes) {
		if (!bytes) return "—";
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${bytes} B`;
	},
	format_dt(val) {
		if (!val) return "—";
		return frappe.datetime.str_to_user(val);
	},
};
