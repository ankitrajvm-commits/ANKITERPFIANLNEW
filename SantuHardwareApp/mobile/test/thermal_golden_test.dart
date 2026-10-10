import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:santu_hardware_mobile/db.dart';
import 'package:santu_hardware_mobile/models.dart';
import 'package:santu_hardware_mobile/thermal_receipt.dart';

/// Renders the ESC/POS byte stream back to plain text so the slip can be read
/// and diffed against the PC print format without a printer attached.
String render(List<int> bytes) {
  final out = StringBuffer();
  var i = 0;
  while (i < bytes.length) {
    final b = bytes[i];
    if (b == 0x1b) {
      final n = bytes[i + 1];
      if (n == 0x40) { i += 2; continue; }
      if (n == 0x61 || n == 0x45 || n == 0x4d) { i += 3; continue; }
      if (n == 0x37) { i += 5; continue; }
      i += 1;
      continue;
    }
    if (b == 0x1d) {
      final n = bytes[i + 1];
      if (n == 0x21) { i += 3; continue; }
      if (n == 0x56) { i += 4; continue; }
      // GS v 0 — raster bit image, which is how the Scan & Pay QR is sent now
      // that the modules are encoded in-app rather than by the printer. The
      // payload can't be read back out of a bitmap, so note the block and its
      // size; buildUpiLink has its own test above for the content.
      if (n == 0x76) {
        final bytesPerRow = bytes[i + 4] | (bytes[i + 5] << 8);
        final rows = bytes[i + 6] | (bytes[i + 7] << 8);
        out.writeln('[QR] ${bytesPerRow * 8}x$rows dots');
        i += 8 + bytesPerRow * rows;
        continue;
      }
      i += 1;
      continue;
    }
    out.writeCharCode(b);
    i += 1;
  }
  return out.toString();
}

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'shop_name': 'Santu Hardware',
      'gstin': '10ABCDE1234F1Z5',
      'shop_address_line': 'Main Road, Near Bus Stand',
      'shop_city': 'Barh',
      'shop_state': 'Bihar',
      'shop_pincode': '803213',
      'shop_phone': '9876543210',
      'shop_upi_id': 'santu@paytm',
      'bill_footer': 'Visit Again',
    });
  });

  Invoice sampleBill() => Invoice(
        id: 'inv-1',
        billNo: 'B-42',
        postingDate: '2026-10-10',
        createdAt: DateTime(2026, 10, 10, 14, 35).toIso8601String(),
        customer: 'CUST-1',
        customerLabel: 'Dheeraj Kr Singh',
        status: InvoiceStatus.saved,
        paymentMode: 'Cash',
        amountReceived: 500,
        billDiscount: 50,
        items: [
          BillItem(id: 'i1', itemCode: 'BVENUS-PIPE-24', itemName: 'BVENUS PTMT CONNECTION PIPE 24"', qty: 5, uom: 'Nos', rate: 80),
          BillItem(id: 'i2', itemCode: 'CPVC-PIPE-3-4', itemName: 'CPVC PIPE 3/4"', qty: 10, uom: 'Foot', rate: 20, discountAmount: 2),
        ],
      );

  test('UPI link is the strict NPCI form api.build_upi_link() builds', () {
    final link = ThermalReceipt.buildUpiLink(
      upiId: 'santu@paytm',
      payeeName: 'Santu Hardware',
      amount: 1234.5,
      note: 'Bill B-12',
    );
    expect(link, 'upi://pay?pa=santu@paytm&pn=Santu%20Hardware&am=1234.50&cu=INR&tn=Bill%20B-12');
    // Merchant-only fields make Google Pay reject a personal UPI ID.
    expect(link.contains('tr='), isFalse);
    expect(link.contains('mc='), isFalse);
  });

  test('every PC thermal template exists here', () {
    expect(ThermalReceipt.styles.keys.toSet(), {
      'Standard Bill', 'Compact Bill', 'Detailed Bill', 'Simple Cash Bill',
      'Customer Copy', 'Duplicate / Office Copy', 'Bill + Payment Receipt',
      'Delivery Slip (No Rates)', 'Large Print Bill', 'Udhaar / Balance Bill', 'Minimal Slip',
    });
  });

  for (final style in ThermalReceipt.styles.keys) {
    test('renders: $style', () async {
      final text = render(await ThermalReceipt.buildSalesBill(sampleBill(), templateOverride: style));
      // Every slip identifies the shop and the document, always.
      expect(text, contains('Santu Hardware'));
      expect(text, contains('Bill No.'));
      expect(text, contains('Thank You!'));

      final v = ThermalReceipt.styles[style]!;
      bool on(String k) => v[k] == 1;

      // Flags drive exactly what the PC format says they drive.
      expect(text.contains('Customer'), on('cust'), reason: 'cust');
      expect(text.contains('GSTIN'), on('addr'), reason: 'addr');
      expect(text.contains('TOTAL '), on('price'), reason: 'price');
      expect(text.contains('[QR]'), on('qr'), reason: 'qr');
      expect(text.contains('BVENUS-PIPE-24'), on('code'), reason: 'code');
      expect(text.contains('PAYMENT RECEIPT'), on('pay'), reason: 'pay');
      expect(text.contains('Bill is required for exchange'), on('foot'), reason: 'foot');

      final banner = v['banner'] as String;
      if (banner.isNotEmpty) expect(text, contains(banner));


      print('\n===== $style =====\n$text');
    });
  }
}
