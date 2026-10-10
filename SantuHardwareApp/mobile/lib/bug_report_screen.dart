import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:sqflite/sqflite.dart';

import 'db.dart';
import 'theme.dart';
import 'whatsapp_util.dart';

class BugReportScreen extends StatefulWidget {
  const BugReportScreen({super.key});

  @override
  State<BugReportScreen> createState() => _BugReportScreenState();
}

class _BugReportScreenState extends State<BugReportScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _stepsCtrl = TextEditingController();
  String _category = 'Billing & POS';
  final _categories = const [
    'Billing & POS',
    'Thermal Printing',
    'Inventory & Stock',
    'Dues & Udhaar Khata',
    'WhatsApp Sharing',
    'Backup & Restore',
    'Other / Crash',
  ];

  bool _loading = true;
  int _itemCount = 0;
  int _customerCount = 0;
  int _invoiceCount = 0;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final items = await AppDb.instance.allItems();
    final customers = await AppDb.instance.allCustomers();
    final db = await AppDb.instance.database;
    final invCount = Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM invoice WHERE deleted_at IS NULL")) ?? 0;
    setState(() {
      _itemCount = items.length;
      _customerCount = customers.length;
      _invoiceCount = invCount;
      _loading = false;
    });
  }

  String _buildDiagnosticReport() {
    return '''
=== SANTU HARDWARE BUG REPORT ===
App: Santu Hardware Mobile (Android Local)
Version: 1.0.0+1
DB Version: 14 (SQLite)
Timestamp: ${DateTime.now().toIso8601String()}

Items Count: $_itemCount
Customers Count: $_customerCount
Invoices Count: $_invoiceCount

Category: $_category
Summary: ${_titleCtrl.text.trim()}

Description:
${_descCtrl.text.trim()}

Steps to Reproduce:
${_stepsCtrl.text.trim()}
=================================
''';
  }

  Future<void> _copyReport() async {
    final report = _buildDiagnosticReport();
    await Clipboard.setData(ClipboardData(text: report));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bug report copied to clipboard ✓')));
  }

  Future<void> _sendViaWhatsApp() async {
    if (_titleCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Kripya issue ka title likhein')));
      return;
    }
    final report = _buildDiagnosticReport();
    await shareViaWhatsApp(context, message: report, docType: 'Bug Report');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bug Report')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Koi problem aayi ho to yahan report karein. System details apne aap jud jayengi.',
                  style: TextStyle(fontSize: 12.5, color: SantuColors.textMuted),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: [for (final c in _categories) DropdownMenuItem(value: c, child: Text(c))],
                  onChanged: (v) => setState(() => _category = v ?? _categories.first),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _titleCtrl,
                  decoration: const InputDecoration(labelText: 'Issue Summary', hintText: 'Short description of what went wrong'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _descCtrl,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Detailed Description', hintText: 'Explain what happened...'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _stepsCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Steps to Reproduce', hintText: '1. Clicked Billing\n2. Selected item...'),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: SantuColors.card,
                    border: Border.all(color: SantuColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Auto-Captured Diagnostics', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 4),
                      Text('Platform: Android Local · SQLite Schema v14\nTotal Items: $_itemCount · Customers: $_customerCount · Invoices: $_invoiceCount',
                          style: const TextStyle(fontSize: 11.5, color: SantuColors.textMuted)),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _copyReport,
                        icon: const Icon(Icons.copy, size: 18),
                        label: const Text('Copy Report'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: SantuColors.green),
                        onPressed: _sendViaWhatsApp,
                        icon: const Icon(Icons.chat, size: 18),
                        label: const Text('Send WhatsApp'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
