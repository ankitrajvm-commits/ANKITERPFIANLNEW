import 'package:flutter_test/flutter_test.dart';
import 'package:santu_hardware_mobile/item_catalog.dart';

void main() {
  test('maps an MRP/SP supplier row without collapsing its size', () {
    final item = itemFromImportedRow({
      'Item Name': 'SUPREME CPVC REDUCER',
      'Size (inch)': '1" x 3/4"',
      'MRP': '69',
      'SP': '31.05',
    });

    expect(item, isNotNull);
    expect(item!.itemName, 'SUPREME CPVC REDUCER 1" x 3/4"');
    expect(item.itemCode, 'SUPREME-CPVC-REDUCER-1-X-3-4');
    expect(item.priceListRate, 31.05);
    expect(item.stockUom, 'Nos');
  });
}
