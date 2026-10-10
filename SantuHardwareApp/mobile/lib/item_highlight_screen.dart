import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import 'item_highlight.dart';
import 'models.dart';
import 'theme.dart';

const _palette = [
  '#f5d90a', '#f59e0b', '#ef4444', '#ec4899', '#a855f7',
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16',
  '#78716c', '#0f172a',
];

/// Utilities → Item Colour Rules: "jo bhi saman ko naya colour dena chahu,
/// item name/code me ye text ho to ye colour laga do" — mirrors
/// santu_item_highlight_rules's table 1:1 (On / Match / Text / Colour /
/// reorder), minus the native OS colour wheel (no Flutter equivalent
/// without a new dependency) — a 12-swatch palette instead, covering the
/// same hues. CPVC (yellow) and UPVC (pink) are always on, listed below as
/// built-in and not editable, exactly like the PC screen says.
class ItemHighlightScreen extends StatefulWidget {
  const ItemHighlightScreen({super.key});

  @override
  State<ItemHighlightScreen> createState() => _ItemHighlightScreenState();
}

class _ItemHighlightScreenState extends State<ItemHighlightScreen> {
  final _uuid = const Uuid();
  bool _loading = true;
  List<ItemHighlightRule> _rules = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await ItemHighlight.load();
    setState(() {
      _rules = List.of(ItemHighlight.rules);
      _loading = false;
    });
  }

  Future<void> _save() async {
    await ItemHighlight.save(_rules);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Colour rules saved. Naye rang turant dikhenge.')));
  }

  void _addRule() {
    setState(() => _rules.add(ItemHighlightRule(id: _uuid.v4(), value: '', color: _palette.first)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Item Colour Rules')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _addRule, icon: const Icon(Icons.add), label: const Text('Add Rule')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
              children: [
                const Text(
                  'Jab bhi Item Name ya Item Code me ye text mile, wo item Inventory, Billing aur Purchase me is rang me dikhega. Upar wala rule neeche wale se jeetta hai.',
                  style: TextStyle(fontSize: 12, color: SantuColors.textMuted),
                ),
                const SizedBox(height: 14),
                for (int i = 0; i < _rules.length; i++) _ruleCard(i),
                if (_rules.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 20), child: Text('Koi rule nahi — "Add Rule" se shuru karo', style: TextStyle(color: SantuColors.textMuted))),
                const SizedBox(height: 20),
                FilledButton(onPressed: _save, child: const Text('Save')),
                const SizedBox(height: 24),
                const Divider(),
                const SizedBox(height: 8),
                const Text('Built-in (hamesha on, aakhir me lagte hain)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 8),
                _builtInRow('CPVC', '#f5d90a'),
                _builtInRow('UPVC', '#ec4899'),
              ],
            ),
    );
  }

  Widget _builtInRow(String label, String hex) {
    final color = ItemHighlight.lighten(_hexToColor(hex), ItemHighlight.minBlend);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: color, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(8)),
      child: Text('Contains "$label"', style: const TextStyle(fontSize: 13)),
    );
  }

  Color _hexToColor(String hex) => Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));

  Widget _ruleCard(int index) {
    final r = _rules[index];
    final preview = ItemHighlight.lighten(_hexToColor(r.color), ItemHighlight.minBlend);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: SantuColors.card, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Checkbox(value: r.enabled, onChanged: (v) => setState(() => r.enabled = v ?? true)),
              Expanded(
                child: DropdownButton<String>(
                  value: r.matchType,
                  isExpanded: true,
                  items: const [
                    DropdownMenuItem(value: 'Contains', child: Text('Contains')),
                    DropdownMenuItem(value: 'Starts With', child: Text('Starts With')),
                  ],
                  onChanged: (v) => setState(() => r.matchType = v ?? 'Contains'),
                ),
              ),
              IconButton(icon: const Icon(Icons.arrow_upward, size: 18), onPressed: index == 0 ? null : () => setState(() => _rules.insert(index - 1, _rules.removeAt(index)))),
              IconButton(icon: const Icon(Icons.arrow_downward, size: 18), onPressed: index == _rules.length - 1 ? null : () => setState(() => _rules.insert(index + 1, _rules.removeAt(index)))),
              IconButton(icon: const Icon(Icons.close, size: 18, color: SantuColors.red), onPressed: () => setState(() => _rules.removeAt(index))),
            ],
          ),
          TextFormField(
            initialValue: r.value,
            decoration: const InputDecoration(labelText: 'Item Name/Code Text (e.g. CPVC)'),
            onChanged: (v) => r.value = v,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Container(width: 28, height: 28, decoration: BoxDecoration(color: preview, border: Border.all(color: SantuColors.border), borderRadius: BorderRadius.circular(6))),
              const SizedBox(width: 10),
              const Text('List me aisa dikhega', style: TextStyle(fontSize: 11, color: SantuColors.textMuted)),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final hex in _palette)
                InkWell(
                  onTap: () => setState(() => r.color = hex),
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _hexToColor(hex),
                      shape: BoxShape.circle,
                      border: Border.all(color: r.color == hex ? SantuColors.textDark : SantuColors.border, width: r.color == hex ? 2.5 : 1),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
