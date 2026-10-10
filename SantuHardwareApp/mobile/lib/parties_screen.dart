import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import 'db.dart';
import 'models.dart';
import 'party_statement_screen.dart';
import 'theme.dart';

/// Customer list + add/edit. Mirrors santu_parties.js's job (manage the
/// customer master) with full name, phone number, and village display.
class PartiesScreen extends StatefulWidget {
  const PartiesScreen({super.key});

  @override
  State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  final _uuid = const Uuid();
  List<Customer> _all = [];
  List<Customer> _shown = [];
  bool _loading = true;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final rows = await AppDb.instance.allCustomers();
    if (!mounted) return;
    setState(() {
      _all = rows;
      _filter(_searchCtrl.text);
      _loading = false;
    });
  }

  void _filter(String q) {
    final tokens = searchTokens(q);
    setState(() {
      _shown = tokens.isEmpty
          ? _all
          : _all
              .where((c) => matchesAllTokens(tokens, [c.customerName, c.phone, c.village]))
              .toList();
    });
  }

  Future<void> _delete(Customer c) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Customer delete karein?'),
        content: Text('${c.customerName} Recycle Bin mein chala jayega — wahan se wapas la sakte ho.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: SantuColors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await AppDb.instance.softDelete('customer', 'name', c.name);
      _load();
    }
  }

  Future<void> _openEditor({Customer? existing}) async {
    final nameCtrl = TextEditingController(text: existing?.customerName ?? '');
    final phoneCtrl = TextEditingController(text: existing?.phone ?? '');
    final villageCtrl = TextEditingController(text: existing?.village ?? '');

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'New Customer' : 'Edit Customer'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Name *',
                  hintText: 'Customer name',
                  prefixIcon: Icon(Icons.person_outline, size: 20),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone',
                  hintText: 'Mobile number',
                  prefixIcon: Icon(Icons.phone_outlined, size: 20),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: villageCtrl,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Village / Gaon',
                  hintText: 'e.g. Ishuwapur, Mahuli, Purshauli',
                  prefixIcon: Icon(Icons.location_on_outlined, size: 20, color: SantuColors.blue),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (saved == true && nameCtrl.text.trim().isNotEmpty) {
      final c = Customer(
        name: existing?.name ?? 'CUST-${_uuid.v4().substring(0, 8)}',
        customerName: nameCtrl.text.trim(),
        phone: phoneCtrl.text.trim().isEmpty ? null : phoneCtrl.text.trim(),
        village: villageCtrl.text.trim().isEmpty ? null : villageCtrl.text.trim(),
      );
      await AppDb.instance.upsertCustomers([c]);
      _load();
    }
  }

  Widget _buildSubtitle(Customer c) {
    final phone = c.phone?.trim();
    final village = c.village?.trim();

    if ((phone == null || phone.isEmpty) && (village == null || village.isEmpty)) {
      return const Text('No phone / village', style: TextStyle(color: SantuColors.textFaint, fontSize: 12));
    }

    return Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Row(
        children: [
          if (phone != null && phone.isNotEmpty) ...[
            const Icon(Icons.phone_outlined, size: 13, color: SantuColors.textMuted),
            const SizedBox(width: 3),
            Text(
              phone,
              style: const TextStyle(fontSize: 12.5, color: SantuColors.textMuted),
            ),
          ],
          if (phone != null && phone.isNotEmpty && village != null && village.isNotEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 6),
              child: Text('·', style: TextStyle(fontWeight: FontWeight.bold, color: SantuColors.textFaint)),
            ),
          if (village != null && village.isNotEmpty) ...[
            const Icon(Icons.location_on_outlined, size: 13, color: Color(0xFF2563EB)),
            const SizedBox(width: 2),
            Expanded(
              child: Text(
                village,
                style: const TextStyle(
                  fontSize: 12.5,
                  color: Color(0xFF1E40AF),
                  fontWeight: FontWeight.w600,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Parties')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(),
        icon: const Icon(Icons.add),
        label: const Text('New Customer'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: TextField(
                    controller: _searchCtrl,
                    onChanged: _filter,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: 'Search by name, phone or village',
                      suffixIcon: _searchCtrl.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchCtrl.clear();
                                _filter('');
                              },
                            )
                          : null,
                    ),
                  ),
                ),
                Expanded(
                  child: _shown.isEmpty
                      ? const Center(
                          child: Text(
                            'Koi customer nahi mila',
                            style: TextStyle(color: SantuColors.textMuted),
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _shown.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final c = _shown[i];
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: SantuColors.blue.withValues(alpha: 0.12),
                                child: Text(
                                  c.customerName.isNotEmpty ? c.customerName[0].toUpperCase() : '?',
                                  style: const TextStyle(color: SantuColors.blue, fontWeight: FontWeight.bold),
                                ),
                              ),
                              title: Text(
                                c.customerName,
                                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5),
                              ),
                              subtitle: _buildSubtitle(c),
                              // The PC's party row opens a detail panel whose
                              // main content IS the running account — tapping
                              // here goes straight to the same thing (Edit /
                              // Delete move to the ⋮ menu instead of owning
                              // the tap).
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => PartyStatementScreen(partyType: 'Customer', partyId: c.name, partyLabel: c.customerName),
                                ),
                              ),
                              trailing: PopupMenuButton<String>(
                                icon: const Icon(Icons.more_vert, size: 20),
                                onSelected: (val) {
                                  if (val == 'edit') {
                                    _openEditor(existing: c);
                                  } else if (val == 'statement') {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => PartyStatementScreen(partyType: 'Customer', partyId: c.name, partyLabel: c.customerName),
                                      ),
                                    );
                                  } else if (val == 'delete') {
                                    _delete(c);
                                  }
                                },
                                itemBuilder: (ctx) => const [
                                  PopupMenuItem(
                                    value: 'statement',
                                    child: Row(
                                      children: [
                                        Icon(Icons.receipt_long_outlined, size: 18),
                                        SizedBox(width: 8),
                                        Text('Account Statement'),
                                      ],
                                    ),
                                  ),
                                  PopupMenuItem(
                                    value: 'edit',
                                    child: Row(
                                      children: [
                                        Icon(Icons.edit_outlined, size: 18),
                                        SizedBox(width: 8),
                                        Text('Edit Details'),
                                      ],
                                    ),
                                  ),
                                  PopupMenuItem(
                                    value: 'delete',
                                    child: Row(
                                      children: [
                                        Icon(Icons.delete_outline, size: 18, color: SantuColors.red),
                                        SizedBox(width: 8),
                                        Text('Delete Party', style: TextStyle(color: SantuColors.red)),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
