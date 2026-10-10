/// Mirrors the fields santu_billing.js actually reads/writes (see
/// santu_hardware/santu_hardware/page/santu_billing/santu_billing.js and
/// santu_sale_invoice_api.js). Kept intentionally close to those names so a
/// future sync-with-server layer is a straight field mapping, not a rewrite.
library;

class Item {
  final String itemCode;
  final String itemName;
  final String stockUom;
  final double priceListRate; // base selling price
  final double? costPrice; // shown only when "cost price" toggle is on
  final double availableQty; // stock on hand, shown as "Available: N"
  final String? barcode;

  Item({
    required this.itemCode,
    required this.itemName,
    required this.stockUom,
    required this.priceListRate,
    this.costPrice,
    this.availableQty = 0,
    this.barcode,
  });

  Map<String, Object?> toMap() => {
        'item_code': itemCode,
        'item_name': itemName,
        'stock_uom': stockUom,
        'price_list_rate': priceListRate,
        'cost_price': costPrice,
        'available_qty': availableQty,
        'barcode': barcode,
      };

  factory Item.fromMap(Map<String, Object?> m) => Item(
        itemCode: m['item_code'] as String,
        itemName: m['item_name'] as String,
        stockUom: m['stock_uom'] as String,
        priceListRate: (m['price_list_rate'] as num).toDouble(),
        costPrice: (m['cost_price'] as num?)?.toDouble(),
        availableQty: (m['available_qty'] as num?)?.toDouble() ?? 0,
        barcode: m['barcode'] as String?,
      );
}

class Supplier {
  final String name;
  final String supplierName;
  final String? phone;

  Supplier({required this.name, required this.supplierName, this.phone});

  Map<String, Object?> toMap() => {
        'name': name,
        'supplier_name': supplierName,
        'phone': phone,
      };

  factory Supplier.fromMap(Map<String, Object?> m) => Supplier(
        name: m['name'] as String,
        supplierName: m['supplier_name'] as String,
        phone: m['phone'] as String?,
      );
}

class Customer {
  final String name; // doctype name / id
  final String customerName;
  final String? phone;
  final String? village;

  Customer({
    required this.name,
    required this.customerName,
    this.phone,
    this.village,
  });

  Map<String, Object?> toMap() => {
        'name': name,
        'customer_name': customerName,
        'phone': phone,
        'village': village,
      };

  factory Customer.fromMap(Map<String, Object?> m) => Customer(
        name: m['name'] as String,
        customerName: m['customer_name'] as String,
        phone: m['phone'] as String?,
        village: m['village'] as String?,
      );
}

/// One row in the bill grid — ITEM CODE / ITEM NAME / QTY / UNIT /
/// PRICE-PER-UNIT / DISCOUNT / TOTAL columns from the web screen's table.
class BillItem {
  final String id; // santu_sale_invoice.utils.uid() equivalent
  String itemCode;
  String itemName;
  double qty;
  String uom;
  double rate; // price per unit, after any negotiation
  double discountAmount; // PER UNIT, matches the web screen's convention

  BillItem({
    required this.id,
    required this.itemCode,
    required this.itemName,
    required this.qty,
    required this.uom,
    required this.rate,
    this.discountAmount = 0,
  });

  double get lineTotal => (rate - discountAmount) * qty;

  Map<String, Object?> toMap(String invoiceId) => {
        'id': id,
        'invoice_id': invoiceId,
        'item_code': itemCode,
        'item_name': itemName,
        'qty': qty,
        'uom': uom,
        'rate': rate,
        'discount_amount': discountAmount,
      };

  factory BillItem.fromMap(Map<String, Object?> m) => BillItem(
        id: m['id'] as String,
        itemCode: m['item_code'] as String,
        itemName: m['item_name'] as String,
        qty: (m['qty'] as num).toDouble(),
        uom: m['uom'] as String,
        rate: (m['rate'] as num).toDouble(),
        discountAmount: (m['discount_amount'] as num?)?.toDouble() ?? 0,
      );
}

enum InvoiceStatus { draft, saved }

/// One bill / tab — matches the shape santu_billing.js keeps per tab
/// (localStorage key santu_billing_tabs_v1) and ultimately posts as a Sales
/// Invoice. `billNo` is the human-facing number shown on the tab and print.
class Invoice {
  final String id;
  String? billNo;
  String postingDate;
  String? customer;
  String? customerLabel;
  List<BillItem> items;
  double additionalCharges;
  double billDiscount; // whole-bill discount amount
  String? paymentMode;
  double? amountReceived;
  String? remarks; // "Customer ka note" — the More menu's Remarks field
  String? terms;
  InvoiceStatus status;
  final String createdAt;
  bool updateStock; // false if converted from Delivery Challan (prevents double-decrement)
  double redeemPoints; // reward points redeemed against current bill

