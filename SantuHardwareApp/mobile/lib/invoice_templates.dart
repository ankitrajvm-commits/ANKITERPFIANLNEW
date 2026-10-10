import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

import 'theme.dart';
import 'thermal_receipt.dart';

class DocTypeDefinition {
  final String key;
  final String label;
  final String prefix;
  final bool isReturn;

  const DocTypeDefinition({
    required this.key,
    required this.label,
    required this.prefix,
    this.isReturn = false,
  });
}

class TemplateInfo {
  final String id;
  final String name;
  final String desc;

  const TemplateInfo({
    required this.id,
    required this.name,
    required this.desc,
  });
}

class InvoiceTemplates {
  InvoiceTemplates._();

  static const List<DocTypeDefinition> documentTypes = [
    DocTypeDefinition(key: 'Sales Invoice', label: 'Sale Bill', prefix: ''),
    DocTypeDefinition(key: 'Sales Return', label: 'Sales Return / Credit Note', prefix: 'Return', isReturn: true),
    DocTypeDefinition(key: 'Quotation', label: 'Estimate / Quotation', prefix: 'Estimate'),
    DocTypeDefinition(key: 'Sales Order', label: 'Sales Order', prefix: 'Order'),
    DocTypeDefinition(key: 'Delivery Note', label: 'Delivery Challan', prefix: 'Challan'),
    DocTypeDefinition(key: 'Purchase Invoice', label: 'Purchase Bill', prefix: 'Purchase'),
    DocTypeDefinition(key: 'Purchase Return', label: 'Purchase Return / Debit Note', prefix: 'Purchase Return', isReturn: true),
    DocTypeDefinition(key: 'Purchase Order', label: 'Purchase Order', prefix: 'Purchase Order'),
    DocTypeDefinition(key: 'Payment Entry', label: 'Payment In / Out', prefix: 'Receipt'),
    DocTypeDefinition(key: 'Stock Entry', label: 'Receive Stock (Goods Received)', prefix: 'Goods Received'),
    DocTypeDefinition(key: 'Khata Statement', label: 'Account Statement', prefix: 'Khata'),
  ];

  static const List<TemplateInfo> thermalSaleTemplates = [
    TemplateInfo(
      id: 'Standard Bill',
      name: 'Standard Bill',
      desc: 'Everything: items, totals, account summary and Scan & Pay QR.',
    ),
    TemplateInfo(
      id: 'Compact Bill',
      name: 'Compact Bill',
      desc: 'Smaller type, no QR, no account block. Saves roll on long bills.',
    ),
    TemplateInfo(
      id: 'Detailed Bill',
      name: 'Detailed Bill',
      desc: 'Adds item code under each name, a discount column and payment split.',
    ),
    TemplateInfo(
      id: 'Simple Cash Bill',
      name: 'Simple Cash Bill',
      desc: 'No customer, no running account. Just items and total for a walk-in.',
    ),
    TemplateInfo(
      id: 'Customer Copy',
      name: 'Customer Copy',
      desc: 'Standard bill stamped CUSTOMER COPY.',
    ),
    TemplateInfo(
      id: 'Duplicate / Office Copy',
      name: 'Duplicate / Office Copy',
      desc: 'Stamped DUPLICATE, with item codes and a signature line.',
    ),
    TemplateInfo(
      id: 'Bill + Payment Receipt',
      name: 'Bill + Payment Receipt',
      desc: 'Standard bill plus a mode-wise payment receipt and change returned.',
    ),
    TemplateInfo(
      id: 'Delivery Slip (No Rates)',
      name: 'Delivery Slip (No Rates)',
      desc: 'Items and quantities only, no prices. Send goods with a helper safely.',
    ),
    TemplateInfo(
      id: 'Large Print Bill',
      name: 'Large Print Bill',
      desc: "Bigger type throughout, for reading at arm's length.",
    ),
    TemplateInfo(
      id: 'Udhaar / Balance Bill',
      name: 'Udhaar / Balance Bill',
      desc: 'Balance due printed large at the top, with a signature line.',
    ),
    TemplateInfo(
      id: 'Minimal Slip',
      name: 'Minimal Slip',
      desc: 'Bill number, item count and total only. Smallest possible slip.',
    ),
  ];

  static const List<TemplateInfo> a4SaleTemplates = [
    TemplateInfo(
      id: 'Standard A4',
      name: 'Standard A4',
      desc: 'Clean and standard A4 document layout with complete breakdown.',
    ),
    TemplateInfo(
      id: 'Professional A4',
      name: 'Professional A4',
      desc: 'Premium aesthetic with bolder colored headers and clean borders.',
    ),
    TemplateInfo(
      id: 'Detailed A4',
      name: 'Detailed A4',
      desc: 'Includes all item details, item codes, HSN, and taxes.',
    ),
    TemplateInfo(
      id: 'Simple A4',
      name: 'Simple A4',
      desc: 'Minimalist A4 slip without excessive borders or signatures.',
    ),
    TemplateInfo(
      id: 'Customer Copy',
      name: 'Customer Copy',
      desc: 'Standard A4 stamped CUSTOMER COPY with warranty notice.',
    ),
    TemplateInfo(
      id: 'Office Copy',
      name: 'Office Copy',
      desc: 'Standard A4 stamped OFFICE COPY with receiver acknowledgment line.',
    ),
  ];

