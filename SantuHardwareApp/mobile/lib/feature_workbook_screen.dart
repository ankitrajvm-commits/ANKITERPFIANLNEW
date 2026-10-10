import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'db.dart';
import 'theme.dart';

/// Utilities > Feature Workbook
/// Direct high-fidelity port of PC ERPNext's Santu Feature Workbook
/// (page/santu_feature_workbook/santu_feature_workbook.js & .css).
/// Provides complete feature documentation, module grouping, status/module filtering,
/// full 7-section breakdown (including QA/Testing and Impact Analysis),
/// and full Add/Edit/Delete capabilities.

const List<String> kWorkbookModules = [
  'Sales',
  'Returns',
  'Inventory',
  'Customers',
  'Printing & Documents',
  'WhatsApp',
  'Estimates',
  'Reports',
  'Settings',
  'Other',
];

const List<String> kWorkbookStatuses = [
  '✅ Working',
  '⚠️ Partial',
  '❌ Missing',
  '🐞 Bug/Issue',
  '🔧 Needs Improvement',
  '🚀 Future Enhancement',
];

const List<String> kWorkbookPriorities = [
  'High',
  'Medium',
  'Low',
];

Color statusColor(String? status) {
  if (status == null) return const Color(0xFF94A3B8);
  if (status.contains('Working')) return const Color(0xFF10B981); // Emerald
  if (status.contains('Partial')) return const Color(0xFFF59E0B); // Amber
  if (status.contains('Missing') || status.contains('Bug')) return const Color(0xFFEF4444); // Crimson
  if (status.contains('Needs Improvement')) return const Color(0xFF3B82F6); // Blue
  if (status.contains('Future Enhancement')) return const Color(0xFF8B5CF6); // Purple
  return const Color(0xFF64748B);
}

class FeatureWorkbookScreen extends StatefulWidget {
  const FeatureWorkbookScreen({super.key});

  @override
  State<FeatureWorkbookScreen> createState() => _FeatureWorkbookScreenState();
}

class _FeatureWorkbookScreenState extends State<FeatureWorkbookScreen> {
  bool _loading = true;
  List<Map<String, Object?>> _allFeatures = [];
  List<Map<String, Object?>> _filteredFeatures = [];
  Map<String, Object?>? _selectedFeature;

