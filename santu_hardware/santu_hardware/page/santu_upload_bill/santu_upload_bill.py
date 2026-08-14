# "Upload bill in PDF, auto-read the goods received, update inventory"
# (2026-08-02 direct request). Parsing logic lives in
# santu_hardware.api.get_purchase_invoice_from_bill_pdf, called from
# santu_upload_bill.js. This file exists only because Frappe's module
# loader expects a controller file alongside every Page's .json/.js pair.
