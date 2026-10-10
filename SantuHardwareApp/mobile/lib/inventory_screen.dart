import 'package:flutter/material.dart';

import 'bulk_update_screen.dart';
import 'db.dart';
import 'item_highlight.dart';
import 'item_highlight_screen.dart';
import 'models.dart';
import 'theme.dart';
import 'units.dart';

/// Item master: add/edit items, their sale price, cost price and stock on
/// hand. Completely modernised with full product names, no duplicate labels,
/// instant stock adjustments, KPI summaries, and smart filtering.
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
  Map<String, int> _stockCounts = {
    'low': 0,
    'critical': 0,
    'khatam': 0,
    'total_items': 0,
    'total_qty': 0,
  };

  String _filterMode = 'all'; // 'all', 'low', 'khatam', 'in_stock'
  String _sortMode = 'name_asc'; // 'name_asc', 'name_desc', 'stock_asc', 'stock_desc', 'rate_desc', 'rate_asc'

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    // 1. Run automatic deduplication to clean up any duplicate entries
    await AppDb.instance.deduplicateItems();

    // 2. Load all active items
    final rows = await AppDb.instance.allItems(orderBy: 'item_name COLLATE NOCASE ASC');
    final costVal = await AppDb.instance.totalStockValueCost();
    final saleVal = await AppDb.instance.totalStockValueSale();
    final counts = await AppDb.instance.stockSummaryCounts();

    if (!mounted) return;
    setState(() {
      _all = rows;
      _stockValCost = costVal;
      _stockValSale = saleVal;
      _stockCounts = counts;
      _applyFilterAndSort();
      _loading = false;
    });
  }

  void _applyFilterAndSort() {
    var list = List<Item>.from(_all);

    // Filter by stock status
    if (_filterMode == 'low') {
      list = list.where((i) => i.availableQty > 0 && i.availableQty <= 5).toList();
    } else if (_filterMode == 'khatam') {
      list = list.where((i) => i.availableQty <= 0).toList();
    } else if (_filterMode == 'in_stock') {
      list = list.where((i) => i.availableQty > 5).toList();
    }

    // Filter by search text
    final q = _searchCtrl.text.trim();
    if (q.isNotEmpty) {
      final tokens = searchTokens(q);
      list = list.where((i) => matchesAllTokens(tokens, [i.itemName, i.itemCode, i.barcode])).toList();
    }

    // Apply sorting
    switch (_sortMode) {
      case 'name_asc':
        list.sort((a, b) => a.itemName.toLowerCase().compareTo(b.itemName.toLowerCase()));
        break;
      case 'name_desc':
        list.sort((a, b) => b.itemName.toLowerCase().compareTo(a.itemName.toLowerCase()));
        break;
      case 'stock_asc':
        list.sort((a, b) => a.availableQty.compareTo(b.availableQty));
        break;
      case 'stock_desc':
        list.sort((a, b) => b.availableQty.compareTo(a.availableQty));
        break;
      case 'rate_desc':
        list.sort((a, b) => b.priceListRate.compareTo(a.priceListRate));
        break;
      case 'rate_asc':
        list.sort((a, b) => a.priceListRate.compareTo(b.priceListRate));
        break;
    }

    setState(() {
      _shown = list;
    });
  }

  void _onSearchChanged(String _) {
    _applyFilterAndSort();
  }

  void _setFilter(String mode) {
    setState(() {
      _filterMode = mode;
      _applyFilterAndSort();
    });
  }

  bool _isDistinctCode(String code, String name) {
    final cleanCode = code.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '').toLowerCase();
    final cleanName = name.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '').toLowerCase();
    // Only distinct if it does not just reproduce the name
    return cleanCode.isNotEmpty && cleanCode != cleanName && !cleanName.contains(cleanCode);
  }

  String? _detectBrand(String name, String code) {
    final upper = '$name $code'.toUpperCase();
    if (upper.contains('ANCHOR')) return 'Anchor';
    if (upper.contains('PRINCE')) return 'Prince';
    if (upper.contains('SUPREME')) return 'Supreme';
    if (upper.contains('ASIAN') || upper.contains('AP ')) return 'Asian Paints';
    if (upper.contains('TATA')) return 'Tata';
    if (upper.contains('BIRLA') || upper.contains('OPUS')) return 'Birla Opus';
    if (upper.contains('FINOLEX')) return 'Finolex';
    if (upper.contains('HAVELLS')) return 'Havells';
    if (upper.contains('ASTRAL')) return 'Astral';
    if (upper.contains('PIDILITE') || upper.contains('FEVICOL')) return 'Pidilite';
    if (upper.contains('CEMENT')) return 'Cement';
    return null;
  }

  Future<void> _quickAddStock(Item it) async {
    final qtyCtrl = TextEditingController(text: '10');
    final rateCtrl = TextEditingController(text: it.costPrice != null && it.costPrice! > 0 ? it.costPrice!.toString() : '');

    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: SantuColors.blue.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                    child: const Icon(Icons.add_shopping_cart, color: SantuColors.blue, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Stock Chadhayein', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        Text(it.itemName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 24),
              Text('Current Stock: ${it.availableQty.toStringAsFixed(0)} ${it.stockUom}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: SantuColors.textMuted)),
              const SizedBox(height: 12),
              TextField(
                controller: qtyCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                autofocus: true,
                decoration: InputDecoration(
                  labelText: 'Jodna hai (Kitna Qty)',
                  suffixText: it.stockUom,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final val in ['5', '10', '20', '50', '100'])
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ActionChip(
                          label: Text('+$val'),
                          onPressed: () => qtyCtrl.text = val,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: rateCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'Khareed Rate (Cost Price ₹, optional)',
                  prefixText: '₹ ',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(ctx, true),
                  icon: const Icon(Icons.check),
                  label: const Text('Stock Update Karein', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  style: FilledButton.styleFrom(
                    backgroundColor: SantuColors.green,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (result == true) {
      final addQty = double.tryParse(qtyCtrl.text.trim()) ?? 0;
      final cost = double.tryParse(rateCtrl.text.trim());
      if (addQty > 0) {
        await AppDb.instance.receiveStockSimple(it.itemCode, addQty, purchaseRate: cost);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('✓ +$addQty ${it.stockUom} jod diya gaya: ${it.itemName}')),
        );
        _load();
      }
    }
  }

  void _showSortMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Icon(Icons.sort, size: 20, color: SantuColors.blue),
                    SizedBox(width: 8),
                    Text('Sort Items', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              const Divider(height: 1),
              _sortTile('Naam: A se Z', 'name_asc', Icons.sort_by_alpha),
              _sortTile('Naam: Z se A', 'name_desc', Icons.sort_by_alpha),
              _sortTile('Stock: Kam se Zyada (Running Low)', 'stock_asc', Icons.arrow_upward),
              _sortTile('Stock: Zyada se Kam', 'stock_desc', Icons.arrow_downward),
              _sortTile('Sale Rate: Mehnga se Sasta', 'rate_desc', Icons.currency_rupee),
              _sortTile('Sale Rate: Sasta se Mehnga', 'rate_asc', Icons.currency_rupee),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sortTile(String title, String mode, IconData icon) {
    final selected = _sortMode == mode;
    return ListTile(
      leading: Icon(icon, color: selected ? SantuColors.blue : SantuColors.textMuted),
      title: Text(title, style: TextStyle(fontWeight: selected ? FontWeight.bold : FontWeight.normal, color: selected ? SantuColors.blue : null)),
      trailing: selected ? const Icon(Icons.check, color: SantuColors.blue) : null,
      onTap: () {
        Navigator.pop(context);
        setState(() {
          _sortMode = mode;
          _applyFilterAndSort();
        });
      },
    );
  }

  void _showMoreMenu() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.auto_fix_high, color: SantuColors.blue),
              title: const Text('Remove Duplicate Items (Safai)'),
              subtitle: const Text('Ek jaisa naam wale duplicate items ko auto-merge karein'),
              onTap: () async {
                Navigator.pop(ctx);
                final merged = await AppDb.instance.deduplicateItems();
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(merged > 0 ? '✓ $merged duplicate items merge aur safai ki gayi.' : 'Koi duplicate item nahi mila.')),
                );
                _load();
              },
            ),
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
      final prefix = i.itemCode.split('-').first;
      if (prefix.length >= 2) groups.add(prefix);
    }
    final sorted = groups.toList()..sort();
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Categories (Code Prefix)'),
        content: SizedBox(
          width: 280,
          child: sorted.isEmpty
              ? const Text('Abhi koi category nahi mili.')
              : SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final g in sorted.take(40))
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Text('• $g (${_all.where((i) => i.itemCode.startsWith(g)).length} items)'),
                        ),
                    ],
                  ),
                ),
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
          child: ListView(
            children: [
              for (final u in kUnitOptions)
                ListTile(
                  dense: true,
                  title: Text(u),
                  trailing: Text(
                    '${_all.where((i) => i.stockUom == u).length}',
                    style: const TextStyle(color: SantuColors.textMuted),
                  ),
                ),
            ],
          ),
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
        content: Text('${it.itemName}\n\nYe Recycle Bin mein chala jayega — wahan se wapas la sakte ho.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: SantuColors.red),
            child: const Text('Delete'),
          ),
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
    final barcodeCtrl = TextEditingController(text: existing?.barcode ?? '');

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'New Item' : 'Edit Item'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(labelText: 'Item Full Name *', hintText: 'e.g. Tata Steel Pipe 2"'),
                autofocus: existing == null,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: codeCtrl,
                enabled: existing == null,
                decoration: InputDecoration(
                  labelText: 'Item Code / SKU',
                  hintText: existing == null ? 'Khali chhodne par auto-generate hoga' : null,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: uomCtrl,
                decoration: const InputDecoration(labelText: 'Unit (Nos, Pcs, Kg, Bag, Roll, Mtr)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: priceCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Sale Price (₹) *', prefixText: '₹ '),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: costCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Cost Price (Khareed ₹, optional)', prefixText: '₹ '),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: stockCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Available Stock Quantity'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: barcodeCtrl,
                decoration: const InputDecoration(labelText: 'Barcode (optional)'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save Item')),
        ],
      ),
    );

    if (saved == true && nameCtrl.text.trim().isNotEmpty) {
      final name = nameCtrl.text.trim();
      var code = codeCtrl.text.trim();
      if (code.isEmpty) {
        code = name.replaceAll(RegExp(r'[^a-zA-Z0-9]+'), '-').toUpperCase();
        if (code.endsWith('-')) code = code.substring(0, code.length - 1);
      }

      final item = Item(
        itemCode: code,
        itemName: name,
        stockUom: uomCtrl.text.trim().isEmpty ? 'Nos' : uomCtrl.text.trim(),
        priceListRate: double.tryParse(priceCtrl.text) ?? 0,
        costPrice: double.tryParse(costCtrl.text),
        availableQty: double.tryParse(stockCtrl.text) ?? 0,
        barcode: barcodeCtrl.text.trim().isEmpty ? null : barcodeCtrl.text.trim(),
      );
      await AppDb.instance.upsertItems([item]);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Inventory', style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.sort),
            tooltip: 'Sort Items',
            onPressed: _showSortMenu,
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            tooltip: 'More options',
            onPressed: _showMoreMenu,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(),
        icon: const Icon(Icons.add),
        label: const Text('New Item', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: SantuColors.blue,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: Column(
                children: [
                  // 1. KPI Overview Summary Cards
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
                    child: Row(
                      children: [
                        // Stock Value (Cost)
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: const [
                                BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 1)),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      width: 6,
                                      height: 6,
                                      decoration: const BoxDecoration(color: SantuColors.blue, shape: BoxShape.circle),
                                    ),
                                    const SizedBox(width: 4),
                                    const Expanded(
                                      child: Text('STOCK VALUE', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700, color: SantuColors.textMuted)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '₹ ${_stockValCost.toStringAsFixed(0)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  '${_stockCounts['total_items'] ?? _all.length} items · ${_stockCounts['total_qty'] ?? 0} pcs',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 9.5, color: SantuColors.textMuted),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),

                        // Sale Value
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: const [
                                BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 1)),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      width: 6,
                                      height: 6,
                                      decoration: const BoxDecoration(color: SantuColors.green, shape: BoxShape.circle),
                                    ),
                                    const SizedBox(width: 4),
                                    const Expanded(
                                      child: Text('SALE VALUE', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700, color: SantuColors.textMuted)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '₹ ${_stockValSale.toStringAsFixed(0)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                ),
                                const SizedBox(height: 1),
                                const Text('At today rate', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 9.5, color: SantuColors.textMuted)),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),

                        // Running Low Alert (Clickable)
                        Expanded(
                          child: InkWell(
                            onTap: () => _setFilter(_filterMode == 'low' ? 'all' : 'low'),
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                              decoration: BoxDecoration(
                                color: _filterMode == 'low' ? const Color(0xFFFEF3C7) : Colors.white,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: _filterMode == 'low' ? const Color(0xFFF59E0B) : const Color(0xFFE2E8F0)),
                                boxShadow: const [
                                  BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 1)),
                                ],
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Container(
                                        width: 6,
                                        height: 6,
                                        decoration: const BoxDecoration(color: SantuColors.amber, shape: BoxShape.circle),
                                      ),
                                      const SizedBox(width: 4),
                                      const Expanded(
                                        child: Text('RUNNING LOW', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700, color: SantuColors.amber)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${_stockCounts['low'] ?? 0}',
                                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFFB45309)),
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    '${_stockCounts['critical'] ?? 0} khatam',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 9.5, color: SantuColors.red, fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // 2. Search Box with Clear & Results Count
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                        boxShadow: const [
                          BoxShadow(color: Color(0x06000000), blurRadius: 3, offset: Offset(0, 1)),
                        ],
                      ),
                      child: TextField(
                        controller: _searchCtrl,
                        onChanged: _onSearchChanged,
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.search, color: SantuColors.blue, size: 22),
                          hintText: 'Search by full product name or code...',
                          hintStyle: const TextStyle(fontSize: 13.5, color: Color(0xFF94A3B8)),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          suffixIcon: _searchCtrl.text.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear, size: 18),
                                  onPressed: () {
                                    _searchCtrl.clear();
                                    _applyFilterAndSort();
                                  },
                                )
                              : null,
                        ),
                      ),
                    ),
                  ),

                  // 3. Filter Chips Row
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          _filterChip(label: 'All (${_all.length})', mode: 'all', color: SantuColors.blue),
                          const SizedBox(width: 6),
                          _filterChip(label: 'Low Stock (${_stockCounts['low'] ?? 0})', mode: 'low', color: const Color(0xFFD97706)),
                          const SizedBox(width: 6),
                          _filterChip(label: 'Khatam (${_stockCounts['critical'] ?? 0})', mode: 'khatam', color: SantuColors.red),
                          const SizedBox(width: 6),
                          _filterChip(
                            label: 'In Stock (${_all.where((i) => i.availableQty > 5).length})',
                            mode: 'in_stock',
                            color: SantuColors.green,
                          ),
                        ],
                      ),
                    ),
                  ),

                  // 4. Products List
                  Expanded(
                    child: _shown.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.inventory_2_outlined, size: 48, color: Colors.grey.shade400),
                                const SizedBox(height: 10),
                                const Text('Koi item nahi mila', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SantuColors.textMuted)),
                                if (_searchCtrl.text.isNotEmpty || _filterMode != 'all') ...[
                                  const SizedBox(height: 6),
                                  TextButton(
                                    onPressed: () {
                                      _searchCtrl.clear();
                                      _setFilter('all');
                                    },
                                    child: const Text('Sabhi filter hatao'),
                                  ),
                                ],
                              ],
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(14, 4, 14, 80),
                            itemCount: _shown.length,
                            itemBuilder: (ctx, i) => _buildItemCard(_shown[i]),
                          ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _filterChip({required String label, required String mode, required Color color}) {
    final selected = _filterMode == mode;
    return InkWell(
      onTap: () => _setFilter(mode),
      borderRadius: BorderRadius.circular(20),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.12) : Colors.white,
          border: Border.all(color: selected ? color : const Color(0xFFCBD5E1), width: selected ? 1.4 : 1),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? color : const Color(0xFF475569),
          ),
        ),
      ),
    );
  }

  Widget _buildItemCard(Item it) {
    final isOut = it.availableQty <= 0;
    final isLow = it.availableQty > 0 && it.availableQty <= 5;
    final hlColor = ItemHighlight.colorFor(it.itemCode, it.itemName);
    final brand = _detectBrand(it.itemName, it.itemCode);
    final distinctCode = _isDistinctCode(it.itemCode, it.itemName);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: hlColor ?? Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isOut
              ? const Color(0xFFFCA5A5)
              : (isLow ? const Color(0xFFFDE68A) : const Color(0xFFE2E8F0)),
          width: isOut || isLow ? 1.2 : 1,
        ),
        boxShadow: const [
          BoxShadow(color: Color(0x06000000), blurRadius: 4, offset: Offset(0, 1)),
        ],
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openEditor(existing: it),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Row: Full Item Name + Stock Pill
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Full Item Name without truncation
                  Expanded(
                    child: Text(
                      it.itemName,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF0F172A),
                        height: 1.28,
                      ),
                      softWrap: true,
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Stock Badge Pill
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isOut
                          ? const Color(0xFFFEE2E2)
                          : (isLow ? const Color(0xFFFEF3C7) : const Color(0xFFDCFCE7)),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: isOut
                            ? const Color(0xFFFCA5A5)
                            : (isLow ? const Color(0xFFFCD34D) : const Color(0xFF86EFAC)),
                        width: 0.8,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isOut ? Icons.cancel_outlined : (isLow ? Icons.warning_amber_rounded : Icons.check_circle_outline),
                          size: 12,
                          color: isOut ? const Color(0xFFB91C1C) : (isLow ? const Color(0xFFB45309) : const Color(0xFF15803D)),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '${it.availableQty.toStringAsFixed(it.availableQty == it.availableQty.roundToDouble() ? 0 : 1)} ${it.stockUom}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: isOut ? const Color(0xFFB91C1C) : (isLow ? const Color(0xFFB45309) : const Color(0xFF15803D)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              // Metadata Tags (Brand & distinct SKU / Barcode)
              if (brand != null || distinctCode || (it.barcode != null && it.barcode!.isNotEmpty)) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    if (brand != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
                        ),
                        child: Text(
                          brand,
                          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Color(0xFF1D4ED8)),
                        ),
                      ),
                    if (distinctCode)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'Code: ${it.itemCode}',
                          style: const TextStyle(fontSize: 10, color: Color(0xFF475569)),
                        ),
                      ),
                    if (it.barcode != null && it.barcode!.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.qr_code, size: 10, color: Color(0xFF64748B)),
                            const SizedBox(width: 3),
                            Text(it.barcode!, style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
                          ],
                        ),
                      ),
                  ],
                ),
              ],

              const SizedBox(height: 8),
              const Divider(height: 1, color: Color(0xFFF1F5F9)),
              const SizedBox(height: 6),

              // Bottom Financials and Action Buttons
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Sale Rate & Unit
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            '₹ ${it.priceListRate.toStringAsFixed(2)}',
                            style: const TextStyle(
                              fontSize: 15.5,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF1E40AF),
                            ),
                          ),
                          const SizedBox(width: 3),
                          Text(
                            '/ ${it.stockUom}',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFF64748B)),
                          ),
                        ],
                      ),
                      if (it.costPrice != null && it.costPrice! > 0)
                        Text(
                          'Khareed: ₹ ${it.costPrice!.toStringAsFixed(2)}',
                          style: const TextStyle(fontSize: 10.5, color: Color(0xFF94A3B8)),
                        ),
                    ],
                  ),
                  const Spacer(),

                  // Quick "+ Stock" action button
                  OutlinedButton.icon(
                    onPressed: () => _quickAddStock(it),
                    icon: const Icon(Icons.add, size: 14),
                    label: const Text('+ Stock', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      foregroundColor: SantuColors.green,
                      side: const BorderSide(color: Color(0xFF86EFAC)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                    ),
                  ),
                  const SizedBox(width: 6),

                  // Quick Edit Button
                  IconButton(
                    icon: const Icon(Icons.edit_outlined, size: 18, color: SantuColors.blue),
                    tooltip: 'Edit item',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    onPressed: () => _openEditor(existing: it),
                  ),

                  // Options menu (Delete)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 18, color: Color(0xFF64748B)),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                    onSelected: (val) {
                      if (val == 'delete') _delete(it);
                      if (val == 'stock') _quickAddStock(it);
                    },
                    itemBuilder: (c) => [
                      const PopupMenuItem(
                        value: 'stock',
                        child: Row(children: [Icon(Icons.add_shopping_cart, size: 16), SizedBox(width: 8), Text('Stock Jodein')]),
                      ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(children: [Icon(Icons.delete_outline, size: 16, color: SantuColors.red), SizedBox(width: 8), Text('Delete Item', style: TextStyle(color: SantuColors.red))]),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
