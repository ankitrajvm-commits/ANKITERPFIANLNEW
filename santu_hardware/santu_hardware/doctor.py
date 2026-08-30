"""Doctor — one screen that checks the shop's setup and repairs what it can.

2026-08-17 direct request: "is app me kuch aatma daal de doctor type, jo sare
bugs ko fix kre automatic ... especially printer". The people running this
shop are not going to read a log or restart a service; when printing stops
they need one button that says what broke and offers to mend it.

Rules this module keeps to:

* Every check answers in plain language. "Printer band hai" beats an exit code.
* A check never changes anything. Fixes are separate, named, and only run when
  someone presses the button for that one thing.
* No fix may destroy data. Restarting a service, re-applying a setting or
  rebuilding a derived cache is fine; deleting documents is not, so anything
  in that territory is reported for a human to decide on instead.
* Every check must be honest about what it cannot see, and must check the
  thing that actually matters. The QZ Tray checks were removed on 2026-08-17
  when bills stopped going through QZ: a green tick against a component the
  bill no longer travels through is worse than no check at all.
"""

import os
import subprocess

import frappe
from frappe import _
from frappe.utils import flt

# Status vocabulary. "warn" means the shop still works but something will bite
# later; "fail" means a job someone does every day is broken right now.
OK, WARN, FAIL, UNKNOWN = "ok", "warn", "fail", "unknown"



def _result(check_id, title, status, detail, fix=None, fix_label=None, client_check=False):
	return {
		"id": check_id,
		"title": title,
		"status": status,
		"detail": detail,
		"fix": fix,
		"fix_label": fix_label,
		"client_check": client_check,
	}


# ---------------------------------------------------------------- printer ---


def _check_printer_selected():
	name = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if not name:
		return _result(
			"printer_selected",
			_("Printer chuna hua hai"),
			FAIL,
			_("Koi printer select nahi hai. Settings → Printer Settings me jaakar printer chunein."),
		)
	return _result("printer_selected", _("Printer chuna hua hai"), OK, name)


def _check_printer_known_to_mac():
	"""Is the selected printer actually installed in the Mac's print system?"""
	name = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if not name:
		return _result("printer_installed", _("Printer computer me juda hai"), UNKNOWN,
		               _("Pehle printer chunein."))
	try:
		out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=10).stdout
	except Exception as exc:
		return _result("printer_installed", _("Printer computer me juda hai"), UNKNOWN, str(exc)[:120])

	# CUPS rewrites a printer name into its own queue name, replacing every
	# run of punctuation AND spaces with underscores: "EPSON TM-T82X-II"
	# becomes "EPSON_TM_T82X_II". Comparing only on spaces reported a
	# perfectly healthy printer as missing, so strip both sides down to
	# letters and digits before matching.
	def squash(v):
		return "".join(ch for ch in (v or "").lower() if ch.isalnum())

	target = squash(name)
	lines = [ln for ln in out.splitlines() if ln.strip().startswith("printer")]
	match = [ln for ln in lines if target and target in squash(ln)]
	if match:
		disabled = any("disabled" in ln for ln in match)
		if disabled:
			return _result("printer_installed", _("Printer computer me juda hai"), FAIL,
			               _("{0} rukka hua (paused) hai.").format(name),
			               fix="resume_printer", fix_label=_("Printer chaalu karein"))
		return _result("printer_installed", _("Printer computer me juda hai"), OK, name)
	return _result("printer_installed", _("Printer computer me juda hai"), FAIL,
	               _("{0} is computer ki printer list me nahi mila. USB/power check karein.").format(name))


