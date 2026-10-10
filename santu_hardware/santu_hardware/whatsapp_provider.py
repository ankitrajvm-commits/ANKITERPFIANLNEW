"""WhatsApp provider abstraction — all API calls server-side only."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod

import frappe
import requests
from frappe.utils import get_url


class WhatsAppProviderError(Exception):
	pass


def _guard_recipient(to: str) -> str:
	"""Last line before the network: run the recipient through the one test-mode
	gate. The bridge transport already does this inside send_via_bridge; this
	makes the Meta Cloud transport self-guard too, so neither can ever put a
	real party's number on the wire while test redirect is on."""
	from santu_hardware.santu_hardware.smart_connect_bridge import _resolve_send_phone

	return _resolve_send_phone(to)


class WhatsAppProvider(ABC):
	@abstractmethod
	def test_connection(self) -> dict:
		pass

	@abstractmethod
	def send_text(self, to: str, body: str) -> dict:
		pass

	@abstractmethod
	def send_document(self, to: str, file_bytes: bytes, filename: str, caption: str = "") -> dict:
		pass

	@abstractmethod
	def send_image(self, to: str, file_bytes: bytes, caption: str = "", mimetype: str = "image/png") -> dict:
		pass


class MetaCloudAPIProvider(WhatsAppProvider):
	def __init__(self, settings):
		self.settings = settings
		self.api_url = (settings.api_url or "https://graph.facebook.com/v21.0").rstrip("/")
		self.phone_number_id = settings.phone_number_id
		self.token = settings.get_password("access_token", raise_exception=False)

	def _headers(self):
		if not self.token:
			raise WhatsAppProviderError("WhatsApp access token is not configured.")
		return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

	def test_connection(self) -> dict:
		if not self.phone_number_id:
			raise WhatsAppProviderError("Phone Number ID is required.")
		url = f"{self.api_url}/{self.phone_number_id}"
		resp = requests.get(url, headers=self._headers(), timeout=30)
		data = resp.json() if resp.content else {}
		if resp.status_code != 200:
			err = data.get("error", {})
			raise WhatsAppProviderError(err.get("message") or resp.text or "Connection failed")
		return {"ok": True, "display_phone_number": data.get("display_phone_number"), "verified_name": data.get("verified_name")}

	def send_text(self, to: str, body: str) -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import block_non_live_send

		block_non_live_send()  # Meta API too: never from a test copy / test user
		to = _guard_recipient(to)
		url = f"{self.api_url}/{self.phone_number_id}/messages"
		payload = {
			"messaging_product": "whatsapp",
			"recipient_type": "individual",
			"to": to,
			"type": "text",
			"text": {"preview_url": True, "body": body[:4096]},
		}
		resp = requests.post(url, headers=self._headers(), json=payload, timeout=60)
		data = resp.json() if resp.content else {}
		if resp.status_code not in (200, 201):
			err = data.get("error", {})
			raise WhatsAppProviderError(err.get("message") or resp.text or "Send failed")
		msg_id = (data.get("messages") or [{}])[0].get("id")
		return {"provider_message_id": msg_id, "raw": data}

	def _upload_media(self, file_bytes: bytes, filename: str, mimetype: str = "application/pdf") -> str:
		from santu_hardware.santu_hardware.smart_connect_bridge import block_non_live_send

		block_non_live_send()  # Meta API too: never from a test copy / test user
		url = f"{self.api_url}/{self.phone_number_id}/media"
		headers = {"Authorization": f"Bearer {self.token}"}
		files = {"file": (filename, file_bytes, mimetype)}
		data = {"messaging_product": "whatsapp", "type": mimetype}
		resp = requests.post(url, headers=headers, data=data, files=files, timeout=120)
		result = resp.json() if resp.content else {}
		if resp.status_code not in (200, 201):
			err = result.get("error", {})
			raise WhatsAppProviderError(err.get("message") or "Media upload failed")
		return result.get("id")

	def send_document(self, to: str, file_bytes: bytes, filename: str, caption: str = "") -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import block_non_live_send

		block_non_live_send()  # Meta API too: never from a test copy / test user
		to = _guard_recipient(to)
		media_id = self._upload_media(file_bytes, filename)
		url = f"{self.api_url}/{self.phone_number_id}/messages"
		doc_payload = {"id": media_id, "filename": filename}
		if caption:
			doc_payload["caption"] = caption[:1024]
		payload = {
			"messaging_product": "whatsapp",
			"to": to,
			"type": "document",
			"document": doc_payload,
		}
		resp = requests.post(url, headers=self._headers(), json=payload, timeout=60)
		data = resp.json() if resp.content else {}
		if resp.status_code not in (200, 201):
			err = data.get("error", {})
			raise WhatsAppProviderError(err.get("message") or resp.text or "Document send failed")
		msg_id = (data.get("messages") or [{}])[0].get("id")
		return {"provider_message_id": msg_id, "raw": data}

	def send_image(self, to: str, file_bytes: bytes, caption: str = "", mimetype: str = "image/png") -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import block_non_live_send

		block_non_live_send()  # Meta API too: never from a test copy / test user
		to = _guard_recipient(to)
		media_id = self._upload_media(file_bytes, f"bill.{mimetype.split('/')[-1]}", mimetype)
		url = f"{self.api_url}/{self.phone_number_id}/messages"
		img_payload = {"id": media_id}
		if caption:
			img_payload["caption"] = caption[:1024]
		payload = {
			"messaging_product": "whatsapp",
			"to": to,
			"type": "image",
			"image": img_payload,
		}
		resp = requests.post(url, headers=self._headers(), json=payload, timeout=60)
		data = resp.json() if resp.content else {}
		if resp.status_code not in (200, 201):
			err = data.get("error", {})
			raise WhatsAppProviderError(err.get("message") or resp.text or "Image send failed")
		msg_id = (data.get("messages") or [{}])[0].get("id")
		return {"provider_message_id": msg_id, "raw": data}

	def send_document_link(self, to: str, link: str, filename: str, caption: str = "") -> dict:
		to = _guard_recipient(to)
		url = f"{self.api_url}/{self.phone_number_id}/messages"
		doc_payload = {"link": link, "filename": filename}
		if caption:
			doc_payload["caption"] = caption[:1024]
		payload = {
			"messaging_product": "whatsapp",
			"to": to,
			"type": "document",
			"document": doc_payload,
		}
		resp = requests.post(url, headers=self._headers(), json=payload, timeout=60)
		data = resp.json() if resp.content else {}
		if resp.status_code not in (200, 201):
			err = data.get("error", {})
			raise WhatsAppProviderError(err.get("message") or resp.text or "Document send failed")
		msg_id = (data.get("messages") or [{}])[0].get("id")
		return {"provider_message_id": msg_id, "raw": data}