  Invoice({
    required this.id,
    this.billNo,
    required this.postingDate,
    this.customer,
    this.customerLabel,
    List<BillItem>? items,
    this.additionalCharges = 0,
    this.billDiscount = 0,
    this.paymentMode,
    this.amountReceived,
    this.remarks,
    this.terms,
    this.status = InvoiceStatus.draft,
    required this.createdAt,
    this.updateStock = true,
    this.redeemPoints = 0,
  }) : items = items ?? [];

  double get subtotal => items.fold(0.0, (s, i) => s + i.lineTotal);
  double get grandTotal => (subtotal + additionalCharges - billDiscount - redeemPoints).clamp(0, double.infinity);
  int get totalQty => items.fold(0, (s, i) => s + i.qty.round());

  double get change {
    final recv = amountReceived ?? 0;
    return recv > grandTotal ? recv - grandTotal : 0;
  }

  double get baaki {
    final recv = amountReceived ?? 0;
    return recv < grandTotal ? grandTotal - recv : 0;
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'bill_no': billNo,
        'posting_date': postingDate,
        'customer': customer,
        'customer_label': customerLabel,
        'additional_charges': additionalCharges,
        'bill_discount': billDiscount,
        'payment_mode': paymentMode,
        'amount_received': amountReceived,
        'remarks': remarks,
        'terms': terms,
        'status': status.name,
        'created_at': createdAt,
        'update_stock': updateStock ? 1 : 0,
        'redeem_points': redeemPoints,
      };

  factory Invoice.fromMap(Map<String, Object?> m, List<BillItem> items) => Invoice(
        id: m['id'] as String,
        billNo: m['bill_no'] as String?,
        postingDate: m['posting_date'] as String,
        customer: m['customer'] as String?,
        customerLabel: m['customer_label'] as String?,
        items: items,
        additionalCharges: (m['additional_charges'] as num?)?.toDouble() ?? 0,
        billDiscount: (m['bill_discount'] as num?)?.toDouble() ?? 0,
        paymentMode: m['payment_mode'] as String?,
        amountReceived: (m['amount_received'] as num?)?.toDouble(),
        remarks: m['remarks'] as String?,
        terms: m['terms'] as String?,
        status: (m['status'] as String?) == 'saved' ? InvoiceStatus.saved : InvoiceStatus.draft,
        createdAt: m['created_at'] as String,
        updateStock: (m['update_stock'] as num?) == null ? true : (m['update_stock'] as num) != 0,
        redeemPoints: (m['redeem_points'] as num?)?.toDouble() ?? 0,
      );
}

/// A generic "quick document" — Estimate (quotation, no stock/payment
/// effect) and Delivery Challan (goods out, stock effect, no payment) share
/// this exact shape in the web app too (party + items + total, no payment
/// rail). One class, one table per doc type, kept apart only so an estimate
/// converting to a bill later doesn't collide with a challan's own numbering.
class QuickDoc {
  final String id;
  String? docNo;
  String postingDate;
  String? party; // customer id
  String? partyLabel;
  List<BillItem> items;
  InvoiceStatus status;
  final String createdAt;

  QuickDoc({
    required this.id,
    this.docNo,
    required this.postingDate,
    this.party,
    this.partyLabel,
    List<BillItem>? items,
    this.status = InvoiceStatus.draft,
    required this.createdAt,
  }) : items = items ?? [];

  double get grandTotal => items.fold(0.0, (s, i) => s + i.lineTotal);
  int get totalQty => items.fold(0, (s, i) => s + i.qty.round());

  Map<String, Object?> toMap() => {
        'id': id,
        'doc_no': docNo,
        'posting_date': postingDate,
        'party': party,
        'party_label': partyLabel,
        'status': status.name,
        'created_at': createdAt,
      };

  factory QuickDoc.fromMap(Map<String, Object?> m, List<BillItem> items) => QuickDoc(
        id: m['id'] as String,
        docNo: m['doc_no'] as String?,
        postingDate: m['posting_date'] as String,
        party: m['party'] as String?,
        partyLabel: m['party_label'] as String?,
        items: items,
        status: (m['status'] as String?) == 'saved' ? InvoiceStatus.saved : InvoiceStatus.draft,
        createdAt: m['created_at'] as String,
      );
}

