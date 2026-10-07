app_name = "santu_hardware"
app_title = "Santu Hardware"
app_publisher = "Ankit Kumar"
app_description = "Hardware store management system built on ERPNext for inventory, billing, POS, GST, purchase, sales, stock management and custom workflows."
app_email = "ankitrajvm@gmail.com"
app_license = "Proprietary"

# Shown in the top-left of every Desk page (frappe.boot.app_logo_url, via
# Navbar Settings -> get_app_logo() in frappe core) and reused as the site
# favicon / website logo below.
app_logo_url = "/assets/santu_hardware/images/logo.svg"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "santu_hardware",
# 		"logo": "/assets/santu_hardware/logo.png",
# 		"title": "Santu Hardware",
# 		"route": "/santu_hardware",
# 		"has_permission": "santu_hardware.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
#
# Cache-busting note: these paths carry a manual ?v= query string because
# Frappe does not auto-hash app_include_css/js the way it hashes bundled JS
# chunks, and the default Cache-Control on /assets is max-age=43200 (12h) —
# without a version bump, browsers keep serving a stale copy after every
# edit during active development.
#
# This used to be a hand-typed integer, and forgetting to bump it was a
# recurring bug: the fix shipped, the browser kept the old file, and the shop
# saw a screen that had already been repaired. It is now derived from the
# app version plus the current git commit, so every commit busts the cache by
# itself and nobody has to remember. `_git_revision()` reads .git directly —
# no subprocess — and falls back to the version alone if anything is off, so
# a missing or odd .git can never stop the app from booting.
def _git_revision() -> str:
	import os

	try:
		app_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
		git_dir = os.path.join(app_root, ".git")
		if not os.path.isdir(git_dir):
			return ""
		with open(os.path.join(git_dir, "HEAD")) as fh:
			head = fh.read().strip()
		if head.startswith("ref:"):
			ref_path = os.path.join(git_dir, head.split(" ", 1)[1].strip())
			if not os.path.isfile(ref_path):
				return ""
			with open(ref_path) as fh:
				head = fh.read().strip()
		return head[:8]
	except Exception:
		return ""


def _assets_stamp() -> str:
	"""Newest change time under public/, so an edit busts the cache too.

	The commit alone is not enough: during a fix the files change before
	anything is committed, and a browser holding the old copy is exactly the
	"I already fixed that" confusion this is meant to end. Walked once per
	process, not per request.
	"""
	import os

	try:
		here = os.path.dirname(os.path.abspath(__file__))
		# Desk page scripts (santu_parties.js, santu_dashboard.js, the billing
		# screen...) live under santu_hardware/page/, NOT public/. Walking only
		# public/ meant editing a page's own JS or CSS left the stamp unchanged,
		# so the browser kept serving the previous copy even after a restart --
		# the edit looked like it had done nothing (2026-08-29 report: "home,
		# printer setting, parties me changes reflect nahi ho rahe").
		roots = [
			os.path.join(here, "public"),
			os.path.join(here, "santu_hardware", "page"),
		]
		newest = 0.0
		for root in roots:
			for dirpath, _dirnames, filenames in os.walk(root):
				for fname in filenames:
					if not fname.endswith((".js", ".css", ".html", ".json", ".svg", ".png")):
						continue
					try:
						newest = max(newest, os.path.getmtime(os.path.join(dirpath, fname)))
					except OSError:
						pass
		return str(int(newest))[-6:]
	except Exception:
		return ""


from santu_hardware import __version__ as santu_app_version  # noqa: E402

SANTU_ASSET_VERSION = "-".join(p for p in (santu_app_version, _git_revision(), _assets_stamp()) if p)


# --- live asset versioning -------------------------------------------------
# The stamp above is computed once, when this module is first imported. That is
# the whole reason an edit to a CSS or page file kept "not showing up": the URL
# the browser was handed carried the same ?v= as before, so it happily reused
# the copy it already had, and only a full server restart could change that.
#
# In developer mode frappe.get_hooks() re-reads this module's hook lists on
# every request, so the lists themselves are free to answer differently each
# time. `_LiveAssets` is a real list (frappe's append_hook requires that) that
# holds the bare paths and stamps them at the moment it is read -- so a save on
# disk becomes a new URL on the very next page load. No restart, no build.
#
# The walk is cached for a second: one page render asks for these hooks many
# times over, and re-walking the tree for each of those would be waste, while a
# second is far shorter than the gap between saving a file and reloading.
_STAMP_TTL = 1.0
_stamp_cache = {"at": 0.0, "value": None}


