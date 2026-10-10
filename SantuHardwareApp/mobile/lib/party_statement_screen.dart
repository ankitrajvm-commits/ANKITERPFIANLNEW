import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'theme.dart';
import 'view_invoice_screen.dart';
import 'whatsapp_util.dart';

/// Utilities → Parties → tap a party → "Account" button on the PC
/// (santu_parties.js's open_party_khata_dialog / get_customer_khata): a
/// running khata for one party — every bill and every payment, in the order
/// they happened, with a balance after each row. Not a second ledger of its
/// own; it just replays the same bills/payments/manual-dues this app already
/// stores as one running account, the way a paper khata page reads.
///
/// debit/credit follow the PC's own convention: a sale adds to what the
/// party owes (debit), money received/paid subtracts (credit). A manual due
/// behaves like a sale (debit) — it exists specifically to record "owes me"
/// outside a formal bill.
class PartyStatementScreen extends StatefulWidget {
  final String partyType; // 'Customer' or 'Supplier'
  final String partyId;
  final String partyLabel;
  const PartyStatementScreen({super.key, required this.partyType, required this.partyId, required this.partyLabel});

  @override
  State<PartyStatementScreen> createState() => _PartyStatementScreenState();
}

class _StatementRow {
  final DateTime date;
  final String docNo;
  final String type;
  final double debit;
  final double credit;
  double balance = 0;
  final VoidCallback? onTap;
  _StatementRow({required this.date, required this.docNo, required this.type, required this.debit, required this.credit, this.onTap});
}

class _PartyStatementScreenState extends State<PartyStatementScreen> {
  bool _loading = true;
  bool get _isCustomer => widget.partyType == 'Customer';

  List<_StatementRow> _allRows = [];
  DateTime? _fromDate;
  DateTime _toDate = DateTime.now();
  double _openingBalance = 0;
  double _closingBalance = 0;
  List<_StatementRow> _visibleRows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = <_StatementRow>[];

    if (_isCustomer) {
      final bills = await AppDb.instance.invoicesForCustomer(widget.partyId);
      for (final b in bills) {
        final paid = b.amountReceived ?? 0;
        rows.add(_StatementRow(
          date: DateTime.tryParse(b.createdAt) ?? DateTime.now(),
          docNo: b.billNo ?? '-',
          type: 'Sale',
          debit: b.grandTotal,
          credit: paid,
          onTap: () async {
            final changed = await showDialog<bool>(context: context, builder: (ctx) => InvoiceDetailDialog(invoice: b));
            if (changed == true) _load();
          },
        ));
      }
    } else {
      // Purchases increase what the shop owes the supplier (credit, in the
      // supplier's own favour) — mirrors get_supplier_khata's sign, opposite
      // of a customer sale.
      final bills = await AppDb.instance.invoicesForSupplier(widget.partyId);
      for (final b in bills) {
        rows.add(_StatementRow(
          date: DateTime.tryParse(b.createdAt) ?? DateTime.now(),
          docNo: b.billNo ?? '-',
          type: 'Purchase',
          debit: 0,
          credit: b.grandTotal,
        ));
      }
    }

    final manualDues = await AppDb.instance.manualDuesFor(widget.partyType, widget.partyId);
    for (final m in manualDues) {
      rows.add(_StatementRow(
        date: DateTime.tryParse(m.createdAt) ?? DateTime.now(),
        docNo: 'Baki Jodein',
        type: _isCustomer ? 'Manual Due' : 'Manual Credit',
        debit: _isCustomer ? m.amount : 0,
        credit: _isCustomer ? 0 : m.amount,
      ));
    }

    final payments = await AppDb.instance.listPayments(customer: widget.partyId, partyType: widget.partyType);
    for (final p in payments) {
      rows.add(_StatementRow(
        date: DateTime.tryParse(p.createdAt) ?? DateTime.now(),
        docNo: p.note ?? (_isCustomer ? 'Payment In' : 'Payment Out'),
        type: _isCustomer ? 'Payment In' : 'Payment Out',
        debit: _isCustomer ? 0 : p.amount,
        credit: _isCustomer ? p.amount : 0,
      ));
    }

    rows.sort((a, b) => a.date.compareTo(b.date));

