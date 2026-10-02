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
	# Estimate/Quotation ka apna thermal parcha (2026-08-27 direct request).
	# Design jaan-boojh kar bill se alag hai: na PAID, na baaki, na UPI QR —
	# estimate ek daam hai, udhaar nahi. Upar bada "ESTIMATE" aur "Yeh bill
	# nahi hai" isliye ki koi ise bill samajh kar na le jaaye.
	"Quotation": "Santu Hardware Thermal Estimate (Quotation)",
}



# The test user must never reach paper. On 2026-09-18 a suite check called
# print_customer_khata("BRIJ KISHOR SINGH") for real and the counter printer
# pushed out his account statement mid-afternoon. Every route to the printer
# (CUPS lp, raw USB, khata, test print) checks this first.
TEST_USER_NO_PRINT = "claude.test@santuhardware.local"


class TestUserPrintBlocked(frappe.ValidationError):
	pass


def block_test_user_printing():
	if frappe.session and frappe.session.user == TEST_USER_NO_PRINT:
		raise TestUserPrintBlocked("Test user cannot send anything to the real printer.")
	# the printer is one device for the whole Mac: a test copy of the site
	# (scratch.local) must never reach it either
	if getattr(frappe.local, "site", None) != "site1.local":
		raise TestUserPrintBlocked("Only the live shop site may print.")

def _library_style(library: str, document_type: str):
	"""Invoice Settings me us document ke liye chuna hua roop (ya None)."""
	try:
		settings = frappe.get_cached_doc("Santu POS Settings")
		for row in settings.get("document_templates") or []:
			if row.library == library and row.document_type == document_type:
				return row.template_name
	except Exception:
		pass
	return None


def _thermal_format_for(invoice_doctype: str, name: str = None) -> str:
	# A Sales Invoice honours the template the shop picked in Printer Settings.
	# Each template is its own Print Format ("Santu Thermal - <name>"), so the
	# choice is a real change of layout, not a label -- and the same format the
	# preview showed is the one that reaches the printer. Anything missing or
	# unset falls straight back to the long-standing default, so a bad value in
	# settings can never stop a bill printing.
	# Return ki apni parchi hai -- "Santu Thermal - Return - <roop>" -- kyunki
	# wo bill nahi, wapsi hai (2026-09-23). Wahi baat purchase return ki.
	LIB = "Thermal Invoice Library"
	DOC_KEYS = {
		("Sales Invoice", True): ("Sales Return", "Return"),
		("Purchase Invoice", True): ("Purchase Return", "Purchase Return"),
		("Quotation", False): ("Quotation", "Estimate"),
		("Sales Order", False): ("Sales Order", "Order"),
		("Delivery Note", False): ("Delivery Note", "Challan"),
		("Purchase Invoice", False): ("Purchase Invoice", "Purchase"),
		("Purchase Order", False): ("Purchase Order", "Purchase Order"),
		("Payment Entry", False): ("Payment Entry", "Receipt"),
		("Stock Entry", False): ("Stock Entry", "Goods Received"),
	}
	is_return = False
	if name and frappe.db.has_column(invoice_doctype, "is_return"):
		is_return = bool(frappe.db.get_value(invoice_doctype, name, "is_return"))
	key = DOC_KEYS.get((invoice_doctype, is_return))
	if key:
		doc_key, prefix = key
		chosen = _library_style(LIB, doc_key) or "Standard"
		candidate = f"Santu Thermal - {prefix} - {chosen}"
		if frappe.db.exists("Print Format", candidate):
			return candidate
		candidate = f"Santu Thermal - {prefix} - Standard"
		if frappe.db.exists("Print Format", candidate):
			return candidate

	if invoice_doctype == "Sales Invoice":
		try:
			chosen = frappe.db.get_single_value("Santu POS Settings", "invoice_template_style")
		except Exception:
			chosen = None
		if chosen:
			candidate = f"Santu Thermal - {chosen}"
			if frappe.db.exists("Print Format", candidate):
				return candidate

	fmt = SANTU_THERMAL_DOCTYPES.get(invoice_doctype)
	if not fmt:
		frappe.throw(
			_("{0} ke liye thermal bill ka design nahi bana hai — ye sirf bikri ke bill ke liye hai.").format(
				invoice_doctype
			)
		)
	return fmt

