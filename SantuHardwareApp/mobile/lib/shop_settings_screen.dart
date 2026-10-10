import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'app_settings.dart';
import 'theme.dart';

/// Utilities → Shop Profile: Name, GSTIN, Website, City, State, Pincode,
/// Logo and Receipt Footer.
class ShopSettingsScreen extends StatefulWidget {
  const ShopSettingsScreen({super.key});

  @override
  State<ShopSettingsScreen> createState() => _ShopSettingsScreenState();
}

class _ShopSettingsScreenState extends State<ShopSettingsScreen> {
  final _nameCtrl = TextEditingController();
  final _gstinCtrl = TextEditingController();
  final _websiteCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _upiCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _stateCtrl = TextEditingController();
  final _pincodeCtrl = TextEditingController();
  final _footerCtrl = TextEditingController();

  String? _logoPath;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    _nameCtrl.text = await AppSettings.shopName();
    _gstinCtrl.text = await AppSettings.gstin() ?? '';
    _websiteCtrl.text = await AppSettings.website() ?? '';
    _addressCtrl.text = await AppSettings.addressLine() ?? '';
    _phoneCtrl.text = await AppSettings.phone() ?? '';
    _upiCtrl.text = await AppSettings.upiId() ?? '';
    _cityCtrl.text = await AppSettings.city() ?? '';
    _stateCtrl.text = await AppSettings.state() ?? '';
    _pincodeCtrl.text = await AppSettings.pincode() ?? '';
    _footerCtrl.text = await AppSettings.billFooter();
    _logoPath = await AppSettings.logoPath();
    setState(() => _loading = false);
  }

  Future<void> _pickLogo() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery);
    if (picked != null) {
      setState(() => _logoPath = picked.path);
    }
  }

  void _removeLogo() {
    setState(() => _logoPath = null);
  }

  Future<void> _save() async {
    await AppSettings.setShopName(_nameCtrl.text.trim().isEmpty ? 'Santu Hardware' : _nameCtrl.text.trim());
    await AppSettings.setGstin(_gstinCtrl.text.trim());
    await AppSettings.setWebsite(_websiteCtrl.text.trim());
    await AppSettings.setAddressLine(_addressCtrl.text.trim());
    await AppSettings.setPhone(_phoneCtrl.text.trim());
    await AppSettings.setUpiId(_upiCtrl.text.trim());
    await AppSettings.setCity(_cityCtrl.text.trim());
    await AppSettings.setState(_stateCtrl.text.trim());
    await AppSettings.setPincode(_pincodeCtrl.text.trim());
    await AppSettings.setBillFooter(_footerCtrl.text.trim().isEmpty ? 'Thank you!' : _footerCtrl.text.trim());
    await AppSettings.setLogoPath(_logoPath);

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Shop profile save ho gaya ✓')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Shop Profile')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text('Receipt aur documents par yahi details print/share hoti hain.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
                const SizedBox(height: 16),

                // Logo Picker Card
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: SantuColors.card,
                    border: Border.all(color: SantuColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 70,
                        height: 70,
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: SantuColors.border),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: _logoPath != null && File(_logoPath!).existsSync()
                            ? Image.file(File(_logoPath!), fit: BoxFit.cover)
                            : const Icon(Icons.storefront, size: 36, color: SantuColors.textMuted),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Shop Logo', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                            const Text('Print aur PDF header ke liye', style: TextStyle(fontSize: 11, color: SantuColors.textMuted)),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                OutlinedButton.icon(
                                  onPressed: _pickLogo,
                                  icon: const Icon(Icons.photo_library, size: 16),
                                  label: const Text('Choose Logo', style: TextStyle(fontSize: 12)),
                                ),
                                if (_logoPath != null) ...[
                                  const SizedBox(width: 8),
                                  IconButton(
                                    onPressed: _removeLogo,
                                    icon: const Icon(Icons.delete_outline, color: SantuColors.red, size: 20),
                                    tooltip: 'Remove Logo',
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),
                TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Shop Name')),
                const SizedBox(height: 10),
                TextField(controller: _gstinCtrl, decoration: const InputDecoration(labelText: 'GSTIN (optional)')),
                const SizedBox(height: 10),
                TextField(controller: _websiteCtrl, decoration: const InputDecoration(labelText: 'Website (optional)', hintText: 'www.santuhardware.com')),
                const SizedBox(height: 10),
                TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Shop Phone', hintText: 'Bill par "Ph:" line me chhapega')),
                const SizedBox(height: 14),

                const Text('Shop Address', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 8),
                TextField(controller: _addressCtrl, decoration: const InputDecoration(labelText: 'Address', hintText: 'Dukaan ka pata — bill ke header me')),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: TextField(controller: _cityCtrl, decoration: const InputDecoration(labelText: 'City'))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: _stateCtrl, decoration: const InputDecoration(labelText: 'State'))),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(controller: _pincodeCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Pincode')),
                const SizedBox(height: 14),

                const Text('UPI — Scan & Pay QR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 4),
                const Text(
                  'Ye UPI ID bill par QR bankar chhapegi. Galat ID par customer ko "invalid VPA" dikhega, isliye galat format save nahi hoga.',
                  style: TextStyle(fontSize: 11, color: SantuColors.textMuted),
                ),
                const SizedBox(height: 8),
                TextField(controller: _upiCtrl, decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'naam@paytm')),
                const SizedBox(height: 14),

                TextField(controller: _footerCtrl, decoration: const InputDecoration(labelText: 'Bill Footer', hintText: 'Thank you! Visit again.')),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _save,
                  icon: const Icon(Icons.save),
                  label: const Text('Save Profile'),
                ),
              ],
            ),
    );
  }
}
