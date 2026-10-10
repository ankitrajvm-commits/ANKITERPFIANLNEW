import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:shared_preferences/shared_preferences.dart';

import 'app_lock_screen.dart';
import 'app_settings.dart';
import 'db.dart';
import 'home_shell.dart';
import 'item_catalog.dart';
import 'item_highlight.dart';
import 'seed_data.dart';
import 'theme.dart';

void main() {
  runApp(const SantuHardwareApp());
}

class SantuHardwareApp extends StatelessWidget {
  const SantuHardwareApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Santu Hardware',
      debugShowCheckedModeBanner: false,
      theme: santuTheme(),
      home: const _Bootstrap(),
    );
  }
}

/// Seeds the local database with demo items/customers on first launch only
/// (a real shop would import its own catalogue instead — see seed_data.dart)
/// then hands off to the billing screen.
class _Bootstrap extends StatefulWidget {
  const _Bootstrap();

  @override
  State<_Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<_Bootstrap> {
  bool _ready = false;
  bool _locked = false;

  @override
  void initState() {
    super.initState();
    _seedIfEmpty();
  }

  Future<void> _seedIfEmpty() async {
    final prefs = await SharedPreferences.getInstance();
    const catalogKey = 'catalog_seeded_v2';
    final existing = await AppDb.instance.searchItems('');
    if (existing.isEmpty) {
      // First install — load the real shop catalogue from the uploaded Excel
      // (856 items) instead of the tiny demo seed.
      try {
        final catalog = await loadBundledCatalog();
        await AppDb.instance.upsertItems(catalog);
      } catch (_) {
        await AppDb.instance.upsertItems(demoItems());
      }
      await AppDb.instance.upsertCustomers(demoCustomers());
      await AppDb.instance.upsertSuppliers(demoSuppliers());
    } else if (prefs.getBool(catalogKey) != true && existing.length <= 8) {
      // Old demo-only install — upgrade to the real catalogue once.
      try {
        final catalog = await loadBundledCatalog();
        await AppDb.instance.upsertItems(catalog);
      } catch (_) {}
    }
    // One-time import of the 30 rows from the uploaded MRP/SP workbook.
    // Their deterministic codes update the matching existing items and add
    // the previously absent variants without touching other catalogue rows.
    if (prefs.getBool(catalogKey) != true) {
      try {
        await AppDb.instance.upsertItems(await loadSupremeLifelineItems());
        await prefs.setBool(catalogKey, true);
      } catch (_) {}
    }
    const customerVillageKey = 'customer_villages_seeded_v1';
    if (prefs.getBool(customerVillageKey) != true) {
      try {
        await AppDb.instance.upsertCustomers(demoCustomers());
        await prefs.setBool(customerVillageKey, true);
      } catch (_) {}
    }
    await ItemHighlight.load();
    await _seedFeatureWorkbook();
    final pin = await AppSettings.appLockPin();
    setState(() {
      _locked = pin != null;
      _ready = true;
    });
  }

  /// Utilities > Feature Workbook — the PC dev team's own feature backlog,
  /// carried over so it's browsable on the phone too (seeded once from the
  /// bundled export; see assets/feature_workbook.json).
  Future<void> _seedFeatureWorkbook() async {
    final raw = await rootBundle.loadString('assets/feature_workbook.json');
    final rows = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    await AppDb.instance.seedFeatureDocsIfEmpty(rows.map((r) => r.cast<String, Object?>()).toList());
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_locked) return AppLockScreen(onUnlocked: () => setState(() => _locked = false));
    return const HomeShell();
  }
}
