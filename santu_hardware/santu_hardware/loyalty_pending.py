"""Loyalty points on a DUE bill are not spendable right away.

Direct request 2026-09-06: a bill left with an outstanding amount earns
points as always (ERPNext's own on_submit mechanism, untouched — see the
module docstring in api.py's loyalty section), but those points sit
PENDING until the bill is either fully paid within 2 days (→ ACTIVE, usable)
or the 2 days pass without full payment (→ EXPIRED, gone for good, never
usable again even if paid later). A bill that was never due in the first
place (paid in full at the counter) is untouched by any of this — no row
here at all, points behave exactly as they always did.

State machine, one row per due bill:

    (bill submitted, still owed)
              |
              v
           PENDING  --full payment within 2 days-->  ACTIVE
              |
        2 days pass, still owed
              |
              v
           EXPIRED  (terminal — a later payment does not revive it)

"Full payment" is judged the same way the rest of this app already judges
it: not by the bill's own `outstanding_amount` field (which never moves —
payments here are unallocated lump sums against the party, not against one
bill, since 2026-09-03), but by the SAME oldest-bill-first allocation
`get_party_payment_schedule` already uses to decide what is still owed.
`api._fifo_pending_amounts()` is the one shared implementation of that
rule; nothing here recomputes it.

Two triggers keep every row current, both automatic, no admin action:
  * `reconcile_customer()` runs right after a payment is recorded
    (create_payment_entry) — for the party who was just paid.
  * `sweep_pending_points()` runs hourly (scheduler_events) — catches the
    2-day deadline passing, and opportunistically activates anything paid
    off through a path other than create_payment_entry.
"""

import frappe
from frappe.utils import add_to_date, flt, get_datetime, now_datetime

STATUS_PENDING = "Pending"
STATUS_ACTIVE = "Active"
STATUS_EXPIRED = "Expired"

# "2 din ke andar" — measured from when the bill was actually submitted
# (real wall-clock hours), not from posting_date. posting_date can be
# backdated (allow_backdate), and a bill entered today for "yesterday"
# must still get a real 48 hours from right now, not an instantly-expired
# window from a date that has already passed.
GRACE_HOURS = 48


def on_invoice_submit(doc, method=None):
	"""doc_events hook: Sales Invoice / POS Invoice `on_submit`.

	Fires after ERPNext's own core on_submit has already run (custom
	doc_events always run after the controller's own method), so the native
	Loyalty Point Entry this bill just earned already exists — read from it,
	never recomputed here, so the points number can never disagree with
	what ERPNext itself booked.
	"""
	if doc.is_return:
		# A return does not earn anything itself, but it REVERSES what the
		# bill it is made against earned -- ERPNext rewrites that bill's
		# Loyalty Point Entry down (a full return takes it to 0, a half
		# return halves it). The tracking row must follow, or a returned
		# due-bill keeps promising points that no longer exist: it flipped
		# to Active the moment the return cleared the outstanding, and
		# pending_points kept counting the returned 4.6 (2026-09-07).
		if doc.get("return_against"):
			sync_points_with_ledger(doc.return_against)
		return
	if not doc.get("loyalty_program"):
		return
	# Never due — paid in full at the counter. No gate needed; behaves
	# exactly as it always has.
	if flt(doc.outstanding_amount) <= 0.005:
		return
	if frappe.db.exists("Santu Loyalty Pending Point", {"invoice": doc.name}):
		return  # hook re-fired somehow — never track the same bill twice

	lpe = frappe.db.get_value(
		"Loyalty Point Entry",
		{"invoice": doc.name, "invoice_type": doc.doctype},
		["loyalty_points"],
		as_dict=True,
	)
	if not lpe or not lpe.loyalty_points:
		return

	row = frappe.new_doc("Santu Loyalty Pending Point")
	row.invoice_doctype = doc.doctype
	row.invoice = doc.name
	row.customer = doc.customer
	row.points = lpe.loyalty_points
	row.bill_date = doc.posting_date
	row.status = STATUS_PENDING
	row.due_deadline = add_to_date(now_datetime(), hours=GRACE_HOURS)
	row.insert(ignore_permissions=True)


