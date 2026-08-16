"""Party Smart Connect — local Baileys linked-device bridge."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import frappe
import requests

BRIDGE_PORT = 18765
BRIDGE_URL = f"http://127.0.0.1:{BRIDGE_PORT}"

# ---------------------------------------------------------------------------
# TEST MODE — every outgoing WhatsApp goes to this one number, never to the
# real customer/supplier. Set up during testing (2026-08-16) so bills and
# reminders cannot reach actual parties by accident.
#
# To go live and message real parties: set TEST_REDIRECT_ENABLED = False.
# Nothing else needs changing. While it is True, TEST_REDIRECT_NUMBER is the
# ONLY number any message can reach, and _resolve_send_phone below is the one
# gate every send path passes through.
# ---------------------------------------------------------------------------
TEST_REDIRECT_ENABLED = True
TEST_REDIRECT_NUMBER = "917759069422"  # +91 77590 69422

# Back-compat alias for anything importing the old name.
OUTGOING_PHONE_REDIRECT = TEST_REDIRECT_NUMBER


def _bridge_dir() -> Path:
	return Path(frappe.get_app_path("santu_hardware", "whatsapp_bridge"))


def _site_dir() -> Path:
	path = Path(frappe.get_site_path("private", "files", "santu_smart_connect"))
	path.mkdir(parents=True, exist_ok=True)
	(path / "auth").mkdir(exist_ok=True)
	return path


def _pid_file() -> Path:
	return _site_dir() / "bridge.pid"


def _status_file() -> Path:
	return _site_dir() / "status.json"


def _alive() -> bool:
	try:
		r = requests.get(f"{BRIDGE_URL}/status", timeout=1)
		return r.status_code == 200
	except Exception:
		return False


def read_bridge_status(public: bool = True) -> dict:
	st = {"state": "DISCONNECTED", "qr": "", "phone": "", "error": ""}
	if _alive():
		try:
			st = requests.get(f"{BRIDGE_URL}/status", timeout=2).json()
		except Exception:
			pass
	elif _status_file().exists():
		try:
			st = json.loads(_status_file().read_text())
		except Exception:
			pass
	return _public_status(st) if public else st


def _node_bin() -> str:
	if os.environ.get("SANTU_NODE"):
		return os.environ["SANTU_NODE"]
	candidates = []
	fnm = Path.home() / ".local" / "share" / "fnm" / "node-versions"
	if fnm.exists():
		for d in sorted(fnm.iterdir(), reverse=True):
			n = d / "installation" / "bin" / "node"
			if n.exists():
				candidates.append(str(n))
	which = shutil.which("node")
	if which:
		candidates.append(which)
	for c in ("/opt/homebrew/bin/node", "/usr/local/bin/node"):
		if os.path.exists(c):
			candidates.append(c)
	seen = set()
	for c in candidates:
		if c in seen:
			continue
		seen.add(c)
		try:
			out = subprocess.check_output([c, "-v"], text=True).strip().lstrip("v")
			if int(out.split(".")[0]) >= 20:
				return c
		except Exception:
			pass
	return which or "node"


def _port_pids(port: int) -> list[int]:
	try:
		out = subprocess.check_output(["lsof", "-tiTCP:%s" % port, "-sTCP:LISTEN"], text=True)
		return [int(p) for p in out.split() if p.strip()]
	except Exception:
		return []


def _wait_port_free(port: int, timeout: float = 5.0) -> bool:
	deadline = time.time() + timeout
	while time.time() < deadline:
		if not _port_pids(port):
			return True
		time.sleep(0.15)
	return not _port_pids(port)


def sanitize_bridge_error(msg: str) -> str:
	if not msg:
		return ""
	low = str(msg).lower()
	if "subtle" in low or "webcrypto" in low:
		return "WhatsApp engine needs a newer Node. Tap Continue again."
	if "err_require_esm" in low:
		return "WhatsApp library failed to load. Tap Continue again."
	if "eaddrinuse" in low:
		return "WhatsApp bridge is busy. Wait a moment and tap Continue again."
	lines = [ln.strip() for ln in str(msg).splitlines() if ln.strip()]
	if any(ln.startswith("at ") or ln.startswith("/") or "node:internal" in ln for ln in lines):
		for ln in lines:
			if ln.startswith("at ") or ln.startswith("/") or "node:internal" in ln:
				continue
			if "Error:" in ln:
				return ln.split("Error:", 1)[-1].strip()[:200]
			return ln[:200]
		return "WhatsApp connection failed. Tap Continue to retry."
	return str(msg)[:200]


def _public_status(st: dict) -> dict:
	out = dict(st or {})
	if out.get("error"):
		out["error"] = sanitize_bridge_error(out["error"])
	return out


def _append_bridge_log(line: str) -> None:
	try:
		log_path = _site_dir() / "bridge.log"
		with open(log_path, "a", encoding="utf-8") as f:
			f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {line}\n")
	except Exception:
		pass


def _resolve_send_phone(phone: str) -> str:
	"""The single gate every outgoing WhatsApp number passes through.

	While TEST_REDIRECT_ENABLED is on, this returns TEST_REDIRECT_NUMBER for
	every send, no matter which party the message was built for. It is applied
	at each transport's network boundary (the bridge here, and the Meta
	provider), so no send path — present or future — can slip past it.
	"""
	from santu_hardware.santu_hardware.transaction_message_service import normalize_indian_phone

	original = normalize_indian_phone(phone) or "".join(ch for ch in str(phone or "") if ch.isdigit())

	if not TEST_REDIRECT_ENABLED:
		return original

	target = TEST_REDIRECT_NUMBER
	if original and original != target:
		msg = f"WhatsApp send redirect: {original} -> {target}"
		frappe.logger().info(msg)
		_append_bridge_log(msg)

	return target


def _tail_log(n: int = 40) -> str:
	log_path = _site_dir() / "bridge.log"
	if not log_path.exists():
		return "WhatsApp bridge did not start."
	text = log_path.read_text(errors="ignore")
	return sanitize_bridge_error(text) or "WhatsApp bridge did not start."


def start_bridge(fresh: bool = False) -> dict:
	st = read_bridge_status(public=False)
	if not fresh and (st.get("state") or "").upper() == "CONNECTED" and _alive():
		return _public_status(st)

	if fresh or (st.get("state") or "").upper() != "CONNECTED":
		stop_bridge(logout=fresh)
		auth = _site_dir() / "auth"
		shutil.rmtree(auth, ignore_errors=True)
		auth.mkdir(parents=True, exist_ok=True)
		try:
			_status_file().unlink()
		except Exception:
			pass
		try:
			(_site_dir() / "bridge.log").write_text("")
		except Exception:
			pass

	if _alive() or _port_pids(BRIDGE_PORT):
		stop_bridge(logout=False)
		if not _wait_port_free(BRIDGE_PORT, 4.0):
			return {
				"state": "ERROR",
				"qr": "",
				"phone": "",
				"error": "WhatsApp bridge is busy. Wait a moment and tap Continue again.",
			}

	bridge = _bridge_dir()
	node = _node_bin()
	env = os.environ.copy()
	env["SANTU_WA_PORT"] = str(BRIDGE_PORT)
	env["SANTU_WA_AUTH_DIR"] = str(_site_dir() / "auth")
	env["SANTU_WA_STATUS_FILE"] = str(_status_file())
	log_path = _site_dir() / "bridge.log"
	log = open(log_path, "wb")
	proc = subprocess.Popen(
		[node, str(bridge / "start.mjs")],
		cwd=str(bridge),
		env=env,
		stdout=log,
		stderr=log,
		start_new_session=True,
	)
	_pid_file().write_text(str(proc.pid))
	for _ in range(40):
		time.sleep(0.4)
		if proc.poll() is not None:
			err = _tail_log()
			return {"state": "ERROR", "qr": "", "phone": "", "error": err}
		st = read_bridge_status(public=False)
		if st.get("qr") or (st.get("state") or "").upper() in ("QR", "CONNECTED", "ERROR"):
			return _public_status(st)
	st = read_bridge_status(public=False)
	if not st.get("qr") and (st.get("state") or "").upper() not in ("QR", "CONNECTED"):
		st["error"] = st.get("error") or "QR still generating. Wait on this screen."
	return _public_status(st)


def stop_bridge(logout: bool = False) -> dict:
	if logout and _alive():
		try:
			requests.post(f"{BRIDGE_URL}/logout", timeout=8)
		except Exception:
			pass
	pid_path = _pid_file()
	if pid_path.exists():
		try:
			os.kill(int(pid_path.read_text().strip()), signal.SIGTERM)
		except Exception:
			pass
		try:
			pid_path.unlink()
		except Exception:
			pass
	for pid in _port_pids(BRIDGE_PORT):
		try:
			os.kill(pid, signal.SIGTERM)
		except Exception:
			pass
	time.sleep(0.4)
	if not _wait_port_free(BRIDGE_PORT, 3.0):
		for pid in _port_pids(BRIDGE_PORT):
			try:
				os.kill(pid, signal.SIGKILL)
			except Exception:
				pass
		_wait_port_free(BRIDGE_PORT, 2.0)
	time.sleep(0.2)
	return {"ok": True, "state": "LOGGED_OUT" if logout else "DISCONNECTED"}


def send_via_bridge(phone: str, text: str) -> dict:
	if not _alive():
		start_bridge()
	phone = _resolve_send_phone(phone)
	r = requests.post(f"{BRIDGE_URL}/send", json={"phone": phone, "text": text}, timeout=30)
	data = r.json() if r.content else {}
	if r.status_code != 200 or not data.get("ok"):
		raise RuntimeError(data.get("error") or "Smart Connect send failed")
	return {"provider_message_id": data.get("id"), "raw": data}


def send_document_via_bridge(
	phone: str, file_bytes: bytes, filename: str, caption: str = "", mimetype: str = "application/pdf"
) -> dict:
	import base64

	def _post():
		send_phone = _resolve_send_phone(phone)
		payload = {
			"phone": send_phone,
			"filename": filename or "document.pdf",
			"caption": caption or "",
			"mimetype": mimetype or "application/pdf",
			"document_base64": base64.b64encode(file_bytes).decode("ascii"),
		}
		return requests.post(f"{BRIDGE_URL}/send-document", json=payload, timeout=120)

	if not _alive():
		start_bridge()
	r = _post()
	if r.status_code == 404:
		stop_bridge(logout=False)
		start_bridge()
		r = _post()
	data = r.json() if r.content else {}
	if r.status_code != 200 or not data.get("ok"):
		raise RuntimeError(data.get("error") or "Smart Connect document send failed")
	return {"provider_message_id": data.get("id"), "raw": data}
