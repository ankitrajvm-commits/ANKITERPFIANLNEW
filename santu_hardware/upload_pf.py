import frappe

def upload_print_format():
    fmt_names = ["Santu Hardware Thermal Bill", "Santu Hardware Thermal Bill (Sales Invoice)"]
    file_path = "/Users/santuhardware/.gemini/antigravity-ide/brain/5e835a1c-752f-4929-83aa-45e173ab2c65/scratch/Santu Hardware Thermal Bill.html"
    
    with open(file_path, "r") as f:
        html_content = f.read()

    for fmt in fmt_names:
        try:
            doc = frappe.get_doc("Print Format", fmt)
            doc.html = html_content
            doc.save()
            print(f"Updated {fmt}")
        except frappe.DoesNotExistError:
            print(f"Not found: {fmt}")
            
    frappe.db.commit()

upload_print_format()