  static List<TemplateInfo> getTemplates(String library, String docTypeKey) {
    if (docTypeKey == 'Sales Invoice') {
      return library == 'Thermal Invoice Library' ? thermalSaleTemplates : a4SaleTemplates;
    }

    if (library == 'Thermal Invoice Library') {
      if (docTypeKey == 'Khata Statement') {
        return const [
          TemplateInfo(id: 'Thermal Khata', name: 'Thermal Account Statement', desc: 'Poora chalta account — har bill, payment, balance.'),
          TemplateInfo(id: 'Thermal Khata (Compact)', name: 'Thermal Account Statement (Compact)', desc: 'Wahi account, bina saaman ki line — date, bill no, amount.'),
        ];
      }
      return const [
        TemplateInfo(id: 'Standard', name: 'Standard', desc: 'Poora parcha — saaman, matra, rate aur total.'),
        TemplateInfo(id: 'Compact', name: 'Compact', desc: 'Chhote akshar, kam jagah. Lambi list me roll bachta hai.'),
        TemplateInfo(id: 'Detailed', name: 'Detailed', desc: 'Har saaman ke neeche uska code bhi.'),
        TemplateInfo(id: 'Large Print', name: 'Large Print', desc: 'Bade akshar — door se bhi padha jaye.'),
        TemplateInfo(id: 'Duplicate Copy', name: 'Duplicate Copy', desc: 'Upar DUPLICATE COPY ki mohar.'),
      ];
    } else {
      if (docTypeKey == 'Khata Statement') {
        return const [
          TemplateInfo(id: 'A4 Khata', name: 'A4 Account Statement', desc: 'Poora A4 statement — har bill ke saaman ke saath.'),
        ];
      }
      return const [
        TemplateInfo(id: 'Standard A4', name: 'Standard A4', desc: 'Saaf-suthra A4 dastavez.'),
        TemplateInfo(id: 'Professional A4', name: 'Professional A4', desc: 'Gehra header, bada title.'),
        TemplateInfo(id: 'Detailed A4', name: 'Detailed A4', desc: 'Har saaman ke neeche uska code.'),
        TemplateInfo(id: 'Simple A4', name: 'Simple A4', desc: 'Halki lines, bina signature — kam jagah.'),
        TemplateInfo(id: 'Office Copy', name: 'Office Copy', desc: 'Upar OFFICE COPY ki mohar.'),
      ];
    }
  }
}

class InvoicePreviewData {
  final String shopName;
  final String? gstin;
  final String? address;
  final String? phone;
  final String? website;
  final String docType;
  final String docNo;
  final String date;
  final String partyLabel;
  final String partyPhone;
  final List<({String name, String code, double qty, String uom, double rate, double discount, double amount})> items;
  final double subtotal;
  final double discount;
  final double additionalCharges;
  final double redeemPoints;
  final double grandTotal;
  final double received;
  final double balance;
  final String paymentMode;
  final String footer;
  final bool showLogo;
  final double thermalLogoWidth;
  final double a4LogoWidth;

  /// The shop's own UPI ID, so the preview's Scan & Pay block shows the real
  /// QR that would print rather than a stand-in. Null when none is saved yet.
  final String? upiId;

  const InvoicePreviewData({
    required this.shopName,
    this.gstin,
    this.address,
    this.phone,
    this.website,
    required this.docType,
    required this.docNo,
    required this.date,
    required this.partyLabel,
    required this.partyPhone,
    required this.items,
    required this.subtotal,
    required this.discount,
    required this.additionalCharges,
    required this.redeemPoints,
    required this.grandTotal,
    required this.received,
    required this.balance,
    required this.paymentMode,
    required this.footer,
    this.showLogo = true,
    this.thermalLogoWidth = 65.0,
    this.a4LogoWidth = 40.0,
    this.upiId,
  });

