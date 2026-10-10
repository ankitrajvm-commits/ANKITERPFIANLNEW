import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import 'db.dart';
import 'models.dart';
import 'party_statement_screen.dart';
import 'theme.dart';
import 'view_invoice_screen.dart';

/// "Customers owe me" / "I owe suppliers" — mirrors santu_customer_dues.js's
/// two-tab toggle, "+ Baki Jodein" manual due, Collect/Pay action, and the
/// per-party dialog listing every bill (tap one to edit it, same as the web
/// screen's santu_open_invoice_view).
class CustomerDuesScreen extends StatelessWidget {
  const CustomerDuesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Dues'),
          bottom: const TabBar(tabs: [
            Tab(text: 'Customers owe me'),
            Tab(text: 'I owe suppliers'),
          ]),
        ),
        body: const TabBarView(children: [
          _DuesList(partyType: 'Customer'),
          _DuesList(partyType: 'Supplier'),
        ]),
      ),
    );
  }
}

class _DuesList extends StatefulWidget {
  final String partyType; // 'Customer' or 'Supplier'
  const _DuesList({required this.partyType});

  @override
  State<_DuesList> createState() => _DuesListState();
}

class _DuesListState extends State<_DuesList> {
  final _uuid = const Uuid();
  bool _loading = true;
  List<MapEntry<Object, double>> _dues = []; // Customer or Supplier keyed

