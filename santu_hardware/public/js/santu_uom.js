/* global frappe */
// One source of truth for "which units can this row be in, and what happens
// to rate/qty when I switch".
//
// Every document screen used to build its own unit list, and each built a
// DIFFERENT one -- Billing asked the server for every unit, while Sale
// Invoice / Purchase Invoice / Sales Order / Purchase Order / Delivery
// Challan quietly built `[row.uom, row.stock_uom]` in the browser. That is
// why a Kg item showed only "Kg" on those screens and could not be billed in
// grams (2026-08-30: "yaha pe Kg ko mai gram me nh kar paa raha hu ... sab
// jegeh unit change ka feature de").
//
// Screens must go through santu_uom.list()/convert() rather than assembling
// unit lists themselves, so a fix here fixes every screen at once.
window.santu_uom = (function () {
	const cache = {};

	function normalise(options, fallback_uom) {
		const out = [];
		const seen = new Set();
		(options || []).forEach((o) => {
			const uom = typeof o === "string" ? o : o && o.uom;
			if (!uom || seen.has(uom)) return;
			seen.add(uom);
			out.push({ uom, conversion_factor: (typeof o === "object" && Number(o.conversion_factor)) || 1 });
		});
		if (!out.length && fallback_uom) out.push({ uom: fallback_uom, conversion_factor: 1 });
		return out;
	}

	function list(item_code, fallback_uom) {
		if (!item_code) return Promise.resolve(normalise([], fallback_uom));
		if (cache[item_code]) return Promise.resolve(cache[item_code]);
		return frappe
			.call({ method: "santu_hardware.santu_hardware.api.item_uoms", args: { item_code } })
			.then((r) => {
				const opts = normalise(r && r.message, fallback_uom);
				// Only cache a real answer; an empty list is usually a hiccup
				// and caching it would freeze the dropdown for the session.
				if (opts.length) cache[item_code] = opts;
				return opts;
			})
			.catch(() => normalise([], fallback_uom));
	}

	// Load several rows' units in ONE request. Reopening a 30-line document
	// otherwise fires 30 calls before the table can be drawn.
	function prime(item_codes) {
		const want = Array.from(new Set((item_codes || []).filter((c) => c && !cache[c])));
		if (!want.length) return Promise.resolve(cache);
		return frappe
			.call({ method: "santu_hardware.santu_hardware.api.items_uoms", args: { item_codes: JSON.stringify(want) } })
			.then((r) => {
				const map = (r && r.message) || {};
				Object.keys(map).forEach((code) => {
					const opts = normalise(map[code]);
					if (opts.length) cache[code] = opts;
				});
				return cache;
			})
			.catch(() => cache);
	}

	function factor(options, uom) {
		const hit = (options || []).find((o) => (o.uom || o) === uom);
		return (hit && Number(hit.conversion_factor)) || 1;
	}

	// A conversion_factor is "how many STOCK units sit in one of this unit"
	// -- Box = 25 means one Box is 25 pieces.
	//
	// Switching unit must leave the row meaning the same real thing, and the
	// two halves move in OPPOSITE directions:
	//   quantity/stock scale by old/new  (1 Kg  -> 1000 g)
	//   rate           scales by new/old  (1600/Kg -> 1.60/g)
	// so qty x rate -- the amount the customer pays -- does not move at all.
	// Scaling both the same way (the old per-screen code did) turned 1 Kg at
	// 1600 into 1000 g at 16 lakh.
	function convert(row, new_uom, options) {
		// "None" -- just clears the unit label, qty/rate are left exactly as
		// they are (there's no factor to convert against).
		if (!new_uom) {
			row.uom = "";
			return row;
		}
		const opts = options && options.length ? options : row.uom_options;
		const old_cf = factor(opts, row.uom);
		const new_cf = factor(opts, new_uom);
		if (new_cf && old_cf && new_cf !== old_cf) {
			const qty_k = old_cf / new_cf;
			const rate_k = new_cf / old_cf;
			if (row.qty != null) row.qty = row.qty * qty_k;
			if (row.available_qty != null) row.available_qty = row.available_qty * qty_k;
			if (row.rate != null) row.rate = row.rate * rate_k;
			if (row.purchase_rate != null) row.purchase_rate = row.purchase_rate * rate_k;
			row.conversion_factor = new_cf;
		}
		row.uom = new_uom;
		return row;
	}

	// Fill an existing <select> with the item's full unit list once the
	// server answers, without waiting for it to draw the table.
	// Fill an existing <select> with the item's full unit list once the
	// server answers, without holding up the table's first draw.
	// opts.extra_html keeps a screen's own trailing entry (Purchase Invoice's
	// "+ Naya Unit") from being wiped when the real list lands.
	function fill_select($select, item_code, current_uom, opts) {
		opts = opts || {};
		list(item_code, current_uom).then((options) => {
			if (!$select || !$select.length || !options.length) return;
			// Label shows the short form ("Nos" -> "Pcs") so it fits a narrow
			// table column without overlapping the native select arrow; the
			// option's real `value` stays the full uom name Frappe expects
			// (2026-09-03: "unit me no jo hai wo overlap kar raha").
			const none_html = opts.no_none ? "" : `<option value="">${__("None")}</option>`;
			$select.html(
				none_html +
					options
						.map(
							(o) =>
								`<option value="${frappe.utils.escape_html(o.uom)}" ${o.uom === current_uom ? "selected" : ""}>${frappe.utils.escape_html(abbr(o.uom))}</option>`
						)
						.join("") + (opts.extra_html || "")
			);
			$select.val(current_uom || "");
			if (opts.on_ready) opts.on_ready(options);
		});
		return $select;
	}

	function dialog(row, on_done) {
		list(row.item_code, row.uom).then((opts) => {
			row.uom_options = opts;
			const d = new frappe.ui.Dialog({
				title: __("Change Unit"),
				fields: [
					{
						fieldtype: "Select",
						fieldname: "uom",
						label: __("Unit"),
						options: opts.map((o) => o.uom).join("\n"),
						default: row.uom,
					},
				],
				primary_action_label: __("OK"),
				primary_action: (v) => {
					convert(row, v.uom, opts);
					d.hide();
					if (on_done) on_done(row);
				},
			});
			d.show();
		});
	}

	// Short forms for a unit shown in a table/row — "Nos" -> "Pcs", "Foot"
	// -> "Ft", etc (2026-09-03 direct request: "item me sare nos ko pcs ya
	// proper abbreviation se replace kr do"). Mirrors UOM_ABBR in
	// api.py::uom_abbr exactly — that one runs server-side for printed
	// bills, this one runs client-side for the on-screen Items/Stock lists;
	// add a new unit in both places together, never just one.
	const UOM_ABBR = {
		nos: "Pcs",
		piece: "Pcs",
		pcs: "Pcs",
		foot: "Ft",
		feet: "Ft",
		ft: "Ft",
		meter: "Mtr",
		metre: "Mtr",
		mtr: "Mtr",
		kg: "Kg",
		kilogram: "Kg",
		gram: "Gm",
		gm: "Gm",
		litre: "Ltr",
		liter: "Ltr",
		ltr: "Ltr",
		box: "Box",
		dozen: "Dzn",
		pair: "Pair",
		set: "Set",
		bag: "Bag",
		bundle: "Bdl",
		roll: "Roll",
		packet: "Pkt",
		unit: "Unit",
	};
	function abbr(uom) {
		if (!uom) return "";
		return UOM_ABBR[String(uom).trim().toLowerCase()] || uom;
	}

	return { list, prime, factor, convert, dialog, fill_select, abbr, _cache: cache };
})();
