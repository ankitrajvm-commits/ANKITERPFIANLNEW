/* Item ki pehchaan rang se — poore system me sirf yahi ek jagah.
 *
 * CPVC = halka pila (2026-08-27), UPVC = halka gulaabi (2026-08-30) — dono
 * ab isi generic colour-wheel pipeline se guzarte hain (2026-09-03 follow-up:
 * "ye wali colour schema... item colour yaha se choose hoga, light theme
 * preferred qk agar dark hoga to item nahi dikhega list me"). Koi bhi rang
 * chuna ho, yahan hamesha uska HALKA (light/pastel) tint banaya jaata hai —
 * raw chuna hua rang seedha background nahi banta, warna ek dark colour
 * chun lene se poori row ka text hi padhna mushkil ho jaata.
 *
 * Rang kahin item par store nahi hota. Har baar jab list banti hai, item ka
 * naam/code padh kar yahin decide hota hai — isliye kal jo naya CPVC ya UPVC
 * item banega, wo apne aap rangeen ho jaayega. Koi list update nahi karni.
 *
 * Pehle ye rule 12 files me copy tha. Ek jagah laaya gaya hai kyunki is
 * codebase me copy-paste kiya hua rule pehle bhi chupchaap aadha-adhoora reh
 * chuka hai (quick_create_item, native form whitelist) — rule badle to sab
 * screens ek saath badlein.
 *
 * Match jaan-boojh kar SAKHT hai — sirf seedha "cpvc"/"upvc" (chhote/bade
 * akshar dono chalega). Beech me dot/space allow karne ki koshish ki thi, par
 * usse "PLASTIC PVC PIPE" jaisa naam galti se rangeen ho jaata hai
 * ("plasti-C PVC" me c-p-v-c aa jaata hai). Dukaan ke item seedha "CPVC" /
 * "UPVC" hi likhte hain, isliye sakht match hi theek hai.
 *
 * CPVC pehle dekha jaata hai. Dono kabhi ek naam me nahi aate, par agar aa
 * gaye to ek row ko do rang nahi mil sakte — pehla jeet jaata hai, aur ye
 * tay hona chahiye, sanyog nahi.
 */
window.santu_is_cpvc_item = function (item_code, item_name) {
	return /cpvc/i.test(item_code || "") || /cpvc/i.test(item_name || "");
};

window.santu_is_upvc_item = function (item_code, item_name) {
	return /upvc/i.test(item_code || "") || /upvc/i.test(item_name || "");
};

// The raw hue CPVC/UPVC are built from — same wheel every custom rule picks
// from (Utilities > Item Highlight Rules), just fixed instead of user-chosen.
var SANTU_HL_CPVC_HEX = "#f5d90a";
var SANTU_HL_UPVC_HEX = "#ec4899";

/* Blend a hex colour toward white by `amount` (0 = colour as-is, 1 = pure
 * white). Always used at a heavy amount for the row background itself, so
 * whatever hue someone picks on the wheel — including a dark, saturated
 * one — the actual background stays pale enough for black text to read. */
function santu_hl_lighten(hex, amount) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
	if (!m) return "#ffffff";
	const num = parseInt(m[1], 16);
	const r = (num >> 16) & 255;
	const g = (num >> 8) & 255;
	const b = num & 255;
	const mix = (c) => Math.round(c + (255 - c) * amount);
	return "#" + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/* The floor every row tint is blended to, and the clamp that ENFORCES it.
 *
 * This is deliberately a function and not just a number to copy. The row
 * colour has now gone wrong twice the same way — CPVC yellow (2026-08-31)
 * and UPVC pink (2026-09-04) — both times because one state was blended too
 * little and painted a solid, shouty band across the row. The selected state
 * was the worst offender at 0.7: on a bill the row being worked on is ALWAYS
 * selected, so that colour was on screen permanently rather than flashing by.
 *
 * Anything routed through here can only ever produce a pale tint, whatever
 * hue is on the wheel and whatever amount a future edit passes in. If you
 * want a stronger "this is the current row" signal, add a border or an
 * accent bar (there is one on the selected row's first cell) — do NOT lower
 * this floor.
 */
var SANTU_HL_MIN_BLEND = 0.82;

function santu_hl_row_tint(hex, amount) {
	const safe = Math.min(1, Math.max(SANTU_HL_MIN_BLEND, Number(amount) || 0));
	return santu_hl_lighten(hex, safe);
}

// Class name + <style> rule are generated the first time a hex is actually
// needed, then cached — a page with 300 items but 2 colours only ever
// injects 2 rules, not 300.
var santu_hl_injected = {};