  factory InvoicePreviewData.sample(String docType, {bool showLogo = true, double thermalLogoWidth = 65.0, double a4LogoWidth = 40.0}) {
    String docNo = 'B-1042';
    String party = 'Ramesh Sharma';
    if (docType == 'Quotation') {
      docNo = 'EST-108';
    } else if (docType == 'Delivery Note') {
      docNo = 'DC-204';
    } else if (docType == 'Sales Return') {
      docNo = 'SR-031';
    } else if (docType == 'Purchase Invoice') {
      docNo = 'PB-512';
      party = 'Supreme Lifeline Pipes';
    } else if (docType == 'Khata Statement') {
      docNo = 'ACC-992';
    }

    final items = [
      (name: 'Supreme PVC Pipe 1 inch', code: 'SP-101', qty: 5.0, uom: 'Nos', rate: 240.0, discount: 0.0, amount: 1200.0),
      (name: 'Brass Bib Tap 1/2 inch', code: 'BT-04', qty: 2.0, uom: 'Pcs', rate: 350.0, discount: 50.0, amount: 650.0),
      (name: 'Teflon Tape Roll 12mm', code: 'TF-12', qty: 4.0, uom: 'Roll', rate: 25.0, discount: 0.0, amount: 100.0),
    ];

    return InvoicePreviewData(
      shopName: 'Santu Hardware',
      gstin: '10ABCDE1234F1Z5',
      address: 'Main Road, Station Chowk, Purnea, Bihar - 854301',
      phone: '+91 98765 43210',
      website: 'www.santuhardware.in',
      docType: docType,
      docNo: docNo,
      date: '09/10/2026',
      partyLabel: party,
      partyPhone: '9876543210',
      items: items,
      subtotal: 1950.0,
      discount: 50.0,
      additionalCharges: 0.0,
      redeemPoints: 100.0,
      grandTotal: 1800.0,
      received: 1500.0,
      balance: 300.0,
      paymentMode: 'Cash',
      footer: 'Thank you! Visit again.',
      showLogo: showLogo,
      thermalLogoWidth: thermalLogoWidth,
      a4LogoWidth: a4LogoWidth,
    );
  }
}

class ThermalStyleRule {
  final String cls;
  final bool cust;
  final bool addr;
  final bool price;
  final bool qr;
  final bool code;
  final bool disc;
  final bool acct;
  final bool pay;
  final bool sign;
  final bool foot;
  final String banner;

  const ThermalStyleRule({
    this.cls = '',
    this.cust = true,
    this.addr = true,
    this.price = true,
    this.qr = true,
    this.code = false,
    this.disc = false,
    this.acct = true,
    this.pay = false,
    this.sign = false,
    this.foot = true,
    this.banner = '',
  });
}

/// Visual Thermal Receipt Widget replicating 80mm ESC/POS layout for all PC styles.
class ThermalReceiptWidget extends StatelessWidget {
  final InvoicePreviewData data;
  final String templateId;

  const ThermalReceiptWidget({
    super.key,
    required this.data,
    required this.templateId,
  });

