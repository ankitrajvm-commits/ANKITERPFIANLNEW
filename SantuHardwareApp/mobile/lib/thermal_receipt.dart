import 'dart:typed_data';

import 'package:another_flutter_usb_write/another_flutter_usb_write.dart';
import 'package:intl/intl.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';

import 'app_settings.dart';
import 'db.dart';
import 'models.dart';
import 'uom_abbr.dart';

/// Builds the raw ESC/POS slip on Android — 48-column (80mm roll), Font A.
///
/// Content is a port of the PC app's thermal print formats: the STYLES table
/// below is copied field-for-field from "Santu Thermal - *" (print format
/// HTML), and the section order, labels and conditionals follow that same
/// template, with print_service.py's escpos_bill_bytes() as the reference for
/// how those sections translate into raw bytes. The PC reaches its printer
/// through CUPS rendering HTML; Android has no CUPS, so the same layout is
/// emitted directly as ESC/POS here.
///
/// Emphasis deliberately stays bold / double-HEIGHT rather than the CSS
/// font sizes the HTML uses: double-WIDTH halves the line to 24 columns and
/// would wrap every padded two-column row, so the PC's own raw path keeps
/// double-width for the shop name alone. This does the same.
class ThermalReceipt {
  ThermalReceipt._();

  static const columns = 48;

  static const _esc = 0x1b;
  static const _gs = 0x1d;
  static final List<int> init = [_esc, 0x40];
  static final List<int> alignLeft = [_esc, 0x61, 0x00];
  static final List<int> alignCenter = [_esc, 0x61, 0x01];
  static final List<int> boldOn = [_esc, 0x45, 0x01];
  static final List<int> boldOff = [_esc, 0x45, 0x00];
  static final List<int> doubleOn = [_gs, 0x21, 0x11];
  static final List<int> doubleOff = [_gs, 0x21, 0x00];
  static final List<int> tallOn = [_gs, 0x21, 0x01]; // double height, 48 cols intact
  static final List<int> tallOff = [_gs, 0x21, 0x00];
  static final List<int> cut = [_gs, 0x56, 0x42, 0x00, _gs, 0x56, 0x01]; // universal partial cut

  static Future<int> getColumns() async {
    final width = await AppSettings.paperWidth();
    return width == '58mm' ? 32 : 48;
  }

  /// Minimal feed (exactly 3 lines) to clear the thermal head to the cutter blade,
  /// followed by universal ESC/POS auto-cutter commands. Saves paper by printing
  /// only the exact required slip length.
  static Future<List<int>> cutSequence() async {
    final autoCut = await AppSettings.autoCut();
    if (!autoCut) {
      return [0x0a, 0x0a, 0x0a, 0x0a];
    }
    return [
      0x0a, 0x0a, 0x0a,
      _gs, 0x56, 0x42, 0x00, // GS V B 0 (standard partial cut)
      _gs, 0x56, 0x01,       // GS V 1 (universal cutter fallback)
    ];
  }

