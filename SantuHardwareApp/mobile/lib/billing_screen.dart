import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import 'a4_invoice_pdf.dart';
import 'app_overflow_menu.dart';
import 'app_settings.dart';
import 'db.dart';
import 'item_highlight.dart';
import 'models.dart';
import 'prefill_bus.dart';
import 'quick_doc_screen.dart';
import 'theme.dart';
import 'thermal_receipt.dart';
import 'units.dart';
import 'whatsapp_util.dart';

/// Mirrors santu_billing.js's layout: sticky search at top-left, item grid
/// below it, a fixed-width right rail with customer/date/totals/payment,
/// Save & Print as the dominant button. Business rules ported so far:
/// per-unit discount, bill-level discount, change-vs-baaki, a running
/// counter for the bill number. Not yet ported: loyalty points, the F-key
/// shortcut bar. WhatsApp share is real (whatsapp_util.dart) — flagged in
/// the UI as "Soon" only for what genuinely isn't built yet.
class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key});

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  final _uuid = const Uuid();
  final _searchCtrl = TextEditingController();
  final _custCtrl = TextEditingController();
  final _receivedCtrl = TextEditingController();

  List<Invoice> _tabs = [];
  int _activeIndex = 0;
  List<Item> _searchResults = [];
  List<Customer> _custResults = [];
  Customer? _selectedCustomer;
  bool _loading = true;
  String _paymentMode = 'Cash';
  final _paymentModes = const ['Cash', 'UPI', 'Card', 'Credit'];
  bool _showCost = false; // cost-price eye toggle — gated by Cost Price Lock's Security PIN if one is set
  final Map<String, double?> _costCache = {};
  final Map<String, double> _availableStockCache = {};

  Invoice get _bill => _tabs[_activeIndex];

  @override
  void initState() {
    super.initState();
    _init();
    PrefillBus.pending.addListener(_onPrefill);
  }

  @override
  void dispose() {
    PrefillBus.pending.removeListener(_onPrefill);
    super.dispose();
  }

  void _onPrefill() {
    final inv = PrefillBus.take();
    if (inv == null || !mounted) return;
    setState(() {
      _tabs.add(inv);
      _activeIndex = _tabs.length - 1;
      _syncRightPanelControllers();
    });
    _loadCostCache();
    _persist();
  }

  Future<void> _init() async {
    final drafts = await AppDb.instance.loadDraftInvoices();
    setState(() {
      _tabs = drafts.isNotEmpty ? drafts : [_blankInvoice()];
      _loading = false;
    });
    _syncRightPanelControllers();
    _loadCostCache();
  }

  Invoice _blankInvoice() => Invoice(
        id: _uuid.v4(),
        postingDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
        createdAt: DateTime.now().toIso8601String(),
      );

  void _syncRightPanelControllers() {
    _custCtrl.text = _bill.customerLabel ?? '';
    _receivedCtrl.text = _bill.amountReceived?.toStringAsFixed(2) ?? '';
    _paymentMode = _bill.paymentMode ?? 'Cash';
    _syncSelectedCustomer();
  }

  Future<void> _syncSelectedCustomer() async {
    final custId = _bill.customer;
    if (custId != null && custId.isNotEmpty) {
      final c = await AppDb.instance.customerByName(custId);
      if (mounted) setState(() => _selectedCustomer = c);
    } else if (_bill.customerLabel != null && _bill.customerLabel!.isNotEmpty) {
      final custs = await AppDb.instance.searchCustomers(_bill.customerLabel!, limit: 1);
      if (mounted) setState(() => _selectedCustomer = custs.isNotEmpty ? custs.first : null);
    } else {
      if (mounted) setState(() => _selectedCustomer = null);
    }
  }

  Future<void> _persist() async {
    await AppDb.instance.saveInvoice(_bill);
  }

  void _newBill() {
    setState(() {
      _tabs.add(_blankInvoice());
      _activeIndex = _tabs.length - 1;
      _syncRightPanelControllers();
    });
    _persist();
  }

  void _closeTab(int index) {
    if (_tabs.length == 1) return; // always keep at least one bill open
    setState(() {
      final removed = _tabs.removeAt(index);
      AppDb.instance.deleteInvoice(removed.id);
      if (_activeIndex >= _tabs.length) _activeIndex = _tabs.length - 1;
      _syncRightPanelControllers();
    });
  }

  Future<void> _onSearchChanged(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _searchResults = []);
      return;
    }
    final results = await AppDb.instance.searchItems(q.trim());
    setState(() => _searchResults = results);
  }

  void _addItem(Item item) {
    setState(() {
      final existing = _bill.items.where((r) => r.itemCode == item.itemCode);
      if (existing.isNotEmpty) {
        existing.first.qty += 1;
      } else {
        _bill.items.add(BillItem(
          id: _uuid.v4(),
          itemCode: item.itemCode,
          itemName: item.itemName,
          qty: 1,
          uom: item.stockUom,
          rate: item.priceListRate,
        ));
      }
      _costCache[item.itemCode] = item.costPrice;
      _availableStockCache[item.itemCode] = item.availableQty;
      _searchResults = [];
      _searchCtrl.clear();
      if (_receivedCtrl.text.isEmpty) {
        _receivedCtrl.text = _bill.grandTotal.toStringAsFixed(2);
      }
    });
    _persist();
  }

  // Draft bills loaded from the DB only carry itemCode/rate, not the
  // catalogue's cost price or live stock — fetched separately here.
  Future<void> _loadCostCache() async {
    for (final row in _bill.items) {
      if (_costCache.containsKey(row.itemCode) && _availableStockCache.containsKey(row.itemCode)) continue;
      final item = await AppDb.instance.itemByCode(row.itemCode);
      _costCache[row.itemCode] = item?.costPrice;
      _availableStockCache[row.itemCode] = item?.availableQty ?? 0;
    }
    if (mounted) setState(() {});
  }

  void _removeItem(BillItem row) {
    setState(() => _bill.items.remove(row));
    _persist();
  }

  Future<void> _editQty(BillItem row) async {
    final ctrl = TextEditingController(text: row.qty.toString());
    final value = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change Quantity'),
        content: TextField(controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text)), child: const Text('OK')),
        ],
      ),
    );
    if (value != null && value > 0) {
      setState(() => row.qty = value);
      _persist();
    }
  }

  // Rate [F5] and Item Discount [F3] from the PC's More menu, combined into
  // one dialog — this screen reaches a row by long-pressing it directly
  // instead of selecting a row then opening a menu, so there's no separate
  // "Item Discount" entry point to wire up; it lives right next to Rate.
  Future<void> _editRate(BillItem row) async {
    final rateCtrl = TextEditingController(
      text: row.rate == row.rate.roundToDouble() ? row.rate.toInt().toString() : row.rate.toString(),
    );
    final qtyCtrl = TextEditingController(text: _fmtQty(row.qty));
    final discCtrl = TextEditingController(text: row.discountAmount == 0 ? '' : row.discountAmount.toString());
    final nameCtrl = TextEditingController(text: row.itemName);
    String unit = row.uom;
    rateCtrl.selection = TextSelection(baseOffset: 0, extentOffset: rateCtrl.text.length);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Edit Rate: ${row.itemName}', maxLines: 1, overflow: TextOverflow.ellipsis),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Item Name')),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: rateCtrl,
                        autofocus: true,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          labelText: 'Rate (₹ / Unit) *',
                          prefixText: '₹ ',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: qtyCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          labelText: 'Qty',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: discCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Item Discount (per unit, ₹)',
                    prefixText: '₹ ',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: unit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: [for (final u in unitOptionsWith(unit)) DropdownMenuItem(value: u, child: Text(u))],
                  onChanged: (v) => setDialogState(() => unit = v ?? unit),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save Rate')),
          ],
        ),
      ),
    );
    if (saved == true) {
      final rate = double.tryParse(rateCtrl.text.trim());
      final qty = double.tryParse(qtyCtrl.text.trim());
      setState(() {
        if (nameCtrl.text.trim().isNotEmpty) row.itemName = nameCtrl.text.trim();
        if (rate != null && rate >= 0) row.rate = rate;
        if (qty != null && qty > 0) row.qty = qty;
        row.discountAmount = double.tryParse(discCtrl.text.trim()) ?? 0;
        row.uom = unit;
      });
      _persist();
    }
  }

  Future<void> _editBillDiscount() async {
    final ctrl = TextEditingController(text: _bill.billDiscount == 0 ? '' : _bill.billDiscount.toString());
    final value = await showDialog<double?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Bill Discount'),
        content: TextField(controller: ctrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Discount on whole bill (₹)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text) ?? 0), child: const Text('OK')),
        ],
      ),
    );
    if (value != null) {
      setState(() => _bill.billDiscount = value);
      _persist();
    }
  }

  Future<void> _editRemarks() async {
    final ctrl = TextEditingController(text: _bill.remarks ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Customer ka note'),
        content: TextField(controller: ctrl, autofocus: true, maxLines: 3, decoration: const InputDecoration(labelText: 'Remarks')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('OK')),
        ],
      ),
    );
    if (value != null) {
      setState(() => _bill.remarks = value.isEmpty ? null : value);
      _persist();
    }
  }

  Future<void> _editAdditionalCharges() async {
    final ctrl = TextEditingController(text: _bill.additionalCharges == 0 ? '' : _bill.additionalCharges.toString());
    final value = await showDialog<double?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Additional Charges'),
        content: TextField(controller: ctrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Delivery / packing / other charges (₹)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text) ?? 0), child: const Text('OK')),
        ],
      ),
    );
    if (value != null) {
      setState(() => _bill.additionalCharges = value);
      _persist();
    }
  }

  Future<void> _editTerms() async {
    final ctrl = TextEditingController(text: _bill.terms ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Terms & Conditions'),
        content: TextField(controller: ctrl, autofocus: true, maxLines: 4, decoration: const InputDecoration(labelText: 'Bill ke neeche print hone wali terms')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('OK')),
        ],
      ),
    );
    if (value != null) {
      setState(() => _bill.terms = value.isEmpty ? null : value);
      _persist();
    }
  }

  Future<void> _editRewardPoints() async {
    final custName = _bill.customerLabel ?? _bill.customer;
    if (custName == null || custName.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pehle Customer chuno reward points dekhne ya redeem karne ke liye [F11]')),
      );
      return;
    }

    final loyalty = await AppDb.instance.getCustomerLoyaltySummary(custName);
    if (!mounted) return;

    final currentBalance = loyalty.balance;
    final billTotalBeforeRedeem = _bill.subtotal - _bill.billDiscount + _bill.additionalCharges;
    final maxRedeemable = currentBalance < billTotalBeforeRedeem ? currentBalance : billTotalBeforeRedeem;

    final ctrl = TextEditingController(text: _bill.redeemPoints > 0 ? _bill.redeemPoints.toStringAsFixed(0) : '');

    final value = await showDialog<double?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.stars, color: SantuColors.amber),
            SizedBox(width: 8),
            Text('Reward Points [F10]'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Customer: $custName', style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Earned:'),
                      Text('${loyalty.earned.toStringAsFixed(1)} pts', style: const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Redeemed:'),
                      Text('${loyalty.redeemed.toStringAsFixed(1)} pts', style: const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const Divider(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Available Balance:', style: TextStyle(fontWeight: FontWeight.bold)),
                      Text('${currentBalance.toStringAsFixed(1)} pts (₹${currentBalance.toStringAsFixed(0)})',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: SantuColors.green)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text('Is bill par maximum redeem: ₹${maxRedeemable > 0 ? maxRedeemable.toStringAsFixed(0) : "0"}',
                style: const TextStyle(fontSize: 11.5, color: SantuColors.textMuted)),
            const SizedBox(height: 6),
            TextField(
              controller: ctrl,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Points to Redeem (1 pt = ₹1)',
                prefixText: '₹ ',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, 0.0),
            child: const Text('Remove Points'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final pts = double.tryParse(ctrl.text) ?? 0.0;
              if (pts < 0) {
                Navigator.pop(ctx, 0.0);
              } else if (pts > maxRedeemable) {
                Navigator.pop(ctx, maxRedeemable);
              } else {
                Navigator.pop(ctx, pts);
              }
            },
            child: const Text('Apply Points'),
          ),
        ],
      ),
    );

    if (value != null) {
      setState(() => _bill.redeemPoints = value);
      _persist();
    }
  }

  Future<void> _showBreakup() async {
    final t = _bill;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Full Breakup'),
        content: SizedBox(
          width: 280,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _breakupRow('Items Subtotal', t.subtotal),
              _breakupRow('Additional Charges', t.additionalCharges),
              _breakupRow('Bill Discount', -t.billDiscount),
              if (t.redeemPoints > 0) _breakupRow('Reward Points', -t.redeemPoints, color: SantuColors.green),
              const Divider(),
              _breakupRow('Grand Total', t.grandTotal, bold: true),
              if (t.amountReceived != null) _breakupRow('Amount Received', t.amountReceived!),
              if (t.change > 0) _breakupRow('Change to Return', t.change),
              if (t.baaki > 0) _breakupRow('Baaki Amount', t.baaki, color: Colors.red),
            ],
          ),
        ),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  Widget _breakupRow(String label, double value, {bool bold = false, Color? color}) {
    final style = TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal, color: color);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text('₹${value.toStringAsFixed(2)}', style: style),
        ],
      ),
    );
  }

  // Billing POS's calculator [More → Calculator] — a quick scratchpad for
  // working out a price without leaving the bill, no link to bill totals.
  Future<void> _showCalculator() async {
    await showDialog(context: context, builder: (ctx) => const _CalculatorDialog());
  }

  Future<void> _toggleCostVisibility() async {
    if (_showCost) {
      setState(() => _showCost = false);
      return;
    }
    final pin = await AppSettings.costPricePin();
    if (pin == null) {
      setState(() => _showCost = true);
      _loadCostCache();
      return;
    }
    if (!mounted) return;
    final ctrl = TextEditingController();
    final entered = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Security PIN'),
        content: TextField(controller: ctrl, autofocus: true, obscureText: true, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Cost price dekhne ke liye PIN daalo')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('OK')),
        ],
      ),
    );
    if (entered == pin) {
      setState(() => _showCost = true);
      _loadCostCache();
    } else if (entered != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Galat PIN')));
    }
  }

  Future<void> _saveAsDraft() async {
    await _persist();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Draft save ho gaya (submit nahi hua)')));
  }

  /// "Stock chadhaiye" modal — tap Available on the row to receive stock on the shelf inline (santu_add_stock_inline.js).
  Future<void> _openStockModal(BillItem row) async {
    final curStock = _availableStockCache[row.itemCode] ?? 0;
    final qtyCtrl = TextEditingController();
    final rateCtrl = TextEditingController();
    final result = await showDialog<Map<String, double>?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Stock chadhaiye', style: TextStyle(fontWeight: FontWeight.bold)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(row.itemName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              const SizedBox(height: 4),
              Text('Abhi stock: ${_fmtQty(curStock)} ${row.uom}', style: const TextStyle(color: SantuColors.textMuted, fontSize: 13)),
              const SizedBox(height: 16),
              TextField(
                controller: qtyCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Kitna maal aaya? *',
                  helperText: 'Jitna aaya utna likhiye — purane me jud jayega',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: rateCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Naya purchase rate (optional)',
                  helperText: 'Khaali chhod dijiye to purana rate wahi rahega',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final q = double.tryParse(qtyCtrl.text.trim());
              if (q == null || q <= 0) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Qty zero se zyada honi chahiye')));
                return;
              }
              final r = double.tryParse(rateCtrl.text.trim());
              Navigator.pop(ctx, {'qty': q, if (r != null && r > 0) 'rate': r});
            },
            child: const Text('Stock chadhao'),
          ),
        ],
      ),
    );

    if (result != null && mounted) {
      final q = result['qty']!;
      final r = result['rate'];
      final newQty = await AppDb.instance.receiveStockSimple(row.itemCode, q, purchaseRate: r);
      setState(() {
        _availableStockCache[row.itemCode] = newQty;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: SantuColors.green,
            content: Text('✅ Stock chadh gaya (+${_fmtQty(q)} ${row.uom}) — Abhi: ${_fmtQty(newQty)} ${row.uom}'),
          ),
        );
      }
    }
  }

  /// Row green tick ✓: push edited rate and unit back to item master (santu_tick_to_master.js).
  Future<void> _saveRowToMaster(BillItem row) async {
    final item = await AppDb.instance.itemByCode(row.itemCode);
    final stockUom = item?.stockUom ?? row.uom;
    final unitChanging = row.uom != stockUom;

    if (!mounted) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(row.itemName),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Selling price: ₹${row.rate.toStringAsFixed(2)} (har ${row.uom} ka)', style: const TextStyle(fontWeight: FontWeight.w600)),
            if (unitChanging) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFFFFF3CD), borderRadius: BorderRadius.circular(6)),
                child: Text('Unit badlega: $stockUom se ${row.uom}\nStock ka number wahi rahega, sirf unit badlega.', style: const TextStyle(fontSize: 12)),
              ),
            ],
            const SizedBox(height: 14),
            const Text('Item catalog me save kar dein?'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Haan, Save Karo')),
        ],
      ),
    );

    if (confirm == true) {
      await AppDb.instance.updateItemMaster(row.itemCode, rate: row.rate, uom: row.uom, name: row.itemName);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(backgroundColor: SantuColors.green, content: Text('✅ Item catalog me rate aur unit save ho gaya')),
        );
      }
    }
  }

  /// ↗ Kisi aur ko: share/send bill via WhatsApp to custom phone number (santu_save_buttons.js & frame 39/53).
  Future<void> _shareWithOther() async {
    if (_bill.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bill mein koi item nahi hai')));
      return;
    }
    final phoneCtrl = TextEditingController();
    final nameCtrl = TextEditingController();
    final submit = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kisi aur ko bhejein (WhatsApp)'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: phoneCtrl,
              keyboardType: TextInputType.phone,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Kis number par bhejna hai (WhatsApp) *',
                hintText: '10 digit mobile number',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Naam (optional)',
                hintText: 'Khaali chhoda to sirf number dikhega',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (phoneCtrl.text.trim().replaceAll(RegExp(r'\D'), '').length < 10) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Valid 10 digit number daalein')));
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: const Text('Bhejein'),
          ),
        ],
      ),
    );

    if (submit == true && mounted) {
      final phone = phoneCtrl.text.trim().replaceAll(RegExp(r'\D'), '');
      final name = nameCtrl.text.trim().isNotEmpty ? nameCtrl.text.trim() : 'Sir/Madam';
      await _save(whatsappOtherPhone: phone, whatsappOtherName: name);
    }
  }

  /// Other/Credit Payments [Ctrl+M] bottom sheet modal.
  void _showOtherCreditPayments() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Other / Credit Payments', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 12),
              for (final mode in _paymentModes)
                ListTile(
                  leading: Icon(
                    mode == 'Cash'
                        ? Icons.money
                        : mode == 'UPI'
                            ? Icons.qr_code
                            : mode == 'Card'
                                ? Icons.credit_card
                                : Icons.account_balance_wallet,
                    color: _paymentMode == mode ? SantuColors.blue : SantuColors.textDark,
                  ),
                  title: Text(mode == 'Credit' ? 'Credit (Udhaar)' : mode),
                  trailing: _paymentMode == mode ? const Icon(Icons.check, color: SantuColors.blue) : null,
                  onTap: () {
                    setState(() {
                      _paymentMode = mode;
                      if (mode == 'Credit') {
                        _receivedCtrl.text = '0.00';
                      } else {
                        _receivedCtrl.text = _bill.grandTotal.toStringAsFixed(2);
                      }
                    });
                    Navigator.pop(ctx);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  QuickDoc _asQuickDoc() => QuickDoc(
        id: _uuid.v4(),
        postingDate: _bill.postingDate,
        party: _bill.customer,
        partyLabel: _bill.customerLabel,
        createdAt: DateTime.now().toIso8601String(),
        items: [
          for (final row in _bill.items)
            BillItem(id: _uuid.v4(), itemCode: row.itemCode, itemName: row.itemName, qty: row.qty, uom: row.uom, rate: row.rate, discountAmount: row.discountAmount),
        ],
      );

  void _convertToEstimate() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => QuickDocScreen(
          kind: 'estimate',
          title: 'Estimate',
          partyKind: 'Customer',
          stockSign: 0,
          docPrefix: 'EST-',
          actionLabel: 'Save Estimate',
          canConvertToBill: true,
          initialDoc: _asQuickDoc(),
        ),
      ),
    );
  }

  void _convertToChallan() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => QuickDocScreen(
          kind: 'challan',
          title: 'Delivery Challan',
          partyKind: 'Customer',
          stockSign: -1,
          docPrefix: 'DC-',
          actionLabel: 'Save Challan',
          initialDoc: _asQuickDoc(),
        ),
      ),
    );
  }

  void _showMoreMenu() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.8),
          child: ListView(
            shrinkWrap: true,
            children: [
            ListTile(
              leading: const Icon(Icons.percent),
              title: const Text('Bill Discount'),
              subtitle: _bill.billDiscount > 0 ? Text('₹${_bill.billDiscount.toStringAsFixed(2)}') : null,
              onTap: () {
                Navigator.pop(ctx);
                _editBillDiscount();
              },
            ),
            ListTile(
              leading: const Icon(Icons.stars_outlined, color: SantuColors.amber),
              title: const Text('Reward Points [F10]'),
              subtitle: _bill.redeemPoints > 0 ? Text('₹${_bill.redeemPoints.toStringAsFixed(2)} redeemed') : null,
              onTap: () {
                Navigator.pop(ctx);
                _editRewardPoints();
              },
            ),
            ListTile(
              leading: const Icon(Icons.note_outlined),
              title: const Text('Customer ka note'),
              subtitle: _bill.remarks != null ? Text(_bill.remarks!, maxLines: 1, overflow: TextOverflow.ellipsis) : null,
              onTap: () {
                Navigator.pop(ctx);
                _editRemarks();
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined),
              title: const Text('Additional Charges'),
              subtitle: _bill.additionalCharges > 0 ? Text('₹${_bill.additionalCharges.toStringAsFixed(2)}') : null,
              onTap: () {
                Navigator.pop(ctx);
                _editAdditionalCharges();
              },
            ),
            ListTile(
              leading: const Icon(Icons.gavel_outlined),
              title: const Text('Terms & Conditions'),
              subtitle: _bill.terms != null ? Text(_bill.terms!, maxLines: 1, overflow: TextOverflow.ellipsis) : null,
              onTap: () {
                Navigator.pop(ctx);
                _editTerms();
              },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('Full Breakup'),
              enabled: _bill.items.isNotEmpty,
              onTap: () {
                Navigator.pop(ctx);
                _showBreakup();
              },
            ),
            ListTile(
              leading: const Icon(Icons.calculate_outlined),
              title: const Text('Calculator'),
              onTap: () {
                Navigator.pop(ctx);
                _showCalculator();
              },
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.save_outlined),
              title: const Text('Draft save karo (submit nahi)'),
              onTap: () {
                Navigator.pop(ctx);
                _saveAsDraft();
              },
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Convert to Estimate'),
              subtitle: const Text('Bill puri na karke isi saman ka Estimate bana do'),
              enabled: _bill.items.isNotEmpty,
              onTap: () {
                Navigator.pop(ctx);
                _convertToEstimate();
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined),
              title: const Text('Convert to Delivery Challan'),
              subtitle: const Text('Isi bill ke items ka Challan — koi payment nahi lagta'),
              enabled: _bill.items.isNotEmpty,
              onTap: () {
                Navigator.pop(ctx);
                _convertToChallan();
              },
            ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _onCustomerChanged(String q) async {
    if (_selectedCustomer != null && _selectedCustomer!.customerName != q) {
      setState(() {
        _selectedCustomer = null;
        _bill.customer = null;
        _bill.customerLabel = q.isEmpty ? null : q;
      });
    }
    if (q.trim().isEmpty) {
      setState(() => _custResults = []);
      return;
    }
    final results = await AppDb.instance.searchCustomers(q.trim());
    setState(() => _custResults = results);
  }

  void _pickCustomer(Customer c) {
    setState(() {
      _selectedCustomer = c;
      _bill.customer = c.name;
      _bill.customerLabel = c.customerName;
      _custCtrl.text = c.customerName;
      _custResults = [];
    });
    _persist();
  }

  Future<void> _openNewCustomerDialog({String? initialName}) async {
    final nameCtrl = TextEditingController(text: initialName ?? '');
    final phoneCtrl = TextEditingController();
    final villageCtrl = TextEditingController();

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.person_add, color: SantuColors.blue),
            SizedBox(width: 8),
            Text('Naya Customer Jodein'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                autofocus: (initialName == null || initialName.isEmpty),
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Customer Name *',
                  hintText: 'e.g. Ramesh Kumar',
                  prefixIcon: Icon(Icons.person_outline, size: 20),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: villageCtrl,
                autofocus: (initialName != null && initialName.isNotEmpty),
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Village / Gaon *',
                  hintText: 'e.g. Ishuwapur, Mahuli, Purshauli',
                  prefixIcon: Icon(Icons.location_on_outlined, size: 20, color: SantuColors.blue),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone Number',
                  hintText: 'Mobile number',
                  prefixIcon: Icon(Icons.phone_outlined, size: 20),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (nameCtrl.text.trim().isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Customer ka naam likhna zaroori hai')));
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: const Text('Save & Select'),
          ),
        ],
      ),
    );

    if (saved == true && nameCtrl.text.trim().isNotEmpty) {
      final newCust = Customer(
        name: 'CUST-${_uuid.v4().substring(0, 8)}',
        customerName: nameCtrl.text.trim(),
        phone: phoneCtrl.text.trim().isEmpty ? null : phoneCtrl.text.trim(),
        village: villageCtrl.text.trim().isEmpty ? null : villageCtrl.text.trim(),
      );
      await AppDb.instance.upsertCustomers([newCust]);
      _pickCustomer(newCust);
    }
  }

  Future<void> _openEditCustomerVillageDialog(Customer c) async {
    final villageCtrl = TextEditingController(text: c.village ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${c.customerName} ka Gaon'),
        content: TextField(
          controller: villageCtrl,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Village / Gaon',
            prefixIcon: Icon(Icons.location_on_outlined, color: SantuColors.blue),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved == true) {
      final updated = Customer(
        name: c.name,
        customerName: c.customerName,
        phone: (c.phone == null || c.phone!.isEmpty) ? null : c.phone,
        village: villageCtrl.text.trim().isEmpty ? null : villageCtrl.text.trim(),
      );
      await AppDb.instance.upsertCustomers([updated]);
      _pickCustomer(updated);
    }
  }

  Future<void> _save({bool print = false, bool whatsapp = false, String? whatsappOtherPhone, String? whatsappOtherName}) async {
    if (_bill.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bill mein koi item nahi hai')));
      return;
    }
    final billDate = DateTime.tryParse(_bill.postingDate);
    final today = DateTime.now();
    if (billDate != null && DateTime(billDate.year, billDate.month, billDate.day).isBefore(DateTime(today.year, today.month, today.day))) {
      final proceed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Backdated Bill'),
          content: Text('Is bill ki date ${_bill.postingDate} hai — aaj ki date se peeche. Isi date se save karein?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Haan, Save Karo')),
          ],
        ),
      );
      if (proceed != true) return;
    }
    if (!mounted) return;
    _bill.amountReceived = double.tryParse(_receivedCtrl.text);
    _bill.paymentMode = _paymentMode;
    final wasAlreadySaved = _bill.status == InvoiceStatus.saved;
    _bill.status = InvoiceStatus.saved;
    _bill.billNo ??= 'B-${await AppDb.instance.nextBillNo()}';
    await _persist();
    // Stock leaves on the sale, not on every autosave keystroke — otherwise
    // re-saving an already-saved bill (Edit Bill) would deduct it twice.
    // Also skip if updateStock is false (e.g. when converted from Delivery Challan,
    // which already decremented stock at save time).
    if (!wasAlreadySaved && _bill.updateStock) {
      final deltas = <String, double>{};
      for (final row in _bill.items) {
        deltas[row.itemCode] = (deltas[row.itemCode] ?? 0) - row.qty;
      }
      await AppDb.instance.adjustItemStock(deltas);
    }
    if (!mounted) return;
    if (whatsapp || whatsappOtherPhone != null) {
      final templates = await AppDb.instance.listMessageTemplates();
      final template = templates['Sales Transaction'] ?? 'Namaste {party}, aapka bill {doc_no} ₹{amount} ka ban gaya hai.';
      final partyName = whatsappOtherName ?? _bill.customerLabel ?? 'Customer';
      final msg = fillTemplate(template, {
        'party': partyName,
        'doc_no': _bill.billNo ?? '',
        'amount': _bill.grandTotal.toStringAsFixed(2),
      });
      // The actual bill, not just a text line — same A4 PDF "Send A4 PDF"
      // builds elsewhere. Best-effort: a PDF failure must not block sending
      // the text itself, which is what every WhatsApp share did before.
      String? pdfPath;
      try {
        pdfPath = await A4Invoice.writeToFile(_bill);
      } catch (_) {}
      if (!mounted) return;
      await shareViaWhatsApp(
        context,
        phone: whatsappOtherPhone,
        message: msg,
        docType: 'Sales Transaction',
        docNo: _bill.billNo,
        partyLabel: partyName,
        attachmentPath: pdfPath,
      );
    } else {
      await showDialog(
        context: context,
        builder: (ctx) => _ReceiptDialog(invoice: _bill, forPrint: print),
      );
    }
    if (!mounted) return;
    setState(() {
      _tabs[_activeIndex] = _blankInvoice();
      _syncRightPanelControllers();
    });
  }

  void _incrementQty(BillItem row) {
    setState(() => row.qty += 1);
    _persist();
  }

  void _decrementQty(BillItem row) {
    if (row.qty > 1) {
      setState(() => row.qty -= 1);
      _persist();
    } else {
      _removeItem(row);
    }
  }

  Future<void> _showPaymentModePicker() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Payment Mode Chunein', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            for (final m in _paymentModes)
              ListTile(
                leading: Icon(
                  m == 'Cash' ? Icons.money : m == 'UPI' ? Icons.qr_code : m == 'Card' ? Icons.credit_card : Icons.handshake,
                  color: _paymentMode == m ? SantuColors.blue : SantuColors.textMuted,
                ),
                title: Text(m, style: TextStyle(fontWeight: _paymentMode == m ? FontWeight.bold : FontWeight.normal)),
                trailing: _paymentMode == m ? const Icon(Icons.check, color: SantuColors.blue) : null,
                onTap: () => Navigator.pop(ctx, m),
              ),
          ],
        ),
      ),
    );
    if (picked != null) {
      setState(() => _paymentMode = picked);
    }
  }

  Future<void> _showQuickDiscountNoteModal() async {
    final discCtrl = TextEditingController(text: _bill.billDiscount == 0 ? '' : _bill.billDiscount.toString());
    final noteCtrl = TextEditingController(text: _bill.remarks ?? '');
    final chargesCtrl = TextEditingController(text: _bill.additionalCharges == 0 ? '' : _bill.additionalCharges.toString());

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Discount aur Bill Note', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 14),
              TextField(
                controller: discCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Bill Discount (₹)', prefixText: '₹ '),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: chargesCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Additional Charges (Delivery/Packing)', prefixText: '₹ '),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: noteCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Customer Note / Remarks'),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {
                  setState(() {
                    _bill.billDiscount = double.tryParse(discCtrl.text.trim()) ?? 0;
                    _bill.additionalCharges = double.tryParse(chargesCtrl.text.trim()) ?? 0;
                    _bill.remarks = noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim();
                  });
                  _persist();
                  Navigator.pop(ctx);
                },
                child: const Text('Save Details'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      children: [
        _buildMobileTopBar(),
        _buildMobileCustomerBar(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: TextField(
            controller: _searchCtrl,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              hintText: 'Search item name, code...',
              hintStyle: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
              prefixIcon: const Icon(Icons.search, color: SantuColors.blue, size: 18),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 16),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _searchResults = []);
                      },
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              isDense: true,
            ),
          ),
        ),
        if (_searchResults.isNotEmpty)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: SantuColors.card,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: SantuColors.border),
              boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 3))],
            ),
            constraints: const BoxConstraints(maxHeight: 240),
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _searchResults.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final item = _searchResults[i];
                return Container(
                  color: ItemHighlight.colorFor(item.itemCode, item.itemName),
                  child: ListTile(
                    dense: true,
                    title: Text(item.itemName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    subtitle: Text('${item.itemCode} · Stock: ${item.availableQty.toStringAsFixed(0)} ${item.stockUom}', style: const TextStyle(fontSize: 11)),
                    trailing: Text('₹${item.priceListRate.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: SantuColors.blue)),
                    onTap: () {
                      _addItem(item);
                      _searchCtrl.clear();
                      setState(() => _searchResults = []);
                    },
                  ),
                );
              },
            ),
          ),
        Expanded(
          child: _bill.items.isEmpty
              ? _buildMobileEmptyCart()
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  itemCount: _bill.items.length,
                  itemBuilder: (ctx, i) => _buildMobileItemCard(i, _bill.items[i]),
                ),
        ),
        _buildMobileStickyCheckoutBar(),
      ],
    );
  }

  Widget _buildMobileTopBar() {
    final dateStr = DateFormat('dd MMM').format(DateTime.tryParse(_bill.postingDate) ?? DateTime.now());
    return Container(
      color: SantuColors.card,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (int i = 0; i < _tabs.length; i++)
                    GestureDetector(
                      onTap: () => setState(() {
                        _activeIndex = i;
                        _syncRightPanelControllers();
                      }),
                      child: Container(
                        margin: const EdgeInsets.only(right: 6),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: i == _activeIndex ? SantuColors.blue : const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _tabs[i].billNo ?? 'Bill #${i + 1}',
                              style: TextStyle(
                                color: i == _activeIndex ? Colors.white : SantuColors.textDark,
                                fontWeight: i == _activeIndex ? FontWeight.bold : FontWeight.w500,
                                fontSize: 12,
                              ),
                            ),
                            if (_tabs.length > 1) ...[
                              const SizedBox(width: 4),
                              InkWell(
                                onTap: () => _closeTab(i),
                                child: Icon(Icons.close, size: 13, color: i == _activeIndex ? Colors.white70 : SantuColors.textMuted),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  InkWell(
                    onTap: _newBill,
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                      decoration: BoxDecoration(
                        color: SantuColors.blueBg,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.add, size: 13, color: SantuColors.blue),
                          SizedBox(width: 2),
                          Text('Bill', style: TextStyle(color: SantuColors.blue, fontSize: 11, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(_bill.postingDate) ?? DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null) {
                setState(() => _bill.postingDate = DateFormat('yyyy-MM-dd').format(picked));
                _persist();
              }
            },
            borderRadius: BorderRadius.circular(6),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.calendar_today_outlined, size: 11, color: SantuColors.textMuted),
                  const SizedBox(width: 4),
                  Text(dateStr, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: SantuColors.textDark)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileCustomerBar() {
    if (_selectedCustomer != null) {
      return Container(
        margin: const EdgeInsets.fromLTRB(12, 4, 12, 2),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFEFF6FF),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
        ),
        child: Row(
          children: [
            const Icon(Icons.person, size: 16, color: SantuColors.blue),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_selectedCustomer!.customerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1E3A8A))),
                  Row(
                    children: [
                      if (_selectedCustomer!.village != null && _selectedCustomer!.village!.isNotEmpty) ...[
                        const Icon(Icons.location_on, size: 11, color: SantuColors.blue),
                        const SizedBox(width: 1),
                        Text(_selectedCustomer!.village!, style: const TextStyle(fontSize: 10, color: SantuColors.blue, fontWeight: FontWeight.w600)),
                        if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty) const Text('  ·  ', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                      ],
                      if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty)
                        Text(_selectedCustomer!.phone!, style: const TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                    ],
                  ),
                ],
              ),
            ),
            InkWell(
              onTap: () {
                setState(() {
                  _selectedCustomer = null;
                  _bill.customer = null;
                  _bill.customerLabel = null;
                  _custCtrl.clear();
                });
                _persist();
              },
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(Icons.close, size: 16, color: SantuColors.textMuted),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      child: Column(
        children: [
          TextField(
            controller: _custCtrl,
            onChanged: _onCustomerChanged,
            decoration: InputDecoration(
              hintText: 'Customer name, phone, village...',
              hintStyle: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
              prefixIcon: const Icon(Icons.person_search_outlined, size: 18, color: SantuColors.textMuted),
              suffixIcon: IconButton(
                icon: const Icon(Icons.person_add_alt_1, color: SantuColors.blue, size: 18),
                tooltip: 'Naya Customer',
                onPressed: () => _openNewCustomerDialog(initialName: _custCtrl.text.trim()),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              isDense: true,
            ),
          ),
          if (_custResults.isNotEmpty || (_custCtrl.text.trim().isNotEmpty && _selectedCustomer == null))
            Container(
              margin: const EdgeInsets.only(top: 4),
              decoration: BoxDecoration(
                color: SantuColors.card,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: SantuColors.border),
                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))],
              ),
              constraints: const BoxConstraints(maxHeight: 200),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final c in _custResults)
                    ListTile(
                      dense: true,
                      leading: const CircleAvatar(
                        radius: 12,
                        backgroundColor: Color(0xFFE2E8F0),
                        child: Icon(Icons.person, size: 14, color: SantuColors.blue),
                      ),
                      title: Text(c.customerName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                      subtitle: Row(
                        children: [
                          if (c.village != null && c.village!.isNotEmpty) ...[
                            const Icon(Icons.location_on, size: 11, color: SantuColors.blue),
                            const SizedBox(width: 1),
                            Text(c.village!, style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600, fontSize: 10)),
                            if (c.phone != null && c.phone!.isNotEmpty) const Text(' · ', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                          ],
                          if (c.phone != null && c.phone!.isNotEmpty)
                            Text(c.phone!, style: const TextStyle(color: SantuColors.textMuted, fontSize: 10)),
                        ],
                      ),
                      onTap: () => _pickCustomer(c),
                    ),
                  if (_custCtrl.text.trim().isNotEmpty)
                    ListTile(
                      dense: true,
                      leading: const CircleAvatar(
                        radius: 12,
                        backgroundColor: Color(0xFFDBEAFE),
                        child: Icon(Icons.person_add, size: 14, color: SantuColors.blue),
                      ),
                      title: Text(
                        '+ "${_custCtrl.text.trim()}" naya customer jodein',
                        style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                      onTap: () => _openNewCustomerDialog(initialName: _custCtrl.text.trim()),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMobileEmptyCart() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Color(0xFFF1F5F9),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.shopping_bag_outlined, size: 36, color: SantuColors.textMuted),
          ),
          const SizedBox(height: 10),
          const Text('Bill khali hai', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: SantuColors.textDark)),
          const SizedBox(height: 2),
          const Text('Upar search bar se saman add karein', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildMobileItemCard(int index, BillItem row) {
    final stock = _availableStockCache[row.itemCode] ?? 0.0;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: ItemHighlight.colorFor(row.itemCode, row.itemName),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: const [BoxShadow(color: Color(0x06000000), blurRadius: 3, offset: Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  row.itemName,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                icon: const Icon(Icons.check, size: 17, color: SantuColors.green),
                tooltip: 'Save rate to master',
                onPressed: () => _saveRowToMaster(row),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                icon: const Icon(Icons.close, size: 17, color: SantuColors.textFaint),
                tooltip: 'Remove',
                onPressed: () => _removeItem(row),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              InkWell(
                onTap: () => _openStockModal(row),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Stk: ${_fmtQty(stock)}', style: const TextStyle(fontSize: 10, color: SantuColors.blue, fontWeight: FontWeight.w500)),
                      const SizedBox(width: 2),
                      const Icon(Icons.add_circle_outline, size: 9, color: SantuColors.blue),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 6),
              InkWell(
                onTap: () => _editRate(row),
                borderRadius: BorderRadius.circular(6),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '@ ₹${row.rate == row.rate.roundToDouble() ? row.rate.toInt() : row.rate.toStringAsFixed(1)}',
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.blue),
                      ),
                      const SizedBox(width: 2),
                      const Icon(Icons.edit, size: 9, color: SantuColors.blue),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: const Color(0xFFCBD5E1), width: 0.8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    InkWell(
                      onTap: () => _decrementQty(row),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                        child: Icon(Icons.remove, size: 14, color: SantuColors.textDark),
                      ),
                    ),
                    InkWell(
                      onTap: () => _editQty(row),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                        child: Text(
                          '${_fmtQty(row.qty)} ${row.uom}',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: () => _incrementQty(row),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                        child: Icon(Icons.add, size: 14, color: SantuColors.blue),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '₹${row.lineTotal.toStringAsFixed(2)}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: SantuColors.textDark),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMobileStickyCheckoutBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 1)),
        boxShadow: [BoxShadow(color: Color(0x0C000000), blurRadius: 8, offset: Offset(0, -3))],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                InkWell(
                  onTap: _showPaymentModePicker,
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: const Color(0xFFCBD5E1), width: 0.8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.payments_outlined, size: 13, color: SantuColors.textDark),
                        const SizedBox(width: 4),
                        Text(_paymentMode, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                        const Icon(Icons.arrow_drop_down, size: 14, color: SantuColors.textMuted),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                InkWell(
                  onTap: _showQuickDiscountNoteModal,
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: (_bill.billDiscount > 0 || _bill.additionalCharges > 0 || _bill.remarks != null)
                          ? const Color(0xFFFFFBEB)
                          : const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: (_bill.billDiscount > 0 || _bill.additionalCharges > 0 || _bill.remarks != null)
                            ? const Color(0xFFFDE68A)
                            : const Color(0xFFE2E8F0),
                        width: 0.8,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.discount_outlined,
                          size: 12,
                          color: (_bill.billDiscount > 0 || _bill.additionalCharges > 0 || _bill.remarks != null)
                              ? SantuColors.amber
                              : SantuColors.textMuted,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          _bill.billDiscount > 0 ? 'Disc -₹${_bill.billDiscount.toInt()}' : '+ Disc/Note',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: (_bill.billDiscount > 0 || _bill.additionalCharges > 0 || _bill.remarks != null)
                                ? SantuColors.amber
                                : SantuColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Spacer(),
                InkWell(
                  onTap: _showMoreMenu,
                  borderRadius: BorderRadius.circular(6),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('More', style: TextStyle(fontSize: 11, color: SantuColors.blue, fontWeight: FontWeight.w600)),
                        Icon(Icons.arrow_drop_down, size: 14, color: SantuColors.blue),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          const Text('₹ ', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: SantuColors.green)),
                          Text(
                            _bill.grandTotal.toStringAsFixed(2),
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                          ),
                        ],
                      ),
                      Text(
                        '${_bill.items.length} items · ${_bill.totalQty} qty',
                        style: const TextStyle(fontSize: 10, color: SantuColors.textMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _bill.items.isEmpty ? null : () => _save(whatsapp: true),
                  icon: const Icon(Icons.share, size: 20, color: Color(0xFF25D366)),
                  tooltip: 'WhatsApp Bill',
                  visualDensity: VisualDensity.compact,
                ),
                const SizedBox(width: 4),
                FilledButton.icon(
                  onPressed: _bill.items.isEmpty ? null : () => _save(print: true),
                  icon: const Icon(Icons.print, size: 16),
                  label: const Text('SAVE & PRINT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 0.3)),
                  style: FilledButton.styleFrom(
                    backgroundColor: SantuColors.green,
                    disabledBackgroundColor: const Color(0xFF94A3B8),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final narrow = MediaQuery.of(context).size.width < 700;

    return Scaffold(
      // The mobile layout's only text field (item/customer search) sits near
      // the top, not the bottom, so there's nothing for the keyboard to
      // avoid by resizing the body — and resizing it squeezed the fixed-
      // height sticky checkout bar below its own natural height, overflowing
      // it (found by opening customer search with the keyboard up). Letting
      // the keyboard overlay instead keeps every fixed-size section at its
      // real size; the keyboard just covers the sticky bar while it's up.
      resizeToAvoidBottomInset: false,
      appBar: AppBar(
        title: const Text('Santu Hardware', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
        actions: [
          IconButton(
            icon: const Icon(Icons.calculate_outlined),
            tooltip: 'Calculator',
            onPressed: _showCalculator,
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            tooltip: 'More options',
            onPressed: () => AppOverflowMenu.show(context),
          ),
        ],
      ),
      body: narrow
          ? _buildMobileLayout()
          : Column(
              children: [
                _buildTabBar(),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: _buildLeft()),
                        const SizedBox(width: 12),
                        SizedBox(width: 320, child: _buildRight()),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      color: SantuColors.bg,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (int i = 0; i < _tabs.length; i++)
              GestureDetector(
                onTap: () => setState(() {
                  _activeIndex = i;
                  _syncRightPanelControllers();
                }),
                child: Container(
                  margin: const EdgeInsets.only(right: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: i == _activeIndex ? SantuColors.card : Colors.transparent,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _tabs[i].billNo ?? 'Bill #${i + 1}',
                        style: TextStyle(
                          color: i == _activeIndex ? SantuColors.textDark : SantuColors.textMuted,
                          fontWeight: i == _activeIndex ? FontWeight.w600 : FontWeight.normal,
                          fontSize: 14,
                        ),
                      ),
                      if (_tabs.length > 1) ...[
                        const SizedBox(width: 8),
                        InkWell(onTap: () => _closeTab(i), child: const Icon(Icons.close, size: 16, color: SantuColors.textFaint)),
                      ],
                    ],
                  ),
                ),
              ),
            OutlinedButton(
              onPressed: _newBill,
              style: OutlinedButton.styleFrom(
                backgroundColor: SantuColors.card,
                side: const BorderSide(color: SantuColors.border),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('+ New Bill', style: TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLeft() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _searchCtrl,
          onChanged: _onSearchChanged,
          decoration: InputDecoration(
            hintText: 'Scan or search by item code, model no or item name',
            prefixIcon: const Icon(Icons.search, color: SantuColors.blueLight),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blueLight, width: 2)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: SantuColors.blue, width: 2)),
          ),
        ),
        // Rendered inline (pushes the grid down) rather than as a Positioned
        // overlay: the overlay version was silently clipped whenever this
        // column sat inside the phone-width SingleChildScrollView, since a
        // scrollable's viewport clips content that overflows its Stack
        // ancestor — the dropdown was computing correctly but never
        // painting. Found by testing on-device (vivo phone), not by reading
        // the code.
        if (_searchResults.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: SantuColors.card,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: SantuColors.border),
              boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))],
            ),
            constraints: const BoxConstraints(maxHeight: 280),
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _searchResults.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final item = _searchResults[i];
                return Container(
                  color: ItemHighlight.colorFor(item.itemCode, item.itemName),
                  child: ListTile(
                    dense: true,
                    title: Text(item.itemName),
                    subtitle: Text('${item.itemCode} · Available: ${item.availableQty.toStringAsFixed(0)}'),
                    trailing: Text('₹${item.priceListRate.toStringAsFixed(2)}'),
                    onTap: () => _addItem(item),
                  ),
                );
              },
            ),
          ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: SantuColors.card,
            border: Border.all(color: SantuColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              _gridHeader(),
              if (_bill.items.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(28),
                  child: Text('Koi item nahi — upar search karke add karo', style: TextStyle(color: SantuColors.textMuted)),
                )
              else
                for (int i = 0; i < _bill.items.length; i++) _gridRow(i, _bill.items[i]),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: const BoxDecoration(color: Color(0xFFF8FAFC)),
                alignment: Alignment.centerRight,
                child: Text('₹ ${_bill.subtotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _gridHeader() {
    TextStyle style = const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.textMuted);
    return Container(
      color: const Color(0xFFF8FAFC),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Row(children: [
        SizedBox(width: 20, child: Text('#', style: style)),
        Expanded(flex: 3, child: Text('ITEM', style: style)),
        SizedBox(width: 40, child: Text('QTY', style: style, textAlign: TextAlign.right)),
        SizedBox(width: 52, child: Text('RATE', style: style, textAlign: TextAlign.right)),
        if (_showCost) SizedBox(width: 48, child: Text('COST', style: style.copyWith(color: Colors.red), textAlign: TextAlign.right)),
        SizedBox(width: 56, child: Text('TOTAL', style: style, textAlign: TextAlign.right)),
        SizedBox(
          width: 26,
          child: InkWell(
            onTap: _toggleCostVisibility,
            child: Icon(_showCost ? Icons.visibility : Icons.visibility_off, size: 16, color: SantuColors.textFaint),
          ),
        ),
        const SizedBox(width: 26),
      ]),
    );
  }

  Widget _gridRow(int index, BillItem row) {
    final stock = _availableStockCache[row.itemCode] ?? 0.0;
    return InkWell(
      onLongPress: () => _editRate(row),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
        decoration: BoxDecoration(
          color: ItemHighlight.colorFor(row.itemCode, row.itemName),
          border: const Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
        ),
        child: Row(children: [
          SizedBox(width: 20, child: Text('${index + 1}', style: const TextStyle(fontSize: 12))),
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(row.itemName, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500), maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                InkWell(
                  onTap: () => _openStockModal(row),
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          'Available: ${_fmtQty(stock)} ${row.uom}',
                          style: const TextStyle(fontSize: 10, color: SantuColors.blue, decoration: TextDecoration.underline),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 2),
                      const Icon(Icons.add_circle_outline, size: 10, color: SantuColors.blue),
                    ],
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            width: 40,
            child: InkWell(
              onTap: () => _editQty(row),
              child: Text('${_fmtQty(row.qty)} ${row.uom}', style: const TextStyle(fontSize: 10), textAlign: TextAlign.right),
            ),
          ),
          SizedBox(
            width: 52,
            child: InkWell(
              onTap: () => _editRate(row),
              borderRadius: BorderRadius.circular(4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: const Color(0xFFCBD5E1), width: 0.8),
                ),
                child: Text(
                  row.rate == row.rate.roundToDouble() ? row.rate.toInt().toString() : row.rate.toStringAsFixed(2),
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: SantuColors.blue),
                  textAlign: TextAlign.right,
                ),
              ),
            ),
          ),
          if (_showCost)
            SizedBox(
              width: 48,
              child: Text(_costCache[row.itemCode]?.toStringAsFixed(0) ?? '—', style: const TextStyle(fontSize: 12, color: Colors.red), textAlign: TextAlign.right),
            ),
          SizedBox(width: 56, child: Text(row.lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), textAlign: TextAlign.right)),
          SizedBox(
            width: 26,
            child: IconButton(
              padding: EdgeInsets.zero,
              icon: const Icon(Icons.check, size: 18, color: SantuColors.green),
              tooltip: 'Is row ka rate aur unit item me save karein',
              onPressed: () => _saveRowToMaster(row),
            ),
          ),
          SizedBox(
            width: 26,
            child: IconButton(
              padding: EdgeInsets.zero,
              icon: const Icon(Icons.close, size: 16, color: SantuColors.textFaint),
              onPressed: () => _removeItem(row),
            ),
          ),
        ]),
      ),
    );
  }

  String _fmtQty(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  Widget _buildRight() {
    final t = _bill;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          decoration: const InputDecoration(labelText: 'Date'),
          controller: TextEditingController(text: t.postingDate),
          readOnly: true,
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: DateTime.tryParse(t.postingDate) ?? DateTime.now(),
              firstDate: DateTime(2020),
              lastDate: DateTime(2100),
            );
            if (picked != null) {
              setState(() => t.postingDate = DateFormat('yyyy-MM-dd').format(picked));
              _persist();
            }
          },
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _custCtrl,
          onChanged: _onCustomerChanged,
          decoration: InputDecoration(
            labelText: 'Customer',
            hintText: 'Search by name, phone, village [F11]',
            prefixIcon: const Icon(Icons.person_search_outlined, size: 20),
            suffixIcon: IconButton(
              icon: const Icon(Icons.person_add_alt_1, color: SantuColors.blue, size: 20),
              tooltip: 'Naya Customer Jodein',
              onPressed: () => _openNewCustomerDialog(initialName: _custCtrl.text.trim()),
            ),
          ),
        ),
        if (_custResults.isNotEmpty || (_custCtrl.text.trim().isNotEmpty && _selectedCustomer == null))
          Container(
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: SantuColors.card,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: SantuColors.border),
              boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))],
            ),
            constraints: const BoxConstraints(maxHeight: 240),
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final c in _custResults)
                  ListTile(
                    dense: true,
                    leading: const CircleAvatar(
                      radius: 14,
                      backgroundColor: Color(0xFFE2E8F0),
                      child: Icon(Icons.person, size: 16, color: SantuColors.blue),
                    ),
                    title: Text(c.customerName, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Row(
                      children: [
                        if (c.village != null && c.village!.isNotEmpty) ...[
                          const Icon(Icons.location_on, size: 12, color: SantuColors.blue),
                          const SizedBox(width: 2),
                          Text(c.village!, style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.w600, fontSize: 11)),
                          if (c.phone != null && c.phone!.isNotEmpty) const Text('  ·  ', style: TextStyle(color: SantuColors.textMuted, fontSize: 11)),
                        ],
                        if (c.phone != null && c.phone!.isNotEmpty) ...[
                          const Icon(Icons.phone, size: 11, color: SantuColors.textMuted),
                          const SizedBox(width: 2),
                          Text(c.phone!, style: const TextStyle(color: SantuColors.textMuted, fontSize: 11)),
                        ],
                        if ((c.village == null || c.village!.isEmpty) && (c.phone == null || c.phone!.isEmpty))
                          const Text('No phone/village', style: TextStyle(color: SantuColors.textFaint, fontSize: 10)),
                      ],
                    ),
                    onTap: () => _pickCustomer(c),
                  ),
                if (_custCtrl.text.trim().isNotEmpty)
                  ListTile(
                    dense: true,
                    leading: const CircleAvatar(
                      radius: 14,
                      backgroundColor: Color(0xFFDBEAFE),
                      child: Icon(Icons.person_add, size: 16, color: SantuColors.blue),
                    ),
                    title: Text(
                      '+ "${_custCtrl.text.trim()}" ko Naya Customer banayein',
                      style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.bold, fontSize: 13),
                    ),
                    subtitle: const Text('Tap karke Gaon aur Phone number darj karein', style: TextStyle(fontSize: 11)),
                    onTap: () => _openNewCustomerDialog(initialName: _custCtrl.text.trim()),
                  ),
              ],
            ),
          ),
        if (_selectedCustomer != null)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFBFDBFE)),
            ),
            child: Row(
              children: [
                const Icon(Icons.check_circle, size: 18, color: SantuColors.blue),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _selectedCustomer!.customerName,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1E3A8A)),
                      ),
                      const SizedBox(height: 2),
                      Wrap(
                        spacing: 8,
                        children: [
                          if (_selectedCustomer!.village != null && _selectedCustomer!.village!.isNotEmpty)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.location_on, size: 12, color: SantuColors.blue),
                                const SizedBox(width: 2),
                                Text(
                                  _selectedCustomer!.village!,
                                  style: const TextStyle(fontSize: 11, color: SantuColors.blue, fontWeight: FontWeight.w600),
                                ),
                              ],
                            )
                          else
                            InkWell(
                              onTap: () => _openEditCustomerVillageDialog(_selectedCustomer!),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.add_location_alt_outlined, size: 12, color: Colors.orange),
                                  SizedBox(width: 2),
                                  Text(
                                    '+ Gaon jodein',
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: Colors.orange,
                                      fontWeight: FontWeight.w600,
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          if (_selectedCustomer!.phone != null && _selectedCustomer!.phone!.isNotEmpty)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.phone, size: 12, color: SantuColors.textMuted),
                                const SizedBox(width: 2),
                                Text(_selectedCustomer!.phone!, style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                              ],
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 16, color: SantuColors.textMuted),
                  tooltip: 'Customer hatayein',
                  onPressed: () {
                    setState(() {
                      _selectedCustomer = null;
                      _bill.customer = null;
                      _bill.customerLabel = null;
                      _custCtrl.clear();
                    });
                    _persist();
                  },
                ),
              ],
            ),
          ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: SantuColors.card,
            border: Border.all(color: SantuColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              const Text('🧾', style: TextStyle(fontSize: 22)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total ₹ ${t.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    Text('Items: ${t.items.length}, Quantity: ${t.totalQty}', style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _paymentMode,
                decoration: const InputDecoration(labelText: 'Payment Mode'),
                items: [for (final m in _paymentModes) DropdownMenuItem(value: m, child: Text(m))],
                onChanged: (v) => setState(() => _paymentMode = v ?? 'Cash'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _receivedCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'Amount Received',
                  prefixText: '₹ ',
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.calculate_outlined, size: 20),
                    tooltip: 'Calculator',
                    onPressed: _showCalculator,
                  ),
                ),
              ),
            ),
          ],
        ),
        if (_bill.billDiscount > 0 || _bill.additionalCharges > 0 || _bill.redeemPoints > 0 || _bill.remarks != null || _bill.terms != null) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (_bill.billDiscount > 0) Chip(label: Text('Discount ₹${_bill.billDiscount.toStringAsFixed(2)}'), visualDensity: VisualDensity.compact),
            if (_bill.additionalCharges > 0) Chip(label: Text('+Charges ₹${_bill.additionalCharges.toStringAsFixed(2)}'), visualDensity: VisualDensity.compact),
            if (_bill.redeemPoints > 0) Chip(label: Text('Points -₹${_bill.redeemPoints.toStringAsFixed(2)}'), visualDensity: VisualDensity.compact),
            if (_bill.remarks != null) Chip(label: Text('Note: ${_bill.remarks}', overflow: TextOverflow.ellipsis), visualDensity: VisualDensity.compact),
            if (_bill.terms != null) Chip(label: Text('Terms set'), visualDensity: VisualDensity.compact),
          ]),
        ],
        const SizedBox(height: 6),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: _bill.items.isEmpty ? null : _showBreakup,
            icon: const Icon(Icons.receipt_long_outlined, size: 16),
            label: const Text('Full Breakup'),
          ),
        ),
        const SizedBox(height: 14),
        OutlinedButton(onPressed: _showMoreMenu, child: const Text('More  ▾')),
        const SizedBox(height: 8),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(backgroundColor: SantuColors.green, padding: const EdgeInsets.symmetric(vertical: 14)),
          onPressed: () => _save(print: true),
          icon: const Icon(Icons.print),
          label: const Text('Save & Print', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: OutlinedButton(onPressed: () => _save(), child: const Text('Save'))),
            const SizedBox(width: 6),
            Expanded(child: OutlinedButton(onPressed: () => _save(whatsapp: true), child: const Text('💬 WhatsApp', style: TextStyle(fontSize: 11)))),
            const SizedBox(width: 6),
            Expanded(child: OutlinedButton(onPressed: _shareWithOther, child: const Text('↗ Kisi aur ko', style: TextStyle(fontSize: 10)))),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _showOtherCreditPayments,
          icon: const Icon(Icons.account_balance_wallet_outlined, size: 16),
          label: const Text('Other/Credit Payments', style: TextStyle(fontSize: 12)),
        ),
      ],
    );
  }
}

