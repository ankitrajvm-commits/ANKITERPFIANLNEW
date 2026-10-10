import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'billing_screen.dart';
import 'db.dart';
import 'models.dart';
import 'theme.dart';
import 'transaction_actions.dart';
import 'view_invoice_screen.dart';

/// Sale > Sale Invoices — list with print / share / ⋮ per row (santu_sale_transactions.js).
class SaleInvoicesScreen extends StatefulWidget {
  const SaleInvoicesScreen({super.key});

  @override
  State<SaleInvoicesScreen> createState() => _SaleInvoicesScreenState();
}

class _SaleInvoicesScreenState extends State<SaleInvoicesScreen> {
  bool _loading = true;
  List<Invoice> _all = [];
  List<Invoice> _shown = [];
  String _range = 'This Month';
  final _searchCtrl = TextEditingController();

  double _totalSales = 0;
  double _received = 0;
  double _balance = 0;
  double _returns = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final db = await AppDb.instance.database;
    final rows = await db.query('invoice', where: "status = 'saved' AND deleted_at IS NULL", orderBy: 'created_at DESC');
    final bills = <Invoice>[];
    for (final row in rows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      bills.add(Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    setState(() {
      _all = bills;
      _loading = false;
    });
    await _applyFilters();
  }

  (DateTime, DateTime) _bounds() {
    final now = DateTime.now();
    switch (_range) {
      case 'Today':
        return (DateTime(now.year, now.month, now.day), DateTime(now.year, now.month, now.day));
      case 'This Week':
        final start = now.subtract(Duration(days: now.weekday - 1));
        return (DateTime(start.year, start.month, start.day), DateTime(now.year, now.month, now.day));
      case 'Last Month':
        final start = DateTime(now.year, now.month - 1, 1);
        final end = DateTime(now.year, now.month, 0);
        return (start, end);
      case 'This Month':
      default:
        return (DateTime(now.year, now.month, 1), DateTime(now.year, now.month, now.day));
    }
  }

  Future<void> _applyFilters() async {
    final (start, end) = _bounds();
    final q = _searchCtrl.text.toLowerCase();
    final filtered = _all.where((b) {
      final d = DateTime.tryParse(b.postingDate);
      if (d == null) return false;
      final day = DateTime(d.year, d.month, d.day);
      if (day.isBefore(start) || day.isAfter(end)) return false;
      if (q.isNotEmpty) {
        final hay = '${b.billNo} ${b.customerLabel}'.toLowerCase();
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();

    var total = 0.0;
    var recv = 0.0;
    var bal = 0.0;
    for (final b in filtered) {
      total += b.grandTotal;
      recv += b.amountReceived ?? 0;
      bal += b.baaki;
    }

    final fmt = DateFormat('yyyy-MM-dd');
    final ret = await AppDb.instance.totalSalesReturnsAmount(fromDate: fmt.format(start), toDate: fmt.format(end));

    setState(() {
      _shown = filtered;
      _totalSales = total;
      _received = recv;
      _balance = bal;
      _returns = ret;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sale Invoices'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
            child: FilledButton.icon(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BillingScreen())).then((_) => _load()),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('+ Add Sale'),
              style: FilledButton.styleFrom(
                backgroundColor: SantuColors.blue,
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              setState(() => _loading = true);
              _load();
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                  child: Row(
                    children: [
                      DropdownButton<String>(
                        value: _range,
                        items: const [
                          DropdownMenuItem(value: 'Today', child: Text('Today')),
                          DropdownMenuItem(value: 'This Week', child: Text('This Week')),
                          DropdownMenuItem(value: 'This Month', child: Text('This Month')),
                          DropdownMenuItem(value: 'Last Month', child: Text('Last Month')),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() => _range = v);
                            _applyFilters();
                          }
                        },
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('₹ ${_totalSales.toStringAsFixed(2)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                        const Text('Total Sales Amount', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                        const SizedBox(height: 8),
                        Text(
                          'Received: ₹ ${_received.toStringAsFixed(2)}  ·  Balance: ₹ ${_balance.toStringAsFixed(2)}${_returns > 0 ? "  ·  Returns: - ₹ ${_returns.toStringAsFixed(2)}" : ""}',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),

                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: TextField(
                    controller: _searchCtrl,
                    onChanged: (_) => _applyFilters(),
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search invoice or party'),
                  ),
                ),
                Expanded(
                  child: _shown.isEmpty
                      ? const Center(child: Text('Is range me koi bill nahi', style: TextStyle(color: SantuColors.textMuted)))
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _shown.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final b = _shown[i];
                            return ListTile(
                              title: Text(b.billNo ?? '-'),
                              subtitle: Text('${DateFormat('dd-MM-yyyy').format(DateTime.parse(b.postingDate))} · ${b.customerLabel ?? "Walk-in"}\n${b.paymentMode ?? "—"}'),
                              isThreeLine: true,
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                                      if (b.baaki > 0) Text('Baaki ₹${b.baaki.toStringAsFixed(2)}', style: const TextStyle(fontSize: 11, color: SantuColors.red)),
                                    ],
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.print_outlined, size: 20),
                                    onPressed: () => TransactionActions.printInvoice(context, b),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.share_outlined, size: 20),
                                    onPressed: () => TransactionActions.shareInvoice(context, b),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.more_vert, size: 20),
                                    onPressed: () => TransactionActions.showInvoiceMenu(context, b, onChanged: _load),
                                  ),
                                ],
                              ),
                              onTap: () async {
                                await showDialog(context: context, builder: (_) => InvoiceDetailDialog(invoice: b));
                                _load();
                              },
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