def _run_lp(args, **kwargs):
	"""The ONLY way this file hands a job to CUPS. The site/user check is
	inline so a test cannot disable it by replacing block_test_user_printing
	(2026-09-19: that is how a test printed a real customer's statement)."""
	import subprocess

	if getattr(frappe.local, "site", None) != "site1.local" or \
			getattr(getattr(frappe, "session", None), "user", None) == TEST_USER_NO_PRINT:
		raise TestUserPrintBlocked("Paper is for the live shop only (site/user not allowed to print).")
	return subprocess.run(args, **kwargs)



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
	_thermal_format_for(doctype, name)
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

	# Quotation ek bikri nahi hai, isliye uske field bhi alag hain:
	# posting_date ki jagah transaction_date, customer ki jagah party_name.
	# Pehle yahan sirf Sales Invoice ke naam likhe the — Quotation bhejte hi
	# "'Quotation' object has no attribute 'posting_date'" aa jaata tha
	# (2026-08-27). PDF wala raasta chalta rehta tha, isliye ye tabhi
	# pakda jaata jab asli printer juda ho.
	is_estimate = doctype == "Quotation"
	doc_date = doc.get("posting_date") or doc.get("transaction_date")
	party = doc.get("customer") or doc.get("party_name")

	if is_estimate:
		# Kaagaz par bhi wahi baat jo HTML parche par hai: ye bill nahi hai.
		lines += [BOLD_ON, b"** ESTIMATE - YEH BILL NAHI HAI **\n", BOLD_OFF]

	lines.append(ALIGN_LEFT)
	lines.append(_line().encode("ascii") + b"\n")
	label = "Estimate" if is_estimate else "Bill"
	# The shop's own plain number, never the SINV docname — this is the slip
	# the customer walks out with, so it is the last place that name may
	# appear (2026-08-30 absolute rule).
	from santu_hardware.santu_hardware.api import bill_label

	lines.append(
		_ascii(_two_col(f"{label}: {bill_label(doc.get('santu_bill_no'))}", str(doc_date))).encode("ascii") + b"\n"
	)
	customer = doc.get("customer_name") or party or ""
	lines.append(_ascii(f"Party: {customer}").encode("ascii") + b"\n")
	mobile = doc.get("contact_mobile") or (
		frappe.db.get_value("Customer", party, "mobile_no") if party else None
	)
	if mobile:
		lines.append(_ascii(f"Phone: {mobile}").encode("ascii") + b"\n")
	if is_estimate and doc.get("valid_till"):
		lines.append(_ascii(f"Valid Till: {doc.get('valid_till')}").encode("ascii") + b"\n")
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

	# Estimate par paisa-kaudi ka koi hisaab nahi — na Paid, na baaki, na
	# khaate ka total. Ek daam bataya gaya hai, liya kuch nahi gaya; "TOTAL
	# DUE" chhaap dena ise udhaar ka parcha bana deta.
	if not is_estimate:
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
	# Reward points earned on THIS bill -- same line the HTML/CUPS bill
	# carries, so a slip that fell back to this raw path is not silently
	# missing something the customer was told to expect (2026-09-07: the
	# reward line existed only in the Print Format HTML, so rung 2 printed
	# bills without it). Never for an estimate: nothing is earned on one.
	if not is_estimate:
		try:
			from santu_hardware.santu_hardware.api import get_customer_loyalty_summary

			_loyalty = get_customer_loyalty_summary(doc.get("customer"), doctype, name) or {}
			if _loyalty.get("enabled") and _loyalty.get("earned_this_bill"):
				lines.append(
					_ascii(f"Reward Pts Earned: {_loyalty['earned_this_bill']}").encode("ascii") + b"\n"
				)
		except Exception:
			# A points lookup must never be the reason a fallback bill fails
			# to print -- this rung exists precisely for when things break.
			pass
	if is_estimate:
		# Saada hyphen: thermal printer sirf ASCII chhapta hai, em-dash "?"
		# ban kar nikalta hai.
		lines.append(_ascii("Sirf daam ka andaaza - bill alag banega").encode("ascii") + b"\n")
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
	"""Log the outcome of one rung of the ladder with retry on concurrent updates."""
	ok = cint(ok)
	for attempt in range(3):
		try:
			job = frappe.get_doc("Santu Print Job", job_name)
			if attempt > 0:
				job.reload()
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
			job.flags.ignore_version = True
			job.flags.ignore_permissions = True
			job.save(ignore_permissions=True)
			frappe.db.commit()
			return job.status
		except Exception as exc:
			if attempt == 2 or ("1020" not in str(exc) and "TimestampMismatchError" not in type(exc).__name__):
				# Direct SQL fallback to guarantee persistence without raising error
				try:
					stamped = f"{now_datetime():%H:%M:%S} {method}: {'ok' if ok else (error or 'failed')}"
					frappe.db.sql(
						"""UPDATE `tabSantu Print Job`
						SET attempts = attempts + 1,
						    status = %s,
						    method = IF(%s = 1, %s, method),
						    printed_on = IF(%s = 1, NOW(), printed_on),
						    error_message = IF(%s = 1, NULL, %s),
						    attempt_log = CONCAT(IFNULL(attempt_log, ''), '\n', %s),
						    modified = NOW()
						WHERE name = %s""",
						(
							"Printed" if ok else "Failed",
							ok, method,
							ok,
							ok, (error or "")[:500],
							stamped,
							job_name,
						),
					)
					frappe.db.commit()
					return "Printed" if ok else "Failed"
				except Exception:
					pass
				raise


