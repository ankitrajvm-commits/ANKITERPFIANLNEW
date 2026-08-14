import frappe
from frappe.model.document import Document


class SantuDashboardPreference(Document):
	def validate(self):
		if self.user != frappe.session.user and "System Manager" not in frappe.get_roles():
			frappe.throw("You can only save your own dashboard widgets.")
