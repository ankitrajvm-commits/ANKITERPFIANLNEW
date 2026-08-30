# Per (library, document type) default print template -- Printer Settings'
# "Set as Default" writes one row here for every document type in the A4/
# WhatsApp Library, the same way Thermal Invoice Library uses the single
# invoice_template_style field for Sales Invoice alone.

import frappe
from frappe.model.document import Document


class SantuDocumentTemplateSettings(Document):
	pass
