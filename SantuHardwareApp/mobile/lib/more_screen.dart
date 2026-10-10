import 'package:flutter/material.dart';

import 'app_lock_settings_screen.dart';
import 'backup_screen.dart';
import 'bug_report_screen.dart';
import 'bulk_update_screen.dart';
import 'cash_bank_screen.dart';
import 'cost_price_lock_screen.dart';
import 'item_highlight_screen.dart';
import 'customer_dues_screen.dart';
import 'doctor_screen.dart';
import 'expense_screen.dart';
import 'export_items_screen.dart';
import 'feature_workbook_screen.dart';
import 'import_items_screen.dart';
import 'invoice_settings_screen.dart';
import 'inventory_screen.dart';
import 'payment_in_screen.dart';
import 'sale_invoices_screen.dart';
import 'low_stock_screen.dart';
import 'message_templates_screen.dart';
import 'printer_settings_screen.dart';
import 'purchase_screen.dart';
import 'quick_doc_screen.dart';
import 'recycle_bin_screen.dart';
import 'reports_screen.dart';
import 'shop_settings_screen.dart';
import 'theme.dart';
import 'view_invoice_screen.dart';

Widget _sectionHeader(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
      child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: SantuColors.textMuted, letterSpacing: 0.5)),
    );

/// Landing spot for modules that don't earn a permanent bottom-nav slot.
/// Grows as more pages (Reports, Delivery Challan, Estimate…) get ported.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        children: [
          _sectionHeader('MASTERS'),
          ListTile(
            leading: const Icon(Icons.warehouse_outlined, color: SantuColors.blue),
            title: const Text('Inventory'),
            subtitle: const Text('Items, prices, stock on hand'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined, color: SantuColors.blue),
            title: const Text('Expenses'),
            subtitle: const Text('Rent, electricity, labour…'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExpenseScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.receipt_outlined, color: SantuColors.blue),
            title: const Text('View Invoice'),
            subtitle: const Text('All saved bills, search + reprint'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ViewInvoiceScreen())),
          ),
          _sectionHeader('TRANSACTIONS'),
          ListTile(
            leading: const Icon(Icons.shopping_bag_outlined, color: SantuColors.blue),
            title: const Text('Purchase / Goods In'),
            subtitle: const Text('Supplier bill entry, cost prices, stock received'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined, color: SantuColors.blue),
            title: const Text('Sale Invoices'),
            subtitle: const Text('Filter, summary, print / share / ⋮ per bill'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SaleInvoicesScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.payments_outlined, color: SantuColors.blue),
            title: const Text('Payment In'),
            subtitle: const Text('Customer se li hui rakam ki list'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PaymentInScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.bar_chart_outlined, color: SantuColors.blue),
            title: const Text('Reports'),
            subtitle: const Text('Sales summary, top items, expenses'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.playlist_add_check_outlined, color: SantuColors.blue),
            title: const Text('Sales Order'),
            subtitle: const Text('Confirmed order, not billed yet'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(kind: 'sales_order', title: 'Sales Order', partyKind: 'Customer', stockSign: 0, docPrefix: 'SO-', actionLabel: 'Save Order'),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.shopping_cart_checkout_outlined, color: SantuColors.blue),
            title: const Text('Purchase Order'),
            subtitle: const Text('Order placed with supplier, not received yet'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(kind: 'purchase_order', title: 'Purchase Order', partyKind: 'Supplier', stockSign: 0, docPrefix: 'PO-', actionLabel: 'Save Order'),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.description_outlined, color: SantuColors.blue),
            title: const Text('Estimate'),
            subtitle: const Text('Quotation — no payment, no stock effect'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(kind: 'estimate', title: 'Estimate', partyKind: 'Customer', stockSign: 0, docPrefix: 'EST-', actionLabel: 'Save Estimate', canConvertToBill: true),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.local_shipping_outlined, color: SantuColors.blue),
            title: const Text('Delivery Challan'),
            subtitle: const Text('Goods out — no payment, stock decreases'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(
                  kind: 'challan',
                  title: 'Delivery Challan',
                  partyKind: 'Customer',
                  stockSign: -1,
                  docPrefix: 'DC-',
                  actionLabel: 'Save Challan',
                  canConvertToBill: true,
                ),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.inventory_2_outlined, color: SantuColors.blue),
            title: const Text('Receive Stock'),
            subtitle: const Text('Goods Received Note — stock increases'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(
                  kind: 'stock_entry',
                  title: 'Receive Stock',
                  partyKind: 'Supplier',
                  stockSign: 1,
                  docPrefix: 'GRN-',
                  actionLabel: 'Receive Stock',
                ),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.keyboard_return, color: SantuColors.blue),
            title: const Text('Sales Return'),
            subtitle: const Text('Customer returns goods — stock increases'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(kind: 'sales_return', title: 'Sales Return', partyKind: 'Customer', stockSign: 1, docPrefix: 'SR-', actionLabel: 'Save Return', actionColor: SantuColors.red),
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.undo, color: SantuColors.blue),
            title: const Text('Purchase Return'),
            subtitle: const Text('Goods back to supplier — stock decreases'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const QuickDocScreen(kind: 'purchase_return', title: 'Purchase Return', partyKind: 'Supplier', stockSign: -1, docPrefix: 'PR-', actionLabel: 'Save Return', actionColor: SantuColors.red),
              ),
            ),
          ),
          _sectionHeader('MONEY'),
          ListTile(
            leading: const Icon(Icons.account_balance_wallet_outlined, color: SantuColors.blue),
            title: const Text('Dues'),
            subtitle: const Text('Customers owe me / I owe suppliers, Baki Jodein'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerDuesScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.account_balance_outlined, color: SantuColors.blue),
            title: const Text('Cash & Bank'),
            subtitle: const Text('Balance by payment mode'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CashBankScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.warning_amber_outlined, color: SantuColors.blue),
            title: const Text('Low Stock'),
            subtitle: const Text('Items needing reorder'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LowStockScreen())),
          ),
          _sectionHeader('UTILITIES'),
          ListTile(
            leading: const Icon(Icons.upload_file_outlined, color: SantuColors.blue),
            title: const Text('Import Items'),
            subtitle: const Text('Excel / CSV se catalogue daalein'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ImportItemsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.download_outlined, color: SantuColors.blue),
            title: const Text('Export Items'),
            subtitle: const Text('CSV share karein — PC Excel me khol sakte ho'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ExportItemsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.edit_note_outlined, color: SantuColors.blue),
            title: const Text('Update Items In Bulk'),
            subtitle: const Text('Tick several items, edit price/unit/barcode together'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BulkUpdateScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.palette_outlined, color: SantuColors.blue),
            title: const Text('Item Colour Rules'),
            subtitle: const Text('Naam/code match ho to item ko rang do'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ItemHighlightScreen())),
          ),
          _sectionHeader('TOOLS & DATA'),
          ListTile(
            leading: const Icon(Icons.print_outlined, color: SantuColors.blue),
            title: const Text('Printer Settings'),
            subtitle: const Text('Pair the Bluetooth thermal printer'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterSettingsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.storefront_outlined, color: SantuColors.blue),
            title: const Text('Shop Profile'),
            subtitle: const Text('Shop name, GSTIN, bill footer'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShopSettingsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.description_outlined, color: SantuColors.blue),
            title: const Text('Invoice Settings'),
            subtitle: const Text('Thermal & A4 invoice template library'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InvoiceSettingsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.lock_outline, color: SantuColors.blue),
            title: const Text('App Lock'),
            subtitle: const Text('Launch par PIN maange'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AppLockSettingsScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.currency_rupee, color: SantuColors.blue),
            title: const Text('Cost Price Lock'),
            subtitle: const Text('Billing par khareed rate PIN se gated'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CostPriceLockScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.chat_outlined, color: SantuColors.blue),
            title: const Text('WhatsApp & Messages'),
            subtitle: const Text('Share templates, message history'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageTemplatesScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.camera_alt_outlined, color: SantuColors.blue),
            title: const Text('Upload Bill'),
            subtitle: const Text('Attach a supplier bill photo — opens Purchase'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PurchaseScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.verified_outlined, color: SantuColors.blue),
            title: const Text('Verify My Data'),
            subtitle: const Text('Doctor Uncle data health check, plain language'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DoctorScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.bug_report_outlined, color: SantuColors.blue),
            title: const Text('Bug Report'),
            subtitle: const Text('System diagnostics and issue reporting'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BugReportScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.delete_outline, color: SantuColors.blue),
            title: const Text('Recycle Bin'),
            subtitle: const Text('Deleted items, customers, bills — restore anytime'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RecycleBinScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.backup_outlined, color: SantuColors.blue),
            title: const Text('Backup & Restore'),
            subtitle: const Text('No server — export/import a file instead'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BackupScreen())),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.menu_book_outlined, color: SantuColors.blue),
            title: const Text('Feature Workbook'),
            subtitle: const Text('PC dev team ka pura feature backlog, is phone par bhi'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FeatureWorkbookScreen())),
          ),
          const Divider(height: 1),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Party Transfer aage aayega.', style: TextStyle(fontSize: 12, color: SantuColors.textMuted)),
          ),
        ],
      ),
    );
  }
}
