import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'models.dart';
import 'theme.dart';

/// Date-range sales summary — mirrors santu_reports_config.js's most-used
/// report (sales over a period) without yet porting the full report picker.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  DateTime _from = DateTime.now().subtract(const Duration(days: 6));
  DateTime _to = DateTime.now();
  bool _loading = true;
  List<Invoice> _bills = [];
  double _expenseTotal = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final db = await AppDb.instance.database;
    final fromStr = DateFormat('yyyy-MM-dd').format(_from);
    final toStr = DateFormat('yyyy-MM-dd').format(_to);
    final invRows = await db.query(
      'invoice',
      where: 'status = ? AND posting_date BETWEEN ? AND ? AND deleted_at IS NULL',
      whereArgs: ['saved', fromStr, toStr],
      orderBy: 'posting_date DESC',
    );
    final bills = <Invoice>[];
    for (final row in invRows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      bills.add(Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    final expenses = await AppDb.instance.listExpenses(fromDate: fromStr, toDate: toStr);
    setState(() {
      _bills = bills;
      _expenseTotal = expenses.fold(0.0, (s, e) => s + e.amount);
      _loading = false;
    });
  }

  double get _salesTotal => _bills.fold(0.0, (s, b) => s + b.grandTotal);
  int get _itemsSold => _bills.fold(0, (s, b) => s + b.totalQty);

  Map<String, double> get _byItem {
    final map = <String, double>{};
    for (final b in _bills) {
      for (final it in b.items) {
        map[it.itemName] = (map[it.itemName] ?? 0) + it.lineTotal;
      }
    }
    final entries = map.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    return {for (final e in entries.take(8)) e.key: e.value};
  }

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      initialDateRange: DateTimeRange(start: _from, end: _to),
    );
    if (picked != null) {
      setState(() {
        _from = picked.start;
        _to = picked.end;
      });
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('dd MMM');
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(14),
              children: [
                InkWell(
                  onTap: _pickRange,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('${fmt.format(_from)} – ${fmt.format(_to)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        const Icon(Icons.date_range, size: 18, color: SantuColors.blue),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(children: [
                  Expanded(child: _stat('Total Sales', '₹${_salesTotal.toStringAsFixed(0)}', SantuColors.green)),
                  const SizedBox(width: 10),
                  Expanded(child: _stat('Bills', '${_bills.length}', SantuColors.blue)),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: _stat('Items Sold', '$_itemsSold', SantuColors.blueLight)),
                  const SizedBox(width: 10),
                  Expanded(child: _stat('Expenses', '₹${_expenseTotal.toStringAsFixed(0)}', SantuColors.amber)),
                ]),
                const SizedBox(height: 10),
                _stat('Net (Sales − Expenses)', '₹${(_salesTotal - _expenseTotal).toStringAsFixed(0)}', const Color(0xFF9333EA), full: true),
                const SizedBox(height: 20),
                const Text('Top Items by Sale Value', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 8),
                if (_byItem.isEmpty)
                  const Padding(padding: EdgeInsets.all(20), child: Text('Is period mein koi sale nahi', style: TextStyle(color: SantuColors.textMuted)))
                else
                  Container(
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      children: [
                        for (final entry in _byItem.entries)
                          ListTile(dense: true, title: Text(entry.key), trailing: Text('₹${entry.value.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _stat(String label, String value, Color color, {bool full = false}) {
    return Container(
      width: full ? double.infinity : null,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
          Text(label, style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
        ],
      ),
    );
  }
}