@frappe.whitelist()
def confirm_print_job(job_name: str, printed=1):
	"""The operator's answer to "did the bill actually come out?".

	Paper-out cannot be detected reliably on this printer, and a driver that
	reports success while the roll is empty is exactly how a customer walks
	away without a bill. One tap settles it.
	"""
	for attempt in range(3):
		try:
			job = frappe.get_doc("Santu Print Job", job_name)
			if attempt > 0:
				job.reload()
			job.status = "Confirmed" if cint(printed) else "Not Printed"
			job.confirmed_by_user = frappe.session.user
			job.attempt_log = _append_attempt(job, "operator says " + ("printed" if cint(printed) else "NOT printed"))
			job.flags.ignore_links = True
			job.flags.ignore_version = True
			job.flags.ignore_permissions = True
			job.save(ignore_permissions=True)
			frappe.db.commit()
			return job.status
		except Exception as exc:
			if attempt == 2 or ("1020" not in str(exc) and "TimestampMismatchError" not in type(exc).__name__):
				try:
					stamped = f"{now_datetime():%H:%M:%S} operator says " + ("printed" if cint(printed) else "NOT printed")
					frappe.db.sql(
						"""UPDATE `tabSantu Print Job`
						SET status = %s,
						    confirmed_by_user = %s,
						    attempt_log = CONCAT(IFNULL(attempt_log, ''), '\n', %s),
						    modified = NOW()
						WHERE name = %s""",
						(
							"Confirmed" if cint(printed) else "Not Printed",
							frappe.session.user,
							stamped,
							job_name,
						),
					)
					frappe.db.commit()
					return "Confirmed" if cint(printed) else "Not Printed"
				except Exception:
					pass
				raise


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
	block_test_user_printing()
	import os
	import subprocess
	import tempfile

	from santu_hardware.santu_hardware.api import _print_request_context, _thermal_pdf_bytes

	print_format = _thermal_format_for(invoice_doctype, invoice_name)
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
		result = _run_lp(
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
	block_test_user_printing()
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
			result = _run_lp(
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
	block_test_user_printing()
	from santu_hardware.santu_hardware.api import _usb_send

	payload = escpos_bill_bytes(invoice_doctype, invoice_name, is_duplicate=cint(is_duplicate))
	_usb_send(payload)
	return {"ok": True, "bytes": len(payload)}


@frappe.whitelist()
def open_print_jobs(hours: int = 24):
	"""Bills that were queued and never confirmed as printed."""
	from frappe.utils import add_to_date

	since = add_to_date(now_datetime(), hours=-int(hours))
	# A print takes a couple of seconds: the job is "Queued" while the paper
	# is still coming out. The screen asks for this list the moment a bill is
	# saved, so a bill that printed perfectly was being announced as "Ye bill
	# print nahi hue" every single time -- the shop dismissed that false
	# alarm on nearly every bill from 14 to 20 Sept. Anything younger than
	# this is still on its way, not a failure (2026-09-21).
	settling = add_to_date(now_datetime(), seconds=-45)
	jobs = frappe.get_all(
		"Santu Print Job",
		filters={"creation": (">", since), "modified": ("<", settling), "status": ("in", ["Queued", "Failed", "Not Printed"])},
		fields=["name", "invoice_doctype", "invoice_name", "status", "method", "attempts", "error_message"],
		order_by="creation desc",
		limit_page_length=50,
	)
	# Two things this list must get right, both found live on 2026-08-30:
	#
	# 1. Name each job by the shop's own bill number (`santu_bill_no`, plain
	#    1, 2, 3). The SINV docname is internal and must never stand for a
	#    bill anywhere the shop can see it.
	# 2. Drop jobs whose document no longer exists. A deleted bill cannot be
	#    reprinted and has no number left to show, so nagging about it is
	#    pure noise — the banner was listing five of these.
	out = []
	for job in jobs:
		doctype = job.get("invoice_doctype")
		name = job.get("invoice_name")
		if not doctype or not name or not frappe.db.exists(doctype, name):
			continue
		job["bill_no"] = (
			frappe.db.get_value(doctype, name, "santu_bill_no")
			if frappe.db.has_column(doctype, "santu_bill_no")
			else None
		)
		# Not every print job is a bill — a khata/statement job points at a
		# Customer, whose own name is the right thing to show.
		job["display_name"] = None if job["bill_no"] is not None else (name if doctype not in ("Sales Invoice", "POS Invoice") else None)
		out.append(job)
	return out


@frappe.whitelist()
def dismiss_print_jobs(job_names):
	"""Stop nagging about these bills — the shop has decided not to print them.

	The unprinted-bill notice on Billing had no way out (2026-08-30 request:
	"uspe side me cross daal do taki mai use kaat saku ki bill ab print nahi
	karna"). A bill can be legitimately abandoned — the customer left, the
	slip was hand-written, the sale was cancelled — and until now the banner
	sat there forever with no way to say so.

	The job is closed, not deleted: `Cancelled` keeps the record that a bill
	was queued and deliberately never printed, which is the whole point of
	having a print log.
	"""
	import json

	names = json.loads(job_names) if isinstance(job_names, str) else job_names
	if isinstance(names, str):
		names = [names]

	closed = []
	for name in names or []:
		if not frappe.db.exists("Santu Print Job", name):
			continue
		frappe.db.set_value(
			"Santu Print Job",
			name,
			{
				"status": "Cancelled",
				"confirmed_by_user": frappe.session.user,
				"error_message": _("User ne kaha: ab ye bill print nahi karna."),
			},
		)
		closed.append(name)

	frappe.db.commit()
	return {"closed": closed}


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


def escpos_khata_bytes(customer: str, from_date: str = None, to_date: str = None) -> bytes:
	"""ESC/POS thermal roll bytes for customer khata."""
	from santu_hardware.santu_hardware.api import get_customer_khata

	data = get_customer_khata(customer, from_date, to_date)
	settings = frappe.get_single("Santu POS Settings")

	company = frappe.defaults.get_user_default("Company") or frappe.db.get_value("Company", {}, "name") or "Santu Hardware"
	gstin = frappe.db.get_value("Company", company, "gstin") if company else None

	lines: list[bytes] = [INIT, ALIGN_CENTER, BOLD_ON, DOUBLE_ON]
	lines.append(_ascii(company).encode("ascii") + b"\n")
	lines += [DOUBLE_OFF, BOLD_OFF]
	if gstin:
		lines.append(_ascii(f"GSTIN: {gstin}").encode("ascii") + b"\n")

	lines += [BOLD_ON, b"** ACCOUNT STATEMENT **\n", BOLD_OFF]

	lines.append(ALIGN_LEFT)
	lines.append(_line().encode("ascii") + b"\n")
	lines.append(_ascii(f"Customer: {data['customer_name']}").encode("ascii") + b"\n")
	mobile = frappe.db.get_value("Customer", customer, "mobile_no")
	if mobile:
		lines.append(_ascii(f"Phone: {mobile}").encode("ascii") + b"\n")
	lines.append(_ascii(f"Period: {data['from_date']} to {data['to_date']}").encode("ascii") + b"\n")
	lines.append(_line().encode("ascii") + b"\n")

	lines.append(_ascii(_two_col("OPENING BALANCE", f"Rs. {_money(data['opening_balance'])}")).encode("ascii") + b"\n")
	lines.append(_line().encode("ascii") + b"\n")

	total_debit = 0
	total_credit = 0
	for r in data["rows"]:
		d_str = str(r["date"])
		b_no = str(r["display_number"])
		r_type = str(r["type"])
		amt_str = f"+{_money(r['debit'])}" if r["debit"] else f"-{_money(r['credit'])}"
		if r["debit"]:
			total_debit += flt(r["debit"])
		if r["credit"]:
			total_credit += flt(r["credit"])

		lines.append(_ascii(_two_col(f"{d_str} #{b_no} ({r_type})", amt_str)).encode("ascii") + b"\n")
		for it in (r.get("items") or []):
			lines.append(_ascii(f"  * {it['item_name']} x{it['qty']}").encode("ascii") + b"\n")
		lines.append(_ascii(_two_col("  Bal", f"Rs. {_money(r['balance'])}")).encode("ascii") + b"\n")

	lines.append(_line().encode("ascii") + b"\n")
	lines.append(_ascii(_two_col("Total Debit (Sale)", f"Rs. {_money(total_debit)}")).encode("ascii") + b"\n")
	lines.append(_ascii(_two_col("Total Credit (Paid)", f"Rs. {_money(total_credit)}")).encode("ascii") + b"\n")
	lines.append(_line().encode("ascii") + b"\n")

	lines += [BOLD_ON]
	lines.append(_ascii(_two_col("CLOSING BALANCE", f"Rs. {_money(data['closing_balance'])}")).encode("ascii") + b"\n")
	lines += [BOLD_OFF]

	lines.append(_line().encode("ascii") + b"\n")
	lines.append(ALIGN_CENTER)
	lines.append(_ascii(settings.get("bill_footer") or "Thank you!").encode("ascii") + b"\n")
	lines.append(b"\n\n\n")
	lines.append(CUT)
	return b"".join(lines)


# Not whitelisted: internal only. The two public wrappers below are the
# entry points, so a browser cannot pass an arbitrary party_type in.
def _print_party_khata(
	party_type: str, customer: str, from_date: str = None, to_date: str = None, compact: bool = False
):
	"""Print a party's khata through the thermal ladder: CUPS -> USB -> Screen.

	Shared by customers and mahajans (2026-09-04) — the ladder, the job
	logging and the fallbacks are identical, only the party side differs.
	`compact` drops the item breakdown per bill (2026-09-06) — see
	api._customer_khata_thermal_html. Only Rung 1 (CUPS, the PDF renderer)
	honours it; Rung 2's raw ESC/POS text is already terse and stays as is."""
	block_test_user_printing()
	import os
	import subprocess
	import tempfile
	# _usb_send was never imported here, so the khata's USB fallback died with
	# "name '_usb_send' is not defined" every time CUPS jammed (seen 2026-09-18).
	from santu_hardware.santu_hardware.api import _thermal_khata_pdf_bytes, _usb_send

	job = None
	try:
		job = create_print_job(party_type, customer)
	except Exception:
		job = None

	# Rung 1: CUPS (Native Thermal Printer Queue)
	try:
		queue = _cups_queue_name()
		pdf = _thermal_khata_pdf_bytes(customer, from_date, to_date, party_type=party_type, compact=compact)
		if pdf and len(pdf) > 500:
			path = None
			try:
				with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fh:
					fh.write(pdf)
					path = fh.name

				result = _run_lp(
					["lp", "-d", queue, "-o", "TmxPaperCut=CutPerJob", "-t", f"Account-{customer}", path],
					capture_output=True,
					text=True,
					timeout=30,
				)
				if result.returncode == 0:
					job_id = ""
					for token in (result.stdout or "").split():
						if "-" in token and token.split("-")[-1].isdigit():
							job_id = token
							break
					_wait_for_cups_job(job_id)
					if job:
						record_print_attempt(job, "Printer", 1)
					return {"ok": True, "method": "Printer", "queue": queue}
				else:
					err_msg = (result.stderr or "").strip()[:200]
					if job:
						record_print_attempt(job, "Printer", 0, err_msg)
			finally:
				if path and os.path.isfile(path):
					try:
						os.unlink(path)
					except OSError:
						pass
	except Exception as e:
		if job:
			record_print_attempt(job, "Printer", 0, str(e))

	# Rung 2: Direct USB ESC/POS
	try:
		raw_bytes = escpos_khata_bytes(customer, from_date, to_date)
		_usb_send(raw_bytes)
		if job:
			record_print_attempt(job, "Direct USB", 1)
		return {"ok": True, "method": "Direct USB"}
	except Exception as e:
		if job:
			record_print_attempt(job, "Direct USB", 0, str(e))

	# Rung 3: PDF / Screen fallback
	if job:
		record_print_attempt(job, "PDF", 1)
	return {"ok": True, "method": "PDF"}



@frappe.whitelist()
def print_customer_khata(customer: str, from_date: str = None, to_date: str = None, compact: int = 0):
	"""Print a customer's khata on the thermal roll."""
	return _print_party_khata("Customer", customer, from_date, to_date, compact=bool(cint(compact)))


@frappe.whitelist()
def print_supplier_khata(supplier: str, from_date: str = None, to_date: str = None, compact: int = 0):
	"""Print a mahajan's khata on the thermal roll."""
	return _print_party_khata("Supplier", supplier, from_date, to_date, compact=bool(cint(compact)))
