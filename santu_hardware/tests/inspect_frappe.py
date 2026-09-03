import frappe
from erpnext.controllers.sales_and_purchase_return import make_return_doc

def run():
    frappe.flags.in_test = True
    q = frappe.new_doc("Quotation")
    q.quotation_to = "Customer"
    q.party_name = "TEST-MINIMAL-Customer"
    q.company = "Santu Hardware"
    row = q.append("items", {})
    row.item_code = "TEST-MINIMAL-ITEM"
    row.qty = 1
    
    q.set_missing_values()
    print("Quotation party_name:", q.party_name)
    print("Quotation customer:", q.customer)

