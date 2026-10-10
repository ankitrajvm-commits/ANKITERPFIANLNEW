import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import 'db.dart';
import 'models.dart';
import 'theme.dart';

const _categories = ['Rent', 'Electricity', 'Labour', 'Transport', 'Maintenance', 'Misc'];

/// Shop expenses — mirrors santu_expense.js's core job (log a cost, see the
/// running list and total) without yet porting its recurring-expense rules.
class ExpenseScreen extends StatefulWidget {
  const ExpenseScreen({super.key});

  @override
  State<ExpenseScreen> createState() => _ExpenseScreenState();
}

class _ExpenseScreenState extends State<ExpenseScreen> {
  final _uuid = const Uuid();
  List<Expense> _all = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await AppDb.instance.listExpenses();
    setState(() {
      _all = rows;
      _loading = false;
    });
  }

  double get _total => _all.fold(0.0, (s, e) => s + e.amount);

  Future<void> _openEditor() async {
    String category = _categories.first;
    final amountCtrl = TextEditingController();
    final noteCtrl = TextEditingController();
    DateTime date = DateTime.now();

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setD) => AlertDialog(
          title: const Text('New Expense'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: [for (final c in _categories) DropdownMenuItem(value: c, child: Text(c))],
                  onChanged: (v) => setD(() => category = v ?? category),
                ),
                const SizedBox(height: 8),
                TextField(controller: amountCtrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount (₹)')),
                const SizedBox(height: 8),
                TextField(controller: noteCtrl, decoration: const InputDecoration(labelText: 'Note (optional)')),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('Date: ${DateFormat('yyyy-MM-dd').format(date)}'),
                  trailing: const Icon(Icons.calendar_today, size: 18),
                  onTap: () async {
                    final picked = await showDatePicker(context: ctx, initialDate: date, firstDate: DateTime(2020), lastDate: DateTime(2100));
                    if (picked != null) setD(() => date = picked);
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      ),
    );

    final amount = double.tryParse(amountCtrl.text);
    if (saved == true && amount != null && amount > 0) {
      await AppDb.instance.saveExpense(Expense(
        id: _uuid.v4(),
        category: category,
        amount: amount,
        date: DateFormat('yyyy-MM-dd').format(date),
        note: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
        createdAt: DateTime.now().toIso8601String(),
      ));
      _load();
    }
  }

  Future<void> _delete(Expense e) async {
    await AppDb.instance.deleteExpense(e.id);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _openEditor, icon: const Icon(Icons.add), label: const Text('New Expense')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Container(
                  margin: const EdgeInsets.all(12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Expenses', style: TextStyle(color: SantuColors.textMuted)),
                      Text('₹${_total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    ],
                  ),
                ),
                Expanded(
                  child: _all.isEmpty
                      ? const Center(child: Text('Koi expense nahi hai', style: TextStyle(color: SantuColors.textMuted)))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _all.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final e = _all[i];
                            return ListTile(
                              title: Text(e.category),
                              subtitle: Text('${e.date}${e.note != null ? " · ${e.note}" : ""}'),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text('₹${e.amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  IconButton(icon: const Icon(Icons.delete_outline, size: 18, color: SantuColors.red), onPressed: () => _delete(e)),
                                ],
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
