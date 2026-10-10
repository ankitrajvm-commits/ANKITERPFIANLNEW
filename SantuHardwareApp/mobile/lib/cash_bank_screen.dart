import 'package:flutter/material.dart';

import 'db.dart';
import 'theme.dart';

/// How much money came in through each payment mode, minus expenses (which
/// are assumed paid from cash) — mirrors santu_cash_bank.js's balance-by
/// -mode summary, scoped to what this app already records.
class CashBankScreen extends StatefulWidget {
  const CashBankScreen({super.key});

  @override
  State<CashBankScreen> createState() => _CashBankScreenState();
}

class _CashBankScreenState extends State<CashBankScreen> {
  bool _loading = true;
  Map<String, double> _byMode = {};
  double _expenseTotal = 0;
  double _paymentsCollected = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final db = await AppDb.instance.database;
    final rows = await db.query('invoice', where: "status = 'saved' AND deleted_at IS NULL");
    final byMode = <String, double>{};
    for (final row in rows) {
      final mode = (row['payment_mode'] as String?) ?? 'Cash';
      final received = (row['amount_received'] as num?)?.toDouble() ?? 0;
      byMode[mode] = (byMode[mode] ?? 0) + received;
    }
    final expenses = await AppDb.instance.listExpenses();
    final payments = await AppDb.instance.listPayments();
    setState(() {
      _byMode = byMode;
      _expenseTotal = expenses.fold(0.0, (s, e) => s + e.amount);
      _paymentsCollected = payments.fold(0.0, (s, p) => s + p.amount);
      _loading = false;
    });
  }

  double get _totalIn => _byMode.values.fold(0.0, (s, v) => s + v) + _paymentsCollected;
  double get _netCash => (_byMode['Cash'] ?? 0) + _paymentsCollected - _expenseTotal;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cash & Bank')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: SantuColors.green.withValues(alpha: 0.08), border: Border.all(color: SantuColors.green.withValues(alpha: 0.3)), borderRadius: BorderRadius.circular(10)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Net Cash in Hand', style: TextStyle(color: SantuColors.textMuted)),
                        Text('₹${_netCash.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: SantuColors.green)),
                        const Text('(Cash sales + collected dues − expenses)', style: TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text('By Payment Mode', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 8),
                  Container(
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      children: [
                        for (final entry in _byMode.entries) ListTile(dense: true, title: Text(entry.key), trailing: Text('₹${entry.value.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        const Divider(height: 1),
                        ListTile(dense: true, title: const Text('Dues Collected'), trailing: Text('₹${_paymentsCollected.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        const Divider(height: 1),
                        ListTile(
                          dense: true,
                          title: const Text('Total In', style: TextStyle(fontWeight: FontWeight.bold)),
                          trailing: Text('₹${_totalIn.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
                        ),
                        ListTile(
                          dense: true,
                          title: const Text('Expenses', style: TextStyle(color: SantuColors.red)),
                          trailing: Text('−₹${_expenseTotal.toStringAsFixed(2)}', style: const TextStyle(color: SantuColors.red, fontWeight: FontWeight.w600)),
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