class _ReceiptDialog extends StatefulWidget {
  final Invoice invoice;
  final bool forPrint;
  const _ReceiptDialog({required this.invoice, required this.forPrint});

  @override
  State<_ReceiptDialog> createState() => _ReceiptDialogState();
}

class _ReceiptDialogState extends State<_ReceiptDialog> {
  String? _printStatus;

  Invoice get invoice => widget.invoice;

  @override
  void initState() {
    super.initState();
    if (widget.forPrint) _print();
  }

  Future<void> _print() async {
    setState(() => _printStatus = 'Printing…');
    final error = await ThermalReceipt.printSalesBill(invoice);
    if (!mounted) return;
    setState(() => _printStatus = error ?? 'Printed ✓');
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.forPrint ? 'Bill saved — ${_printStatus ?? "printing…"}' : 'Bill saved'),
      content: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Bill No: ${invoice.billNo}', style: const TextStyle(fontWeight: FontWeight.bold)),
            Text('Date: ${invoice.postingDate}'),
            if (invoice.customerLabel != null) Text('Customer: ${invoice.customerLabel}'),
            const Divider(),
            for (final it in invoice.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(child: Text(it.itemName, style: const TextStyle(fontSize: 12))),
                    Text(it.lineTotal.toStringAsFixed(2), style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            const Divider(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Grand Total', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('₹${invoice.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            if (invoice.change > 0) Text('Change to Return: ₹${invoice.change.toStringAsFixed(2)}'),
            if (invoice.baaki > 0) Text('Baaki Amount: ₹${invoice.baaki.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red)),
          ],
        ),
      ),
      actions: [
        if (!widget.forPrint) TextButton.icon(onPressed: _print, icon: const Icon(Icons.print, size: 18), label: const Text('Print')),
        FilledButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
      ],
    );
  }
}