def _check_print_queue():
	"""The route bills actually take: macOS's own print queue.

	Replaced the QZ Tray checks as the printing check on 2026-08-17, when QZ
	turned out to report success without printing. A green tick against a
	component the bill no longer travels through would be worse than no
	check at all.
	"""
	name = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if not name:
		return _result("print_queue", _("Printer chhapne ke liye taiyaar hai"), FAIL,
		               _("Pehle printer chunein."))
	try:
		out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=10).stdout
	except Exception as exc:
		return _result("print_queue", _("Printer chhapne ke liye taiyaar hai"), UNKNOWN, str(exc)[:120])

	def squash(v):
		return "".join(ch for ch in (v or "").lower() if ch.isalnum())

	for line in out.splitlines():
		parts = line.split()
		if len(parts) >= 2 and parts[0] == "printer" and squash(parts[1]) == squash(name):
			if "disabled" in line or "stopped" in line:
				return _result(
					"print_queue",
					_("Printer chhapne ke liye taiyaar hai"),
					FAIL,
					_("Printer ruka hua hai — bill queue me pade rahenge, chhapenge nahi."),
					fix="resume_printer",
					fix_label=_("Printer chaalu karein"),
				)
			return _result("print_queue", _("Printer chhapne ke liye taiyaar hai"), OK, parts[1])

	return _result("print_queue", _("Printer chhapne ke liye taiyaar hai"), FAIL,
	               _("'{0}' computer ke print system me nahi mila.").format(name))


def _check_stuck_cups_jobs():
	"""Bills sitting in the macOS queue that never came out.

	This is what ten unanswered reprints looked like from the outside: the
	queue quietly filled up, and every slip appeared at once when the
	printer finally woke.
	"""
	try:
		out = subprocess.run(["lpstat", "-o"], capture_output=True, text=True, timeout=10).stdout.strip()
	except Exception as exc:
		return _result("cups_queue", _("Printer ki queue khaali hai"), UNKNOWN, str(exc)[:120])

	jobs = [line for line in out.splitlines() if line.strip()]
	if not jobs:
		return _result("cups_queue", _("Printer ki queue khaali hai"), OK, _("Koi bill atka hua nahi."))
	return _result(
		"cups_queue",
		_("Printer ki queue khaali hai"),
		FAIL,
		_("{0} bill queue me atke hain — printer inhe chhap nahi raha.").format(len(jobs)),
		fix="clear_cups_queue",
		fix_label=_("Queue khaali karein"),
	)


def _check_qz_leftovers():
	"""QZ Tray is no longer part of printing a bill.

	Kept as an informational row rather than removed outright, because it is
	still installed and still auto-starts, and someone reading this screen
	should know it is now irrelevant to whether a bill prints — otherwise
	the next person to see QZ stopped will "fix" something that is not
	broken.
	"""
	running = False
	try:
		out = subprocess.run(["pgrep", "-f", "qz-tray"], capture_output=True, text=True, timeout=10)
		running = bool(out.stdout.strip())
	except Exception:
		pass
	state = _("chal raha hai") if running else _("band hai")
	return _result(
		"qz_legacy",
		_("QZ Tray (ab bill ke liye zaroori nahi)"),
		OK,
		_("{0}. Bill ab computer ke apne print system se chhapta hai, isse nahi — "
		  "ye band ho to bhi bill nikalta rahega.").format(state),
	)


def _check_print_format():
	"""The bill customers see and the slip the printer makes must both exist."""
	missing = [
		fmt
		for fmt in ("Santu Hardware Bill (Sales Invoice)", "Santu Hardware Thermal Bill (Sales Invoice)")
		if not frappe.db.exists("Print Format", fmt)
	]
	if missing:
		return _result("print_formats", _("Bill ke design maujood hain"), FAIL,
		               _("Ye design gayab hain: {0}").format(", ".join(missing)))

	current = frappe.db.get_value(
		"Property Setter", {"doc_type": "Sales Invoice", "property": "default_print_format"}, "value"
	)
	want = "Santu Hardware Bill (Sales Invoice)"
	if current != want:
		return _result("print_formats", _("Bill ke design maujood hain"), WARN,
		               _("Print par dukaan ka apna bill nahi, koi doosra design khul raha hai."),
		               fix="fix_print_format", fix_label=_("Dukaan ka bill set karein"))
	return _result("print_formats", _("Bill ke design maujood hain"), OK,
	               _("WhatsApp par poori bill, printer par 3 inch wali parchi."))


