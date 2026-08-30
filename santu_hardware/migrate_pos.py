import frappe

def run():
    settings = frappe.get_doc("Santu POS Settings")
    
    if not any(row.library == "Thermal Invoice Library" and row.document_type == "Sales Invoice" for row in settings.document_templates):
        existing_template = settings.invoice_template_style or "Standard Bill"
        settings.append("document_templates", {
            "library": "Thermal Invoice Library",
            "document_type": "Sales Invoice",
            "template_name": existing_template
        })
        settings.save()
        frappe.db.commit()
        print(f"Migrated existing template '{existing_template}' to child table.")
    else:
        print("Migration already done.")
