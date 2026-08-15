/* global frappe, santu_party_transfer */
frappe.provide("santu_party_transfer");

santu_party_transfer.api = {
	balance(party_type, party) {
		return frappe.xcall("santu_hardware.santu_hardware.api.get_party_balance", { party_type, party });
	},
	save(transfer, submit) {
		return frappe.xcall("santu_hardware.santu_hardware.api.save_party_transfer", {
			transfer_json: JSON.stringify(transfer),
			submit: submit ? 1 : 0,
		});
	},
};
