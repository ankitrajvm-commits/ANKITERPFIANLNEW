import 'package:flutter/foundation.dart';

import 'models.dart';

/// Carries a prefilled bill from Estimate's "Convert to Bill" (or any future
/// "open this in Billing" action) across to the Billing tab. BillingScreen's
/// own State stays alive for the app's whole life (IndexedStack), so a
/// normal navigation argument can't reach it after the fact — this is the
/// same problem santu_billing.js solves with frappe.route_options, just
/// without a router to carry it. One pending value, consumed once.
class PrefillBus {
  PrefillBus._();
  static final ValueNotifier<Invoice?> pending = ValueNotifier(null);

  static void send(Invoice invoice) => pending.value = invoice;

  static Invoice? take() {
    final v = pending.value;
    pending.value = null;
    return v;
  }
}

/// Same idea as [PrefillBus], for opening a saved PurchaseInvoice in the
/// Purchase tab for editing — used by Customer Dues' "I owe suppliers" tab
/// when a bill is tapped in a supplier's transaction history.
class PurchasePrefillBus {
  PurchasePrefillBus._();
  static final ValueNotifier<PurchaseInvoice?> pending = ValueNotifier(null);

  static void send(PurchaseInvoice invoice) => pending.value = invoice;

  static PurchaseInvoice? take() {
    final v = pending.value;
    pending.value = null;
    return v;
  }
}