/// A payment collected AFTER a sale, against a customer's running "baaki"
/// (Invoice.baaki already covers money taken at the time of the bill; this
/// is the Payment Entry screen's job — a later top-up against the same
/// due). Customer Dues = sum of every saved bill's baaki, minus these.
class Payment {
  final String id;
  String customer; // party id — named for the Customer-only history of this table, holds a supplier id too when partyType is Supplier
  String customerLabel;
  double amount;
  String date;
  String? note;
  String partyType; // 'Customer' (Payment In) or 'Supplier' (Payment Out)
  final String createdAt;

  Payment({
    required this.id,
    required this.customer,
    required this.customerLabel,
    required this.amount,
    required this.date,
    this.note,
    this.partyType = 'Customer',
    required this.createdAt,
  });

  Map<String, Object?> toMap() => {
        'id': id,
        'customer': customer,
        'customer_label': customerLabel,
        'amount': amount,
        'date': date,
        'note': note,
        'party_type': partyType,
        'created_at': createdAt,
      };

  factory Payment.fromMap(Map<String, Object?> m) => Payment(
        id: m['id'] as String,
        customer: m['customer'] as String,
        customerLabel: m['customer_label'] as String,
        amount: (m['amount'] as num).toDouble(),
        date: m['date'] as String,
        note: m['note'] as String?,
        partyType: m['party_type'] as String? ?? 'Customer',
        createdAt: m['created_at'] as String,
      );
}

/// A due that isn't backed by any bill — the PC's "+ Baki Jodein" dialog:
/// an opening balance or a side deal, for either a customer or a supplier.
class ManualDue {
  final String id;
  String partyType;
  String party;
  String partyLabel;
  double amount;
  String date;
  String? note;
  final String createdAt;

  ManualDue({
    required this.id,
    required this.partyType,
    required this.party,
    required this.partyLabel,
    required this.amount,
    required this.date,
    this.note,
    required this.createdAt,
  });

  Map<String, Object?> toMap() => {
        'id': id,
        'party_type': partyType,
        'party': party,
        'party_label': partyLabel,
        'amount': amount,
        'date': date,
        'note': note,
        'created_at': createdAt,
      };

  factory ManualDue.fromMap(Map<String, Object?> m) => ManualDue(
        id: m['id'] as String,
        partyType: m['party_type'] as String,
        party: m['party'] as String,
        partyLabel: m['party_label'] as String,
        amount: (m['amount'] as num).toDouble(),
        date: m['date'] as String,
        note: m['note'] as String?,
        createdAt: m['created_at'] as String,
      );
}

/// A shop expense — rent, electricity, labour, etc. Mirrors santu_expense.js
/// scoped to the fields that matter for a running total: what, how much,
/// when, which category.
class Expense {
  final String id;
  String category;
  double amount;
  String date;
  String? note;
  final String createdAt;

  Expense({
    required this.id,
    required this.category,
    required this.amount,
    required this.date,
    this.note,
    required this.createdAt,
  });

  Map<String, Object?> toMap() => {
        'id': id,
        'category': category,
        'amount': amount,
        'date': date,
        'note': note,
        'created_at': createdAt,
      };

  factory Expense.fromMap(Map<String, Object?> m) => Expense(
        id: m['id'] as String,
        category: m['category'] as String,
        amount: (m['amount'] as num).toDouble(),
        date: m['date'] as String,
        note: m['note'] as String?,
        createdAt: m['created_at'] as String,
      );
}

/// One row in a purchase bill — same shape as BillItem but kept separate
/// since purchase rate and sale rate are different concepts even for the
/// same item (mirrors santu_purchase_invoice.js using a distinct row shape
/// from santu_billing.js's).
class PurchaseItem {
  final String id;
  String itemCode;
  String itemName;
  double qty;
  String uom;
  double rate; // cost / purchase price per unit

  PurchaseItem({
    required this.id,
    required this.itemCode,
    required this.itemName,
    required this.qty,
    required this.uom,
    required this.rate,
  });

  double get lineTotal => rate * qty;

  Map<String, Object?> toMap(String invoiceId) => {
        'id': id,
        'invoice_id': invoiceId,
        'item_code': itemCode,
        'item_name': itemName,
        'qty': qty,
        'uom': uom,
        'rate': rate,
      };

