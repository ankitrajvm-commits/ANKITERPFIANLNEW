import 'package:flutter/material.dart';

import 'db.dart';
import 'models.dart';
import 'prefill_bus.dart';
import 'theme.dart';
import 'thermal_receipt.dart';
import 'whatsapp_util.dart';

/// Every saved bill, newest first, with a tap-to-reprint receipt — mirrors
/// santu_view_invoice.js's list + print action.
class ViewInvoiceScreen extends StatefulWidget {
  const ViewInvoiceScreen({super.key});

  @override
  State<ViewInvoiceScreen> createState() => _ViewInvoiceScreenState();
}

class _ViewInvoiceScreenState extends State<ViewInvoiceScreen> {
  bool _loading = true;
  List<Invoice> _bills = [];
  final _searchCtrl = TextEditingController();
  List<Invoice> _shown = [];

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
      _bills = bills;
      _shown = bills;
      _loading = false;
    });
  }

  void _filter(String q) {
    final tokens = searchTokens(q);
    setState(() {
      _shown = tokens.isEmpty ? _bills : _bills.where((b) => matchesAllTokens(tokens, [b.billNo, b.customerLabel])).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('View Invoice')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: TextField(controller: _searchCtrl, onChanged: _filter, decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search by bill no or customer')),
                ),
                Expanded(
                  child: _shown.isEmpty
                      ? const Center(child: Text('Koi bill nahi mili', style: TextStyle(color: SantuColors.textMuted)))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _shown.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final b = _shown[i];
                            return ListTile(
                              title: Text(b.billNo ?? '-'),
                              subtitle: Text('${b.customerLabel ?? "Walk-in"} · ${b.postingDate}'),
                              trailing: Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                              onTap: () async {
                                final deleted = await showDialog<bool>(context: context, builder: (ctx) => InvoiceDetailDialog(invoice: b));
                                if (deleted == true) _load();
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

/// Shared read/delete/WhatsApp/edit dialog for a single saved bill — used
/// by View Invoice's own list and by Customer Dues' per-party transaction
/// history, so "edit this transaction" works the same from either place.
class InvoiceDetailDialog extends StatelessWidget {
  final Invoice invoice;
  const InvoiceDetailDialog({super.key, required this.invoice});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(invoice.billNo ?? '-'),
      content: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Date: ${invoice.postingDate}'),
            if (invoice.customerLabel != null) Text('Customer: ${invoice.customerLabel}'),
            Text('Payment: ${invoice.paymentMode ?? "-"}'),
            const Divider(),
            for (final it in invoice.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(child: Text('${it.itemName} x${it.qty.toStringAsFixed(0)}', style: const TextStyle(fontSize: 12))),
                    Text(it.lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            const Divider(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Grand Total', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('₹${invoice.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            if (invoice.baaki > 0) Text('Baaki: ₹${invoice.baaki.toStringAsFixed(2)}', style: const TextStyle(color: SantuColors.red)),
          ],
        ),
      ),
      actions: [
        TextButton.icon(
          onPressed: () async {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (c2) => AlertDialog(
                title: const Text('Bill delete karein?'),
                content: const Text('Recycle Bin mein chala jayega — wahan se wapas la sakte ho. Stock wapas nahi hoga automatically.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c2, false), child: const Text('Cancel')),
                  FilledButton(onPressed: () => Navigator.pop(c2, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Delete')),
                ],
              ),
            );
            if (confirmed == true) {
              await AppDb.instance.softDelete('invoice', 'id', invoice.id);
              if (context.mounted) Navigator.pop(context, true);
            }
          },
          icon: const Icon(Icons.delete_outline, size: 18, color: SantuColors.red),
          label: const Text('Delete', style: TextStyle(color: SantuColors.red)),
        ),
        TextButton.icon(
          onPressed: () async {
            final error = await ThermalReceipt.printSalesBill(invoice);
            if (!context.mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error ?? 'Printed ✓')));
          },
          icon: const Icon(Icons.print, size: 18),
          label: const Text('Print'),
        ),
        TextButton.icon(
          onPressed: () {
            PrefillBus.send(invoice);
            Navigator.of(context).popUntil((route) => route.isFirst);
          },
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: const Text('Edit'),
        ),
        TextButton.icon(
          onPressed: () async {
            final templates = await AppDb.instance.listMessageTemplates();
            final template = templates['Sales Transaction'] ?? 'Namaste {party}, aapka bill {doc_no} ₹{amount} ka ban gaya hai.';
            final msg = fillTemplate(template, {'party': invoice.customerLabel ?? 'Customer', 'doc_no': invoice.billNo ?? '', 'amount': invoice.grandTotal.toStringAsFixed(2)});
            if (!context.mounted) return;
            await shareViaWhatsApp(context, message: msg, docType: 'Sales Transaction', docNo: invoice.billNo, partyLabel: invoice.customerLabel);
          },
          icon: const Icon(Icons.share, size: 18),
          label: const Text('WhatsApp'),
        ),
        TextButton.icon(
          onPressed: () async {
            final phoneCtrl = TextEditingController();
            final ok = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: const Text('Kisi aur ko bhejein'),
                content: TextField(
                  controller: phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: '10-digit WhatsApp number', hintText: '9876543210'),
                ),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                  FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Send')),
                ],
              ),
            );
            if (ok == true && phoneCtrl.text.trim().length >= 10) {
              final templates = await AppDb.instance.listMessageTemplates();
              final template = templates['Sales Transaction'] ?? 'Namaste {party}, aapka bill {doc_no} ₹{amount} ka ban gaya hai.';
              final msg = fillTemplate(template, {'party': invoice.customerLabel ?? 'Customer', 'doc_no': invoice.billNo ?? '', 'amount': invoice.grandTotal.toStringAsFixed(2)});
              if (!context.mounted) return;
              await shareViaWhatsApp(context, message: msg, docType: 'Sales Transaction', docNo: invoice.billNo, partyLabel: invoice.customerLabel, phone: phoneCtrl.text.trim());
            }
          },
          icon: const Icon(Icons.arrow_outward, size: 18),
          label: const Text('Kisi aur ko'),
        ),
        FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    );

  }
}

/// PurchaseInvoice counterpart of [InvoiceDetailDialog] — used by Customer
/// Dues' "I owe suppliers" tab for a supplier's transaction history.
class PurchaseInvoiceDetailDialog extends StatelessWidget {
  final PurchaseInvoice invoice;
  const PurchaseInvoiceDetailDialog({super.key, required this.invoice});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(invoice.billNo ?? '-'),
      content: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Date: ${invoice.postingDate}'),
            if (invoice.supplierLabel != null) Text('Supplier: ${invoice.supplierLabel}'),
            const Divider(),
            for (final it in invoice.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(child: Text('${it.itemName} x${it.qty.toStringAsFixed(0)}', style: const TextStyle(fontSize: 12))),
                    Text(it.lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            const Divider(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Grand Total', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('₹${invoice.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton.icon(
          onPressed: () async {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (c2) => AlertDialog(
                title: const Text('Bill delete karein?'),
                content: const Text('Recycle Bin mein chala jayega — wahan se wapas la sakte ho. Stock wapas nahi hoga automatically.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c2, false), child: const Text('Cancel')),
                  FilledButton(onPressed: () => Navigator.pop(c2, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Delete')),
                ],
              ),
            );
            if (confirmed == true) {
              await AppDb.instance.softDelete('purchase_invoice', 'id', invoice.id);
              if (context.mounted) Navigator.pop(context, true);
            }
          },
          icon: const Icon(Icons.delete_outline, size: 18, color: SantuColors.red),
          label: const Text('Delete', style: TextStyle(color: SantuColors.red)),
        ),
        TextButton.icon(
          onPressed: () async {
            final error = await ThermalReceipt.printPurchaseBill(invoice);
            if (!context.mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error ?? 'Printed ✓')));
          },
          icon: const Icon(Icons.print, size: 18),
          label: const Text('Print'),
        ),
        TextButton.icon(
          onPressed: () {
            PurchasePrefillBus.send(invoice);
            Navigator.of(context).popUntil((route) => route.isFirst);
          },
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: const Text('Edit'),
        ),
        FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    );
  }
}
