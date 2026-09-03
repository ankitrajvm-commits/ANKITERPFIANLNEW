/* global frappe, santu_utilities */
frappe.provide("santu_utilities");

const UTILITIES_API = "santu_hardware.santu_hardware.utilities_api";
const ITEM_HIGHLIGHT_API = "santu_hardware.santu_hardware.item_highlight_api";

santu_utilities.api = {
	lookupBarcode(barcode) {
		return frappe.xcall(`${UTILITIES_API}.lookup_barcode_item`, { barcode });
	},
	fetchItemHighlightRules() {
		return frappe.xcall(`${ITEM_HIGHLIGHT_API}.fetch_item_highlight_rules`);
	},
	saveItemHighlightRules(rules) {
		return frappe.xcall(`${ITEM_HIGHLIGHT_API}.save_item_highlight_rules`, { rules });
	},
	parseItemsFile(file_url) {
		return frappe.xcall(`${UTILITIES_API}.parse_items_import_file`, { file_url });
	},
	parseItemsFilePdf(file_url) {
		return frappe.xcall(`${UTILITIES_API}.parse_items_import_file_from_pdf`, { file_url });
	},
	matchPdfItemsForBulkUpdate(file_url) {
		return frappe.xcall(`${UTILITIES_API}.match_pdf_items_for_bulk_update`, { file_url });
	},
	validateItemsImport(args) {
		return frappe.xcall(`${UTILITIES_API}.validate_items_import`, args);
	},
	importItemsValid(rows) {
		return frappe.xcall(`${UTILITIES_API}.import_items_valid`, { rows });
	},
	getBulkItems(mode, search, page, page_size) {
		return frappe.xcall(`${UTILITIES_API}.get_bulk_items`, { mode, search, page, page_size });
	},
	bulkUpdateItems(updates) {
		return frappe.xcall(`${UTILITIES_API}.bulk_update_items`, { updates });
	},
	parsePartiesFile(file_url, party_type) {
		return frappe.xcall(`${UTILITIES_API}.parse_parties_import_file`, { file_url, party_type });
	},
	importParties(rows, party_type) {
		return frappe.xcall(`${UTILITIES_API}.import_parties`, { rows, party_type });
	},
	exportItems(filters) {
		return frappe.xcall(`${UTILITIES_API}.export_items_file`, { filters });
	},
	getTallyData(from_date, to_date, types) {
		return frappe.xcall(`${UTILITIES_API}.get_tally_export_data`, { from_date, to_date, types });
	},
	downloadTally(from_date, to_date, types, file_format = "xlsx") {
		return frappe.xcall(`${UTILITIES_API}.download_tally_export`, { from_date, to_date, types, file_format });
	},
	getDataAudit() {
		return frappe.xcall(`${UTILITIES_API}.get_data_audit`);
	},
	getFyChecklist() {
		return frappe.xcall(`${UTILITIES_API}.get_fiscal_year_checklist`);
	},
	getSalesmanReport(from_date, to_date) {
		return frappe.xcall(`${UTILITIES_API}.get_salesman_report`, { from_date, to_date });
	},
	getBusinessSetup() {
		return frappe.xcall(`${UTILITIES_API}.get_business_setup`);
	},
	saveBusinessSetup(data) {
		return frappe.xcall(`${UTILITIES_API}.save_business_setup`, { data });
	},
	generateBarcodeLabels(items, label_size) {
		return frappe.xcall(`${UTILITIES_API}.generate_barcode_labels`, { items, label_size });
	},
	searchProducts(query) {
		return frappe.xcall("santu_hardware.santu_hardware.api.search_products", { query, limit: 15 });
	},
	getItemDetail(item_code) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_item_detail", { item_code });
	},
	quickCreateItem(args) {
		return frappe.xcall("santu_hardware.santu_hardware.api.quick_create_item", args);
	},
	staff() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.list_staff_users");
	},
	roles() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.list_role_groups");
	},
	saveRoles(user, roles) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.save_user_roles", { user, roles });
	},
	disableUser(user) {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.disable_user_access", { user });
	},
	createBackup() {
		return frappe.xcall("santu_hardware.santu_hardware.sync_backup_api.create_manual_backup", { include_files: true });
	},
	getVoiceModel() {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.get_voice_model");
	},
	saveVoiceSettings(args) {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.save_voice_settings", args);
	},
	saveVoiceRule(args) {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.save_voice_rule", args);
	},
	deleteVoiceRule(rule_id) {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.delete_voice_rule", { rule_id });
	},
	autoTrainCatalog() {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.auto_train_from_catalog");
	},
	testVoiceQuery(query) {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.test_voice_query", { query });
	},
	getCatalogItemsForTraining(args = {}) {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.get_catalog_items_for_training", args);
	},
	trainItemVoiceAlias(item_code, phrase, audio_base64 = null, audio_format = "webm") {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.train_item_voice_alias", { item_code, phrase, audio_base64, audio_format });
	},
	getVoiceDatasetStats() {
		return frappe.xcall("santu_hardware.santu_hardware.voice_model_api.get_voice_dataset_stats");
	},
};
