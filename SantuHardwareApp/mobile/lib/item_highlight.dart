import 'package:flutter/material.dart';

import 'db.dart';
import 'models.dart';

/// Item ki pehchaan rang se — the one place every screen asks "what colour
/// is this row". Mirrors santu_item_highlight.js: user rules first (earlier
/// in the list wins), then the two built-in, un-removable defaults CPVC
/// (yellow) and UPVC (pink), a strict "cpvc"/"upvc" substring match. Never
/// stored on the item itself — recomputed from the live rule list every
/// time, same as the web app, so editing a rule repaints every item that
/// matches it without touching any item row.
class ItemHighlight {
  ItemHighlight._();

  static const _cpvcHex = '#f5d90a';
  static const _upvcHex = '#ec4899';
  static const minBlend = 0.82;

  static List<ItemHighlightRule> _rules = [];

  static Future<void> load() async {
    _rules = await AppDb.instance.listHighlightRules();
  }

  static Future<void> save(List<ItemHighlightRule> rules) async {
    await AppDb.instance.saveHighlightRules(rules);
    _rules = rules;
  }

  static List<ItemHighlightRule> get rules => _rules;

  /// The pale background a matching row should use, or null for no match.
  static Color? colorFor(String itemCode, String itemName) {
    for (final r in _rules) {
      if (r.matches(itemCode, itemName)) return lighten(_parseHex(r.color), minBlend);
    }
    final code = itemCode.toLowerCase();
    final name = itemName.toLowerCase();
    if (code.contains('cpvc') || name.contains('cpvc')) return lighten(_parseHex(_cpvcHex), minBlend);
    if (code.contains('upvc') || name.contains('upvc')) return lighten(_parseHex(_upvcHex), minBlend);
    return null;
  }

  static Color _parseHex(String hex) {
    final h = hex.replaceFirst('#', '');
    return Color(int.parse('FF$h', radix: 16));
  }

  /// Mixes [c] toward white by [amount] (0 = colour as-is, 1 = pure white) —
  /// same blend santu_hl_lighten does, so a rule previewed here looks like
  /// what the PC app would show too.
  static Color lighten(Color c, double amount) {
    final a = amount.clamp(0.0, 1.0);
    int mix(int ch) => (ch + (255 - ch) * a).round();
    final r = (c.r * 255).round();
    final g = (c.g * 255).round();
    final b = (c.b * 255).round();
    return Color.fromARGB(255, mix(r), mix(g), mix(b));
  }

  static String colorToHex(Color c) {
    final r = (c.r * 255).round();
    final g = (c.g * 255).round();
    final b = (c.b * 255).round();
    return '#${r.toRadixString(16).padLeft(2, '0')}${g.toRadixString(16).padLeft(2, '0')}${b.toRadixString(16).padLeft(2, '0')}';
  }
}
