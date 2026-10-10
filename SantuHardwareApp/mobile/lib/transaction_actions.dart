import 'package:flutter/material.dart';

import 'a4_invoice_pdf.dart';
import 'db.dart';
import 'models.dart';
import 'prefill_bus.dart';
import 'theme.dart';
import 'thermal_receipt.dart';
import 'view_invoice_screen.dart';
import 'whatsapp_util.dart';

/// Shared ⋮ / row actions for sale invoices and quick docs — mirrors
/// santu_sale_transactions.js and santu_purchase_transactions.js.
class TransactionActions {
  static Future<void> printInvoice(BuildContext context, Invoice inv) async {
    final err = await ThermalReceipt.printSalesBill(inv);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err ?? 'Printed ✓')));
  }

  static Future<void> shareInvoice(BuildContext context, Invoice inv, {String? phone, bool asPdf = false}) async {
    final templates = await AppDb.instance.listMessageTemplates();
    final template = templates['Sales Transaction'] ?? 'Namaste {party}, aapka bill {doc_no} ₹{amount} ka ban gaya hai.';
    final msg = fillTemplate(template, {'party': inv.customerLabel ?? 'Customer', 'doc_no': inv.billNo ?? '', 'amount': inv.grandTotal.toStringAsFixed(2)});
    String? pdfPath;
    if (asPdf) {
      try {
        pdfPath = await A4Invoice.writeToFile(inv);
      } catch (e) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('A4 PDF ban nahi paya: $e')));
        return;
      }
    }
    if (!context.mounted) return;
    await shareViaWhatsApp(context,
        message: msg,
        docType: 'Sales Transaction',
        docNo: inv.billNo,
        partyLabel: inv.customerLabel,
        phone: phone,
        attachmentPath: pdfPath);
  }

  static void showInvoiceMenu(BuildContext context, Invoice inv, {VoidCallback? onChanged}) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.open_in_new),
              title: const Text('Open'),
              onTap: () {
                Navigator.pop(ctx);
                showDialog(context: context, builder: (_) => InvoiceDetailDialog(invoice: inv)).then((_) => onChanged?.call());
              },
            ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Edit Bill'),
              onTap: () {
                Navigator.pop(ctx);
                PrefillBus.send(inv);
                Navigator.of(context).popUntil((route) => route.isFirst);
              },
            ),
            ListTile(
              leading: const Icon(Icons.print),
              title: const Text('Print'),
              onTap: () {
                Navigator.pop(ctx);
                printInvoice(context, inv);
              },
            ),
            ListTile(
              leading: const Icon(Icons.chat_outlined),
              title: const Text('Send on WhatsApp'),
              onTap: () {
                Navigator.pop(ctx);
                shareInvoice(context, inv);
              },
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Send A4 PDF'),
              subtitle: const Text('Poora A4 bill — Invoice Settings wala template'),
              onTap: () {
                Navigator.pop(ctx);
                shareInvoice(context, inv, asPdf: true);
              },
            ),
            ListTile(
              leading: const Icon(Icons.arrow_outward),
              title: const Text('↗ Kisi aur ko'),
              onTap: () async {
                Navigator.pop(ctx);
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
                if (ok == true && phoneCtrl.text.trim().length >= 10 && context.mounted) {
                  await shareInvoice(context, inv, phone: phoneCtrl.text.trim());
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: SantuColors.red),
              title: const Text('Delete Bill', style: TextStyle(color: SantuColors.red)),
              onTap: () async {
                Navigator.pop(ctx);
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (c2) => AlertDialog(
                    title: const Text('Bill delete karein?'),
                    content: Text('${inv.billNo} Recycle Bin me jayega.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(c2, false), child: const Text('Cancel')),
                      FilledButton(onPressed: () => Navigator.pop(c2, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Delete')),
                    ],
                  ),
                );
                if (ok == true) {
                  await AppDb.instance.softDelete('invoice', 'id', inv.id);
                  onChanged?.call();
                }
              },
            ),
          ],
        ),
      ),
    );
  }


  static void showQuickDocMenu(
    BuildContext context, {
    required QuickDoc doc,
    required String kind,
    required String titleLabel,
    VoidCallback? onOpen,
    VoidCallback? onDelete,
    VoidCallback? onConvertToBill,
    bool canConvert = false,
  }) {
    final convertLabel = kind == 'challan' ? 'Bill Banao' : 'Convert to Bill';
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.open_in_new),
              title: const Text('Open'),
              onTap: () {
                Navigator.pop(ctx);
                onOpen?.call();
              },
            ),
            if (canConvert && onConvertToBill != null)
              ListTile(
                leading: const Icon(Icons.point_of_sale, color: SantuColors.green),
                title: Text(convertLabel, style: const TextStyle(fontWeight: FontWeight.bold, color: SantuColors.green)),
                onTap: () {
                  Navigator.pop(ctx);
                  onConvertToBill();
                },
              ),
            ListTile(
              leading: const Icon(Icons.print),
              title: const Text('Print'),
              onTap: () async {
                Navigator.pop(ctx);
                final err = (kind == 'estimate')
                    ? await ThermalReceipt.printEstimate(doc)
                    : await ThermalReceipt.printQuickDoc(doc, titleLabel);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err ?? 'Printed ✓')));
              },
            ),
            ListTile(
              leading: const Icon(Icons.chat_outlined),
              title: const Text('Send on WhatsApp'),
              onTap: () async {
                Navigator.pop(ctx);
                final templates = await AppDb.instance.listMessageTemplates();
                final docTypeKey = kind == 'estimate'
                    ? 'Quotation'
                    : (kind == 'challan'
                        ? 'Delivery Note'
                        : (kind == 'sales_order' ? 'Sales Order' : titleLabel));
                final template = templates[docTypeKey] ?? 'Namaste {party}, aapka $titleLabel {doc_no} ban gaya hai. Total: ₹{amount}';
                final msg = fillTemplate(template, {
                  'party': doc.partyLabel ?? 'Party',
                  'doc_no': doc.docNo ?? '',
                  'amount': doc.grandTotal.toStringAsFixed(2),
                });
                if (!context.mounted) return;
                await shareViaWhatsApp(context, message: msg, docType: docTypeKey, docNo: doc.docNo, partyLabel: doc.partyLabel);
              },
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Send A4 PDF'),
              subtitle: Text(kind == 'challan' ? 'Delivery Challan PDF (bina rate wala)' : 'A4 PDF document'),
              onTap: () async {
                Navigator.pop(ctx);
                String? pdfPath;
                try {
                  pdfPath = await A4Invoice.writeToFileForQuickDoc(doc, titleLabel, kind: kind);
                } catch (e) {
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('A4 PDF ban nahi paya: $e')));
                  return;
                }
                final templates = await AppDb.instance.listMessageTemplates();
                final docTypeKey = kind == 'estimate'
                    ? 'Quotation'
                    : (kind == 'challan'
                        ? 'Delivery Note'
                        : (kind == 'sales_order' ? 'Sales Order' : titleLabel));
                final template = templates[docTypeKey] ?? 'Namaste {party}, aapka $titleLabel {doc_no} ban gaya hai.';
                final msg = fillTemplate(template, {
                  'party': doc.partyLabel ?? 'Party',
                  'doc_no': doc.docNo ?? '',
                  'amount': doc.grandTotal.toStringAsFixed(2),
                });
                if (!context.mounted) return;
                await shareViaWhatsApp(context,
                    message: msg,
                    docType: docTypeKey,
                    docNo: doc.docNo,
                    partyLabel: doc.partyLabel,
                    attachmentPath: pdfPath);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: SantuColors.red),
              title: Text('Delete $titleLabel', style: const TextStyle(color: SantuColors.red)),
              onTap: () {
                Navigator.pop(ctx);
                onDelete?.call();
              },
            ),
          ],
        ),
      ),
    );
  }
}