  final TextEditingController _searchCtrl = TextEditingController();
  String _selectedModule = '';
  String _selectedStatus = '';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    final rows = await AppDb.instance.listFeatureDocs();
    if (!mounted) return;
    setState(() {
      _allFeatures = rows;
      _applyFilters();
      if (_allFeatures.isNotEmpty && _selectedFeature == null) {
        _selectedFeature = _allFeatures.first;
      } else if (_selectedFeature != null) {
        // refresh selected feature instance
        final found = _allFeatures.where((r) => r['feature_name'] == _selectedFeature!['feature_name']);
        _selectedFeature = found.isNotEmpty ? found.first : (_allFeatures.isNotEmpty ? _allFeatures.first : null);
      }
      _loading = false;
    });
  }

  void _applyFilters() {
    final query = _searchCtrl.text.trim().toLowerCase();
    setState(() {
      _filteredFeatures = _allFeatures.where((doc) {
        final name = (doc['feature_name'] as String? ?? '').toLowerCase();
        final module = (doc['module_name'] as String? ?? '').toLowerCase();
        final desc = (doc['description'] as String? ?? '').toLowerCase();
        final what = (doc['what_it_does'] as String? ?? '').toLowerCase();

        final matchesSearch = query.isEmpty ||
            name.contains(query) ||
            module.contains(query) ||
            desc.contains(query) ||
            what.contains(query);

        final matchesModule = _selectedModule.isEmpty || doc['module_name'] == _selectedModule;
        final matchesStatus = _selectedStatus.isEmpty || doc['status'] == _selectedStatus;

        return matchesSearch && matchesModule && matchesStatus;
      }).toList();
    });
  }

  Map<String, List<Map<String, Object?>>> _groupFeaturesByModule() {
    final grouped = <String, List<Map<String, Object?>>>{};
    for (final f in _filteredFeatures) {
      final mod = (f['module_name'] as String?)?.trim();
      final key = (mod == null || mod.isEmpty) ? 'Other' : mod;
      grouped.putIfAbsent(key, () => []).add(f);
    }
    return grouped;
  }

  Future<void> _openAddFeature() async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => const FeatureDocEditScreen(),
      ),
    );
    if (result == true) {
      await _loadData();
    }
  }

  Future<void> _openEditFeature(Map<String, Object?> doc) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => FeatureDocEditScreen(initialDoc: doc),
      ),
    );
    if (result == true) {
      await _loadData();
    }
  }

  Future<void> _resetToDefaults() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset to PC Backlog Defaults?'),
        content: const Text(
          'This will re-import the original 22 system feature documents bundled from the PC app.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reset')),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      final raw = await rootBundle.loadString('assets/feature_workbook.json');
      final rows = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
      await AppDb.instance.upsertFeatureDocs(rows.map((r) => r.cast<String, Object?>()).toList());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Feature Workbook re-synced from defaults!')),
        );
      }
      await _loadData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to reset: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWideScreen = constraints.maxWidth >= 780;

        return Scaffold(
          backgroundColor: SantuColors.bg,
          appBar: AppBar(
            elevation: 0,
            backgroundColor: SantuColors.card,
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Feature Workbook',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                ),
                Text(
                  '${_filteredFeatures.length} of ${_allFeatures.length} features',
                  style: const TextStyle(fontSize: 12, color: SantuColors.textMuted),
                ),
              ],
            ),
            actions: [
              FilledButton.icon(
                onPressed: _openAddFeature,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add Feature'),
                style: FilledButton.styleFrom(
                  backgroundColor: SantuColors.blue,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert),
                onSelected: (val) {
                  if (val == 'reset') _resetToDefaults();
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(
                    value: 'reset',
                    child: Row(
                      children: [
                        Icon(Icons.refresh, size: 18, color: SantuColors.textMuted),
                        SizedBox(width: 8),
                        Text('Reset to PC Defaults'),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : isWideScreen
                  ? _buildWideLayout()
                  : _buildMobileLayout(),
        );
      },
    );
  }

  Widget _buildSearchAndFilters() {
    return Container(
      color: SantuColors.card,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Search Input
          TextField(
            controller: _searchCtrl,
            onChanged: (_) => _applyFilters(),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search features...',
              hintStyle: const TextStyle(fontSize: 14, color: SantuColors.textFaint),
              prefixIcon: const Icon(Icons.search, size: 20, color: SantuColors.textMuted),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 18),
                      onPressed: () {
                        _searchCtrl.clear();
                        _applyFilters();
                      },
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
          const SizedBox(height: 10),
          // Filter Row
          Row(
            children: [
              // Module Dropdown
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    border: Border.all(color: SantuColors.border),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      value: _selectedModule.isEmpty ? null : _selectedModule,
                      hint: const Text('All Modules', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                      icon: const Icon(Icons.keyboard_arrow_down, size: 18, color: SantuColors.textMuted),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text('All Modules', style: TextStyle(fontSize: 12)),
                        ),
                        ...kWorkbookModules.map(
                          (m) => DropdownMenuItem(
                            value: m,
                            child: Text(m, style: const TextStyle(fontSize: 12)),
                          ),
                        ),
                      ],
                      onChanged: (val) {
                        setState(() => _selectedModule = val ?? '');
                        _applyFilters();
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Status Dropdown
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    border: Border.all(color: SantuColors.border),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      value: _selectedStatus.isEmpty ? null : _selectedStatus,
                      hint: const Text('All Statuses', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                      icon: const Icon(Icons.keyboard_arrow_down, size: 18, color: SantuColors.textMuted),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text('All Statuses', style: TextStyle(fontSize: 12)),
                        ),
                        ...kWorkbookStatuses.map(
                          (s) => DropdownMenuItem(
                            value: s,
                            child: Text(s, style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
                          ),
                        ),
                      ],
                      onChanged: (val) {
                        setState(() => _selectedStatus = val ?? '');
                        _applyFilters();
                      },
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFeatureList({bool isMasterDetail = false}) {
    if (_filteredFeatures.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('📖', style: TextStyle(fontSize: 40)),
              const SizedBox(height: 12),
              const Text(
                'No features found',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: SantuColors.textDark),
              ),
              const SizedBox(height: 4),
              const Text(
                'Try adjusting search or filters.',
                style: TextStyle(fontSize: 13, color: SantuColors.textMuted),
              ),
              if (_searchCtrl.text.isNotEmpty || _selectedModule.isNotEmpty || _selectedStatus.isNotEmpty) ...[
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () {
                    _searchCtrl.clear();
                    _selectedModule = '';
                    _selectedStatus = '';
                    _applyFilters();
                  },
                  child: const Text('Clear Filters'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    final grouped = _groupFeaturesByModule();

    return ListView.builder(
      itemCount: grouped.keys.length,
      itemBuilder: (ctx, idx) {
        final module = grouped.keys.elementAt(idx);
        final list = grouped[module]!;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Module Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
              child: Text(
                module.toUpperCase(),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  color: Color(0xFF64748B),
                ),
              ),
            ),
            // Items
            ...list.map((doc) {
              final isSelected = isMasterDetail && _selectedFeature?['feature_name'] == doc['feature_name'];
              final status = doc['status'] as String?;
              final color = statusColor(status);
              final priority = doc['priority'] as String?;

              return Container(
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFFEFF6FF) : SantuColors.card,
                  border: Border(
                    left: BorderSide(
                      color: isSelected ? SantuColors.blue : Colors.transparent,
                      width: 3.5,
                    ),
                    bottom: const BorderSide(color: Color(0xFFF1F5F9), width: 1),
                  ),
                ),
                child: ListTile(
                  dense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                  title: Text(
                    doc['feature_name'] as String? ?? '-',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? const Color(0xFF1E40AF) : const Color(0xFF334155),
                    ),
                  ),
                  subtitle: priority != null && priority.isNotEmpty
                      ? Text(
                          '$priority Priority',
                          style: const TextStyle(fontSize: 11, color: SantuColors.textMuted),
                        )
                      : null,
                  trailing: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                  ),
                  onTap: () {
                    if (isMasterDetail) {
                      setState(() => _selectedFeature = doc);
                    } else {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => FeatureDocDetailScreen(
                            feature: doc,
                            onEdit: () => _openEditFeature(doc),
                            onDelete: () async {
                              final name = doc['feature_name'] as String;
                              await AppDb.instance.deleteFeatureDoc(name);
                              await _loadData();
                              if (ctx.mounted) Navigator.pop(ctx);
                            },
                          ),
                        ),
                      );
                    }
                  },
                ),
              );
            }),
          ],
        );
      },
    );
  }

  Widget _buildWideLayout() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Left Sidebar (like PC .santu-fw-sidebar)
        SizedBox(
          width: 320,
          child: Column(
            children: [
              _buildSearchAndFilters(),
              const Divider(height: 1, color: SantuColors.border),
              Expanded(child: _buildFeatureList(isMasterDetail: true)),
            ],
          ),
        ),
        const VerticalDivider(width: 1, color: SantuColors.border),
        // Right Detail Pane (like PC .santu-fw-content)
        Expanded(
          child: _selectedFeature == null
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('📖', style: TextStyle(fontSize: 48)),
                      SizedBox(height: 12),
                      Text(
                        'Select a feature to view details',
                        style: TextStyle(color: SantuColors.textMuted, fontSize: 15),
                      ),
                    ],
                  ),
                )
              : FeatureDocDetailBody(
                  feature: _selectedFeature!,
                  onEdit: () => _openEditFeature(_selectedFeature!),
                  onDelete: () async {
                    final name = _selectedFeature!['feature_name'] as String;
                    await AppDb.instance.deleteFeatureDoc(name);
                    await _loadData();
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildMobileLayout() {
    return Column(
      children: [
        _buildSearchAndFilters(),
        const Divider(height: 1, color: SantuColors.border),
        Expanded(child: _buildFeatureList(isMasterDetail: false)),
      ],
    );
  }
}

/// Standalone Full-screen view for Mobile navigation
class FeatureDocDetailScreen extends StatelessWidget {
  final Map<String, Object?> feature;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const FeatureDocDetailScreen({
    super.key,
    required this.feature,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SantuColors.bg,
      appBar: AppBar(
        title: Text(
          feature['feature_name'] as String? ?? 'Feature Detail',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined, color: SantuColors.blue),
            tooltip: 'Edit Document',
            onPressed: () {
              Navigator.pop(context);
              onEdit();
            },
          ),
        ],
      ),
      body: FeatureDocDetailBody(
        feature: feature,
        onEdit: () {
          Navigator.pop(context);
          onEdit();
        },
        onDelete: onDelete,
      ),
    );
  }
}

