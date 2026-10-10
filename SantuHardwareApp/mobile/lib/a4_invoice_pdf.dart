import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'app_settings.dart';
import 'db.dart';
import 'models.dart';
import 'shareable_file.dart';
import 'uom_abbr.dart';

/// The A4 bill, ported from the PC's "Santu Hardware Bill (Sales Invoice)"
/// print format: same blocks in the same order — shop header and title
/// block, Billed To, the item table with its Total Qty footer, the totals
/// column, amount in words, the Account Summary panel, signature block and
/// footer (thanks, contact, legal line, reward points).
///
/// The PC renders that Jinja/HTML through wkhtmltopdf; Android has no such
/// renderer, so the same layout is drawn with the `pdf` package here. The
/// six A4 styles are the PC's own variants, driven by the same flags the
/// thermal library uses: what each one shows, not a different bill.
class A4Invoice {
  A4Invoice._();

  static final _money = NumberFormat('#,##0.00');

  /// Which blocks each A4 style prints. "Standard A4" is the full layout the
  /// PC format produces; the others drop or stamp parts of it.
  static const Map<String, Map<String, Object>> styles = {
    'Standard A4': {'acct': 1, 'sign': 1, 'words': 1, 'code': 0, 'legal': 1, 'banner': ''},
    'Professional A4': {'acct': 1, 'sign': 1, 'words': 1, 'code': 0, 'legal': 1, 'banner': ''},
    'Detailed A4': {'acct': 1, 'sign': 1, 'words': 1, 'code': 1, 'legal': 1, 'banner': ''},
    'Simple A4': {'acct': 0, 'sign': 0, 'words': 0, 'code': 0, 'legal': 0, 'banner': ''},
    'Customer Copy': {'acct': 1, 'sign': 1, 'words': 1, 'code': 0, 'legal': 1, 'banner': 'CUSTOMER COPY'},
    'Office Copy': {'acct': 1, 'sign': 1, 'words': 1, 'code': 1, 'legal': 1, 'banner': 'OFFICE COPY'},
  };

  static Map<String, Object> _style(String name) => styles[name] ?? styles['Standard A4']!;
  static bool _on(Map<String, Object> v, String k) => (v[k] as int? ?? 0) == 1;

  static const _ink = PdfColor.fromInt(0xFF0F172A);
  static const _muted = PdfColor.fromInt(0xFF64748B);
  static const _line = PdfColor.fromInt(0xFFCBD5E1);
  static const _brand = PdfColor.fromInt(0xFF1D4ED8);
  static const _due = PdfColor.fromInt(0xFFDC2626);
  static const _paid = PdfColor.fromInt(0xFF16A34A);
  static const _panel = PdfColor.fromInt(0xFFF8FAFC);

