# BUSINESS_RULES.md — Santu Hardware
### Domain Rules: Billing, Pricing, Inventory, Customers, Payments

> Companion to `ERP_MASTER_PROMPT.md`. Read the master file first — this file holds
> the detailed "how the business actually works" rules that code must respect.

---

## 1. BUSINESS DOMAIN

**Product categories sold:**
Hardware tools & fasteners (nails, screws, bolts, hinges, locks), Electrical (wires,
switches, MCBs, bulbs, holders), Paints (Asian Paints, Berger, etc., multiple can
sizes), Plumbing (pipes, fittings, PVC/CPVC, taps, valves), Sanitary ware & bathroom
accessories, Water tanks, Adhesives (Fevicol, M-seal), Construction materials
(cement-related small items), general hardware miscellaneous.

**Business size:** Single shop, single owner, single computer (MacBook Air M5,
15-inch), single user session at a time. No branches, no multi-warehouse-across-
cities, no multi-company.

**Users:**
- **Owner (Santu / family)** — full access, Privacy Mode access, sees buying price
- **Cashier / counter staff** — billing only, never sees buying price by default

---

## 2. POS / BILLING RULES

### 2.1 Core flow
1. Open **"New Bill"**.
2. Add products via: barcode scan / product name search (fuzzy, e.g. "asian 20" finds
   "Asian Paints 20L") / SKU / item code / brand / category.
3. Each line: Product, Qty, Unit, Selling Price, Line Total — all editable inline.
4. Bill-level optional additions: delivery charge, loading charge, transport charge,
   labour charge, round-off, notes.
5. Payment: Cash / UPI / Card / Bank Transfer / Split / Partial / Credit (Udhaar).
6. Print (always the thermal slip — see 2.5) and/or WhatsApp send.
7. Screen resets instantly for the next customer.

### 2.2 Price editing (explicit rule)
> On the billing screen, **Selling Price on every line must be directly editable
> inline** — increase, decrease, or full manual override — without leaving the
> billing screen. This is a normal daily action (hardware retail involves regular
> bargaining), not an admin-only action. It should be exactly as easy as editing
> quantity.

### 2.3 Delivery & extra charges
Delivery Charge, Loading Charge, Transport Charge, Labour Charge — all **optional**,
added only when applicable. Never mandatory fields on the billing screen; must not
slow down a simple walk-in sale.

### 2.4 Speed target
A simple 3-item cash sale should be completable in under 30 seconds from opening
"New Bill" to print.

### 2.5 Print means thermal (explicit rule)
> **Print always prints the thermal slip, never the A4 bill.** Every Print and
> "Save & Print" control — sale bill, estimate, challan, purchase bill, on the
> counter PC and on the Android app alike — goes to the thermal printer with the
> ESC/POS slip. There is no control anywhere that sends A4 to a printer.
>
> The A4 bill exists for exactly two jobs: the PDF sent on WhatsApp (or saved to
> hand over by hand), and the on-screen preview in Invoice Settings. It is a
> document to send, not a thing to print.
>
> Reason: the shop has one 80mm thermal printer at the counter. An A4 page sent
> to it does not come out as a page — it crawls out as metres of wrapped,
> useless roll while a customer waits.
>
> Guarded by `SantuHardwareApp/mobile/test/print_is_always_thermal_test.dart`,
> which fails if a Print control is ever wired to the A4 builder.

---

## 3. PRICING & PRIVACY MODE (Most Important Rule Set)

### 3.1 Visibility table

| Field | Default Visibility | Editable in Bill? | Printed on Invoice? |
|---|---|---|---|
| Selling Price | Always visible | ✅ Yes (increase/decrease/override) | ✅ Yes |
| Buying Price | Hidden — Privacy Mode only | ❌ View only | ❌ Never |
| Margin ₹ / % | Hidden — Privacy Mode only | Auto-calculated | ❌ Never |
| Last Purchase Price | Hidden — Privacy Mode only | View only | ❌ Never |

> **Buying price must never be visible on the billing screen by default**, must
> never be printed on any customer-facing document, and must never be shown to a
> cashier role without Privacy Mode unlocked. This is non-negotiable and applies to
> every print format, every report, every screen without exception.

### 3.2 Privacy Mode mechanics
- Separate password from login (owner-set).
- Unlocking Privacy Mode reveals: buying price, live margin (₹ and %), last purchase
  price, on the current screen only.
- Auto-locks again after idle timeout or when the current bill/screen is closed —
  staff cannot leave it open accidentally.

**Live margin example (Privacy Mode only):**
```
Buying Price   : ₹120
Selling Price  : ₹160
Profit         : ₹40
Margin %       : 25%
```

### 3.3 Price levels
Retail (default), Wholesale, Contractor, Special Customer / Offer / Festival Price.

### 3.4 Price change tracking
Every manual override on a bill line is logged: who changed it, old price, new
price, timestamp. Visible only to the owner via Reports → Price Change Report.
Logging must not add friction to the billing flow itself — it happens silently in
the background.

---

## 4. INVENTORY RULES

### 4.1 Multi-unit support (critical)
Real examples this business needs:
- 1 Box = 20 Pieces (nails, screws)
- 1 Bundle = 10 Pipes
- 1 Packet = 50 Pieces (fasteners)
- 1 Can = 20 Litre (paint)

Billing must allow selling in **any configured unit** with automatic conversion and
correct stock deduction (e.g., sell 3 loose pieces even when stock is tracked in
boxes).

### 4.2 Inventory operations
Purchase Entry, Purchase Return, Sales & Sales Return, Stock Adjustment, Stock
Transfer (rack-to-counter), Damage Entry, Opening/Closing Stock, Physical Stock
Count, Item Ledger (full per-product history), Low Stock Alerts / Reorder Level,
Batch tracking (only where a category genuinely needs it, e.g. paint batches).

### 4.3 Product Master fields
Barcode, QR Code, Product Image, Brand, Category, Sub-category, Unit(s), HSN, GST,
Selling Price, Buying Price, Minimum Selling Price, Maximum Discount %, Reorder
Level, Rack Number, Shelf Number, Bin Location, Supplier(s), Alternative Products,
Notes.

---

## 5. CUSTOMER & SUPPLIER RULES

### 5.1 Customer
Name, Phone, GST (optional), Address, Email (optional), Birthday (optional), Credit
Limit, Outstanding Balance, Purchase History, Last Visit, Favourite Products,
WhatsApp Number.

Customer types: Walk-in, Regular, Contractor, Builder, Electrician, Plumber,
Painter, Wholesale.

### 5.2 Supplier
Supplier details, Purchase History, Pending Bills, Outstanding, GST, Bank Details,
Contact Person, Payment History.

---

## 6. PAYMENTS, EXPENSES & DOCUMENTS

**Payment modes:** Cash, UPI, Card, Cheque, Bank Transfer, Split Payment, Advance
Payment, Credit Sale (Udhaar), Partial Payment, Outstanding Management.

**Daily expenses:** Tea, Transport, Loading/Unloading, Salary, Electricity, Rent,
Internet, Misc — simple daily entry + reports.

**Documents:** Invoice, GST Invoice, Estimate/Quotation, Purchase Order, Delivery
Challan, Credit Note, Debit Note, Receipt, Payment Voucher.

---

## 7. REPORTS THAT DEPEND ON THESE RULES

Any report touching buying price, margin, or profit (Profit Report, Margin Report,
Price Change Report) is **owner-only / Privacy-Mode-gated** — same rule as Section 3
applies to reports, not just the billing screen.
