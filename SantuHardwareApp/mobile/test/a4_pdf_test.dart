import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:santu_hardware_mobile/a4_invoice_pdf.dart';
import 'package:santu_hardware_mobile/models.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'shop_name': 'Santu Hardware',
      'gstin': '10ABCDE1234F1Z5',
      'shop_address_line': 'Main Road, Near Bus Stand',
      'shop_city': 'Barh',
      'shop_state': 'Bihar',
      'shop_pincode': '803213',
      'shop_phone': '9876543210',
      'shop_website': 'www.santuhardware.com',
      'bill_footer': 'Thank you for shopping with us!',
    });
  });

  test('amount in words uses the Indian system', () {
    expect(A4Invoice.inWords(0), 'Rupees Zero Only');
    expect(A4Invoice.inWords(1), 'Rupees One Only');
    expect(A4Invoice.inWords(530), 'Rupees Five Hundred Thirty Only');
    expect(A4Invoice.inWords(1234), 'Rupees One Thousand Two Hundred Thirty Four Only');
    expect(A4Invoice.inWords(100000), 'Rupees One Lakh Only');
    expect(A4Invoice.inWords(2500000), 'Rupees Twenty Five Lakh Only');
    expect(A4Invoice.inWords(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
    expect(A4Invoice.inWords(99.50), 'Rupees Ninety Nine and Fifty Paise Only');
  });

  test('every A4 style produces a real PDF', () async {
    final inv = Invoice(
      id: 'inv-1',
      billNo: 'B-42',
      postingDate: '2026-10-10',
      createdAt: DateTime(2026, 10, 10, 14, 35).toIso8601String(),
      customerLabel: 'Dheeraj Kr Singh',
      status: InvoiceStatus.saved,
      paymentMode: 'Cash',
      amountReceived: 500,
      billDiscount: 50,
      items: [
        BillItem(id: 'i1', itemCode: 'BVENUS-PIPE-24', itemName: 'BVENUS PTMT CONNECTION PIPE 24"', qty: 5, uom: 'Nos', rate: 80),
        BillItem(id: 'i2', itemCode: 'CPVC-PIPE-3-4', itemName: 'CPVC PIPE 3/4"', qty: 10, uom: 'Foot', rate: 20),
      ],
    );

    final outDir = Directory('build/a4_samples')..createSync(recursive: true);
    for (final style in A4Invoice.styles.keys) {
      final bytes = await A4Invoice.build(inv, templateOverride: style);
      // A well-formed PDF starts with %PDF- and ends with the EOF marker.
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: style);
      expect(bytes.length, greaterThan(1000), reason: style);
      final f = File('${outDir.path}/${style.replaceAll(RegExp(r"[^A-Za-z0-9]"), "_")}.pdf');
      f.writeAsBytesSync(bytes);
      // ignore: avoid_print
      print('$style -> ${f.path} (${bytes.length} bytes)');
    }
  });
}
