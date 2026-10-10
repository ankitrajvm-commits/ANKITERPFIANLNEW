import 'package:shared_preferences/shared_preferences.dart';

/// Small persisted config that doesn't need a database table — shop
/// identity for the receipt header and which Bluetooth printer to use.
/// Mirrors the handful of fields print_service.py reads off "Santu POS
/// Settings" (company name, GSTIN, bill footer) and Printer Settings'
/// paired-device choice, without needing a server to hold them.
class AppSettings {
  AppSettings._();

  static const _kShopName = 'shop_name';
  static const _kGstin = 'gstin';
  static const _kBillFooter = 'bill_footer';
  static const _kWebsite = 'shop_website';
  static const _kAddressLine = 'shop_address_line';
  static const _kCity = 'shop_city';
  static const _kState = 'shop_state';
  static const _kPincode = 'shop_pincode';
  static const _kPhone = 'shop_phone';
  static const _kUpiId = 'shop_upi_id';
  static const _kLogoPath = 'shop_logo_path';
  static const _kPrinterMac = 'printer_mac';
  static const _kPrinterName = 'printer_name';
  static const _kPrinterConnection = 'printer_connection'; // 'bluetooth' or 'usb'
  static const _kPrinterUsbVendorId = 'printer_usb_vendor_id';
  static const _kPrinterUsbProductId = 'printer_usb_product_id';
  static const _kPrinterDensity = 'printer_density';
  static const _kAppLockPin = 'app_lock_pin';
  static const _kCostPricePin = 'cost_price_security_pin';
  static const _kShowLogoOnBill = 'show_logo_on_bill';
  static const _kShowLogoOnA4Bill = 'show_logo_on_a4_bill';
  static const _kThermalLogoWidth = 'thermal_logo_width';
  static const _kA4LogoWidth = 'a4_logo_width';
  static const _kPaperWidth = 'printer_paper_width'; // '80mm' or '58mm'
  static const _kAutoCut = 'printer_auto_cut'; // true (default)

  static Future<String> paperWidth() async => (await SharedPreferences.getInstance()).getString(_kPaperWidth) ?? '80mm';
  static Future<void> setPaperWidth(String v) async => (await SharedPreferences.getInstance()).setString(_kPaperWidth, v);

  static Future<bool> autoCut() async => (await SharedPreferences.getInstance()).getBool(_kAutoCut) ?? true;
  static Future<void> setAutoCut(bool v) async => (await SharedPreferences.getInstance()).setBool(_kAutoCut, v);

  static Future<bool> showLogoOnBill() async => (await SharedPreferences.getInstance()).getBool(_kShowLogoOnBill) ?? true;
  static Future<void> setShowLogoOnBill(bool v) async => (await SharedPreferences.getInstance()).setBool(_kShowLogoOnBill, v);

  static Future<bool> showLogoOnA4Bill() async => (await SharedPreferences.getInstance()).getBool(_kShowLogoOnA4Bill) ?? true;
  static Future<void> setShowLogoOnA4Bill(bool v) async => (await SharedPreferences.getInstance()).setBool(_kShowLogoOnA4Bill, v);

  static Future<double> thermalLogoWidth() async => (await SharedPreferences.getInstance()).getDouble(_kThermalLogoWidth) ?? 65.0;
  static Future<void> setThermalLogoWidth(double v) async => (await SharedPreferences.getInstance()).setDouble(_kThermalLogoWidth, v);

  static Future<double> a4LogoWidth() async => (await SharedPreferences.getInstance()).getDouble(_kA4LogoWidth) ?? 40.0;
  static Future<void> setA4LogoWidth(double v) async => (await SharedPreferences.getInstance()).setDouble(_kA4LogoWidth, v);

