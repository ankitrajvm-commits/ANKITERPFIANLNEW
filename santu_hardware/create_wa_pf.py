import frappe

def create_whatsapp_pf():
    doc_types = [
        "Sales Invoice",
        "Quotation",
        "Delivery Note",
        "Purchase Invoice",
        "Payment Entry"
    ]
    
    for dt in doc_types:
        pf_name = f"Santu A4 - WhatsApp ({dt})"
        if not frappe.db.exists("Print Format", pf_name):
            doc = frappe.get_doc({
                "doctype": "Print Format",
                "name": pf_name,
                "module": "Santu Hardware",
                "standard": "No",
                "custom_format": 1,
                "print_format_type": "Jinja",
                "doc_type": dt,
                "html": """
<style>
    .wa-preview { font-family: sans-serif; padding: 20px; border: 1px solid #ddd; margin: 10px; background: white; }
    .wa-header { font-size: 24px; font-weight: bold; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
    .wa-meta { margin-bottom: 20px; color: #555; }
    .wa-style { color: #0066cc; font-weight: bold; }
</style>
<div class="wa-preview">
    <div class="wa-header">WhatsApp A4 Template Preview</div>
    <div class="wa-meta">
        <div><strong>Document:</strong> {{ doc.name }} ({{ doc.doctype }})</div>
        <div><strong>Style Selected:</strong> <span class="wa-style">{{ frappe.form_dict.get('style') or 'Standard A4' }}</span></div>
        <div><strong>Party:</strong> {{ doc.customer_name if hasattr(doc, 'customer_name') else (doc.supplier_name if hasattr(doc, 'supplier_name') else (doc.party_name if hasattr(doc, 'party_name') else '')) }}</div>
    </div>
    
    <p>This is a placeholder A4 template. In the future, this will be replaced with beautiful A4 layouts tailored for WhatsApp sharing.</p>
    
    {% if hasattr(doc, 'items') and doc.items %}
    <table class="table table-bordered">
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>
            {% for item in doc.items %}
            <tr>
                <td>{{ item.item_name }}</td>
                <td>{{ item.qty }}</td>
                <td>{{ item.get_formatted("rate") if hasattr(item, "rate") else "" }}</td>
                <td>{{ item.get_formatted("amount") if hasattr(item, "amount") else "" }}</td>
            </tr>
            {% endfor %}
        </tbody>
    </table>
    {% endif %}
    
    <div style="text-align: right; font-weight: bold; font-size: 1.2em; margin-top: 20px;">
        Total: {{ doc.get_formatted("grand_total") if hasattr(doc, 'grand_total') else (doc.get_formatted("paid_amount") if hasattr(doc, 'paid_amount') else "") }}
    </div>
</div>
                """
            })
            doc.insert()
            print(f"Created Print Format {pf_name}")
        else:
            print(f"Print Format {pf_name} already exists")

create_whatsapp_pf()
