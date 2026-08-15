app_name = "santu_hardware"
app_title = "Santu Hardware"
app_publisher = "Ankit Kumar"
app_description = "Hardware store management system built on ERPNext for inventory, billing, POS, GST, purchase, sales, stock management and custom workflows."
app_email = "ankitrajvm@gmail.com"
app_license = "mit"

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
# edit during active development. Bump the number whenever these files
# change.
SANTU_ASSET_VERSION = "275"
app_include_css = [
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
]
app_include_js = [
	f"/assets/santu_hardware/js/vendor_qz_tray.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/thermal_print.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/kiosk_mode.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_fixed_sidebar.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/santu_topbar.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_dashboard_sidebar_link.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_open_returns.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/pos_smart_confirm.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/post_sale_popup.js?v={SANTU_ASSET_VERSION}",
	f"/assets/santu_hardware/js/print_everywhere.js?v={SANTU_ASSET_VERSION}",
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
]

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

# Frappe re-seeds Navbar Settings' dropdown rows on upgrade, which would put
# its own Documentation / Frappe School / Support / Apps entries back in front
# of a shop owner. Re-hiding them after every migrate keeps that from silently
# undoing the choice (2026-08-15).
after_migrate = [
	"santu_hardware.setup.install.hide_vendor_navbar_items",
	"santu_hardware.santu_hardware.api.ensure_loyalty_setup",
	"santu_hardware.setup.install.enforce_unique_supplier_bill_numbers",
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
	("Customer", "Supplier"): {
		"before_save": "santu_hardware.santu_hardware.api.title_case_party_name",
	},
	"Address": {
		"before_save": "santu_hardware.santu_hardware.api.title_case_address_fields",
	},
	("POS Invoice", "Sales Invoice"): {
		"before_validate": "santu_hardware.santu_hardware.api.strip_gst_line_items",
		"validate": "santu_hardware.santu_hardware.api.strip_gst_line_items",
		"before_submit": "santu_hardware.santu_hardware.api.apply_billing_defaults",
		"on_submit": [
			"santu_hardware.santu_hardware.api.save_invoice_pdf_to_dated_folder",
			"santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
		],
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
		"on_submit": "santu_hardware.santu_hardware.transaction_message_service.on_transaction_submit",
	},
	"Delivery Note": {
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
	],
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
# before_request = ["santu_hardware.utils.before_request"]
# after_request = ["santu_hardware.utils.after_request"]

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