  /// Verbatim port of the STYLES table in the PC's thermal print formats.
  /// Every flag means exactly what it does there, so a template behaves the
  /// same on the counter PC and on the phone.
  static const Map<String, Map<String, Object>> styles = {
    'Standard Bill':            {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 0, 'disc': 0, 'acct': 1, 'pay': 0, 'sign': 0, 'foot': 1, 'banner': ''},
    'Compact Bill':             {'cust': 1, 'addr': 1, 'price': 1, 'qr': 0, 'code': 0, 'disc': 0, 'acct': 0, 'pay': 0, 'sign': 0, 'foot': 0, 'banner': ''},
    'Detailed Bill':            {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 1, 'disc': 1, 'acct': 1, 'pay': 1, 'sign': 0, 'foot': 1, 'banner': ''},
    'Simple Cash Bill':         {'cust': 0, 'addr': 0, 'price': 1, 'qr': 0, 'code': 0, 'disc': 0, 'acct': 0, 'pay': 0, 'sign': 0, 'foot': 1, 'banner': ''},
    'Customer Copy':            {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 0, 'disc': 0, 'acct': 1, 'pay': 0, 'sign': 0, 'foot': 1, 'banner': 'CUSTOMER COPY'},
    'Duplicate / Office Copy':  {'cust': 1, 'addr': 1, 'price': 1, 'qr': 0, 'code': 1, 'disc': 0, 'acct': 1, 'pay': 0, 'sign': 1, 'foot': 0, 'banner': 'DUPLICATE - OFFICE COPY'},
    'Bill + Payment Receipt':   {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 0, 'disc': 0, 'acct': 1, 'pay': 1, 'sign': 0, 'foot': 1, 'banner': ''},
    'Delivery Slip (No Rates)': {'cust': 1, 'addr': 1, 'price': 0, 'qr': 0, 'code': 1, 'disc': 0, 'acct': 0, 'pay': 0, 'sign': 1, 'foot': 0, 'banner': 'DELIVERY SLIP - NOT A BILL'},
    'Large Print Bill':         {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 0, 'disc': 0, 'acct': 1, 'pay': 0, 'sign': 0, 'foot': 1, 'banner': ''},
    'Udhaar / Balance Bill':    {'cust': 1, 'addr': 1, 'price': 1, 'qr': 1, 'code': 0, 'disc': 0, 'acct': 1, 'pay': 0, 'sign': 1, 'foot': 0, 'banner': ''},
    'Minimal Slip':             {'cust': 0, 'addr': 0, 'price': 1, 'qr': 0, 'code': 0, 'disc': 0, 'acct': 0, 'pay': 0, 'sign': 0, 'foot': 0, 'banner': ''},
  };

  static Map<String, Object> _style(String name) => styles[name] ?? styles['Standard Bill']!;
  static bool _on(Map<String, Object> v, String key) => (v[key] as int? ?? 0) == 1;

  static final _moneyFmt = NumberFormat('#,##0.00');

  static List<int> _ascii(String s) => s.codeUnits.map((c) => c > 127 ? 0x3f : c).toList();

  static List<int> _asciiLine(String s) => [..._ascii(s), 0x0a];

  static String _line([String ch = '-', int cols = columns]) => ch * cols;

  static String _twoCol(String left, String right, [int cols = columns]) {
    var l = left;
    var pad = cols - l.length - right.length;
    if (pad < 1) {
      l = l.substring(0, (cols - right.length - 1).clamp(0, l.length));
      pad = (cols - l.length - right.length).clamp(1, cols);
    }
    return '$l${' ' * pad}$right';
  }

  static String _money(double v) => _moneyFmt.format(v);

