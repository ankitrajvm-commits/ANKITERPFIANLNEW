import 'package:flutter/material.dart';

import 'app_settings.dart';
import 'invoice_templates.dart';
import 'theme.dart';

class InvoiceSettingsScreen extends StatefulWidget {
  const InvoiceSettingsScreen({super.key});

  @override
  State<InvoiceSettingsScreen> createState() => _InvoiceSettingsScreenState();
}

class _InvoiceSettingsScreenState extends State<InvoiceSettingsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _selectedDocType = 'Sales Invoice';
  String _selectedThermalTemplate = 'Standard Bill';
  String _selectedA4Template = 'Standard A4';
  final Map<String, String> _defaultThermal = {};
  final Map<String, String> _defaultA4 = {};
  bool _loading = true;

  String _shopName = 'Santu Hardware';
  String? _gstin;
  String? _address;
  String? _upiId;
  String? _phone;
  String? _website;
  String? _billFooter;

  bool _showLogoOnBill = true;
  bool _showLogoOnA4Bill = true;
  double _thermalLogoWidth = 65.0;
  double _a4LogoWidth = 40.0;

  final List<DocTypeDefinition> _docTypes = InvoiceTemplates.documentTypes;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final shopName = await AppSettings.shopName();
    final gstin = await AppSettings.gstin();
    final website = await AppSettings.website();
    final footer = await AppSettings.billFooter();
    final phone = await AppSettings.phone();

    final showLogoOnBill = await AppSettings.showLogoOnBill();
    final showLogoOnA4Bill = await AppSettings.showLogoOnA4Bill();
    final thermalLogoWidth = await AppSettings.thermalLogoWidth();
    final a4LogoWidth = await AppSettings.a4LogoWidth();

    // Same helper the real thermal/A4 bills use (a4_invoice_pdf.dart,
    // thermal_receipt.dart) -- this screen used to join only city/state/
    // pincode and drop the street line, so an address with no city/state/
    // pincode set fell through to the sample shop's address in the preview.
    final companyAddress = await AppSettings.companyAddressLine();
    final address = companyAddress.isNotEmpty ? companyAddress : null;
    final upiId = await AppSettings.upiId();

    for (final dt in _docTypes) {
      _defaultThermal[dt.key] = await AppSettings.defaultTemplate('Thermal Invoice Library', dt.key);
      _defaultA4[dt.key] = await AppSettings.defaultTemplate('WhatsApp Library', dt.key);
    }

    _selectedThermalTemplate = _defaultThermal[_selectedDocType] ?? 'Standard Bill';
    _selectedA4Template = _defaultA4[_selectedDocType] ?? 'Standard A4';

    setState(() {
      _shopName = shopName;
      _gstin = gstin;
      _address = address;
      _upiId = upiId;
      _phone = phone;
      _website = website;
      _billFooter = footer;
      _showLogoOnBill = showLogoOnBill;
      _showLogoOnA4Bill = showLogoOnA4Bill;
      _thermalLogoWidth = thermalLogoWidth;
      _a4LogoWidth = a4LogoWidth;
      _loading = false;
    });
  }

  String get _currentLibrary => _tabController.index == 0 ? 'Thermal Invoice Library' : 'WhatsApp Library';

  String get _currentActiveTemplate => _tabController.index == 0 ? _selectedThermalTemplate : _selectedA4Template;

  void _onSelectTemplate(String id) {
    setState(() {
      if (_tabController.index == 0) {
        _selectedThermalTemplate = id;
      } else {
        _selectedA4Template = id;
      }
    });
  }

  Future<void> _setAsDefault() async {
    final lib = _currentLibrary;
    final template = _currentActiveTemplate;
    await AppSettings.setDefaultTemplate(lib, _selectedDocType, template);
    setState(() {
      if (_tabController.index == 0) {
        _defaultThermal[_selectedDocType] = template;
      } else {
        _defaultA4[_selectedDocType] = template;
      }
    });
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Default saved: $template for $_currentDocLabel')),
    );
  }

  String get _currentDocLabel {
    final match = _docTypes.where((d) => d.key == _selectedDocType);
    return match.isNotEmpty ? match.first.label : _selectedDocType;
  }

  InvoicePreviewData _makePreviewData() {
    final sample = InvoicePreviewData.sample(
      _selectedDocType,
      showLogo: _tabController.index == 0 ? _showLogoOnBill : _showLogoOnA4Bill,
      thermalLogoWidth: _thermalLogoWidth,
      a4LogoWidth: _a4LogoWidth,
    );
    return InvoicePreviewData(
      shopName: _shopName,
      gstin: _gstin ?? sample.gstin,
      address: _address ?? sample.address,
      phone: _phone ?? sample.phone,
      website: _website ?? sample.website,
      docType: _currentDocLabel,
      docNo: sample.docNo,
      date: sample.date,
      partyLabel: sample.partyLabel,
      partyPhone: sample.partyPhone,
      items: sample.items,
      subtotal: sample.subtotal,
      discount: sample.discount,
      additionalCharges: sample.additionalCharges,
      redeemPoints: sample.redeemPoints,
      grandTotal: sample.grandTotal,
      received: sample.received,
      balance: sample.balance,
      paymentMode: sample.paymentMode,
      footer: _billFooter ?? sample.footer,
      showLogo: _tabController.index == 0 ? _showLogoOnBill : _showLogoOnA4Bill,
      thermalLogoWidth: _thermalLogoWidth,
      a4LogoWidth: _a4LogoWidth,
      upiId: _upiId,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Invoice Settings')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final templates = InvoiceTemplates.getTemplates(_currentLibrary, _selectedDocType);
    final activeDefault = _tabController.index == 0
        ? _defaultThermal[_selectedDocType] ?? 'Standard Bill'
        : _defaultA4[_selectedDocType] ?? 'Standard A4';
    final isCurrentDefault = _currentActiveTemplate == activeDefault;
    final narrow = MediaQuery.of(context).size.width < 760;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoice Settings'),
        bottom: TabBar(
          controller: _tabController,
          onTap: (_) => setState(() {}),
          tabs: const [
            Tab(icon: Icon(Icons.receipt_long), text: 'Thermal (3-inch)'),
            Tab(icon: Icon(Icons.picture_as_pdf), text: 'WhatsApp / A4'),
          ],
        ),
      ),
      body: Column(
        children: [
          // Document Type Selector Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: const Color(0xFFF1F5F9),
            child: Row(
              children: [
                const Text('Document: ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _selectedDocType,
                    isDense: true,
                    isExpanded: true,
                    decoration: InputDecoration(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      fillColor: Colors.white,
                      filled: true,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    items: [
                      for (final dt in _docTypes)
                        DropdownMenuItem(
                          value: dt.key,
                          child: Text(dt.label, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (val) {
                      if (val == null) return;
                      setState(() {
                        _selectedDocType = val;
                        final thermTemplates = InvoiceTemplates.getTemplates('Thermal Invoice Library', val);
                        final a4Templates = InvoiceTemplates.getTemplates('WhatsApp Library', val);

                        _selectedThermalTemplate = _defaultThermal[val] ?? thermTemplates.first.id;
                        _selectedA4Template = _defaultA4[val] ?? a4Templates.first.id;
                      });
                    },
                  ),
                ),
              ],
            ),
          ),

          // Main body: Split view on tablet/desktop, scrollable stack on mobile
          Expanded(
            child: narrow
                ? SingleChildScrollView(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _buildLogoLibraryCard(),
                        _buildTemplateSelector(templates, activeDefault),
                        const SizedBox(height: 14),
                        _buildDefaultButton(isCurrentDefault),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            const Text('Live Preview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: SantuColors.blue.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                _currentActiveTemplate,
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: SantuColors.blue),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Center(child: _buildPreview()),
                        const SizedBox(height: 24),
                      ],
                    ),
                  )
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Left: Template cards & logo controls
                      SizedBox(
                        width: 360,
                        child: ListView(
                          padding: const EdgeInsets.all(12),
                          children: [
                            _buildLogoLibraryCard(),
                            _buildTemplateSelector(templates, activeDefault),
                            const SizedBox(height: 14),
                            _buildDefaultButton(isCurrentDefault),
                          ],
                        ),
                      ),
                      const VerticalDivider(width: 1),
                      // Right: Live preview
                      Expanded(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Text('Live Preview — $_currentActiveTemplate', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                              const SizedBox(height: 12),
                              _buildPreview(),
                              const SizedBox(height: 24),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildLogoLibraryCard() {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: const [
          BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.photo_library_outlined, size: 18, color: SantuColors.blue),
              const SizedBox(width: 8),
              const Text('Logo Library', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: SantuColors.blue.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text('PC Parity', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: SantuColors.blue)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'High-contrast thermal logo for roll prints & crisp header logo for WhatsApp/A4 sharing.',
            style: TextStyle(fontSize: 11, color: SantuColors.textMuted),
          ),
          const SizedBox(height: 10),

          if (_tabController.index == 0) ...[
            // Thermal Logo Settings
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        height: 48,
                        width: 96,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFFCBD5E1)),
                        ),
                        child: Center(
                          child: _showLogoOnBill
                              ? Image.asset('assets/thermal_bill_logo.png', fit: BoxFit.contain)
                              : const Text('No Logo', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('Thermal Logo', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                                Switch(
                                  value: _showLogoOnBill,
                                  activeColor: SantuColors.green,
                                  onChanged: (val) async {
                                    await AppSettings.setShowLogoOnBill(val);
                                    setState(() => _showLogoOnBill = val);
                                  },
                                ),
                              ],
                            ),
                            Text(
                              _showLogoOnBill ? 'Logo will print on roll' : 'Plain company text',
                              style: const TextStyle(fontSize: 11, color: SantuColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  if (_showLogoOnBill) ...[
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Thermal Logo Width', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                        Text('${_thermalLogoWidth.toStringAsFixed(0)} mm', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: SantuColors.blue)),
                      ],
                    ),
                    Slider(
                      min: 20,
                      max: 72,
                      divisions: 52,
                      value: _thermalLogoWidth.clamp(20, 72),
                      activeColor: SantuColors.blue,
                      onChanged: (val) {
                        setState(() => _thermalLogoWidth = val);
                      },
                      onChangeEnd: (val) async {
                        await AppSettings.setThermalLogoWidth(val);
                      },
                    ),
                  ],
                ],
              ),
            ),
          ] else ...[
            // A4 Logo Settings
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        height: 48,
                        width: 96,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFFCBD5E1)),
                        ),
                        child: Center(
                          child: _showLogoOnA4Bill
                              ? Image.asset('assets/thermal_bill_logo.png', fit: BoxFit.contain)
                              : const Text('No Logo', style: TextStyle(fontSize: 10, color: SantuColors.textMuted)),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('A4 PDF Logo', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                                Switch(
                                  value: _showLogoOnA4Bill,
                                  activeColor: SantuColors.green,
                                  onChanged: (val) async {
                                    await AppSettings.setShowLogoOnA4Bill(val);
                                    setState(() => _showLogoOnA4Bill = val);
                                  },
                                ),
                              ],
                            ),
                            Text(
                              _showLogoOnA4Bill ? 'Shown on WhatsApp PDF' : 'Plain header text only',
                              style: const TextStyle(fontSize: 11, color: SantuColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  if (_showLogoOnA4Bill) ...[
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('A4 Logo Width', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                        Text('${_a4LogoWidth.toStringAsFixed(0)} %', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: SantuColors.blue)),
                      ],
                    ),
                    Slider(
                      min: 15,
                      max: 100,
                      divisions: 85,
                      value: _a4LogoWidth.clamp(15, 100),
                      activeColor: SantuColors.blue,
                      onChanged: (val) {
                        setState(() => _a4LogoWidth = val);
                      },
                      onChangeEnd: (val) async {
                        await AppSettings.setA4LogoWidth(val);
                      },
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDefaultButton(bool isCurrentDefault) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: isCurrentDefault ? SantuColors.border : SantuColors.green,
        padding: const EdgeInsets.symmetric(vertical: 12),
      ),
      onPressed: isCurrentDefault ? null : _setAsDefault,
      icon: Icon(isCurrentDefault ? Icons.check_circle : Icons.bookmark_added),
      label: Text(
        isCurrentDefault ? 'Already Default' : 'Set as Default for $_currentDocLabel',
        style: const TextStyle(fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildTemplateSelector(List<TemplateInfo> templates, String activeDefault) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${templates.length} Designs Available', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: SantuColors.textMuted)),
        const SizedBox(height: 8),
        for (final t in templates) ...[
          _templateCard(
            info: t,
            isSelected: t.id == _currentActiveTemplate,
            isDefault: t.id == activeDefault,
            onTap: () => _onSelectTemplate(t.id),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _templateCard({
    required TemplateInfo info,
    required bool isSelected,
    required bool isDefault,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected ? SantuColors.blue.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isSelected ? SantuColors.blue : const Color(0xFFCBD5E1),
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    info.name,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13.5,
                      color: isSelected ? SantuColors.blue : Colors.black,
                    ),
                  ),
                ),
                if (isDefault)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: SantuColors.green.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('DEFAULT', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: SantuColors.green)),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(info.desc, style: const TextStyle(fontSize: 11.5, color: SantuColors.textMuted)),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview() {
    final data = _makePreviewData();
    if (_tabController.index == 0) {
      return ThermalReceiptWidget(
        data: data,
        templateId: _selectedThermalTemplate,
      );
    } else {
      return A4InvoiceWidget(
        data: data,
        templateId: _selectedA4Template,
      );
    }
  }
}
