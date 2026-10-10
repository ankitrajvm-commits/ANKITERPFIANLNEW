import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'db.dart';
import 'item_highlight.dart';
import 'models.dart';
import 'prefill_bus.dart';
import 'theme.dart';
import 'thermal_receipt.dart';
import 'units.dart';

/// Same shape as BillingScreen (see that file's header comment) but for
/// goods coming IN: supplier instead of customer, cost price instead of
/// sale price, and saving increases stock instead of decreasing it. Mirrors
/// santu_purchase_invoice.js's job, not yet its GST/tax-breakup UI.
class PurchaseScreen extends StatefulWidget {
  const PurchaseScreen({super.key});

  @override
  State<PurchaseScreen> createState() => _PurchaseScreenState();
}

class _PurchaseScreenState extends State<PurchaseScreen> {
  final _uuid = const Uuid();
  final _searchCtrl = TextEditingController();
  final _supCtrl = TextEditingController();

  List<PurchaseInvoice> _tabs = [];
  int _activeIndex = 0;
  List<Item> _searchResults = [];
  List<Supplier> _supResults = [];
  bool _loading = true;

  PurchaseInvoice get _bill => _tabs[_activeIndex];

  @override
  void initState() {
    super.initState();
    _init();
    PurchasePrefillBus.pending.addListener(_onPrefill);
  }

  @override
  void dispose() {
    PurchasePrefillBus.pending.removeListener(_onPrefill);
    super.dispose();
  }

  void _onPrefill() {
    final inv = PurchasePrefillBus.take();
    if (inv == null || !mounted) return;
    setState(() {
      _tabs.add(inv);
      _activeIndex = _tabs.length - 1;
      _sync();
    });
    _persist();
  }

  Future<void> _init() async {
    final drafts = await AppDb.instance.loadDraftPurchases();
    setState(() {
      _tabs = drafts.isNotEmpty ? drafts : [_blank()];
      _loading = false;
    });
    _sync();
  }

  PurchaseInvoice _blank() => PurchaseInvoice(
        id: _uuid.v4(),
        postingDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
        createdAt: DateTime.now().toIso8601String(),
      );

  void _sync() => _supCtrl.text = _bill.supplierLabel ?? '';

  Future<void> _persist() => AppDb.instance.savePurchaseInvoice(_bill);

  void _newBill() {
    setState(() {
      _tabs.add(_blank());
      _activeIndex = _tabs.length - 1;
      _sync();
    });
    _persist();
  }

  void _closeTab(int i) {
    if (_tabs.length == 1) return;
    setState(() {
      final removed = _tabs.removeAt(i);
      AppDb.instance.deletePurchaseInvoice(removed.id);
      if (_activeIndex >= _tabs.length) _activeIndex = _tabs.length - 1;
      _sync();
    });
  }

