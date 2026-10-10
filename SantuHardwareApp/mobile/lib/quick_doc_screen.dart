import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import 'db.dart';
import 'models.dart';
import 'prefill_bus.dart';
import 'theme.dart';
import 'thermal_receipt.dart';
import 'transaction_actions.dart';
import 'units.dart';
import 'whatsapp_util.dart';

/// One screen, four modules: Estimate, Delivery Challan, Sales Return and
/// Purchase Return all have the same shape in the web app — party + items
/// + total, no payment rail — differing only in which party type they pick
/// and which way (if any) stock moves. Configuring one widget keeps all
/// four visually and behaviourally identical, which four separate
/// hand-written copies would drift out of over time.
class QuickDocScreen extends StatefulWidget {
  final String kind; // table/counter prefix: estimate | challan | sales_return | purchase_return
  final String title;
  final String partyKind; // 'Customer' or 'Supplier'
  final int stockSign; // -1 goods out, +1 goods in, 0 no stock effect
  final String docPrefix; // bill number prefix, e.g. "EST-"
  final String actionLabel;
  final Color actionColor;
  // Estimate only: items were priced at save time, and the shop's prices
  // move — santu_billing.js's own "Quotation Price Update" modal is what
  // this mirrors (see that file's _show_price_change_modal).
  final bool canConvertToBill;
  // Billing's "Convert to Estimate" / "Convert to Delivery Challan" hand a
  // ready-made doc straight in, the same idea as Estimate's own Convert to
  // Bill — pushed as a fresh screen instead of routed through a bus, since
  // Challan isn't a persistent bottom-nav tab the way Billing/Estimate are.
  final QuickDoc? initialDoc;

  const QuickDocScreen({
    super.key,
    required this.kind,
    required this.title,
    required this.partyKind,
    required this.stockSign,
    required this.docPrefix,
    required this.actionLabel,
    this.actionColor = SantuColors.green,
    this.canConvertToBill = false,
    this.initialDoc,
  });

  @override
  State<QuickDocScreen> createState() => _QuickDocScreenState();
}

class _QuickDocScreenState extends State<QuickDocScreen> {
  final _uuid = const Uuid();
  final _searchCtrl = TextEditingController();
  final _partyCtrl = TextEditingController();

  late QuickDoc _doc;
  List<Item> _searchResults = [];
  List<Customer> _custResults = [];
  List<Supplier> _supResults = [];
  bool _loading = true;
  List<QuickDoc> _recent = [];
  final Map<String, double> _availableStockCache = {};
  Customer? _selectedCustomer;