# --------------------------------------------------------------- whatsapp ---


def _check_whatsapp():
	try:
		from santu_hardware.santu_hardware import smart_connect_bridge

		st = smart_connect_bridge.read_bridge_status(public=True) or {}
	except Exception as exc:
		return _result("whatsapp", _("WhatsApp juda hua hai"), UNKNOWN, str(exc)[:140])

	state = (st.get("state") or "").upper()
	if state == "CONNECTED":
		return _result("whatsapp", _("WhatsApp juda hua hai"), OK,
		               _("Number: {0}").format(st.get("phone") or "-"))
	if state in ("QR", "PAIRING"):
		return _result("whatsapp", _("WhatsApp juda hua hai"), WARN,
		               _("QR scan hona baaki hai — Sync, Share & Backup me jaakar scan karein."))
	return _result("whatsapp", _("WhatsApp juda hua hai"), FAIL,
	               _("WhatsApp juda nahi hai, isliye bill customer ko nahi jaayega."),
	               fix="restart_whatsapp", fix_label=_("WhatsApp dobara jodein"))


# ------------------------------------------------------------ housekeeping ---


def _check_scheduler():
	try:
		disabled = frappe.utils.scheduler.is_scheduler_inactive()
	except Exception:
		disabled = None
	if disabled is None:
		return _result("scheduler", _("Background kaam chal rahe hain"), UNKNOWN, _("Pata nahi chala."))
	if disabled:
		return _result("scheduler", _("Background kaam chal rahe hain"), WARN,
		               _("Auto backup aur reminder jaise kaam abhi band hain."),
		               fix="enable_scheduler", fix_label=_("Chaalu karein"))
	return _result("scheduler", _("Background kaam chal rahe hain"), OK,
	               _("Backup aur reminder time par chalenge."))


def _check_stock_vs_ledger():
	"""Bin is a cache of the stock ledger; if they disagree, screens lie."""
	rows = frappe.db.sql(
		"""
		select b.item_code, b.warehouse, b.actual_qty,
		       (select sle.qty_after_transaction
		          from `tabStock Ledger Entry` sle
		         where sle.item_code = b.item_code and sle.warehouse = b.warehouse
		           and sle.is_cancelled = 0
		         order by sle.posting_datetime desc, sle.creation desc limit 1) as ledger_qty
		  from `tabBin` b
		""",
		as_dict=True,
	)
	bad = [r for r in rows if abs(flt(r.actual_qty) - flt(r.ledger_qty)) > 0.001]
	if not bad:
		return _result("stock_match", _("Stock ka hisaab milta hai"), OK,
		               _("{0} saman jaanche gaye.").format(len(rows)))
	names = ", ".join(r.item_code for r in bad[:4])
	return _result("stock_match", _("Stock ka hisaab milta hai"), FAIL,
	               _("{0} saman ka stock screen par galat dikh raha hai ({1}).").format(len(bad), names),
	               fix="repost_stock", fix_label=_("Stock dobara ginwaayein"))


def _check_sellable_items():
	total = frappe.db.count("Item", {"disabled": 0, "is_stock_item": 1})
	no_price = frappe.db.sql(
		"""
		select count(*) from `tabItem` i
		 where i.disabled = 0 and i.is_stock_item = 1
		   and not exists (select 1 from `tabItem Price` p
		                    where p.item_code = i.name and p.selling = 1)
		"""
	)[0][0]
	if not no_price:
		return _result("item_prices", _("Har saman ka daam bhara hai"), OK,
		               _("{0} saman jaanche gaye.").format(total))
	return _result("item_prices", _("Har saman ka daam bhara hai"), WARN,
	               _("{0} saman ka selling price nahi hai — bill me unka daam 0 aayega.").format(no_price))


