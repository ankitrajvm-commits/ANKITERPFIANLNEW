import 'package:flutter/material.dart';

import 'app_settings.dart';
import 'theme.dart';

/// Utilities → App Lock — set, change or remove the launch PIN. Mirrors
/// Cost Price Lock's "App Login PIN" section on the PC.
class AppLockSettingsScreen extends StatefulWidget {
  const AppLockSettingsScreen({super.key});

  @override
  State<AppLockSettingsScreen> createState() => _AppLockSettingsScreenState();
}

class _AppLockSettingsScreenState extends State<AppLockSettingsScreen> {
  bool _loading = true;
  bool _hasPin = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final pin = await AppSettings.appLockPin();
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
    final pin = await _askPin('App Lock PIN set karo');
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
    await AppSettings.setAppLockPin(pin);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('App Lock on ho gaya')));
  }

  Future<void> _removePin() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('App Lock hata dein?'),
        content: const Text('Phir app kholte hi PIN nahi maangega.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Hata Do')),
        ],
      ),
    );
    if (confirmed == true) {
      await AppSettings.setAppLockPin(null);
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('App Lock')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'App khulte hi ye PIN maangega, jab tak sahi PIN na daalo tab tak kuch nazar nahi aayega — phone kisi aur ke haath me chala jaaye to dukaan ka data surakshit rahega.',
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
                      Expanded(child: Text(_hasPin ? 'App Lock On hai' : 'App Lock Off hai', style: const TextStyle(fontWeight: FontWeight.w600))),
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
                    child: const Text('App Lock Hata Do'),
                  ),
                ],
              ],
            ),
    );
  }
}
