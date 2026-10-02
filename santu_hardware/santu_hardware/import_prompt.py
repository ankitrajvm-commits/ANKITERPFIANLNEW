"""The prompt a shopkeeper hands to an AI to get their own Excel into shape.

Direct request, 2026-09-05: "jaise excel hai — use agar jaise hi saman
upload krne jaye to waha pe ek prompt option aaye ... wo excel ko sahi kr de
taki isme upload krne pe koi bug naa de ... qk hamesa to ye app claude se nh
chalega naa."

That last line is the whole point. Every messy supplier sheet fixed so far
was fixed by someone reading the code. This puts the rules of the importer
into a block of text the shop can paste into ANY assistant, along with the
actual shape of the file they are holding, so the fixing does not depend on
this session existing.

Two things are generated, deliberately together:
  * the CONTRACT — the exact columns this importer accepts, what each one
    means, and the rules that actually break an import (they are listed
    because they have each broken one);
  * a READING of the uploaded file — its real headers, its real first rows,
    and what looks wrong with it — so the assistant is fixing THIS sheet,
    not a hypothetical one.
"""

import frappe

# The columns the importer maps, in the order a person would type them.
# `key` is what the mapping screen calls the field; `why` is what it is for
# in the shop's own words, because "standard_rate" means nothing to anyone
# standing at a counter.
IMPORT_COLUMNS = [
	("Item Name", True, "Poora naam jaisa bill par chhapna chahiye. Brand + cheez + size, e.g. PRINCE UPVC ELBOW 3/4\""),
	("Item Code", False, "Apna short code, agar rakhte ho. Khaali chhod sakte ho — app khud bana lega."),
	("Item Group", False, "Category, e.g. Plumbing, Electrical, Paints."),
	("Brand", False, "PRINCE, SUPREME, BOSCH, ..."),
	("HSN Code", False, "GST HSN, 4 se 8 digit. Pata na ho to khaali."),
	("Purchase Price", False, "Jis rate par tumne khareeda (bina GST ke, jo tum khaata me likhte ho)."),
	("Selling Price", False, "Jis rate par bechte ho."),
	("MRP", False, "Packet par chhapa hua MRP, agar alag hai."),
	("Stock UOM", False, "Nos / Pcs / Kg / Mtr / Box / Bag / Pkt / Ltr / Set / Pair / Roll / Bundle"),
	("Opening Stock", False, "Abhi dukaan me kitna maal hai. Number, khaali = 0."),
	("Minimum Stock", False, "Itna se kam ho to 'running low' me dikhe."),
	("Barcode", False, "Agar barcode sticker lagate ho."),
	("Description", False, "Extra note. Zaroori nahi."),
]

# Each rule below exists because it actually broke an import.
RULES = [
	"Ek hi header row rakho, sheet ki PEHLI line me. Uske upar dukaan ka naam, logo, 'Price List 2026' — kuch bhi nahi hona chahiye.",
	"Ek row = ek item. Merged cells bilkul mat rakho.",
	"Rate wale column me sirf number: 155 ya 155.50. '₹ 155', '155/-', '155 per pc', 'Rs.155' — ye sab import todte hain.",
	"Qty bhi sirf number. '15 pcs' likha ho to 15 Qty me aur Pcs Stock UOM me daalo.",
	"Size ko naam ke andar hi rakho (PRINCE UPVC ELBOW 3/4\"), alag Size column mat banao — warna 3/4\" aur 1\" ek hi item ban jayenge.",
	"Item Name kabhi khaali na ho. Jis row me naam nahi, wo row hata do.",
	"Total, Sub Total, Grand Total, GST, CGST/SGST, 'Page 1', bank details — ye rows nikal do. Ye item nahi hain.",
	"Ek hi item do baar ho to ek hi rakho (jo rate sahi hai wo).",
	"Sirf EK sheet bhejo. Kai sheets hain to sabko ek me jod do.",
	"Column ke naam bilkul upar wali list jaise likho — spelling waisi hi.",
	"Jo column nahi pata, wo column hi mat banao. Khaali column se koi dikkat nahi, galat column se dikkat hai.",
]