def _check_duplicate_items():
	rows = frappe.db.sql(
		"""select item_name, count(*) c from `tabItem`
		    where disabled = 0 group by item_name having c > 1 order by c desc limit 5""",
		as_dict=True,
	)
	if not rows:
		return _result("duplicate_items", _("Ek saman ek hi baar hai"), OK, _("Koi duplicate nahi."))
	names = ", ".join(r.item_name for r in rows)
	return _result("duplicate_items", _("Ek saman ek hi baar hai"), WARN,
	               _("Ye saman list me do-do baar hain: {0}. Bechte waqt galat wala chun sakte hain.").format(names))


def _check_untraceable_parties():
	"""Someone who owes money must be reachable — phone or village, at least."""
	rows = frappe.db.sql(
		"""
		select c.name from `tabCustomer` c
		 where ifnull(c.mobile_no, '') = ''
		   and ifnull(c.santu_village, '') = ''
		   and exists (select 1 from `tabSales Invoice` si
		                where si.customer = c.name and si.docstatus = 1
		                  and si.outstanding_amount > 0)
		limit 5
		""",
		as_dict=True,
	)
	if not rows:
		return _result("party_contact", _("Udhaar wale customer ka pata hai"), OK,
		               _("Jinka baaki hai, sabka phone ya gaon likha hai."))
	return _result("party_contact", _("Udhaar wale customer ka pata hai"), WARN,
	               _("{0} customer ka baaki hai par na phone hai na gaon: {1}").format(
		               len(rows), ", ".join(r.name for r in rows)))


# ----------------------------------------------------------------- backup ---


def _check_backup_fresh():
	"""Is there a recent backup, and has anyone actually opened it?

	Both halves matter. The shop ran for days with a complete backup system
	switched off and a screen that said nothing was wrong; and a dump that
	exists but will not decompress is worse than none, because it looks like
	safety right up to the day it is needed.
	"""
	from frappe.utils import get_datetime, now_datetime

	settings = frappe.get_single("Santu Backup Settings")
	if not frappe.utils.cint(settings.auto_backup_enabled):
		return _result(
			"backup_enabled",
			_("Roz ka backup chaalu hai"),
			FAIL,
			_("Auto backup band hai — abhi koi backup nahi ban raha."),
			fix="enable_backup",
			fix_label=_("Backup chaalu karein"),
		)

	last = frappe.db.get_value(
		"Santu Backup Log",
		{"status": "Success"},
		["name", "creation", "verified"],
		order_by="creation desc",
		as_dict=True,
	)
	if not last:
		return _result("backup_enabled", _("Roz ka backup chaalu hai"), FAIL,
		               _("Ab tak ek bhi backup nahi bana."))

	hours = (get_datetime(now_datetime()) - get_datetime(last.creation)).total_seconds() / 3600
	when = frappe.format_value(last.creation, {"fieldtype": "Datetime"})
	if hours > 26:
		return _result("backup_enabled", _("Roz ka backup chaalu hai"), FAIL,
		               _("Aakhri backup {0} ko hua tha — bahut purana hai.").format(when))
	if not frappe.utils.cint(last.verified):
		return _result("backup_enabled", _("Roz ka backup chaalu hai"), WARN,
		               _("Backup {0} ko bana, par uski jaanch nahi hui.").format(when))
	return _result("backup_enabled", _("Roz ka backup chaalu hai"), OK,
	               _("Aakhri backup {0} — khol kar jaancha gaya.").format(when))


def _check_disk_space():
	"""Backups and bill PDFs both stop silently when the disk fills up."""
	try:
		st = os.statvfs(frappe.utils.get_bench_path())
		free_gb = (st.f_bavail * st.f_frsize) / (1024**3)
	except Exception as exc:
		return _result("disk_space", _("Computer me jagah"), UNKNOWN, str(exc)[:120])

	detail = _("{0} GB khaali hai.").format(round(free_gb, 1))
	if free_gb < 2:
		return _result("disk_space", _("Computer me jagah"), FAIL,
		               detail + " " + _("Backup aur bill band ho sakte hain."))
	if free_gb < 10:
		return _result("disk_space", _("Computer me jagah"), WARN, detail)
	return _result("disk_space", _("Computer me jagah"), OK, detail)


