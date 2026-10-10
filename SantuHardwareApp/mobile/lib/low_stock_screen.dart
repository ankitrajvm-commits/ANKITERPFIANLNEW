import 'package:flutter/material.dart';

import 'db.dart';
import 'models.dart';
import 'theme.dart';

/// Items at or below a reorder threshold — mirrors santu_low_stock.js's job.
/// Threshold is fixed at 5 for now (the web screen's per-item reorder level
/// isn't ported yet — flagged honestly rather than silently simplified).
class LowStockScreen extends StatefulWidget {
  const LowStockScreen({super.key});

  @override
  State<LowStockScreen> createState() => _LowStockScreenState();
}

class _LowStockScreenState extends State<LowStockScreen> {
  bool _loading = true;
  List<Item> _items = [];
  double _threshold = 5;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final all = await AppDb.instance.allItems();
    setState(() {
      _items = all.where((i) => i.availableQty <= _threshold).toList()..sort((a, b) => a.availableQty.compareTo(b.availableQty));
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Low Stock')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  Row(
                    children: [
                      const Text('Threshold:'),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Slider(
                          value: _threshold,
                          min: 1,
                          max: 50,
                          divisions: 49,
                          label: _threshold.toStringAsFixed(0),
                          onChanged: (v) => setState(() => _threshold = v),
                          onChangeEnd: (_) => _load(),
                        ),
                      ),
                      Text(_threshold.toStringAsFixed(0)),
                    ],
                  ),
                  if (_items.isEmpty)
                    const Padding(padding: EdgeInsets.all(20), child: Text('Koi item low stock mein nahi hai 👍', style: TextStyle(color: SantuColors.textMuted)))
                  else
                    Container(
                      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                      child: Column(
                        children: [
                          for (final it in _items)
                            ListTile(
                              title: Text(it.itemName),
                              subtitle: Text(it.itemCode),
                              trailing: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(6)),
                                child: Text('${it.availableQty.toStringAsFixed(0)} ${it.stockUom}', style: const TextStyle(color: Color(0xFFB91C1C), fontWeight: FontWeight.w700, fontSize: 12)),
                              ),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
