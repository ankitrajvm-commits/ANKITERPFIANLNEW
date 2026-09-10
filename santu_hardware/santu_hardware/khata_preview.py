"""Khata Statement as a bare page, so the Invoice Library can preview it.

The khata is the one document here that is NOT a Frappe Print Format — it is
generated markup (api._customer_khata_html / _customer_khata_thermal_html),
because a statement spans many bills rather than printing one document. That
is why it was missing from the Invoice Library entirely (2026-09-05: "invoice
library me khata bill gum hai"): the library previews through /printview, and
/printview only knows about Print Formats.

This was first written as a www page. That was wrong: Frappe wraps a www page
in the whole WEBSITE template — navbar, footer, website bundle, its own
<html> — and the khata's markup is itself a complete <!DOCTYPE html>
document, so the iframe ended up loading a full website page with a second
document nested inside it. Heavy, and it renders a full styled "Not
Permitted" page rather than failing quietly when a role is missing.

A whitelisted method returning a raw Response gives the iframe exactly the
document the printer would get, and nothing else.
"""

import frappe

PREVIEW_ROLES = ("System Manager", "Accounts User", "Accounts Manager", "Sales User", "Sales Manager")


@frappe.whitelist()
def khata_preview(party_type: str = "Customer", party: str = None, layout: str = "a4",
                  from_date: str = None, to_date: str = None, compact: int = 0):
	from werkzeug.wrappers import Response

	from santu_hardware.santu_hardware.api import (
		_customer_khata_html,
		_customer_khata_thermal_html,
		get_customer_khata,
		get_supplier_khata,
	)

	if not set(PREVIEW_ROLES) & set(frappe.get_roles()):
		frappe.throw(frappe._("Ye preview dekhne ki permission nahi hai."), frappe.PermissionError)

	party_type = "Supplier" if party_type == "Supplier" else "Customer"
	party = party or _busiest_party(party_type)
	if not party:
		return _plain("<p style='font-family:sans-serif;padding:24px;'>Abhi kisi party ka account nahi bana hai.</p>")

	data = (
		get_supplier_khata(party, from_date, to_date)
		if party_type == "Supplier"
		else get_customer_khata(party, from_date, to_date)
	)
	html = (
		_customer_khata_thermal_html(data, compact=bool(frappe.utils.cint(compact)))
		if (layout or "").lower() == "thermal"
		else _customer_khata_html(data)
	)
	return _plain(html)


def _plain(html: str):
	from werkzeug.wrappers import Response

	# X-Frame-Options is deliberately left alone: this is same-origin, which
	# SAMEORIGIN already allows, and loosening it would let any site frame a
	# customer's statement.
	return Response(html, mimetype="text/html")


def _busiest_party(party_type: str):
	"""Whoever the preview should open on — a party with a real running
	account, so the panel is never a blank sheet."""
	if party_type == "Supplier":
		return frappe.db.get_value(
			"Purchase Invoice", {"docstatus": 1}, "supplier", order_by="creation desc"
		) or frappe.db.get_value("Supplier", {"disabled": 0}, "name")
	return frappe.db.get_value(
		"Sales Invoice", {"docstatus": 1}, "customer", order_by="creation desc"
	) or frappe.db.get_value("Customer", {"disabled": 0}, "name")
