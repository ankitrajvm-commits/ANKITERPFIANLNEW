import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import 'db.dart';
import 'shareable_file.dart';
import 'theme.dart';

/// "Sync" on the web app means a server-side push/pull plus scheduled
/// backups, run by a System Manager. This build has no server to sync
/// with — so rather than fake a sync that does nothing, this screen does
/// the part that's genuinely this user's: export everything to one file
/// they control (share it to Drive, email it to themselves, save it
/// anywhere), and restore from one later. That's what keeps the shop's
/// data safe without a server, and it's honest about not being automatic.
class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  bool _busy = false;
  String? _status;

  Future<void> _export() async {
    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      final data = await AppDb.instance.exportAll();
      final json = const JsonEncoder.withIndent('  ').convert(data);
      final stamp = DateFormat('yyyy-MM-dd_HHmm').format(DateTime.now());
      final file = await shareableFile('santu_hardware_backup_$stamp.json');
      await file.writeAsString(json);
      await Share.shareXFiles([XFile(file.path)], text: 'Santu Hardware backup — $stamp');
      setState(() => _status = 'Backup ban gaya aur share screen khul gayi.');
    } catch (e) {
      setState(() => _status = 'Backup fail ho gaya: $e');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _restore() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Restore se purana data mit jayega'),
        content: const Text('Backup file se restore karne par abhi ka saara data (items, bills, customers) us file ke data se replace ho jayega. Pakka restore karna hai?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: SantuColors.red), child: const Text('Haan, Restore karo')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      final picked = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['json']);
      if (picked == null || picked.files.single.path == null) {
        setState(() => _busy = false);
        return;
      }
      final file = File(picked.files.single.path!);
      final data = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      await AppDb.instance.importAll(data);
      setState(() => _status = 'Restore ho gaya — app ko restart karo taaki sab jagah naya data dikhe.');
    } catch (e) {
      setState(() => _status = 'Restore fail ho gaya: $e. File sahi backup hai na, check karo.');
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Backup & Restore')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: SantuColors.amberBg, border: Border.all(color: SantuColors.amberBorder), borderRadius: BorderRadius.circular(8)),
            child: const Text(
              'Ye app sirf isi phone pe data rakhta hai, koi server nahi hai. Backup lena khud karna padega — hafte mein ek baar bana ke Drive/email mein safe rakh lo.',
              style: TextStyle(fontSize: 12, color: SantuColors.amber),
            ),
          ),
          const SizedBox(height: 20),
          const Text('Backup banao', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 6),
          const Text('Poora data (items, bills, customers, sab kuch) ek file mein, jisse tum kahin bhi save/share kar sakte ho.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
          const SizedBox(height: 10),
          ElevatedButton.icon(onPressed: _busy ? null : _export, icon: const Icon(Icons.upload_file), label: const Text('Backup Banao & Share Karo')),
          const SizedBox(height: 24),
          const Text('Restore karo', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 6),
          const Text('Pehle se banayi hui backup file se data wapas laao. Abhi ka data replace ho jayega.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
          const SizedBox(height: 10),
          OutlinedButton.icon(onPressed: _busy ? null : _restore, icon: const Icon(Icons.download), label: const Text('File Se Restore Karo')),
          if (_busy) ...[const SizedBox(height: 16), const Center(child: CircularProgressIndicator())],
          if (_status != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
              child: Text(_status!),
            ),
          ],
        ],
      ),
    );
  }
}
