import 'package:flutter/material.dart';

import 'bulk_update_screen.dart';
import 'db.dart';
import 'item_highlight.dart';
import 'item_highlight_screen.dart';
import 'models.dart';
import 'theme.dart';
import 'units.dart';

/// Item master: add/edit items, their sale price, cost price and stock on
/// hand. Mirrors what santu_hardware's Item list + quick-edit does for the
/// web app, scoped to the fields Billing/Purchase actually read.
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  List<Item> _all = [];
  List<Item> _shown = [];
  bool _loading = true;
  final _searchCtrl = TextEditingController();

  double _stockValCost = 0;
  double _stockValSale = 0;
  Map<String, int> _stockCounts = {'low': 0, 'critical': 0, 'khatam': 0, 'total_items': 0, 'total_qty': 0};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await AppDb.instance.allItems();
    final costVal = await AppDb.instance.totalStockValueCost();
    final saleVal = await AppDb.instance.totalStockValueSale();
    final counts = await AppDb.instance.stockSummaryCounts();
    if (!mounted) return;
    setState(() {
      _all = rows;
      _shown = rows;
      _stockValCost = costVal;
      _stockValSale = saleVal;
      _stockCounts = counts;
      _loading = false;
    });
  }

  void _filter(String q) {
    final tokens = searchTokens(q);
    setState(() {
      _shown = tokens.isEmpty
          ? _all
          : _all.where((i) => matchesAllTokens(tokens, [i.itemName, i.itemCode, i.barcode])).toList();
    });
  }

  void _showMoreMenu() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit_note_outlined, color: SantuColors.blue),
              title: const Text('Update Items In Bulk'),
              subtitle: const Text('Multiple items ka price/unit/barcode ek sath badlein'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const BulkUpdateScreen())).then((_) => _load());
              },
            ),
            ListTile(
              leading: const Icon(Icons.palette_outlined, color: SantuColors.blue),
              title: const Text('Item Colour Rules'),
              subtitle: const Text('Naam/code match ho to item ko rang do'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const ItemHighlightScreen())).then((_) => _load());
              },
            ),
            ListTile(
              leading: const Icon(Icons.category_outlined),
              title: const Text('Manage Categories'),
              subtitle: const Text('Item groups — code prefix list'),
              onTap: () {
                Navigator.pop(ctx);
                _showCategories();
              },
            ),
            ListTile(
              leading: const Icon(Icons.straighten_outlined),
              title: const Text('Manage Units'),
              subtitle: const Text('Billing / Purchase me milne wale units'),
              onTap: () {
                Navigator.pop(ctx);
                _showUnits();
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showCategories() async {
    final groups = <String>{};
    for (final i in _all) {
      // Mobile DB has no item_group column yet — derive rough groups from code prefix.
      final prefix = i.itemCode.split('-').first;
      if (prefix.length >= 2) groups.add(prefix);
    }
    final sorted = groups.toList()..sort();
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Categories (code prefix)'),
        content: SizedBox(
          width: 280,
          child: sorted.isEmpty
              ? const Text('Abhi koi category nahi — PC par Item Group import karein.')
              : SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final g in sorted.take(40)) Text('• $g (${_all.where((i) => i.itemCode.startsWith(g)).length} items)')])),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _showUnits() async {
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Manage Units'),
        content: SizedBox(
          width: 280,
          height: 320,
          child: ListView(children: [for (final u in kUnitOptions) ListTile(dense: true, title: Text(u), trailing: Text('${_all.where((i) => i.stockUom == u).length}', style: const TextStyle(color: SantuColors.textMuted)))]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _delete(Item it) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Item delete karein?'),
        content: Text('${it.itemName} Recycle Bin mein chala jayega — wahan se wapas la sakte ho.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed == true) {
      await AppDb.instance.softDelete('item', 'item_code', it.itemCode);
      _load();
    }
  }

  Future<void> _openEditor({Item? existing}) async {
    final codeCtrl = TextEditingController(text: existing?.itemCode ?? '');
    final nameCtrl = TextEditingController(text: existing?.itemName ?? '');
    final uomCtrl = TextEditingController(text: existing?.stockUom ?? 'Nos');
    final priceCtrl = TextEditingController(text: existing?.priceListRate.toString() ?? '');
    final costCtrl = TextEditingController(text: existing?.costPrice?.toString() ?? '');
    final stockCtrl = TextEditingController(text: existing?.availableQty.toString() ?? '0');

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'New Item' : 'Edit Item'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: codeCtrl, enabled: existing == null, decoration: const InputDecoration(labelText: 'Item Code'), autofocus: existing == null),
              const SizedBox(height: 8),
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Item Name')),
              const SizedBox(height: 8),
              TextField(controller: uomCtrl, decoration: const InputDecoration(labelText: 'Unit (Nos, Kg, Bag…)')),
              const SizedBox(height: 8),
              TextField(controller: priceCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Sale Price (₹)')),
              const SizedBox(height: 8),
              TextField(controller: costCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Cost Price (₹, optional)')),
              const SizedBox(height: 8),
              TextField(controller: stockCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Stock on hand')),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );

    if (saved == true && codeCtrl.text.trim().isNotEmpty && nameCtrl.text.trim().isNotEmpty) {
      final item = Item(
        itemCode: codeCtrl.text.trim(),
        itemName: nameCtrl.text.trim(),
        stockUom: uomCtrl.text.trim().isEmpty ? 'Nos' : uomCtrl.text.trim(),
        priceListRate: double.tryParse(priceCtrl.text) ?? 0,
        costPrice: double.tryParse(costCtrl.text),
        availableQty: double.tryParse(stockCtrl.text) ?? 0,
      );
      await AppDb.instance.upsertItems([item]);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory'),
        actions: [IconButton(icon: const Icon(Icons.more_vert), tooltip: 'Category, Units', onPressed: _showMoreMenu)],
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _openEditor(), icon: const Icon(Icons.add), label: const Text('New Item')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('STOCK VALUE', style: TextStyle(fontSize: 9, color: SantuColors.textMuted, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 2),
                              Text('₹ ${_stockValCost.toStringAsFixed(0)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                              Text('${_stockCounts['total_items']} items · ${_stockCounts['total_qty']} pcs', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9, color: SantuColors.textMuted)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('SALE VALUE', style: TextStyle(fontSize: 9, color: SantuColors.textMuted, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 2),
                              Text('₹ ${_stockValSale.toStringAsFixed(0)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                              const Text('At today rate', style: TextStyle(fontSize: 9, color: SantuColors.textMuted)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('RUNNING LOW', style: TextStyle(fontSize: 9, color: SantuColors.textMuted, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 2),
                              Text('${_stockCounts['low']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: SantuColors.amber)),
                              Text('${_stockCounts['critical']} critical', style: const TextStyle(fontSize: 9, color: SantuColors.red)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: TextField(
                    controller: _searchCtrl,
                    onChanged: _filter,
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search by name or code'),
                  ),
                ),

                Expanded(
                  child: _shown.isEmpty
                      ? const Center(child: Text('Koi item nahi mila', style: TextStyle(color: SantuColors.textMuted)))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _shown.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final it = _shown[i];
                            final low = it.availableQty <= 5;
                            final hlColor = ItemHighlight.colorFor(it.itemCode, it.itemName);
                            return Container(
                              color: hlColor,
                              child: ListTile(
                              title: Text(it.itemName),
                              subtitle: Text('${it.itemCode} · ₹${it.priceListRate.toStringAsFixed(2)} / ${it.stockUom}'),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: low ? const Color(0xFFFEF2F2) : const Color(0xFFF0FDF4),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      'Stock: ${it.availableQty.toStringAsFixed(0)}',
                                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: low ? const Color(0xFFB91C1C) : const Color(0xFF15803D)),
                                    ),
                                  ),
                                  IconButton(icon: const Icon(Icons.edit, size: 18), onPressed: () => _openEditor(existing: it)),
                                  IconButton(icon: const Icon(Icons.delete_outline, size: 18, color: SantuColors.red), onPressed: () => _delete(it)),
                                ],
                              ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