  static const Map<String, ThermalStyleRule> _thermalStyles = {
    'Standard Bill': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: false, foot: true, banner: ''),
    'Compact Bill': ThermalStyleRule(cls: 'v-compact', cust: true, addr: true, price: true, qr: false, code: false, disc: false, acct: false, pay: false, sign: false, foot: false, banner: ''),
    'Detailed Bill': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: true, disc: true, acct: true, pay: true, sign: false, foot: true, banner: ''),
    'Simple Cash Bill': ThermalStyleRule(cls: '', cust: false, addr: false, price: true, qr: false, code: false, disc: false, acct: false, pay: false, sign: false, foot: true, banner: ''),
    'Customer Copy': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: false, foot: true, banner: 'CUSTOMER COPY'),
    'Duplicate / Office Copy': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: false, code: true, disc: false, acct: true, pay: false, sign: true, foot: false, banner: 'DUPLICATE - OFFICE COPY'),
    'Bill + Payment Receipt': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: true, sign: false, foot: true, banner: ''),
    'Delivery Slip (No Rates)': ThermalStyleRule(cls: '', cust: true, addr: true, price: false, qr: false, code: true, disc: false, acct: false, pay: false, sign: true, foot: false, banner: 'DELIVERY SLIP - NOT A BILL'),
    'Large Print Bill': ThermalStyleRule(cls: 'v-large', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: false, foot: true, banner: ''),
    'Udhaar / Balance Bill': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: true, foot: false, banner: ''),
    'Minimal Slip': ThermalStyleRule(cls: 'v-compact', cust: false, addr: false, price: true, qr: false, code: false, disc: false, acct: false, pay: false, sign: false, foot: false, banner: ''),
    'Standard': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: false, foot: true, banner: ''),
    'Compact': ThermalStyleRule(cls: 'v-compact', cust: true, addr: true, price: true, qr: false, code: false, disc: false, acct: false, pay: false, sign: false, foot: false, banner: ''),
    'Detailed': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: true, code: true, disc: true, acct: true, pay: true, sign: false, foot: true, banner: ''),
    'Large Print': ThermalStyleRule(cls: 'v-large', cust: true, addr: true, price: true, qr: true, code: false, disc: false, acct: true, pay: false, sign: false, foot: true, banner: ''),
    'Duplicate Copy': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: false, code: true, disc: false, acct: true, pay: false, sign: true, foot: false, banner: 'DUPLICATE COPY'),
    'Thermal Khata': ThermalStyleRule(cls: '', cust: true, addr: true, price: true, qr: false, code: false, disc: false, acct: true, pay: true, sign: false, foot: true, banner: ''),
    'Thermal Khata (Compact)': ThermalStyleRule(cls: 'v-compact', cust: true, addr: true, price: true, qr: false, code: false, disc: false, acct: true, pay: true, sign: false, foot: false, banner: ''),
  };

  @override
  Widget build(BuildContext context) {
    final rule = _thermalStyles[templateId] ?? const ThermalStyleRule();
    final isChallan = data.docType.contains('Delivery') || data.docType.contains('Challan') || templateId == 'Delivery Slip (No Rates)' || !rule.price;
    final isEstimate = data.docType.contains('Quotation') || data.docType.contains('Estimate');
    final isPurchase = data.docType.contains('Purchase');
    final isPayment = data.docType.contains('Payment');
    final isUdhaar = templateId == 'Udhaar / Balance Bill';
    final isMinimal = templateId == 'Minimal Slip';
    final isLarge = rule.cls == 'v-large';
    final isCompact = rule.cls == 'v-compact';

    final baseFontSize = isLarge ? 14.0 : (isCompact ? 10.5 : 12.0);
    final headerFontSize = isLarge ? 18.0 : 15.0;

    return Container(
      width: 320,
      padding: EdgeInsets.all(isCompact ? 10.0 : 16.0),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF8),
        borderRadius: BorderRadius.circular(4),
        boxShadow: const [
          BoxShadow(color: Color(0x1F000000), blurRadius: 10, offset: Offset(0, 3)),
        ],
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Logo or Company Header (Matching PC template top)
          if (data.showLogo) ...[
            Center(
              child: Image.asset(
                'assets/thermal_bill_logo.png',
                width: (data.thermalLogoWidth * 3.5).clamp(80.0, 275.0),
                fit: BoxFit.contain,
                errorBuilder: (ctx, err, stack) => Text(
                  data.shopName,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: headerFontSize,
                    fontWeight: FontWeight.w900,
                    color: Colors.black,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
          ] else ...[
            Center(
              child: Text(
                data.shopName,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: headerFontSize,
                  fontWeight: FontWeight.w900,
                  color: Colors.black,
                ),
              ),
            ),
            const SizedBox(height: 2),
          ],

          // 2. Address & Contact info if addr flag enabled
          if (rule.addr && data.address != null && data.address!.isNotEmpty)
            Center(
              child: Text(
                data.address!,
                textAlign: TextAlign.center,
                style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 2, color: Colors.black87),
              ),
            ),
          if (rule.addr && data.gstin != null && data.gstin!.isNotEmpty)
            Center(
              child: Text(
                'GSTIN: ${data.gstin}',
                style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold),
              ),
            ),
          if (data.phone != null && data.phone!.isNotEmpty)
            Center(
              child: Text(
                'Ph: ${data.phone}',
                style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1),
              ),
            ),

          const SizedBox(height: 4),
          _dashedLine(),
          const SizedBox(height: 4),

          // 3. Banner stamp if defined
          if (rule.banner.isNotEmpty) ...[
            _stamp(rule.banner),
            const SizedBox(height: 4),
          ],

          // 4. Document Type Title
          Center(
            child: Text(
              isChallan
                  ? 'DELIVERY CHALLAN'
                  : isEstimate
                      ? 'ESTIMATE'
                      : (data.docType.contains('Sales Return') || data.docType.contains('Credit Note'))
                          ? 'SALES RETURN / CREDIT NOTE'
                          : (data.docType.contains('Purchase') && (data.docType.contains('Invoice') || data.docType.contains('Bill')))
                              ? 'PURCHASE BILL'
                              : (data.docType.contains('Purchase') && data.docType.contains('Order'))
                                  ? 'PURCHASE ORDER'
                                  : isPayment
                                      ? 'PAYMENT RECEIPT'
                                      : (data.docType.contains('Stock') || data.docType.contains('Goods'))
                                          ? 'GOODS RECEIVED'
                                          : (data.docType.contains('Khata') || data.docType.contains('Account'))
                                              ? 'ACCOUNT STATEMENT'
                                              : 'INVOICE',
              style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize + 1, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 4),
          _dashedLine(),
          const SizedBox(height: 4),

          // 5. Udhaar Balance Due banner
          if (isUdhaar && data.balance > 0 && !isChallan) ...[
            Container(
              padding: const EdgeInsets.symmetric(vertical: 4),
              margin: const EdgeInsets.symmetric(vertical: 2),
              decoration: BoxDecoration(border: Border.all(color: Colors.black, width: 2)),
              child: Column(
                children: [
                  Text('BAAKI / BALANCE DUE', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold)),
                  Text('Rs. ${data.balance.toStringAsFixed(2)}', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize + 3, fontWeight: FontWeight.w900)),
                ],
              ),
            ),
            const SizedBox(height: 4),
            _dashedLine(),
            const SizedBox(height: 4),
          ],

          // 6. Doc Metadata
          _twoCol(isChallan ? 'Challan No.' : (isEstimate ? 'Estimate No.' : 'Bill No.'), data.docNo, baseFontSize, boldRight: true),
          _twoCol('Date', '${data.date} 04:30 PM', baseFontSize),
          if (rule.cust || isChallan) ...[
            _twoCol(isPurchase ? 'Supplier' : 'Customer', data.partyLabel, baseFontSize, boldRight: true),
            if (data.partyPhone.isNotEmpty)
              _twoCol('Phone', data.partyPhone, baseFontSize),
            if (data.address != null && data.address!.isNotEmpty)
              _twoCol('Address', data.address!, baseFontSize - 1),
          ],

          const SizedBox(height: 4),
          _dashedLine(),
          const SizedBox(height: 4),

          // 7. Items breakdown
          if (isMinimal && !isChallan) ...[
            _twoCol('Items', '${data.items.length}', baseFontSize),
            _twoCol('Total Qty', data.items.fold(0.0, (s, i) => s + i.qty).toStringAsFixed(0), baseFontSize),
          ] else ...[
            Row(
              children: [
                SizedBox(width: 18, child: Text('#', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                Expanded(child: Text('Item', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                SizedBox(width: 48, child: Text('Qty', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                if (!isChallan && rule.price) ...[
                  SizedBox(width: 48, child: Text('Rate', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                  if (rule.disc)
                    SizedBox(width: 40, child: Text('Disc', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                  SizedBox(width: 58, child: Text('Amount', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                ],
              ],
            ),
            const SizedBox(height: 2),
            _dashedLine(),
            const SizedBox(height: 2),
            for (final entry in data.items.asMap().entries) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(width: 18, child: Text('${entry.key + 1}', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(entry.value.name, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 0.5)),
                        if (rule.code)
                          Text('[${entry.value.code}]', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 2, color: Colors.black54)),
                      ],
                    ),
                  ),
                  SizedBox(width: 48, child: Text('${entry.value.qty.toStringAsFixed(0)} ${entry.value.uom}', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
                  if (!isChallan && rule.price) ...[
                    SizedBox(width: 48, child: Text(entry.value.rate.toStringAsFixed(0), textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
                    if (rule.disc)
                      SizedBox(width: 40, child: Text(entry.value.discount > 0 ? entry.value.discount.toStringAsFixed(0) : '-', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
                    SizedBox(width: 58, child: Text('₹${entry.value.amount.toStringAsFixed(0)}', textAlign: TextAlign.right, style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 0.5, fontWeight: FontWeight.bold))),
                  ],
                ],
              ),
              const SizedBox(height: 2),
            ],
          ],

          // 8. Challan Format Footers vs Standard Bill Totals
          if (isChallan) ...[
            const SizedBox(height: 2),
            _dashedLine(),
            const SizedBox(height: 2),
            _twoCol('Total Qty', data.items.fold(0.0, (s, i) => s + i.qty).toStringAsFixed(0), baseFontSize, bold: true, boldRight: true),
            const SizedBox(height: 4),
            _dashedLine(),
            const SizedBox(height: 4),
            _twoCol("Receiver's Signature", '__________', baseFontSize),
            const SizedBox(height: 4),
            _dashedLine(),
            const SizedBox(height: 4),
            Center(child: Text('Goods received as listed.', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1.5))),
            Center(child: Text('Rates are not shown on this slip.', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1.5))),
          ] else if (isEstimate) ...[
            const SizedBox(height: 2),
            _dashedLine(),
            const SizedBox(height: 2),
            if (data.discount > 0)
              _twoCol('Discount', '-₹${data.discount.toStringAsFixed(2)}', baseFontSize),
            const SizedBox(height: 2),
            _dashedLine(),
            _twoCol('TOTAL', '₹${data.grandTotal.toStringAsFixed(2)}', baseFontSize + 2, bold: true, boldRight: true),
            const SizedBox(height: 4),
            _dashedLine(),
            const SizedBox(height: 4),
            Center(child: Text('Sirf daam ka andaaza - bill alag banega', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1.5))),
            const SizedBox(height: 4),
            _dashedLine(),
            const SizedBox(height: 4),
            Center(child: Text('Thank You!', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize + 1, fontWeight: FontWeight.bold))),
            Center(child: Text('Visit Again', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
          ] else ...[
            // Standard Bill Totals
            if (rule.price) ...[
              const SizedBox(height: 2),
              _dashedLine(),
              const SizedBox(height: 2),
              if (data.discount > 0)
                _twoCol('Discount', '-₹${data.discount.toStringAsFixed(2)}', baseFontSize),
              const SizedBox(height: 2),
              _dashedLine(),
              _twoCol('TOTAL', '₹${data.grandTotal.toStringAsFixed(2)}', baseFontSize + 2, bold: true, boldRight: true),
              _twoCol('PAID', '₹${data.received.toStringAsFixed(2)}', baseFontSize),

              // Payment split
              if (rule.pay) ...[
                const SizedBox(height: 4),
                _dashedLine(),
                Center(child: Text('PAYMENT RECEIPT', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                _twoCol(data.paymentMode, '₹${data.received.toStringAsFixed(2)}', baseFontSize - 1),
                _twoCol('Total Received', '₹${data.received.toStringAsFixed(2)}', baseFontSize - 1, bold: true),
                if (data.balance < 0)
                  _twoCol('Change Returned', '₹${data.balance.abs().toStringAsFixed(2)}', baseFontSize - 1),
              ],

              // Account Summary
              if (rule.acct && !isUdhaar) ...[
                const SizedBox(height: 4),
                _dashedLine(),
                Center(child: Text('ACCOUNT SUMMARY', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                _twoCol('Previous Balance', 'Rs. 0.00', baseFontSize - 1),
                _twoCol('This Bill Due', 'Rs. ${data.balance.toStringAsFixed(2)}', baseFontSize - 1),
                _twoCol('TOTAL DUE', 'Rs. ${data.balance.toStringAsFixed(2)}', baseFontSize, bold: true, boldRight: true),
              ],
              if (isUdhaar) ...[
                const SizedBox(height: 4),
                _dashedLine(),
                Center(child: Text('ACCOUNT SUMMARY', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
                _twoCol('Previous Balance', 'Rs. 0.00', baseFontSize - 1),
                _twoCol('This Bill Due', 'Rs. ${data.balance.toStringAsFixed(2)}', baseFontSize - 1),
                _twoCol('TOTAL DUE', 'Rs. ${data.balance.toStringAsFixed(2)}', baseFontSize + 1, bold: true, boldRight: true),
              ],
            ],

            // Scan & Pay QR Code
            if (rule.qr) ...[
              const SizedBox(height: 6),
              _dashedLine(),
              const SizedBox(height: 4),
              Center(child: Text('Scan & Pay', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold))),
              const SizedBox(height: 4),
              // The real scannable QR for this shop's UPI ID and this amount,
              // built by the same encoder the printer gets. It used to be an
              // Icons.qr_code_2 glyph over a hardcoded "santu.hardware@upi",
              // so the preview showed a QR that could not be scanned and a
              // UPI ID belonging to nobody.
              if (data.upiId != null && data.upiId!.isNotEmpty) ...[
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    color: Colors.white,
                    child: CustomPaint(
                      size: const Size(84, 84),
                      painter: _QrPainter(ThermalReceipt.buildUpiLink(
                        upiId: data.upiId!,
                        payeeName: data.shopName,
                        amount: data.balance > 0 ? data.balance : data.grandTotal,
                        note: 'Bill ${data.docNo}',
                      )),
                    ),
                  ),
                ),
                const SizedBox(height: 3),
                Center(child: Text('UPI ID: ${data.upiId}', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 2))),
              ] else
                Center(
                  child: Text(
                    'UPI ID set karein — Shop Profile me\n(bina UPI ID, QR print nahi hoga)',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 2, color: Colors.black54),
                  ),
                ),
            ],

            // Signatures
            if (rule.sign) ...[
              const SizedBox(height: 8),
              _dashedLine(),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(rule.price ? 'Customer Sign' : 'Received by', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1)),
                  Text('For Santu Hardware', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1, fontWeight: FontWeight.bold)),
                ],
              ),
            ],

            // Footer
            const SizedBox(height: 6),
            _dashedLine(),
            const SizedBox(height: 4),
            if (rule.foot) ...[
              Center(child: Text('Bill is required for exchange. E&OE.', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 2, fontWeight: FontWeight.bold))),
              const SizedBox(height: 2),
              _dashedLine(),
              const SizedBox(height: 4),
            ],
            Center(child: Text('Thank You!', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize + 1, fontWeight: FontWeight.bold))),
            if (rule.foot) ...[
              const SizedBox(height: 2),
              Center(child: Text('Visit Again', style: TextStyle(fontFamily: 'monospace', fontSize: baseFontSize - 1))),
            ],
          ],
        ],
      ),
    );
  }

  static Widget _stamp(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.black, width: 1.5),
      ),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 11),
        ),
      ),
    );
  }

  static Widget _dashedLine() {
    return const Text(
      '------------------------------------------------',
      maxLines: 1,
      overflow: TextOverflow.clip,
      style: TextStyle(fontFamily: 'monospace', color: Colors.black54, fontSize: 10),
    );
  }

  static Widget _twoCol(String left, String right, double fontSize, {bool bold = false, bool boldRight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(left, style: TextStyle(fontFamily: 'monospace', fontSize: fontSize, fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
          Text(right, style: TextStyle(fontFamily: 'monospace', fontSize: fontSize, fontWeight: (bold || boldRight) ? FontWeight.bold : FontWeight.normal)),
        ],
      ),
    );
  }
}