# ------------------------------------------------------------------ print ---


def _check_stuck_print_jobs():
	from santu_hardware.santu_hardware.print_service import open_print_jobs

	jobs = open_print_jobs(24)
	if not jobs:
		return _result("stuck_prints", _("Sab bill chhap gaye"), OK,
		               _("Pichhle 24 ghante me koi bill atka nahi."))
	from santu_hardware.santu_hardware.api import bill_label

	names = ", ".join(bill_label(j.get("bill_no")) for j in jobs[:5])
	return _result(
		"stuck_prints",
		_("Sab bill chhap gaye"),
		FAIL,
		_("{0} bill nahi chhape: {1}").format(len(jobs), names),
		fix="retry_prints",
		fix_label=_("Dobara chhapein"),
	)


def _check_usb_printer():
	"""The fallback route — if this is dead, only the macOS queue is left.

	Reported as a warning, not a failure: bills still print through the
	normal route. What it means is that there is no longer a second way out
	when the printer queue jams, which is worth knowing before that day.
	"""
	try:
		import usb.core

		from santu_hardware.santu_hardware.api import SANTU_EPSON_USB_VENDOR

		dev = usb.core.find(idVendor=SANTU_EPSON_USB_VENDOR)
	except Exception as exc:
		return _result("usb_printer", _("Printer ka doosra raasta"), UNKNOWN, str(exc)[:120])

	if dev is None:
		return _result("usb_printer", _("Printer ka doosra raasta"), WARN,
		               _("Printer USB par nahi mila. Print queue atki to koi doosra raasta nahi bachega."))
	return _result("usb_printer", _("Printer ka doosra raasta"), OK,
	               _("Printer USB par mil raha hai — print queue atak jaye to bhi bill nikal jayega."))


def _check_invoice_pdfs():
	from santu_hardware.santu_hardware.api import invoices_missing_pdf

	missing = invoices_missing_pdf(7)
	if not missing:
		return _result("invoice_pdfs", _("Har bill ki copy rakhi hai"), OK,
		               _("Pichhle 7 din ke sabhi bill ki PDF safe hai."))
	names = ", ".join(m["name"] for m in missing[:5])
	return _result(
		"invoice_pdfs",
		_("Har bill ki copy rakhi hai"),
		WARN,
		_("{0} bill ki PDF nahi bani: {1}").format(len(missing), names),
		fix="regenerate_invoice_pdfs",
		fix_label=_("PDF dobara banayein"),
	)


# ------------------------------------------------------------------- bugs ---


def _check_bug_reports():
	"""Reported, never fixed automatically — a bug is a human's decision."""
	count = frappe.db.count("Santu Bug Report", {"status": "New"})
	if not count:
		return _result("bug_reports", _("Koi nayi shikayat nahi"), OK, _("Sab saaf hai."))
	latest = frappe.get_all(
		"Santu Bug Report",
		filters={"status": "New"},
		fields=["title"],
		order_by="last_seen_on desc",
		limit_page_length=3,
	)
	return _result(
		"bug_reports",
		_("Koi nayi shikayat nahi"),
		WARN,
		_("{0} nayi shikayat: {1}").format(count, "; ".join(r.title for r in latest)),
	)


