import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'db.dart';

/// WhatsApp Connect + Transaction Message, the mobile-honest version: this
/// app has no server-side WhatsApp Business API session to hold open (that
/// is what the web screen's "Connect" step logs into), so there is no
/// "connected" state to show. What it CAN do, and does for real, is open
/// WhatsApp itself with the message pre-filled via the wa.me link — the
/// same mechanism every "Share to WhatsApp" button anywhere on Android
/// uses. The shopkeeper still taps Send inside WhatsApp; nothing here sends
/// silently in the background.
Future<void> shareViaWhatsApp(
  BuildContext context, {
  required String message,
  String? phone,
  required String docType,
  String? docNo,
  String? partyLabel,
  String? attachmentPath,
}) async {
  // A file cannot ride along on a wa.me link — that URL carries text only.
  // So an attached bill goes out through Android's share sheet instead,
  // where WhatsApp is one tap away and the PDF actually travels with the
  // message. Text-only shares keep the direct link, which lands straight in
  // the right chat without the extra picker.
  if (attachmentPath != null) {
    await Share.shareXFiles([XFile(attachmentPath)], text: message);
    await AppDb.instance.logMessage(docType: docType, docNo: docNo, partyLabel: partyLabel, phone: phone, body: message);
    return;
  }

  // wa.me needs digits only; a blank/invalid phone still opens WhatsApp's
  // own contact picker rather than failing silently.
  final digits = (phone ?? '').replaceAll(RegExp(r'[^0-9]'), '');
  final hasPhone = digits.length >= 10;
  final phoneForLink = hasPhone ? (digits.length == 10 ? '91$digits' : digits) : null;
  final uri = Uri.https('wa.me', phoneForLink ?? '', {'text': message});

  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('WhatsApp nahi khul paya — installed hai?')));
    }
    return;
  }
  await AppDb.instance.logMessage(docType: docType, docNo: docNo, partyLabel: partyLabel, phone: phone, body: message);
}

/// Fills a saved template's {placeholder}s with real values. Unknown
/// placeholders are left as-is rather than silently dropped, so a typo in
/// the template is visible instead of vanishing into blank space.
String fillTemplate(String template, Map<String, String> values) {
  var out = template;
  values.forEach((key, value) => out = out.replaceAll('{$key}', value));
  return out;
}
