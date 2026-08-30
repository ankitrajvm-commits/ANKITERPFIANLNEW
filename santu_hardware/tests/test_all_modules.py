"""
Comprehensive End-to-End Test Suite for Santu Hardware App
Tests every core module, API endpoint, document lifecycle, stock calculation,
ledger balance, doctor check, and WhatsApp/printing pipeline.
"""
from __future__ import annotations

import json
import time
import frappe
from frappe.utils import today, flt, now, add_days
from santu_hardware.santu_hardware import api
from santu_hardware.santu_hardware import doctor
from santu_hardware.santu_hardware import smart_connect_bridge
from santu_hardware.santu_hardware import transaction_message_service
from santu_hardware.santu_hardware import transaction_message_api
from santu_hardware.santu_hardware import whatsapp_connect_service

def run_test_suite():
	frappe.set_user("Administrator")
	results = []

	def _test(name, fn):
		t0 = time.time()
		try:
			res = fn()
			duration = round((time.time() - t0) * 1000, 2)
			results.append({"name": name, "status": "PASS", "duration_ms": duration, "detail": str(res)[:200] if res is not None else "OK"})
			print(f"  ✓ [{duration}ms] {name}")
			return True
		except Exception as exc:
			duration = round((time.time() - t0) * 1000, 2)
			results.append({"name": name, "status": "FAIL", "duration_ms": duration, "detail": str(exc)[:300]})
			print(f"  ✗ [{duration}ms] {name} -> {exc}")
			return False

	print("\n============================================================")
	print("STARTING FULL APP SUITE TEST")
	print("============================================================")

	# ------------------------------------------------------------
	# 1. SETUP & MASTER DATA
	# ------------------------------------------------------------
	print("\n--- 1. MASTER DATA & INVENTORY ---")

	test_item_code = "TEST-PIPE-1IN"
	created_item_code = None

	def test_quick_create():
		nonlocal created_item_code
		if frappe.db.exists("Item", test_item_code):
			frappe.delete_doc("Item", test_item_code, ignore_permissions=True, force=1)
		
		res = api.quick_create_item(
			item_name="Test PVC Pipe 1 Inch",
			selling_price=150.0,
			item_group="Products",
			uom="Nos",
			opening_qty=20,
			cost_price=100.0,
			gst_hsn_code="39172310",
			require_opening_qty=1
		)
		created_item_code = res.get("item_code")
		assert created_item_code, f"Expected item_code, got {res}"
		return res
	_test("inventory.quick_create_item", test_quick_create)

	# Test Product Search
	def test_product_search():
		search_res = api.search_products("PVC Pipe")
		items = search_res.get("results", [])
		assert any(it.get("item_code") == created_item_code or "PVC Pipe" in it.get("item_name", "") for it in items), f"Item not found in search: {items}"
		return f"Found {len(items)} items"
	_test("inventory.search_products", test_product_search)

	# Test Item Stock & Bin
	def test_item_stock():
		row = api.get_sale_item_row("Walk-in Customer", created_item_code, "Stores - SH", 1)
		assert flt(row.get("available_qty")) >= 20, f"Available qty should be >= 20, got {row.get('available_qty')}"
		assert flt(row.get("rate")) == 150.0, f"Rate should be 150, got {row.get('rate')}"
		return row
	_test("inventory.stock_and_bin_check", test_item_stock)

	# Test Low Stock API
	def test_low_stock():
		low_stock = api.get_low_stock_items()
		assert isinstance(low_stock, (list, dict)), "Expected list/dict of low stock items"
		return "OK"
	_test("inventory.get_low_stock_items", test_low_stock)

	# ------------------------------------------------------------
	# 2. PARTIES & CUSTOMER KHATA
	# ------------------------------------------------------------
	print("\n--- 2. PARTIES & CUSTOMER KHATA ---")

	test_customer_name = "Test Ramesh Khata"
	def test_party_setup():
		if not frappe.db.exists("Customer", test_customer_name):
			cust = frappe.new_doc("Customer")
			cust.customer_name = test_customer_name
			cust.customer_group = "Individual"
			cust.territory = "India"
			cust.mobile_no = "9876500001"
			cust.santu_village = "Ishuwapur"
			cust.insert(ignore_permissions=True)
		return test_customer_name
	_test("parties.setup_customer", test_party_setup)

	def test_parties_list():
		parties = api.get_parties_list(search="Ramesh", party_type="Customer")
		assert any(p.get("party_name") == test_customer_name or "Ramesh" in p.get("party_name", "") for p in parties), f"Customer not in list: {parties}"
		return f"Found {len(parties)} parties"
	_test("parties.get_parties_list", test_parties_list)

	def test_add_manual_due():
		res = api.add_manual_due(test_customer_name, 500.0, note="Old Udhaar Carryover")
		assert res.get("name") and flt(res.get("grand_total")) == 500.0, f"Manual due creation failed: {res}"
		return res
	_test("parties.add_manual_due", test_add_manual_due)

	def test_customer_dues_summary():
		dues = api.get_customer_dues(search="Ramesh")
		match = [d for d in dues if d.get("customer_name") == test_customer_name or d.get("customer") == test_customer_name]
		assert len(match) > 0, f"Customer not in dues list: {dues}"
		assert flt(match[0].get("total_due")) >= 500.0, f"Expected due >= 500, got {match[0].get('total_due')}"
		return match[0]
	_test("parties.get_customer_dues", test_customer_dues_summary)

	def test_party_statement():
		stmt = whatsapp_connect_service.get_party_statement_data("Customer", test_customer_name)
		assert "opening_balance" in stmt and "closing_balance" in stmt, f"Invalid statement data: {stmt}"
		pdf_bytes, filename = whatsapp_connect_service.generate_party_statement_pdf("Customer", test_customer_name)
		assert len(pdf_bytes) > 5000, f"Statement PDF too small: {len(pdf_bytes)} bytes"
		return f"Statement PDF {filename} generated ({len(pdf_bytes)} bytes)"
	_test("parties.generate_party_statement_pdf", test_party_statement)

	# ------------------------------------------------------------
	# 3. SALES & COUNTER BILLING
	# ------------------------------------------------------------
	print("\n--- 3. SALES & COUNTER BILLING ---")

	test_invoice_name = None

	def test_sale_invoice_init():
		init = api.get_sale_invoice_init()
		assert "company" in init and "warehouse" in init and "payment_modes" in init
		return init
	_test("sale.get_sale_invoice_init", test_sale_invoice_init)

	# Save full paid invoice
	def test_save_paid_sale_invoice():
		nonlocal test_invoice_name
		payload = {
			"customer": test_customer_name,
			"posting_date": today(),
			"items": [
				{
					"item_code": created_item_code,
					"qty": 2,
					"rate": 150.0,
					"uom": "Nos",
				}
			],
			"payment_mode": "cash",
			"paid_amount": 300.0,
		}
		res = api.save_sale_invoice(json.dumps(payload), submit=1)
		assert res.get("name") and res.get("docstatus") == 1, f"Failed to save sale invoice: {res}"
		test_invoice_name = res["name"]
		return res
	_test("sale.save_paid_sale_invoice", test_save_paid_sale_invoice)

	# Save credit (partial) invoice
	def test_save_credit_sale_invoice():
		payload = {
			"customer": test_customer_name,
			"posting_date": today(),
			"items": [
				{
					"item_code": created_item_code,
					"qty": 1,
					"rate": 150.0,
					"uom": "Nos",
				}
			],
			"payment_mode": "credit",
			"paid_amount": 0.0,
		}
		res = api.save_sale_invoice(json.dumps(payload), submit=1)
		assert res.get("name") and flt(res.get("outstanding_amount")) == 150.0, f"Outstanding should be 150: {res}"
		return res
	_test("sale.save_credit_sale_invoice", test_save_credit_sale_invoice)


	# Test View Invoice Data
	def test_invoice_view():
		assert test_invoice_name, "No invoice to view"
		vdata = api.get_invoice_view_data("Sales Invoice", test_invoice_name)
		assert vdata.get("name") == test_invoice_name, f"View data mismatch: {vdata}"
		assert len(vdata.get("items", [])) > 0, "No items in view data"
		return vdata
	_test("sale.get_invoice_view_data", test_invoice_view)

	# Test Quotation / Estimate
	def test_quotation_creation():
		q = frappe.new_doc("Quotation")
		q.party_name = test_customer_name
		q.quotation_to = "Customer"
		q.transaction_date = today()
		q.company = "Santu Hardware"
		q.append("items", {
			"item_code": created_item_code,
			"qty": 5,
			"rate": 150.0,
		})
		q.insert(ignore_permissions=True)
		q.submit()
		return q.name
	_test("sale.create_quotation_estimate", test_quotation_creation)

	# Test Delivery Challan
	def test_delivery_note():
		dn = frappe.new_doc("Delivery Note")
		dn.customer = test_customer_name
		dn.posting_date = today()
		dn.company = "Santu Hardware"
		dn.append("items", {
			"item_code": created_item_code,
			"qty": 1,
			"rate": 150.0,
			"warehouse": "Stores - SH"
		})
		dn.insert(ignore_permissions=True)
		dn.submit()
		return dn.name
	_test("sale.create_delivery_challan", test_delivery_note)

	# Test Sales Return (Credit Note)
	def test_sales_return():
		assert test_invoice_name, "No invoice for return"
		sr = frappe.new_doc("Sales Invoice")
		sr.is_return = 1
		sr.return_against = test_invoice_name
		sr.customer = test_customer_name
		sr.posting_date = today()
		sr.company = "Santu Hardware"
		sr.update_stock = 1
		sr.append("items", {
			"item_code": created_item_code,
			"qty": -1,
			"rate": 150.0,
			"sales_invoice_item": frappe.db.get_value("Sales Invoice Item", {"parent": test_invoice_name}, "name")
		})
		sr.insert(ignore_permissions=True)
		sr.submit()
		return sr.name
	_test("sale.create_sales_return", test_sales_return)

	# ------------------------------------------------------------
	# 4. PURCHASES & INCOMING STOCK
	# ------------------------------------------------------------
	print("\n--- 4. PURCHASES & INCOMING STOCK ---")

	test_supplier_name = "Test Tata Steel Supplier"
	def test_supplier_setup():
		if not frappe.db.exists("Supplier", test_supplier_name):
			sup = frappe.new_doc("Supplier")
			sup.supplier_name = test_supplier_name
			sup.supplier_group = "All Supplier Groups"
			sup.mobile_no = "9876500002"
			sup.insert(ignore_permissions=True)
		return test_supplier_name
	_test("purchase.setup_supplier", test_supplier_setup)

	def test_purchase_invoice():
		pi = frappe.new_doc("Purchase Invoice")
		pi.supplier = test_supplier_name
		pi.posting_date = today()
		pi.company = "Santu Hardware"
		pi.update_stock = 1
		pi.set_warehouse = "Stores - SH"
		pi.append("items", {
			"item_code": created_item_code,
			"qty": 20,
			"rate": 110.0,
			"warehouse": "Stores - SH",
			"expense_account": "Stock Received But Not Billed - SH"
		})
		pi.insert(ignore_permissions=True)
		pi.submit()
		return pi.name
	_test("purchase.save_purchase_invoice", test_purchase_invoice)

	# ------------------------------------------------------------
	# 5. PAYMENTS & CASH/BANK LEDGER
	# ------------------------------------------------------------
	print("\n--- 5. PAYMENTS & CASH/BANK ---")

	def test_payment_entry():
		pe = frappe.new_doc("Payment Entry")
		pe.payment_type = "Receive"
		pe.party_type = "Customer"
		pe.party = test_customer_name
		pe.posting_date = today()
		pe.mode_of_payment = "Cash"
		pe.paid_amount = 100.0
		pe.received_amount = 100.0
		pe.company = "Santu Hardware"
		pe.paid_to = "Cash - SH"
		pe.docstatus = 1
		pe.insert(ignore_permissions=True)
		return pe.name
	_test("payment.save_payment_entry", test_payment_entry)

	def test_cash_bank_summary():
		data = api.get_cash_bank_accounts()
		accounts = data.get("accounts", []) if isinstance(data, dict) else data
		assert len(accounts) > 0, f"Expected cash/bank account list: {data}"
		return f"Found {len(accounts)} cash/bank accounts, Total: {data.get('total') if isinstance(data, dict) else 'N/A'}"
	_test("payment.get_cash_bank_accounts", test_cash_bank_summary)


	# ------------------------------------------------------------
	# 6. WHATSAPP & NOTIFICATIONS
	# ------------------------------------------------------------
	print("\n--- 6. WHATSAPP & PRINTING ---")

	def test_bridge_status():
		st = smart_connect_bridge.read_bridge_status()
		assert isinstance(st, dict), "Expected dict status"
		return f"Bridge state: {st.get('state', 'UNKNOWN')}"
	_test("whatsapp.read_bridge_status", test_bridge_status)

	def test_preview_message():
		assert test_invoice_name, "No invoice for message preview"
		prev = transaction_message_service.preview_message("Sales Invoice", test_invoice_name, "sale_invoice")
		assert prev.get("message") and "Santu Hardware" in prev.get("message"), f"Invalid preview: {prev}"
		return prev.get("message")[:100] + "..."
	_test("whatsapp.preview_message", test_preview_message)

	def test_invoice_pdf_bytes():
		assert test_invoice_name, "No invoice for PDF bytes"
		doc = frappe.get_doc("Sales Invoice", test_invoice_name)
		pdf_bytes, filename = transaction_message_service.get_invoice_pdf_bytes(doc)
		assert len(pdf_bytes) > 5000, f"Invoice PDF too small: {len(pdf_bytes)} bytes"
		return f"Generated {filename} ({len(pdf_bytes)} bytes)"
	_test("printing.get_invoice_pdf_bytes", test_invoice_pdf_bytes)

	# ------------------------------------------------------------
	# 7. DOCTOR & SYSTEM HEALTH CHECKS
	# ------------------------------------------------------------
	print("\n--- 7. DOCTOR HEALTH CHECKS ---")

	def test_doctor_checks():
		chk = doctor.run_checks()
		assert "results" in chk and "summary" in chk, f"Doctor check failed: {chk}"
		summary = chk["summary"]
		return f"OK: {summary.get('ok')}, Warn: {summary.get('warn')}, Fail: {summary.get('fail')}"
	_test("doctor.run_checks", test_doctor_checks)

	# ------------------------------------------------------------
	# SUMMARY
	# ------------------------------------------------------------
	passed = sum(1 for r in results if r["status"] == "PASS")
	failed = sum(1 for r in results if r["status"] == "FAIL")

	print("\n============================================================")
	print(f"FULL SUITE RESULTS: {passed} PASSED, {failed} FAILED (TOTAL {len(results)})")
	print("============================================================")
	if failed > 0:
		print("FAILURES:")
		for r in results:
			if r["status"] == "FAIL":
				print(f"  - {r['name']}: {r['detail']}")

	return {"passed": passed, "failed": failed, "total": len(results), "results": results}

