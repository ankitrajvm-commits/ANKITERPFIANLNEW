import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'theme.dart';

/// What was deleted, and a way to put it back — mirrors santu_recycle_bin.js
/// scoped to the record types a shopkeeper would actually want back (items,
/// customers, suppliers, sales and purchase invoices), same scoping the web
/// screen's own comment describes.
class RecycleBinScreen extends StatefulWidget {
  const RecycleBinScreen({super.key});

  @override
  State<RecycleBinScreen> createState() => _RecycleBinScreenState();
}

class _RecycleBinScreenState extends State<RecycleBinScreen> {
  bool _loading = true;
  List<Map<String, Object?>> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await AppDb.instance.listDeleted();
    setState(() {
      _rows = rows;
      _loading = false;
    });
  }

  Future<void> _restore(Map<String, Object?> row) async {
    await AppDb.instance.restore(row['table'] as String, row['id_col'] as String, row['id'] as String);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${row['name']} wapas aa gaya')));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recycle Bin')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _rows.isEmpty
              ? const Center(child: Text('Recycle Bin khaali hai', style: TextStyle(color: SantuColors.textMuted)))
              : ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (ctx, i) {
                    final r = _rows[i];
                    final deletedAt = DateTime.tryParse(r['deleted_at'] as String? ?? '');
                    return ListTile(
                      title: Text('${r['name']}'),
                      subtitle: Text('${r['label']}${deletedAt != null ? ' · ${DateFormat('dd MMM yyyy, hh:mm a').format(deletedAt)}' : ''}'),
                      trailing: TextButton.icon(onPressed: () => _restore(r), icon: const Icon(Icons.restore, size: 18), label: const Text('Restore')),
                    );
                  },
                ),
    );
  }
}