def _live_version() -> str:
	import time

	now = time.monotonic()
	if _stamp_cache["value"] is None or (now - _stamp_cache["at"]) > _STAMP_TTL:
		try:
			_stamp_cache["value"] = "-".join(
				p for p in (santu_app_version, _git_revision(), _assets_stamp()) if p
			)
		except Exception:
			# Never let versioning break asset delivery -- a stale stamp only
			# costs a manual refresh, a raised error costs the whole page.
			_stamp_cache["value"] = SANTU_ASSET_VERSION
		_stamp_cache["at"] = now
	return _stamp_cache["value"]


class _LiveAssets(list):
	"""Asset URLs whose ?v= is recomputed each time the list is read."""

	def __init__(self, paths):
		self._paths = [str(x).split("?", 1)[0] for x in paths]
		super().__init__(self._paths)

	def _stamped(self):
		v = _live_version()
		return [f"{path}?v={v}" for path in self._paths]

	def __iter__(self):
		return iter(self._stamped())

	def __getitem__(self, index):
		return self._stamped()[index]

	def __repr__(self):
		return repr(self._stamped())


app_include_css = _LiveAssets([
	# First: the app-login PIN overlay must be styled before it can be
	# shown, and it can be shown before anything else on the page.
	f"/assets/santu_hardware/css/santu_app_lock.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_tooltips.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/design_system.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/vyapar_theme.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/desk_theme.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/workspace_typography.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/dashboard_home.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_dashboard.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/accounting_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/buying_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/selling_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/stock_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/staff_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/settings_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/users_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/erpnext_settings_workspace.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/kiosk_mode.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/product_search.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/post_sale_popup.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/pos_item_list.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/customer_dues.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_low_stock.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_receive_stock.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_parties.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_items.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_stock.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_add_item.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_billing.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_sale.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_sale_invoice.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_invoice_preview.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_collect_payment.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_purchase.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_reports.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_sync.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_utilities.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_transaction_message.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_whatsapp_connect.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_fixed_sidebar.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_topbar.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/pos_large_ui.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/upload_bill.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_doctor.css?v={SANTU_ASSET_VERSION}",
	# Sabse aakhir me: CPVC ka pila rang har screen ke apne row rules ke
	# baad aana chahiye, warna un rules se dhak jaata hai.
	f"/assets/santu_hardware/css/santu_item_highlight.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_keyboard.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/santu_feature_workbook.css?v={SANTU_ASSET_VERSION}",
])
app_include_js = _LiveAssets([
	# Very first: it hides the page before there is anything worth seeing,
	# then decides whether to ask for a PIN before showing it (2026-09-04
	# direct request: "isme login krne ke liye PIN set kr do").
	f"/assets/santu_hardware/js/santu_app_lock_webauthn.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_app_lock.js?v={SANTU_ASSET_VERSION}",
	# First, so it is listening before anything else can throw.
	f"/assets/santu_hardware/js/santu_error_capture.js?v={SANTU_ASSET_VERSION}",
	# Every error / warning on screen in simple Hindi (क्या हुआ + क्या करें),
	# Ankit 2026-09-19. Early, so it wraps frappe.msgprint before any screen.
	f"/assets/santu_hardware/js/santu_hindi_errors.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_qty_prefix.js?v={SANTU_ASSET_VERSION}",
	# Search over the lines already on a bill/estimate/challan/order/return.
	# Shared for the same reason qty_prefix is: every item-entry screen needs
	# it and none of them should carry its own copy.
	f"/assets/santu_hardware/js/santu_row_filter.js?v={SANTU_ASSET_VERSION}",
	# Reads a screen-to-screen handoff (convert this to a bill, edit this
	# challan) in ONE place. Loaded before the page scripts that use it.
	f"/assets/santu_hardware/js/santu_handoff.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_bill_label.js?v={SANTU_ASSET_VERSION}",
	# Jaldi: har item-list screen isse row ka rang (CPVC/UPVC) poochti hai.
	f"/assets/santu_hardware/js/santu_item_highlight.js?v={SANTU_ASSET_VERSION}",
	# Jaldi: har document screen isse item ke saare units poochti hai.
	f"/assets/santu_hardware/js/santu_uom.js?v={SANTU_ASSET_VERSION}",
	# Hover-par-batao: har icon button ka matlab.
	f"/assets/santu_hardware/js/santu_tooltips.js?v={SANTU_ASSET_VERSION}",
	# Jaldi: screens isse apni search-list keyboard se chalane ke liye
	# poochti hain.
	f"/assets/santu_hardware/js/santu_keyboard.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_barcode_scanner.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/vendor_qz_tray.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/thermal_print.js?v={SANTU_ASSET_VERSION}",
	# The shared three-button save block (Save / Save & Print / Send WhatsApp)
	# used by Billing, Estimate, both returns, Purchase Invoice and the
	# Challan. Must load after thermal_print.js, which it calls into.
	f"/assets/santu_hardware/js/santu_save_buttons.js?v={SANTU_ASSET_VERSION}",
	# The row ✓ (push this line's price + unit into the item). Shared by
	# Billing and Estimate so the two can never drift apart.
	f"/assets/santu_hardware/js/santu_tick_to_master.js?v={SANTU_ASSET_VERSION}",
	# "Available: N" on a bill row -> put stock in without leaving the bill.
	f"/assets/santu_hardware/js/santu_add_stock_inline.js?v={SANTU_ASSET_VERSION}",
	# Must load before any billing screen — that screen's save path calls into
	# it the moment the server cannot be reached (Offline Billing, 2026-09-08).
	f"/assets/santu_hardware/js/santu_offline_queue.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_printer_settings.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/kiosk_mode.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_fixed_sidebar.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_topbar.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_privacy.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_dashboard_sidebar_link.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_open_returns.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_smart_confirm.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/post_sale_popup.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/print_everywhere.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_whatsapp_share.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/whatsapp_everywhere.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/transaction_message_button.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_customer_capture.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_no_gst.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_smart_payment_split.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_discount_toggle.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_line_item_edit.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_quick_create_item.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_review_before_finalize.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_privacy_mode.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_edit_customer_name.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_numpad_fast_type_fix.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_voice_search.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_pwa.js?v={SANTU_ASSET_VERSION}",
])

