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

    // Execute all independent queries concurrently in parallel
    final results = await Future.wait([
      _safe(() => AppDb.instance.savedInvoicesForToday(today), <Invoice>[]),
      _safe(() => AppDb.instance.customerDues(), <MapEntry<Customer, double>>[]),
      _safe(() => AppSettings.dashboardWidgets(), _activeWidgets),
      _safe(() => AppDb.instance.totalPurchasesAmount(), 0.0),
      _safe(() => AppDb.instance.totalExpensesAmount(), 0.0),
      _safe(() => AppDb.instance.totalStockValueSale(), 0.0),
      _safe(() => AppDb.instance.stockSummaryCounts(), <String, int>{}),
    ]);

    final bills = results[0] as List<Invoice>;
    final dues = results[1] as List<MapEntry<Customer, double>>;
    final widgets = results[2] as List<String>;
    final purchases = results[3] as double;
    final expenses = results[4] as double;
    final stockVal = results[5] as double;
    final counts = results[6] as Map<String, int>;

    if (!mounted) return;
    setState(() {
      _todayBills = bills;
      _totalBaki = dues.fold(0.0, (s, e) => s + e.value);
      _baakiPartyCount = dues.length;

      _activeWidgets = widgets;
      _purchasesTotal = purchases;
      _expensesTotal = expenses;
      _stockValue = stockVal;
      _stockCounts = counts;

      // Render dashboard instantly!
      _loading = false;
    });

    // Run chart loading concurrently without blocking UI
    _loadChart();
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
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Santu Hardware', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        actions: [
          IconButton(
            icon: Icon(_privacyOn ? Icons.visibility_off : Icons.visibility, color: SantuColors.blue),
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
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  children: [
                    // Top Bar: Search Transactions & Quick Action Buttons
                    _topSearchBarAndActions(),
                    const SizedBox(height: 12),

                    // Total Receivable Card (Udhaar / Baaki)
                    _totalBaakiCard(),
                    const SizedBox(height: 14),

                    // Total Sale & Graph Card
                    _salesChartCard(),
                    const SizedBox(height: 16),

                    // Most Used Reports
                    _quickLinksRow(),
                    const SizedBox(height: 18),

                    // Customizable Widgets Header & Cards
                    _customizableWidgetsSection(),
                    const SizedBox(height: 18),

                    // Aaj ke Bills
                    _todayBillsSection(),
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
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(color: Color(0x08000000), blurRadius: 6, offset: Offset(0, 2)),
        ],
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
              filled: true,
              fillColor: const Color(0xFFF1F5F9),
              hintText: 'Search Transactions (bills, customers...)',
              hintStyle: const TextStyle(fontSize: 12.5, color: Color(0xFF64748B)),
              prefixIcon: const Icon(Icons.search_rounded, size: 20, color: Color(0xFF4F46E5)),
              suffixIcon: IconButton(
                icon: const Icon(Icons.mic_rounded, size: 19, color: Color(0xFF4F46E5)),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Voice search: Search Transactions')));
                },
              ),
              contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFF4F46E5), width: 1.5),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BillingScreen())),
                    borderRadius: BorderRadius.circular(11),
                    child: Ink(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF4F46E5), Color(0xFF2563EB)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(11),
                        boxShadow: const [
                          BoxShadow(color: Color(0x354F46E5), blurRadius: 6, offset: Offset(0, 3)),
                        ],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.point_of_sale_rounded, size: 18, color: Colors.white),
                          SizedBox(width: 6),
                          Text('+ Add Sale', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => Navigator.push(
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
                    borderRadius: BorderRadius.circular(11),
                    child: Ink(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF059669), Color(0xFF10B981)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(11),
                        boxShadow: const [
                          BoxShadow(color: Color(0x33059669), blurRadius: 6, offset: Offset(0, 3)),
                        ],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.inventory_2_rounded, size: 18, color: Colors.white),
                          SizedBox(width: 6),
                          Text('+ Stock In', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                        ],
                      ),
                    ),
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
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFFF1F2), Color(0xFFFFE4E6), Color(0xFFFFF7ED)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: const Color(0xFFFECDD3), width: 1.2),
          borderRadius: BorderRadius.circular(16),
          boxShadow: const [
            BoxShadow(color: Color(0x10E11D48), blurRadius: 8, offset: Offset(0, 3)),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFF43F5E), Color(0xFFE11D48)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(14),
                boxShadow: const [
                  BoxShadow(color: Color(0x3DF43F5E), blurRadius: 6, offset: Offset(0, 2)),
                ],
              ),
              child: const Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 24),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        'Total Receivable (Baaki)',
                        style: TextStyle(fontSize: 12, color: Color(0xFF9F1239), fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEE2E2),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFFFCA5A5), width: 0.8),
                        ),
                        child: const Text('Udhaar', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: Color(0xFFBE123C))),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '₹ ${_totalBaki.toStringAsFixed(1)}',
                    style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w900, color: Color(0xFF881337)),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(Icons.people_alt_rounded, size: 12, color: Color(0xFFBE123C)),
                      const SizedBox(width: 4),
                      Text('From $_baakiPartyCount Parties', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFFBE123C))),
                    ],
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.85),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFFECDD3)),
              ),
              child: const Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFFE11D48), size: 12),
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
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE0E7FF), width: 1.2),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(color: Color(0x0C2563EB), blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(7),
                decoration: BoxDecoration(
                  color: const Color(0xFFEEF2FF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.trending_up_rounded, color: Color(0xFF4F46E5), size: 18),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Total Sale', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Color(0xFF0F172A))),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
                ),
                child: DropdownButton<String>(
                  value: _range,
                  underline: const SizedBox.shrink(),
                  isDense: true,
                  icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Color(0xFF2563EB)),
                  items: _chartRanges.map((r) => DropdownMenuItem(value: r, child: Text(r, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8))))).toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _range = v);
                    _loadChart();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                '₹ ${_periodTotal.toStringAsFixed(1)}',
                style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
              const SizedBox(width: 8),
              if (_percentChange != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: up ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: up ? const Color(0xFF86EFAC) : const Color(0xFFFCA5A5), width: 0.8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded, size: 12, color: up ? const Color(0xFF15803D) : const Color(0xFFB91C1C)),
                      const SizedBox(width: 2),
                      Text('${_percentChange!.abs().toStringAsFixed(1)}%', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: up ? const Color(0xFF15803D) : const Color(0xFFB91C1C))),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 150,
            child: _chartValues.isEmpty
                ? const Center(child: Text('Koi data nahi mila', style: TextStyle(color: SantuColors.textMuted)))
                : LineChart(
                    LineChartData(
                      lineTouchData: const LineTouchData(
                        enabled: false,
                        handleBuiltInTouches: false,
                      ),
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
                              return Padding(padding: const EdgeInsets.only(top: 6), child: Text(_chartLabels[i], style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w500, color: Color(0xFF64748B))));
                            },
                          ),
                        ),
                      ),
                      lineBarsData: [
                        LineChartBarData(
                          spots: [for (var i = 0; i < _chartValues.length; i++) FlSpot(i.toDouble(), _chartValues[i])],
                          isCurved: true,
                          preventCurveOverShooting: true,
                          color: const Color(0xFF2563EB),
                          gradient: const LinearGradient(
                            colors: [Color(0xFF2563EB), Color(0xFF06B6D4), Color(0xFF10B981)],
                          ),
                          barWidth: 3,
                          dotData: const FlDotData(show: false),
                          belowBarData: BarAreaData(
                            show: true,
                            gradient: LinearGradient(
                              colors: [
                                const Color(0xFF2563EB).withValues(alpha: 0.22),
                                const Color(0xFF06B6D4).withValues(alpha: 0.05),
                                Colors.transparent,
                              ],
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
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(Icons.auto_awesome_rounded, size: 14, color: Color(0xFFD97706)),
                ),
                const SizedBox(width: 6),
                const Text('Most Used Reports', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Color(0xFF0F172A))),
              ],
            ),
            TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen())),
              child: const Text('View All', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF2563EB))),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            _quickReportTile(
              title: 'Sale Report',
              icon: Icons.bar_chart_rounded,
              gradient: const LinearGradient(colors: [Color(0xFFEEF2FF), Color(0xFFE0E7FF)]),
              borderColor: const Color(0xFFC7D2FE),
              iconColor: const Color(0xFF4F46E5),
              textColor: const Color(0xFF3730A3),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen())),
            ),
            const SizedBox(width: 8),
            _quickReportTile(
              title: 'All Trans.',
              icon: Icons.receipt_long_rounded,
              gradient: const LinearGradient(colors: [Color(0xFFECFDF5), Color(0xFFD1FAE5)]),
              borderColor: const Color(0xFFA7F3D0),
              iconColor: const Color(0xFF059669),
              textColor: const Color(0xFF065F46),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ViewInvoiceScreen())),
            ),
            const SizedBox(width: 8),
            _quickReportTile(
              title: 'Daybook',
              icon: Icons.menu_book_rounded,
              gradient: const LinearGradient(colors: [Color(0xFFFFFBEB), Color(0xFFFEF3C7)]),
              borderColor: const Color(0xFFFDE68A),
              iconColor: const Color(0xFFD97706),
              textColor: const Color(0xFF92400E),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen())),
            ),
            const SizedBox(width: 8),
            _quickReportTile(
              title: 'Printer',
              icon: Icons.print_rounded,
              gradient: const LinearGradient(colors: [Color(0xFFFAF5FF), Color(0xFFF3E8FF)]),
              borderColor: const Color(0xFFE9D5FF),
              iconColor: const Color(0xFF9333EA),
              textColor: const Color(0xFF6B21A8),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterSettingsScreen())),
            ),
          ],
        ),
      ],
    );
  }

  Widget _quickReportTile({
    required String title,
    required IconData icon,
    required LinearGradient gradient,
    required Color borderColor,
    required Color iconColor,
    required Color textColor,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Ink(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
            decoration: BoxDecoration(
              gradient: gradient,
              border: Border.all(color: borderColor, width: 1.2),
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(color: iconColor.withValues(alpha: 0.08), blurRadius: 4, offset: const Offset(0, 2)),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, color: iconColor, size: 22),
                const SizedBox(height: 6),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: textColor),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _customizableWidgetsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(
                color: const Color(0xFFEDE9FE),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Icon(Icons.widgets_rounded, size: 14, color: Color(0xFF7C3AED)),
            ),
            const SizedBox(width: 6),
            const Text('Quick Overview', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Color(0xFF0F172A))),
          ],
        ),
        const SizedBox(height: 10),

        if (_activeWidgets.contains('Low Stocks Items')) ...[
          _widgetCard(
            title: 'Low Stocks Items',
            subtitle: '${_stockCounts['low'] ?? 0} running low  ·  ${_stockCounts['critical'] ?? 0} critical',
            icon: Icons.warning_amber_rounded,
            gradient: const LinearGradient(colors: [Color(0xFFFFFBEB), Color(0xFFFEF3C7)]),
            borderColor: const Color(0xFFFDE68A),
            iconBgColor: const Color(0xFFFEF08A),
            iconColor: const Color(0xFFD97706),
            titleColor: const Color(0xFF92400E),
            subColor: const Color(0xFFB45309),
            badge: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xFFFEE2E2),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFFFCA5A5), width: 0.8),
              ),
              child: const Text('Check Stock', style: TextStyle(fontSize: 10.5, color: Color(0xFFDC2626), fontWeight: FontWeight.bold)),
            ),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LowStockScreen())),
          ),
          const SizedBox(height: 10),
        ],

        // Purchases widget
        if (_activeWidgets.contains('Purchases')) ...[
          _widgetCard(
            title: 'Purchases',
            subtitle: '₹ ${_purchasesTotal.toStringAsFixed(1)}',
            icon: Icons.shopping_bag_outlined,
            gradient: const LinearGradient(colors: [Color(0xFFF0FDF4), Color(0xFFDCFCE7)]),
            borderColor: const Color(0xFFBBF7D0),
            iconBgColor: const Color(0xFFBBF7D0),
            iconColor: const Color(0xFF16A34A),
            titleColor: const Color(0xFF166534),
            subColor: const Color(0xFF15803D),
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
          ),
          const SizedBox(height: 10),
        ],

        // Expenses widget
        if (_activeWidgets.contains('Expenses')) ...[
          _widgetCard(
            title: 'Expenses',
            subtitle: '₹ ${_expensesTotal.toStringAsFixed(1)}',
            icon: Icons.payments_outlined,
            gradient: const LinearGradient(colors: [Color(0xFFFAF5FF), Color(0xFFF3E8FF)]),
            borderColor: const Color(0xFFE9D5FF),
            iconBgColor: const Color(0xFFE9D5FF),
            iconColor: const Color(0xFF9333EA),
            titleColor: const Color(0xFF6B21A8),
            subColor: const Color(0xFF7E22CE),
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExpenseScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExpenseScreen())),
          ),
          const SizedBox(height: 10),
        ],

        // Stock Value widget
        if (_activeWidgets.contains('Stock Value')) ...[
          _widgetCard(
            title: 'Stock Value',
            subtitle: '₹ ${_stockValue.toStringAsFixed(2)}',
            icon: Icons.inventory_2_outlined,
            gradient: const LinearGradient(colors: [Color(0xFFF0FDFA), Color(0xFFCCFBF1)]),
            borderColor: const Color(0xFF99F6E4),
            iconBgColor: const Color(0xFF99F6E4),
            iconColor: const Color(0xFF0D9488),
            titleColor: const Color(0xFF115E59),
            subColor: const Color(0xFF0F766E),
            trailingIcon: Icons.add,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryScreen())),
          ),
          const SizedBox(height: 10),
        ],

        // WhatsApp Smart Connect widget
        if (_activeWidgets.contains('WhatsApp Smart Connect')) ...[
          _widgetCard(
            title: 'WhatsApp Smart Connect',
            subtitle: 'Connected with Parties',
            icon: Icons.chat_bubble_rounded,
            gradient: const LinearGradient(colors: [Color(0xFFF0FDF4), Color(0xFFDCFCE7)]),
            borderColor: const Color(0xFF86EFAC),
            iconBgColor: const Color(0xFF86EFAC),
            iconColor: const Color(0xFF16A34A),
            titleColor: const Color(0xFF14532D),
            subColor: const Color(0xFF15803D),
            trailingIcon: Icons.send_rounded,
            onAction: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageTemplatesScreen())),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageTemplatesScreen())),
          ),
          const SizedBox(height: 10),
        ],

        // Add Widget of Your Choice button
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: _openWidgetPicker,
            borderRadius: BorderRadius.circular(12),
            child: Ink(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFFEEF2FF), Color(0xFFF5F3FF)]),
                border: Border.all(color: const Color(0xFFC7D2FE), width: 1.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: const [
                  Text('+ Add Widget of Your Choice', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF4F46E5))),
                  Icon(Icons.dashboard_customize_rounded, size: 18, color: Color(0xFF4F46E5)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _widgetCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required LinearGradient gradient,
    required Color borderColor,
    required Color iconBgColor,
    required Color iconColor,
    required Color titleColor,
    required Color subColor,
    Widget? badge,
    IconData? trailingIcon,
    VoidCallback? onAction,
    VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            gradient: gradient,
            border: Border.all(color: borderColor, width: 1.2),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(color: iconColor.withValues(alpha: 0.06), blurRadius: 6, offset: const Offset(0, 2)),
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(9),
                decoration: BoxDecoration(
                  color: iconBgColor,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: iconColor, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(fontSize: 12, color: titleColor, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 3),
                    Text(subtitle, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: subColor)),
                  ],
                ),
              ),
              if (badge != null) badge,
              if (trailingIcon != null)
                IconButton(
                  icon: Icon(trailingIcon, size: 18, color: iconColor),
                  onPressed: onAction,
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white.withValues(alpha: 0.8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _todayBillsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDBEAFE),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(Icons.receipt_rounded, size: 14, color: Color(0xFF2563EB)),
                ),
                const SizedBox(width: 6),
                const Text('Aaj ke Bills', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Color(0xFF0F172A))),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFBFDBFE), width: 0.8),
              ),
              child: Text('${_todayBills.length} Bills Today', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8))),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_todayBills.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: const Color(0xFFE2E8F0)),
              borderRadius: BorderRadius.circular(12),
            ),
            alignment: Alignment.center,
            child: Column(
              children: const [
                Icon(Icons.receipt_long_outlined, size: 36, color: Color(0xFF94A3B8)),
                SizedBox(height: 8),
                Text('Aaj abhi tak koi bill nahi bana', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Color(0xFF64748B))),
              ],
            ),
          )
        else
          Column(
            children: [
              for (final b in _todayBills)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x06000000), blurRadius: 4, offset: Offset(0, 1)),
                    ],
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                    dense: true,
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SaleInvoicesScreen())),
                    leading: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Color(0xFF4F46E5), Color(0xFF2563EB)]),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.receipt_rounded, color: Colors.white, size: 18),
                    ),
                    title: Text(b.billNo ?? '-', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF0F172A))),
                    subtitle: Text(b.customerLabel ?? 'Walk-in', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('₹${b.grandTotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFF059669))),
                        const SizedBox(height: 2),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(3)),
                          child: const Text('Saved', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Color(0xFF15803D))),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
      ],
    );
  }
}
