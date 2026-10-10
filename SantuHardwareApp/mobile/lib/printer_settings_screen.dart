import 'dart:typed_data';

import 'package:another_flutter_usb_write/another_flutter_usb_write.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';

import 'app_settings.dart';
import 'theme.dart';

/// Utilities → Printer Settings: USB/Bluetooth printer selection, Print Density slider,
/// and Diagnostics panel.
class PrinterSettingsScreen extends StatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  State<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends State<PrinterSettingsScreen> {
  bool _loading = true;
  List<BluetoothInfo> _btDevices = [];
  List<UsbDevice> _usbDevices = [];
  String _connection = 'usb';
  String? _savedMac;
  String? _savedName;
  int? _savedUsbVendorId;
  int? _savedUsbProductId;
  int _density = 3;
  String _paperWidth = '80mm';
  bool _autoCut = true;
  String? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    await [Permission.bluetoothConnect, Permission.bluetoothScan, Permission.location].request();
    final btDevices = await PrintBluetoothThermal.pairedBluetooths;
    List<UsbDevice> usbDevices = [];
    try {
      usbDevices = await FlutterUsbWrite().listDevices();
    } catch (_) {
      // No USB device plugged in, or OTG not supported — leave list empty.
    }
    final connection = await AppSettings.printerConnection();
    final mac = await AppSettings.printerMac();
    final name = await AppSettings.printerName();
    final usbVendorId = await AppSettings.printerUsbVendorId();
    final usbProductId = await AppSettings.printerUsbProductId();
    final density = await AppSettings.printerDensity();
    final paperWidth = await AppSettings.paperWidth();
    final autoCut = await AppSettings.autoCut();

