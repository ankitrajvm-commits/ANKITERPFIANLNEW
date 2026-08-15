# Per-printer thermal print density. A child table rather than a single field
# because the density that suits one printer's paper and head is meaningless
# for another — a counter printer and a back-office printer can and should
# hold different values.

import frappe
from frappe.model.document import Document


class SantuPrinterDensity(Document):
	pass