/// Visual A4 Invoice Widget replicating A4 PDF/WhatsApp layout for all 6 styles.
class A4InvoiceWidget extends StatelessWidget {
  final InvoicePreviewData data;
  final String templateId;

  const A4InvoiceWidget({
    super.key,
    required this.data,
    required this.templateId,
  });

  @override
  Widget build(BuildContext context) {
    final isProfessional = templateId == 'Professional A4';
    final isDetailed = templateId == 'Detailed A4';
    final isSimple = templateId == 'Simple A4';
    final isCustomerCopy = templateId == 'Customer Copy';
    final isOfficeCopy = templateId == 'Office Copy';

    final primaryColor = isProfessional ? SantuColors.blue : const Color(0xFF1E293B);

    return Container(
      width: 360,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        boxShadow: const [
          BoxShadow(color: Color(0x1F000000), blurRadius: 12, offset: Offset(0, 4)),
        ],
        border: Border.all(color: const Color(0xFFCBD5E1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Banner
          if (isCustomerCopy) ...[
            Container(
              padding: const EdgeInsets.symmetric(vertical: 3),
              color: const Color(0xFFF1F5F9),
              child: const Center(
                child: Text('ORIGINAL FOR RECIPIENT — CUSTOMER COPY', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.8)),
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (isOfficeCopy) ...[
            Container(
              padding: const EdgeInsets.symmetric(vertical: 3),
              color: const Color(0xFFF1F5F9),
              child: const Center(
                child: Text('DUPLICATE FOR TRANSPORTER / OFFICE COPY', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.8)),
              ),
            ),
            const SizedBox(height: 8),
          ],

          // Header
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 6,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (data.showLogo) ...[
                      Image.asset(
                        'assets/thermal_bill_logo.png',
                        height: 38,
                        fit: BoxFit.contain,
                        errorBuilder: (ctx, err, stack) => const SizedBox.shrink(),
                      ),
                      const SizedBox(height: 4),
                    ],
                    Text(
                      data.shopName,
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: primaryColor),
                    ),
                    const SizedBox(height: 2),
                    if (data.address != null)
                      Text(data.address!, style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
                    if (data.phone != null)
                      Text('Phone: ${data.phone}', style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
                    if (data.gstin != null)
                      Text('GSTIN: ${data.gstin}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF334155))),
                  ],
                ),
              ),
              Expanded(
                flex: 4,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: primaryColor.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: primaryColor.withValues(alpha: 0.3)),
                      ),
                      child: Text(
                        data.docType.toUpperCase(),
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: primaryColor),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text('No: ${data.docNo}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    Text('Date: ${data.date}', style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 8),

          // Bill To / Delivered To
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  data.docType.contains('Delivery') || data.docType.contains('Challan') ? 'DELIVERED TO / PARTY' : 'BILLED TO',
                  style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Color(0xFF94A3B8)),
                ),
                Text(data.partyLabel, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                if (data.partyPhone.isNotEmpty)
                  Text('Mobile: ${data.partyPhone}', style: const TextStyle(fontSize: 10, color: Color(0xFF64748B))),
              ],
            ),
          ),