# include js, css files in header of web template
# design_system.css + login.css are loaded on "web" pages (login screen
# included — ROADMAP.md Phase 2.5 Stage 1) since app_include_css only
# applies to Desk.
web_include_css = [
	f"/assets/santu_hardware/css/design_system.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/vyapar_theme.css?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/css/login.css?v={SANTU_ASSET_VERSION}",
]
# web_include_js = "/assets/santu_hardware/js/santu_hardware.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "santu_hardware/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Purchase Invoice": "public/js/purchase_invoice.js",
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "santu_hardware/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# 2026-07-31: "ye wala screen nh chahiye" (the Shop Mode tile grid) —
# reverted to ERPNext's own standard Home/Workspace landing.
# 2026-08-01: the Shop Mode Page itself is now deleted entirely (it was
# still being reached via the kiosk status bar's "Home" link) — see
# public/js/kiosk_mode.js.
# home_page = "shop-mode"

# website user home page (by Role)
# NOTE: role_home_page only applies to "Website User" type accounts per
# frappe/auth.py's login redirect logic — verified against source, not
# assumed. Staff logins here are "System User" type (Desk access), which
# uses User.default_workspace / get_default_path() instead, neither of
# which cleanly supports "route to a custom Page by role". The actual
# Cashier-lands-on-billing redirect is implemented client-side in
# kiosk_mode.js instead — see UX_STRATEGY.md SS4.1.
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "santu_hardware.utils.jinja_methods",
# 	"filters": "santu_hardware.utils.jinja_filters"
# }

