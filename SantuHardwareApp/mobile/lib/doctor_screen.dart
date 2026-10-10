import 'package:flutter/material.dart';

import 'db.dart';
import 'theme.dart';

/// "Doctor Uncle" — same job as the web page: press one button, get a
/// plain-language reading of the data, not a technical panel. Checks run
/// against the local database (no server to check here); where a fix is
/// safe to apply automatically, there's exactly one button for it.
class DoctorScreen extends StatefulWidget {
  const DoctorScreen({super.key});

  @override
  State<DoctorScreen> createState() => _DoctorScreenState();
}

class _DoctorScreenState extends State<DoctorScreen> {
  bool _running = false;
  List<({bool ok, String message, Future<void> Function()? fix})>? _results;

  Future<void> _run() async {
    setState(() => _running = true);
    final results = await AppDb.instance.runDiagnostics();
    setState(() {
      _results = results;
      _running = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Doctor Uncle')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('"Kuch kaam nahi kar raha" ka ek hi jawab. Neeche button dabao, app khud check karega.', style: TextStyle(color: SantuColors.textMuted)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _running ? null : _run,
            icon: _running ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.health_and_safety_outlined),
            label: Text(_running ? 'Jaanch ho rahi hai…' : 'Jaanch karo'),
          ),
          const SizedBox(height: 20),
          if (_results != null)
            for (final r in _results!)
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: r.ok ? const Color(0xFFF0FDF4) : SantuColors.amberBg,
                  border: Border.all(color: r.ok ? const Color(0xFFBBF7D0) : SantuColors.amberBorder),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(r.ok ? Icons.check_circle : Icons.warning_amber_rounded, color: r.ok ? SantuColors.green : SantuColors.amber, size: 20),
                    const SizedBox(width: 10),
                    Expanded(child: Text(r.message)),
                    if (r.fix != null)
                      TextButton(
                        onPressed: () async {
                          await r.fix!();
                          _run();
                        },
                        child: const Text('Theek karo'),
                      ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