  bool get _isCustomer => widget.partyType == 'Customer';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = _isCustomer ? await AppDb.instance.customerDues() : await AppDb.instance.supplierDues();
    setState(() {
      _dues = rows.map((e) => MapEntry<Object, double>(e.key, e.value)).toList();
      _loading = false;
    });
  }

  double get _total => _dues.fold(0.0, (s, e) => s + e.value);

  String _nameOf(Object party) => party is Customer ? party.customerName : (party as Supplier).supplierName;
  String _idOf(Object party) => party is Customer ? party.name : (party as Supplier).name;

  Future<void> _addManualDue() async {
    final amountCtrl = TextEditingController();
    final noteCtrl = TextEditingController();
    final List<dynamic> parties = _isCustomer ? await AppDb.instance.allCustomers() : await AppDb.instance.allSuppliers();
    dynamic selected;
    if (!mounted) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Baki Jodein'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<dynamic>(
                value: selected,
                decoration: InputDecoration(labelText: _isCustomer ? 'Customer' : 'Supplier'),
                items: [
                  for (final p in parties)
                    DropdownMenuItem(
                      value: p,
                      child: Text(
                        _isCustomer
                            ? '${(p as Customer).customerName}${(p.village != null && p.village!.isNotEmpty) ? ' (${p.village})' : ''}'
                            : (p as Supplier).supplierName,
                      ),
                    ),
                ],
                onChanged: (v) => setDialogState(() => selected = v),
              ),
              const SizedBox(height: 8),
              TextField(controller: amountCtrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount (₹)')),
              const SizedBox(height: 8),
              TextField(controller: noteCtrl, decoration: const InputDecoration(labelText: 'Note (optional)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
          ],
        ),
      ),
    );
    final amount = double.tryParse(amountCtrl.text);
    if (saved == true && selected != null && amount != null && amount > 0) {
      await AppDb.instance.saveManualDue(ManualDue(
        id: _uuid.v4(),
        partyType: widget.partyType,
        party: _idOf(selected),
        partyLabel: _nameOf(selected),
        amount: amount,
        date: DateFormat('yyyy-MM-dd').format(DateTime.now()),
        note: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
        createdAt: DateTime.now().toIso8601String(),
      ));
      _load();
    }
  }

  Future<void> _recordPayment(Object party, double due) async {
    final amountCtrl = TextEditingController(text: due.toStringAsFixed(2));
    final noteCtrl = TextEditingController();
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_isCustomer ? 'Payment from ${_nameOf(party)}' : 'Payment to ${_nameOf(party)}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Baaki: ₹${due.toStringAsFixed(2)}', style: const TextStyle(color: SantuColors.textMuted)),
            const SizedBox(height: 10),
            TextField(controller: amountCtrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: _isCustomer ? 'Amount Received (₹)' : 'Amount Paid (₹)')),
            const SizedBox(height: 8),
            TextField(controller: noteCtrl, decoration: const InputDecoration(labelText: 'Note (optional)')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(_isCustomer ? 'Record Payment' : 'Record Payment Out')),
        ],
      ),
    );
    final amount = double.tryParse(amountCtrl.text);
    if (saved == true && amount != null && amount > 0) {
      await AppDb.instance.savePayment(Payment(
        id: _uuid.v4(),
        customer: _idOf(party),
        customerLabel: _nameOf(party),
        amount: amount,
        date: DateFormat('yyyy-MM-dd').format(DateTime.now()),
        note: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
        partyType: widget.partyType,
        createdAt: DateTime.now().toIso8601String(),
      ));
      _load();
    }
  }

  Future<void> _showHistory(Object party, double due) async {
    await showDialog<void>(context: context, builder: (ctx) => _PartyHistoryDialog(partyType: widget.partyType, partyId: _idOf(party), partyLabel: _nameOf(party), due: due));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return _loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(14),
              children: [
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(_isCustomer ? 'Total Outstanding' : 'Total Payable', style: const TextStyle(color: SantuColors.textMuted)),
                      Text('₹${_total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: SantuColors.red)),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(onPressed: _addManualDue, icon: const Icon(Icons.add, size: 18), label: const Text('Baki Jodein')),
                const SizedBox(height: 14),
                if (_dues.isEmpty)
                  Padding(padding: const EdgeInsets.all(20), child: Text(_isCustomer ? 'Kisi customer pe koi baaki nahi hai 🎉' : 'Kisi supplier ko kuch dena nahi hai 🎉', style: const TextStyle(color: SantuColors.textMuted)))
                else
                  for (final entry in _dues)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                      child: ListTile(
                        title: Text(_nameOf(entry.key)),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (entry.key is Customer &&
                                (((entry.key as Customer).village != null && (entry.key as Customer).village!.isNotEmpty) ||
                                    ((entry.key as Customer).phone != null && (entry.key as Customer).phone!.isNotEmpty)))
                              Padding(
                                padding: const EdgeInsets.only(bottom: 2),
                                child: Text(
                                  [
                                    if ((entry.key as Customer).phone != null && (entry.key as Customer).phone!.isNotEmpty)
                                      (entry.key as Customer).phone!,
                                    if ((entry.key as Customer).village != null && (entry.key as Customer).village!.isNotEmpty)
                                      (entry.key as Customer).village!,
                                  ].join(' · '),
                                  style: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
                                ),
                              ),
                            Text('Baaki: ₹${entry.value.toStringAsFixed(2)}',
                                style: const TextStyle(color: SantuColors.red, fontWeight: FontWeight.w600)),
                          ],
                        ),
                        onTap: () => _showHistory(entry.key, entry.value),
                        trailing: FilledButton(onPressed: () => _recordPayment(entry.key, entry.value), child: Text(_isCustomer ? 'Collect' : 'Pay')),
                      ),
                    ),
              ],
            ),
          );
  }
}

/// All bills, manual dues and payments for one party, newest first — tap a
/// bill to open it (view/delete/WhatsApp/Edit — Edit hands it to Billing or
/// Purchase via the PrefillBus, same flow as Estimate's Convert to Bill).
class _PartyHistoryDialog extends StatefulWidget {
  final String partyType;
  final String partyId;
  final String partyLabel;
  final double due;
  const _PartyHistoryDialog({required this.partyType, required this.partyId, required this.partyLabel, required this.due});

  @override
  State<_PartyHistoryDialog> createState() => _PartyHistoryDialogState();
}