def _check_selling_warehouse():
	"""Is it written down which godaam the shop sells from?

	Only matters once there is more than one warehouse — but by then it is
	too late to notice, because nothing looks wrong: bills print, stock moves,
	and it is the wrong stock. Hence a check that fires the moment a second
	warehouse appears without a choice having been recorded.
	"""
	pinned = frappe.db.get_single_value("Santu POS Settings", "selling_warehouse")
	live = frappe.get_all("Warehouse", filters={"is_group": 0, "disabled": 0}, fields=["name"])

	if pinned:
		row = frappe.db.get_value("Warehouse", pinned, ["is_group", "disabled"], as_dict=True)
		if not row:
			return _result("selling_warehouse", _("Bechne wala godaam tay hai"), FAIL,
			               _("Chuna hua godaam '{0}' ab maujood nahi hai.").format(pinned))
		if row.disabled or row.is_group:
			return _result("selling_warehouse", _("Bechne wala godaam tay hai"), FAIL,
			               _("Chuna hua godaam '{0}' band hai. Settings me dusra chunein.").format(pinned))
		return _result("selling_warehouse", _("Bechne wala godaam tay hai"), OK, pinned)

	if len(live) > 1:
		return _result(
			"selling_warehouse",
			_("Bechne wala godaam tay hai"),
			FAIL,
			_("{0} godaam hain par kaunse se bechna hai ye tay nahi. Bikri galat godaam se kat sakti hai.").format(len(live)),
			fix="pin_selling_warehouse",
			fix_label=_("Godaam tay karein"),
		)
	if len(live) == 1:
		return _result("selling_warehouse", _("Bechne wala godaam tay hai"), WARN,
		               _("Ek hi godaam hai ({0}), par likha hua nahi hai.").format(live[0].name),
		               fix="pin_selling_warehouse", fix_label=_("Likh dein"))
	return _result("selling_warehouse", _("Bechne wala godaam tay hai"), FAIL,
	               _("Koi chaalu godaam hi nahi hai."))


CHECKS = [
	_check_selling_warehouse,
	_check_printer_selected,
	_check_printer_known_to_mac,
	_check_print_queue,
	_check_stuck_cups_jobs,
	_check_usb_printer,
	_check_qz_leftovers,
	_check_print_format,
	_check_stuck_print_jobs,
	_check_whatsapp,
	_check_scheduler,
	_check_backup_fresh,
	_check_disk_space,
	_check_invoice_pdfs,
	_check_stock_vs_ledger,
	_check_sellable_items,
	_check_duplicate_items,
	_check_untraceable_parties,
	_check_bug_reports,
]


@frappe.whitelist()
def run_checks():
	"""Run every check. One failing check never stops the rest — a doctor that
	dies on the first problem is no use on the day things are actually broken."""
	import traceback

	results = []
	for fn in CHECKS:
		try:
			results.append(fn())
		except Exception:
			results.append(
				_result(fn.__name__, fn.__name__, UNKNOWN,
				        _("Jaanch nahi ho payi: {0}").format(traceback.format_exc().splitlines()[-1][:120]))
			)
	summary = {
		"ok": sum(1 for r in results if r["status"] == OK),
		"warn": sum(1 for r in results if r["status"] == WARN),
		"fail": sum(1 for r in results if r["status"] == FAIL),
		"unknown": sum(1 for r in results if r["status"] == UNKNOWN),
	}
	return {"results": results, "summary": summary}


# -------------------------------------------------------------------- fixes ---


