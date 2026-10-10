import 'package:flutter/material.dart';

import 'db.dart';
import 'models.dart';
import 'theme.dart';

/// Mirrors Utilities → Update Items In Bulk: search, tick several items,
/// edit a field across all of them in one table, Update Selected applies
/// every staged edit at once. Scoped to the fields the local Item table
/// actually has (name/UOM/sell price/cost price/barcode) — no item
/// group/brand/HSN/MRP/rack-shelf-bin, since this app's catalogue doesn't
/// carry those yet.
class BulkUpdateScreen extends StatefulWidget {
  const BulkUpdateScreen({super.key});

  @override
  State<BulkUpdateScreen> createState() => _BulkUpdateScreenState();
}

class _BulkUpdateScreenState extends State<BulkUpdateScreen> {
  bool _loading = true;
  List<Item> _items = [];
  final _searchCtrl = TextEditingController();
  final Set<String> _selected = {};
  final Map<String, Map<String, String>> _edits = {}; // itemCode -> field -> text

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load([String query = '']) async {
    setState(() => _loading = true);
    // Empty query means "show the whole catalogue to bulk-edit" — searchItems's
    // row cap (even raised to 500) would silently hide items past it.
    final items = query.isEmpty ? await AppDb.instance.allItems() : await AppDb.instance.searchItems(query, limit: 500);
    setState(() {
      _items = items;
      _loading = false;
    });
  }

  String _staged(Item it, String field, String fallback) {
    return _edits[it.itemCode]?[field] ?? fallback;
  }

  void _stage(String itemCode, String field, String value) {
    _edits.putIfAbsent(itemCode, () => {})[field] = value;
  }

  Future<void> _applyUpdates() async {
    if (_selected.isEmpty) return;
    final updated = <Item>[];
    for (final code in _selected) {
      final existing = _items.firstWhere((i) => i.itemCode == code);
      final edits = _edits[code];
      if (edits == null) continue;
      updated.add(Item(
        itemCode: existing.itemCode,
        itemName: edits['item_name']?.trim().isNotEmpty == true ? edits['item_name']!.trim() : existing.itemName,
        stockUom: edits['stock_uom']?.trim().isNotEmpty == true ? edits['stock_uom']!.trim() : existing.stockUom,
        priceListRate: double.tryParse(edits['price_list_rate'] ?? '') ?? existing.priceListRate,
        costPrice: edits.containsKey('cost_price') ? double.tryParse(edits['cost_price'] ?? '') : existing.costPrice,
        availableQty: existing.availableQty,
        barcode: edits.containsKey('barcode') ? (edits['barcode']!.trim().isEmpty ? null : edits['barcode']!.trim()) : existing.barcode,
      ));
    }
    if (updated.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Kuch bhi edit nahi kiya — koi update nahi hua')));
      return;
    }
    await AppDb.instance.upsertItems(updated);
    setState(() {
      for (final code in _selected) {
        _edits.remove(code);
      }
      _selected.clear();
    });
    await _load(_searchCtrl.text);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${updated.length} items update ho gaye')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Update Items In Bulk')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => _load(v),
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search by item name or code'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${_selected.length} items selected', style: const TextStyle(color: SantuColors.textMuted)),
                FilledButton(onPressed: _selected.isEmpty ? null : _applyUpdates, child: const Text('Update Selected')),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                    ? const Center(child: Text('Koi item nahi mila', style: TextStyle(color: SantuColors.textMuted)))
                    : SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: SingleChildScrollView(
                          child: DataTable(
                            columns: const [
                              DataColumn(label: Text('')),
                              DataColumn(label: Text('Item Name')),
                              DataColumn(label: Text('Unit')),
                              DataColumn(label: Text('Sell Price')),
                              DataColumn(label: Text('Cost Price')),
                              DataColumn(label: Text('Barcode')),
                              DataColumn(label: Text('Stock')),
                            ],
                            rows: [
                              for (final it in _items)
                                DataRow(
                                  selected: _selected.contains(it.itemCode),
                                  cells: [
                                    DataCell(Checkbox(
                                      value: _selected.contains(it.itemCode),
                                      onChanged: (v) => setState(() {
                                        if (v == true) {
                                          _selected.add(it.itemCode);
                                        } else {
                                          _selected.remove(it.itemCode);
                                        }
                                      }),
                                    )),
                                    DataCell(_editCell(it, 'item_name', it.itemName)),
                                    DataCell(_editCell(it, 'stock_uom', it.stockUom, width: 70)),
                                    DataCell(_editCell(it, 'price_list_rate', it.priceListRate.toStringAsFixed(2), width: 90)),
                                    DataCell(_editCell(it, 'cost_price', it.costPrice?.toStringAsFixed(2) ?? '', width: 90)),
                                    DataCell(_editCell(it, 'barcode', it.barcode ?? '', width: 110)),
                                    DataCell(Text(it.availableQty.toStringAsFixed(0))),
                                  ],
                                ),
                            ],
                          ),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _editCell(Item it, String field, String fallback, {double width = 140}) {
    final ctrl = TextEditingController(text: _staged(it, field, fallback));
    return SizedBox(
      width: width,
      child: TextField(
        controller: ctrl,
        style: const TextStyle(fontSize: 12),
        decoration: const InputDecoration(isDense: true, border: InputBorder.none),
        onChanged: (v) => _stage(it.itemCode, field, v),
      ),
    );
  }
}
