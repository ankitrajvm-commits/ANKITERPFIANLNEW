"""Recognising what an extracted line actually IS.

OCR and PDF parsers hand back a name as it was PRINTED on someone else's
bill — "PRINCE UPVC ELBOW 3/4 inch", "Prince u-pvc elbow 3/4\"", "PRINCE
UPVC ELB0W 3/4" with a zero for an O. All three are the item this shop
already stocks as PRINCE UPVC ELBOW 3/4". Imported blind they become three
new items, the stock splits three ways, and the counter starts seeing
duplicates in Product Search (2026-09-05 request: "thoda sa ai v daal do
unme ki wo sab items ko pehchan le").

This is the recognition layer. It is not a language model and does not
pretend to be — it is deterministic, offline, instant, and explains every
decision it makes, which matters more here than cleverness: an import that
silently merges the wrong two items is worse than one that asks.

Three passes, strongest evidence first:
  1. exact match on a normalised name;
  2. barcode / item code, when the line carried one;
  3. fuzzy similarity on the normalised name, but only above a threshold,
     and only when the SIZE tokens agree — "ELBOW 3/4" and "ELBOW 1"" are
     90% similar as strings and are completely different items on a shelf.

Every result carries `match_confidence` and `matched_item`, so the import
screen can show "ye purana item hai" versus "naya banega" instead of
deciding for the shopkeeper.
"""

import difflib
import re
from typing import Any, Dict, List, Optional

import frappe

# Words that say nothing about which item this is — dropping them makes
# "PRINCE PIPE UPVC 3/4 INCH" and "Prince UPVC Pipe 3/4\"" the same string.
NOISE_WORDS = {
	"inch", "inches", "in", "no", "nos", "pcs", "pc", "piece", "pieces",
	"mm", "size", "of", "the", "and", "with", "for", "new", "brand",
}

# OCR's usual confusions on a printed bill.
OCR_CONFUSIONS = str.maketrans({"0": "o", "1": "l", "5": "s", "8": "b", "|": "l"})

SIZE_RE = re.compile(r"\d+(?:\.\d+)?(?:\s*/\s*\d+)?")


def normalise(name: str) -> str:
	"""A name reduced to what actually identifies the item."""
	if not name:
		return ""
	s = name.lower()
	s = s.replace('"', " ").replace("''", " ").replace("'", " ")
	s = re.sub(r"[^a-z0-9/. ]+", " ", s)
	s = re.sub(r"\s*/\s*", "/", s)
	tokens = [t for t in s.split() if t and t not in NOISE_WORDS]
	return " ".join(tokens)


def size_tokens(name: str) -> set:
	"""The numbers and fractions in a name — 3/4, 1, 20, 5.

	Two hardware items differing only in size are different items, full
	stop. This is what stops a fuzzy match from merging them.
	"""
	return set(SIZE_RE.findall((name or "").replace(" ", "")))


def _catalogue() -> List[Dict[str, Any]]:
	items = frappe.get_all(
		"Item",
		filters={"disabled": 0},
		fields=["name as item_code", "item_name", "stock_uom", "gst_hsn_code"],
	)
	barcodes = {}
	for row in frappe.get_all("Item Barcode", fields=["parent", "barcode"]):
		if row.barcode:
			barcodes.setdefault(str(row.barcode).strip(), row.parent)
	for it in items:
		it["_norm"] = normalise(it.item_name or it.item_code)
		it["_sizes"] = size_tokens(it.item_name or it.item_code)
	return items, barcodes


