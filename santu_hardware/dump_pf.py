import frappe

def dump_print_formats():
    formats = ["Santu Hardware Thermal Bill", "Santu Hardware Thermal Bill (Sales Invoice)", "Santu Hardware Thermal Estimate (Quotation)"]
    for fmt_name in formats:
        try:
            doc = frappe.get_doc("Print Format", fmt_name)
            with open(f"/Users/santuhardware/.gemini/antigravity-ide/brain/5e835a1c-752f-4929-83aa-45e173ab2c65/scratch/{fmt_name}.html", "w") as f:
                f.write(doc.html or "")
            print(f"Dumped {fmt_name}")
        except frappe.DoesNotExistError:
            print(f"Not found: {fmt_name}")

dump_print_formats()