# Installation
# ------------

after_install = "santu_hardware.setup.install.after_install"

# Item-name colour rules (Utilities > Item Highlight Rules) need to be on
# every Desk page before its first item list renders — extend_bootinfo puts
# them in frappe.boot synchronously at page load, no extra round trip.
extend_bootinfo = "santu_hardware.santu_hardware.item_highlight_api.extend_bootinfo"

# Frappe re-seeds Navbar Settings' dropdown rows on upgrade, which would put
# its own Documentation / Frappe School / Support / Apps entries back in front
# of a shop owner. Re-hiding them after every migrate keeps that from silently
# undoing the choice (2026-08-15).
after_migrate = [
	"santu_hardware.setup.install.hide_vendor_navbar_items",
	"santu_hardware.setup.install.apply_santu_branding",
	"santu_hardware.setup.install.hide_commission_field",
	"santu_hardware.setup.install.set_default_print_format",
	# Back on (2026-09-06 direct request) — keeps the redemption expense
	# account/cost center/expiry on the "Santu Hardware Rewards" programme
	# from drifting, same as every other after_migrate check here.
	"santu_hardware.santu_hardware.api.ensure_loyalty_setup",
	# Points are earned as a real number (Rs 460 -> 4.6), which needs the
	# ERPNext Int fields widened to Float. Re-asserted after every migrate so
	# an ERPNext update cannot quietly put the Int back (2026-09-07).
	"santu_hardware.santu_hardware.api.ensure_fractional_loyalty_points",
	"santu_hardware.setup.install.enforce_unique_supplier_bill_numbers",
	"santu_hardware.setup.install.enable_auto_backup",
	"santu_hardware.setup.install.pin_selling_warehouse",
	"santu_hardware.setup.install.create_batch_pricing_fields",
	"santu_hardware.setup.install.create_item_pricing_fields",
	"santu_hardware.setup.install.create_wholesale_price_list",
	"santu_hardware.santu_hardware.api.migrate_privacy_pin",
	"santu_hardware.setup.install.allow_fractional_quantities",
	"santu_hardware.setup.install.create_payment_request_key_field",
]

# Uninstallation
# ------------

