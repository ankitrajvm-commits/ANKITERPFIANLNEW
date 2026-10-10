import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'app_overflow_menu.dart';
import 'app_settings.dart';
import 'billing_screen.dart';
import 'customer_dues_screen.dart';
import 'db.dart';
import 'expense_screen.dart';
import 'inventory_screen.dart';
import 'low_stock_screen.dart';
import 'message_templates_screen.dart';
import 'models.dart';
import 'printer_settings_screen.dart';
import 'purchase_screen.dart';
import 'quick_doc_screen.dart';
import 'reports_screen.dart';
import 'sale_invoices_screen.dart';
import 'theme.dart';
import 'view_invoice_screen.dart';

/// Full feature-parity dashboard mirroring santu_dashboard.js and Frame 000/115:
/// - Top header with "Search Transactions", "+ Add Sale", "+ Receive Stock", Privacy eye
/// - Total Receivable card (with party count and link to Customer Dues)
/// - Total Sale card (with trend %, period dropdown, and interactive line chart)
/// - Most Used Reports quick links row + "View All"
/// - Customizable Widgets (Frame 115):
///   1. Low Stocks Items (running low, critical, khatam counts)
///   2. Purchases (with + button)
///   3. Expenses (with + button)
///   4. Stock Value (with + button)
///   5. WhatsApp Smart Connect (with + button)
///   + "Add Widget of Your Choice" bottom selector to toggle widgets.
/// - Aaj ke Bills recent list.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