class SmartConnectProvider(WhatsAppProvider):
	"""Phone WhatsApp linked as a desktop device (Party Smart Connect)."""

	def test_connection(self) -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status, start_bridge

		st = start_bridge()
		if st.get("state") != "CONNECTED":
			st = read_bridge_status()
		if st.get("state") != "CONNECTED":
			raise WhatsAppProviderError(st.get("error") or "Scan the QR code to link WhatsApp.")
		return {"ok": True, "display_phone_number": st.get("phone") or ""}

	def send_text(self, to: str, body: str) -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import send_via_bridge

		return send_via_bridge(to, body)

	def send_document(self, to: str, file_bytes: bytes, filename: str, caption: str = "") -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import send_document_via_bridge

		return send_document_via_bridge(to, file_bytes, filename, caption=caption)

	def send_image(self, to: str, file_bytes: bytes, caption: str = "", mimetype: str = "image/png") -> dict:
		from santu_hardware.santu_hardware.smart_connect_bridge import send_image_via_bridge

		return send_image_via_bridge(to, file_bytes, caption=caption, mimetype=mimetype)


def get_whatsapp_provider():
	from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status

	settings = frappe.get_single("Santu WhatsApp Settings")
	st = read_bridge_status()
	if st.get("state") == "CONNECTED":
		return SmartConnectProvider()
	if not settings.enabled:
		return None
	if settings.provider == "Meta Cloud API":
		return MetaCloudAPIProvider(settings)
	raise WhatsAppProviderError(f"Unsupported provider: {settings.provider}")


def is_whatsapp_configured() -> bool:
	from santu_hardware.santu_hardware.smart_connect_bridge import read_bridge_status

	if read_bridge_status().get("state") == "CONNECTED":
		return True
	settings = frappe.get_single("Santu WhatsApp Settings")
	return bool(
		settings.enabled
		and settings.phone_number_id
		and settings.get_password("access_token", raise_exception=False)
	)