def match_extracted_items(rows: List[Dict[str, Any]], threshold: float = 0.86) -> List[Dict[str, Any]]:
	"""Annotate extracted rows with the shop's own item, where there is one.

	Nothing is merged or created here — this only labels. The import screen
	decides what to do with the label, and the shopkeeper sees it first.
	"""
	if not rows:
		return rows
	items, barcodes = _catalogue()
	by_norm = {}
	for it in items:
		by_norm.setdefault(it["_norm"], it)
	by_code = {(it["item_code"] or "").strip().lower(): it for it in items}

	for row in rows:
		raw = (row.get("item_name") or "").strip()
		row["matched_item"] = None
		row["match_confidence"] = 0.0
		row["match_reason"] = ""
		row["match_options"] = []
		if not raw:
			continue

		# 1) barcode or item code carried on the line
		code = (row.get("item_code") or row.get("barcode") or "").strip()
		if code:
			hit = barcodes.get(code) or (by_code.get(code.lower()) or {}).get("item_code")
			if hit:
				row.update({"matched_item": hit, "match_confidence": 1.0, "match_reason": "barcode/code"})
				continue

		norm = normalise(raw)
		sizes = size_tokens(raw)
		# 2) exact, after normalising away punctuation and noise words. The
		#    size guard applies here too: normalisation strips the inch mark,
		#    so a stray glyph could in principle collapse two sizes onto one
		#    string, and merging a 3/4" fitting into a 1" one is the single
		#    most expensive mistake this file can make.
		hit = by_norm.get(norm)
		if hit and (not sizes or not hit["_sizes"] or sizes == hit["_sizes"]):
			row.update(
				{
					"matched_item": hit["item_code"],
					"match_confidence": 1.0,
					"match_reason": "naam bilkul milta hai",
				}
			)
			continue

		# 3) CONTAINMENT — the bill names the thing but not the brand.
		#    A mahajan's bill says "CPVC HAF ELBOW 1"" while the shop stocks
		#    it as "PRINCE CPVC HAF ELBOW 1"". Every word of the bill's name
		#    appears in the item's name, and the sizes agree: that is a far
		#    stronger signal than any similarity ratio (those two score 0.82
		#    and fall under the fuzzy threshold entirely).
		#
		#    But the shop carries the SAME fitting in PRINCE, SUPREME and
		#    SKIPPER. "CPVC HAF ELBOW 1"" is contained in all three, and
		#    picking one would put a purchase against the wrong brand's
		#    stock. So containment only decides when it lands on exactly ONE
		#    item; when it lands on several the row is left unmatched and
		#    carries `match_options` for the screen to ask about. Guessing
		#    silently between brands is the one outcome worse than not
		#    matching at all.
		q_tokens = set(norm.split())
		contained = [
			it for it in items
			if q_tokens and q_tokens.issubset(set(it["_norm"].split()))
			and (not sizes or not it["_sizes"] or sizes == it["_sizes"])
		]
		if len(contained) == 1:
			hit = contained[0]
			row.update(
				{
					"matched_item": hit["item_code"],
					"match_confidence": 0.95,
					"match_reason": f"'{hit['item_name']}' hi hai",
				}
			)
			_fill_gaps(row, hit)
			continue
		if len(contained) > 1:
			row["match_options"] = [
				{"item_code": it["item_code"], "item_name": it["item_name"]} for it in contained[:8]
			]
			row["match_reason"] = f"{len(contained)} items milte hain — brand chuniye"
			continue

		# 4) fuzzy — but the sizes must agree, and OCR digit/letter
		#    confusions are folded out before comparing.
		folded = norm.translate(OCR_CONFUSIONS)
		best, best_score = None, 0.0
		for it in items:
			if sizes and it["_sizes"] and sizes != it["_sizes"]:
				continue
			score = max(
				difflib.SequenceMatcher(None, norm, it["_norm"]).ratio(),
				difflib.SequenceMatcher(None, folded, it["_norm"].translate(OCR_CONFUSIONS)).ratio(),
			)
			if score > best_score:
				best, best_score = it, score
		if best and best_score >= threshold:
			row.update(
				{
					"matched_item": best["item_code"],
					"match_confidence": round(best_score, 3),
					"match_reason": f"'{best['item_name']}' se milta-julta",
				}
			)
			_fill_gaps(row, best)
	return rows


def _fill_gaps(row, item):
	"""Whatever OCR could not read, taken from the item we recognised."""
	if not row.get("stock_uom") and item.get("stock_uom"):
		row["stock_uom"] = item["stock_uom"]
	if not row.get("gst_hsn_code") and item.get("gst_hsn_code"):
		row["gst_hsn_code"] = item["gst_hsn_code"]
