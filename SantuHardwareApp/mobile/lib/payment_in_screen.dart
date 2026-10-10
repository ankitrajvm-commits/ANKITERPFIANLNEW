import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'models.dart';
import 'theme.dart';

/// Sale > Payment In — list of collections against customer khata.
class PaymentInScreen extends StatefulWidget {
  const PaymentInScreen({super.key});

  @override
  State<PaymentInScreen> createState() => _PaymentInScreenState();
}

class _PaymentInScreenState extends State<PaymentInScreen> {
  bool _loading = true;
  List<Payment> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final db = await AppDb.instance.database;
    final rows = await db.query('payment', where: "party_type = 'Customer'", orderBy: 'date DESC, created_at DESC');
    setState(() {
      _rows = rows.map((r) => Payment.fromMap(r)).toList();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final total = _rows.fold(0.0, (s, p) => s + p.amount);
    return Scaffold(
      appBar: AppBar(title: const Text('Payment In')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('₹ ${total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                        Text('${_rows.length} payments', style: const TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: _rows.isEmpty
                      ? const Center(child: Text('Abhi koi Payment In nahi', style: TextStyle(color: SantuColors.textMuted)))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final p = _rows[i];
                            return ListTile(
                              title: Text(p.customerLabel),
                              subtitle: Text('${DateFormat('dd-MM-yyyy').format(DateTime.parse(p.date))}${p.note != null ? " · ${p.note}" : ""}'),
                              trailing: Text('₹${p.amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600, color: SantuColors.green)),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