def _fix_resume_printer():
	"""Un-pause the printer, then check that it actually un-paused.

	Had two bugs at once (found 2026-08-17). It built the queue name with
	`name.replace(" ", "_")`, giving "EPSON_TM-T82X-II" while the real queue
	is "EPSON_TM_T82X_II" — CUPS turns hyphens into underscores too — so
	`cupsenable` silently did nothing. And it returned success regardless,
	so Doctor reported the printer fixed while it sat there paused. That is
	the same lie that got QZ Tray removed from printing; a repair that
	cannot confirm itself has no business claiming it worked.
	"""
	from santu_hardware.santu_hardware.print_service import _cups_queue_name

	name = frappe.db.get_single_value("Santu POS Settings", "printer_name")
	if not name:
		return False, _("Pehle printer chunein.")

	def squash(v):
		return "".join(ch for ch in (v or "").lower() if ch.isalnum())

	queue = None
	try:
		out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=10).stdout
		for line in out.splitlines():
			parts = line.split()
			if len(parts) >= 2 and parts[0] == "printer" and squash(parts[1]) == squash(name):
				queue = parts[1]
				break
	except Exception as exc:
		return False, str(exc)[:140]

	if not queue:
		return False, _("'{0}' print system me nahi mila.").format(name)

	result = subprocess.run(["cupsenable", queue], capture_output=True, text=True, timeout=20)

	check = subprocess.run(["lpstat", "-p", queue], capture_output=True, text=True, timeout=10).stdout
	if "disabled" in check or "stopped" in check:
		return False, _("Printer chaalu nahi ho paya: {0}").format(
			(result.stderr or check).strip()[:160]
		)
	return True, _("Printer chaalu kar diya ({0}).").format(queue)


def _fix_restart_whatsapp():
	from santu_hardware.santu_hardware import smart_connect_bridge

	# fresh=False on purpose: a routine restart must never wipe the linked
	# session, or the shop has to scan the QR again every time it hiccups.
	smart_connect_bridge.start_bridge(fresh=False)
	return True, _("WhatsApp dobara jodne ki koshish ki gayi hai — thodi der me status dekhein.")


def _fix_enable_scheduler():
	frappe.db.set_single_value("System Settings", "enable_scheduler", 1)
	frappe.db.commit()
	return True, _("Background kaam chaalu kar diye.")


def _fix_print_format():
	from santu_hardware.setup.install import set_default_print_format

	set_default_print_format()
	return True, _("Print par ab dukaan ka apna bill khulega.")


def _fix_repost_stock():
	"""Rebuild the Bin cache from the stock ledger. Nothing is deleted — the
	ledger is the record, Bin is only the running total screens read."""
	from erpnext.stock.stock_balance import repost_stock

	pairs = frappe.db.sql("""select item_code, warehouse from `tabBin`""")
	fixed = 0
	for item_code, warehouse in pairs:
		try:
			repost_stock(item_code, warehouse, only_bin=True)
			fixed += 1
		except Exception:
			continue
	frappe.db.commit()
	return True, _("{0} saman ka stock dobara gina gaya.").format(fixed)


def _fix_enable_backup():
	from santu_hardware.setup.install import enable_auto_backup

	changed = enable_auto_backup()
	if changed:
		return True, _("Roz ka backup chaalu kar diya (raat 2 baje).")
	return True, _("Backup pehle se chaalu hai.")


def _fix_retry_prints():
	"""Re-send every stuck bill over the USB channel.

	Straight to the fallback route rather than back to QZ Tray: these jobs
	already failed the normal path once, and someone pressing "fix" wants
	paper, not another attempt at the thing that just lost.
	"""
	from santu_hardware.santu_hardware.print_service import open_print_jobs, retry_print_job

	jobs = open_print_jobs(24)
	if not jobs:
		return True, _("Koi bill atka hua nahi hai.")

	from santu_hardware.santu_hardware.api import bill_label

	done, failed = [], []
	for job in jobs:
		try:
			retry_print_job(job["name"])
			done.append(bill_label(job.get("bill_no")))
		except Exception:
			failed.append(bill_label(job.get("bill_no")))

	if failed:
		return False, _("{0} chhap gaye, {1} phir bhi nahi: {2}").format(
			len(done), len(failed), ", ".join(failed[:5])
		)
	return True, _("{0} bill dobara chhap gaye.").format(len(done))


def _fix_regenerate_invoice_pdfs():
	from santu_hardware.santu_hardware.api import regenerate_missing_invoice_pdfs

	result = regenerate_missing_invoice_pdfs(7)
	if result["failed"]:
		return False, _("{0} PDF ban gayi, {1} nahi ban payi.").format(
			len(result["regenerated"]), len(result["failed"])
		)
	if not result["regenerated"]:
		return True, _("Sabhi bill ki PDF pehle se safe hai.")
	return True, _("{0} bill ki PDF dobara bana di.").format(len(result["regenerated"]))


