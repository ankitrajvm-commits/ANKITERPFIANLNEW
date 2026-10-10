import 'package:flutter/material.dart';

import 'app_settings.dart';
import 'theme.dart';

/// Utilities → Cost Price Lock's "Security PIN" section on the PC — a
/// separate PIN from App Lock, only gating the cost-price eye-toggle on
/// the billing counter so a cashier can't see purchase price without it.
class CostPriceLockScreen extends StatefulWidget {
  const CostPriceLockScreen({super.key});

  @override
  State<CostPriceLockScreen> createState() => _CostPriceLockScreenState();
}

class _CostPriceLockScreenState extends State<CostPriceLockScreen> {
  bool _loading = true;
  bool _hasPin = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final pin = await AppSettings.costPricePin();
    setState(() {
      _hasPin = pin != null;
      _loading = false;
    });
  }

  Future<String?> _askPin(String title, {String? subtitle}) async {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (subtitle != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(subtitle, style: const TextStyle(color: SantuColors.textMuted, fontSize: 12))),
            TextField(
              controller: ctrl,
              autofocus: true,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: '4–6 digit PIN'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('OK')),
        ],
      ),
    );
  }

  Future<void> _setPin() async {
    final pin = await _askPin('Cost Price Security PIN set karo');
    if (pin == null) return;
    if (pin.length < 4 || pin.length > 6 || int.tryParse(pin) == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('4 se 6 digit ka number hona chahiye')));
      return;
    }
    final confirm = await _askPin('PIN dobara daalo', subtitle: 'Confirm karne ke liye');
    if (confirm != pin) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('PIN match nahi hua')));
      return;
    }
    await AppSettings.setCostPricePin(pin);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cost Price Lock on ho gaya')));
  }

  Future<void> _removePin() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cost Price Lock hata dein?'),
        content: const Text('Phir billing counter par cost price bina PIN ke dikh jaayega.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Hata Do')),
        ],
      ),
    );
    if (confirmed == true) {
      await AppSettings.setCostPricePin(null);
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cost Price Lock')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Billing counter par cost price (khareed ka rate) ka eye-icon toggle PIN se gated rahega — bina PIN cashier purchase price nahi dekh payega. PIN set na karo to toggle bina rok-tok ke chal jaayega.',
                  style: TextStyle(fontSize: 13, color: SantuColors.textMuted),
                ),
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
                  child: Row(
                    children: [
                      Icon(_hasPin ? Icons.lock : Icons.lock_open, color: _hasPin ? SantuColors.green : SantuColors.textMuted),
                      const SizedBox(width: 10),
                      Expanded(child: Text(_hasPin ? 'Cost Price Lock On hai' : 'Cost Price Lock Off hai', style: const TextStyle(fontWeight: FontWeight.w600))),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(onPressed: _setPin, child: Text(_hasPin ? 'PIN Badlo' : 'PIN Set Karo')),
                if (_hasPin) ...[
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: _removePin,
                    style: OutlinedButton.styleFrom(foregroundColor: SantuColors.red, side: const BorderSide(color: SantuColors.red)),
                    child: const Text('Cost Price Lock Hata Do'),
                  ),
                ],
              ],
            ),
    );
  }
}