const _chartRanges = ['Today', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year'];

class _DashboardScreenState extends State<DashboardScreen> {
  bool _privacyOn = false;
  bool _loading = true;
  List<Invoice> _todayBills = [];
  List<Item> _lowStock = [];
  double _totalBaki = 0;
  int _baakiPartyCount = 0;

  // Customizable widget data (Frame 115)
  double _purchasesTotal = 0;
  double _expensesTotal = 0;
  double _stockValue = 0;
  Map<String, int> _stockCounts = {'low': 0, 'critical': 0, 'khatam': 0, 'total_items': 0, 'total_qty': 0};
  List<String> _activeWidgets = [
    'Low Stocks Items',
    'Purchases',
    'Expenses',
    'Stock Value',
    'WhatsApp Smart Connect',
  ];

  final _searchCtrl = TextEditingController();
  String _range = 'This Month';
  List<double> _chartValues = [];
  List<String> _chartLabels = [];
  double _periodTotal = 0;
  double? _percentChange;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  // Dashboard combines many independent DB summaries — one bad query
  // (schema drift, a stale migration) must not leave the whole Home tab
  // spinning forever, so each piece failing falls back to empty/zero
  // instead of aborting the rest.
  Future<void> _load() async {
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final bills = await _safe(() => AppDb.instance.savedInvoicesForToday(today), <Invoice>[]);
    final items = await _safe(() => AppDb.instance.allItems(), <Item>[]);
    final dues = await _safe(() => AppDb.instance.customerDues(), <MapEntry<Customer, double>>[]);

    final widgets = await _safe(() => AppSettings.dashboardWidgets(), _activeWidgets);
    final purchases = await _safe(() => AppDb.instance.totalPurchasesAmount(), 0.0);
    final expenses = await _safe(() => AppDb.instance.totalExpensesAmount(), 0.0);
    final stockVal = await _safe(() => AppDb.instance.totalStockValueSale(), 0.0);
    final counts = await _safe(() => AppDb.instance.stockSummaryCounts(), <String, int>{});

    await _loadChart();
    if (!mounted) return;
    setState(() {
      _todayBills = bills;
      _lowStock = items.where((i) => i.availableQty <= 5).toList();
      _totalBaki = dues.fold(0.0, (s, e) => s + e.value);
      _baakiPartyCount = dues.length;

      _activeWidgets = widgets;
      _purchasesTotal = purchases;
      _expensesTotal = expenses;
      _stockValue = stockVal;
      _stockCounts = counts;

      _loading = false;
    });
  }

  Future<T> _safe<T>(Future<T> Function() query, T fallback) async {
    try {
      return await query();
    } catch (e) {
      debugPrint('Dashboard summary failed, using fallback: $e');
      return fallback;
    }
  }

  (DateTime, DateTime) _rangeBounds(String range, DateTime now) {
    DateTime start;
    DateTime end = DateTime(now.year, now.month, now.day);
    switch (range) {
      case 'Today':
        start = end;
        break;
      case 'This Week':
        start = end.subtract(Duration(days: end.weekday - 1));
        break;
      case 'This Month':
        start = DateTime(now.year, now.month, 1);
        break;
      case 'Last Month':
        final lastMonth = DateTime(now.year, now.month - 1, 1);
        start = lastMonth;
        end = DateTime(now.year, now.month, 1).subtract(const Duration(days: 1));
        break;
      case 'This Quarter':
        final q = ((now.month - 1) ~/ 3) * 3 + 1;
        start = DateTime(now.year, q, 1);
        break;
      case 'This Year':
        start = DateTime(now.year, 1, 1);
        break;
      default:
        start = end.subtract(const Duration(days: 6));
    }
    return (start, end);
  }

  Future<void> _loadChart() async {
    final now = DateTime.now();
    final (start, end) = _rangeBounds(_range, now);
    final fmt = DateFormat('yyyy-MM-dd');
    final totals = await AppDb.instance.salesByDay(fmt.format(start), fmt.format(end));

    final days = end.difference(start).inDays + 1;
    final prevEnd = start.subtract(const Duration(days: 1));
    final prevStart = prevEnd.subtract(Duration(days: days - 1));
    final prevTotals = await AppDb.instance.salesByDay(fmt.format(prevStart), fmt.format(prevEnd));
    final prevSum = prevTotals.values.fold(0.0, (s, v) => s + v);

    final values = <double>[];
    final labels = <String>[];
    final labelFmt = days > 45 ? DateFormat('MMM') : DateFormat('d MMM');
    for (var i = 0; i < days; i++) {
      final d = start.add(Duration(days: i));
      values.add(totals[fmt.format(d)] ?? 0);
      labels.add(labelFmt.format(d));
    }
    final sum = values.fold(0.0, (s, v) => s + v);

    setState(() {
      _chartValues = values;
      _chartLabels = labels;
      _periodTotal = sum;
      _percentChange = prevSum > 0 ? ((sum - prevSum) / prevSum) * 100 : null;
    });
  }

  void _openWidgetPicker() {
    final allWidgets = [
      'Low Stocks Items',
      'Purchases',
      'Expenses',
      'Stock Value',
      'WhatsApp Smart Connect',
    ];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Add Widget of Your Choice', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    IconButton(icon: const Icon(Icons.close, size: 20), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const Text('Choose which widgets you want to see on your home screen', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                const Divider(height: 20),
                for (final w in allWidgets)
                  CheckboxListTile(
                    title: Text(w, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                    value: _activeWidgets.contains(w),
                    activeColor: SantuColors.blue,
                    onChanged: (val) {
                      setModalState(() {
                        if (val == true) {
                          if (!_activeWidgets.contains(w)) _activeWidgets.add(w);
                        } else {
                          _activeWidgets.remove(w);
                        }
                      });
                      setState(() {});
                      AppSettings.setDashboardWidgets(_activeWidgets);
                    },
                  ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Santu Hardware'),
        actions: [
          IconButton(
            icon: Icon(_privacyOn ? Icons.visibility_off : Icons.visibility),
            tooltip: 'Privacy Toggle',
            onPressed: () => setState(() => _privacyOn = !_privacyOn),
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            tooltip: 'More',
            onPressed: () => AppOverflowMenu.show(
              context,
              privacyOn: _privacyOn,
              onPrivacyToggle: () => setState(() => _privacyOn = !_privacyOn),
            ),
          ),
        ],
      ),
      body: PrivacyOverlay(
        active: _privacyOn,
        exempt: false,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    // Top Bar: Search Transactions & Quick Action Buttons (Frame 000)
                    _topSearchBarAndActions(),
                    const SizedBox(height: 12),

                    // Total Receivable Card
                    _totalBaakiCard(),
                    const SizedBox(height: 14),

                    // Total Sale & Graph Card
                    _salesChartCard(),
                    const SizedBox(height: 14),

                    // Most Used Reports (Frame 000)
                    _quickLinksRow(),
                    const SizedBox(height: 16),

                    // Frame 115 Customizable Widgets Header & Cards
                    _customizableWidgetsSection(),
                    const SizedBox(height: 16),

                    // Aaj ke Bills
                    const Text('Aaj ke Bills', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_todayBills.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                        alignment: Alignment.center,
                        child: const Text('Abhi tak koi bill nahi', style: TextStyle(color: SantuColors.textMuted)),
                      )
                    else
                      Container(
                        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                        child: Column(
                          children: [
                            for (final b in _todayBills)
                              ListTile(
                                dense: true,
                                title: Text(b.billNo ?? '-'),
                                subtitle: Text(b.customerLabel ?? 'Walk-in'),
                                trailing: Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SaleInvoicesScreen())),
                              ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _topSearchBarAndActions() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: SantuColors.card,
        border: Border.all(color: SantuColors.border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: const [BoxShadow(color: Color(0x06000000), blurRadius: 4, offset: Offset(0, 1))],
      ),
      child: Column(
        children: [
          TextField(
            controller: _searchCtrl,
            textInputAction: TextInputAction.search,
            onSubmitted: (q) {
              Navigator.push(context, MaterialPageRoute(builder: (_) => const SaleInvoicesScreen()));
            },
            decoration: InputDecoration(
              hintText: 'Search Transactions (bills, customers...)',
              hintStyle: const TextStyle(fontSize: 13, color: SantuColors.textMuted),
              prefixIcon: const Icon(Icons.search, size: 18, color: SantuColors.blue),
              suffixIcon: IconButton(
                icon: const Icon(Icons.mic, size: 18, color: SantuColors.textMuted),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Voice search: Search Transactions')));
                },
              ),
              contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              isDense: true,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BillingScreen())),
                  icon: const Icon(Icons.add_shopping_cart, size: 18),
                  label: const Text('+ Add Sale', style: TextStyle(fontWeight: FontWeight.bold)),
                  style: FilledButton.styleFrom(
                    backgroundColor: SantuColors.blue,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const QuickDocScreen(
                        kind: 'stock_entry',
                        title: 'Receive Stock',
                        partyKind: 'Supplier',
                        stockSign: 1,
                        docPrefix: 'GRN-',
                        actionLabel: 'Receive Stock',
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.inventory_2_outlined, size: 18),
                  label: const Text('+ Stock In', style: TextStyle(fontWeight: FontWeight.w600)),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _totalBaakiCard() {
    return InkWell(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerDuesScreen())),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: SantuColors.card,
          border: Border.all(color: SantuColors.border),
          borderRadius: BorderRadius.circular(12),
          boxShadow: const [BoxShadow(color: Color(0x06000000), blurRadius: 4, offset: Offset(0, 1))],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.account_balance_wallet_outlined, color: SantuColors.red, size: 24),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Total Receivable (Udhaar / Baaki)', style: TextStyle(fontSize: 12, color: SantuColors.textMuted, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 3),
                  Text('₹ ${_totalBaki.toStringAsFixed(1)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: SantuColors.textDark)),
                  const SizedBox(height: 2),
                  Text('From $_baakiPartyCount Parties', style: const TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(color: Color(0xFFF1F5F9), shape: BoxShape.circle),
              child: const Icon(Icons.arrow_forward_ios, color: SantuColors.textMuted, size: 14),
            ),
          ],
        ),
      ),
    );
  }

  Widget _salesChartCard() {
    final up = (_percentChange ?? 0) >= 0;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: SantuColors.card,
        border: Border.all(color: SantuColors.border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: const [BoxShadow(color: Color(0x06000000), blurRadius: 4, offset: Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Total Sale', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: SantuColors.textDark))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: DropdownButton<String>(
                  value: _range,
                  underline: const SizedBox.shrink(),
                  isDense: true,
                  items: _chartRanges.map((r) => DropdownMenuItem(value: r, child: Text(r, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)))).toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _range = v);
                    _loadChart();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('₹ ${_periodTotal.toStringAsFixed(1)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: SantuColors.textDark)),
              const SizedBox(width: 8),
              if (_percentChange != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: (up ? SantuColors.green : SantuColors.red).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(4)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(up ? Icons.arrow_upward : Icons.arrow_downward, size: 12, color: up ? SantuColors.green : SantuColors.red),
                      Text('${_percentChange!.abs().toStringAsFixed(1)}%', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: up ? SantuColors.green : SantuColors.red)),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 150,
            child: _chartValues.isEmpty
                ? const Center(child: Text('Koi data nahi', style: TextStyle(color: SantuColors.textMuted)))
                : LineChart(
                    LineChartData(
                      gridData: const FlGridData(show: false),
                      borderData: FlBorderData(show: false),
                      titlesData: FlTitlesData(
                        leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        bottomTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 20,
                            interval: (_chartLabels.length / 5).clamp(1, double.infinity).roundToDouble(),
                            getTitlesWidget: (value, meta) {
                              final i = value.toInt();
                              if (i < 0 || i >= _chartLabels.length) return const SizedBox.shrink();
                              return Padding(padding: const EdgeInsets.only(top: 6), child: Text(_chartLabels[i], style: const TextStyle(fontSize: 9, color: SantuColors.textMuted)));
                            },
                          ),
                        ),
                      ),
                      lineBarsData: [
                        LineChartBarData(
                          spots: [for (var i = 0; i < _chartValues.length; i++) FlSpot(i.toDouble(), _chartValues[i])],
                          isCurved: true,
                          preventCurveOverShooting: true,
                          color: SantuColors.green,
                          barWidth: 2.5,
                          dotData: const FlDotData(show: false),
                          belowBarData: BarAreaData(
                            show: true,
                            gradient: LinearGradient(
                              colors: [SantuColors.green.withValues(alpha: 0.22), SantuColors.green.withValues(alpha: 0.01)],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _quickLinksRow() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Most Used Reports', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen())),
              child: const Text('View All', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: SantuColors.blue)),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            _quickReportBtn('Sale Report', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen()))),
            const SizedBox(width: 6),
            _quickReportBtn('All Trans.', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ViewInvoiceScreen()))),
            const SizedBox(width: 6),
            _quickReportBtn('Daybook', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen()))),
            const SizedBox(width: 6),
            _quickReportBtn('Printer', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterSettingsScreen()))),
          ],
        ),
      ],
    );
  }

  Widget _quickReportBtn(String title, VoidCallback onTap) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
          decoration: BoxDecoration(
            color: SantuColors.card,
            border: Border.all(color: SantuColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
          ),
        ),
      ),
    );
  }

  Widget _customizableWidgetsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_activeWidgets.contains('Low Stocks Items')) ...[
          _widgetCard(
            title: 'Low Stocks Items',
            subtitle: '${_stockCounts['low'] ?? _lowStock.length} running low  ·  ${_stockCounts['critical'] ?? 0} critical',
            badge: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(4)),
              child: const Text('Added ✓', style: TextStyle(fontSize: 11, color: Color(0xFF15803D), fontWeight: FontWeight.w600)),
            ),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LowStockScreen())),
          ),
          const SizedBox(height: 8),
        ],

        // Purchases widget
        if (_activeWidgets.contains('Purchases')) ...[
          _widgetCard(
            title: 'Purchases',
            subtitle: '₹ ${_purchasesTotal.toStringAsFixed(1)}',
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
          ),
          const SizedBox(height: 8),
        ],

        // Expenses widget
        if (_activeWidgets.contains('Expenses')) ...[
          _widgetCard(
            title: 'Expenses',
            subtitle: '₹ ${_expensesTotal.toStringAsFixed(1)}',
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExpenseScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExpenseScreen())),
          ),
          const SizedBox(height: 8),
        ],

        // Stock Value widget
        if (_activeWidgets.contains('Stock Value')) ...[
          _widgetCard(
            title: 'Stock Value',
            subtitle: '₹ ${_stockValue.toStringAsFixed(2)}',
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryScreen())),
          ),
          const SizedBox(height: 8),
        ],

        // WhatsApp Smart Connect widget
        if (_activeWidgets.contains('WhatsApp Smart Connect')) ...[
          _widgetCard(
            title: 'WhatsApp Smart Connect',
            subtitle: 'Connected with Parties',
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageTemplatesScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageTemplatesScreen())),
          ),
          const SizedBox(height: 8),
        ],

        // Add Widget of Your Choice button
        InkWell(
          onTap: _openWidgetPicker,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
            decoration: BoxDecoration(
              color: SantuColors.card,
              border: Border.all(color: SantuColors.border),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: const [
                Text('+ Add Widget of Your Choice', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SantuColors.blue)),
                Icon(Icons.dashboard_customize_outlined, size: 18, color: SantuColors.blue),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _widgetCard({
    required String title,
    required String subtitle,
    Widget? badge,
    IconData? trailingIcon,
    VoidCallback? onAction,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: SantuColors.card,
          border: Border.all(color: SantuColors.border),
          borderRadius: BorderRadius.circular(10),
          boxShadow: const [BoxShadow(color: Color(0x04000000), blurRadius: 4, offset: Offset(0, 1))],
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 12, color: SantuColors.textMuted, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 3),
                  Text(subtitle, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SantuColors.textDark)),
                ],
              ),
            ),
            if (badge != null) badge,
            if (trailingIcon != null)
              IconButton(
                icon: Icon(trailingIcon, size: 18, color: SantuColors.blue),
                onPressed: onAction,
                style: IconButton.styleFrom(
                  backgroundColor: const Color(0xFFEFF6FF),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