# before_uninstall = "santu_hardware.uninstall.before_uninstall"
# after_uninstall = "santu_hardware.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "santu_hardware.utils.before_app_install"
# after_app_install = "santu_hardware.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "santu_hardware.utils.before_app_uninstall"
# after_app_uninstall = "santu_hardware.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "santu_hardware.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	# A counter sale must never be stopped by "Quantity (9.5) cannot be a
	# fraction" -- loose/cut items are sold in halves (2026-09-18 report).
	# Any UOM added later is saved with the whole-number lock off too.
	"UOM": {"validate": "santu_hardware.setup.install.uom_allow_fraction"},
	# Only 10-digit mobiles; one item per name (Ankit, 2026-09-19).
	("Customer", "Supplier", "Contact"): {"before_validate": "santu_hardware.santu_hardware.api.enforce_ten_digit_mobile"},
	"Item": {"before_insert": "santu_hardware.santu_hardware.api.block_duplicate_item_name"},
	# A mistyped UPI ID prints a QR no app can pay (2026-09-18).
	"Santu POS Settings": {"validate": "santu_hardware.santu_hardware.api.validate_pos_settings_upi"},
	# Mirror every server error into Santu Bug Report. Hooking Error Log
	# rather than the app's own nine log_error call sites means core ERPNext
	# failures get caught too, and no future call site can forget to report.
	"Error Log": {
		"after_insert": "santu_hardware.santu_hardware.bug_report_service.mirror_error_log",
	},
	("Customer", "Supplier"): {
		"before_save": "santu_hardware.santu_hardware.api.title_case_party_name",
	},
	"Address": {
		"before_save": "santu_hardware.santu_hardware.api.title_case_address_fields",
	},
	# ERPNext computes earned points as cint(amount / factor), throwing away
	# the fraction. This puts it back before the row is written -- see
	# api.exact_loyalty_points (2026-09-07).
	"Loyalty Point Entry": {
		"before_insert": "santu_hardware.santu_hardware.api.exact_loyalty_points",
	},
	("POS Invoice", "Sales Invoice"): {
		"before_validate": "santu_hardware.santu_hardware.api.strip_gst_line_items",
		"validate": "santu_hardware.santu_hardware.api.strip_gst_line_items",
		"before_submit": [
			"santu_hardware.santu_hardware.api.apply_billing_defaults",
			# No cost price must never block a sale/return (2026-09-19).
			"santu_hardware.santu_hardware.api.allow_zero_cost_lines",
		],
		"onload": "santu_hardware.santu_hardware.api.update_payment_summary_fields",
		"on_submit": [
			"santu_hardware.santu_hardware.api.save_invoice_pdf_to_dated_folder",
			"santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
			# Runs AFTER core's own on_submit — the native Loyalty Point
			# Entry this bill just earned (if any) already exists by the
			# time this fires, which is what it reads (2026-09-06: due-bill
			# loyalty points stay Pending until paid within 2 days).
			"santu_hardware.santu_hardware.loyalty_pending.on_invoice_submit",
		],
		"on_cancel": "santu_hardware.santu_hardware.loyalty_pending.on_invoice_cancel",
	},
	"Purchase Invoice": {
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Payment Entry": {
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Sales Order": {
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Purchase Order": {
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Quotation": {
		"before_insert": "santu_hardware.santu_hardware.api.apply_quotation_defaults",
		"validate": "santu_hardware.santu_hardware.api.apply_quotation_defaults",
		"before_submit": "santu_hardware.santu_hardware.api.apply_quotation_defaults",
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Delivery Note": {
		"before_submit": "santu_hardware.santu_hardware.api.allow_zero_cost_lines",
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"santu_hardware.tasks.all"
# 	],
# 	"daily": [
# 		"santu_hardware.tasks.daily"
# 	],
# 	"hourly": [
# 		"santu_hardware.tasks.hourly"
# 	],
# 	"weekly": [
# 		"santu_hardware.tasks.weekly"
# 	],
# 	"monthly": [
# 		"santu_hardware.tasks.monthly"
# 	],
# }

scheduler_events = {
	"hourly": [
		"santu_hardware.santu_hardware.tasks.run_auto_backup_check",
		# Catches the 2-day due-bill loyalty deadline passing with nobody
		# having just made a payment to trigger reconcile_customer()
		# directly — see loyalty_pending.py's module docstring.
		"santu_hardware.santu_hardware.loyalty_pending.sweep_pending_points",
	],
	"cron": {
		# Database-only snapshot every 2 hours during shop hours, so a crash
		# at 9pm costs at most two hours of bills instead of a whole day.
		"0 */2 * * *": [
			"santu_hardware.santu_hardware.tasks.run_backup_snapshot",
		],
	},
}

# Testing
# -------

# before_tests = "santu_hardware.install.before_tests"

# Overriding Methods
# ------------------------------
#
# "Recent Orders" panel search (returns) needs to match phone/village
# too, not just invoice name/customer — see api.py's docstring on the
# override target. Keeps the existing native panel + Return button
# completely untouched, only the search matching changes.
override_whitelisted_methods = {
	"erpnext.selling.page.point_of_sale.point_of_sale.get_past_order_list": "santu_hardware.santu_hardware.api.get_past_order_list_with_phone_village"
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "santu_hardware.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# One door in front of every santu API: no-role users out, owner-only actions
# need System Manager (permission tests, 2026-09-19).
before_request = ["santu_hardware.santu_hardware.access_gate.gate"]
# Any 5xx the shop actually hits gets recorded as a bug. Needed because a
# failed page render otherwise leaves no trace at all -- the browser capture
# cannot run (its own page is the one that failed to load) and the Error Log
# mirror dies with the same aborted transaction (2026-09-07 bug report).
after_request = ["santu_hardware.santu_hardware.bug_report_service.capture_failed_response"]

# Job Events
# ----------
# before_job = ["santu_hardware.utils.before_job"]
# after_job = ["santu_hardware.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"santu_hardware.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

