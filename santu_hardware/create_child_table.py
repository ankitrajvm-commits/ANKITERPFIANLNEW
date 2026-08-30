import frappe

def create_child_table():
    if not frappe.db.exists("DocType", "Santu Document Template Settings"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Santu Document Template Settings",
            "module": "Santu Hardware",
            "custom": 1,
            "istable": 1,
            "fields": [
                {
                    "fieldname": "library",
                    "label": "Library",
                    "fieldtype": "Select",
                    "options": "Thermal Invoice Library\nWhatsApp Library",
                    "in_list_view": 1
                },
                {
                    "fieldname": "document_type",
                    "label": "Document Type",
                    "fieldtype": "Link",
                    "options": "DocType",
                    "in_list_view": 1
                },
                {
                    "fieldname": "template_name",
                    "label": "Template Name",
                    "fieldtype": "Data",
                    "in_list_view": 1
                }
            ]
        })
        doc.insert()
        print("Created Santu Document Template Settings")
    else:
        print("Santu Document Template Settings already exists")

def migrate_pos_settings():
    settings = frappe.get_doc("Santu POS Settings")
    
    # Only migrate if we haven't already
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

def run():
    create_child_table()
    # Now we need to add the table field to POS Settings
    # but we can do that via python script too
    pos_settings_dt = frappe.get_doc("DocType", "Santu POS Settings")
    
    # check if field already exists
    if not any(f.fieldname == "document_templates" for f in pos_settings_dt.fields):
        # find where to insert it. after invoice_template_style is fine, or replace invoice_library_section content
        idx = 0
        for i, f in enumerate(pos_settings_dt.fields):
            if f.fieldname == "invoice_template_style":
                idx = i
                break
                
        pos_settings_dt.append("fields", {
            "fieldname": "document_templates",
            "label": "Document Templates",
            "fieldtype": "Table",
            "options": "Santu Document Template Settings",
            "insert_after": "invoice_template_style"
        })
        
        # update field_order manually by inserting after invoice_template_style
        pos_settings_dt.field_order.insert(idx + 1, "document_templates")
        
        pos_settings_dt.save()
        print("Added document_templates field to Santu POS Settings")
    else:
        print("document_templates field already exists")
        
    migrate_pos_settings()
    
