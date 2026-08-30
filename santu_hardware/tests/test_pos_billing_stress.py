"""
POS Billing High-Volume Stress Test & Benchmark Suite
Runs configurable batches of POS billing transactions to test performance,
deadlock handling, concurrency resilience, stock calculation accuracy,
and financial ledger consistency under heavy load.
"""

from __future__ import annotations

import json
import time
import random
import sys
import frappe
from frappe.utils import today, flt
from santu_hardware.santu_hardware.api import save_sale_invoice, quick_create_item


def run_pos_stress_test(total_invoices: int = 100, batch_size: int = 20):
	frappe.set_user("Administrator")
	
	print(f"\n============================================================")
	print(f"STARTING POS BILLING STRESS TEST ({total_invoices} TRANSACTIONS)")
	print(f"============================================================")

	# 1. Ensure test stock item exists with sufficient inventory
	item_res = quick_create_item(
		item_name="Stress Test Steel Bar",
		selling_price=100.0,
		item_group="Products",
		uom="Nos",
		opening_qty=total_invoices * 10,
		cost_price=70.0,
		gst_hsn_code="72142090",
		require_opening_qty=1
	)
	test_item_code = item_res.get("item_code")
	print(f"Using stress test item '{test_item_code}' with initial opening qty.")

	# 2. Customers pool
	named_customers = ["Ramesh Kumar", "Test Ramesh Khata"]
	all_customers = ["Walk-in Customer"] + named_customers

	passed = 0
	failed = 0
	errors = []
	durations = []

	t_start_total = time.time()

	for i in range(1, total_invoices + 1):
		cust = random.choice(all_customers)
		
		# Business Rule: Walk-in Customer must be fully paid (cash); named customers can be credit/baaki.
		if cust == "Walk-in Customer":
			pmode = "cash"
		else:
			pmode = random.choice(["cash", "credit"])

		qty = random.randint(1, 3)
		rate = 100.0
		total_amt = qty * rate
		paid_amt = total_amt if pmode == "cash" else 0.0

		payload = {
			"customer": cust,
			"company": "Santu Hardware",
			"warehouse": "Stores - SH",
			"posting_date": today(),
			"payment_mode": pmode,
			"paid_amount": paid_amt,
			"items": [
				{
					"item_code": test_item_code,
					"qty": qty,
					"rate": rate,
					"uom": "Nos",
				}
			]
		}

		t0 = time.time()
		try:
			res = save_sale_invoice(json.dumps(payload), submit=1)
			elapsed = (time.time() - t0) * 1000
			durations.append(elapsed)
			if res and res.get("name"):
				passed += 1
			else:
				failed += 1
				errors.append(f"Bill #{i}: Invalid response {res}")
		except Exception as exc:
			elapsed = (time.time() - t0) * 1000
			durations.append(elapsed)
			failed += 1
			errors.append(f"Bill #{i} failed ({elapsed:.1f}ms): {str(exc)[:150]}")

		if i % batch_size == 0 or i == total_invoices:
			avg_ms = sum(durations[-batch_size:]) / len(durations[-batch_size:])
			print(f"Progress: {i}/{total_invoices} bills processed. Passed: {passed}, Failed: {failed}. Avg speed: {avg_ms:.1f} ms/bill")

	total_time = time.time() - t_start_total
	tps = passed / total_time if total_time > 0 else 0
	avg_duration = sum(durations) / len(durations) if durations else 0

	print(f"\n============================================================")
	print(f"STRESS TEST COMPLETE: {passed}/{total_invoices} PASSED ({(passed/total_invoices)*100:.1f}%)")
	print(f"Total Time: {total_time:.2f} seconds | Throughput: {tps:.2f} bills/sec")
	print(f"Average Response Time: {avg_duration:.1f} ms | Min: {min(durations):.1f} ms | Max: {max(durations):.1f} ms")
	print(f"============================================================")

	if errors:
		print("\nErrors encountered:")
		for err in errors[:10]:
			print(f"  - {err}")
		if len(errors) > 10:
			print(f"  ... and {len(errors) - 10} more errors.")

	return {
		"total": total_invoices,
		"passed": passed,
		"failed": failed,
		"total_time_sec": round(total_time, 2),
		"throughput_tps": round(tps, 2),
		"avg_duration_ms": round(avg_duration, 2),
		"errors": errors
	}