  static Future<String> shopName() async => (await SharedPreferences.getInstance()).getString(_kShopName) ?? 'Santu Hardware';
  static Future<String?> gstin() async => (await SharedPreferences.getInstance()).getString(_kGstin);
  static Future<String> billFooter() async => (await SharedPreferences.getInstance()).getString(_kBillFooter) ?? 'Thank you!';
  static Future<String?> website() async => (await SharedPreferences.getInstance()).getString(_kWebsite);
  static Future<String?> addressLine() async => (await SharedPreferences.getInstance()).getString(_kAddressLine);
  static Future<String?> city() async => (await SharedPreferences.getInstance()).getString(_kCity);
  static Future<String?> state() async => (await SharedPreferences.getInstance()).getString(_kState);
  static Future<String?> pincode() async => (await SharedPreferences.getInstance()).getString(_kPincode);
  static Future<String?> phone() async => (await SharedPreferences.getInstance()).getString(_kPhone);
  static Future<String?> upiId() async => (await SharedPreferences.getInstance()).getString(_kUpiId);

  /// Same one-line address the PC bill header prints, assembled the way the
  /// print format does it: street, then city, then "State Pincode".
  static Future<String> companyAddressLine() async {
    final parts = [
      (await addressLine())?.trim(),
      (await city())?.trim(),
      [((await state())?.trim()) ?? '', ((await pincode())?.trim()) ?? ''].where((s) => s.isNotEmpty).join(' '),
    ].where((s) => s != null && s.isNotEmpty).cast<String>();
    return parts.join(', ');
  }
  static Future<String?> logoPath() async => (await SharedPreferences.getInstance()).getString(_kLogoPath);
  static Future<String?> printerMac() async => (await SharedPreferences.getInstance()).getString(_kPrinterMac);
  static Future<String?> printerName() async => (await SharedPreferences.getInstance()).getString(_kPrinterName);
  static Future<int> printerDensity() async => (await SharedPreferences.getInstance()).getInt(_kPrinterDensity) ?? 3;

  /// 'usb' (default per hardware setup) or 'bluetooth'.
  static Future<String> printerConnection() async => (await SharedPreferences.getInstance()).getString(_kPrinterConnection) ?? 'usb';
  static Future<int?> printerUsbVendorId() async => (await SharedPreferences.getInstance()).getInt(_kPrinterUsbVendorId);
  static Future<int?> printerUsbProductId() async => (await SharedPreferences.getInstance()).getInt(_kPrinterUsbProductId);