def build_prompt(headers=None, sample_rows=None, file_name=None, total_rows=None) -> str:
	"""The full prompt. Works with no file at all (a blank-template prompt)
	and gets sharper when the uploaded sheet is passed in."""
	cols = "\n".join(
		f"  {name}{' (ZAROORI)' if req else ''} — {why}" for name, req, why in IMPORT_COLUMNS
	)
	rules = "\n".join(f"  {i}. {r}" for i, r in enumerate(RULES, 1))

	parts = [
		"Tum ek Excel/CSV ko theek karke doge, taaki wo Santu Hardware app ke",
		"\"Import Items\" screen me bina kisi error ke upload ho jaye.",
		"",
		"FINAL FILE IN COLUMNS KE SAATH HONI CHAHIYE (isi naam se, isi tarah):",
		cols,
		"",
		"NIYAM (inme se har ek isliye likha hai kyunki inhi se import toota hai):",
		rules,
		"",
	]

	if headers:
		parts += [
			"------------------------------------------------------------",
			f"MERI ABHI WALI FILE{f' ({file_name})' if file_name else ''}"
			+ (f", {total_rows} rows" if total_rows else "") + ":",
			"",
			"Iske column headers:",
			"  " + " | ".join(str(h) for h in headers),
			"",
		]
		if sample_rows:
			parts.append("Shuruaat ki kuch rows:")
			for r in sample_rows[:5]:
				if isinstance(r, dict):
					vals = [str(r.get(h, "")) for h in headers]
				else:
					vals = [str(v) for v in r]
				parts.append("  " + " | ".join(vals))
			parts.append("")
		problems = _diagnose(headers, sample_rows)
		if problems:
			parts += ["Jo dikkatein mujhe pehle se dikh rahi hain:"] + [f"  - {p}" for p in problems] + [""]
		parts += [
			"Is file ko upar wale format me badal kar do. Jo column samajh na aaye,",
			"uske baare me mujhse pooch lo — apne se andaza mat lagao, kyunki galat",
			"column me rate chala gaya to dukaan ka poora rate list galat ho jayega.",
			"Kaam hone ke baad ek line me bata dena ki tumne kya-kya badla.",
		]
	else:
		parts += [
			"Mai apni file agle message me bhejta hoon. Usko upar wale format me",
			"badal kar wapas do. Jo samajh na aaye, mujhse pooch lena — andaza mat lagana.",
		]
	return "\n".join(parts)


def _diagnose(headers, sample_rows):
	"""What is visibly wrong with this sheet, before anyone uploads it."""
	problems = []
	clean = [str(h or "").strip() for h in (headers or [])]
	lower = [h.lower() for h in clean]

	if not any(h for h in clean):
		problems.append("Pehli row me column ke naam hai hi nahi — lagta hai header row upar kahin aur hai.")
	if any(h.lower().startswith("unnamed") or h == "" for h in clean):
		problems.append("Kuch columns ke naam khaali hain (Unnamed) — inhe naam do ya hata do.")
	if not any("name" in h or "item" in h or "product" in h or "particular" in h for h in lower):
		problems.append("Koi 'Item Name' jaisa column nahi dikh raha — ye sabse zaroori column hai.")
	if any("size" == h or h.startswith("size") for h in lower):
		problems.append("Alag 'Size' column hai — size ko Item Name ke andar hi jodna hoga.")
	dupes = {h for h in lower if lower.count(h) > 1 and h}
	if dupes:
		problems.append(f"Ek hi naam ke do column hain: {', '.join(sorted(dupes))}")

	# Values that will not survive flt() on the way in.
	if sample_rows:
		bad = set()
		for r in sample_rows[:20]:
			values = r.values() if isinstance(r, dict) else r
			pairs = zip(clean, values) if not isinstance(r, dict) else r.items()
			for h, v in pairs:
				text = str(v or "")
				if not text:
					continue
				if any(k in str(h).lower() for k in ("price", "rate", "mrp", "qty", "stock", "amount")):
					if any(ch in text for ch in "₹$/-") or any(c.isalpha() for c in text):
						bad.add(f"'{h}' me number ke saath kuch aur bhi likha hai (jaise \"{text[:22]}\")")
		problems += sorted(bad)[:4]
	return problems


@frappe.whitelist()
def get_item_import_prompt(file_url: str = None):
	"""The prompt for the Import Items screen's "AI se Excel theek karwao"
	button. Reads the uploaded sheet when there is one, so the prompt
	describes the file in the shop's hands."""
	headers, rows, total, name = None, None, None, None
	if file_url:
		try:
			from santu_hardware.santu_hardware.utilities_api import _parse_tabular_file

			headers, rows = _parse_tabular_file(file_url)
			total = len(rows or [])
			name = file_url.rsplit("/", 1)[-1]
		except Exception:
			# A file too broken to read is exactly when this prompt is most
			# needed — fall back to the generic version rather than failing.
			headers = rows = total = None
	return {
		"prompt": build_prompt(headers, rows, name, total),
		"columns": [c[0] for c in IMPORT_COLUMNS],
		"read_file": bool(headers),
	}
