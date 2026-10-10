import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'db.dart';
import 'theme.dart';

/// WhatsApp Transaction Message templates with token insertion chips
/// and transaction message send history.
class MessageTemplatesScreen extends StatefulWidget {
  const MessageTemplatesScreen({super.key});

  @override
  State<MessageTemplatesScreen> createState() => _MessageTemplatesScreenState();
}

class _MessageTemplatesScreenState extends State<MessageTemplatesScreen> with SingleTickerProviderStateMixin {
  late TabController _tab;
  Map<String, String> _templates = {};
  List<Map<String, Object?>> _history = [];
  bool _loading = true;

  static const List<({String token, String desc})> availableTokens = [
    (token: '{party}', desc: 'Customer / Supplier Name'),
    (token: '{doc_no}', desc: 'Document / Bill Number'),
    (token: '{amount}', desc: 'Total Amount (₹)'),
    (token: '{balance}', desc: 'Remaining Baaki / Balance'),
    (token: '{date}', desc: 'Posting Date (DD/MM/YYYY)'),
    (token: '{items_count}', desc: 'Total Number of Items'),
    (token: '{shop_name}', desc: 'Shop Name'),
  ];

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final t = await AppDb.instance.listMessageTemplates();
    final h = await AppDb.instance.messageHistory();
    setState(() {
      _templates = t;
      _history = h;
      _loading = false;
    });
  }

  Future<void> _editTemplate(String docType, String body) async {
    final ctrl = TextEditingController(text: body);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Row(
            children: [
              const Icon(Icons.chat, color: SantuColors.green, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text(docType, overflow: TextOverflow.ellipsis)),
            ],
          ),
          content: SizedBox(
            width: 340,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: ctrl,
                    maxLines: 4,
                    autofocus: true,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      hintText: 'Message template likhein...',
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text('Insert Tokens (Tap to insert):', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final tok in availableTokens)
                        ActionChip(
                          label: Text(tok.token, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
                          backgroundColor: SantuColors.blue.withValues(alpha: 0.1),
                          onPressed: () {
                            final current = ctrl.text;
                            final sel = ctrl.selection;
                            if (sel.isValid && sel.start >= 0) {
                              final updated = current.replaceRange(sel.start, sel.end, tok.token);
                              ctrl.text = updated;
                              ctrl.selection = TextSelection.collapsed(offset: sel.start + tok.token.length);
                            } else {
                              ctrl.text = '$current ${tok.token}';
                              ctrl.selection = TextSelection.collapsed(offset: ctrl.text.length);
                            }
                            setDialogState(() {});
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Token Legend:', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 2),
                        for (final tok in availableTokens)
                          Text('${tok.token} → ${tok.desc}', style: const TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save Template')),
          ],
        ),
      ),
    );
    if (saved == true) {
      await AppDb.instance.saveMessageTemplate(docType, ctrl.text.trim());
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WhatsApp & Messages'),
        bottom: TabBar(controller: _tab, tabs: const [Tab(text: 'TEMPLATES'), Tab(text: 'HISTORY')]),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : TabBarView(
              controller: _tab,
              children: [
                ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: SantuColors.amberBg, border: Border.all(color: SantuColors.amberBorder), borderRadius: BorderRadius.circular(8)),
                      child: const Text(
                        'Ye app seedha WhatsApp kholta hai, message tokens auto-fill karke — bhejna tumhe khud karna hoga WhatsApp ke andar.',
                        style: TextStyle(fontSize: 12, color: SantuColors.amber),
                      ),
                    ),
                    for (final entry in _templates.entries)
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
                        child: ListTile(
                          title: Text(entry.key, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text(entry.value, maxLines: 2, overflow: TextOverflow.ellipsis),
                          trailing: const Icon(Icons.edit, size: 18),
                          onTap: () => _editTemplate(entry.key, entry.value),
                        ),
                      ),
                  ],
                ),
                _history.isEmpty
                    ? const Center(child: Text('Abhi tak koi WhatsApp message nahi bheja gaya', style: TextStyle(color: SantuColors.textMuted)))
                    : ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _history.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (ctx, i) {
                          final h = _history[i];
                          final created = DateTime.tryParse(h['created_at'] as String? ?? '');
                          return ListTile(
                            title: Text('${h['doc_type']} ${h['doc_no'] ?? ''}'),
                            subtitle: Text('${h['party_label'] ?? '-'}${created != null ? ' · ${DateFormat('dd MMM, hh:mm a').format(created)}' : ''}'),
                            trailing: const Icon(Icons.check_circle, color: SantuColors.green, size: 18),
                          );
                        },
                      ),
              ],
            ),
    );
  }
}