/// Billing counter's plain scratchpad calculator — basic +−×÷ only, no
/// memory, no link to the bill's own totals (those are computed by
/// Invoice.grandTotal, not by hand here).
class _CalculatorDialog extends StatefulWidget {
  const _CalculatorDialog();

  @override
  State<_CalculatorDialog> createState() => _CalculatorDialogState();
}

class _CalculatorDialogState extends State<_CalculatorDialog> {
  String _expr = '';
  String _result = '0';

  void _tap(String key) {
    setState(() {
      if (key == 'C') {
        _expr = '';
        _result = '0';
      } else if (key == '⌫') {
        if (_expr.isNotEmpty) _expr = _expr.substring(0, _expr.length - 1);
      } else if (key == '=') {
        _result = _evaluate(_expr);
      } else {
        _expr += key;
      }
    });
  }

  // Simple left-to-right evaluator (no operator precedence) — matches
  // what a cheap physical calculator does, which is the mental model a
  // shopkeeper already has from the desk calculator next to the till.
  String _evaluate(String expr) {
    if (expr.isEmpty) return '0';
    final tokens = <String>[];
    var num = '';
    for (final ch in expr.split('')) {
      if ('+-×÷'.contains(ch)) {
        if (num.isNotEmpty) {
          tokens.add(num);
          num = '';
        }
        tokens.add(ch);
      } else {
        num += ch;
      }
    }
    if (num.isNotEmpty) tokens.add(num);
    if (tokens.isEmpty || double.tryParse(tokens.first) == null) return 'Error';
    double acc = double.parse(tokens.first);
    for (int i = 1; i < tokens.length - 1; i += 2) {
      final op = tokens[i];
      final rhs = double.tryParse(tokens[i + 1]);
      if (rhs == null) return 'Error';
      switch (op) {
        case '+': acc += rhs; break;
        case '-': acc -= rhs; break;
        case '×': acc *= rhs; break;
        case '÷': acc = rhs == 0 ? double.nan : acc / rhs; break;
      }
    }
    if (acc.isNaN) return 'Error';
    return acc == acc.roundToDouble() ? acc.toInt().toString() : acc.toStringAsFixed(2);
  }

  Widget _key(String label, {Color? bg}) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: bg ?? SantuColors.card,
            foregroundColor: bg != null ? Colors.white : SantuColors.textDark,
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
          onPressed: () => _tap(label),
          child: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Calculator'),
      content: SizedBox(
        width: 260,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(_expr.isEmpty ? ' ' : _expr, style: const TextStyle(fontSize: 13, color: SantuColors.textMuted)),
                  Text(_result, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Row(children: [_key('7'), _key('8'), _key('9'), _key('÷', bg: SantuColors.blue)]),
            Row(children: [_key('4'), _key('5'), _key('6'), _key('×', bg: SantuColors.blue)]),
            Row(children: [_key('1'), _key('2'), _key('3'), _key('-', bg: SantuColors.blue)]),
            Row(children: [_key('0'), _key('.'), _key('C', bg: SantuColors.red), _key('+', bg: SantuColors.blue)]),
            Row(children: [_key('⌫'), _key('=', bg: SantuColors.green)]),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    );
  }
}
