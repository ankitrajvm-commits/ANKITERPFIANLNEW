import 'package:flutter/material.dart';

import 'billing_screen.dart';
import 'dashboard_screen.dart';
import 'more_screen.dart';
import 'parties_screen.dart';
import 'prefill_bus.dart';
import 'purchase_screen.dart';
import 'quick_doc_screen.dart';
import 'theme.dart';

/// Bottom nav for the screens used every day; everything else (Inventory,
/// Expenses, and modules still to come) lives behind "More". Same split the
/// web app makes between its always-visible billing flow and its sidebar.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  // IndexedStack keeps every tab's State alive so an in-progress Billing or
  // Purchase draft survives switching away and back — that's wanted. But
  // the same thing meant Dashboard/Parties kept showing whatever they'd
  // last loaded even after a Recycle Bin restore or an edit changed the
  // data underneath them (found by testing a restore on-device, not by
  // reading the code). Bumping these two tabs' key on every reselect
  // forces Flutter to tear down and rebuild just that tab, re-running its
  // own initState load — Billing/Purchase, which never go stale the same
  // way, keep a fixed key and their state untouched.
  int _dashboardEpoch = 0;
  int _partiesEpoch = 0;

  @override
  void initState() {
    super.initState();
    // Estimate's "Convert to Bill" (and anything else that hands Billing a
    // ready-made draft) switches the bottom nav to Billing itself — Billing
    // consumes the same signal to actually add the tab, see billing_screen's
    // _onPrefill. Pop back to the shell first (Navigator.popUntil in the
    // caller) so this fires while HomeShell is the visible route.
    PrefillBus.pending.addListener(_onPrefillArrived);
    PurchasePrefillBus.pending.addListener(_onPurchasePrefillArrived);
  }

  @override
  void dispose() {
    PrefillBus.pending.removeListener(_onPrefillArrived);
    PurchasePrefillBus.pending.removeListener(_onPurchasePrefillArrived);
    super.dispose();
  }

  void _onPrefillArrived() {
    if (PrefillBus.pending.value != null && mounted) setState(() => _tab = 1);
  }

  void _onPurchasePrefillArrived() {
    if (PurchasePrefillBus.pending.value != null && mounted) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      DashboardScreen(key: ValueKey('dash_$_dashboardEpoch')),
      const BillingScreen(),
      const QuickDocScreen(kind: 'estimate', title: 'Estimate', partyKind: 'Customer', stockSign: 0, docPrefix: 'EST-', actionLabel: 'Save Estimate', canConvertToBill: true),
      PartiesScreen(key: ValueKey('parties_$_partiesEpoch')),
      const MoreScreen(),
    ];
    return Scaffold(
      resizeToAvoidBottomInset: false,
      body: IndexedStack(index: _tab, children: tabs),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: SantuColors.card,
          border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 0.8)),
        ),
        child: NavigationBar(
          height: 62,
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() {
            if (i == 0) _dashboardEpoch++;
            if (i == 3) _partiesEpoch++;
            _tab = i;
          }),
          backgroundColor: Colors.transparent,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.point_of_sale_outlined), selectedIcon: Icon(Icons.point_of_sale), label: 'Billing'),
            NavigationDestination(icon: Icon(Icons.description_outlined), selectedIcon: Icon(Icons.description), label: 'Estimate'),
            NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'Parties'),
            NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
          ],
        ),
      ),
    );
  }
}
