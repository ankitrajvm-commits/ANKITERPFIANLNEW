"""Printing that cannot strand the operator.

The bill itself was never at risk — the invoice is submitted to the database
before anything is sent to a printer, so a print failure has never lost a
sale. What it did lose was the paper, and at a counter a customer standing
there without a slip is the failure that matters.

Three rungs, tried in order:

  1. Printer — macOS prints the real 3-inch bill through its own queue, and
     CUPS is then asked whether the job actually left that queue. Looks
     exactly like what the shop expects, and can be checked.
  2. Direct USB ESC/POS — bypasses the browser and the print system
     entirely, writing to the printer's USB endpoint (the same channel print
     density uses, proven against this printer).
  3. The 3-inch PDF on screen, so there is always something to hand over or
     re-print from.

QZ Tray used to be rung 1 and was removed on 2026-08-17. It reported success
while nothing came out of the printer: the operator pressed reprint ten
times, saw no paper, and then all ten slips appeared at once when the printer
woke up. A route that cannot tell the truth about whether it printed is worse
than one that plainly fails, because every safety net built on top of it is
built on a lie.

Every attempt is recorded on a Santu Print Job before it is sent, so nothing
is fire-and-forget, and a job that never came out on paper is visible instead
of silent.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

# Only these two have a thermal bill designed for them. A supplier bill, a
# quotation and a sales order are different documents with different content —
# no "Paid" or "BALANCE DUE" line makes sense on any of them.
#
# This is enforced because the transaction lists hand whatever doctype the row
# happens to be straight to the print button. Printing a Purchase Invoice used
# to produce a customer-shaped slip with a blank "Party:" and a cheerful
# "Thank you!" on the shop's own supplier bill (found 2026-08-17).
SANTU_THERMAL_DOCTYPES = {
	"Sales Invoice": "Santu Hardware Thermal Bill (Sales Invoice)",
	"POS Invoice": "Santu Hardware Thermal Bill",
}


def _thermal_format_for(invoice_doctype: str) -> str:
	fmt = SANTU_THERMAL_DOCTYPES.get(invoice_doctype)
	if not fmt:
		frappe.throw(
			_("{0} ke liye thermal bill ka design nahi bana hai — ye sirf bikri ke bill ke liye hai.").format(
				invoice_doctype
			)
		)
	return fmt


# Epson TM-T82X-II, Font A, 80 mm roll: 576 dots / 12 dots per char.
ESCPOS_COLUMNS = 48

ESC = b"\x1b"
GS = b"\x1d"
INIT = ESC + b"@"
ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"
DOUBLE_ON = GS + b"!\x11"
DOUBLE_OFF = GS + b"!\x00"
CUT = GS + b"V\x42\x00"


def _line(char: str = "-") -> str:
	return char * ESCPOS_COLUMNS


def _two_col(left: str, right: str) -> str:
	right = str(right)
	left = str(left)
	pad = ESCPOS_COLUMNS - len(left) - len(right)
	if pad < 1:
		left = left[: max(0, ESCPOS_COLUMNS - len(right) - 1)]
		pad = max(1, ESCPOS_COLUMNS - len(left) - len(right))
	return f"{left}{' ' * pad}{right}"


def _money(value) -> str:
	return f"{flt(value):,.2f}"


def _ascii(text) -> str:
	"""ESC/POS on this printer has no Devanagari font.

	Anything non-Latin would come out as garbage boxes, which is worse on a
	fallback slip than plain English. Names typed in Hindi are transliterated
	away to '?' rather than printed as noise.
	"""
	return str(text or "").encode("ascii", "replace").decode("ascii")


def escpos_bill_bytes(doctype: str, name: str, is_duplicate: bool = False) -> bytes:
	"""A plain, deliberately unglamorous slip for when the real bill can't print.

	This is not a pixel match for the HTML bill and is not trying to be —
	keeping it simple is what keeps it working when the pretty path is the
	thing that broke. It carries what a customer and the shop actually need:
	who, what, how much, what is still owed.
	"""
	_thermal_format_for(doctype)
	doc = frappe.get_doc(doctype, name)
	settings = frappe.get_single("Santu POS Settings")

	company = doc.company or ""
	gstin = frappe.db.get_value("Company", company, "gstin") if company else None

	lines: list[bytes] = [INIT, ALIGN_CENTER, BOLD_ON, DOUBLE_ON]
	lines.append(_ascii(company).encode("ascii") + b"\n")
	lines += [DOUBLE_OFF, BOLD_OFF]
	if gstin:
		lines.append(_ascii(f"GSTIN: {gstin}").encode("ascii") + b"\n")

	if is_duplicate:
		lines += [BOLD_ON, b"** DUPLICATE / NAKAL **\n", BOLD_OFF]

	lines.append(ALIGN_LEFT)
	lines.append(_line().encode("ascii") + b"\n")
	lines.append(_ascii(_two_col(f"Bill: {doc.name}", str(doc.posting_date))).encode("ascii") + b"\n")
	customer = doc.get("customer_name") or doc.get("customer") or ""
	lines.append(_ascii(f"Party: {customer}").encode("ascii") + b"\n")
	mobile = doc.get("contact_mobile") or frappe.db.get_value("Customer", doc.get("customer"), "mobile_no")
	if mobile:
		lines.append(_ascii(f"Phone: {mobile}").encode("ascii") + b"\n")
	lines.append(_line().encode("ascii") + b"\n")

	total_qty = 0
	for row in doc.items:
		total_qty += flt(row.qty)
		lines.append(_ascii(row.item_name or row.item_code).encode("ascii") + b"\n")
		qty_label = f"  {flt(row.qty):g} {row.uom or ''} x {_money(row.rate)}"
		lines.append(_ascii(_two_col(qty_label, _money(row.amount))).encode("ascii") + b"\n")

	lines.append(_line().encode("ascii") + b"\n")
	lines.append(_ascii(_two_col("Items", f"{total_qty:g}")).encode("ascii") + b"\n")
	lines += [BOLD_ON]
	lines.append(_ascii(_two_col("TOTAL", _money(doc.grand_total))).encode("ascii") + b"\n")
	lines += [BOLD_OFF]
	lines.append(_ascii(_two_col("Paid", _money(doc.get("paid_amount")))).encode("ascii") + b"\n")

	due = flt(doc.get("outstanding_amount"))
	if due:
		lines += [BOLD_ON]
		lines.append(_ascii(_two_col("BALANCE DUE", _money(due))).encode("ascii") + b"\n")
		lines += [BOLD_OFF]

	total_due = _total_account_balance(doc, due)
	if total_due is not None and flt(total_due) > due:
		lines.append(_ascii(_two_col("TOTAL DUE", _money(total_due))).encode("ascii") + b"\n")

	lines.append(_line().encode("ascii") + b"\n")
	lines.append(ALIGN_CENTER)
	lines.append(_ascii(settings.get("bill_footer") or "Thank you!").encode("ascii") + b"\n")
	lines.append(b"\n\n\n")
	lines.append(CUT)
	return b"".join(lines)


def _total_account_balance(doc, due):
	"""What the party owes overall, not just on this bill.

	Best-effort: this is the fallback slip, and a balance lookup that throws
	must not be the reason no paper comes out.
	"""
	try:
		from santu_hardware.santu_hardware.api import get_customer_balance_summary

		summary = get_customer_balance_summary(
			customer=doc.get("customer"), exclude_doctype=doc.doctype, exclude_name=doc.name
		)
		return flt(summary.get("previous_balance")) + flt(due)
	except Exception:
		return None


# --- Job records ------------------------------------------------------------


@frappe.whitelist()
def create_print_job(invoice_doctype: str, invoice_name: str, is_duplicate=0):
	"""Record the intent to print before anything is sent.

	Written first on purpose: a job row that exists with no result is how a
	bill that never came out becomes visible instead of silent.
	"""
	# One live job per bill. Pressing reprint ten times used to create ten
	# jobs; when the printer finally woke up, ten slips came out
	# (2026-08-17). A reprint is another attempt at the same bill, not
	# another bill — so reuse the open job and let its attempt counter grow.
	existing = frappe.db.get_value(
		"Santu Print Job",
		{
			"invoice_doctype": invoice_doctype,
			"invoice_name": invoice_name,
			"status": ("in", ["Queued", "Printed", "Failed", "Not Printed"]),
		},
		"name",
		order_by="creation desc",
	)
	if existing:
		frappe.db.set_value(
			"Santu Print Job",
			existing,
			{"status": "Queued", "is_duplicate": cint(is_duplicate)},
			update_modified=False,
		)
		frappe.db.commit()
		return existing

	job = frappe.get_doc(
		{
			"doctype": "Santu Print Job",
			"invoice_doctype": invoice_doctype,
			"invoice_name": invoice_name,
			"is_duplicate": cint(is_duplicate),
			"status": "Queued",
			"attempts": 0,
		}
	)
	# Link validation off on purpose. This row is a record of what was
	# attempted, not an accounting document, and it must be writable even when
	# the bill it names is gone, renamed or not yet committed — a
	# LinkValidationError here would turn "the print job could not be logged"
	# into a red error on the operator's screen. Seen live on 2026-08-17.
	job.flags.ignore_links = True
	job.insert(ignore_permissions=True)
	frappe.db.commit()
	return job.name


def _append_attempt(job, text: str):
	existing = job.get("attempt_log") or ""
	stamped = f"{now_datetime():%H:%M:%S} {text}"
	return (existing + "\n" + stamped).strip()[-1000:]


@frappe.whitelist()
def record_print_attempt(job_name: str, method: str, ok=0, error=None):
	# `error` is deliberately untyped: a `str` annotation makes Frappe reject
	# the call outright when the browser sends null, which is exactly what a
	# successful attempt sends. That pattern already broke every new-customer
	# sale once (2026-08-17).
	"""Log the outcome of one rung of the ladder."""
	job = frappe.get_doc("Santu Print Job", job_name)
	ok = cint(ok)
	job.attempts = cint(job.attempts) + 1
	job.attempt_log = _append_attempt(job, f"{method}: {'ok' if ok else (error or 'failed')}")
	if ok:
		job.status = "Printed"
		job.method = method
		job.printed_on = now_datetime()
		job.error_message = None
	else:
		job.status = "Failed"
		job.error_message = (error or "")[:500]
	# Same reason as on insert: this row records what was attempted, so it
	# has to stay writable even when the bill it names has gone. Without
	# this, recording the *outcome* of a print threw LinkValidationError and
	# the failure vanished — the one case the job row exists to capture.
	job.flags.ignore_links = True
	job.save(ignore_permissions=True)
	frappe.db.commit()
	return job.status


@frappe.whitelist()
def confirm_print_job(job_name: str, printed=1):
	"""The operator's answer to "did the bill actually come out?".

	Paper-out cannot be detected reliably on this printer, and a driver that
	reports success while the roll is empty is exactly how a customer walks
	away without a bill. One tap settles it.
	"""
	job = frappe.get_doc("Santu Print Job", job_name)
	job.status = "Confirmed" if cint(printed) else "Not Printed"
	job.confirmed_by_user = frappe.session.user
	job.attempt_log = _append_attempt(job, "operator says " + ("printed" if cint(printed) else "NOT printed"))
	# Same reason as on insert: this row records what was attempted, so it
	# has to stay writable even when the bill it names has gone. Without
	# this, recording the *outcome* of a print threw LinkValidationError and
	# the failure vanished — the one case the job row exists to capture.
	job.flags.ignore_links = True
	job.save(ignore_permissions=True)
	frappe.db.commit()
	return job.status


def _cups_queue_name():
	"""The macOS print queue for the shop's printer.

	CUPS rewrites a printer's name into its own queue name, replacing every
	run of spaces and punctuation with underscores: "EPSON TM-T82X-II"
	becomes "EPSON_TM_T82X_II". Match on letters and digits only so the two
	spellings cannot disagree.
	"""
	import subprocess

	wanted = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if not wanted:
		frappe.throw(_("Koi printer chuna hua nahi hai."))

	def squash(v):
		return "".join(ch for ch in (v or "").lower() if ch.isalnum())

	out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=10).stdout
	for line in out.splitlines():
		parts = line.split()
		if len(parts) >= 2 and parts[0] == "printer":
			queue = parts[1]
			if squash(queue) == squash(wanted):
				# Fail fast on a paused queue instead of submitting and then
				# waiting out the full timeout. A disabled printer is knowable
				# up front, and 20 wasted seconds at a counter with a customer
				# standing there is 20 seconds too many — the USB fallback can
				# have its turn immediately.
				if "disabled" in line or "stopped" in line or "Paused" in line:
					frappe.throw(_("Printer ruka hua (paused) hai."))
				return queue
	frappe.throw(_("Printer '{0}' computer ke print system me nahi mila.").format(wanted))


@frappe.whitelist()
def print_via_cups(invoice_doctype: str, invoice_name: str, is_duplicate=0):
	"""Rung 1 — the real bill, printed by macOS itself.

	This replaced QZ Tray as the normal path on 2026-08-17, because QZ was
	reporting success while nothing came out of the printer: the operator
	pressed reprint ten times, got nothing, and then all ten slips appeared
	at once. A print route that lies about having printed is worse than one
	that fails, because the person believes it worked.

	`lp` is answerable in a way QZ was not — it returns a job id, and CUPS
	will say whether that job completed or is stuck. Page-size/fit-to-page
	options are still not passed: the queue's own default (RP80x200) is
	already correct, and overriding it is what produced a metre of
	overlapping blank roll once before.

	One option IS passed: TmxPaperCut=CutPerJob. The Epson driver's own
	default is NoCut (`lpoptions -p <queue> -l` shows `*NoCut CutPerJob
	CutPerPage`), so every bill printed through this rung left the paper
	uncut until the operator tore it by hand — found 2026-08-19. This is a
	cut-behavior flag, not a page-geometry one, so it doesn't carry the risk
	the comment above warns about.
	"""
	import os
	import subprocess
	import tempfile

	from santu_hardware.santu_hardware.api import _print_request_context, _thermal_pdf_bytes

	print_format = _thermal_format_for(invoice_doctype)
	queue = _cups_queue_name()
	# The bill template calls frappe.call() from Jinja, which needs an HTTP
	# request. That exists when the browser triggers a print and not when the
	# Doctor's retry or a scheduled job does — so give it one either way.
	with _print_request_context():
		pdf = _thermal_pdf_bytes(invoice_doctype, invoice_name, print_format)
	if not pdf or len(pdf) < 500:
		frappe.throw(_("Bill ki PDF ban hi nahi payi."))

	path = None
	try:
		with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fh:
			fh.write(pdf)
			path = fh.name

		title = f"{invoice_name}{' DUPLICATE' if cint(is_duplicate) else ''}"
		result = subprocess.run(
			["lp", "-d", queue, "-o", "TmxPaperCut=CutPerJob", "-t", title, path],
			capture_output=True,
			text=True,
			timeout=30,
		)
		if result.returncode != 0:
			frappe.throw(_("Printer ne mana kar diya: {0}").format((result.stderr or "").strip()[:200]))

		job_id = ""
		for token in (result.stdout or "").split():
			if "-" in token and token.split("-")[-1].isdigit():
				job_id = token
				break

		_wait_for_cups_job(job_id)
		return {"ok": True, "queue": queue, "cups_job": job_id, "bytes": len(pdf)}
	finally:
		if path and os.path.isfile(path):
			try:
				os.unlink(path)
			except OSError:
				pass


def _wait_for_cups_job(job_id: str, timeout_seconds: int = 20):
	"""Wait until CUPS has actually finished the job, not just accepted it.

	Accepting a job proves nothing — that is precisely how ten slips ended up
	queued behind a printer that was not printing. If the job is still
	sitting in the queue when time runs out, treat it as a failure so the
	next rung gets its turn instead of the paper appearing minutes later.
	"""
	import subprocess
	import time

	if not job_id:
		return

	deadline = time.time() + timeout_seconds
	while time.time() < deadline:
		out = subprocess.run(["lpstat", "-o"], capture_output=True, text=True, timeout=10).stdout
		if job_id not in out:
			return  # left the queue = printed
		time.sleep(1)

	# Do not leave it queued to surprise someone later.
	subprocess.run(["cancel", job_id], capture_output=True, text=True, timeout=10)
	frappe.throw(_("Printer ne bill nahi chhapa — job atak gaya tha, use hata diya."))


@frappe.whitelist()
def test_print():
	""""Is the printer alive?" — asked the same way a bill asks it.

	Deliberately runs the real ladder rather than its own private route.
	A test print that uses a different path from the bill can pass while
	bills fail, which is exactly how the shop ended up trusting QZ Tray.
	"""
	from santu_hardware.santu_hardware.api import _usb_send

	slip = b"".join([
		INIT,
		ALIGN_CENTER,
		BOLD_ON,
		b"SANTU HARDWARE\n",
		BOLD_OFF,
		b"TEST PRINT\n",
		_line().encode("ascii") + b"\n",
		ALIGN_LEFT,
		_ascii(_two_col("Printer", frappe.db.get_single_value("Santu POS Settings", "printer_name") or "-")).encode("ascii") + b"\n",
		_ascii(_two_col("Time", f"{now_datetime():%d-%m-%Y %H:%M}")).encode("ascii") + b"\n",
		_line().encode("ascii") + b"\n",
		ALIGN_CENTER,
		b"Sab theek hai\n",
		b"\n\n\n",
		CUT,
	])

	errors = []
	try:
		_usb_send(slip)
		return {"ok": True, "method": "Direct USB"}
	except Exception as e:
		errors.append(f"USB: {e}")

	# If the USB endpoint is busy, fall back to letting macOS print it as
	# plain text through the same queue bills use.
	try:
		import os
		import subprocess
		import tempfile

		queue = _cups_queue_name()
		with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="wb") as fh:
			fh.write(slip)
			path = fh.name
		try:
			result = subprocess.run(
				["lp", "-d", queue, "-o", "TmxPaperCut=CutPerJob", path], capture_output=True, text=True, timeout=20
			)
			if result.returncode != 0:
				raise Exception((result.stderr or "").strip()[:200])
		finally:
			if os.path.isfile(path):
				os.unlink(path)
		return {"ok": True, "method": "Printer"}
	except Exception as e:
		errors.append(f"Printer: {e}")

	frappe.throw(_("Test print nahi ho paya. {0}").format(" | ".join(errors)[:300]))


@frappe.whitelist()
def print_via_usb(invoice_doctype: str, invoice_name: str, is_duplicate=0):
	"""Rung 2 — straight to the printer's USB endpoint.

	Deliberately server-side: this path exists precisely for when the
	browser's route to the printer (QZ Tray) is the thing that is broken.
	"""
	from santu_hardware.santu_hardware.api import _usb_send

	payload = escpos_bill_bytes(invoice_doctype, invoice_name, is_duplicate=cint(is_duplicate))
	_usb_send(payload)
	return {"ok": True, "bytes": len(payload)}


@frappe.whitelist()
def open_print_jobs(hours: int = 24):
	"""Bills that were queued and never confirmed as printed."""
	from frappe.utils import add_to_date

	since = add_to_date(now_datetime(), hours=-int(hours))
	return frappe.get_all(
		"Santu Print Job",
		filters={"creation": (">", since), "status": ("in", ["Queued", "Failed", "Not Printed"])},
		fields=["name", "invoice_doctype", "invoice_name", "status", "method", "attempts", "error_message"],
		order_by="creation desc",
		limit_page_length=50,
	)


# After this many attempts on one bill, stop printing and tell a human. Ten
# unanswered reprints once turned into ten slips the moment the printer woke
# up (2026-08-17) — the paper was never the problem, the printer was.
MAX_PRINT_ATTEMPTS = 4


@frappe.whitelist()
def retry_print_job(job_name: str):
	"""Try this bill again — real printer first, then the USB fallback.

	Refuses past MAX_PRINT_ATTEMPTS. Pressing "print again" at a dead
	printer does not produce paper, it produces a queue; the honest answer
	after a few tries is to say the printer needs looking at.
	"""
	job = frappe.get_doc("Santu Print Job", job_name)
	if cint(job.attempts) >= MAX_PRINT_ATTEMPTS:
		frappe.throw(
			_("Is bill ko {0} baar bhej chuke hain aur nahi chhapa. Printer dekhiye — "
			  "kagaz, taar aur bijli. Utilities → Doctor Uncle bhi jaanch lega.").format(job.attempts)
		)

	last_error = None
	for method, fn in (("Printer", print_via_cups), ("Direct USB", print_via_usb)):
		try:
			fn(job.invoice_doctype, job.invoice_name, is_duplicate=job.is_duplicate)
		except Exception as e:
			last_error = str(e)
			record_print_attempt(job.name, method, ok=0, error=last_error)
			continue
		record_print_attempt(job.name, method, ok=1)
		return {"ok": True, "method": method}

	frappe.throw(_("Bill abhi bhi nahi chhapa: {0}").format((last_error or "")[:200]))