    if (!mounted) return;
    setState(() {
      _allRows = rows;
      _fromDate ??= rows.isNotEmpty ? DateTime(rows.first.date.year, rows.first.date.month, rows.first.date.day) : DateTime.now();
      _loading = false;
    });
    _recompute();
  }

  void _recompute() {
    final from = _fromDate ?? DateTime(2000);
    final toEnd = DateTime(_toDate.year, _toDate.month, _toDate.day, 23, 59, 59);

    double opening = 0;
    for (final r in _allRows) {
      if (r.date.isBefore(from)) opening += r.debit - r.credit;
    }

    double balance = opening;
    final visible = <_StatementRow>[];
    for (final r in _allRows) {
      if (r.date.isBefore(from) || r.date.isAfter(toEnd)) continue;
      balance += r.debit - r.credit;
      r.balance = balance;
      visible.add(r);
    }

    setState(() {
      _openingBalance = opening;
      _closingBalance = balance;
      _visibleRows = visible;
    });
  }

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: DateTimeRange(start: _fromDate ?? DateTime.now(), end: _toDate),
    );
    if (picked != null) {
      setState(() {
        _fromDate = picked.start;
        _toDate = picked.end;
      });
      _recompute();
    }
  }

  Future<void> _share() async {
    final fmt = DateFormat('dd MMM yyyy');
    final buf = StringBuffer();
    buf.writeln('*${widget.partyLabel} — Account Statement*');
    buf.writeln('${fmt.format(_fromDate ?? DateTime.now())} se ${fmt.format(_toDate)} tak');
    buf.writeln('');
    buf.writeln('Opening Balance: ₹${_openingBalance.toStringAsFixed(2)}');
    buf.writeln('');
    for (final r in _visibleRows) {
      final amt = r.debit > 0 ? '+₹${r.debit.toStringAsFixed(2)}' : '-₹${r.credit.toStringAsFixed(2)}';
      buf.writeln('${DateFormat('dd MMM').format(r.date)} · ${r.type} ${r.docNo} · $amt · Bal ₹${r.balance.toStringAsFixed(2)}');
    }
    buf.writeln('');
    buf.writeln('*Closing Balance: ₹${_closingBalance.toStringAsFixed(2)}*');
    if (!mounted) return;
    await shareViaWhatsApp(context, message: buf.toString(), docType: 'Account Statement', partyLabel: widget.partyLabel);
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('dd MMM yyyy');
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.partyLabel} — Statement'),
        actions: [
          IconButton(icon: const Icon(Icons.date_range), tooltip: 'Date Range', onPressed: _loading ? null : _pickRange),
          IconButton(icon: const Icon(Icons.share), tooltip: 'Share', onPressed: _loading || _visibleRows.isEmpty ? null : _share),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('${fmt.format(_fromDate ?? DateTime.now())} – ${fmt.format(_toDate)}', style: const TextStyle(color: SantuColors.textMuted)),
                      TextButton.icon(onPressed: _pickRange, icon: const Icon(Icons.calendar_today, size: 14), label: const Text('Badlo')),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Opening Balance', style: TextStyle(color: SantuColors.textMuted)),
                            Text('₹${_openingBalance.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          ],
                        ),
                        const Divider(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Closing Balance', style: TextStyle(fontWeight: FontWeight.bold)),
                            Text(
                              '₹${_closingBalance.toStringAsFixed(2)}',
                              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _closingBalance > 0.009 ? SantuColors.red : SantuColors.green),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (_visibleRows.isEmpty)
                    const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('Is date range me koi lena-dena nahi hai.', style: TextStyle(color: SantuColors.textMuted))))
                  else
                    for (final r in _visibleRows)
                      Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                        child: ListTile(
                          dense: true,
                          leading: Icon(
                            r.debit > 0 ? Icons.arrow_upward : Icons.arrow_downward,
                            color: r.debit > 0 ? SantuColors.red : SantuColors.green,
                            size: 18,
                          ),
                          title: Text('${r.type} · ${r.docNo}'),
                          subtitle: Text('${DateFormat('dd MMM yyyy').format(r.date)} · Balance ₹${r.balance.toStringAsFixed(2)}'),
                          trailing: Text(
                            r.debit > 0 ? '+₹${r.debit.toStringAsFixed(2)}' : '-₹${r.credit.toStringAsFixed(2)}',
                            style: TextStyle(fontWeight: FontWeight.w700, color: r.debit > 0 ? SantuColors.red : SantuColors.green),
                          ),
                          onTap: r.onTap,
                        ),
                      ),
                ],
              ),
            ),
    );
  }
}