def on_invoice_cancel(doc, method=None):
	"""doc_events hook: Sales Invoice / POS Invoice `on_cancel`.

	ERPNext's own on_cancel already deletes the Loyalty Point Entry this
	bill earned (confirmed live, 2026-09-06 session) — this drops the
	matching tracking row for the same reason: a cancelled bill has no
	points left for any status to describe.
	"""
	frappe.db.delete("Santu Loyalty Pending Point", {"invoice": doc.name})


def sync_points_with_ledger(invoice: str) -> float:
	"""Pull a tracking row's `points` back in line with what the invoice
	ACTUALLY still carries in its Loyalty Point Entry, and drop the row
	entirely once nothing is left at stake.

	ERPNext owns that number -- a return rewrites it, a cancellation deletes
	it -- so this never recomputes anything, it just re-reads. Returns the
	live point count (0 if the row was dropped or never existed).
	"""
	row = frappe.db.get_value(
		"Santu Loyalty Pending Point", {"invoice": invoice}, ["name", "invoice_doctype", "points"], as_dict=True
	)
	if not row:
		return 0.0

	live = flt(
		frappe.db.get_value(
			"Loyalty Point Entry",
			{"invoice": invoice, "invoice_type": row.invoice_doctype or "Sales Invoice"},
			"loyalty_points",
		),
		2,
	)
	if live <= 0:
		# Fully returned (or the entry is gone): there is no longer anything
		# for Pending/Active/Expired to describe.
		frappe.db.delete("Santu Loyalty Pending Point", {"name": row.name})
		frappe.db.commit()
		return 0.0

	if flt(row.points, 2) != live:
		frappe.db.set_value(
			"Santu Loyalty Pending Point", row.name, "points", live, update_modified=False
		)
		frappe.db.commit()
	return live


def reconcile_customer(customer: str, company: str = None):
	"""Re-check every still-Pending row for one customer.

	Deadline is checked FIRST, deliberately: once 2 days have passed with
	the bill still owed, it is Expired — permanently — even if it gets paid
	an hour later. Only a bill that is BOTH still inside its window AND
	now fully covered (per the same FIFO allocation the payment-schedule
	panel already shows) goes Active. Partial payment leaves it Pending —
	`_fifo_pending_amounts` only reports 0 when a bill's own share of the
	party's pooled advance covers it completely.
	"""
	pending_rows = frappe.get_all(
		"Santu Loyalty Pending Point",
		filters={"customer": customer, "status": STATUS_PENDING},
		fields=["name", "invoice", "due_deadline"],
	)
	if not pending_rows:
		return

	company = company or frappe.defaults.get_user_default("Company")
	from santu_hardware.santu_hardware.api import _fifo_pending_amounts

	pending_amounts = _fifo_pending_amounts("Customer", customer, company)
	now = now_datetime()

	for r in pending_rows:
		# Re-read what the bill still actually carries first -- a return may
		# have reduced or wiped it since this row was written.
		if sync_points_with_ledger(r.invoice) <= 0:
			continue
		if r.due_deadline and now > get_datetime(r.due_deadline):
			frappe.db.set_value(
				"Santu Loyalty Pending Point",
				r.name,
				{"status": STATUS_EXPIRED, "expired_on": now},
				update_modified=False,
			)
			continue
		still_owed = flt(pending_amounts.get(r.invoice, 0))
		if still_owed <= 0.005:
			frappe.db.set_value(
				"Santu Loyalty Pending Point",
				r.name,
				{"status": STATUS_ACTIVE, "activated_on": now},
				update_modified=False,
			)
	frappe.db.commit()


def sweep_pending_points():
	"""Scheduled (hourly, scheduler_events) — the only path that can catch
	a 2-day deadline passing with nobody having just made a payment to
	trigger reconcile_customer(). Also opportunistically activates anything
	settled through a route other than create_payment_entry (a Payment
	Entry made straight from ERPNext's own native form, say), so activation
	is never permanently missed just because it didn't come through this
	app's own collect-payment screen.
	"""
	customers = frappe.get_all(
		"Santu Loyalty Pending Point",
		filters={"status": STATUS_PENDING},
		fields=["customer"],
		distinct=True,
		pluck="customer",
	)
	for customer in customers:
		try:
			reconcile_customer(customer)
		except Exception:
			frappe.log_error(title="Loyalty points sweep failed", message=frappe.get_traceback())
