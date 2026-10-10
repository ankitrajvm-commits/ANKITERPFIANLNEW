import 'package:flutter/material.dart';

import 'app_lock_settings_screen.dart';
import 'reports_screen.dart';
import 'shop_settings_screen.dart';
import 'theme.dart';

/// Top-bar ⋮ menu from santu_topbar.js: Privacy, Settings, Reports, Lock App.
class AppOverflowMenu {
  static void show(BuildContext context, {VoidCallback? onPrivacyToggle, bool privacyOn = false}) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(privacyOn ? Icons.visibility_off_outlined : Icons.visibility_outlined),
              title: Text(privacyOn ? 'Privacy band karein' : 'Privacy'),
              subtitle: const Text('Dashboard / dues / reports dhak jayenge — billing par kaam chalta rahega'),
              onTap: () {
                Navigator.pop(ctx);
                onPrivacyToggle?.call();
              },
            ),
            ListTile(
              leading: const Icon(Icons.settings_outlined),
              title: const Text('Settings'),
              subtitle: const Text('Shop profile, printer, app lock…'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const ShopSettingsScreen()));
              },
            ),
            ListTile(
              leading: const Icon(Icons.bar_chart_outlined),
              title: const Text('Reports'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen()));
              },
            ),
            ListTile(
              leading: const Icon(Icons.lock_outline),
              title: const Text('Lock App'),
              subtitle: const Text('PIN se app band — logout nahi'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const AppLockSettingsScreen()));
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Blur overlay when Privacy is on — exempt screens pass [exempt] = true.
class PrivacyOverlay extends StatelessWidget {
  final bool active;
  final bool exempt;
  final Widget child;

  const PrivacyOverlay({super.key, required this.active, required this.exempt, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        child,
        if (active && !exempt)
          Positioned.fill(
            child: AbsorbPointer(
              child: Container(
                color: Colors.white.withValues(alpha: 0.92),
                alignment: Alignment.center,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.visibility_off, size: 48, color: SantuColors.textMuted.withValues(alpha: 0.6)),
                    const SizedBox(height: 12),
                    const Text('Privacy mode', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 4),
                    const Text('Upar ⋮ se band karein', style: TextStyle(color: SantuColors.textMuted)),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