  bool get _isSupplier => widget.partyKind == 'Supplier';

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final recent = await AppDb.instance.savedQuickDocs(widget.kind);
    if (widget.initialDoc != null) {
      _doc = widget.initialDoc!;
      await _persist();
    } else {
      final drafts = await AppDb.instance.loadDraftQuickDocs(widget.kind);
      _doc = drafts.isNotEmpty ? drafts.first : _blank();
    }
    if (_doc.party != null && !_isSupplier) {
      _selectedCustomer = await AppDb.instance.customerByName(_doc.party!);
    } else if (_doc.partyLabel != null && !_isSupplier) {
      final custs = await AppDb.instance.searchCustomers(_doc.partyLabel!, limit: 1);
      _selectedCustomer = custs.isNotEmpty ? custs.first : null;
    } else {
      _selectedCustomer = null;
    }
    setState(() {
      _recent = recent.take(10).toList();
      _partyCtrl.text = _doc.partyLabel ?? '';
      _loading = false;
    });
    _loadStockCache();
  }

  Future<void> _loadStockCache() async {
    for (final row in _doc.items) {
      if (_availableStockCache.containsKey(row.itemCode)) continue;
      final item = await AppDb.instance.itemByCode(row.itemCode);
      _availableStockCache[row.itemCode] = item?.availableQty ?? 0;
    }
    if (mounted) setState(() {});
  }

  QuickDoc _blank() => QuickDoc(
        id: _uuid.v4(),
        postingDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
        createdAt: DateTime.now().toIso8601String(),
      );

  Future<void> _persist() => AppDb.instance.saveQuickDoc(widget.kind, _doc);

  Future<void> _onSearch(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _searchResults = []);
      return;
    }
    final results = await AppDb.instance.searchItems(q.trim());
    setState(() => _searchResults = results);
  }

  void _addItem(Item item) {
    setState(() {
      final existing = _doc.items.where((r) => r.itemCode == item.itemCode);
      if (existing.isNotEmpty) {
        existing.first.qty += 1;
      } else {
        _doc.items.add(BillItem(id: _uuid.v4(), itemCode: item.itemCode, itemName: item.itemName, qty: 1, uom: item.stockUom, rate: item.priceListRate));
      }
      _availableStockCache[item.itemCode] = item.availableQty;
      _searchResults = [];
      _searchCtrl.clear();
    });
    _persist();
  }

  void _removeItem(BillItem row) {
    setState(() => _doc.items.remove(row));
    _persist();
  }

  Future<void> _editQty(BillItem row) async {
    final ctrl = TextEditingController(text: row.qty.toString());
    final value = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change Quantity'),
        content: TextField(controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text)), child: const Text('OK'))],
      ),
    );
    if (value != null && value > 0) {
      setState(() => row.qty = value);
      _persist();
    }
  }

  Future<void> _onPartySearch(String q) async {
    if (_selectedCustomer != null && _selectedCustomer!.customerName != q) {
      setState(() {
        _selectedCustomer = null;
        _doc.party = null;
        _doc.partyLabel = q.isEmpty ? null : q;
      });
    }
    if (q.trim().isEmpty) {
      setState(() {
        _custResults = [];
        _supResults = [];
      });
      return;
    }
    if (_isSupplier) {
      final r = await AppDb.instance.searchSuppliers(q.trim());
      setState(() => _supResults = r);
    } else {
      final r = await AppDb.instance.searchCustomers(q.trim());
      setState(() => _custResults = r);
    }
  }

  void _pickCustomer(Customer c) {
    setState(() {
      _selectedCustomer = c;
      _doc.party = c.name;
      _doc.partyLabel = c.customerName;
      _partyCtrl.text = c.customerName;
      _custResults = [];
    });
    _persist();
  }

  Future<void> _editRate(BillItem row) async {
    final rateCtrl = TextEditingController(
      text: row.rate == row.rate.roundToDouble() ? row.rate.toInt().toString() : row.rate.toString(),
    );
    final qtyCtrl = TextEditingController(text: _fmtQty(row.qty));
    final discCtrl = TextEditingController(text: row.discountAmount == 0 ? '' : row.discountAmount.toString());
    final nameCtrl = TextEditingController(text: row.itemName);
    String unit = row.uom;
    rateCtrl.selection = TextSelection(baseOffset: 0, extentOffset: rateCtrl.text.length);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Edit Rate: ${row.itemName}', maxLines: 1, overflow: TextOverflow.ellipsis),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Item Name')),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: rateCtrl,
                        autofocus: true,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          labelText: 'Rate (₹ / Unit) *',
                          prefixText: '₹ ',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: qtyCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          labelText: 'Qty',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: discCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Item Discount (per unit, ₹)',
                    prefixText: '₹ ',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: unit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: [for (final u in unitOptionsWith(unit)) DropdownMenuItem(value: u, child: Text(u))],
                  onChanged: (v) => setDialogState(() => unit = v ?? unit),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save Rate')),
          ],
        ),
      ),
    );
    if (saved == true) {
      final rate = double.tryParse(rateCtrl.text.trim());
      final qty = double.tryParse(qtyCtrl.text.trim());
      setState(() {
        if (nameCtrl.text.trim().isNotEmpty) row.itemName = nameCtrl.text.trim();
        if (rate != null && rate >= 0) row.rate = rate;
        if (qty != null && qty > 0) row.qty = qty;
        row.discountAmount = double.tryParse(discCtrl.text.trim()) ?? 0;
        row.uom = unit;
      });
      _persist();
    }
  }

  Future<void> _openNewCustomerDialog({String? initialName}) async {
    final nameCtrl = TextEditingController(text: initialName ?? '');
    final phoneCtrl = TextEditingController();
    final villageCtrl = TextEditingController();

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.person_add, color: SantuColors.blue),
            SizedBox(width: 8),
            Text('Naya Customer Jodein'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                autofocus: (initialName == null || initialName.isEmpty),
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Customer Name *',
                  hintText: 'e.g. Ramesh Kumar',
                  prefixIcon: Icon(Icons.person_outline, size: 20),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: villageCtrl,
                autofocus: (initialName != null && initialName.isNotEmpty),
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Village / Gaon *',
                  hintText: 'e.g. Ishuwapur, Mahuli, Purshauli',
                  prefixIcon: Icon(Icons.location_on_outlined, size: 20, color: SantuColors.blue),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone Number',
                  hintText: 'Mobile number',
                  prefixIcon: Icon(Icons.phone_outlined, size: 20),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (nameCtrl.text.trim().isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Customer ka naam likhna zaroori hai')));
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: const Text('Save & Select'),
          ),
        ],
      ),
    );

    if (saved == true && nameCtrl.text.trim().isNotEmpty) {
      final newCust = Customer(
        name: 'CUST-${_uuid.v4().substring(0, 8)}',
        customerName: nameCtrl.text.trim(),
        phone: phoneCtrl.text.trim().isEmpty ? null : phoneCtrl.text.trim(),
        village: villageCtrl.text.trim().isEmpty ? null : villageCtrl.text.trim(),
      );
      await AppDb.instance.upsertCustomers([newCust]);
      _pickCustomer(newCust);
    }
  }

  Future<void> _openEditCustomerVillageDialog(Customer c) async {
    final villageCtrl = TextEditingController(text: c.village ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${c.customerName} ka Gaon'),
        content: TextField(
          controller: villageCtrl,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Village / Gaon',
            prefixIcon: Icon(Icons.location_on_outlined, color: SantuColors.blue),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved == true) {
      final updated = Customer(
        name: c.name,
        customerName: c.customerName,
        phone: (c.phone == null || c.phone!.isEmpty) ? null : c.phone,
        village: villageCtrl.text.trim().isEmpty ? null : villageCtrl.text.trim(),
      );
      await AppDb.instance.upsertCustomers([updated]);
      _pickCustomer(updated);
    }
  }

  void _pickSupplier(Supplier s) {
    setState(() {
      _doc.party = s.name;
      _doc.partyLabel = s.supplierName;
      _partyCtrl.text = s.supplierName;
      _supResults = [];
    });
    _persist();
  }

  Future<void> _save({bool print = false, bool whatsapp = false, String? otherPhone, String? otherName}) async {
    if (_doc.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${widget.title} mein koi item nahi hai')));
      return;
    }
    final wasSaved = _doc.status == InvoiceStatus.saved;
    _doc.status = InvoiceStatus.saved;
    _doc.docNo ??= '${widget.docPrefix}${await AppDb.instance.nextQuickDocNo(widget.kind)}';
    await _persist();
    if (!wasSaved && widget.stockSign != 0) {
      final deltas = <String, double>{};
      for (final row in _doc.items) {
        deltas[row.itemCode] = (deltas[row.itemCode] ?? 0) + row.qty * widget.stockSign;
      }
      await AppDb.instance.adjustItemStock(deltas);
    }
    if (!mounted) return;
    if (print) {
      String? err;
      if (widget.kind == 'estimate') {
        err = await ThermalReceipt.printEstimate(_doc);
      } else {
        err = await ThermalReceipt.printQuickDoc(_doc, widget.title);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err ?? 'Printed ✓')));
    } else if (whatsapp || otherPhone != null) {
      final templates = await AppDb.instance.listMessageTemplates();
      final template = templates[widget.title] ?? 'Namaste {party}, aapka ${widget.title} {doc_no} ₹{amount} ka taiyaar hai.';
      final partyName = otherName ?? _doc.partyLabel ?? widget.partyKind;
      final msg = fillTemplate(template, {
        'party': partyName,
        'doc_no': _doc.docNo ?? '',
        'amount': _doc.grandTotal.toStringAsFixed(2),
      });
      if (!mounted) return;
      await shareViaWhatsApp(
        context,
        phone: otherPhone,
        message: msg,
        docType: widget.title,
        docNo: _doc.docNo,
        partyLabel: partyName,
      );
    } else {
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('${widget.title} saved'),
          content: Text('No: ${_doc.docNo}\n${widget.partyKind}: ${_doc.partyLabel ?? "-"}\nTotal: ₹${_doc.grandTotal.toStringAsFixed(2)}'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
    }
    setState(() {
      _doc = _blank();
      _partyCtrl.clear();
    });
    _init();
  }

  /// "Stock chadhaiye" modal — tap Available on the row to receive stock on the shelf inline (santu_add_stock_inline.js).
  Future<void> _openStockModal(BillItem row) async {
    final curStock = _availableStockCache[row.itemCode] ?? 0;
    final qtyCtrl = TextEditingController();
    final rateCtrl = TextEditingController();
    final result = await showDialog<Map<String, double>?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Stock chadhaiye', style: TextStyle(fontWeight: FontWeight.bold)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(row.itemName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              const SizedBox(height: 4),
              Text('Abhi stock: ${curStock.toStringAsFixed(0)} ${row.uom}', style: const TextStyle(color: SantuColors.textMuted, fontSize: 13)),
              const SizedBox(height: 16),
              TextField(
                controller: qtyCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Kitna maal aaya? *',
                  helperText: 'Jitna aaya utna likhiye — purane me jud jayega',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: rateCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Naya purchase rate (optional)',
                  helperText: 'Khaali chhod dijiye to purana rate wahi rahega',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final q = double.tryParse(qtyCtrl.text.trim());
              if (q == null || q <= 0) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Qty zero se zyada honi chahiye')));
                return;
              }
              final r = double.tryParse(rateCtrl.text.trim());
              Navigator.pop(ctx, {'qty': q, if (r != null && r > 0) 'rate': r});
            },
            child: const Text('Stock chadhao'),
          ),
        ],
      ),
    );

    if (result != null && mounted) {
      final q = result['qty']!;
      final r = result['rate'];
      final newQty = await AppDb.instance.receiveStockSimple(row.itemCode, q, purchaseRate: r);
      setState(() {
        _availableStockCache[row.itemCode] = newQty;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: SantuColors.green,
            content: Text('✅ Stock chadh gaya (+${q.toStringAsFixed(0)} ${row.uom}) — Abhi: ${newQty.toStringAsFixed(0)} ${row.uom}'),
          ),
        );
      }
    }
  }

  /// Row green tick ✓: push edited rate and unit back to item master (santu_tick_to_master.js).
  Future<void> _saveRowToMaster(BillItem row) async {
    final item = await AppDb.instance.itemByCode(row.itemCode);
    final stockUom = item?.stockUom ?? row.uom;
    final unitChanging = row.uom != stockUom;

    if (!mounted) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(row.itemName),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Selling price: ₹${row.rate.toStringAsFixed(2)} (har ${row.uom} ka)', style: const TextStyle(fontWeight: FontWeight.w600)),
            if (unitChanging) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFFFFF3CD), borderRadius: BorderRadius.circular(6)),
                child: Text('Unit badlega: $stockUom se ${row.uom}\nStock ka number wahi rahega, sirf unit badlega.', style: const TextStyle(fontSize: 12)),
              ),
            ],
            const SizedBox(height: 14),
            const Text('Item catalog me save kar dein?'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Haan, Save Karo')),
        ],
      ),
    );

    if (confirm == true) {
      await AppDb.instance.updateItemMaster(row.itemCode, rate: row.rate, uom: row.uom, name: row.itemName);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(backgroundColor: SantuColors.green, content: Text('✅ Item catalog me rate aur unit save ho gaya')),
        );
      }
    }
  }

  /// ↗ Kisi aur ko: share/send doc via WhatsApp to custom phone number.
  Future<void> _shareWithOther() async {
    if (_doc.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${widget.title} mein koi item nahi hai')));
      return;
    }
    final phoneCtrl = TextEditingController();
    final nameCtrl = TextEditingController();
    final submit = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kisi aur ko bhejein (WhatsApp)'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: phoneCtrl,
              keyboardType: TextInputType.phone,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Kis number par bhejna hai (WhatsApp) *',
                hintText: '10 digit mobile number',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Naam (optional)',
                hintText: 'Khaali chhoda to sirf number dikhega',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (phoneCtrl.text.trim().replaceAll(RegExp(r'\D'), '').length < 10) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Valid 10 digit number daalein')));
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: const Text('Bhejein'),
          ),
        ],
      ),
    );

    if (submit == true && mounted) {
      final phone = phoneCtrl.text.trim().replaceAll(RegExp(r'\D'), '');
      final name = nameCtrl.text.trim().isNotEmpty ? nameCtrl.text.trim() : widget.partyKind;
      await _save(otherPhone: phone, otherName: name);
    }
  }

  void _convertDocToBill(QuickDoc d) {
    setState(() {
      _doc = d;
      _partyCtrl.text = d.partyLabel ?? '';
    });
    _convertToBill();
  }

  /// Estimate → Bill. Checks every line's price against what the item sells
  /// for today; if any moved, asks once — "Keep Estimate Price" or "Use
  /// Today's Price" — for every changed line together, same choice
  /// santu_billing.js's own modal offers (it doesn't let you pick line by
  /// line either). Saves the estimate as saved first (so it's not lost if
  /// the bill is abandoned), then hands the items to Billing via PrefillBus.
  Future<void> _convertToBill() async {
    if (_doc.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estimate mein koi item nahi hai')));
      return;
    }
    final changed = <({BillItem row, double todayRate})>[];
    for (final row in _doc.items) {
      final item = await AppDb.instance.itemByCode(row.itemCode);
      if (item != null && (item.priceListRate - row.rate).abs() > 0.009) {
        changed.add((row: row, todayRate: item.priceListRate));
      }
    }

    bool useTodayPrice = false;
    if (changed.isNotEmpty && mounted) {
      final choice = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Quotation Price Update'),
          content: SizedBox(
            width: 320,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Ye items ka aaj ka rate estimate se alag hai. Bill mein kaunsa rate use karein?', style: TextStyle(color: SantuColors.textMuted)),
                const SizedBox(height: 10),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 260),
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        for (final c in changed)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c.row.itemName, style: const TextStyle(fontWeight: FontWeight.w600)),
                                Row(
                                  children: [
                                    Expanded(child: Text('Estimate: ₹${c.row.rate.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12))),
                                    Expanded(
                                      child: Text(
                                        'Today: ₹${c.todayRate.toStringAsFixed(2)}',
                                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c.todayRate > c.row.rate ? SantuColors.red : SantuColors.green),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep Estimate Price')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Use Today's Price")),
          ],
        ),
      );
      if (choice == null) return; // dialog dismissed — don't convert
      useTodayPrice = choice;
    }

    if (!mounted) return;
    final wasSaved = _doc.status == InvoiceStatus.saved;
    _doc.status = InvoiceStatus.saved;
    _doc.docNo ??= '${widget.docPrefix}${await AppDb.instance.nextQuickDocNo(widget.kind)}';
    await _persist();
    if (!wasSaved) _init();

    final changedByCode = {for (final c in changed) c.row.itemCode: c.todayRate};
    final bill = Invoice(
      id: const Uuid().v4(),
      postingDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
      customer: _doc.party,
      customerLabel: _doc.partyLabel,
      createdAt: DateTime.now().toIso8601String(),
      updateStock: widget.stockSign == 0,
      items: [
        for (final row in _doc.items)
          BillItem(
            id: const Uuid().v4(),
            itemCode: row.itemCode,
            itemName: row.itemName,
            qty: row.qty,
            uom: row.uom,
            rate: useTodayPrice && changedByCode.containsKey(row.itemCode) ? changedByCode[row.itemCode]! : row.rate,
          ),
      ],
    );
    PrefillBus.send(bill);
    if (!mounted) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  void _incQty(BillItem row) {
    setState(() => row.qty += 1);
    _persist();
  }

  void _decQty(BillItem row) {
    if (row.qty > 1) {
      setState(() => row.qty -= 1);
      _persist();
    } else {
      _removeItem(row);
    }
  }

  void _showRecentModal() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Recent ${widget.title}s', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    IconButton(icon: const Icon(Icons.close, size: 20), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _recent.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (ctx, i) {
                    final d = _recent[i];
                    return ListTile(
                      title: Text(d.docNo ?? '-'),
                      subtitle: Text('${d.partyLabel ?? '-'} · ${d.postingDate}'),
                      trailing: Text('₹${d.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      onTap: () {
                        Navigator.pop(ctx);
                        setState(() {
                          _doc = d;
                          _partyCtrl.text = d.partyLabel ?? '';
                        });
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return Scaffold(appBar: AppBar(title: Text(widget.title)), body: const Center(child: CircularProgressIndicator()));
    final narrow = MediaQuery.of(context).size.width < 700;
    return Scaffold(
      resizeToAvoidBottomInset: false,
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (_recent.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.history),
              tooltip: 'Recent ${widget.title}s',
              onPressed: _showRecentModal,
            ),
        ],
      ),
      body: narrow
          ? _buildMobileLayout()
          : Padding(
              padding: const EdgeInsets.all(12),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: _left()), const SizedBox(width: 12), SizedBox(width: 320, child: _right())]),
            ),
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      children: [
        _buildMobileTopBar(),
        _buildMobilePartyBar(),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
          child: TextField(
            controller: _searchCtrl,
            onChanged: _onSearch,
            decoration: InputDecoration(
              hintText: 'Search item name, code...',
              hintStyle: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
              prefixIcon: const Icon(Icons.search, color: SantuColors.blue, size: 18),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 16),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _searchResults = []);
                      },
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              isDense: true,
            ),
          ),
        ),
        if (_searchResults.isNotEmpty)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: SantuColors.card,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: SantuColors.border),
              boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 3))],
            ),
            constraints: const BoxConstraints(maxHeight: 240),
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _searchResults.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final item = _searchResults[i];
                return ListTile(
                  dense: true,
                  title: Text(item.itemName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  subtitle: Text('${item.itemCode} · Stock: ${_fmtQty(item.availableQty)} ${item.stockUom}', style: const TextStyle(fontSize: 11)),
                  trailing: Text('₹${item.priceListRate.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: SantuColors.blue)),
                  onTap: () {
                    _addItem(item);
                    _searchCtrl.clear();
                    setState(() => _searchResults = []);
                  },
                );
              },
            ),
          ),
        Expanded(
          child: _doc.items.isEmpty
              ? _buildMobileEmptyCart()
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  itemCount: _doc.items.length,
                  itemBuilder: (ctx, i) => _buildMobileItemCard(i, _doc.items[i]),
                ),
        ),
        _buildMobileStickyCheckoutBar(),
      ],
    );
  }

  Widget _buildMobileTopBar() {
    final dateStr = DateFormat('dd MMM').format(DateTime.tryParse(_doc.postingDate) ?? DateTime.now());
    return Container(
      color: SantuColors.card,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Text(
                _doc.docNo ?? widget.title,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: SantuColors.textDark),
              ),
              if (_doc.status == InvoiceStatus.saved) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(4)),
                  child: const Text('Saved ✓', style: TextStyle(color: Color(0xFF15803D), fontSize: 10, fontWeight: FontWeight.bold)),
                ),
              ],
            ],
          ),
          InkWell(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(_doc.postingDate) ?? DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null) {
                setState(() => _doc.postingDate = DateFormat('yyyy-MM-dd').format(picked));
                _persist();
              }
            },
            borderRadius: BorderRadius.circular(6),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.calendar_today_outlined, size: 11, color: SantuColors.textMuted),
                  const SizedBox(width: 4),
                  Text(dateStr, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: SantuColors.textDark)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobilePartyBar() {
    if (!_isSupplier && _selectedCustomer != null) {
      return Container(
        margin: const EdgeInsets.fromLTRB(12, 4, 12, 2),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFEFF6FF),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
        ),
        child: Row(
          children: [
            const Icon(Icons.person, size: 16, color: SantuColors.blue),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_selectedCustomer!.customerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1E3A8A))),
                  Row(
                    children: [
                      if (_selectedCustomer!.village != null && _selectedCustomer!.village!.isNotEmpty) ...[
                        const Icon(Icons.location_on, size: 11, color: SantuColors.blue),
                        const SizedBox(width: 1),
                        Text(_selectedCustomer!.village!, style: const TextStyle(fontSize: 10, color: SantuColors.blue, fontWeight: FontWeight.w600)),
                        if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty) const Text('  ·  ', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                      ],
                      if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty)
                        Text(_selectedCustomer!.phone!, style: const TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                    ],
                  ),
                ],
              ),
            ),
            InkWell(
              onTap: () {
                setState(() {
                  _selectedCustomer = null;
                  _doc.party = null;
                  _doc.partyLabel = null;
                  _partyCtrl.clear();
                });
                _persist();
              },
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(Icons.close, size: 16, color: SantuColors.textMuted),
              ),
            ),
          ],
        ),
      );
    } else if (_isSupplier && _doc.partyLabel != null && _doc.partyLabel!.isNotEmpty) {
      return Container(
        margin: const EdgeInsets.fromLTRB(12, 4, 12, 2),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFEFF6FF),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
        ),
        child: Row(
          children: [
            const Icon(Icons.store, size: 16, color: SantuColors.blue),
            const SizedBox(width: 6),
            Expanded(
              child: Text(_doc.partyLabel!, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1E3A8A))),
            ),
            InkWell(
              onTap: () {
                setState(() {
                  _doc.party = null;
                  _doc.partyLabel = null;
                  _partyCtrl.clear();
                });
                _persist();
              },
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(Icons.close, size: 16, color: SantuColors.textMuted),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      child: Column(
        children: [
          TextField(
            controller: _partyCtrl,
            onChanged: _onPartySearch,
            decoration: InputDecoration(
              hintText: _isSupplier ? 'Supplier name...' : 'Customer name, phone, village...',
              hintStyle: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
              prefixIcon: Icon(_isSupplier ? Icons.store_outlined : Icons.person_search_outlined, size: 18, color: SantuColors.textMuted),
              suffixIcon: !_isSupplier
                  ? IconButton(
                      icon: const Icon(Icons.person_add_alt_1, color: SantuColors.blue, size: 18),
                      tooltip: 'Naya Customer',
                      onPressed: () => _openNewCustomerDialog(initialName: _partyCtrl.text.trim()),
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              isDense: true,
            ),
          ),
          if (_custResults.isNotEmpty || _supResults.isNotEmpty || (!_isSupplier && _partyCtrl.text.trim().isNotEmpty && _selectedCustomer == null))
            Container(
              margin: const EdgeInsets.only(top: 4),
              decoration: BoxDecoration(
                color: SantuColors.card,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: SantuColors.border),
                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))],
              ),
              constraints: const BoxConstraints(maxHeight: 200),
              child: ListView(
                shrinkWrap: true,
                children: _isSupplier
                    ? [
                        for (final s in _supResults)
                          ListTile(
                            dense: true,
                            leading: const CircleAvatar(
                              radius: 12,
                              backgroundColor: Color(0xFFE2E8F0),
                              child: Icon(Icons.store, size: 14, color: SantuColors.blue),
                            ),
                            title: Text(s.supplierName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                            subtitle: s.phone != null ? Text(s.phone!, style: const TextStyle(fontSize: 10)) : null,
                            onTap: () => _pickSupplier(s),
                          ),
                      ]
                    : [
                        for (final c in _custResults)
                          ListTile(
                            dense: true,
                            leading: const CircleAvatar(
                              radius: 12,
                              backgroundColor: Color(0xFFE2E8F0),
                              child: Icon(Icons.person, size: 14, color: SantuColors.blue),
                            ),
                            title: Text(c.customerName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                            subtitle: Row(
                              children: [
                                if (c.village != null && (c.village ?? '').isNotEmpty) ...[
                                  const Icon(Icons.location_on, size: 11, color: SantuColors.blue),
                                  const SizedBox(width: 1),
                                  Text(c.village!, style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600, fontSize: 10)),
                                  if (c.phone != null && (c.phone ?? '').isNotEmpty) const Text(' · ', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                                ],
                                if (c.phone != null && (c.phone ?? '').isNotEmpty)
                                  Text(c.phone!, style: const TextStyle(color: SantuColors.textMuted, fontSize: 10)),
                              ],
                            ),
                            onTap: () => _pickCustomer(c),
                          ),
                        if (_partyCtrl.text.trim().isNotEmpty)
                          ListTile(
                            dense: true,
                            leading: const CircleAvatar(
                              radius: 12,
                              backgroundColor: Color(0xFFDBEAFE),
                              child: Icon(Icons.person_add, size: 14, color: SantuColors.blue),
                            ),
                            title: Text(
                              '+ "${_partyCtrl.text.trim()}" naya customer jodein',
                              style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.bold, fontSize: 12),
                            ),
                            onTap: () => _openNewCustomerDialog(initialName: _partyCtrl.text.trim()),
                          ),
                      ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMobileEmptyCart() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Color(0xFFF1F5F9),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.description_outlined, size: 36, color: SantuColors.textMuted),
          ),
          const SizedBox(height: 10),
          Text('${widget.title} khali hai', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: SantuColors.textDark)),
          const SizedBox(height: 2),
          const Text('Upar search bar se saman add karein', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildMobileItemCard(int index, BillItem row) {
    final avail = _availableStockCache[row.itemCode] ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: SantuColors.card,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: SantuColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row.itemName,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: SantuColors.textDark),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Wrap(
                      spacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(row.itemCode, style: const TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                        InkWell(
                          onTap: () => _openStockModal(row),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text('Stock: ${_fmtQty(avail)} ${row.uom}', style: const TextStyle(fontSize: 10, color: SantuColors.blue, fontWeight: FontWeight.w500)),
                                const SizedBox(width: 2),
                                const Icon(Icons.add_circle_outline, size: 10, color: SantuColors.blue),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(Icons.close, size: 18, color: SantuColors.textMuted),
                onPressed: () => _removeItem(row),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: SantuColors.border),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    InkWell(
                      onTap: () => _decQty(row),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        child: Icon(Icons.remove, size: 14, color: SantuColors.textDark),
                      ),
                    ),
                    InkWell(
                      onTap: () => _editQty(row),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        color: const Color(0xFFF8FAFC),
                        child: Text(
                          _fmtQty(row.qty),
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: () => _incQty(row),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        child: Icon(Icons.add, size: 14, color: SantuColors.textDark),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              Text(row.uom, style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
              const Spacer(),
              InkWell(
                onTap: () => _editRate(row),
                borderRadius: BorderRadius.circular(6),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '@ ₹${row.rate == row.rate.roundToDouble() ? row.rate.toInt() : row.rate.toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: SantuColors.blue),
                      ),
                      const SizedBox(width: 2),
                      const Icon(Icons.edit_outlined, size: 11, color: SantuColors.blue),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 6),
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(Icons.check_circle_outline, size: 18, color: SantuColors.green),
                tooltip: 'Master rate update',
                onPressed: () => _saveRowToMaster(row),
              ),
              const SizedBox(width: 8),
              Text(
                '₹${row.lineTotal.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: SantuColors.textDark),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMobileStickyCheckoutBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: SantuColors.card,
        border: const Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 1)),
        boxShadow: const [BoxShadow(color: Color(0x0A000000), blurRadius: 6, offset: Offset(0, -2))],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Total Amount', style: TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                    Text(
                      '₹ ${_doc.grandTotal.toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: SantuColors.textDark),
                    ),
                  ],
                ),
                const SizedBox(width: 10),
                Text(
                  '${_doc.items.length} items (${_doc.totalQty})',
                  style: const TextStyle(fontSize: 11, color: SantuColors.textMuted),
                ),
                const Spacer(),
                if (widget.canConvertToBill)
                  FilledButton.tonalIcon(
                    onPressed: _convertToBill,
                    icon: const Icon(Icons.point_of_sale, size: 14),
                    label: const Text('Convert Bill', style: TextStyle(fontSize: 11)),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                OutlinedButton(
                  onPressed: () => _save(whatsapp: true),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.share, size: 16, color: Color(0xFF25D366)),
                      SizedBox(width: 4),
                      Text('WA', style: TextStyle(color: Color(0xFF25D366), fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                OutlinedButton(
                  onPressed: () => _save(),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: Text(widget.actionLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _save(print: true),
                    icon: const Icon(Icons.print, size: 16),
                    label: const Text('Save & Print', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    style: FilledButton.styleFrom(
                      backgroundColor: widget.actionColor,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _left() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _searchCtrl,
        onChanged: _onSearch,
        decoration: InputDecoration(
          hintText: 'Search item to add',
          prefixIcon: const Icon(Icons.search, color: SantuColors.blueLight),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blueLight, width: 2)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blue, width: 2)),
        ),
      ),
      if (_searchResults.isNotEmpty)
        Container(
          margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(color: SantuColors.card, borderRadius: BorderRadius.circular(8), border: Border.all(color: SantuColors.border)),
          constraints: const BoxConstraints(maxHeight: 260),
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: _searchResults.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (ctx, i) {
              final item = _searchResults[i];
              return ListTile(dense: true, title: Text(item.itemName), subtitle: Text(item.itemCode), trailing: Text('₹${item.priceListRate.toStringAsFixed(2)}'), onTap: () => _addItem(item));
            },
          ),
        ),
      const SizedBox(height: 12),
      Container(
        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
        child: Column(children: [
          Container(
            color: const Color(0xFFF8FAFC),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
            child: const Row(children: [
              SizedBox(width: 20, child: Text('#', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted))),
              Expanded(flex: 3, child: Text('ITEM', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted))),
              SizedBox(width: 40, child: Text('QTY', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 52, child: Text('RATE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 56, child: Text('TOTAL', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 26),
              SizedBox(width: 26),
            ]),
          ),
          if (_doc.items.isEmpty)
            const Padding(padding: EdgeInsets.all(28), child: Text('Koi item nahi — upar search karke add karo', style: TextStyle(color: SantuColors.textMuted)))
          else
            for (int i = 0; i < _doc.items.length; i++)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFF1F5F9)))),
                child: Row(children: [
                  SizedBox(width: 20, child: Text('${i + 1}', style: const TextStyle(fontSize: 12))),
                  Expanded(
                    flex: 3,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_doc.items[i].itemName, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500), maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 2),
                        InkWell(
                          onTap: () => _openStockModal(_doc.items[i]),
                          child: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  'Available: ${_fmtQty(_availableStockCache[_doc.items[i].itemCode] ?? 0)} ${_doc.items[i].uom}',
                                  style: const TextStyle(fontSize: 10, color: SantuColors.blue, decoration: TextDecoration.underline),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 2),
                              const Icon(Icons.add_circle_outline, size: 10, color: SantuColors.blue),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    width: 40,
                    child: InkWell(
                      onTap: () => _editQty(_doc.items[i]),
                      child: Text('${_fmtQty(_doc.items[i].qty)} ${_doc.items[i].uom}', style: const TextStyle(fontSize: 10), textAlign: TextAlign.right),
                    ),
                  ),
                  SizedBox(
                    width: 52,
                    child: InkWell(
                      onTap: () => _editRate(_doc.items[i]),
                      borderRadius: BorderRadius.circular(4),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFFCBD5E1), width: 0.8),
                        ),
                        child: Text(
                          _doc.items[i].rate == _doc.items[i].rate.roundToDouble()
                              ? _doc.items[i].rate.toInt().toString()
                              : _doc.items[i].rate.toStringAsFixed(2),
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: SantuColors.blue),
                          textAlign: TextAlign.right,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(width: 56, child: Text(_doc.items[i].lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), textAlign: TextAlign.right)),
                  SizedBox(
                    width: 26,
                    child: IconButton(
                      padding: EdgeInsets.zero,
                      icon: const Icon(Icons.check, size: 18, color: SantuColors.green),
                      tooltip: 'Is row ka rate aur unit item me save karein',
                      onPressed: () => _saveRowToMaster(_doc.items[i]),
                    ),
                  ),
                  SizedBox(
                    width: 26,
                    child: IconButton(
                      padding: EdgeInsets.zero,
                      icon: const Icon(Icons.close, size: 16, color: SantuColors.textFaint),
                      onPressed: () => _removeItem(_doc.items[i]),
                    ),
                  ),
                ]),
              ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: const BoxDecoration(color: Color(0xFFF8FAFC)),
            alignment: Alignment.centerRight,
            child: Text('₹ ${_doc.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
        ]),
      ),
      if (_recent.isNotEmpty) ...[
        const SizedBox(height: 18),
        Text('Recent ${widget.title}s', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
          child: Column(children: [
            for (final d in _recent)
              ListTile(
                dense: true,
                title: Text(d.docNo ?? '-'),
                subtitle: Text('${d.partyLabel ?? '-'} · Open'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('₹${d.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (widget.canConvertToBill)
                      TextButton(onPressed: () => _convertDocToBill(d), child: Text(widget.kind == 'challan' ? 'Bill Banao' : 'Bill', style: const TextStyle(fontSize: 11))),
                    IconButton(
                      icon: const Icon(Icons.more_vert, size: 18),
                      onPressed: () => TransactionActions.showQuickDocMenu(
                        context,
                        doc: d,
                        kind: widget.kind,
                        titleLabel: widget.title,
                        canConvert: widget.canConvertToBill,
                        onOpen: () => setState(() {
                          _doc = d;
                          _partyCtrl.text = d.partyLabel ?? '';
                        }),
                        onConvertToBill: () {
                          setState(() {
                            _doc = d;
                            _partyCtrl.text = d.partyLabel ?? '';
                          });
                          _convertToBill();
                        },
                        onDelete: () async {
                          await AppDb.instance.deleteQuickDoc(widget.kind, d.id);
                          _init();
                        },
                      ),
                    ),
                  ],
                ),
              ),
          ]),
        ),
      ],
    ]);
  }

  String _fmtQty(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  Widget _right() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        decoration: const InputDecoration(labelText: 'Date'),
        controller: TextEditingController(text: _doc.postingDate),
        readOnly: true,
        onTap: () async {
          final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(_doc.postingDate) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
          if (picked != null) {
            setState(() => _doc.postingDate = DateFormat('yyyy-MM-dd').format(picked));
            _persist();
          }
        },
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _partyCtrl,
        onChanged: _onPartySearch,
        decoration: InputDecoration(
          labelText: widget.partyKind,
          hintText: _isSupplier ? 'Search by name, phone' : 'Search by name, phone, village',
          prefixIcon: Icon(_isSupplier ? Icons.store_outlined : Icons.person_search_outlined, size: 20),
          suffixIcon: !_isSupplier
              ? IconButton(
                  icon: const Icon(Icons.person_add_alt_1, color: SantuColors.blue, size: 20),
                  tooltip: 'Naya Customer Jodein',
                  onPressed: () => _openNewCustomerDialog(initialName: _partyCtrl.text.trim()),
                )
              : null,
        ),
      ),
      if (_custResults.isNotEmpty || _supResults.isNotEmpty || (!_isSupplier && _partyCtrl.text.trim().isNotEmpty && _selectedCustomer == null))
        Container(
          margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(
            color: SantuColors.card,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: SantuColors.border),
            boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))],
          ),
          constraints: const BoxConstraints(maxHeight: 240),
          child: ListView(
            shrinkWrap: true,
            children: _isSupplier
                ? [
                    for (final s in _supResults)
                      ListTile(
                        dense: true,
                        leading: const CircleAvatar(
                          radius: 14,
                          backgroundColor: Color(0xFFE2E8F0),
                          child: Icon(Icons.store, size: 16, color: SantuColors.blue),
                        ),
                        title: Text(s.supplierName),
                        subtitle: s.phone != null ? Text(s.phone!) : null,
                        onTap: () => _pickSupplier(s),
                      )
                  ]
                : [
                    for (final c in _custResults)
                      ListTile(
                        dense: true,
                        leading: const CircleAvatar(
                          radius: 14,
                          backgroundColor: Color(0xFFE2E8F0),
                          child: Icon(Icons.person, size: 16, color: SantuColors.blue),
                        ),
                        title: Text(c.customerName, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Row(
                          children: [
                            if (c.village != null && c.village!.isNotEmpty) ...[
                              const Icon(Icons.location_on, size: 12, color: SantuColors.blue),
                              const SizedBox(width: 2),
                              Text(c.village!, style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600, fontSize: 11)),
                              if (c.phone != null && c.phone!.isNotEmpty) const Text('  ·  ', style: TextStyle(color: SantuColors.textMuted, fontSize: 11)),
                            ],
                            if (c.phone != null && c.phone!.isNotEmpty) ...[
                              const Icon(Icons.phone, size: 11, color: SantuColors.textMuted),
                              const SizedBox(width: 2),
                              Text(c.phone!, style: const TextStyle(color: SantuColors.textMuted, fontSize: 11)),
                            ],
                            if ((c.village == null || c.village!.isEmpty) && (c.phone == null || c.phone!.isEmpty))
                              const Text('No phone/village', style: TextStyle(color: SantuColors.textFaint, fontSize: 10)),
                          ],
                        ),
                        onTap: () => _pickCustomer(c),
                      ),
                    if (_partyCtrl.text.trim().isNotEmpty)
                      ListTile(
                        dense: true,
                        leading: const CircleAvatar(
                          radius: 14,
                          backgroundColor: Color(0xFFDBEAFE),
                          child: Icon(Icons.person_add, size: 16, color: SantuColors.blue),
                        ),
                        title: Text(
                          '+ "${_partyCtrl.text.trim()}" ko Naya Customer banayein',
                          style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        subtitle: const Text('Tap karke Gaon aur Phone number darj karein', style: TextStyle(fontSize: 11)),
                        onTap: () => _openNewCustomerDialog(initialName: _partyCtrl.text.trim()),
                      ),
                  ],
          ),
        ),
      if (!_isSupplier && _selectedCustomer != null)
        Container(
          margin: const EdgeInsets.only(top: 6),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFFBFDBFE)),
          ),
          child: Row(
            children: [
              const Icon(Icons.check_circle, size: 18, color: SantuColors.blue),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _selectedCustomer!.customerName,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1E3A8A)),
                    ),
                    const SizedBox(height: 2),
                    Wrap(
                      spacing: 8,
                      children: [
                        if (_selectedCustomer!.village != null && _selectedCustomer!.village!.isNotEmpty)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.location_on, size: 12, color: SantuColors.blue),
                              const SizedBox(width: 2),
                              Text(
                                _selectedCustomer!.village!,
                                style: const TextStyle(fontSize: 11, color: SantuColors.blue, fontWeight: FontWeight.w600),
                              ),
                            ],
                          )
                        else
                          InkWell(
                            onTap: () => _openEditCustomerVillageDialog(_selectedCustomer!),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.add_location_alt_outlined, size: 12, color: Colors.orange),
                                SizedBox(width: 2),
                                Text(
                                  '+ Gaon jodein',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Colors.orange,
                                    fontWeight: FontWeight.w600,
                                    decoration: TextDecoration.underline,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.phone, size: 12, color: SantuColors.textMuted),
                              const SizedBox(width: 2),
                              Text(_selectedCustomer!.phone!, style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                            ],
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 16, color: SantuColors.textMuted),
                tooltip: 'Customer hatayein',
                onPressed: () {
                  setState(() {
                    _selectedCustomer = null;
                    _doc.party = null;
                    _doc.partyLabel = null;
                    _partyCtrl.clear();
                  });
                  _persist();
                },
              ),
            ],
          ),
        ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Total ₹ ${_doc.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          Text('Items: ${_doc.items.length}, Quantity: ${_doc.totalQty}', style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
          if (widget.stockSign != 0) Text(widget.stockSign > 0 ? 'Stock badhega save karne par' : 'Stock ghatega save karne par', style: const TextStyle(fontSize: 11, color: SantuColors.amber)),
        ]),
      ),
      const SizedBox(height: 20),
      if (widget.canConvertToBill) ...[
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(backgroundColor: SantuColors.green, padding: const EdgeInsets.symmetric(vertical: 14)),
          onPressed: _convertToBill,
          icon: const Icon(Icons.point_of_sale, size: 18),
          label: const Text('Convert to Bill', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        const SizedBox(height: 8),
      ],
      ElevatedButton.icon(
        style: ElevatedButton.styleFrom(backgroundColor: SantuColors.blue, padding: const EdgeInsets.symmetric(vertical: 14)),
        onPressed: () => _save(print: true),
        icon: const Icon(Icons.print, size: 18),
        label: const Text('Save & Print', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      const SizedBox(height: 8),
      Row(
        children: [
          Expanded(child: OutlinedButton(onPressed: () => _save(), child: Text(widget.actionLabel))),
          const SizedBox(width: 6),
          Expanded(child: OutlinedButton(onPressed: () => _save(whatsapp: true), child: const Text('💬 WhatsApp', style: TextStyle(fontSize: 11)))),
          const SizedBox(width: 6),
          Expanded(child: OutlinedButton(onPressed: _shareWithOther, child: const Text('↗ Kisi aur ko', style: TextStyle(fontSize: 10)))),
        ],
      ),
    ]);
  }
}
