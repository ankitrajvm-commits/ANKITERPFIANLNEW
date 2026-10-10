import 'dart:convert';
import 'dart:io';

import 'package:excel/excel.dart';
import 'package:flutter/services.dart' show rootBundle;

import 'models.dart';

/// Parse the same Excel export the PC app uses (Items Export sheet).
/// Column names match santu_utilities_views.js / items-export template.
List<Item> itemsFromExcelBytes(List<int> bytes) {
  final excel = Excel.decodeBytes(bytes);
  final sheet = excel.tables.values.first;
  if (sheet.maxRows < 2) return [];

  final headers = <String>[];
  for (var c = 0; c < sheet.maxColumns; c++) {
    final cell = sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0));
    headers.add(_cellStr(cell).trim());
  }

  final out = <Item>[];
  for (var r = 1; r < sheet.maxRows; r++) {
    final row = <String, String>{};
    for (var c = 0; c < headers.length; c++) {
      final h = headers[c];
      if (h.isEmpty) continue;
      row[h] = _cellStr(sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r)));
    }
    final item = itemFromImportedRow(row);
    if (item != null) out.add(item);
  }
  return out;
}

List<Item> itemsFromJsonString(String raw) {
  final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
  return list.map((m) => Item.fromMap(m.cast<String, Object?>())).toList();
}

Future<List<Item>> loadBundledCatalog() async {
  final raw = await rootBundle.loadString('assets/catalog_items.json');
  return itemsFromJsonString(raw);
}

/// The marked Supreme Lifeline list supplied for this build.  Kept separate
/// from the main export so existing installations can receive only this small
/// catalogue update without overwriting unrelated item edits.
Future<List<Item>> loadSupremeLifelineItems() async {
  final raw = await rootBundle.loadString('assets/supreme_lifeline_items.json');
  return itemsFromJsonString(raw);
}

Future<List<Item>> itemsFromExcelFile(File file) async {
  return itemsFromExcelBytes(await file.readAsBytes());
}

String exportItemsCsv(List<Item> items) {
  final b = StringBuffer('Item Code,Item Name,Sale Price,Purchase Price,Opening Stock Quantity,Stock UOM,Barcode\n');
  for (final i in items) {
    b.writeln([
      _csv(i.itemCode),
      _csv(i.itemName),
      i.priceListRate.toStringAsFixed(2),
      i.costPrice?.toStringAsFixed(2) ?? '0',
      i.availableQty.toStringAsFixed(2),
      _csv(i.stockUom),
      _csv(i.barcode ?? ''),
    ].join(','));
  }
  return b.toString();
}

/// Supports both the app's standard export columns and supplier price sheets.
///
/// The Supreme Lifeline workbook supplied with the app uses `Item Name`,
/// `Size (inch)`, `MRP`, and `SP`.  Its size is part of the product identity;
/// without it, for example, all CPVC tees would collapse into one item.
Item? itemFromImportedRow(Map<String, String> d) {
  String valueFor(List<String> keys) {
    for (final key in keys) {
      final direct = d[key];
      if (direct != null && direct.trim().isNotEmpty) return direct.trim();
    }
    final wanted = keys.map((key) => key.toLowerCase()).toSet();
    for (final entry in d.entries) {
      if (wanted.contains(entry.key.trim().toLowerCase()) && entry.value.trim().isNotEmpty) {
        return entry.value.trim();
      }
    }
    return '';
  }

  var code = valueFor(const ['Item Code', 'item_code']);
  final baseName = valueFor(const ['Item Name', 'item_name']);
  final size = valueFor(const ['Size (inch)', 'Size', 'size']);
  // Some spreadsheets encode the degree sign as a replacement character.
  final name = [baseName, size].where((part) => part.isNotEmpty).join(' ').replaceAll('�', '°');
  if (code.isEmpty && name.isEmpty) return null;
  if (code.isEmpty) {
    code = name.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-').replaceAll(RegExp(r'^-|-$'), '').toUpperCase();
    if (code.isEmpty) code = 'ITEM';
  }
  final sale = double.tryParse(valueFor(const ['Sale Price', 'price_list_rate', 'SP'])) ?? 0;
  final purchase = double.tryParse(valueFor(const ['Purchase Price', 'cost_price'])) ?? 0;
  final qty = double.tryParse(valueFor(const ['Opening Stock Quantity', 'available_qty'])) ?? 0;
  final uom = valueFor(const ['Stock UOM', 'stock_uom']).isEmpty ? 'Nos' : valueFor(const ['Stock UOM', 'stock_uom']);
  final barcode = valueFor(const ['Barcode', 'barcode']);
  return Item(
    itemCode: code,
    itemName: name.isEmpty ? code : name,
    stockUom: uom,
    priceListRate: sale,
    costPrice: purchase > 0 ? purchase : null,
    availableQty: qty,
    barcode: barcode.isEmpty ? null : barcode,
  );
}

String _cellStr(Data? cell) {
  if (cell == null || cell.value == null) return '';
  final v = cell.value!;
  if (v is IntCellValue) return v.value.toString();
  if (v is DoubleCellValue) return v.value == v.value.roundToDouble() ? v.value.toInt().toString() : v.value.toString();
  return v.toString().trim();
}

String _csv(String s) {
  if (s.contains(',') || s.contains('"') || s.contains('\n')) {
    return '"${s.replaceAll('"', '""')}"';
  }
  return s;
}
