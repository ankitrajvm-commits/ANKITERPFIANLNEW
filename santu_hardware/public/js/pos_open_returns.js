// Home's "Returns" shortcut used to open a raw filtered POS Invoice list
// view (/app/pos-invoice?is_return=1) — correct data, but not where a
// cashier actually processes a return (that only happens inside POS's
// own "Recent Orders" panel). Reported live, 2026-08-06: "return kaam
// nahi kar raha" — the shortcut wasn't broken, it just didn't lead
// anywhere a return could be done. Fix: point the shortcut at POS with a
// flag, and here, drive the same "Recent Orders" panel a cashier would
// otherwise have to find manually via "..." menu → "Toggle Recent
// Orders" — pre-set to "Paid" (the status a return search needs; "Draft"
// is the panel's own default and isn't relevant to returns).
(function () {
	if (!window.location.search.includes("santu_return")) return;

	const wait_for_pos = setInterval(() => {
		if (!window.cur_pos || !cur_pos.recent_order_list) return;
		clearInterval(wait_for_pos);
		cur_pos.toggle_recent_order_list(true);
		cur_pos.recent_order_list.status_field.set_value("Paid");
		cur_pos.recent_order_list.search_field.set_focus();
	}, 200);
})();
