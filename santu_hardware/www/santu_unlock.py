# The native Mac app's front door (2026-09-04 direct correction: no
# username/password anywhere in the app, PIN only). A guest-accessible page
# on purpose — it is what a brand-new WebView with no session cookie at all
# hits FIRST, before /app, so it cannot itself require being logged in.
no_cache = 1


def get_context(context):
	import frappe
	from frappe.sessions import get_csrf_token

	context.no_sidebar = 1
	context.no_breadcrumbs = 1
	# The page has no Frappe session cookie holding a csrf_token yet — that
	# is the whole point, this is a guest page — so the token has to be
	# handed to it directly rather than read back out of a cookie that was
	# never set (confirmed live 2026-09-04: reading a nonexistent
	# csrf_token cookie sent an empty string, which the CURRENT guest
	# session's real (server-generated) token then failed to match,
	# producing Frappe's generic "Invalid Request").
	context.csrf_token = get_csrf_token()