          const SizedBox(height: 10),

          // Items Table
          if (data.docType.contains('Delivery') || data.docType.contains('Challan')) ...[
            Table(
              border: TableBorder.all(color: const Color(0xFFE2E8F0), width: 1),
              columnWidths: const {
                0: FlexColumnWidth(1.0),
                1: FlexColumnWidth(6.5),
                2: FlexColumnWidth(2.5),
              },
              children: [
                TableRow(
                  decoration: BoxDecoration(color: isProfessional ? primaryColor.withValues(alpha: 0.08) : const Color(0xFFF1F5F9)),
                  children: [
                    _th('#'),
                    _th('Item Description'),
                    _th('Quantity Delivered', align: TextAlign.right),
                  ],
                ),
                for (final entry in data.items.asMap().entries)
                  TableRow(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Text('${entry.key + 1}', style: const TextStyle(fontSize: 10)),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(entry.value.name, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600)),
                            if (isDetailed)
                              Text('Code: ${entry.value.code}', style: const TextStyle(fontSize: 8.5, color: Color(0xFF94A3B8))),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Text('${entry.value.qty.toStringAsFixed(0)} ${entry.value.uom}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Goods delivered in good condition and order. Rates are not shown. E&OE.', style: TextStyle(fontSize: 8.5, color: Color(0xFF94A3B8))),
                Text('Total Quantity: ${data.items.fold(0.0, (s, i) => s + i.qty).toStringAsFixed(0)}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: primaryColor)),
              ],
            ),
          ] else ...[
            Table(
              border: TableBorder.all(color: const Color(0xFFE2E8F0), width: 1),
              columnWidths: const {
                0: FlexColumnWidth(4.5),
                1: FlexColumnWidth(2.0),
                2: FlexColumnWidth(2.0),
                3: FlexColumnWidth(2.5),
              },
              children: [
                TableRow(
                  decoration: BoxDecoration(color: isProfessional ? primaryColor.withValues(alpha: 0.08) : const Color(0xFFF1F5F9)),
                  children: [
                    _th('Item Description'),
                    _th('Qty', align: TextAlign.right),
                    _th('Rate', align: TextAlign.right),
                    _th('Amount', align: TextAlign.right),
                  ],
                ),
                for (final it in data.items)
                  TableRow(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(it.name, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600)),
                            if (isDetailed)
                              Text('Code: ${it.code} · HSN: 7307', style: const TextStyle(fontSize: 8.5, color: Color(0xFF94A3B8))),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Text('${it.qty.toStringAsFixed(0)} ${it.uom}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 10)),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Text('₹${it.rate.toStringAsFixed(2)}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 10)),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(5),
                        child: Text('₹${it.amount.toStringAsFixed(2)}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 10),

            // Summary and Reward Points
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 5,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (data.redeemPoints > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                          decoration: BoxDecoration(
                            color: SantuColors.green.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(color: SantuColors.green.withValues(alpha: 0.3)),
                          ),
                          child: Text(
                            'Reward Points Earned: ${(data.grandTotal / 100).toStringAsFixed(1)} pts',
                            style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: SantuColors.green),
                          ),
                        ),
                      const SizedBox(height: 6),
                      const Text('T&C: Bill is required for any exchange. Goods once sold are not returnable for cash.', style: TextStyle(fontSize: 8, color: Color(0xFF94A3B8))),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 5,
                  child: Column(
                    children: [
                      _a4SummaryRow('Subtotal', '₹${data.subtotal.toStringAsFixed(2)}'),
                      if (data.discount > 0) _a4SummaryRow('Discount', '-₹${data.discount.toStringAsFixed(2)}'),
                      if (data.redeemPoints > 0) _a4SummaryRow('Points Redeemed', '-₹${data.redeemPoints.toStringAsFixed(2)}'),
                      const Divider(height: 8),
                      _a4SummaryRow('Grand Total', '₹${data.grandTotal.toStringAsFixed(2)}', isBold: true, color: primaryColor),
                      _a4SummaryRow('Amount Received', '₹${data.received.toStringAsFixed(2)}'),
                      _a4SummaryRow('Balance Due', '₹${data.balance.toStringAsFixed(2)}', isBold: true),
                    ],
                  ),
                ),
              ],
            ),
          ],

          if (!isSimple) ...[
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(height: 20),
                    Text('Customer Signature', style: TextStyle(fontSize: 9, color: Color(0xFF64748B))),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('For ${data.shopName}', style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    const Text('Authorised Signatory', style: TextStyle(fontSize: 9, color: Color(0xFF64748B))),
                  ],
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _th(String text, {TextAlign align = TextAlign.left}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
      child: Text(text, textAlign: align, style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: Color(0xFF334155))),
    );
  }

  Widget _a4SummaryRow(String label, String value, {bool isBold = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1.5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: isBold ? 11 : 9.5, fontWeight: isBold ? FontWeight.bold : FontWeight.normal)),
          Text(value, style: TextStyle(fontSize: isBold ? 11 : 9.5, fontWeight: isBold ? FontWeight.bold : FontWeight.normal, color: color)),
        ],
      ),
    );
  }
}

/// Paints a QR from its modules. Same encoder and error-correction level the
/// printer is sent (`ThermalReceipt._qr`), so what the preview shows is what
/// comes off the roll.
class _QrPainter extends CustomPainter {
  _QrPainter(this.data);

  final String data;

  @override
  void paint(Canvas canvas, Size size) {
    final image = QrImage(QrCode.fromData(data: data, errorCorrectLevel: QrErrorCorrectLevel.M));
    final modules = image.moduleCount;
    // Same 4-module quiet zone the printed slip leaves, so the preview is
    // honest about how much room the block actually takes.
    const quiet = 4;
    final cell = size.width / (modules + quiet * 2);
    final paint = Paint()..color = Colors.black;
    for (var row = 0; row < modules; row++) {
      for (var col = 0; col < modules; col++) {
        if (!image.isDark(row, col)) continue;
        canvas.drawRect(
          // Half a pixel of overdraw, or antialiasing leaves hairlines between
          // neighbouring modules and the on-screen code scans poorly.
          Rect.fromLTWH((col + quiet) * cell, (row + quiet) * cell, cell + 0.5, cell + 0.5),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter oldDelegate) => oldDelegate.data != data;
}
