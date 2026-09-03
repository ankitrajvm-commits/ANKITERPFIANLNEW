"""Collect what goes wrong, in one place, without anyone having to notice.

Before this, the app had nine `frappe.log_error` calls, thirteen `console.error`
swallows and no way at all for the person at the counter to say "this screen is
broken". Every failure landed in the Error Log, which nobody opens, so the only
bug-reporting channel that actually worked was Ankit noticing something and
telling me about it days later.

Three sources feed one table:

  * **Server** — mirrored from Frappe's own Error Log via `after_insert`, so
    this catches core ERPNext failures too, not just the app's own. No call
    site had to be touched.
  * **Browser** — `window.onerror` / `unhandledrejection`, batched and
    throttled (see santu_error_capture.js).
  * **Reported by User** — the "Report Bug" button. One line of text; the
    screen, the version and the bill are filled in automatically, because a
    shop owner should not have to know what a route is.

Repeats are folded onto one row with a counter rather than filling the table
with a thousand copies of the same thing.
"""

from __future__ import annotations

import hashlib
import re

import frappe
from frappe.utils import cint, now_datetime

# Error Log titles that are noise rather than bugs: things the shop cannot act
# on and that would bury the reports that matter.
IGNORED_ERROR_TITLES = (
	"Scheduled Job Type",
	"Error in Scheduled Job",
	"Backup Job",
)


def _fingerprint(*parts) -> str:
	"""Group repeats of the same failure onto one row.

	Digits are stripped before hashing so the same crash on invoice 41 and
	invoice 42 counts as one bug, not two — otherwise a loop of failures
	would push everything else off the screen.
	"""
	raw = "|".join(str(p or "") for p in parts)
	raw = re.sub(r"\d+", "#", raw)
	return hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:20]


def _app_version() -> str:
	try:
		from santu_hardware import __version__

		return __version__
	except Exception:
		return ""


def record_bug(
	title: str,
	message: str = "",
	traceback: str = "",
	source: str = "Server",
	route: str = "",
	reference_doctype: str = None,
	reference_name: str = None,
):
	"""Insert or bump one bug row. Never raises.

	Deliberately swallowing: this runs from an `after_insert` hook on Error
	Log and from user-facing endpoints. A bug recorder that can itself throw
	would turn a small failure into a bigger one, which is the exact pattern
	this whole file exists to stop.
	"""
	try:
		title = (title or "Unknown error")[:140]
		fp = _fingerprint(source, title, (traceback or message or "")[:400])

		existing = frappe.db.get_value("Santu Bug Report", {"fingerprint": fp}, ["name", "occurrences"])
		if existing:
			name, count = existing
			frappe.db.set_value(
				"Santu Bug Report",
				name,
				{
					"occurrences": cint(count) + 1,
					"last_seen_on": now_datetime(),
					# A bug that comes back after being marked Fixed is not
					# fixed. Reopen it rather than letting it hide.
					"status": "New",
				},
				update_modified=False,
			)
			return name

		doc = frappe.get_doc(
			{
				"doctype": "Santu Bug Report",
				"title": title,
				"source": source,
				"status": "New",
				"occurrences": 1,
				"route": (route or "")[:140],
				"app_version": _app_version(),
				"reference_doctype": reference_doctype,
				"reference_name": reference_name,
				"reported_by": frappe.session.user,
				"last_seen_on": now_datetime(),
				"message": (message or "")[:5000],
				"traceback": (traceback or "")[:10000],
				"fingerprint": fp,
			}
		)
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		# Last resort only — do not recurse back into record_bug. The insert
		# above can fail mid-transaction (seen 2026-09-02: a backup-failure
		# report itself failed with a raw pymysql error) — without rolling
		# back first, the fallback log_error() call inherits that same
		# broken transaction and fails too, so the original failure never
		# gets recorded anywhere at all.
		try:
			frappe.db.rollback()
			frappe.log_error(title="Bug report could not be recorded", message=frappe.get_traceback())
		except Exception:
			pass
		return None


def mirror_error_log(doc, method=None):
	"""`doc_events` hook — Error Log `after_insert`.

	Mirroring rather than replacing: Frappe's Error Log stays exactly as it
	is, and this simply makes its contents visible somewhere a shop owner
	will actually be shown them.
	"""
	title = doc.get("method") or doc.get("title") or "Server error"
	if any(ignored in str(title) for ignored in IGNORED_ERROR_TITLES):
		return
	record_bug(
		title=title,
		message=(doc.get("error") or "")[:2000],
		traceback=doc.get("error") or "",
		source="Server",
		route=doc.get("reference_doctype") or "",
		reference_doctype=doc.get("reference_doctype"),
		reference_name=doc.get("reference_name"),
	)


@frappe.whitelist()
def report_browser_errors(errors):
	"""Endpoint for santu_error_capture.js. Accepts a batch."""
	import json

	if isinstance(errors, str):
		errors = json.loads(errors)
	names = []
	for err in errors or []:
		names.append(
			record_bug(
				title=err.get("title") or err.get("message") or "Browser error",
				message=err.get("message") or "",
				traceback=err.get("stack") or "",
				source="Browser",
				route=err.get("route") or "",
			)
		)
	frappe.db.commit()
	return [n for n in names if n]


@frappe.whitelist()
def report_bug_from_user(what_happened: str, route: str = "", reference_doctype=None, reference_name=None):
	"""The "Report Bug" button.

	The person at the counter types one line. Everything a developer needs —
	which screen, which bill, which version, recent errors — is attached
	here rather than asked for, because asking would mean the report never
	gets filed.
	"""
	recent = frappe.get_all(
		"Santu Bug Report",
		filters={"source": "Server"},
		fields=["title", "last_seen_on"],
		order_by="last_seen_on desc",
		limit_page_length=5,
	)
	context = "\n".join(f"- {r.title} ({r.last_seen_on})" for r in recent)
	name = record_bug(
		title=(what_happened or "").strip()[:140] or "User reported a problem",
		message=f"{what_happened}\n\nRecent server errors:\n{context}",
		source="Reported by User",
		route=route,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)
	frappe.db.commit()
	return name


@frappe.whitelist()
def unread_bug_count():
	return frappe.db.count("Santu Bug Report", {"status": "New"})


@frappe.whitelist()
def get_recent_bugs(limit: int = 10, source: str = None):
	filters = {}
	if source:
		filters["source"] = source
	return frappe.get_all(
		"Santu Bug Report",
		filters=filters,
		fields=["name", "title", "source", "status", "creation", "last_seen_on"],
		order_by="creation desc",
		limit_page_length=cint(limit),
	)


@frappe.whitelist()
def recent_bugs(limit: int = 20):
	return frappe.get_all(
		"Santu Bug Report",
		fields=["name", "title", "source", "status", "occurrences", "route", "last_seen_on"],
		order_by="last_seen_on desc",
		limit_page_length=cint(limit),
	)