  factory PurchaseItem.fromMap(Map<String, Object?> m) => PurchaseItem(
        id: m['id'] as String,
        itemCode: m['item_code'] as String,
        itemName: m['item_name'] as String,
        qty: (m['qty'] as num).toDouble(),
        uom: m['uom'] as String,
        rate: (m['rate'] as num).toDouble(),
      );
}

class PurchaseInvoice {
  final String id;
  String? billNo;
  String postingDate;
  String? supplier;
  String? supplierLabel;
  List<PurchaseItem> items;
  InvoiceStatus status;
  String? billPhotoPath; // "Upload Bill" — a photo of the supplier's paper bill
  final String createdAt;

  PurchaseInvoice({
    required this.id,
    this.billNo,
    required this.postingDate,
    this.supplier,
    this.supplierLabel,
    List<PurchaseItem>? items,
    this.status = InvoiceStatus.draft,
    this.billPhotoPath,
    required this.createdAt,
  }) : items = items ?? [];

  double get grandTotal => items.fold(0.0, (s, i) => s + i.lineTotal);
  int get totalQty => items.fold(0, (s, i) => s + i.qty.round());

  Map<String, Object?> toMap() => {
        'id': id,
        'bill_no': billNo,
        'posting_date': postingDate,
        'supplier': supplier,
        'supplier_label': supplierLabel,
        'status': status.name,
        'bill_photo_path': billPhotoPath,
        'created_at': createdAt,
      };

  factory PurchaseInvoice.fromMap(Map<String, Object?> m, List<PurchaseItem> items) => PurchaseInvoice(
        id: m['id'] as String,
        billNo: m['bill_no'] as String?,
        postingDate: m['posting_date'] as String,
        supplier: m['supplier'] as String?,
        supplierLabel: m['supplier_label'] as String?,
        items: items,
        billPhotoPath: m['bill_photo_path'] as String?,
        status: (m['status'] as String?) == 'saved' ? InvoiceStatus.saved : InvoiceStatus.draft,
        createdAt: m['created_at'] as String,
      );
}

/// Utilities → Item Colour Rules: when an item's name/code matches `value`,
/// that item's row gets `color` (as a pale tint, never the raw hex) on
/// Inventory, Billing and Purchase — mirrors santu_item_highlight.js.
/// Earlier rules in the list win over later ones.
class ItemHighlightRule {
  final String id;
  bool enabled;
  String matchType; // 'Starts With' or 'Contains'
  String value;
  String color; // '#rrggbb'
  int sortOrder;

  ItemHighlightRule({
    required this.id,
    this.enabled = true,
    this.matchType = 'Contains',
    required this.value,
    required this.color,
    this.sortOrder = 0,
  });

  bool matches(String itemCode, String itemName) {
    if (!enabled || value.trim().isEmpty) return false;
    final v = value.toLowerCase();
    final code = itemCode.toLowerCase();
    final name = itemName.toLowerCase();
    if (matchType == 'Starts With') {
      return code.startsWith(v) || name.startsWith(v);
    }
    return code.contains(v) || name.contains(v);
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'enabled': enabled ? 1 : 0,
        'match_type': matchType,
        'value': value,
        'color': color,
        'sort_order': sortOrder,
      };

  factory ItemHighlightRule.fromMap(Map<String, Object?> m) => ItemHighlightRule(
        id: m['id'] as String,
        enabled: (m['enabled'] as num?) != 0,
        matchType: m['match_type'] as String? ?? 'Contains',
        value: m['value'] as String? ?? '',
        color: m['color'] as String? ?? '#f5d90a',
        sortOrder: (m['sort_order'] as num?)?.toInt() ?? 0,
      );
}

/// Splits a search box's text into lowercase words, treating the
/// punctuation item names/codes are full of (- _ [ ] ( ) " ' / ,) as
/// spaces, so "pipe-24" and "pipe 24" search the same.
List<String> searchTokens(String query) => query
    .toLowerCase()
    .replaceAll(RegExp(r'''[-_\[\]()"'/,]+'''), ' ')
    .split(RegExp(r'\s+'))
    .where((t) => t.isNotEmpty)
    .toList();

/// True when every token appears somewhere in any of [fields].
bool matchesAllTokens(List<String> tokens, List<String?> fields) {
  if (tokens.isEmpty) return true;
  final hay = fields.whereType<String>().join(' ').toLowerCase().replaceAll(RegExp(r'''[-_\[\]()"'/,]+'''), ' ');
  return tokens.every(hay.contains);
}