def _fix_pin_selling_warehouse():
	"""Only safe to do automatically while the answer is unambiguous.

	With one warehouse there is nothing to choose and this just records it.
	With several, picking one is a business decision that changes which stock
	every sale comes out of — so it refuses and asks a person.
	"""
	from santu_hardware.setup.install import pin_selling_warehouse

	if pin_selling_warehouse():
		return True, _("Godaam likh diya: {0}").format(
			frappe.db.get_single_value("Santu POS Settings", "selling_warehouse")
		)
	live = frappe.get_all("Warehouse", filters={"is_group": 0, "disabled": 0}, pluck="name")
	if len(live) > 1:
		return False, _("{0} godaam hain — kaunsa, ye aapko khud chunna hoga: Settings → Sale Settings.").format(len(live))
	return False, _("Koi chaalu godaam nahi mila.")


def _fix_clear_cups_queue():
	"""Throw away bills stuck in the macOS queue.

	Safe because the bill itself is in the database — the queue holds only
	paper that never came out. Leaving them there is the unsafe option: they
	print all at once the moment the printer wakes up, which is exactly what
	produced ten identical slips on 2026-08-17.
	"""
	try:
		before = subprocess.run(["lpstat", "-o"], capture_output=True, text=True, timeout=10).stdout
		count = len([line for line in before.splitlines() if line.strip()])
		if not count:
			return True, _("Queue pehle se khaali hai.")
		subprocess.run(["cancel", "-a"], capture_output=True, text=True, timeout=20)
		return True, _("{0} atke hue bill queue se hata diye.").format(count)
	except Exception as exc:
		return False, str(exc)[:140]


FIXES = {
	"clear_cups_queue": _fix_clear_cups_queue,
	"pin_selling_warehouse": _fix_pin_selling_warehouse,
	"enable_backup": _fix_enable_backup,
	"retry_prints": _fix_retry_prints,
	"regenerate_invoice_pdfs": _fix_regenerate_invoice_pdfs,
	"resume_printer": _fix_resume_printer,
	"restart_whatsapp": _fix_restart_whatsapp,
	"enable_scheduler": _fix_enable_scheduler,
	"fix_print_format": _fix_print_format,
	"repost_stock": _fix_repost_stock,
}


@frappe.whitelist()
def fix_everything():
	"""Run every repair that the current checks are actually asking for.

	Deliberately re-runs the checks first and only fixes what is failing right
	now — never the whole FIXES table blindly, so pressing this on a healthy
	shop restarts nothing. Each repair is isolated: one that fails must not
	stop the rest, because the whole point is that the person pressing it
	cannot go and run the others by hand.
	"""
	import traceback

	before = run_checks()
	pending = [r for r in before["results"] if r.get("fix") and r["status"] in (WARN, FAIL)]

	done, failed = [], []
	for row in pending:
		fn = FIXES.get(row["fix"])
		if not fn:
			continue
		try:
			ok, message = fn()
			(done if ok else failed).append({"title": row["title"], "message": message})
		except Exception:
			failed.append({
				"title": row["title"],
				"message": traceback.format_exc().splitlines()[-1][:140],
			})

	after = run_checks()
	return {
		"attempted": len(pending),
		"fixed": done,
		"failed": failed,
		"summary": after["summary"],
		"results": after["results"],
	}


@frappe.whitelist()
def apply_fix(fix: str):
	"""Run one named repair. Only the fixes listed above can ever run — the id
	comes from the browser, so it is looked up, never called by name."""
	fn = FIXES.get(fix)
	if not fn:
		frappe.throw(_("Ye marammat maujood nahi hai."))
	ok, message = fn()
	return {"ok": ok, "message": message}