  /// USB device ids churn on every unplug/replug (the OS hands out a fresh
  /// one each time), so what's actually saved for reconnecting later is the
  /// vendor+product id pair — stable for a given printer model — not the id.
  static Future<void> setUsbPrinter(int vendorId, int productId, String name) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kPrinterConnection, 'usb');
    await p.setInt(_kPrinterUsbVendorId, vendorId);
    await p.setInt(_kPrinterUsbProductId, productId);
    await p.setString(_kPrinterName, name);
  }

  /// "App khulte hi ye PIN maangega" — Utilities → Cost Price Lock's App
  /// Login PIN on the PC, scoped to what matters more on a phone (which
  /// gets lost/borrowed far more often than a shop's own PC): a lock
  /// screen on launch. Stored in plain SharedPreferences, same trust model
  /// as everything else in this local-only app — not meant to survive
  /// someone with adb access to the phone, only a casual look.
  static Future<String?> appLockPin() async => (await SharedPreferences.getInstance()).getString(_kAppLockPin);
  static Future<void> setAppLockPin(String? pin) async {
    final p = await SharedPreferences.getInstance();
    if (pin == null || pin.isEmpty) {
      await p.remove(_kAppLockPin);
    } else {
      await p.setString(_kAppLockPin, pin);
    }
  }

  /// Utilities → Cost Price Lock's "Security PIN" on the PC — gates just
  /// the cost-price column on the billing counter (separate from the App
  /// Login PIN, which gates the whole app). Null means no PIN set, so the
  /// eye toggle flips with no prompt.
  static Future<String?> costPricePin() async => (await SharedPreferences.getInstance()).getString(_kCostPricePin);
  static Future<void> setCostPricePin(String? pin) async {
    final p = await SharedPreferences.getInstance();
    if (pin == null || pin.isEmpty) {
      await p.remove(_kCostPricePin);
    } else {
      await p.setString(_kCostPricePin, pin);
    }
  }

  static Future<void> setShopName(String v) async => (await SharedPreferences.getInstance()).setString(_kShopName, v);
  static Future<void> setGstin(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kGstin);
    } else {
      await p.setString(_kGstin, v);
    }
  }

  static Future<void> setBillFooter(String v) async => (await SharedPreferences.getInstance()).setString(_kBillFooter, v);

  static Future<void> setWebsite(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kWebsite);
    } else {
      await p.setString(_kWebsite, v);
    }
  }

  static Future<void> setAddressLine(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kAddressLine);
    } else {
      await p.setString(_kAddressLine, v);
    }
  }

  static Future<void> setPhone(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kPhone);
    } else {
      await p.setString(_kPhone, v);
    }
  }

  static Future<void> setUpiId(String? v) async {
    final p = await SharedPreferences.getInstance();
    final clean = cleanUpiId(v);
    if (clean.isEmpty) {
      await p.remove(_kUpiId);
    } else {
      await p.setString(_kUpiId, clean);
    }
  }

  /// Port of api.py's clean_upi_id(): normalised UPI ID, or "" when it is
  /// not a valid one. A bad ID must not reach the printed QR — the customer
  /// would get "invalid VPA" standing at the counter.
  static String cleanUpiId(String? value) {
    final v = (value ?? '').replaceAll(RegExp(r'\s+'), '').toLowerCase();
    return RegExp(r'^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$').hasMatch(v) ? v : '';
  }

  static Future<void> setCity(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kCity);
    } else {
      await p.setString(_kCity, v);
    }
  }

  static Future<void> setState(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kState);
    } else {
      await p.setString(_kState, v);
    }
  }

  static Future<void> setPincode(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kPincode);
    } else {
      await p.setString(_kPincode, v);
    }
  }

  static Future<void> setLogoPath(String? v) async {
    final p = await SharedPreferences.getInstance();
    if (v == null || v.isEmpty) {
      await p.remove(_kLogoPath);
    } else {
      await p.setString(_kLogoPath, v);
    }
  }

  static Future<void> setPrinterDensity(int density) async {
    final p = await SharedPreferences.getInstance();
    await p.setInt(_kPrinterDensity, density.clamp(1, 5));
  }

  static String _canonicalLibrary(String library) {
    if (library == 'WhatsApp A4 Library' || library == 'WhatsApp Library' || library == 'A4 Library') {
      return 'WhatsApp Library';
    }
    return library;
  }

  static String _templateKey(String library, String docType) => 'tmpl_${_canonicalLibrary(library)}_$docType';

  static Future<String> defaultTemplate(String library, String docType) async {
    final p = await SharedPreferences.getInstance();
    final saved = p.getString(_templateKey(library, docType));
    if (saved != null && saved.isNotEmpty) return saved;
    // Default fallback
    if (_canonicalLibrary(library) == 'Thermal Invoice Library') return 'Standard Bill';
    return 'Standard A4';
  }

  static Future<void> setDefaultTemplate(String library, String docType, String templateName) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_templateKey(library, docType), templateName);
  }

  static Future<void> setPrinter(String mac, String name) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kPrinterConnection, 'bluetooth');
    await p.setString(_kPrinterMac, mac);
    await p.setString(_kPrinterName, name);
  }

  static const _kDashboardWidgets = 'dashboard_active_widgets';

  static Future<List<String>> dashboardWidgets() async {
    final p = await SharedPreferences.getInstance();
    return p.getStringList(_kDashboardWidgets) ?? [
      'Low Stocks Items',
      'Purchases',
      'Expenses',
      'Stock Value',
      'WhatsApp Smart Connect',
    ];
  }

  static Future<void> setDashboardWidgets(List<String> widgets) async {
    final p = await SharedPreferences.getInstance();
    await p.setStringList(_kDashboardWidgets, widgets);
  }

  static Future<void> clearPrinter() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kPrinterMac);
    await p.remove(_kPrinterName);
    await p.remove(_kPrinterConnection);
    await p.remove(_kPrinterUsbVendorId);
    await p.remove(_kPrinterUsbProductId);
  }
}

