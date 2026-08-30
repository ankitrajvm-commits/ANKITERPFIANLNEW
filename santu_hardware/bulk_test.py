import json
import frappe

def run_test():
    """Create a test Item and perform bulk update of custom fields.
    Prints the bulk update result as JSON.
    """
    frappe.connect()
    # Create test item if not exists
    if not frappe.db.exists('Item', 'TEST-ITEM-001'):
        doc = frappe.new_doc('Item')
        doc.item_code = 'TEST-ITEM-001'
        doc.item_name = 'Test Item'
        doc.item_group = 'All Item Groups'
        doc.stock_uom = 'Nos'
        doc.custom_min_selling_price = 100
        doc.custom_mrp = 150
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print('Created TEST-ITEM-001')
    else:
        print('TEST-ITEM-001 already exists')
    # Prepare bulk update payload
    updates = [{
        'name': 'TEST-ITEM-001',
        'fields': {
            'custom_min_selling_price': 200,
            'custom_mrp': 250
        }
    }]
    # Call the bulk update API
    result = frappe.get_attr('santu_hardware.santu_hardware.utilities_api.bulk_update_items')(updates)
    print('Bulk update result:', json.dumps(result))
    frappe.db.commit()

