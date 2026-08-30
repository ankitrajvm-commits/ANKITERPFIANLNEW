import frappe
from werkzeug.wrappers import Request
from santu_hardware.santu_hardware.print_service import _thermal_format_for

def get_demo_bill():
    doctype = "Sales Invoice"
    docs = frappe.get_all(doctype, filters={"docstatus": 1}, limit=1)
    if not docs:
        doctype = "POS Invoice"
        docs = frappe.get_all(doctype, filters={"docstatus": 1}, limit=1)
    if not docs:
        doctype = "Quotation"
        docs = frappe.get_all(doctype, filters={"docstatus": 1}, limit=1)
        
    if not docs:
        print("No invoices or quotations found!")
        return

    # Mock the request to avoid jinja errors
    env = {'SERVER_PORT': '8000', 'wsgi.url_scheme': 'http', 'wsgi.input': None, 'REQUEST_METHOD': 'GET'}
    frappe.local.request = Request(env)

    doc_name = docs[0].name
    print(f"Generating HTML for {doctype}: {doc_name}")
    print_format = _thermal_format_for(doctype)
    
    html = frappe.get_print(doctype, doc_name, print_format, as_pdf=False)
    
    out_path = "/Users/santuhardware/.gemini/antigravity-ide/brain/5e835a1c-752f-4929-83aa-45e173ab2c65/scratch/thermal_bill_demo.html"
    with open(out_path, "w") as f:
        f.write(html)
        
    print(f"Saved to {out_path}")
