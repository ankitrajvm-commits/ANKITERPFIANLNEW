import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import 'db.dart';
import 'item_catalog.dart';
import 'shareable_file.dart';
import 'theme.dart';

/// Utilities > Export Items — CSV share sheet, same data the PC Excel export has.
class ExportItemsScreen extends StatefulWidget {
  const ExportItemsScreen({super.key});

  @override
  State<ExportItemsScreen> createState() => _ExportItemsScreenState();
}

class _ExportItemsScreenState extends State<ExportItemsScreen> {
  bool _loading = true;
  int _count = 0;

  @override
  void initState() {
    super.initState();
    _loadCount();
  }

  Future<void> _loadCount() async {
    final items = await AppDb.instance.allItems();
    setState(() {
      _count = items.length;
      _loading = false;
    });
  }

  Future<void> _export() async {
    setState(() => _loading = true);
    final items = await AppDb.instance.allItems();
    final csv = exportItemsCsv(items);
    final file = await shareableFile('items-export-${DateTime.now().millisecondsSinceEpoch}.csv');
    await file.writeAsString(csv);
    await Share.shareXFiles([XFile(file.path)], text: 'Santu Hardware — Items Export ($_count items)');
    setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Export Items')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('$_count items catalogue me hain.', style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 8),
            const Text(
              'CSV file ban kar share karein — Excel me khol sakte ho ya doosri shop me import kar sakte ho.',
              style: TextStyle(color: SantuColors.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 24),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else
              FilledButton.icon(
                onPressed: _export,
                icon: const Icon(Icons.ios_share),
                label: const Text('Export & Share CSV'),
              ),
          ],
        ),
      ),
    );
  }
}
