import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// "Print" on this app always means the thermal slip on the counter's printer —
/// never the A4 bill (BUSINESS_RULES.md 2.6). A4 exists only for WhatsApp/PDF
/// share and the on-screen template preview.
///
/// The wiring lives in button callbacks, so there is no function a normal unit
/// test could call to catch this: a Print button repointed at A4Invoice would
/// sail past every other test in here and only show up as a full A4 page
/// crawling out of a 80mm thermal printer at the counter. Hence a source-level
/// guard.
void main() {
  final sources = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  // The only places allowed to touch the A4 document at all. Every one is a
  // share or an on-screen preview, never a printer path.
  const a4Allowed = {
    'a4_invoice_pdf.dart', // the builder itself
    'invoice_templates.dart', // A4InvoiceWidget — on-screen preview only
    'transaction_actions.dart', // "Send A4 PDF"
    'billing_screen.dart', // PDF attached to a WhatsApp send
    'invoice_settings_screen.dart', // Invoice Settings preview pane
  };

  test('only share and preview paths build the A4 bill', () {
    final offenders = <String>[];
    for (final f in sources) {
      final name = f.uri.pathSegments.last;
      if (a4Allowed.contains(name)) continue;
      if (f.readAsStringSync().contains('A4Invoice')) offenders.add(name);
    }
    expect(
      offenders,
      isEmpty,
      reason: 'A4Invoice reached a new file. If it is a share/PDF path, add it '
          'to a4Allowed; if it is a print path, it must use ThermalReceipt.',
    );
  });

  test('no Print button builds an A4 bill', () {
    // A Print control and the A4 builder sitting inside the same callback is
    // the exact regression this guards: the legitimate A4 call sites live in
    // save/share handlers, nowhere near a print control.
    //
    // The window reaches backwards as well as forwards because these buttons
    // are written `onPressed:` first and `icon: Icon(Icons.print)` after, so
    // an A4 call smuggled into the callback body sits *above* the marker.
    final printMarker = RegExp(r"Icons\.print|Text\('Print'\)|Save & Print");
    final offenders = <String>[];
    for (final f in sources) {
      final lines = f.readAsStringSync().split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (!printMarker.hasMatch(lines[i])) continue;
        final window = lines.sublist(
          (i - 15).clamp(0, lines.length),
          (i + 15).clamp(0, lines.length),
        );
        if (window.join('\n').contains('A4Invoice')) {
          offenders.add('${f.uri.pathSegments.last}:${i + 1}');
        }
      }
    }
    expect(offenders, isEmpty, reason: 'Print control wired to the A4 bill');
  });

  test('every screen with a Print control prints through ThermalReceipt', () {
    final printMarker = RegExp(r"Icons\.print|Text\('Print'\)|Save & Print");
    final missing = <String>[];
    for (final f in sources) {
      final src = f.readAsStringSync();
      final name = f.uri.pathSegments.last;
      // printer_settings_screen sends its own test slip; more_screen's print
      // icon is just the link to that screen.
      if (name == 'printer_settings_screen.dart' || name == 'more_screen.dart') continue;
      if (!printMarker.hasMatch(src)) continue;
      if (!src.contains('ThermalReceipt') && !src.contains('TransactionActions.printInvoice')) {
        missing.add(name);
      }
    }
    expect(missing, isEmpty, reason: 'Print control with no thermal print behind it');
  });
}
