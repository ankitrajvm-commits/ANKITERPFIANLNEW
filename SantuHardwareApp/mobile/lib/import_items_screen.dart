import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import 'db.dart';
import 'item_catalog.dart';
import 'models.dart';
import 'theme.dart';

/// Utilities > Import Items — same Excel template as the PC app.
class ImportItemsScreen extends StatefulWidget {
  const ImportItemsScreen({super.key});

  @override
  State<ImportItemsScreen> createState() => _ImportItemsScreenState();
}

class _ImportItemsScreenState extends State<ImportItemsScreen> {
  bool _busy = false;
  String? _status;

  Future<void> _pickAndImport() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['xlsx', 'xls', 'csv'],
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;

    setState(() {
      _busy = true;
      _status = null;
    });

    try {
      final file = result.files.first;
      List<Item> items;
      if (file.extension?.toLowerCase() == 'csv') {
        final text = String.fromCharCodes(file.bytes!);
        items = _itemsFromCsv(text);
      } else {
        items = itemsFromExcelBytes(file.bytes!);
      }
      if (items.isEmpty) {
        setState(() {
          _busy = false;
          _status = 'File me koi item nahi mila — column names check karein.';
        });
        return;
      }
      await AppDb.instance.upsertItems(items);
      setState(() {
        _busy = false;
        _status = '${items.length} items import ho gaye — purane codes update ho gaye, naye add hue.';
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _status = 'Import fail: $e';
      });
    }
  }

  Future<void> _loadBundled() async {
    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      final items = await loadBundledCatalog();
      await AppDb.instance.upsertItems(items);
      setState(() {
        _busy = false;
        _status = 'Shop catalogue (${items.length} items) load ho gaya.';
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _status = 'Catalog load fail: $e';
      });
    }
  }

  List<Item> _itemsFromCsv(String text) {
    final lines = text.split('\n').where((l) => l.trim().isNotEmpty).toList();
    if (lines.length < 2) return [];
    final headers = _splitCsv(lines.first);
    final out = <Item>[];
    for (var i = 1; i < lines.length; i++) {
      final cols = _splitCsv(lines[i]);
      final map = <String, String>{};
      for (var c = 0; c < headers.length && c < cols.length; c++) {
        map[headers[c].trim()] = cols[c].trim();
      }
      final item = itemFromImportedRow(map);
      if (item != null) out.add(item);
    }
    return out;
  }

  List<String> _splitCsv(String line) {
    final out = <String>[];
    final b = StringBuffer();
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      final ch = line[i];
      if (ch == '"') {
        inQ = !inQ;
      } else if (ch == ',' && !inQ) {
        out.add(b.toString());
        b.clear();
      } else {
        b.write(ch);
      }
    }
    out.add(b.toString());
    return out;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Import Items')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Excel se items daalein — wahi format jo PC par Utilities > Import Items use karta hai.',
            style: TextStyle(color: SantuColors.textMuted),
          ),
          const SizedBox(height: 16),
          if (_busy) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
          if (!_busy) ...[
            FilledButton.icon(
              onPressed: _pickAndImport,
              icon: const Icon(Icons.upload_file),
              label: const Text('Excel / CSV file chunein'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _loadBundled,
              icon: const Icon(Icons.inventory_2_outlined),
              label: const Text('Bundled shop catalogue load karein (856 items)'),
            ),
          ],
          if (_status != null) ...[
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFBBF7D0)),
              ),
              child: Text(_status!, style: const TextStyle(fontSize: 13)),
            ),
          ],
          const SizedBox(height: 24),
          const Text('Expected columns', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(height: 6),
          const Text(
            'Standard: Item Code, Item Name, Sale Price, Purchase Price, Opening Stock Quantity, Stock UOM, Barcode\n'
            'Supplier sheet: Item Name, Size (inch), MRP, SP — SP selling price banega aur size naam me jud jayega.\n\n'
            'Agar Item Code khali hai to naam aur size se code ban jayega. Purana code mila to update hoga, nahi to naya add hoga.',
            style: TextStyle(fontSize: 12, color: SantuColors.textMuted, height: 1.4),
          ),
        ],
      ),
    );
  }
}
