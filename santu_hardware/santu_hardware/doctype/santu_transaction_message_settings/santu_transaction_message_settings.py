import frappe
from frappe.model.document import Document

from santu_hardware.santu_hardware.transaction_message_service import ensure_default_templates


class SantuTransactionMessageSettings(Document):
	def validate(self):
		ensure_default_templates(self)