    setState(() {
      _btDevices = btDevices;
      _usbDevices = usbDevices;
      _connection = connection;
      _savedMac = mac;
      _savedName = name;
      _savedUsbVendorId = usbVendorId;
      _savedUsbProductId = usbProductId;
      _density = density;
      _paperWidth = paperWidth;
      _autoCut = autoCut;
      _loading = false;
    });
  }

  Future<void> _selectBluetooth(BluetoothInfo d) async {
    await AppSettings.setPrinter(d.macAdress, d.name);
    setState(() {
      _connection = 'bluetooth';
      _savedMac = d.macAdress;
      _savedName = d.name;
      _status = null;
    });
  }

  Future<void> _selectUsb(UsbDevice d) async {
    if (d.vid == null || d.pid == null) return;
    final name = d.productName?.trim().isNotEmpty == true ? d.productName!.trim() : 'USB Printer';
    await AppSettings.setUsbPrinter(d.vid!, d.pid!, name);
    setState(() {
      _connection = 'usb';
      _savedUsbVendorId = d.vid;
      _savedUsbProductId = d.pid;
      _savedName = name;
      _status = null;
    });
  }

  Future<void> _setDensity(int val) async {
    setState(() => _density = val);
    await AppSettings.setPrinterDensity(val);
  }

  Future<void> _setPaperWidth(String val) async {
    setState(() => _paperWidth = val);
    await AppSettings.setPaperWidth(val);
  }

  Future<void> _setAutoCut(bool val) async {
    setState(() => _autoCut = val);
    await AppSettings.setAutoCut(val);
  }

  Future<void> _testPrint() async {
    setState(() => _status = 'Printing…');
    final shopName = await AppSettings.shopName();
    final cols = _paperWidth == '58mm' ? 32 : 48;
    List<int> ascii(String s) => s.codeUnits.map((c) => c > 127 ? 0x3f : c).toList();
    final bytes = <int>[
      0x1b, 0x40, // init
      // ESC/POS density/heating tuning command: GS ( K (or ESC 7)
      0x1b, 0x37, 0x07, _density * 10, 0x02,
      0x1b, 0x61, 0x01, // center
      0x1b, 0x45, 0x01, // bold on
      ...ascii(shopName),
      0x0a,
      0x1b, 0x45, 0x00, // bold off
      ...ascii('Test Print - Density: $_density'),
      0x0a,
      ...ascii('Paper: $_paperWidth | Auto-Cut: ${_autoCut ? "ON" : "OFF"}'),
      0x0a,
      ...ascii('Status: OK (Ready to Print)'),
      0x0a,
      ...List<int>.generate(cols, (_) => 0x2d),
      0x0a,
      // Minimal feed (3 lines) so text clears the print head to the cutter blade
      0x0a,
      0x0a,
      0x0a,
      if (_autoCut) ...[
        0x1d, 0x56, 0x42, 0x00, // GS V B 0 (standard partial cut)
        0x1d, 0x56, 0x01,       // GS V 1 (universal cutter fallback)
      ],
    ];
    String? error;
    if (_connection == 'usb') {
      if (_savedUsbVendorId == null || _savedUsbProductId == null) {
        error = 'Pehle ek USB printer chuno.';
      } else {
        final usb = FlutterUsbWrite();
        try {
          await usb.open(vendorId: _savedUsbVendorId, productId: _savedUsbProductId);
          final ok = await usb.write(Uint8List.fromList(bytes));
          await usb.close();
          error = ok == true ? null : 'Print bhej nahi paye.';
        } catch (_) {
          error = 'USB printer se connect nahi ho paya — cable aur printer check karo.';
        }
      }
    } else {
      if (_savedMac == null) {
        error = 'Pehle ek printer chuno.';
      } else {
        final connected = await PrintBluetoothThermal.connect(macPrinterAddress: _savedMac!);
        if (!connected) {
          error = 'Connect nahi ho paya — printer ON hai aur paas hai, check karo.';
        } else {
          final ok = await PrintBluetoothThermal.writeBytes(bytes);
          error = ok ? null : 'Print bhej nahi paye.';
        }
      }
    }
    setState(() => _status = error ?? 'Test print bheja gaya.');
  }

  String _densityLabel(int val) {
    switch (val) {
      case 1:
        return '1 (Very Light)';
      case 2:
        return '2 (Light)';
      case 3:
        return '3 (Normal)';
      case 4:
        return '4 (Dark)';
      case 5:
        return '5 (Very Dark)';
      default:
        return '$val';
    }
  }

  @override
  Widget build(BuildContext context) {
    final connectedLabel = _connection == 'usb'
        ? (_savedUsbVendorId != null ? '${_savedName ?? "USB Printer"} (USB)' : null)
        : (_savedMac != null ? '${_savedName ?? _savedMac} (Bluetooth)' : null);

    return Scaffold(
      appBar: AppBar(title: const Text('Printer Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  // Diagnostics Panel
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: SantuColors.card,
                      border: Border.all(color: SantuColors.border),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              connectedLabel != null ? Icons.check_circle : Icons.warning_amber_rounded,
                              color: connectedLabel != null ? SantuColors.green : SantuColors.amber,
                              size: 20,
                            ),
                            const SizedBox(width: 8),
                            const Text('Printer Diagnostics', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _diagnosticRow('Connection Type', _connection.toUpperCase()),
                        _diagnosticRow('Configured Device', _savedName ?? 'None'),
                        _diagnosticRow(
                          'Device Identifier',
                          _connection == 'usb'
                              ? (_savedUsbVendorId != null ? 'VID: $_savedUsbVendorId / PID: $_savedUsbProductId' : 'None')
                              : (_savedMac ?? 'None'),
                        ),
                        _diagnosticRow('Paper Width', _paperWidth == '58mm' ? '58 mm (2-inch / 32 cols)' : '80 mm (3-inch / 48 cols)'),
                        _diagnosticRow('Auto-Cut Feature', _autoCut ? 'Enabled (Auto Cut on Finish)' : 'Disabled (Tear-off bar)'),
                        _diagnosticRow('Print Density', _densityLabel(_density)),
                        _diagnosticRow('Status', connectedLabel != null ? 'Configured & Ready' : 'Printer Not Set'),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Paper Size & Auto Cut Settings Card
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: SantuColors.card,
                      border: Border.all(color: SantuColors.border),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Paper Size & Auto-Cut (Cutter)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        const SizedBox(height: 4),
                        const Text('Jitna bada bill ho sirf utna hi paper nikal kar auto-cut hoga.', style: TextStyle(fontSize: 11.5, color: SantuColors.textMuted)),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  backgroundColor: _paperWidth == '80mm' ? SantuColors.blue.withValues(alpha: 0.1) : null,
                                  side: BorderSide(color: _paperWidth == '80mm' ? SantuColors.blue : SantuColors.border, width: _paperWidth == '80mm' ? 1.8 : 1),
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                ),
                                onPressed: () => _setPaperWidth('80mm'),
                                child: Column(
                                  children: [
                                    Text('80 mm (3 inch)', style: TextStyle(fontWeight: FontWeight.bold, color: _paperWidth == '80mm' ? SantuColors.blue : SantuColors.textDark, fontSize: 13)),
                                    Text('Standard POS (48 col)', style: TextStyle(fontSize: 10, color: _paperWidth == '80mm' ? SantuColors.blue : SantuColors.textMuted)),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  backgroundColor: _paperWidth == '58mm' ? SantuColors.blue.withValues(alpha: 0.1) : null,
                                  side: BorderSide(color: _paperWidth == '58mm' ? SantuColors.blue : SantuColors.border, width: _paperWidth == '58mm' ? 1.8 : 1),
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                ),
                                onPressed: () => _setPaperWidth('58mm'),
                                child: Column(
                                  children: [
                                    Text('58 mm (2 inch)', style: TextStyle(fontWeight: FontWeight.bold, color: _paperWidth == '58mm' ? SantuColors.blue : SantuColors.textDark, fontSize: 13)),
                                    Text('Compact Roll (32 col)', style: TextStyle(fontSize: 10, color: _paperWidth == '58mm' ? SantuColors.blue : SantuColors.textMuted)),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const Divider(height: 1),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Auto-Cut Paper', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold)),
                          subtitle: const Text('Print hone ke baad automatic cutter blade se kaat dega (GS V command)', style: TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                          value: _autoCut,
                          onChanged: _setAutoCut,
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Print Density Slider Card
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: SantuColors.card,
                      border: Border.all(color: SantuColors.border),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Print Density / Darkness', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            Text(_densityLabel(_density), style: const TextStyle(fontWeight: FontWeight.w600, color: SantuColors.blue)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        const Text('Thermal paper par print ki gehrayi control karein (1 = Light, 5 = Maximum dark).', style: TextStyle(fontSize: 11.5, color: SantuColors.textMuted)),
                        Slider(
                          value: _density.toDouble(),
                          min: 1,
                          max: 5,
                          divisions: 4,
                          label: _densityLabel(_density),
                          onChanged: (v) => _setDensity(v.round()),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),
                  const Text('USB Printer', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 4),
                  const Text('Printer ko USB-OTG cable se phone mein laga do, phir yahan se chuno.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                  const SizedBox(height: 10),
                  if (_usbDevices.isEmpty)
                    const Padding(padding: EdgeInsets.all(16), child: Text('Koi USB device nahi mila — cable laga ke "pull to refresh" karo', style: TextStyle(color: SantuColors.textMuted)))
                  else
                    Container(
                      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                      child: Column(
                        children: [
                          for (final d in _usbDevices)
                            RadioListTile<String>(
                              value: '${d.vid}:${d.pid}',
                              groupValue: _connection == 'usb' ? '$_savedUsbVendorId:$_savedUsbProductId' : null,
                              onChanged: (_) => _selectUsb(d),
                              title: Text(d.productName?.trim().isNotEmpty == true ? d.productName!.trim() : 'USB Device'),
                              subtitle: Text('${d.manufacturerName ?? ''} · vid:${d.vid} pid:${d.pid}', style: const TextStyle(fontSize: 11)),
                            ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 20),
                  const Text('Paired Bluetooth Printers', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 4),
                  const Text('Printer pehle Android ke apne Bluetooth settings se pair karo, phir yahan se chuno.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                  const SizedBox(height: 10),
                  if (_btDevices.isEmpty)
                    const Padding(padding: EdgeInsets.all(16), child: Text('Koi paired Bluetooth device nahi mila', style: TextStyle(color: SantuColors.textMuted)))
                  else
                    Container(
                      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                      child: Column(
                        children: [
                          for (final d in _btDevices)
                            RadioListTile<String>(
                              value: d.macAdress,
                              groupValue: _connection == 'bluetooth' ? _savedMac : null,
                              onChanged: (_) => _selectBluetooth(d),
                              title: Text(d.name),
                              subtitle: Text(d.macAdress, style: const TextStyle(fontSize: 11)),
                            ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 18),
                  FilledButton.icon(onPressed: _testPrint, icon: const Icon(Icons.receipt_long), label: const Text('Test Print with Density')),
                  if (_status != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_status!, style: const TextStyle(color: SantuColors.textMuted))),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _diagnosticRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: SantuColors.textMuted)),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
