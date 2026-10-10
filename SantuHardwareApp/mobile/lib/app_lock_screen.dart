import 'package:flutter/material.dart';

import 'app_settings.dart';
import 'theme.dart';

/// Shown once at launch, before anything else, when a PIN is set — mirrors
/// the PC's "App Login PIN": nothing is visible until the right PIN is
/// entered. Matches Cost Price Lock's framing of why this exists on a
/// shared shop device, equally true of a phone that gets handed around.
class AppLockScreen extends StatefulWidget {
  final VoidCallback onUnlocked;
  const AppLockScreen({super.key, required this.onUnlocked});

  @override
  State<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends State<AppLockScreen> {
  String _entered = '';
  String? _error;

  Future<void> _onDigit(String d) async {
    if (_entered.length >= 6) return;
    setState(() {
      _entered += d;
      _error = null;
    });
    if (_entered.length >= 4) {
      final pin = await AppSettings.appLockPin();
      if (pin != null && _entered == pin) {
        widget.onUnlocked();
      } else if (_entered.length == 6) {
        setState(() {
          _error = 'Galat PIN';
          _entered = '';
        });
      }
    }
  }

  void _onBackspace() {
    if (_entered.isEmpty) return;
    setState(() => _entered = _entered.substring(0, _entered.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SantuColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(),
            const Icon(Icons.lock_outline, size: 48, color: SantuColors.blue),
            const SizedBox(height: 16),
            const Text('Santu Hardware Locked', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('PIN daalo', style: TextStyle(color: SantuColors.textMuted)),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (int i = 0; i < 6; i++)
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i < _entered.length ? SantuColors.blue : Colors.transparent,
                      border: Border.all(color: SantuColors.blue, width: 1.5),
                    ),
                  ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: const TextStyle(color: SantuColors.red, fontWeight: FontWeight.w600)),
            ],
            const Spacer(),
            SizedBox(
              width: 280,
              child: GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (final d in ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
                    _KeyButton(label: d, onTap: () => _onDigit(d)),
                  const SizedBox.shrink(),
                  _KeyButton(label: '0', onTap: () => _onDigit('0')),
                  _KeyButton(icon: Icons.backspace_outlined, onTap: _onBackspace),
                ],
              ),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}

class _KeyButton extends StatelessWidget {
  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  const _KeyButton({this.label, this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Center(
          child: label != null
              ? Text(label!, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600))
              : Icon(icon, size: 22),
        ),
      ),
    );
  }
}