class _HistoryRow {
  final DateTime date;
  final Widget tile;
  _HistoryRow(this.date, this.tile);
}

class _PartyHistoryDialogState extends State<_PartyHistoryDialog> {
  bool _loading = true;
  List<_HistoryRow> _rows = [];

  bool get _isCustomer => widget.partyType == 'Customer';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = <_HistoryRow>[];
    if (_isCustomer) {
      final bills = await AppDb.instance.invoicesForCustomer(widget.partyId);
      for (final b in bills) {
        rows.add(_HistoryRow(
          DateTime.tryParse(b.createdAt) ?? DateTime.now(),
          ListTile(
            dense: true,
            leading: const Icon(Icons.receipt_long, color: SantuColors.blue),
            title: Text(b.billNo ?? '-'),
            subtitle: Text('${b.postingDate} · Baaki ₹${b.baaki.toStringAsFixed(2)}'),
            trailing: Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
            onTap: () async {
              final changed = await showDialog<bool>(context: context, builder: (ctx) => InvoiceDetailDialog(invoice: b));
              if (changed == true) _load();
            },
          ),
        ));
      }
    } else {
      final bills = await AppDb.instance.invoicesForSupplier(widget.partyId);
      for (final b in bills) {
        rows.add(_HistoryRow(
          DateTime.tryParse(b.createdAt) ?? DateTime.now(),
          ListTile(
            dense: true,
            leading: const Icon(Icons.local_shipping, color: SantuColors.blue),
            title: Text(b.billNo ?? '-'),
            subtitle: Text(b.postingDate),
            trailing: Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
            onTap: () async {
              final changed = await showDialog<bool>(context: context, builder: (ctx) => PurchaseInvoiceDetailDialog(invoice: b));
              if (changed == true) _load();
            },
          ),
        ));
      }
    }

    final manualDues = await AppDb.instance.manualDuesFor(widget.partyType, widget.partyId);
    for (final m in manualDues) {
      rows.add(_HistoryRow(
        DateTime.tryParse(m.createdAt) ?? DateTime.now(),
        ListTile(
          dense: true,
          leading: const Icon(Icons.edit_note, color: SantuColors.amber),
          title: const Text('Baki Jodein'),
          subtitle: Text('${m.date}${m.note != null ? " · ${m.note}" : ""}'),
          trailing: Text('+₹${m.amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600, color: SantuColors.amber)),
        ),
      ));
    }

    final payments = await AppDb.instance.listPayments(customer: widget.partyId, partyType: widget.partyType);
    for (final p in payments) {
      rows.add(_HistoryRow(
        DateTime.tryParse(p.createdAt) ?? DateTime.now(),
        ListTile(
          dense: true,
          leading: Icon(Icons.payments, color: SantuColors.green),
          title: Text(_isCustomer ? 'Payment In' : 'Payment Out'),
          subtitle: Text('${p.date}${p.note != null ? " · ${p.note}" : ""}'),
          trailing: Text('-₹${p.amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600, color: SantuColors.green)),
        ),
      ));
    }

    rows.sort((a, b) => b.date.compareTo(a.date));
    if (mounted) {
      setState(() {
        _rows = rows;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.partyLabel),
      content: SizedBox(
        width: 340,
        height: 420,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _rows.isEmpty
                ? const Center(child: Text('Koi transaction nahi', style: TextStyle(color: SantuColors.textMuted)))
                : ListView.separated(itemCount: _rows.length, separatorBuilder: (_, __) => const Divider(height: 1), itemBuilder: (ctx, i) => _rows[i].tile),
      ),
      actions: [
        TextButton.icon(
          onPressed: () {
            Navigator.pop(context);
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => PartyStatementScreen(partyType: widget.partyType, partyId: widget.partyId, partyLabel: widget.partyLabel),
              ),
            );
          },
          icon: const Icon(Icons.receipt_long_outlined, size: 16),
          label: const Text('Full Statement'),
        ),
        FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    );
  }
}