/// Detail Content View (shared across wide split pane and mobile full screen)
class FeatureDocDetailBody extends StatelessWidget {
  final Map<String, Object?> feature;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const FeatureDocDetailBody({
    super.key,
    required this.feature,
    required this.onEdit,
    required this.onDelete,
  });

  Widget _buildBadge(String text, {Color? bg, Color? textCol, Widget? prefix}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg ?? const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: SantuColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (prefix != null) ...[prefix, const SizedBox(width: 5)],
          Text(
            text,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: textCol ?? const Color(0xFF475569),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCard({
    required String title,
    required String? content,
    bool warn = false,
  }) {
    if (content == null || content.trim().isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      decoration: BoxDecoration(
        color: SantuColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: warn ? const Color(0xFFFDE68A) : SantuColors.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Card Title
          Container(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: warn ? const Color(0xFFFEF3C7) : const Color(0xFFF1F5F9),
                  width: 1.5,
                ),
              ),
            ),
            child: Row(
              children: [
                if (warn) ...[
                  const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFB45309)),
                  const SizedBox(width: 6),
                ],
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: warn ? const Color(0xFFB45309) : const Color(0xFF1E293B),
                  ),
                ),
              ],
            ),
          ),
          // Card Content with prose styling
          Padding(
            padding: const EdgeInsets.all(18),
            child: _MarkdownProse(content: content),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = feature['status'] as String?;
    final color = statusColor(status);
    final priority = feature['priority'] as String?;
    final module = feature['module_name'] as String? ?? 'Other';
    final desc = feature['description'] as String?;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      feature['feature_name'] as String? ?? '-',
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        _buildBadge(module),
                        if (status != null)
                          _buildBadge(
                            status,
                            bg: Colors.white,
                            prefix: Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                            ),
                          ),
                        if (priority != null && priority.isNotEmpty)
                          _buildBadge(
                            '$priority Priority',
                            bg: Colors.white,
                            textCol: const Color(0xFF334155),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              // Edit Document Action Button (PC .santu-fw-btn)
              OutlinedButton.icon(
                onPressed: onEdit,
                icon: const Icon(Icons.edit, size: 16),
                label: const Text('Edit Document'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF334155),
                  side: const BorderSide(color: SantuColors.border),
                  backgroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          // Intro Description
          if (desc != null && desc.trim().isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: SantuColors.border),
              ),
              child: Text(
                desc,
                style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF334155)),
              ),
            ),
            const SizedBox(height: 20),
          ],

          // Exact 7 Sections matching PC app
          _buildCard(title: 'What does it do?', content: feature['what_it_does'] as String?),
          _buildCard(title: 'Current Behavior', content: feature['current_behavior'] as String?),
          _buildCard(title: 'Expected Behavior', content: feature['expected_behavior'] as String?, warn: true),
          _buildCard(title: 'How it works (Workflow)', content: feature['how_it_works'] as String?),
          _buildCard(title: 'How to use', content: feature['how_to_use'] as String?),
          _buildCard(title: 'QA / Testing', content: feature['qa_testing'] as String?),
          _buildCard(title: 'If we modify (Impact)', content: feature['if_we_modify'] as String?, warn: true),

          // Related features
          if (feature['related_features'] != null && (feature['related_features'] as String).trim().isNotEmpty) ...[
            Container(
              margin: const EdgeInsets.only(bottom: 24),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: SantuColors.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: SantuColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Related Features',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E293B)),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: (feature['related_features'] as String)
                        .split(RegExp(r'[,;]'))
                        .map((s) => s.trim())
                        .where((s) => s.isNotEmpty)
                        .map(
                          (rel) => Chip(
                            label: Text(rel, style: const TextStyle(fontSize: 12)),
                            backgroundColor: const Color(0xFFF1F5F9),
                            visualDensity: VisualDensity.compact,
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
          ],

          // Delete feature option at bottom
          Center(
            child: TextButton.icon(
              onPressed: () async {
                final confirm = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Delete Feature Document?'),
                    content: Text('Are you sure you want to delete "${feature['feature_name']}"?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                      FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: SantuColors.red),
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Delete'),
                      ),
                    ],
                  ),
                );
                if (confirm == true) onDelete();
              },
              icon: const Icon(Icons.delete_outline, size: 16, color: SantuColors.red),
              label: const Text('Delete this feature document', style: TextStyle(color: SantuColors.red, fontSize: 13)),
            ),
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

/// Prose renderer that supports markdown headers, bold (**text**), bullet points, and inline code (`code`)
class _MarkdownProse extends StatelessWidget {
  final String content;
  const _MarkdownProse({required this.content});

  @override
  Widget build(BuildContext context) {
    final lines = content.split('\n');
    final widgets = <Widget>[];

    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) {
        widgets.add(const SizedBox(height: 8));
        continue;
      }

      // Headers (###, ##, #)
      if (trimmed.startsWith('### ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 10, bottom: 4),
          child: Text(trimmed.substring(4), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
        ));
        continue;
      } else if (trimmed.startsWith('## ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 6),
          child: Text(trimmed.substring(3), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
        ));
        continue;
      } else if (trimmed.startsWith('# ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 14, bottom: 6),
          child: Text(trimmed.substring(2), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A))),
        ));
        continue;
      }

      // Bullet points
      final isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
      final rawLine = isBullet ? trimmed.substring(2) : trimmed;

      final textSpans = _parseInlineSpans(rawLine);

      if (isBullet) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(left: 8, bottom: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('• ', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: SantuColors.blue)),
              Expanded(
                child: Text.rich(
                  TextSpan(children: textSpans),
                  style: const TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF334155)),
                ),
              ),
            ],
          ),
        ));
      } else {
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text.rich(
            TextSpan(children: textSpans),
            style: const TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF334155)),
          ),
        ));
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }

  List<InlineSpan> _parseInlineSpans(String text) {
    final spans = <InlineSpan>[];
    // Regex matches **bold** or `code`
    final regex = RegExp(r'(\*\*[^*]+\*\*|`[^`]+`)');
    int lastMatchEnd = 0;

    for (final match in regex.allMatches(text)) {
      if (match.start > lastMatchEnd) {
        spans.add(TextSpan(text: text.substring(lastMatchEnd, match.start)));
      }
      final matchedStr = match.group(0)!;
      if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
        spans.add(TextSpan(
          text: matchedStr.substring(2, matchedStr.length - 2),
          style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
        ));
      } else if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Text(
              matchedStr.substring(1, matchedStr.length - 1),
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: Color(0xFFDB2777), // PC CSS .santu-fw-prose code
              ),
            ),
          ),
        ));
      }
      lastMatchEnd = match.end;
    }

    if (lastMatchEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastMatchEnd)));
    }

    return spans;
  }
}