  Future<void> _onSearch(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _searchResults = []);
      return;
    }
    setState(() {});
    final results = await AppDb.instance.searchItems(q.trim());
    setState(() => _searchResults = results);
  }

  void _addItem(Item item) {
    setState(() {
      final existing = _bill.items.where((r) => r.itemCode == item.itemCode);
      if (existing.isNotEmpty) {
        existing.first.qty += 1;
      } else {
        _bill.items.add(PurchaseItem(
          id: _uuid.v4(),
          itemCode: item.itemCode,
          itemName: item.itemName,
          qty: 1,
          uom: item.stockUom,
          rate: item.costPrice ?? item.priceListRate,
        ));
      }
      _searchResults = [];
      _searchCtrl.clear();
    });
    _persist();
  }

  void _removeItem(PurchaseItem row) {
    setState(() => _bill.items.remove(row));
    _persist();
  }

  Future<void> _editQty(PurchaseItem row) async {
    final ctrl = TextEditingController(text: row.qty.toString());
    final value = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change Quantity'),
        content: TextField(controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text)), child: const Text('OK')),
        ],
      ),
    );
    if (value != null && value > 0) {
      setState(() => row.qty = value);
      _persist();
    }
  }

  Future<void> _editRate(PurchaseItem row) async {
    final ctrl = TextEditingController(text: row.rate.toString());
    String unit = row.uom;
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Item Options'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true, decoration: const InputDecoration(labelText: 'Purchase Rate (Price/Unit)')),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: unit,
                decoration: const InputDecoration(labelText: 'Unit'),
                items: [for (final u in unitOptionsWith(unit)) DropdownMenuItem(value: u, child: Text(u))],
                onChanged: (v) => setDialogState(() => unit = v ?? unit),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('OK')),
          ],
        ),
      ),
    );
    if (saved == true) {
      final value = double.tryParse(ctrl.text);
      setState(() {
        if (value != null && value >= 0) row.rate = value;
        row.uom = unit;
      });
      _persist();
    }
  }

  Future<void> _onSupplierSearch(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _supResults = []);
      return;
    }
    final results = await AppDb.instance.searchSuppliers(q.trim());
    setState(() => _supResults = results);
  }

  void _pickSupplier(Supplier s) {
    setState(() {
      _bill.supplier = s.name;
      _bill.supplierLabel = s.supplierName;
      _supCtrl.text = s.supplierName;
      _supResults = [];
    });
    _persist();
  }

  /// Attaches a photo of the supplier's paper bill to this purchase. No
  /// auto-read of the photo's text — see the comment on
  /// AppDb._addBillPhotoColumn for why that's out of scope here; the photo
  /// is a reference for later, not a shortcut past entering the items.
  Future<void> _attachBillPhoto() async {
    final choice = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Wrap(children: [
          ListTile(leading: const Icon(Icons.camera_alt), title: const Text('Camera se khincho'), onTap: () => Navigator.pop(ctx, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library), title: const Text('Gallery se chuno'), onTap: () => Navigator.pop(ctx, ImageSource.gallery)),
        ]),
      ),
    );
    if (choice == null) return;
    final picked = await ImagePicker().pickImage(source: choice, maxWidth: 1600, imageQuality: 85);
    if (picked == null) return;
    final dir = await getApplicationDocumentsDirectory();
    final destPath = '${dir.path}/bill_${_bill.id}.jpg';
    await File(picked.path).copy(destPath);
    setState(() => _bill.billPhotoPath = destPath);
    _persist();
  }

  Future<void> _save() async {
    if (_bill.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Purchase mein koi item nahi hai')));
      return;
    }
    final wasSaved = _bill.status == InvoiceStatus.saved;
    _bill.status = InvoiceStatus.saved;
    _bill.billNo ??= 'P-${await AppDb.instance.nextPurchaseNo()}';
    await _persist();
    if (!wasSaved) {
      // Stock comes IN on a purchase — opposite sign from the Billing
      // screen's deduction, same "only on first save" guard.
      final deltas = <String, double>{};
      for (final row in _bill.items) {
        deltas[row.itemCode] = (deltas[row.itemCode] ?? 0) + row.qty;
      }
      await AppDb.instance.adjustItemStock(deltas);
    }
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Purchase saved — stock updated'),
        content: Text('Bill No: ${_bill.billNo}\nSupplier: ${_bill.supplierLabel ?? "-"}\nTotal: ₹${_bill.grandTotal.toStringAsFixed(2)}\nItems added to stock.'),
        actions: [
          TextButton.icon(
            onPressed: () async {
              final error = await ThermalReceipt.printPurchaseBill(_bill);
              if (!ctx.mounted) return;
              ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(error ?? 'Printed ✓')));
            },
            icon: const Icon(Icons.print, size: 18),
            label: const Text('Print'),
          ),
          FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
        ],
      ),
    );
    setState(() {
      _tabs[_activeIndex] = _blank();
      _sync();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final narrow = MediaQuery.of(context).size.width < 700;

    return Scaffold(
      appBar: AppBar(title: const Text('Purchase')),
      body: Column(
        children: [
          _tabBar(),
          Expanded(
            child: narrow
                ? SingleChildScrollView(padding: const EdgeInsets.all(12), child: Column(children: [_left(), const SizedBox(height: 12), _right()]))
                : Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [Expanded(child: _left()), const SizedBox(width: 12), SizedBox(width: 320, child: _right())],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _tabBar() {
    return Container(
      color: SantuColors.bg,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (int i = 0; i < _tabs.length; i++)
            GestureDetector(
              onTap: () => setState(() {
                _activeIndex = i;
                _sync();
              }),
              child: Container(
                margin: const EdgeInsets.only(right: 4),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(color: i == _activeIndex ? SantuColors.card : Colors.transparent, borderRadius: const BorderRadius.vertical(top: Radius.circular(8))),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(_tabs[i].billNo ?? 'Purchase #${i + 1}', style: TextStyle(color: i == _activeIndex ? SantuColors.textDark : SantuColors.textMuted, fontWeight: i == _activeIndex ? FontWeight.w600 : FontWeight.normal, fontSize: 14)),
                  if (_tabs.length > 1) ...[const SizedBox(width: 8), InkWell(onTap: () => _closeTab(i), child: const Icon(Icons.close, size: 16, color: SantuColors.textFaint))],
                ]),
              ),
            ),
          OutlinedButton(
            onPressed: _newBill,
            style: OutlinedButton.styleFrom(backgroundColor: SantuColors.card, side: const BorderSide(color: SantuColors.border), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
            child: const Text('+ New Purchase', style: TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600)),
          ),
        ]),
      ),
    );
  }

  Widget _left() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _searchCtrl,
        onChanged: _onSearch,
        decoration: InputDecoration(
          hintText: 'Search item to add to purchase',
          prefixIcon: const Icon(Icons.search, color: SantuColors.blueLight),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blueLight, width: 2)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blue, width: 2)),
        ),
      ),
      if (_searchResults.isNotEmpty)
        Container(
          margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(color: SantuColors.card, borderRadius: BorderRadius.circular(8), border: Border.all(color: SantuColors.border)),
          constraints: const BoxConstraints(maxHeight: 280),
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: _searchResults.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (ctx, i) {
              final item = _searchResults[i];
              return Container(
                color: ItemHighlight.colorFor(item.itemCode, item.itemName),
                child: ListTile(
                  dense: true,
                  title: Text(item.itemName),
                  subtitle: Text('${item.itemCode} · Current stock: ${item.availableQty.toStringAsFixed(0)}'),
                  trailing: Text('₹${(item.costPrice ?? item.priceListRate).toStringAsFixed(2)}'),
                  onTap: () => _addItem(item),
                ),
              );
            },
          ),
        ),
      const SizedBox(height: 12),
      Container(
        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
        child: Column(children: [
          Container(
            color: const Color(0xFFF8FAFC),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: const Row(children: [
              SizedBox(width: 24, child: Text('#', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted))),
              Expanded(flex: 3, child: Text('ITEM', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted))),
              SizedBox(width: 40, child: Text('QTY', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 56, child: Text('RATE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 64, child: Text('TOTAL', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted), textAlign: TextAlign.right)),
              SizedBox(width: 28),
            ]),
          ),
          if (_bill.items.isEmpty)
            const Padding(padding: EdgeInsets.all(28), child: Text('Koi item nahi — upar search karke add karo', style: TextStyle(color: SantuColors.textMuted)))
          else
            for (int i = 0; i < _bill.items.length; i++) _row(i, _bill.items[i]),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: const BoxDecoration(color: Color(0xFFF8FAFC)),
            alignment: Alignment.centerRight,
            child: Text('₹ ${_bill.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
        ]),
      ),
    ]);
  }

  Widget _row(int index, PurchaseItem row) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: ItemHighlight.colorFor(row.itemCode, row.itemName),
        border: const Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
      ),
      child: Row(children: [
        SizedBox(width: 24, child: Text('${index + 1}', style: const TextStyle(fontSize: 12))),
        Expanded(flex: 3, child: Text(row.itemName, style: const TextStyle(fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis)),
        SizedBox(width: 40, child: InkWell(onTap: () => _editQty(row), child: Text(row.qty == row.qty.roundToDouble() ? row.qty.toInt().toString() : row.qty.toString(), style: const TextStyle(fontSize: 12), textAlign: TextAlign.right))),
        SizedBox(width: 56, child: InkWell(onTap: () => _editRate(row), child: Text(row.rate.toStringAsFixed(0), style: const TextStyle(fontSize: 12), textAlign: TextAlign.right))),
        SizedBox(width: 64, child: Text(row.lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), textAlign: TextAlign.right)),
        SizedBox(width: 28, child: IconButton(padding: EdgeInsets.zero, icon: const Icon(Icons.close, size: 16, color: SantuColors.textFaint), onPressed: () => _removeItem(row))),
      ]),
    );
  }

  Widget _right() {
    final t = _bill;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        decoration: const InputDecoration(labelText: 'Date'),
        controller: TextEditingController(text: t.postingDate),
        readOnly: true,
        onTap: () async {
          final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(t.postingDate) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
          if (picked != null) {
            setState(() => t.postingDate = DateFormat('yyyy-MM-dd').format(picked));
            _persist();
          }
        },
      ),
      const SizedBox(height: 10),
      TextField(controller: _supCtrl, onChanged: _onSupplierSearch, decoration: const InputDecoration(labelText: 'Supplier', hintText: 'Search by name, phone')),
      if (_supResults.isNotEmpty)
        Container(
          margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(color: SantuColors.card, borderRadius: BorderRadius.circular(8), border: Border.all(color: SantuColors.border)),
          constraints: const BoxConstraints(maxHeight: 220),
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: _supResults.length,
            itemBuilder: (ctx, i) {
              final s = _supResults[i];
              return ListTile(dense: true, title: Text(s.supplierName), subtitle: s.phone != null ? Text(s.phone!) : null, onTap: () => _pickSupplier(s));
            },
          ),
        ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          const Text('📦', style: TextStyle(fontSize: 22)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Total ₹ ${t.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              Text('Items: ${t.items.length}, Quantity: ${t.totalQty}', style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 10),
      if (t.billPhotoPath != null)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: SantuColors.border)),
          clipBehavior: Clip.antiAlias,
          child: Stack(children: [
            Image.file(File(t.billPhotoPath!), height: 120, width: double.infinity, fit: BoxFit.cover),
            Positioned(
              top: 4,
              right: 4,
              child: InkWell(
                onTap: () {
                  setState(() => t.billPhotoPath = null);
                  _persist();
                },
                child: const CircleAvatar(radius: 12, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)),
              ),
            ),
          ]),
        )
      else
        OutlinedButton.icon(
          onPressed: _attachBillPhoto,
          icon: const Icon(Icons.camera_alt_outlined, size: 18),
          label: const Text('Upload Bill Photo'),
        ),
      const SizedBox(height: 10),
      ElevatedButton.icon(
        style: ElevatedButton.styleFrom(backgroundColor: SantuColors.green, padding: const EdgeInsets.symmetric(vertical: 14)),
        onPressed: _save,
        icon: const Icon(Icons.inventory_2_outlined),
        label: const Text('Save Purchase (stock in)', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
    ]);
  }
}
