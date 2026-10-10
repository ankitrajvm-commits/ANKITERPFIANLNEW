import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import 'models.dart';

/// On-device database. Everything billing needs — items, customers, bills —
/// lives here, so the app works with zero network/server dependency, the
/// same way Vyapar's own mobile app works.
class AppDb {
  AppDb._();
  static final AppDb instance = AppDb._();
  Database? _db;

  Future<Database> get database async {
    _db ??= await _open();
    return _db!;
  }

  Future<Database> _open() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'santu_hardware.db');
    return openDatabase(
      path,
      version: 16,
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) await _createPurchaseTables(db);
        if (oldVersion < 3) await _createExpenseTable(db);
        if (oldVersion < 4) await _createQuickDocTables(db);
        if (oldVersion < 5) await _createPaymentTable(db);
        if (oldVersion < 6) await _createQuickDocTables(db); // adds sales_order/purchase_order (IF NOT EXISTS, safe to rerun)
        if (oldVersion < 7) await _addSoftDeleteAndMessaging(db);
        if (oldVersion < 8) await _addBillPhotoColumn(db);
        if (oldVersion < 9) await _addPartyTypeAndManualDue(db);
        if (oldVersion < 10) await _addInvoiceRemarks(db);
        if (oldVersion < 11) await _createItemHighlightTable(db);
        if (oldVersion < 12) await _createFeatureDocTable(db);
        if (oldVersion < 13) await _addInvoiceBillingFields(db);
        if (oldVersion < 14) {
          await _addStockAndLoyaltyFields(db);
          await _createQuickDocTables(db);
        }
        if (oldVersion < 15) {
          await _createFeatureDocTable(db);
        }
        if (oldVersion < 16) {
          await _addCustomerVillage(db);
        }
      },
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE item (
            item_code TEXT PRIMARY KEY,
            item_name TEXT NOT NULL,
            stock_uom TEXT NOT NULL,
            price_list_rate REAL NOT NULL DEFAULT 0,
            cost_price REAL,
            available_qty REAL NOT NULL DEFAULT 0,
            barcode TEXT
          )
        ''');
        await db.execute('CREATE INDEX idx_item_name ON item(item_name)');
        await db.execute('CREATE INDEX idx_item_barcode ON item(barcode)');

        await db.execute('''
          CREATE TABLE customer (
            name TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            phone TEXT,
            village TEXT
          )
        ''');
        await db.execute('CREATE INDEX idx_customer_name ON customer(customer_name)');

        await db.execute('''
          CREATE TABLE invoice (
            id TEXT PRIMARY KEY,
            bill_no TEXT,
            posting_date TEXT NOT NULL,
            customer TEXT,
            customer_label TEXT,
            additional_charges REAL NOT NULL DEFAULT 0,
            bill_discount REAL NOT NULL DEFAULT 0,
            payment_mode TEXT,
            amount_received REAL,
            terms TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE bill_item (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            item_code TEXT NOT NULL,
            item_name TEXT NOT NULL,
            qty REAL NOT NULL,
            uom TEXT NOT NULL,
            rate REAL NOT NULL,
            discount_amount REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE CASCADE
          )
        ''');
        await db.execute('CREATE INDEX idx_bill_item_invoice ON bill_item(invoice_id)');

        // A counter number series, so bills get "1, 2, 3…" like the web
        // screen's santu_bill_no instead of a raw uuid on the printed slip.
        await db.execute('''
          CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)
        ''');
        await db.insert('counters', {'name': 'bill_no', 'value': 0});
        await _createPurchaseTables(db);
        await _createExpenseTable(db);
        await _createQuickDocTables(db);
        await _createPaymentTable(db);
        await _addSoftDeleteAndMessaging(db);
        await _addBillPhotoColumn(db);
        await _addPartyTypeAndManualDue(db);
        await _addInvoiceRemarks(db);
        await _addInvoiceBillingFields(db);
        await _addStockAndLoyaltyFields(db);
        await _createItemHighlightTable(db);
        await _createFeatureDocTable(db);
        await _addCustomerVillage(db);
      },
    );
  }

  Future<void> _addCustomerVillage(Database db) async {
    try {
      await db.execute('ALTER TABLE customer ADD COLUMN village TEXT');
    } catch (_) {
      /* already there */
    }
  }

  Future<void> _createFeatureDocTable(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS feature_doc (
        feature_name TEXT PRIMARY KEY,
        module_name TEXT,
        status TEXT,
        priority TEXT,
        description TEXT,
        what_it_does TEXT,
        current_behavior TEXT,
        expected_behavior TEXT,
        how_it_works TEXT,
        how_to_use TEXT,
        qa_testing TEXT,
        if_we_modify TEXT,
        related_features TEXT
      )
    ''');
    try {
      await db.execute('ALTER TABLE feature_doc ADD COLUMN qa_testing TEXT');
    } catch (_) {}
    try {
      await db.execute('ALTER TABLE feature_doc ADD COLUMN if_we_modify TEXT');
    } catch (_) {}
  }

  // ---- Feature Workbook ----

  Future<List<Map<String, Object?>>> listFeatureDocs() async {
    final db = await database;
    return db.query('feature_doc', orderBy: 'module_name ASC, feature_name ASC');
  }

  Future<void> upsertFeatureDocs(List<Map<String, Object?>> rows) async {
    final db = await database;
    final batch = db.batch();
    for (final row in rows) {
      batch.insert('feature_doc', row, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await batch.commit(noResult: true);
  }

  Future<void> seedFeatureDocsIfEmpty(List<Map<String, Object?>> rows) async {
    final db = await database;
    final existing = await db.query('feature_doc', limit: 1);
    if (existing.isNotEmpty) {
      // Check if existing records lack QA testing or impact fields, if so, upgrade them
      final sample = existing.first;
      if (sample['qa_testing'] != null || sample['if_we_modify'] != null) {
        return;
      }
    }
    await upsertFeatureDocs(rows);
  }

  Future<void> saveFeatureDoc(Map<String, Object?> doc) async {
    final db = await database;
    await db.insert('feature_doc', doc, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> deleteFeatureDoc(String featureName) async {
    final db = await database;
    await db.delete('feature_doc', where: 'feature_name = ?', whereArgs: [featureName]);
  }

  Future<Map<String, Object?>?> getFeatureDoc(String featureName) async {
    final db = await database;
    final res = await db.query('feature_doc', where: 'feature_name = ?', whereArgs: [featureName], limit: 1);
    return res.isNotEmpty ? res.first : null;
  }

  /// "Customer ka note" from Billing's More menu — a free-text remark saved
  /// on the bill, same field santu_billing.js's `data-more="note"` writes.
  Future<void> _addInvoiceRemarks(Database db) async {
    try {
      await db.execute('ALTER TABLE invoice ADD COLUMN remarks TEXT');
    } catch (_) {
      /* already there */
    }
  }

  Future<void> _addInvoiceBillingFields(Database db) async {
    try {
      await db.execute('ALTER TABLE invoice ADD COLUMN additional_charges REAL NOT NULL DEFAULT 0');
    } catch (_) {
      /* already there */
    }
    try {
      await db.execute('ALTER TABLE invoice ADD COLUMN terms TEXT');
    } catch (_) {
      /* already there */
    }
  }

  Future<void> _addStockAndLoyaltyFields(Database db) async {
    try {
      await db.execute('ALTER TABLE invoice ADD COLUMN update_stock INTEGER NOT NULL DEFAULT 1');
    } catch (_) {
      /* already there */
    }
    try {
      await db.execute('ALTER TABLE invoice ADD COLUMN redeem_points REAL NOT NULL DEFAULT 0');
    } catch (_) {
      /* already there */
    }
    final extraDefaults = <String, String>{
      'Payment Out': 'Payment of ₹{amount} to {party} processed against {doc_no}.',
      'Proforma Invoice': 'Namaste {party}, proforma invoice {doc_no} ₹{amount} ka banaya gaya hai.',
      'Cancelled Invoice': 'Namaste {party}, invoice {doc_no} cancel kar diya gaya hai.',
      'Account Statement': 'Namaste {party}, aapka khata hisab: Kul baaki ₹{balance}.',
    };
    final batch = db.batch();
    extraDefaults.forEach((k, v) => batch.insert('message_template', {'doc_type': k, 'body': v}, conflictAlgorithm: ConflictAlgorithm.ignore));
    await batch.commit(noResult: true);
  }

  Future<void> _createItemHighlightTable(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS item_highlight_rule (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        match_type TEXT NOT NULL DEFAULT 'Contains',
        value TEXT NOT NULL,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    ''');
  }

  // ---- Item Colour Rules ----

  Future<List<ItemHighlightRule>> listHighlightRules() async {
    final db = await database;
    final rows = await db.query('item_highlight_rule', orderBy: 'sort_order ASC');
    return rows.map(ItemHighlightRule.fromMap).toList();
  }

  Future<void> saveHighlightRules(List<ItemHighlightRule> rules) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('item_highlight_rule');
      final batch = txn.batch();
      for (var i = 0; i < rules.length; i++) {
        rules[i].sortOrder = i;
        batch.insert('item_highlight_rule', rules[i].toMap());
      }
      await batch.commit(noResult: true);
    });
  }

  /// `payment` originally only ever meant "collected from a customer"
  /// (Payment In). Udhar/dues work the same shape for a supplier (Payment
  /// Out, what the shop still owes) — party_type tells the two apart in one
  /// shared table instead of duplicating it. manual_due is the "+ Baki
  /// Jodein" dialog from santu_customer_dues.js: a due that isn't backed by
  /// any bill (an opening balance, a side deal) for either party type.
  Future<void> _addPartyTypeAndManualDue(Database db) async {
    try {
      await db.execute("ALTER TABLE payment ADD COLUMN party_type TEXT NOT NULL DEFAULT 'Customer'");
    } catch (_) {
      /* already there */
    }
    await db.execute('''
      CREATE TABLE IF NOT EXISTS manual_due (
        id TEXT PRIMARY KEY,
        party_type TEXT NOT NULL,
        party TEXT NOT NULL,
        party_label TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )
    ''');
  }

  /// A photo of the supplier's paper bill, attached to a purchase so it can
  /// be checked against later — "Upload Bill" on mobile, honestly: this app
  /// does not read text off the photo (the web version's PDF-to-draft OCR
  /// is a separate, much larger feature); the shopkeeper still enters the
  /// items, same as any other purchase.
  Future<void> _addBillPhotoColumn(Database db) async {
    try {
      await db.execute('ALTER TABLE purchase_invoice ADD COLUMN bill_photo_path TEXT');
    } catch (_) {
      /* already there */
    }
  }

  /// deleted_at powers the Recycle Bin (NULL = active, a timestamp = in the
  /// bin — never hard-deleted, so it can always be restored). message_* back
  /// the WhatsApp/Transaction Message screens: one editable template per
  /// transaction type, one log row per share actually sent.
  Future<void> _addSoftDeleteAndMessaging(Database db) async {
    for (final spec in [
      ('item', 'item_code'),
      ('customer', 'name'),
      ('supplier', 'name'),
      ('invoice', 'id'),
      ('purchase_invoice', 'id'),
    ]) {
      try {
        await db.execute('ALTER TABLE ${spec.$1} ADD COLUMN deleted_at TEXT');
      } catch (_) {
        // Column already exists (re-run of this migration, or fresh
        // onCreate that already defines it) — safe to ignore.
      }
    }

    await db.execute('''
      CREATE TABLE IF NOT EXISTS message_template (
        doc_type TEXT PRIMARY KEY,
        body TEXT NOT NULL
      )
    ''');
    final defaults = <String, String>{
      'Sales Transaction': 'Namaste {party}, aapka bill {doc_no} ₹{amount} ka ban gaya hai. Dhanyavaad! - Santu Hardware',
      'Purchase Transaction': 'Purchase {doc_no} from {party} recorded, amount ₹{amount}.',
      'Sales Return': 'Namaste {party}, return {doc_no} process ho gaya, amount ₹{amount}.',
      'Purchase Return': 'Return {doc_no} to {party} recorded, amount ₹{amount}.',
      'Payment In': 'Namaste {party}, aapka payment ₹{amount} mil gaya hai. Dhanyavaad! - Santu Hardware',
      'Sales Order': 'Namaste {party}, aapka order {doc_no} confirm ho gaya hai, amount ₹{amount}.',
      'Purchase Order': 'Order {doc_no} placed with {party}, amount ₹{amount}.',
      'Estimate / Quotation': 'Namaste {party}, aapka estimate {doc_no} ₹{amount} ka taiyaar hai.',
      'Delivery Challan': 'Namaste {party}, challan {doc_no} ke saath saman bhej diya gaya hai.',
    };
    final batch = db.batch();
    defaults.forEach((k, v) => batch.insert('message_template', {'doc_type': k, 'body': v}, conflictAlgorithm: ConflictAlgorithm.ignore));
    await batch.commit(noResult: true);

    await db.execute('''
      CREATE TABLE IF NOT EXISTS message_log (
        id TEXT PRIMARY KEY,
        doc_type TEXT NOT NULL,
        doc_no TEXT,
        party_label TEXT,
        phone TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent',
        created_at TEXT NOT NULL
      )
    ''');
  }

  Future<void> _createPaymentTable(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS payment (
        id TEXT PRIMARY KEY,
        customer TEXT NOT NULL,
        customer_label TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_payment_customer ON payment(customer)');
  }

  /// One pair of tables per "quick doc" kind — Estimate, Delivery Challan,
  /// Sales Return, Purchase Return, Receive Stock — so numbering (counters.`kind`_no)
  /// stays independent for each, matching the web app's separate series.
  static const quickDocKinds = ['estimate', 'challan', 'sales_return', 'purchase_return', 'sales_order', 'purchase_order', 'stock_entry'];

  Future<void> _createQuickDocTables(Database db) async {
    for (final kind in quickDocKinds) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS ${kind}_doc (
          id TEXT PRIMARY KEY,
          doc_no TEXT,
          posting_date TEXT NOT NULL,
          party TEXT,
          party_label TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL
        )
      ''');
      await db.execute('''
        CREATE TABLE IF NOT EXISTS ${kind}_doc_item (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          item_code TEXT NOT NULL,
          item_name TEXT NOT NULL,
          qty REAL NOT NULL,
          uom TEXT NOT NULL,
          rate REAL NOT NULL,
          discount_amount REAL NOT NULL DEFAULT 0,
          FOREIGN KEY (invoice_id) REFERENCES ${kind}_doc(id) ON DELETE CASCADE
        )
      ''');
      final rows = await db.query('counters', where: 'name = ?', whereArgs: ['${kind}_no']);
      if (rows.isEmpty) await db.insert('counters', {'name': '${kind}_no', 'value': 0});
    }
  }

  Future<void> _createExpenseTable(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS expense (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_expense_date ON expense(date)');
  }

  Future<void> _createPurchaseTables(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS supplier (
        name TEXT PRIMARY KEY,
        supplier_name TEXT NOT NULL,
        phone TEXT
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_supplier_name ON supplier(supplier_name)');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS purchase_invoice (
        id TEXT PRIMARY KEY,
        bill_no TEXT,
        posting_date TEXT NOT NULL,
        supplier TEXT,
        supplier_label TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL
      )
    ''');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS purchase_item (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT NOT NULL,
        qty REAL NOT NULL,
        uom TEXT NOT NULL,
        rate REAL NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES purchase_invoice(id) ON DELETE CASCADE
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_purchase_item_invoice ON purchase_item(invoice_id)');

    final rows = await db.query('counters', where: 'name = ?', whereArgs: ['purchase_no']);
    if (rows.isEmpty) {
      await db.insert('counters', {'name': 'purchase_no', 'value': 0});
    }
  }

  // ---- Items ----

  Future<void> upsertItems(List<Item> items) async {
    final db = await database;
    final batch = db.batch();
    for (final i in items) {
      batch.insert('item', i.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await batch.commit(noResult: true);
  }

  /// Every typed word must appear in name, code or barcode, in any order —
  /// "24 pipe ptmt" finds "BVENUS PTMT CONNECTION PIPE 24"". Exact code /
  /// barcode hits sort first (scanner input), then names starting with the
  /// query, then the rest alphabetically.
  Future<List<Item>> searchItems(String query, {int limit = 30}) async {
    final db = await database;
    final tokens = searchTokens(query);
    final where = <String>['deleted_at IS NULL'];
    final args = <Object?>[];
    for (final t in tokens) {
      where.add('(item_code LIKE ? OR item_name LIKE ? OR barcode LIKE ?)');
      args.addAll(['%$t%', '%$t%', '%$t%']);
    }
    final q = query.trim();
    final rows = await db.rawQuery(
      'SELECT * FROM item WHERE ${where.join(' AND ')} '
      'ORDER BY CASE WHEN item_code = ? COLLATE NOCASE OR barcode = ? THEN 0 '
      'WHEN item_name LIKE ? THEN 1 ELSE 2 END, item_name COLLATE NOCASE LIMIT ?',
      [...args, q, q, '$q%', limit],
    );
    return rows.map(Item.fromMap).toList();
  }

  /// The full catalogue, no cap — for screens that must show/export/scan
  /// every item (Inventory, Export Items, Low Stock, Bulk Update, the
  /// dashboard's low-stock count), as opposed to [searchItems]'s default
  /// 30-row limit, which exists only to keep a live-typing search dropdown
  /// short.
  Future<List<Item>> allItems({String? orderBy}) async {
    final db = await database;
    final rows = await db.query(
      'item',
      where: 'deleted_at IS NULL',
      orderBy: orderBy ?? 'item_name COLLATE NOCASE ASC',
    );
    return rows.map(Item.fromMap).toList();
  }

  /// Merges duplicate items where the normalized item_name is identical.
  /// Combines stock quantities into the primary item and soft-deletes the duplicate.
  Future<int> deduplicateItems() async {
    final db = await database;
    final rows = await db.query('item', where: 'deleted_at IS NULL');
    final Map<String, List<Map<String, Object?>>> byNorm = {};
    for (final r in rows) {
      final name = (r['item_name'] as String? ?? '').trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
      if (name.isNotEmpty) {
        byNorm.putIfAbsent(name, () => []).add(r);
      }
    }
    int merged = 0;
    for (final entry in byNorm.entries) {
      if (entry.value.length > 1) {
        final list = entry.value;
        list.sort((a, b) {
          final stockA = (a['available_qty'] as num?)?.toDouble() ?? 0;
          final stockB = (b['available_qty'] as num?)?.toDouble() ?? 0;
          return stockB.compareTo(stockA);
        });
        final primary = list.first;
        final primaryCode = primary['item_code'] as String;
        for (var i = 1; i < list.length; i++) {
          final dup = list[i];
          final dupCode = dup['item_code'] as String;
          final dupQty = (dup['available_qty'] as num?)?.toDouble() ?? 0;
          if (dupQty > 0) {
            await db.rawUpdate('UPDATE item SET available_qty = available_qty + ? WHERE item_code = ?', [dupQty, primaryCode]);
          }
          await db.update('item', {'deleted_at': DateTime.now().toIso8601String()}, where: 'item_code = ?', whereArgs: [dupCode]);
          merged++;
        }
      }
    }
    return merged;
  }

  Future<Item?> itemByCode(String code) async {
    final db = await database;
    final rows = await db.query('item', where: 'item_code = ? AND deleted_at IS NULL', whereArgs: [code], limit: 1);
    if (rows.isEmpty) return null;
    return Item.fromMap(rows.first);
  }

  /// Pushes row rate and unit back to Item master (santu_tick_to_master.js).
  Future<void> updateItemMaster(String code, {double? rate, String? uom, String? name}) async {
    final db = await database;
    final values = <String, Object?>{};
    if (rate != null) values['price_list_rate'] = rate;
    if (uom != null) values['stock_uom'] = uom;
    if (name != null && name.trim().isNotEmpty) values['item_name'] = name.trim();
    if (values.isNotEmpty) {
      await db.update('item', values, where: 'item_code = ?', whereArgs: [code]);
    }
  }

  /// Inline stock addition ("Stock chadhaiye" - santu_add_stock_inline.js).
  Future<double> receiveStockSimple(String code, double qty, {double? purchaseRate}) async {
    final db = await database;
    if (purchaseRate != null && purchaseRate > 0) {
      await db.rawUpdate('UPDATE item SET available_qty = available_qty + ?, cost_price = ? WHERE item_code = ?', [qty, purchaseRate, code]);
    } else {
      await db.rawUpdate('UPDATE item SET available_qty = available_qty + ? WHERE item_code = ?', [qty, code]);
    }
    final rows = await db.query('item', columns: ['available_qty'], where: 'item_code = ?', whereArgs: [code], limit: 1);
    if (rows.isNotEmpty) {
      return (rows.first['available_qty'] as num?)?.toDouble() ?? 0.0;
    }
    return qty;
  }

  // ---- Customers ----

  Future<void> upsertCustomers(List<Customer> customers) async {
    final db = await database;
    final batch = db.batch();
    for (final c in customers) {
      batch.insert('customer', c.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      if (c.village != null && c.village!.isNotEmpty) {
        batch.rawUpdate(
          'UPDATE customer SET village = ? WHERE customer_name = ? AND (village IS NULL OR village = "")',
          [c.village, c.customerName],
        );
      }
    }
    await batch.commit(noResult: true);
  }

  Future<List<Customer>> searchCustomers(String query, {int limit = 20}) async {
    final db = await database;
    final where = <String>['deleted_at IS NULL'];
    final args = <Object?>[];
    for (final t in searchTokens(query)) {
      where.add('(customer_name LIKE ? OR phone LIKE ? OR village LIKE ?)');
      args.addAll(['%$t%', '%$t%', '%$t%']);
    }
    final rows = await db.rawQuery(
      'SELECT * FROM customer WHERE ${where.join(' AND ')} ORDER BY customer_name COLLATE NOCASE LIMIT ?',
      [...args, limit],
    );
    return rows.map(Customer.fromMap).toList();
  }

  /// One customer by id — the printed bill needs their phone for the
  /// "Phone" row the PC format prints under the customer's name.
  Future<Customer?> customerByName(String name) async {
    final db = await database;
    final rows = await db.query('customer', where: 'name = ? AND deleted_at IS NULL', whereArgs: [name], limit: 1);
    return rows.isEmpty ? null : Customer.fromMap(rows.first);
  }

  Future<Customer?> customer(String idOrName) async {
    final db = await database;
    final rows = await db.query('customer', where: '(id = ? OR name = ? OR customer_name = ?) AND deleted_at IS NULL', whereArgs: [idOrName, idOrName, idOrName], limit: 1);
    return rows.isEmpty ? null : Customer.fromMap(rows.first);
  }

  /// All customers, no cap — see [allItems] for why this exists separately
  /// from [searchCustomers]'s 20-row default.
  Future<List<Customer>> allCustomers() async {
    final db = await database;
    final rows = await db.query('customer', where: 'deleted_at IS NULL');
    return rows.map(Customer.fromMap).toList();
  }

  // ---- Invoices ----

  Future<int> nextBillNo() async {
    final db = await database;
    return db.transaction((txn) async {
      final rows = await txn.query('counters', where: 'name = ?', whereArgs: ['bill_no']);
      final current = (rows.first['value'] as int?) ?? 0;
      final next = current + 1;
      await txn.update('counters', {'value': next}, where: 'name = ?', whereArgs: ['bill_no']);
      return next;
    });
  }

  Future<void> saveInvoice(Invoice inv) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.insert('invoice', inv.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      await txn.delete('bill_item', where: 'invoice_id = ?', whereArgs: [inv.id]);
      final batch = txn.batch();
      for (final item in inv.items) {
        batch.insert('bill_item', item.toMap(inv.id));
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Invoice>> loadDraftInvoices() async {
    final db = await database;
    final invRows = await db.query('invoice', where: "status = 'draft' AND deleted_at IS NULL", orderBy: 'created_at ASC');
    final result = <Invoice>[];
    for (final row in invRows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    return result;
  }

  /// Adjusts stock on hand after a sale (negative deltas) or a purchase
  /// (positive deltas). Called once, exactly when a bill flips from draft to
  /// saved — never from saveInvoice/savePurchaseInvoice directly, since
  /// those also run on every autosave keystroke and would otherwise double
  /// -count stock on every edit of an already-saved bill.
  Future<void> adjustItemStock(Map<String, double> deltaByItemCode) async {
    final db = await database;
    final batch = db.batch();
    deltaByItemCode.forEach((code, delta) {
      batch.rawUpdate('UPDATE item SET available_qty = available_qty + ? WHERE item_code = ?', [delta, code]);
    });
    await batch.commit(noResult: true);
  }

  Future<void> deleteInvoice(String id) async {
    final db = await database;
    await db.delete('bill_item', where: 'invoice_id = ?', whereArgs: [id]);
    await db.delete('invoice', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<Invoice>> savedInvoicesForToday(String date) async {
    final db = await database;
    final invRows = await db.query(
      'invoice',
      where: 'status = ? AND posting_date = ? AND deleted_at IS NULL',
      whereArgs: ['saved', date],
      orderBy: 'created_at DESC',
    );
    final result = <Invoice>[];
    for (final row in invRows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    return result;
  }

  // ---- Suppliers ----

  Future<void> upsertSuppliers(List<Supplier> suppliers) async {
    final db = await database;
    final batch = db.batch();
    for (final s in suppliers) {
      batch.insert('supplier', s.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await batch.commit(noResult: true);
  }

  Future<List<Supplier>> searchSuppliers(String query, {int limit = 20}) async {
    final db = await database;
    final where = <String>['deleted_at IS NULL'];
    final args = <Object?>[];
    for (final t in searchTokens(query)) {
      where.add('(supplier_name LIKE ? OR phone LIKE ?)');
      args.addAll(['%$t%', '%$t%']);
    }
    final rows = await db.rawQuery(
      'SELECT * FROM supplier WHERE ${where.join(' AND ')} ORDER BY supplier_name COLLATE NOCASE LIMIT ?',
      [...args, limit],
    );
    return rows.map(Supplier.fromMap).toList();
  }

  /// All suppliers, no cap — see [allItems].
  Future<List<Supplier>> allSuppliers() async {
    final db = await database;
    final rows = await db.query('supplier', where: 'deleted_at IS NULL');
    return rows.map(Supplier.fromMap).toList();
  }

  Future<Supplier?> supplier(String id) async {
    final db = await database;
    final rows = await db.query('supplier', where: 'name = ?', whereArgs: [id]);
    if (rows.isEmpty) return null;
    return Supplier.fromMap(rows.first);
  }

  Future<Supplier?> supplierByName(String name) async {
    final db = await database;
    final rows = await db.query('supplier', where: 'supplier_name = ?', whereArgs: [name]);
    if (rows.isEmpty) return null;
    return Supplier.fromMap(rows.first);
  }

  // ---- Purchase invoices ----

  Future<int> nextPurchaseNo() async {
    final db = await database;
    return db.transaction((txn) async {
      final rows = await txn.query('counters', where: 'name = ?', whereArgs: ['purchase_no']);
      final current = (rows.first['value'] as int?) ?? 0;
      final next = current + 1;
      await txn.update('counters', {'value': next}, where: 'name = ?', whereArgs: ['purchase_no']);
      return next;
    });
  }

  Future<void> savePurchaseInvoice(PurchaseInvoice inv) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.insert('purchase_invoice', inv.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      await txn.delete('purchase_item', where: 'invoice_id = ?', whereArgs: [inv.id]);
      final batch = txn.batch();
      for (final item in inv.items) {
        batch.insert('purchase_item', item.toMap(inv.id));
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<PurchaseInvoice>> loadDraftPurchases() async {
    final db = await database;
    final invRows = await db.query('purchase_invoice', where: "status = 'draft' AND deleted_at IS NULL", orderBy: 'created_at ASC');
    final result = <PurchaseInvoice>[];
    for (final row in invRows) {
      final itemRows = await db.query('purchase_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(PurchaseInvoice.fromMap(row, itemRows.map(PurchaseItem.fromMap).toList()));
    }
    return result;
  }

  Future<void> deletePurchaseInvoice(String id) async {
    final db = await database;
    await db.delete('purchase_item', where: 'invoice_id = ?', whereArgs: [id]);
    await db.delete('purchase_invoice', where: 'id = ?', whereArgs: [id]);
  }

  // ---- Expenses ----

  Future<void> saveExpense(Expense e) async {
    final db = await database;
    await db.insert('expense', e.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> deleteExpense(String id) async {
    final db = await database;
    await db.delete('expense', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<Expense>> listExpenses({String? fromDate, String? toDate}) async {
    final db = await database;
    String? where;
    List<Object?>? args;
    if (fromDate != null && toDate != null) {
      where = 'date BETWEEN ? AND ?';
      args = [fromDate, toDate];
    }
    final rows = await db.query('expense', where: where, whereArgs: args, orderBy: 'date DESC, created_at DESC');
    return rows.map(Expense.fromMap).toList();
  }

  // ---- Quick docs (Estimate / Delivery Challan / Sales Return / Purchase Return) ----

  Future<int> nextQuickDocNo(String kind) async {
    final db = await database;
    return db.transaction((txn) async {
      final rows = await txn.query('counters', where: 'name = ?', whereArgs: ['${kind}_no']);
      final current = (rows.first['value'] as int?) ?? 0;
      final next = current + 1;
      await txn.update('counters', {'value': next}, where: 'name = ?', whereArgs: ['${kind}_no']);
      return next;
    });
  }

  Future<void> saveQuickDoc(String kind, QuickDoc doc) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.insert('${kind}_doc', doc.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      await txn.delete('${kind}_doc_item', where: 'invoice_id = ?', whereArgs: [doc.id]);
      final batch = txn.batch();
      for (final item in doc.items) {
        batch.insert('${kind}_doc_item', item.toMap(doc.id));
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<QuickDoc>> loadDraftQuickDocs(String kind) async {
    final db = await database;
    final rows = await db.query('${kind}_doc', where: 'status = ?', whereArgs: ['draft'], orderBy: 'created_at ASC');
    final result = <QuickDoc>[];
    for (final row in rows) {
      final itemRows = await db.query('${kind}_doc_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(QuickDoc.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    return result;
  }

  Future<void> deleteQuickDoc(String kind, String id) async {
    final db = await database;
    await db.delete('${kind}_doc_item', where: 'invoice_id = ?', whereArgs: [id]);
    await db.delete('${kind}_doc', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<QuickDoc>> savedQuickDocs(String kind) async {
    final db = await database;
    final rows = await db.query('${kind}_doc', where: 'status = ?', whereArgs: ['saved'], orderBy: 'created_at DESC');
    final result = <QuickDoc>[];
    for (final row in rows) {
      final itemRows = await db.query('${kind}_doc_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(QuickDoc.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    return result;
  }

  // ---- Payments / Customer Dues ----

  Future<void> savePayment(Payment p) async {
    final db = await database;
    await db.insert('payment', p.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Payment>> listPayments({String? customer, String? partyType}) async {
    final db = await database;
    final clauses = <String>[];
    final args = <Object?>[];
    if (customer != null) {
      clauses.add('customer = ?');
      args.add(customer);
    }
    if (partyType != null) {
      clauses.add('party_type = ?');
      args.add(partyType);
    }
    final rows = await db.query(
      'payment',
      where: clauses.isEmpty ? null : clauses.join(' AND '),
      whereArgs: args.isEmpty ? null : args,
      orderBy: 'date DESC, created_at DESC',
    );
    return rows.map(Payment.fromMap).toList();
  }

  /// One row per customer who owes something: sum of every saved bill's
  /// baaki (grand total minus what was taken at the counter), plus any
  /// manually-added due, minus whatever's been collected since via Payment
  /// In. Zero/negative dues are left out — nothing to collect, nothing to
  /// show.
  /// Port of api.get_customer_balance_summary(exclude_doctype, exclude_name):
  /// what this customer owed BEFORE the bill being printed. The exclusion is
  /// the whole point — printing a bill's own due inside "Previous Balance"
  /// would double-count it against the TOTAL DUE line right below.
  Future<double> previousBalanceForCustomer(String? customer, {String? excludeInvoiceId}) async {
    if (customer == null || customer.isEmpty) return 0;
    final db = await database;
    double balance = 0;
    final invRows = await db.query(
      'invoice',
      where: "customer = ? AND status = 'saved' AND deleted_at IS NULL",
      whereArgs: [customer],
    );
    for (final row in invRows) {
      if (excludeInvoiceId != null && row['id'] == excludeInvoiceId) continue;
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      balance += Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()).baaki;
    }
    final manual = await db.query('manual_due', where: "party_type = 'Customer' AND party = ?", whereArgs: [customer]);
    for (final m in manual) {
      balance += (m['amount'] as num).toDouble();
    }
    final payments = await db.query('payment', where: "party_type = 'Customer' AND customer = ?", whereArgs: [customer]);
    for (final p in payments) {
      balance -= (p['amount'] as num).toDouble();
    }
    return balance;
  }

  Future<List<MapEntry<Customer, double>>> customerDues() async {
    final db = await database;
    final invRows = await db.query('invoice', where: "status = 'saved' AND deleted_at IS NULL");
    final duesByCustomer = <String, double>{};
    final labelByCustomer = <String, String>{};
    for (final row in invRows) {
      final customer = row['customer'] as String?;
      if (customer == null) continue;
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      final inv = Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList());
      final baaki = inv.baaki;
      if (baaki > 0) {
        duesByCustomer[customer] = (duesByCustomer[customer] ?? 0) + baaki;
        labelByCustomer[customer] = row['customer_label'] as String? ?? customer;
      }
    }
    final manualDues = await db.query('manual_due', where: "party_type = 'Customer'");
    for (final m in manualDues) {
      final party = m['party'] as String;
      duesByCustomer[party] = (duesByCustomer[party] ?? 0) + (m['amount'] as num).toDouble();
      labelByCustomer[party] = m['party_label'] as String? ?? party;
    }
    final payments = await db.query('payment', where: "party_type = 'Customer'");
    for (final p in payments) {
      final customer = p['customer'] as String;
      final amount = (p['amount'] as num).toDouble();
      duesByCustomer[customer] = (duesByCustomer[customer] ?? 0) - amount;
    }
    final result = <MapEntry<Customer, double>>[];
    duesByCustomer.forEach((customer, due) {
      if (due > 0.009) {
        result.add(MapEntry(Customer(name: customer, customerName: labelByCustomer[customer] ?? customer), due));
      }
    });
    result.sort((a, b) => b.value.compareTo(a.value));
    return result;
  }

  /// Mirror of customerDues() for "I owe suppliers" — purchase bills here
  /// are recorded as settled at save time (no running baaki of their own),
  /// so what the shop owes a supplier is whatever's been added manually
  /// (an opening balance, a side deal) minus what's been paid out since.
  Future<List<MapEntry<Supplier, double>>> supplierDues() async {
    final db = await database;
    final duesBySupplier = <String, double>{};
    final labelBySupplier = <String, String>{};
    final manualDues = await db.query('manual_due', where: "party_type = 'Supplier'");
    for (final m in manualDues) {
      final party = m['party'] as String;
      duesBySupplier[party] = (duesBySupplier[party] ?? 0) + (m['amount'] as num).toDouble();
      labelBySupplier[party] = m['party_label'] as String? ?? party;
    }
    final payments = await db.query('payment', where: "party_type = 'Supplier'");
    for (final p in payments) {
      final supplier = p['customer'] as String;
      final amount = (p['amount'] as num).toDouble();
      duesBySupplier[supplier] = (duesBySupplier[supplier] ?? 0) - amount;
    }
    final result = <MapEntry<Supplier, double>>[];
    duesBySupplier.forEach((supplier, due) {
      if (due > 0.009) {
        result.add(MapEntry(Supplier(name: supplier, supplierName: labelBySupplier[supplier] ?? supplier), due));
      }
    });
    result.sort((a, b) => b.value.compareTo(a.value));
    return result;
  }

  Future<void> saveManualDue(ManualDue d) async {
    final db = await database;
    await db.insert('manual_due', d.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Everything that moved a party's baaki, newest first — bills (Customer
  /// only; purchases settle immediately, see supplierDues' comment),
  /// manual dues, and payments — for the per-party transaction history.
  Future<List<Invoice>> invoicesForCustomer(String customer) async {
    final db = await database;
    final rows = await db.query('invoice', where: "customer = ? AND status = 'saved' AND deleted_at IS NULL", whereArgs: [customer], orderBy: 'created_at DESC');
    final result = <Invoice>[];
    for (final row in rows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList()));
    }
    return result;
  }

  /// Calculates customer's reward points: 1 point earned per ₹100 of billing,
  /// minus any points already redeemed across past saved bills.
  Future<({double points, double balance, double rupeeValue, double spendPerPoint, double earnedOnSaved, double earned, double redeemed})> getCustomerLoyaltySummary(String? customerName) async {
    if (customerName == null || customerName.trim().isEmpty) {
      return (points: 0.0, balance: 0.0, rupeeValue: 0.0, spendPerPoint: 100.0, earnedOnSaved: 0.0, earned: 0.0, redeemed: 0.0);
    }
    final db = await database;
    final rows = await db.query(
      'invoice',
      where: "(customer = ? OR customer_label = ?) AND status = 'saved' AND deleted_at IS NULL",
      whereArgs: [customerName, customerName],
    );
    double totalSpend = 0.0;
    double totalRedeemed = 0.0;
    for (final r in rows) {
      final addCharges = (r['additional_charges'] as num?)?.toDouble() ?? 0.0;
      final discount = (r['bill_discount'] as num?)?.toDouble() ?? 0.0;
      final redeemed = (r['redeem_points'] as num?)?.toDouble() ?? 0.0;
      totalRedeemed += redeemed;
      final invId = r['id'] as String;
      final itemRows = await db.rawQuery('SELECT SUM((rate - discount_amount) * qty) as subtotal FROM bill_item WHERE invoice_id = ?', [invId]);
      final subtotal = (itemRows.isNotEmpty ? (itemRows.first['subtotal'] as num?)?.toDouble() : 0.0) ?? 0.0;
      final billTotal = (subtotal + addCharges - discount).clamp(0.0, double.infinity);
      totalSpend += billTotal;
    }
    final double earned = totalSpend / 100.0;
    final double available = (earned - totalRedeemed).clamp(0.0, double.infinity);
    final double roundedPoints = (available * 100).round() / 100.0;
    return (
      points: roundedPoints,
      balance: roundedPoints,
      rupeeValue: roundedPoints, // 1 point = ₹1
      spendPerPoint: 100.0,
      earnedOnSaved: (earned * 100).round() / 100.0,
      earned: (earned * 100).round() / 100.0,
      redeemed: (totalRedeemed * 100).round() / 100.0,
    );
  }

  Future<List<PurchaseInvoice>> invoicesForSupplier(String supplier) async {
    final db = await database;
    final rows = await db.query('purchase_invoice', where: "supplier = ? AND status = 'saved' AND deleted_at IS NULL", whereArgs: [supplier], orderBy: 'created_at DESC');
    final result = <PurchaseInvoice>[];
    for (final row in rows) {
      final itemRows = await db.query('purchase_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      result.add(PurchaseInvoice.fromMap(row, itemRows.map(PurchaseItem.fromMap).toList()));
    }
    return result;
  }

  Future<List<ManualDue>> manualDuesFor(String partyType, String party) async {
    final db = await database;
    final rows = await db.query('manual_due', where: 'party_type = ? AND party = ?', whereArgs: [partyType, party], orderBy: 'date DESC, created_at DESC');
    return rows.map(ManualDue.fromMap).toList();
  }

  /// Day-by-day sales total between two dates (inclusive), for the
  /// Dashboard chart — mirrors santu_dashboard.js's get_sales_chart. Keys
  /// are 'yyyy-MM-dd'; days with no saved bill are simply absent, caller
  /// fills the gaps so the chart has one point per day in range.
  Future<Map<String, double>> salesByDay(String fromDate, String toDate) async {
    final db = await database;
    final invRows = await db.query(
      'invoice',
      where: "status = 'saved' AND deleted_at IS NULL AND posting_date BETWEEN ? AND ?",
      whereArgs: [fromDate, toDate],
    );
    final totals = <String, double>{};
    for (final row in invRows) {
      final itemRows = await db.query('bill_item', where: 'invoice_id = ?', whereArgs: [row['id']]);
      final inv = Invoice.fromMap(row, itemRows.map(BillItem.fromMap).toList());
      final day = row['posting_date'] as String;
      totals[day] = (totals[day] ?? 0) + inv.grandTotal;
    }
    return totals;
  }

  // ---- Recycle Bin ----

  /// One entry per deletable record type: its table, id column, a display
  /// name column, and the field that should return to NULL on restore.
  /// Doctor and the Recycle Bin both walk this list instead of hard-coding
  /// five near-identical methods each.
  static const recycleBinTables = [
    (table: 'item', idCol: 'item_code', nameCol: 'item_name', label: 'Item'),
    (table: 'customer', idCol: 'name', nameCol: 'customer_name', label: 'Customer'),
    (table: 'supplier', idCol: 'name', nameCol: 'supplier_name', label: 'Supplier'),
    (table: 'invoice', idCol: 'id', nameCol: 'bill_no', label: 'Sales Invoice'),
    (table: 'purchase_invoice', idCol: 'id', nameCol: 'bill_no', label: 'Purchase Invoice'),
  ];

  Future<void> softDelete(String table, String idCol, String id) async {
    final db = await database;
    await db.update(table, {'deleted_at': DateTime.now().toIso8601String()}, where: '$idCol = ?', whereArgs: [id]);
  }

  Future<void> restore(String table, String idCol, String id) async {
    final db = await database;
    await db.update(table, {'deleted_at': null}, where: '$idCol = ?', whereArgs: [id]);
  }

  /// Everything currently in the bin, across all five record types, newest
  /// deletion first — each row tagged with which table/label it came from
  /// so the Recycle Bin screen can show and restore it without per-type code.
  Future<List<Map<String, Object?>>> listDeleted() async {
    final db = await database;
    final all = <Map<String, Object?>>[];
    for (final spec in recycleBinTables) {
      final rows = await db.query(spec.table, where: 'deleted_at IS NOT NULL', orderBy: 'deleted_at DESC');
      for (final row in rows) {
        all.add({
          'table': spec.table,
          'id_col': spec.idCol,
          'id': row[spec.idCol],
          'label': spec.label,
          'name': row[spec.nameCol] ?? row[spec.idCol],
          'deleted_at': row['deleted_at'],
        });
      }
    }
    all.sort((a, b) => (b['deleted_at'] as String).compareTo(a['deleted_at'] as String));
    return all;
  }

  // ---- Message templates / history (WhatsApp Connect, Transaction Message) ----

  Future<Map<String, String>> listMessageTemplates() async {
    final db = await database;
    final rows = await db.query('message_template');
    return {for (final r in rows) r['doc_type'] as String: r['body'] as String};
  }

  Future<void> saveMessageTemplate(String docType, String body) async {
    final db = await database;
    await db.insert('message_template', {'doc_type': docType, 'body': body}, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> logMessage({required String docType, String? docNo, String? partyLabel, String? phone, required String body}) async {
    final db = await database;
    await db.insert('message_log', {
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      'doc_type': docType,
      'doc_no': docNo,
      'party_label': partyLabel,
      'phone': phone,
      'body': body,
      'status': 'sent',
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, Object?>>> messageHistory() async {
    final db = await database;
    return db.query('message_log', orderBy: 'created_at DESC', limit: 200);
  }

  // ---- Doctor (diagnostics) ----

  /// Each check returns (ok, message, fix) — fix is null when there's
  /// nothing this screen can safely do by itself. Plain-language, like the
  /// web screen: a shopkeeper reads this, not a stack trace.
  Future<List<({bool ok, String message, Future<void> Function()? fix})>> runDiagnostics() async {
    final db = await database;
    final results = <({bool ok, String message, Future<void> Function()? fix})>[];

    // 1. Database itself opens and answers a query.
    try {
      await db.rawQuery('SELECT 1');
      results.add((ok: true, message: 'Database theek se khul raha hai.', fix: null));
    } catch (e) {
      results.add((ok: false, message: 'Database nahi khul raha: $e', fix: null));
    }

    // 2. Negative stock — only possible from a bug, never a real count.
    final negRows = await db.query('item', where: 'available_qty < 0 AND deleted_at IS NULL');
    if (negRows.isEmpty) {
      results.add((ok: true, message: 'Koi item negative stock mein nahi hai.', fix: null));
    } else {
      results.add((
        ok: false,
        message: '${negRows.length} item(s) ka stock negative dikh raha hai.',
        fix: () async {
          final batch = db.batch();
          for (final r in negRows) {
            batch.update('item', {'available_qty': 0}, where: 'item_code = ?', whereArgs: [r['item_code']]);
          }
          await batch.commit(noResult: true);
        },
      ));
    }

    // 3. Saved bills with items but a zero grand total — usually a sign a
    // discount or rate got typed wrong, worth a second look.
    final zeroRows = await db.rawQuery('''
      SELECT i.id FROM invoice i
      WHERE i.status = 'saved' AND i.deleted_at IS NULL
        AND (SELECT COUNT(*) FROM bill_item b WHERE b.invoice_id = i.id) > 0
        AND (SELECT COALESCE(SUM((b.rate - b.discount_amount) * b.qty), 0) FROM bill_item b WHERE b.invoice_id = i.id) <= 0
    ''');
    if (zeroRows.isEmpty) {
      results.add((ok: true, message: 'Koi saved bill ₹0 total ki nahi hai.', fix: null));
    } else {
      results.add((ok: false, message: '${zeroRows.length} saved bill(s) ka total ₹0 ya kam hai — check karo.', fix: null));
    }

    // 4. Draft bills piling up (left open, never saved) — not an error, but
    // worth flagging if there are a lot of them.
    final draftCount = Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM invoice WHERE status = 'draft' AND deleted_at IS NULL")) ?? 0;
    if (draftCount <= 5) {
      results.add((ok: true, message: '$draftCount draft bill(s) khule hain — normal hai.', fix: null));
    } else {
      results.add((ok: false, message: '$draftCount draft bills khule pade hain — purane draft band kar do.', fix: null));
    }

    // 5. Recycle bin size — a lot of deleted records sitting around.
    final binCount = (await listDeleted()).length;
    results.add((ok: binCount < 20, message: 'Recycle Bin mein $binCount record(s) hain.', fix: null));

    return results;
  }

  // ---- Backup & Restore ----

  static const _backupTables = [
    'item', 'customer', 'supplier', 'invoice', 'bill_item', 'purchase_invoice', 'purchase_item',
    'expense', 'payment', 'counters', 'message_template',
    ...quickDocKinds,
  ];

  /// Dumps every table to plain maps, keyed by table name — the whole shop's
  /// data as one portable file (shared out via Backup & Restore), not a
  /// remote sync (there is no server for this local-first build to sync
  /// with — see that screen for the full explanation).
  Future<Map<String, List<Map<String, Object?>>>> exportAll() async {
    final db = await database;
    final out = <String, List<Map<String, Object?>>>{};
    for (final t in _backupTables) {
      final table = quickDocKinds.contains(t) ? '${t}_doc' : t;
      out[table] = await db.query(table);
      if (quickDocKinds.contains(t)) out['${t}_doc_item'] = await db.query('${t}_doc_item');
    }
    return out;
  }

  /// Replaces every table's contents with what's in [data] — used only for
  /// Restore, after the user has explicitly picked a backup file and
  /// confirmed. Runs as one transaction so a bad file can't half-apply.
  Future<void> importAll(Map<String, dynamic> data) async {
    final db = await database;
    await db.transaction((txn) async {
      for (final entry in data.entries) {
        final rows = (entry.value as List).cast<Map<String, dynamic>>();
        await txn.delete(entry.key);
        final batch = txn.batch();
        for (final row in rows) {
          batch.insert(entry.key, row.cast<String, Object?>(), conflictAlgorithm: ConflictAlgorithm.replace);
        }
        await batch.commit(noResult: true);
      }
    });
  }

  // ---- Dashboard & Widget Summaries ----

  Future<double> totalPurchasesAmount({String? fromDate, String? toDate}) async {
    final db = await database;
    // purchase_invoice has no stored grand_total (it's a derived value, same
    // as Invoice.grandTotal in Dart) — sum line totals from purchase_item.
    String where = "pi.status = 'saved' AND pi.deleted_at IS NULL";
    List<Object?> args = [];
    if (fromDate != null && toDate != null) {
      where += " AND pi.posting_date BETWEEN ? AND ?";
      args = [fromDate, toDate];
    }
    final rows = await db.rawQuery(
      'SELECT SUM(it.qty * it.rate) as total FROM purchase_invoice pi JOIN purchase_item it ON it.invoice_id = pi.id WHERE $where',
      args,
    );
    return (rows.first['total'] as num?)?.toDouble() ?? 0.0;
  }

  Future<double> totalExpensesAmount({String? fromDate, String? toDate}) async {
    final db = await database;
    String? where;
    List<Object?>? args;
    if (fromDate != null && toDate != null) {
      where = 'date BETWEEN ? AND ?';
      args = [fromDate, toDate];
    }
    final rows = await db.rawQuery('SELECT SUM(amount) as total FROM expense ${where != null ? 'WHERE $where' : ''}', args ?? []);
    return (rows.first['total'] as num?)?.toDouble() ?? 0.0;
  }

  Future<double> totalStockValueCost() async {
    final db = await database;
    final rows = await db.rawQuery('SELECT SUM(available_qty * COALESCE(cost_price, price_list_rate)) as total FROM item WHERE deleted_at IS NULL AND available_qty > 0');
    return (rows.first['total'] as num?)?.toDouble() ?? 0.0;
  }

  Future<double> totalStockValueSale() async {
    final db = await database;
    final rows = await db.rawQuery('SELECT SUM(available_qty * price_list_rate) as total FROM item WHERE deleted_at IS NULL AND available_qty > 0');
    return (rows.first['total'] as num?)?.toDouble() ?? 0.0;
  }

  Future<Map<String, int>> stockSummaryCounts() async {
    final db = await database;
    final rows = await db.rawQuery('''
      SELECT 
        COUNT(CASE WHEN available_qty <= 5 AND available_qty > 0 THEN 1 END) as low,
        COUNT(CASE WHEN available_qty <= 2 AND available_qty > 0 THEN 1 END) as critical,
        COUNT(CASE WHEN available_qty <= 0 THEN 1 END) as khatam,
        COUNT(*) as total_items,
        COALESCE(SUM(available_qty), 0) as total_qty
      FROM item 
      WHERE deleted_at IS NULL
    ''');
    final first = rows.first;
    return {
      'low': (first['low'] as int?) ?? 0,
      'critical': (first['critical'] as int?) ?? 0,
      'khatam': (first['khatam'] as int?) ?? 0,
      'total_items': (first['total_items'] as int?) ?? 0,
      'total_qty': ((first['total_qty'] as num?) ?? 0).toInt(),
    };
  }

  Future<double> totalSalesReturnsAmount({String? fromDate, String? toDate}) async {
    final db = await database;
    // sales_return_doc has no stored grand_total either — sum line totals
    // from sales_return_doc_item, same as totalPurchasesAmount above.
    String where = "d.status = 'saved'";
    List<Object?> args = [];
    if (fromDate != null && toDate != null) {
      where += " AND d.posting_date BETWEEN ? AND ?";
      args = [fromDate, toDate];
    }
    final rows = await db.rawQuery(
      'SELECT SUM((it.rate - it.discount_amount) * it.qty) as total FROM sales_return_doc d JOIN sales_return_doc_item it ON it.invoice_id = d.id WHERE $where',
      args,
    );
    return (rows.first['total'] as num?)?.toDouble() ?? 0.0;
  }
}

