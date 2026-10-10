"""One door in front of every santu_hardware API (2026-09-19).

The permission tests found APIs a logged-in user with NO roles could call --
one of them, reset_loyalty_points_before_today, actually ran and reset every
customer's reward points on the test copy. Rather than trusting ~280
functions to each remember their own check, this runs before every request:

  * a user with none of the shop's working roles reaches no santu API at all;
  * shop-wide settings, destructive and admin actions need System Manager.

Everything else stays with ERPNext's own document permissions, which already
decide who may create / submit / cancel a bill. Administrator (the shop's
real login today) passes every door, so nothing changes at the counter.
"""
import frappe

SHOP_ROLES = {
	"System Manager", "Accounts User", "Accounts Manager", "Sales User", "Sales Manager", "Stock User", "Stock Manager",
	"Item Manager", "Purchase User", "Purchase Manager", "Report Manager", "Analytics",
}

# owner-only: shop settings, anything that deletes / resets / rewrites, users, backups
ADMIN_ONLY = {
	"reset_loyalty_points_before_today", "update_loyalty_settings", "fill_missing_item_master_data",
	"create_staff_user", "save_user_roles", "disable_user_access",
	"delete_item", "delete_party", "force_overwrite_item_unit", "rename_item_master",
	"create_payment_mode", "set_payment_mode_enabled", "apply_printer_density", "set_printer_density", "print_density_test",
	"add_uom_conversion", "set_app_lock_pin", "set_privacy_pin", "app_lock_device_forget",
	"set_document_template", "update_shop_profile", "save_business_setup", "save_item_highlight_rules",
	"apply_fix", "fix_everything", "remove_backup", "restore_site_backup", "create_manual_backup",
	"save_backup_settings", "save_sync_settings", "bulk_update_items", "import_items_valid", "import_parties",
	"restore_deleted_document", "delete_voice_rule", "save_voice_rule", "set_item_stock", "fix_stock",
	"save_connect_settings", "update_settings", "save_settings",
}


def gate():
	req = getattr(frappe.local, "request", None)
	path = getattr(req, "path", "") or ""
	if not path.startswith("/api/method/santu_hardware."):
		return
	user = getattr(frappe.session, "user", None)
	if not user or user in ("Guest", "Administrator"):
		return  # Guest: the whitelist itself allows or refuses (allow_guest)
	fn = path.rsplit(".", 1)[-1]
	roles = set(frappe.get_roles(user))
	if fn in ADMIN_ONLY and "System Manager" not in roles:
		frappe.throw(
			"<b>Ye kaam sirf malik (System Manager) kar sakte hain.</b><br><br><b>Kya karein:</b> Ankit se kahein.",
			frappe.PermissionError, title="Ijazat nahi hai")
	if not roles & SHOP_ROLES:
		frappe.throw(
			"<b>Is user ko dukaan ka koi kaam nahi diya gaya hai.</b><br><br><b>Kya karein:</b> Ankit se Utilities → Staff me "
			"is user ko sahi kaam (Sales / Accounting …) dilwaiye.",
			frappe.PermissionError, title="Ijazat nahi hai")