  /// Port of api.py's _upi_text(): plain letters/digits/space only, trimmed
  /// to 40 chars — the NPCI fields reject the rest.
  static String _upiText(String? value, {int limit = 40}) {
    final v = (value ?? '').replaceAll(RegExp(r'[^A-Za-z0-9 .-]+'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    return (v.length > limit ? v.substring(0, limit) : v).trim();
  }

  /// Port of api.py's build_upi_link(): the strict NPCI "upi://pay" form
  /// every UPI app reads. Merchant-only fields are deliberately absent —
  /// on a personal UPI ID they make Google Pay reject the payment.
  static String buildUpiLink({required String upiId, String? payeeName, required double amount, String? note}) {
    final pn = Uri.encodeComponent(_upiText(payeeName).isEmpty ? 'Shop' : _upiText(payeeName));
    final tn = Uri.encodeComponent(_upiText(note).isEmpty ? 'Payment' : _upiText(note));
    return 'upi://pay?pa=$upiId&pn=$pn&am=${amount.toStringAsFixed(2)}&cu=INR&tn=$tn';
  }

  /// Native ESC/POS model-2 QR (GS ( k). The PC embeds a PNG in HTML and
  /// lets CUPS raster it; a raw printer has to be told to draw it itself.
  static List<int> _qr(String data, {int moduleSize = 6}) {
    final bytes = <int>[];
    final payload = _ascii(data);
    final len = payload.length + 3;
    // model 2
    bytes.addAll([_gs, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // module size
    bytes.addAll([_gs, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize.clamp(1, 16)]);
    // error correction level M — survives a smudged thermal print
    bytes.addAll([_gs, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // store
    bytes.addAll([_gs, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload]);
    // print
    bytes.addAll([_gs, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return bytes;
  }

  /// "02:30 PM" — the PC template derives the same 12-hour stamp from
  /// posting_time for the Date row.
  static String _time12h(String isoCreatedAt) {
    final dt = DateTime.tryParse(isoCreatedAt);
    if (dt == null) return '';
    final ampm = dt.hour < 12 ? 'AM' : 'PM';
    var h = dt.hour % 12;
    if (h == 0) h = 12;
    return '${h.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')} $ampm';
  }

  /// Shop block at the top of every slip, in the PC template's order:
  /// name (big), address, GSTIN, phone. [withAddress] is the template's
  /// `addr` flag — Simple Cash Bill and Minimal Slip drop those lines.
  static Future<List<int>> _header({bool withAddress = true}) async {
    final shopName = await AppSettings.shopName();
    final gstin = await AppSettings.gstin();
    final address = await AppSettings.companyAddressLine();
    final phone = await AppSettings.phone();
    final density = await AppSettings.printerDensity();

    final bytes = <int>[];
    bytes.addAll(init);
    bytes.addAll([_esc, 0x37, 0x07, (density * 10).clamp(10, 50), 0x02]); // heating / density

    bytes.addAll(alignCenter);
    bytes.addAll(boldOn);
    bytes.addAll(doubleOn);
    bytes.addAll(_asciiLine(shopName));
    bytes.addAll(doubleOff);
    bytes.addAll(boldOff);
    if (withAddress && address.isNotEmpty) bytes.addAll(_asciiLine(address));
    if (withAddress && gstin != null && gstin.isNotEmpty) bytes.addAll(_asciiLine('GSTIN: $gstin'));
    if (phone != null && phone.isNotEmpty) bytes.addAll(_asciiLine('Ph: $phone'));
    return bytes;
  }

  static Future<List<int>> buildSalesBill(Invoice inv, {String? templateOverride}) async {
    final template = templateOverride ?? await AppSettings.defaultTemplate('Thermal Invoice Library', 'Sales Invoice');
    final v = _style(template);
    final isUdhaar = template == 'Udhaar / Balance Bill';
    final isMinimal = template == 'Minimal Slip';
    final isLarge = template == 'Large Print Bill';
    final showPrice = _on(v, 'price');

    // Every other builder already threads getColumns() through; the sale bill
    // used to take the 48-column defaults, so a shop set to a 58mm roll got a
    // correct test print and wrapped, unreadable sale bills. Bound once here
    // so no call site can silently fall back to 48.
    final cols = await getColumns();
    String line() => _line('-', cols);
    String twoCol(String l, String r) => _twoCol(l, r, cols);

    final previousBalance = await AppDb.instance.previousBalanceForCustomer(inv.customer, excludeInvoiceId: inv.id);
    final thisDue = inv.baaki;
    final currentBalance = previousBalance + thisDue;

    final bytes = await _header(withAddress: _on(v, 'addr'));

    bytes.addAll(_asciiLine(line()));
    final banner = v['banner'] as String? ?? '';
    if (banner.isNotEmpty) {
      bytes.addAll(alignCenter);
      bytes.addAll(boldOn);
      bytes.addAll(_asciiLine(banner));
      bytes.addAll(boldOff);
    }
    bytes.addAll(alignCenter);
    bytes.addAll(boldOn);
    bytes.addAll(_asciiLine(!showPrice
        ? 'GOODS DELIVERY'
        : inv.status == InvoiceStatus.saved
            ? 'INVOICE'
            : 'QUOTATION'));
    bytes.addAll(boldOff);
    bytes.addAll(_asciiLine(line()));

    if (isUdhaar && currentBalance > 0) {
      bytes.addAll(alignCenter);
      bytes.addAll(boldOn);
      bytes.addAll(_asciiLine('BAAKI / BALANCE DUE'));
      bytes.addAll(tallOn);
      bytes.addAll(_asciiLine('Rs. ${_money(currentBalance)}'));
      bytes.addAll(tallOff);
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine(line()));
    }

    bytes.addAll(alignLeft);
    bytes.addAll(_asciiLine(twoCol('Bill No.', inv.billNo ?? '-')));
    final time = _time12h(inv.createdAt);
    bytes.addAll(_asciiLine(twoCol('Date', time.isEmpty ? inv.postingDate : '${inv.postingDate} $time')));
    if (_on(v, 'cust')) {
      bytes.addAll(_asciiLine(twoCol('Customer', inv.customerLabel ?? 'Walk-in')));
      final phone = inv.customer == null ? null : (await AppDb.instance.customerByName(inv.customer!))?.phone;
      if (phone != null && phone.isNotEmpty) bytes.addAll(_asciiLine(twoCol('Phone', phone)));
    }
    bytes.addAll(_asciiLine(line()));

    double totalQty = 0;
    if (isMinimal) {
      totalQty = inv.items.fold(0, (s, i) => s + i.qty);
      bytes.addAll(_asciiLine(twoCol('Items', '${inv.items.length}')));
      bytes.addAll(_asciiLine(twoCol('Total Qty', _qtyStr(totalQty))));
    } else {
      bytes.addAll(_asciiLine(showPrice
          ? twoCol('# Item', _on(v, 'disc') ? 'Qty  Rate  Disc   Amount' : 'Qty    Rate      Amount')
          : twoCol('# Item', 'Qty')));
      for (var i = 0; i < inv.items.length; i++) {
        final it = inv.items[i];
        totalQty += it.qty;
        if (isLarge) bytes.addAll(tallOn);
        bytes.addAll(_asciiLine('${i + 1} ${it.itemName}'));
        if (_on(v, 'code')) bytes.addAll(_asciiLine('   ${it.itemCode}'));
        final qty = '${_qtyStr(it.qty)} ${uomAbbr(it.uom)}';
        if (showPrice) {
          // Disc column, same as the PC format: the amount off when there is
          // one, otherwise a bare "-" placeholder (not a minus sign).
          final disc = !_on(v, 'disc') ? null : (it.discountAmount > 0 ? '-${_money(it.discountAmount)}' : '-');
          final right = disc == null
              ? '$qty x ${_money(it.rate)} = ${_money(it.lineTotal)}'
              : '$qty x ${_money(it.rate)} $disc = ${_money(it.lineTotal)}';
          bytes.addAll(_asciiLine(twoCol('', right)));
        } else {
          bytes.addAll(_asciiLine(twoCol('', qty)));
        }
        if (isLarge) bytes.addAll(tallOff);
      }
    }

    if (showPrice) {
      final discount = inv.billDiscount.abs();
      if (discount >= 1) bytes.addAll(_asciiLine(twoCol('Discount', '-${_money(discount)}')));
      if (inv.redeemPoints > 0) {
        bytes.addAll(_asciiLine(twoCol('Points Redeemed', '-${_money(inv.redeemPoints)}')));
      }
      bytes.addAll(_asciiLine(line()));
      bytes.addAll(boldOn);
      bytes.addAll(_asciiLine(twoCol('TOTAL', _money(inv.grandTotal))));
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine(twoCol('PAID', _money(inv.amountReceived ?? 0))));

      if (_on(v, 'pay')) {
        bytes.addAll(_asciiLine(line()));
        bytes.addAll(alignCenter);
        bytes.addAll(boldOn);
        bytes.addAll(_asciiLine('PAYMENT RECEIPT'));
        bytes.addAll(boldOff);
        bytes.addAll(alignLeft);
        bytes.addAll(_asciiLine(twoCol(inv.paymentMode ?? 'Cash', _money(inv.amountReceived ?? 0))));
        bytes.addAll(boldOn);
        bytes.addAll(_asciiLine(twoCol('Total Received', _money(inv.amountReceived ?? 0))));
        bytes.addAll(boldOff);
        if (inv.change > 0) bytes.addAll(_asciiLine(twoCol('Change Returned', _money(inv.change))));
      }

      if (_on(v, 'acct') && (previousBalance != 0 || thisDue != 0)) {
        bytes.addAll(_asciiLine(line()));
        bytes.addAll(alignCenter);
        bytes.addAll(boldOn);
        bytes.addAll(_asciiLine('ACCOUNT SUMMARY'));
        bytes.addAll(boldOff);
        bytes.addAll(alignLeft);
        bytes.addAll(_asciiLine(twoCol('Previous Balance', 'Rs. ${_money(previousBalance)}')));
        bytes.addAll(_asciiLine(twoCol('This Bill Due', 'Rs. ${_money(thisDue)}')));
        bytes.addAll(boldOn);
        if (isUdhaar) bytes.addAll(tallOn);
        bytes.addAll(_asciiLine(twoCol('TOTAL DUE', 'Rs. ${_money(currentBalance)}')));
        if (isUdhaar) bytes.addAll(tallOff);
        bytes.addAll(boldOff);
      }
    }

    if (_on(v, 'qr')) {
      final upi = await AppSettings.upiId();
      if (upi != null && upi.isNotEmpty) {
        bytes.addAll(_asciiLine(line()));
        bytes.addAll(alignCenter);
        bytes.addAll(boldOn);
        bytes.addAll(_asciiLine('Scan & Pay'));
        bytes.addAll(boldOff);
        bytes.addAll(_qr(buildUpiLink(
          upiId: upi,
          payeeName: await AppSettings.shopName(),
          // The QR must always carry an amount or the customer's UPI app
          // opens on "enter amount" — same rule as the PC format.
          amount: thisDue > 0 ? thisDue : inv.grandTotal,
          note: 'Bill ${inv.billNo ?? ''}',
        )));
        bytes.addAll([0x0a]);
        bytes.addAll(_asciiLine('UPI ID: $upi'));
        bytes.addAll(alignLeft);
      }
    }

    if (_on(v, 'sign')) {
      bytes.addAll(_asciiLine(line()));
      bytes.addAll(_asciiLine(twoCol(showPrice ? 'Customer Sign' : 'Received by', 'For ${await AppSettings.shopName()}')));
      bytes.addAll(_asciiLine(twoCol('____________________', '____________________')));
    }

    bytes.addAll(_asciiLine(line()));
    bytes.addAll(alignCenter);
    if (_on(v, 'foot')) {
      bytes.addAll(boldOn);
      bytes.addAll(_asciiLine('Bill is required for exchange. E&OE.'));
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine(line()));
    }

    // Reward points earned on THIS bill — the PC prints it on every rung so
    // a slip is never silently missing what the customer was told to expect.
    final loyalty = await AppDb.instance.getCustomerLoyaltySummary(inv.customer);
    if (loyalty.earned > 0) {
      bytes.addAll(_asciiLine('Reward Pts Earned: ${_qtyStr(loyalty.earned)}'));
      bytes.addAll(_asciiLine(line()));
    }

    bytes.addAll(boldOn);
    if (!isMinimal) bytes.addAll(tallOn);
    bytes.addAll(_asciiLine('Thank You!'));
    if (!isMinimal) bytes.addAll(tallOff);
    bytes.addAll(boldOff);
    if (_on(v, 'foot')) bytes.addAll(_asciiLine(await AppSettings.billFooter()));

    bytes.addAll(await cutSequence());
    return bytes;
  }

  /// Centred title block every non-sale thermal format opens with, after
  /// the shop header: dashes, the document's name in bold, dashes.
  static List<int> _title(String text, [int cols = columns]) => [
        ..._asciiLine(_line('-', cols)),
        ...alignCenter,
        ...boldOn,
        ..._asciiLine(text),
        ...boldOff,
        ..._asciiLine(_line('-', cols)),
        ...alignLeft,
      ];

  /// Item table shared by the non-sale formats. [withRates] off prints the
  /// Challan's qty-only table ("Rates are not shown on this slip").
  static List<int> _itemTable(List<BillItem> items, {required bool withRates, int cols = columns}) {
    final bytes = <int>[];
    bytes.addAll(_asciiLine(withRates ? _twoCol('# Item', 'Qty    Rate      Amount', cols) : _twoCol('# Item', 'Qty', cols)));
    for (var i = 0; i < items.length; i++) {
      final it = items[i];
      bytes.addAll(_asciiLine('${i + 1} ${it.itemName}'));
      final qty = '${_qtyStr(it.qty)} ${uomAbbr(it.uom)}';
      bytes.addAll(_asciiLine(_twoCol('', withRates ? '$qty x ${_money(it.rate)} = ${_money(it.lineTotal)}' : qty, cols)));
    }
    return bytes;
  }

  /// Mirrors "Santu Hardware Thermal Estimate (Quotation)".
  static Future<List<int>> buildEstimate(QuickDoc doc) async {
    final cols = await getColumns();
    final bytes = await _header();
    bytes.addAll(_title('ESTIMATE', cols));
    bytes.addAll(_asciiLine(_twoCol('Estimate No.', doc.docNo ?? '-', cols)));
    bytes.addAll(_asciiLine(_twoCol('Date', doc.postingDate, cols)));
    bytes.addAll(_asciiLine(_twoCol('Customer', doc.partyLabel ?? 'Walk-in', cols)));
    if (doc.party != null && doc.party!.isNotEmpty) {
      final cust = await AppDb.instance.customer(doc.party!);
      if (cust != null) {
        if (cust.phone != null && cust.phone!.isNotEmpty) {
          bytes.addAll(_asciiLine(_twoCol('Phone', cust.phone!, cols)));
        }
        if (cust.village != null && cust.village!.isNotEmpty) {
          bytes.addAll(_asciiLine(_twoCol('Address', cust.village!, cols)));
        }
      }
    }
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(_itemTable(doc.items, withRates: true, cols: cols));
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(boldOn);
    bytes.addAll(_asciiLine(_twoCol('TOTAL', _money(doc.grandTotal), cols)));
    bytes.addAll(boldOff);
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(alignCenter);
    // The PC estimate says the same thing on paper that the screen does:
    // this is a price, not a bill, and nothing was taken.
    bytes.addAll(_asciiLine('Sirf daam ka andaaza - bill alag banega'));
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(boldOn);
    bytes.addAll(tallOn);
    bytes.addAll(_asciiLine('Thank You!'));
    bytes.addAll(tallOff);
    bytes.addAll(boldOff);
    bytes.addAll(_asciiLine('Visit Again'));
    bytes.addAll(await cutSequence());
    return bytes;
  }

  /// Challan / Return / Order slips. The Delivery Challan carries no rates
  /// and ends on a receiver's signature, exactly as the PC format does.
  static Future<List<int>> buildQuickDoc(QuickDoc doc, String titleLabel) async {
    final cols = await getColumns();
    final isChallan = titleLabel.toLowerCase().contains('challan');
    final bytes = await _header();
    bytes.addAll(_title(isChallan ? 'DELIVERY CHALLAN' : titleLabel.toUpperCase(), cols));
    bytes.addAll(_asciiLine(_twoCol(isChallan ? 'Challan No.' : '$titleLabel No.', doc.docNo ?? '-', cols)));
    bytes.addAll(_asciiLine(_twoCol('Date', doc.postingDate, cols)));
    bytes.addAll(_asciiLine(_twoCol(isChallan ? 'Customer' : (titleLabel.contains('Purchase') ? 'Supplier' : 'Customer'), doc.partyLabel ?? '-', cols)));

    if (doc.party != null && doc.party!.isNotEmpty) {
      final cust = await AppDb.instance.customer(doc.party!);
      if (cust != null) {
        if (cust.phone != null && cust.phone!.isNotEmpty) {
          bytes.addAll(_asciiLine(_twoCol('Phone', cust.phone!, cols)));
        }
        if (cust.village != null && cust.village!.isNotEmpty) {
          bytes.addAll(_asciiLine(_twoCol('Address', cust.village!, cols)));
        }
      }
    }

    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(_itemTable(doc.items, withRates: !isChallan, cols: cols));
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(boldOn);
    if (isChallan) {
      final totalQty = doc.items.fold<double>(0, (s, i) => s + i.qty);
      bytes.addAll(_asciiLine(_twoCol('Total Qty', _qtyStr(totalQty), cols)));
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine(_line('-', cols)));
      bytes.addAll(_asciiLine(_twoCol("Receiver's Signature", '__________', cols)));
      bytes.addAll(_asciiLine(_line('-', cols)));
      bytes.addAll(alignCenter);
      bytes.addAll(_asciiLine('Goods received as listed.'));
      bytes.addAll(_asciiLine('Rates are not shown on this slip.'));
      bytes.addAll(await cutSequence());
      return bytes;
    } else {
      bytes.addAll(_asciiLine(_twoCol('TOTAL', _money(doc.grandTotal), cols)));
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine(_line('-', cols)));
      bytes.addAll(alignCenter);
      bytes.addAll(boldOn);
      bytes.addAll(tallOn);
      bytes.addAll(_asciiLine('Thank You!'));
      bytes.addAll(tallOff);
      bytes.addAll(boldOff);
      bytes.addAll(_asciiLine('Visit Again'));
      bytes.addAll(await cutSequence());
      return bytes;
    }
  }

  /// Mirrors "Santu Hardware Thermal Purchase Bill" — the shop's own record
  /// of what it bought, so it names the supplier instead of a customer.
  static Future<List<int>> buildPurchaseBill(PurchaseInvoice inv) async {
    final cols = await getColumns();
    final bytes = await _header();
    bytes.addAll(_title('PURCHASE BILL', cols));
    bytes.addAll(_asciiLine(_twoCol('Purchase No.', inv.billNo ?? '-', cols)));
    bytes.addAll(_asciiLine(_twoCol('Date', inv.postingDate, cols)));
    bytes.addAll(_asciiLine(_twoCol('Supplier', inv.supplierLabel ?? '-', cols)));
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(_asciiLine(_twoCol('# Item', 'Qty    Rate      Amount', cols)));
    double totalQty = 0;
    for (var i = 0; i < inv.items.length; i++) {
      final it = inv.items[i];
      totalQty += it.qty;
      bytes.addAll(_asciiLine('${i + 1} ${it.itemName}'));
      bytes.addAll(_asciiLine(
          _twoCol('', '${_qtyStr(it.qty)} ${uomAbbr(it.uom)} x ${_money(it.rate)} = ${_money(it.lineTotal)}', cols)));
    }
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(_asciiLine(_twoCol('Total Qty', _qtyStr(totalQty), cols)));
    bytes.addAll(boldOn);
    bytes.addAll(_asciiLine(_twoCol('TOTAL', _money(inv.grandTotal), cols)));
    bytes.addAll(boldOff);
    bytes.addAll(_asciiLine(_line('-', cols)));
    bytes.addAll(alignCenter);
    bytes.addAll(_asciiLine(await AppSettings.billFooter()));
    bytes.addAll(await cutSequence());
    return bytes;
  }

  static String _qtyStr(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  static Future<String?> _send(List<int> bytes) async {
    final connection = await AppSettings.printerConnection();
    if (connection == 'bluetooth') {
      final btErr = await _sendBluetooth(bytes);
      if (btErr == null) return null;
      // If Bluetooth fails and USB is attached, try USB fallback
      final usbErr = await _sendUsb(bytes);
      return usbErr == null ? null : btErr;
    }
    // Default: USB OTG
    final usbErr = await _sendUsb(bytes);
    if (usbErr == null) return null;
    // If USB failed, attempt Bluetooth if configured
    final mac = await AppSettings.printerMac();
    if (mac != null) {
      final btErr = await _sendBluetooth(bytes);
      if (btErr == null) return null;
    }
    return usbErr;
  }

  static Future<String?> _sendBluetooth(List<int> bytes) async {
    final mac = await AppSettings.printerMac();
    if (mac == null) return 'Printer set nahi hai — Utilities → Printer Settings se jodo.';
    final granted = await PrintBluetoothThermal.isPermissionBluetoothGranted;
    if (!granted) return 'Bluetooth permission nahi mili.';
    final alreadyConnected = await PrintBluetoothThermal.connectionStatus;
    if (!alreadyConnected) {
      final connected = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
      if (!connected) return 'Printer se connect nahi ho paya. Printer ON hai aur paas mein hai, check karo.';
    }
    final ok = await PrintBluetoothThermal.writeBytes(bytes);
    return ok ? null : 'Print bhej nahi paye — printer check karo.';
  }

  static Future<String?> _sendUsb(List<int> bytes) async {
    int? vendorId = await AppSettings.printerUsbVendorId();
    int? productId = await AppSettings.printerUsbProductId();
    final usb = FlutterUsbWrite();
    if (vendorId == null || productId == null) {
      // Auto-detect connected USB printer if cable is plugged in
      try {
        final devices = await usb.listDevices();
        if (devices.isNotEmpty) {
          final d = devices.first;
          vendorId = d.vid;
          productId = d.pid;
          if (vendorId != null && productId != null) {
            final name = d.productName?.trim().isNotEmpty == true ? d.productName!.trim() : 'USB Printer';
            await AppSettings.setUsbPrinter(vendorId, productId, name);
          }
        }
      } catch (_) {}
    }
    if (vendorId == null || productId == null) return 'USB printer nahi mila — OTG cable laga hai aur printer ON hai, check karo.';
    try {
      await usb.open(vendorId: vendorId, productId: productId);
      final ok = await usb.write(Uint8List.fromList(bytes));
      await usb.close();
      return ok == true ? null : 'Print bhej nahi paye — USB printer check karo.';
    } on DeviceNotFoundException {
      return 'USB printer nahi mila — cable laga hai aur printer ON hai, check karo.';
    } on PermissionException {
      return 'USB permission nahi mili — phone par popup aaya to Allow karo.';
    } catch (_) {
      return 'USB printer se print nahi ho paya.';
    }
  }

  static Future<String?> printSalesBill(Invoice inv, {String? templateOverride}) async =>
      _send(await buildSalesBill(inv, templateOverride: templateOverride));
  static Future<String?> printEstimate(QuickDoc doc) async => _send(await buildEstimate(doc));
  static Future<String?> printQuickDoc(QuickDoc doc, String titleLabel) async =>
      _send(await buildQuickDoc(doc, titleLabel));
  static Future<String?> printPurchaseBill(PurchaseInvoice inv) async =>
      _send(await buildPurchaseBill(inv));
}