/// Add / Edit Feature Document Screen
class FeatureDocEditScreen extends StatefulWidget {
  final Map<String, Object?>? initialDoc;
  const FeatureDocEditScreen({super.key, this.initialDoc});

  @override
  State<FeatureDocEditScreen> createState() => _FeatureDocEditScreenState();
}

class _FeatureDocEditScreenState extends State<FeatureDocEditScreen> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _nameCtrl;
  late TextEditingController _descCtrl;
  late TextEditingController _whatCtrl;
  late TextEditingController _currCtrl;
  late TextEditingController _expCtrl;
  late TextEditingController _howCtrl;
  late TextEditingController _useCtrl;
  late TextEditingController _qaCtrl;
  late TextEditingController _impactCtrl;
  late TextEditingController _relCtrl;

  late String _module;
  late String _status;
  late String _priority;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final d = widget.initialDoc;
    _nameCtrl = TextEditingController(text: d?['feature_name'] as String? ?? '');
    _descCtrl = TextEditingController(text: d?['description'] as String? ?? '');
    _whatCtrl = TextEditingController(text: d?['what_it_does'] as String? ?? '');
    _currCtrl = TextEditingController(text: d?['current_behavior'] as String? ?? '');
    _expCtrl = TextEditingController(text: d?['expected_behavior'] as String? ?? '');
    _howCtrl = TextEditingController(text: d?['how_it_works'] as String? ?? '');
    _useCtrl = TextEditingController(text: d?['how_to_use'] as String? ?? '');
    _qaCtrl = TextEditingController(text: d?['qa_testing'] as String? ?? '');
    _impactCtrl = TextEditingController(text: d?['if_we_modify'] as String? ?? '');
    _relCtrl = TextEditingController(text: d?['related_features'] as String? ?? '');

    _module = d?['module_name'] as String? ?? 'Sales';
    if (!kWorkbookModules.contains(_module)) _module = 'Other';

    _status = d?['status'] as String? ?? '✅ Working';
    if (!kWorkbookStatuses.contains(_status)) _status = '✅ Working';

    _priority = d?['priority'] as String? ?? 'Medium';
    if (!kWorkbookPriorities.contains(_priority)) _priority = 'Medium';
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _whatCtrl.dispose();
    _currCtrl.dispose();
    _expCtrl.dispose();
    _howCtrl.dispose();
    _useCtrl.dispose();
    _qaCtrl.dispose();
    _impactCtrl.dispose();
    _relCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);
    final doc = <String, Object?>{
      'feature_name': _nameCtrl.text.trim(),
      'module_name': _module,
      'status': _status,
      'priority': _priority,
      'description': _descCtrl.text.trim(),
      'what_it_does': _whatCtrl.text.trim(),
      'current_behavior': _currCtrl.text.trim(),
      'expected_behavior': _expCtrl.text.trim(),
      'how_it_works': _howCtrl.text.trim(),
      'how_to_use': _useCtrl.text.trim(),
      'qa_testing': _qaCtrl.text.trim(),
      'if_we_modify': _impactCtrl.text.trim(),
      'related_features': _relCtrl.text.trim(),
    };

    await AppDb.instance.saveFeatureDoc(doc);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Feature "${doc['feature_name']}" saved!')),
    );
    Navigator.pop(context, true);
  }

  Widget _buildField(String label, TextEditingController ctrl, {int minLines = 2, int maxLines = 8, bool warn = false, String? hint}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (warn) ...[
                const Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFB45309)),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: warn ? const Color(0xFFB45309) : const Color(0xFF1E293B),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          TextFormField(
            controller: ctrl,
            minLines: minLines,
            maxLines: maxLines,
            style: const TextStyle(fontSize: 14),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(fontSize: 13, color: SantuColors.textFaint),
              contentPadding: const EdgeInsets.all(12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isNew = widget.initialDoc == null;

    return Scaffold(
      backgroundColor: SantuColors.bg,
      appBar: AppBar(
        title: Text(isNew ? 'Add Feature Document' : 'Edit Feature Document'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('SAVE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Feature Name
            TextFormField(
              controller: _nameCtrl,
              enabled: isNew, // primary key
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Feature name required' : null,
              decoration: const InputDecoration(
                labelText: 'Feature Name *',
                hintText: 'e.g. Thermal Invoice Library, POS Billing',
              ),
            ),
            const SizedBox(height: 14),

            // Module, Status, Priority row
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _module,
                    decoration: const InputDecoration(labelText: 'Module'),
                    items: kWorkbookModules
                        .map((m) => DropdownMenuItem(value: m, child: Text(m, style: const TextStyle(fontSize: 13))))
                        .toList(),
                    onChanged: (v) => setState(() => _module = v ?? 'Other'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _priority,
                    decoration: const InputDecoration(labelText: 'Priority'),
                    items: kWorkbookPriorities
                        .map((p) => DropdownMenuItem(value: p, child: Text(p, style: const TextStyle(fontSize: 13))))
                        .toList(),
                    onChanged: (v) => setState(() => _priority = v ?? 'Medium'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            DropdownButtonFormField<String>(
              value: _status,
              decoration: const InputDecoration(labelText: 'Status'),
              items: kWorkbookStatuses
                  .map((s) => DropdownMenuItem(value: s, child: Text(s, style: const TextStyle(fontSize: 13))))
                  .toList(),
              onChanged: (v) => setState(() => _status = v ?? '✅ Working'),
            ),
            const SizedBox(height: 20),

            // Detailed Sections
            _buildField('Description', _descCtrl, minLines: 2, maxLines: 4, hint: 'High-level summary of the feature'),
            _buildField('What does it do?', _whatCtrl, hint: 'What capability does this provide to the shop?'),
            _buildField('Current Behavior', _currCtrl, hint: 'How does the current implementation behave?'),
            _buildField('Expected Behavior (Critical/Warning)', _expCtrl, warn: true, hint: 'What is the expected rule or architectural constraint?'),
            _buildField('How it works (Workflow)', _howCtrl, hint: 'Internal architecture, caller sequence, and APIs'),
            _buildField('How to use', _useCtrl, hint: 'Step-by-step instructions for the cashier or operator'),
            _buildField('QA / Testing', _qaCtrl, hint: 'Test cases, edge cases, failure cases, regression tests'),
            _buildField('If we modify (Impact Analysis)', _impactCtrl, warn: true, hint: 'UI, Data, Stock, Ledger and business logic impacts'),
            _buildField('Related Features', _relCtrl, minLines: 1, maxLines: 2, hint: 'Comma-separated feature names'),

            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(
                backgroundColor: SantuColors.blue,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: _saving
                  ? const CircularProgressIndicator(color: Colors.white)
                  : Text(isNew ? 'Create Feature Document' : 'Save Changes', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}
