import 'models.dart';

/// First-run sample catalogue so the app opens with something to bill
/// against instead of an empty screen. Real shops will import their own
/// item/customer list (CSV import is a follow-up module) — this is a demo
/// seed, not the user's real data.
List<Item> demoItems() => [
      Item(itemCode: 'PIPE-2IN', itemName: 'Tata Steel Pipe 2"', stockUom: 'Nos', priceListRate: 450, costPrice: 390, availableQty: 48),
      Item(itemCode: 'PAINT-AS-1L-WHT', itemName: 'Asian Paints 1L White', stockUom: 'Nos', priceListRate: 320, costPrice: 260, availableQty: 22),
      Item(itemCode: 'CEMENT-50KG', itemName: 'Cement Bag 50kg', stockUom: 'Bag', priceListRate: 380, costPrice: 340, availableQty: 120),
      Item(itemCode: 'NAILS-1KG', itemName: 'Iron Nails 1kg', stockUom: 'Kg', priceListRate: 90, costPrice: 70, availableQty: 60),
      Item(itemCode: 'TAPE-INS', itemName: 'Insulation Tape', stockUom: 'Nos', priceListRate: 25, costPrice: 15, availableQty: 200),
      Item(itemCode: 'WIRE-2.5SQ', itemName: 'Copper Wire 2.5sqmm (90m)', stockUom: 'Roll', priceListRate: 2200, costPrice: 1950, availableQty: 14),
      Item(itemCode: 'TILE-ADH-20KG', itemName: 'Tile Adhesive 20kg', stockUom: 'Bag', priceListRate: 410, costPrice: 360, availableQty: 35),
      Item(itemCode: 'LOCK-DOOR-STD', itemName: 'Door Lock Standard', stockUom: 'Nos', priceListRate: 650, costPrice: 520, availableQty: 18),
    ];

List<Supplier> demoSuppliers() => [
      Supplier(name: 'SUP-0001', supplierName: 'Tata Steel Distributors', phone: '9876600001'),
      Supplier(name: 'SUP-0002', supplierName: 'Asian Paints Depot', phone: '9876600002'),
    ];

List<Customer> demoCustomers() => [
      Customer(name: 'CUST-0001', customerName: 'Ramesh Traders', phone: '9876500001', village: 'Purshauli'),
      Customer(name: 'CUST-0002', customerName: 'Gupta Hardware', phone: '9876500002', village: 'Dumraon'),
      Customer(name: 'CUST-0003', customerName: 'Walk-in Customer', phone: null, village: null),
      Customer(name: 'CUST-0004', customerName: 'Ankit Plumber', phone: '6206697775', village: 'Ishuwapur'),
      Customer(name: 'CUST-0005', customerName: 'Dheeraj Singh', phone: '7849036778', village: 'Saran'),
      Customer(name: 'CUST-0006', customerName: 'Madhu Mohan Singh', phone: '8882004046', village: 'Mahuli'),
      Customer(name: 'CUST-0007', customerName: 'Shiv Shakti H/w', phone: '9939397667', village: 'Bhakura Bhithi'),
      Customer(name: 'CUST-0008', customerName: 'Wajir', phone: '7277264795', village: 'Chandpurwa'),
      Customer(name: 'CUST-0009', customerName: 'Abhishek Singh', phone: '8521472650', village: 'Nawada'),
      Customer(name: 'CUST-0010', customerName: 'Anup Sharma', phone: '9525321006', village: 'Pyrepur'),
      Customer(name: 'CUST-0011', customerName: 'Dheeraj Kr Singh', phone: '9546920031', village: 'Goha'),
      Customer(name: 'CUST-0012', customerName: 'Jay Prakash Singh', phone: '7226064804', village: 'Ghamariya'),
      Customer(name: 'CUST-0013', customerName: 'Kanhaiya Kr', phone: '7632954272', village: 'Salempur'),
      Customer(name: 'CUST-0014', customerName: 'Vinay Kumar', phone: '9097441600', village: 'Ishuapur'),
      Customer(name: 'CUST-0015', customerName: 'Vishal Plumber', phone: '8434381141', village: 'Pyarepur'),
    ];