  static String _qty(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  /// Indian-system amount in words, the `in_words` line the PC bill prints
  /// under the totals ("Rupees One Thousand Only").
  static String inWords(double amount) {
    const ones = [
      '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
    ];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    String twoDigit(int n) => n < 20 ? ones[n] : '${tens[n ~/ 10]}${n % 10 == 0 ? '' : ' ${ones[n % 10]}'}';
    String threeDigit(int n) {
      final h = n ~/ 100, r = n % 100;
      return [if (h > 0) '${ones[h]} Hundred', if (r > 0) twoDigit(r)].join(' ');
    }

    final rupees = amount.floor();
    final paise = ((amount - rupees) * 100).round();
    if (rupees == 0 && paise == 0) return 'Rupees Zero Only';

    final parts = <String>[];
    // Indian grouping: crore, lakh, thousand, then the last three digits.
    final crore = rupees ~/ 10000000;
    final lakh = (rupees % 10000000) ~/ 100000;
    final thousand = (rupees % 100000) ~/ 1000;
    final rest = rupees % 1000;
    if (crore > 0) parts.add('${threeDigit(crore)} Crore');
    if (lakh > 0) parts.add('${twoDigit(lakh)} Lakh');
    if (thousand > 0) parts.add('${twoDigit(thousand)} Thousand');
    if (rest > 0) parts.add(threeDigit(rest));

    final rupeeWords = parts.isEmpty ? 'Zero' : parts.join(' ');
    final paiseWords = paise > 0 ? ' and ${twoDigit(paise)} Paise' : '';
    return 'Rupees $rupeeWords$paiseWords Only';
  }

  /// Builds the PDF bytes for [inv]. Everything it prints comes from the
  /// same places the thermal slip reads, so the two never disagree.
  static Future<List<int>> build(Invoice inv, {String? templateOverride}) async {
    final template = templateOverride ?? await AppSettings.defaultTemplate('WhatsApp A4 Library', 'Sales Invoice');
    final v = _style(template);

    final shopName = await AppSettings.shopName();
    final address = await AppSettings.companyAddressLine();
    final gstin = await AppSettings.gstin();
    final phone = await AppSettings.phone();
    final website = await AppSettings.website();
    final footer = await AppSettings.billFooter();
    final showLogo = await AppSettings.showLogoOnA4Bill();
    final a4LogoWidth = await AppSettings.a4LogoWidth();

    pw.MemoryImage? logoImage;
    if (showLogo) {
      try {
        final data = await rootBundle.load('assets/thermal_bill_logo.png');
        logoImage = pw.MemoryImage(data.buffer.asUint8List());
      } catch (_) {}
    }

    final customer = inv.customer == null ? null : await AppDb.instance.customerByName(inv.customer!);
    final previousBalance = await AppDb.instance.previousBalanceForCustomer(inv.customer, excludeInvoiceId: inv.id);
    final due = inv.baaki;
    final currentBalance = previousBalance + due;
    final loyalty = await AppDb.instance.getCustomerLoyaltySummary(inv.customer);

    final doc = pw.Document();
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.fromLTRB(28, 28, 28, 28),
        build: (context) => pw.DefaultTextStyle(
          style: const pw.TextStyle(fontSize: 9.5, color: _ink),
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              _header(inv, v, shopName, address, gstin, phone, due, logoImage: logoImage, a4LogoWidth: a4LogoWidth),
              pw.SizedBox(height: 14),
              _billedTo(inv, customer),
              pw.SizedBox(height: 12),
              _items(inv, _on(v, 'code')),
              pw.SizedBox(height: 10),
              _totals(inv, due),
              if (_on(v, 'words')) ...[
                pw.SizedBox(height: 6),
                pw.Text(inWords(inv.grandTotal), style: const pw.TextStyle(fontSize: 9, color: _muted)),
              ],
              if (_on(v, 'acct') && (previousBalance != 0 || due != 0)) ...[
                pw.SizedBox(height: 12),
                _accountSummary(previousBalance, inv.amountReceived ?? 0, currentBalance),
              ],
              pw.Spacer(),
              if (_on(v, 'sign')) _signature(shopName),
              pw.SizedBox(height: 10),
              _footer(shopName, website, footer, _on(v, 'legal'), loyalty.earned),
            ],
          ),
        ),
      ),
    );
    return doc.save();
  }

  static pw.Widget _header(Invoice inv, Map<String, Object> v, String shopName, String address, String? gstin,
      String? phone, double due, {pw.MemoryImage? logoImage, double a4LogoWidth = 40.0}) {
    final banner = v['banner'] as String? ?? '';
    return pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      if (banner.isNotEmpty)
        pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(bottom: 8),
          padding: const pw.EdgeInsets.symmetric(vertical: 4),
          color: _panel,
          child: pw.Center(
            child: pw.Text(banner, style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: _muted)),
          ),
        ),
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          flex: 6,
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            if (logoImage != null) ...[
              pw.Container(
                width: (a4LogoWidth / 100 * 240).clamp(60, 240),
                margin: const pw.EdgeInsets.only(bottom: 6),
                child: pw.Image(logoImage),
              ),
            ] else ...[
              pw.Text(shopName, style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: _brand)),
              pw.SizedBox(height: 3),
            ],
            if (address.isNotEmpty) pw.Text(address, style: const pw.TextStyle(fontSize: 9, color: _muted)),
            if (phone != null && phone.isNotEmpty)
              pw.Text('Phone: $phone', style: const pw.TextStyle(fontSize: 9, color: _muted)),
            if (gstin != null && gstin.isNotEmpty)
              pw.Text('GSTIN: $gstin', style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold)),
          ]),
        ),
        pw.Expanded(
          flex: 4,
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text(inv.status == InvoiceStatus.saved ? 'SALE BILL' : 'QUOTATION',
                style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 4),
            pw.Text('Bill No: ${inv.billNo ?? "-"}', style: const pw.TextStyle(fontSize: 9.5)),
            pw.Text('Date: ${inv.postingDate}', style: const pw.TextStyle(fontSize: 9.5)),
            pw.SizedBox(height: 5),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: pw.BoxDecoration(
                color: due > 0 ? const PdfColor.fromInt(0xFFFEE2E2) : const PdfColor.fromInt(0xFFDCFCE7),
                borderRadius: pw.BorderRadius.circular(9),
              ),
              child: pw.Text(due > 0 ? 'Payment Due' : 'Paid',
                  style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: due > 0 ? _due : _paid)),
            ),
          ]),
        ),
      ]),
    ]);
  }

  static pw.Widget _billedTo(Invoice inv, Customer? customer) => pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(8),
        decoration: pw.BoxDecoration(color: _panel, border: pw.Border.all(color: _line, width: 0.5)),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Text('BILLED TO', style: const pw.TextStyle(fontSize: 8, color: _muted)),
          pw.SizedBox(height: 2),
          pw.Text(inv.customerLabel ?? 'Walk-in Customer',
              style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
          if (customer?.phone != null && customer!.phone!.isNotEmpty)
            pw.Text('Phone: ${customer.phone}', style: const pw.TextStyle(fontSize: 9, color: _muted)),
          if (customer?.village != null && customer!.village!.isNotEmpty)
            pw.Text('Address: ${customer.village}', style: const pw.TextStyle(fontSize: 9, color: _muted)),
        ]),
      );

  static pw.Widget _items(Invoice inv, bool withCode) {
    final totalQty = inv.items.fold<double>(0, (s, i) => s + i.qty);
    pw.Widget cell(String t, {bool bold = false, pw.TextAlign align = pw.TextAlign.left}) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 4),
          child: pw.Text(t,
              textAlign: align,
              style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
        );

    return pw.Table(
      border: pw.TableBorder.all(color: _line, width: 0.5),
      columnWidths: {
        0: const pw.FixedColumnWidth(26),
        1: const pw.FlexColumnWidth(5),
        2: const pw.FlexColumnWidth(1.6),
        3: const pw.FlexColumnWidth(1.8),
        4: const pw.FlexColumnWidth(2),
      },
      children: [
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell('#', bold: true),
            cell('Item', bold: true),
            cell('Qty', bold: true, align: pw.TextAlign.right),
            cell('Rate', bold: true, align: pw.TextAlign.right),
            cell('Amount', bold: true, align: pw.TextAlign.right),
          ],
        ),
        for (var i = 0; i < inv.items.length; i++)
          pw.TableRow(children: [
            cell('${i + 1}'),
            cell(withCode ? '${inv.items[i].itemName}\n${inv.items[i].itemCode}' : inv.items[i].itemName),
            cell('${_qty(inv.items[i].qty)} ${uomAbbr(inv.items[i].uom)}', align: pw.TextAlign.right),
            cell(_money.format(inv.items[i].rate), align: pw.TextAlign.right),
            cell(_money.format(inv.items[i].lineTotal), align: pw.TextAlign.right),
          ]),
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell(''),
            cell(''),
            cell('Total Qty', bold: true, align: pw.TextAlign.right),
            cell(_qty(totalQty), bold: true, align: pw.TextAlign.right),
            cell(''),
          ],
        ),
      ],
    );
  }

  static pw.Widget _totals(Invoice inv, double due) {
    pw.Widget row(String label, String value, {bool bold = false, PdfColor? color}) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(vertical: 2),
          child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
            pw.Text(label,
                style: pw.TextStyle(
                    fontSize: bold ? 11 : 9.5,
                    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                    color: color ?? _ink)),
            pw.Text(value,
                style: pw.TextStyle(
                    fontSize: bold ? 11 : 9.5,
                    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                    color: color ?? _ink)),
          ]),
        );

    return pw.Row(children: [
      pw.Spacer(flex: 5),
      pw.Expanded(
        flex: 4,
        child: pw.Column(children: [
          // Only a discount someone actually gave: anything under a rupee is
          // the app's own rounding, exactly as the PC format gates it.
          if (inv.billDiscount.abs() >= 1) row('Discount', '- ${_money.format(inv.billDiscount.abs())}'),
          if (inv.redeemPoints > 0) row('Points Redeemed', '- ${_money.format(inv.redeemPoints)}'),
          pw.Divider(color: _line, height: 8),
          row('Total', _money.format(inv.grandTotal), bold: true),
          row('Paid', _money.format(inv.amountReceived ?? 0)),
          if (due > 0) row('Balance Due (This Bill)', _money.format(due), bold: true, color: _due),
        ]),
      ),
    ]);
  }

  static pw.Widget _accountSummary(double previous, double receivedToday, double current) => pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(9),
        decoration: pw.BoxDecoration(color: _panel, border: pw.Border.all(color: _line, width: 0.5)),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Text('ACCOUNT SUMMARY', style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _muted)),
          pw.SizedBox(height: 5),
          for (final e in [
            ('Previous Balance', previous, false),
            ('Received Today', receivedToday, false),
            ('Current Balance', current, true),
          ])
            pw.Padding(
              padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
              child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
                pw.Text(e.$1,
                    style: pw.TextStyle(fontSize: 9.5, fontWeight: e.$3 ? pw.FontWeight.bold : pw.FontWeight.normal)),
                pw.Text('Rs. ${_money.format(e.$2)}',
                    style: pw.TextStyle(
                        fontSize: 9.5,
                        fontWeight: e.$3 ? pw.FontWeight.bold : pw.FontWeight.normal,
                        color: e.$3 && e.$2 > 0 ? _due : _ink)),
              ]),
            ),
        ]),
      );

  static pw.Widget _signature(String shopName) => pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        crossAxisAlignment: pw.CrossAxisAlignment.end,
        children: [
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Container(width: 150, height: 0.5, color: _line),
            pw.SizedBox(height: 3),
            pw.Text("Customer's Signature", style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
          ]),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text('For $shopName', style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 22),
            pw.Container(width: 150, height: 0.5, color: _line),
            pw.SizedBox(height: 3),
            pw.Text('Authorised Signatory', style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
          ]),
        ],
      );

  static pw.Widget _footer(String shopName, String? website, String billFooter, bool legal, double earnedPoints) =>
      pw.Column(children: [
        pw.Divider(color: _line, height: 10),
        pw.Center(
          child: pw.Text(billFooter.isEmpty ? 'Thank you for shopping with $shopName!' : billFooter,
              style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold)),
        ),
        if (website != null && website.isNotEmpty) ...[
          pw.SizedBox(height: 2),
          pw.Center(child: pw.Text(website, style: const pw.TextStyle(fontSize: 8.5, color: _brand))),
        ],
        if (earnedPoints > 0) ...[
          pw.SizedBox(height: 3),
          pw.Center(
            child: pw.Text('Reward Points Earned: ${_qty(earnedPoints)}',
                style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _paid)),
          ),
        ],
        if (legal) ...[
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text('Goods once sold can only be exchanged, not refunded. Bill is required for exchange. E&OE.',
                style: const pw.TextStyle(fontSize: 7.5, color: _muted)),
          ),
        ],
      ]);

  /// Writes the PDF where share_plus can actually serve it (see
  /// shareable_file.dart) and hands back the path.
  static Future<String> writeToFile(Invoice inv, {String? templateOverride}) async {
    final bytes = await build(inv, templateOverride: templateOverride);
    final safeNo = (inv.billNo ?? 'bill').replaceAll(RegExp(r'[^A-Za-z0-9-]'), '_');
    final file = await shareableFile('$safeNo.pdf');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  /// Writes the QuickDoc A4 PDF for sharing / printing.
  static Future<String> writeToFileForQuickDoc(
    QuickDoc doc,
    String titleLabel, {
    String? kind,
    String? templateOverride,
  }) async {
    final bytes = await buildQuickDoc(doc, titleLabel, kind: kind, templateOverride: templateOverride);
    final safeNo = (doc.docNo ?? kind ?? 'doc').replaceAll(RegExp(r'[^A-Za-z0-9-]'), '_');
    final file = await shareableFile('$safeNo.pdf');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  static Future<List<int>> buildQuickDoc(
    QuickDoc d,
    String titleLabel, {
    String? kind,
    String? templateOverride,
  }) async {
    final docKind = kind ??
        (titleLabel.toLowerCase().contains('challan')
            ? 'challan'
            : (titleLabel.toLowerCase().contains('estimate') ? 'estimate' : 'quick_doc'));
    final isChallan = docKind == 'challan' || titleLabel.toLowerCase().contains('challan');
    final isEstimate = docKind == 'estimate' || titleLabel.toLowerCase().contains('estimate');
    final isPurchase = docKind.contains('purchase') || titleLabel.toLowerCase().contains('purchase');

    final docTypeKey = isChallan
        ? 'Delivery Note'
        : (isEstimate ? 'Quotation' : (isPurchase ? 'Purchase Order' : 'Sales Order'));

    final template = templateOverride ?? await AppSettings.defaultTemplate('WhatsApp A4 Library', docTypeKey);
    final v = _style(template);

    final shopName = await AppSettings.shopName();
    final address = await AppSettings.companyAddressLine();
    final gstin = await AppSettings.gstin();
    final phone = await AppSettings.phone();
    final website = await AppSettings.website();
    final footer = await AppSettings.billFooter();
    final showLogo = await AppSettings.showLogoOnA4Bill();
    final a4LogoWidth = await AppSettings.a4LogoWidth();

    pw.MemoryImage? logoImage;
    if (showLogo) {
      try {
        final data = await rootBundle.load('assets/thermal_bill_logo.png');
        logoImage = pw.MemoryImage(data.buffer.asUint8List());
      } catch (_) {}
    }

    final partyCustomer = (d.party != null && d.party!.isNotEmpty) ? await AppDb.instance.customer(d.party!) : null;

    final doc = pw.Document();
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.fromLTRB(28, 28, 28, 28),
        build: (context) => pw.DefaultTextStyle(
          style: const pw.TextStyle(fontSize: 9.5, color: _ink),
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              _quickDocHeader(
                d,
                v,
                shopName,
                address,
                gstin,
                phone,
                titleLabel,
                isChallan: isChallan,
                logoImage: logoImage,
                a4LogoWidth: a4LogoWidth,
              ),
              pw.SizedBox(height: 14),
              _quickDocParty(
                d,
                partyCustomer,
                isPurchase: isPurchase,
                isChallan: isChallan,
              ),
              pw.SizedBox(height: 12),
              isChallan ? _challanItems(d, _on(v, 'code')) : _quickDocItems(d, _on(v, 'code')),
              pw.SizedBox(height: 10),
              if (!isChallan) ...[
                _quickDocTotals(d),
                if (_on(v, 'words')) ...[
                  pw.SizedBox(height: 6),
                  pw.Text(inWords(d.grandTotal), style: const pw.TextStyle(fontSize: 9, color: _muted)),
                ],
              ],
              pw.Spacer(),
              if (isChallan)
                _challanSignatures(shopName)
              else if (_on(v, 'sign'))
                _signature(shopName),
              pw.SizedBox(height: 10),
              if (isChallan)
                pw.Center(
                  child: pw.Text(
                    'Goods delivered in good condition and order. Rates are not shown. E&OE.',
                    style: const pw.TextStyle(fontSize: 8, color: _muted),
                  ),
                )
              else
                _footer(shopName, website, footer, _on(v, 'legal'), 0),
            ],
          ),
        ),
      ),
    );
    return doc.save();
  }

  static pw.Widget _quickDocHeader(
    QuickDoc d,
    Map<String, Object> v,
    String shopName,
    String address,
    String? gstin,
    String? phone,
    String titleLabel, {
    required bool isChallan,
    pw.MemoryImage? logoImage,
    double a4LogoWidth = 40.0,
  }) {
    final banner = v['banner'] as String? ?? '';
    final docTitle = isChallan ? 'DELIVERY CHALLAN' : titleLabel.toUpperCase();
    return pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      if (banner.isNotEmpty)
        pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(bottom: 8),
          padding: const pw.EdgeInsets.symmetric(vertical: 4),
          color: _panel,
          child: pw.Center(
            child: pw.Text(banner, style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: _muted)),
          ),
        ),
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          flex: 6,
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            if (logoImage != null) ...[
              pw.Container(
                width: (a4LogoWidth / 100 * 240).clamp(60, 240),
                margin: const pw.EdgeInsets.only(bottom: 6),
                child: pw.Image(logoImage),
              ),
            ] else ...[
              pw.Text(shopName, style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: _brand)),
              pw.SizedBox(height: 3),
            ],
            if (address.isNotEmpty) pw.Text(address, style: const pw.TextStyle(fontSize: 9, color: _muted)),
            if (phone != null && phone.isNotEmpty)
              pw.Text('Phone: $phone', style: const pw.TextStyle(fontSize: 9, color: _muted)),
            if (gstin != null && gstin.isNotEmpty)
              pw.Text('GSTIN: $gstin', style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold)),
          ]),
        ),
        pw.Expanded(
          flex: 4,
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text(docTitle, style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 4),
            pw.Text('${isChallan ? "Challan" : "Doc"} No: ${d.docNo ?? "-"}',
                style: const pw.TextStyle(fontSize: 9.5)),
            pw.Text('Date: ${d.postingDate}', style: const pw.TextStyle(fontSize: 9.5)),
            pw.SizedBox(height: 5),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: pw.BoxDecoration(
                color: isChallan ? const PdfColor.fromInt(0xFFEFF6FF) : const PdfColor.fromInt(0xFFDCFCE7),
                borderRadius: pw.BorderRadius.circular(9),
              ),
              child: pw.Text(isChallan ? 'Delivered' : (d.status == InvoiceStatus.saved ? 'Saved' : 'Draft'),
                  style: pw.TextStyle(
                      fontSize: 8.5,
                      fontWeight: pw.FontWeight.bold,
                      color: isChallan ? _brand : _paid)),
            ),
          ]),
        ),
      ]),
    ]);
  }

  static pw.Widget _quickDocParty(
    QuickDoc d,
    Customer? cust, {
    required bool isPurchase,
    required bool isChallan,
  }) =>
      pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(8),
        decoration: pw.BoxDecoration(color: _panel, border: pw.Border.all(color: _line, width: 0.5)),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Text(isChallan ? 'DELIVERED TO / PARTY' : (isPurchase ? 'SUPPLIER DETAILS' : 'BILLED TO'),
              style: const pw.TextStyle(fontSize: 8, color: _muted)),
          pw.SizedBox(height: 2),
          pw.Text(d.partyLabel ?? (isPurchase ? 'Supplier' : 'Customer'),
              style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
          if (cust?.phone != null && cust!.phone!.isNotEmpty)
            pw.Text('Phone: ${cust.phone}', style: const pw.TextStyle(fontSize: 9, color: _muted)),
          if (cust?.village != null && cust!.village!.isNotEmpty)
            pw.Text('Address: ${cust.village}', style: const pw.TextStyle(fontSize: 9, color: _muted)),
        ]),
      );

  static pw.Widget _challanItems(QuickDoc d, bool withCode) {
    final totalQty = d.items.fold<double>(0, (s, i) => s + i.qty);
    pw.Widget cell(String t, {bool bold = false, pw.TextAlign align = pw.TextAlign.left}) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 4),
          child: pw.Text(t,
              textAlign: align,
              style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
        );

    return pw.Table(
      border: pw.TableBorder.all(color: _line, width: 0.5),
      columnWidths: {
        0: const pw.FixedColumnWidth(26),
        1: const pw.FlexColumnWidth(6),
        2: const pw.FlexColumnWidth(2.5),
      },
      children: [
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell('#', bold: true),
            cell('Item Description', bold: true),
            cell('Quantity Delivered', bold: true, align: pw.TextAlign.right),
          ],
        ),
        for (var i = 0; i < d.items.length; i++)
          pw.TableRow(children: [
            cell('${i + 1}'),
            cell(withCode ? '${d.items[i].itemName}\n${d.items[i].itemCode}' : d.items[i].itemName),
            cell('${_qty(d.items[i].qty)} ${uomAbbr(d.items[i].uom)}', align: pw.TextAlign.right),
          ]),
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell(''),
            cell('Total Quantity', bold: true, align: pw.TextAlign.right),
            cell(_qty(totalQty), bold: true, align: pw.TextAlign.right),
          ],
        ),
      ],
    );
  }

  static pw.Widget _quickDocItems(QuickDoc d, bool withCode) {
    final totalQty = d.items.fold<double>(0, (s, i) => s + i.qty);
    pw.Widget cell(String t, {bool bold = false, pw.TextAlign align = pw.TextAlign.left}) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 4),
          child: pw.Text(t,
              textAlign: align,
              style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
        );

    return pw.Table(
      border: pw.TableBorder.all(color: _line, width: 0.5),
      columnWidths: {
        0: const pw.FixedColumnWidth(26),
        1: const pw.FlexColumnWidth(5),
        2: const pw.FlexColumnWidth(1.6),
        3: const pw.FlexColumnWidth(1.8),
        4: const pw.FlexColumnWidth(2),
      },
      children: [
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell('#', bold: true),
            cell('Item', bold: true),
            cell('Qty', bold: true, align: pw.TextAlign.right),
            cell('Rate', bold: true, align: pw.TextAlign.right),
            cell('Amount', bold: true, align: pw.TextAlign.right),
          ],
        ),
        for (var i = 0; i < d.items.length; i++)
          pw.TableRow(children: [
            cell('${i + 1}'),
            cell(withCode ? '${d.items[i].itemName}\n${d.items[i].itemCode}' : d.items[i].itemName),
            cell('${_qty(d.items[i].qty)} ${uomAbbr(d.items[i].uom)}', align: pw.TextAlign.right),
            cell(_money.format(d.items[i].rate), align: pw.TextAlign.right),
            cell(_money.format(d.items[i].lineTotal), align: pw.TextAlign.right),
          ]),
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _panel),
          children: [
            cell(''),
            cell(''),
            cell('Total Qty', bold: true, align: pw.TextAlign.right),
            cell(_qty(totalQty), bold: true, align: pw.TextAlign.right),
            cell(''),
          ],
        ),
      ],
    );
  }

  static pw.Widget _quickDocTotals(QuickDoc d) {
    pw.Widget row(String label, String value, {bool bold = false}) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(vertical: 2),
          child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
            pw.Text(label,
                style: pw.TextStyle(
                    fontSize: bold ? 11 : 9.5,
                    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                    color: _ink)),
            pw.Text(value,
                style: pw.TextStyle(
                    fontSize: bold ? 11 : 9.5,
                    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                    color: _ink)),
          ]),
        );

    return pw.Row(children: [
      pw.Spacer(flex: 5),
      pw.Expanded(
        flex: 4,
        child: pw.Column(children: [
          pw.Divider(color: _line, height: 8),
          row('Total', _money.format(d.grandTotal), bold: true),
        ]),
      ),
    ]);
  }

  static pw.Widget _challanSignatures(String shopName) => pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text("Receiver's Signature", style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 22),
            pw.Container(width: 150, height: 0.5, color: _line),
            pw.SizedBox(height: 3),
            pw.Text('Received in good condition', style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
          ]),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text('For $shopName', style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 22),
            pw.Container(width: 150, height: 0.5, color: _line),
            pw.SizedBox(height: 3),
            pw.Text('Authorised Signatory', style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
          ]),
        ],
      );
}