function santu_hl_class_for(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
	const norm = m ? m[1].toLowerCase() : "d9d9d9";
	const slug = `hex-${norm}`;
	if (santu_hl_injected[slug]) return slug;
	santu_hl_injected[slug] = true;

	// How far each state is blended toward white. These are a floor, not a
	// preference: the row must stay a pale tint in EVERY state, whatever hue
	// is on the wheel.
	//
	// The selected state used to be 0.7, which turned UPVC pink into
	// rgb(249,200,224) — a solid, shouty pink across the whole row. On a bill
	// the row being worked on is ALWAYS the selected one, so the counter saw
	// that colour permanently, not as a passing highlight; Ankit flagged it
	// twice (CPVC yellow on 2026-08-31, UPVC pink on 2026-09-04). For scale,
	// the app's own selection colour for an ordinary row is #eff6ff — barely
	// tinted. A coloured row must not be dramatically louder than that just
	// because it is coloured.
	//
	// Keep every value >= SANTU_HL_MIN_BLEND. Anything below it lets a
	// saturated or dark hue from Utilities > Item Highlight Rules paint a row
	// the text can no longer be read on, which is the same bug wearing a
	// different colour.
	// base stays where it was — the pale tint is the whole point of the
	// feature and it was never the complaint. Only the deepening on
	// hover/selection is pulled back, into a gentle progression.
	const base = santu_hl_row_tint("#" + norm, 0.88);
	const hover = santu_hl_row_tint("#" + norm, 0.85);
	const selected = santu_hl_row_tint("#" + norm, SANTU_HL_MIN_BLEND);

	let style = document.getElementById("santu-hl-dynamic-styles");
	if (!style) {
		style = document.createElement("style");
		style.id = "santu-hl-dynamic-styles";
		document.head.appendChild(style);
	}
	style.appendChild(document.createTextNode(`
tr.santu-hl-${slug}-row.santu-hl-${slug}-row { background: ${base}; }
tr.santu-hl-${slug}-row.santu-hl-${slug}-row:hover { background: ${hover}; }
tr.santu-hl-${slug}-row.santu-hl-${slug}-row.is-selected { background: ${selected}; }
tr.santu-hl-${slug}-row.santu-hl-${slug}-row.is-selected > td:first-child { box-shadow: inset 3px 0 0 0 #${norm}; }
.santu-hl-${slug}-dd-row.santu-hl-${slug}-dd-row { background: ${base}; }
.santu-hl-${slug}-dd-row.santu-hl-${slug}-dd-row:hover,
.santu-hl-${slug}-dd-row.santu-hl-${slug}-dd-row .santu-si2-dd-row-main:hover { background: ${hover}; }
`));
	return slug;
}

/* User-defined rules (Utilities > Item Highlight Rules). Loaded into
 * frappe.boot at page load (item_highlight_api.py extend_bootinfo) so it's
 * already here before the first item list renders — no async wait, same as
 * the CPVC/UPVC rule below always was.
 *
 * Checked BEFORE the hardcoded CPVC/UPVC rule, top to bottom, first match
 * wins — so a custom rule can override the built-in colours if someone
 * really wants CPVC in a different shade.
 */
window.santu_item_highlight_hex = function (item_code, item_name) {
	const rules = (frappe.boot && frappe.boot.santu_item_highlight_rules) || [];
	const code = (item_code || "").toLowerCase();
	const name = (item_name || "").toLowerCase();
	for (const rule of rules) {
		const needle = (rule.value || "").toLowerCase();
		if (!needle) continue;
		const hit = rule.match_type === "starts_with"
			? code.startsWith(needle) || name.startsWith(needle)
			: code.includes(needle) || name.includes(needle);
		if (hit) return rule.color || SANTU_HL_CPVC_HEX;
	}
	if (window.santu_is_cpvc_item(item_code, item_name)) return SANTU_HL_CPVC_HEX;
	if (window.santu_is_upvc_item(item_code, item_name)) return SANTU_HL_UPVC_HEX;
	return "";
};

/* Table ki row pe lagane wali class — `${santu_item_row_class(code, name)}`
 * seedha <tr class="..."> me daal do. Koi match na ho to khaali string. */
window.santu_item_row_class = function (item_code, item_name) {
	const hex = window.santu_item_highlight_hex(item_code, item_name);
	return hex ? `santu-hl-${santu_hl_class_for(hex)}-row` : "";
};

/* Search ki suggestion list ke liye — wahan row <div> hoti hai, <tr> nahi,
 * isliye uski apni class hai. */
window.santu_item_dd_class = function (item_code, item_name) {
	const hex = window.santu_item_highlight_hex(item_code, item_name);
	return hex ? `santu-hl-${santu_hl_class_for(hex)}-dd-row` : "";
};

/* Purane naam — bahar ke kisi bhi bache hue caller ke liye. Naya code
 * santu_item_row_class / santu_item_dd_class hi use kare, warna UPVC us
 * screen pe chhoot jaayega. */
window.santu_cpvc_row_class = window.santu_item_row_class;
window.santu_cpvc_dd_class = window.santu_item_dd_class;
