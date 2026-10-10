"""Voice Model Training & Speech Processing API for Santu Hardware."""

from __future__ import annotations

import json
import re
import uuid
import frappe
from frappe.utils import cint
from frappe import _

DEFAULT_FRACTIONS = [
	# Hindi & Colloquial Numbers
	(r"\b(ek|aik)\b", "1"),
	(r"\b(do|doo)\b", "2"),
	(r"\b(teen|tin)\b", "3"),
	(r"\b(chaar|char)\b", "4"),
	(r"\b(paanch|panch)\b", "5"),
	(r"\b(chhah|chhe|che|chha)\b", "6"),
	(r"\b(saat|sat)\b", "7"),
	(r"\b(aath|ath)\b", "8"),
	(r"\b(nau|no)\b", "9"),
	(r"\b(das|dus)\b", "10"),
	(r"\b(gyarah|gyara)\b", "11"),
	(r"\b(barah|bara)\b", "12"),
	(r"\b(terah|tera)\b", "13"),
	(r"\b(chaudah|chouda)\b", "14"),
	(r"\b(pandrah|pandra)\b", "15"),
	(r"\b(solah|sola)\b", "16"),
	(r"\b(satrah|satra)\b", "17"),
	(r"\b(atharah|athara)\b", "18"),
	(r"\b(unnis|unees)\b", "19"),
	(r"\b(bees|bis)\b", "20"),
	(r"\b(pachees|pachis)\b", "25"),
	(r"\b(tees|tis)\b", "30"),
	(r"\b(chalis|chalees)\b", "40"),
	(r"\b(pachas|pachaas)\b", "50"),
	(r"\b(sau|so)\b", "100"),

	# Fractions & Dimensions
	(r"\b(aadha|adha|aadhe|adhe|half)\b", "1/2"),
	(r"\b(pauna|paun|paune|pawn)\b", "3/4"),
	(r"\b(sawa|sawaa)\b", "1-1/4"),
	(r"\b(dedh|dedha|derh|dhedh)\b", "1-1/2"),
	(r"\b(paune do|pune do)\b", "1-3/4"),
	(r"\b(dhai|dhaai|dhaiya)\b", "2-1/2"),
	(r"\b(sawa do)\b", "2-1/4"),
	(r"\b(paune teen)\b", "2-3/4"),
	(r"\b(sawa teen)\b", "3-1/4"),
	(r"\b(sadhe teen|sadhe tin)\b", "3-1/2"),
	(r"\b(paune char|paune chaar)\b", "3-3/4"),
	(r"\b(sawa char|sawa chaar)\b", "4-1/4"),
	(r"\b(sadhe char|sadhe chaar)\b", "4-1/2"),

	# Units & Measurements
	(r"\b(inchi|inche|inci|inch)\b", "inch"),
	(r"\b(sutar|soot|sut)\b", "sut"),
	(r"\b(fit|fut|foot|feet)\b", "feet"),
	(r"\b(kilo|keelo|kg)\b", "kg"),
	(r"\b(gram|giram|gm)\b", "g"),
	(r"\b(litar|leeter|lit|ltr)\b", "L"),
	(r"\b(meter|meeter|mtr)\b", "m"),
	(r"\b(mili|milimeter|mm)\b", "mm"),
	(r"\b(mod|model|modular|moduler)\b", "MOD"),
]

DEFAULT_HARDWARE_ALIASES = [
	{"phrase": "totaplas", "target": "TOTA PLIERS", "description": "Water pump / combination pliers"},
	{"phrase": "tota pilas", "target": "TOTA PLIERS", "description": "Plier variation"},
	{"phrase": "tota plas", "target": "TOTA PLIERS", "description": "Plier variation"},
	{"phrase": "pechkas", "target": "SCREW DRIVER", "description": "Hindi for screwdriver"},
	{"phrase": "pechkus", "target": "SCREW DRIVER", "description": "Colloquial screwdriver"},
	{"phrase": "skroodraivar", "target": "SCREW DRIVER", "description": "Phonetic screwdriver"},
	{"phrase": "hathodi", "target": "HAMMER", "description": "Hindi for hammer"},
	{"phrase": "hathoda", "target": "HAMMER", "description": "Hindi for hammer"},
	{"phrase": "martul", "target": "HAMMER", "description": "Regional hammer name"},
	{"phrase": "solusion", "target": "SOLVENT CEMENT", "description": "PVC / CPVC joint solvent"},
	{"phrase": "solusan", "target": "SOLVENT CEMENT", "description": "PVC / CPVC joint solvent"},
	{"phrase": "cpvc bond", "target": "SOLVENT CEMENT", "description": "CPVC chemical bond"},
	{"phrase": "fevikol", "target": "FEVICOL", "description": "Wood adhesive"},
	{"phrase": "fevicol", "target": "FEVICOL", "description": "Wood adhesive"},
	{"phrase": "favicol", "target": "FEVICOL", "description": "Colloquial fevicol"},
	{"phrase": "taar", "target": "WIRE", "description": "Electrical / binding wire"},
	{"phrase": "tarpin tel", "target": "TURPENTINE OIL", "description": "Paint thinner / oil"},
	{"phrase": "tarpeen", "target": "TURPENTINE OIL", "description": "Paint thinner / oil"},
	{"phrase": "tonti", "target": "BIB COCK", "description": "Water tap faucet"},
	{"phrase": "nal", "target": "BIB COCK", "description": "Water tap faucet"},
	{"phrase": "kabja", "target": "HINGES", "description": "Door / window hinges"},
	{"phrase": "kabza", "target": "HINGES", "description": "Door / window hinges"},
	{"phrase": "chitkani", "target": "TOWER BOLT", "description": "Door latch bolt"},
	{"phrase": "chitkini", "target": "TOWER BOLT", "description": "Door latch bolt"},
	{"phrase": "dhakkan", "target": "END CAP", "description": "Pipe end plug"},
	{"phrase": "chulha", "target": "GAS STOVE", "description": "LPG / Stove"},
	{"phrase": "jali", "target": "WIRE MESH", "description": "Filter / mosquito wire mesh"},
	{"phrase": "pech", "target": "SCREW", "description": "Screws / Fasteners"},
	{"phrase": "keel", "target": "WIRE NAILS", "description": "Iron / Steel nails"},
	{"phrase": "kanta", "target": "WIRE NAILS", "description": "Iron nails"},
	{"phrase": "gitti", "target": "GITTI", "description": "Wall rawl plug"},
	{"phrase": "giti", "target": "GITTI", "description": "Wall rawl plug"},
	{"phrase": "regmar", "target": "EMERY PAPER", "description": "Sandpaper / Emery sheet"},
	{"phrase": "retmal", "target": "EMERY PAPER", "description": "Sandpaper"},
	{"phrase": "mseal", "target": "M-SEAL", "description": "Epoxy compound"},
	{"phrase": "m-seal", "target": "M-SEAL", "description": "Epoxy compound"},
	{"phrase": "teflon", "target": "TEFLON TAPE", "description": "Thread seal tape"},
	{"phrase": "dhaga tape", "target": "TEFLON TAPE", "description": "Thread seal tape"},
	{"phrase": "varnish", "target": "VARNISH", "description": "Wood varnish"},
	{"phrase": "putty", "target": "WALL PUTTY", "description": "Wall putty"},
	{"phrase": "putti", "target": "WALL PUTTY", "description": "Wall putty"},
	{"phrase": "katori", "target": "WALL FLANGE", "description": "Tap wall flange"},
	{"phrase": "balb", "target": "BALL VALVE", "description": "Water ball valve"},
	{"phrase": "soket", "target": "SOCKET", "description": "Pipe socket coupler"},
	{"phrase": "sokit", "target": "SOCKET", "description": "Pipe socket coupler"},
	{"phrase": "elbo", "target": "ELBOW", "description": "Pipe elbow bend"},
	{"phrase": "albo", "target": "ELBOW", "description": "Pipe elbow bend"},
	{"phrase": "ti", "target": "TEE", "description": "Pipe tee joint"},
	{"phrase": "nipal", "target": "NIPPLE", "description": "Hex / barrel nipple"},
	{"phrase": "redyusar", "target": "REDUCER", "description": "Reducing socket"},
	{"phrase": "tanki", "target": "WATER TANK", "description": "Overhead water storage tank"},
]



def _get_or_create_settings():
	try:
		if not frappe.db.exists("DocType", "Santu Voice Settings"):
			return {
				"enabled": 1,
				"language": "hi-IN",
				"auto_unit_conversion": 1,
				"fuzzy_matching": 1,
				"rules_json": "[]",
			}
		return frappe.get_single("Santu Voice Settings")
	except Exception:
		return {
			"enabled": 1,
			"language": "hi-IN",
			"auto_unit_conversion": 1,
			"fuzzy_matching": 1,
			"rules_json": "[]",
		}


@frappe.whitelist()
def get_voice_model():
	"""Get complete voice model settings, trained rules and shop vocabulary."""
	settings = _get_or_create_settings()
	
	rules = []
	raw_rules = getattr(settings, "rules_json", None)
	if raw_rules:
		try:
			rules = json.loads(raw_rules)
		except Exception:
			rules = []

	# If rules are empty on first run, seed with default hardware aliases
	if not rules:
		rules = [
			{
				"id": str(uuid.uuid4())[:8],
				"phrase": item["phrase"],
				"target": item["target"],
				"item_code": "",
				"enabled": True,
				"is_system": True,
				"description": item.get("description", ""),
			}
			for item in DEFAULT_HARDWARE_ALIASES
		]
		try:
			if hasattr(settings, "rules_json"):
				settings.rules_json = json.dumps(rules)
				settings.save(ignore_permissions=True)
				frappe.db.commit()
		except Exception:
			pass

	# Get summary of shop catalog for voice context
	total_items = frappe.db.count("Item", {"disabled": 0, "is_stock_item": 1}) or 0
	sample_brands = frappe.db.sql_list("SELECT DISTINCT brand FROM `tabItem` WHERE IFNULL(brand, '') != '' AND disabled = 0 AND is_stock_item = 1 LIMIT 15")
	sample_groups = frappe.db.sql_list("SELECT DISTINCT item_group FROM `tabItem` WHERE IFNULL(item_group, '') != '' AND disabled = 0 AND is_stock_item = 1 LIMIT 15")

	return {
		"enabled": getattr(settings, "enabled", 1),
		"language": getattr(settings, "language", "hi-IN") or "hi-IN",
		"auto_unit_conversion": getattr(settings, "auto_unit_conversion", 1),
		"fuzzy_matching": getattr(settings, "fuzzy_matching", 1),
		"rules": rules,
		"catalog_summary": {
			"total_items": total_items,
			"brands": sample_brands,
			"groups": sample_groups,
		},
		"default_fractions": [
			{"from": pat.replace(r"\b", "").replace("(", "").replace(")", ""), "to": rep}
			for pat, rep in DEFAULT_FRACTIONS
		],
	}


@frappe.whitelist()
def save_voice_settings(enabled=1, language="hi-IN", auto_unit_conversion=1, fuzzy_matching=1):
	"""Save voice model global settings."""
	frappe.only_for(("System Manager", "Administrator"))
	settings = frappe.get_single("Santu Voice Settings")
	settings.enabled = frappe.utils.cint(enabled)
	settings.language = language or "hi-IN"
	settings.auto_unit_conversion = frappe.utils.cint(auto_unit_conversion)
	settings.fuzzy_matching = frappe.utils.cint(fuzzy_matching)
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": "ok", "message": _("Voice model settings saved.")}


@frappe.whitelist()
def save_voice_rule(phrase, target, item_code="", enabled=1, rule_id=None, description=""):
	"""Save or update a trained voice recognition rule."""
	frappe.only_for(("System Manager", "Administrator"))
	phrase = (phrase or "").strip().lower()
	target = (target or "").strip()
	
	if not phrase:
		frappe.throw(_("Spoken phrase is required."))
	if not target:
		frappe.throw(_("Target keyword / item is required."))

	settings = frappe.get_single("Santu Voice Settings")
	rules = []
	if settings.rules_json:
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	is_new = True
	target_rule_id = rule_id or str(uuid.uuid4())[:8]

	for r in rules:
		if r.get("id") == target_rule_id:
			r["phrase"] = phrase
			r["target"] = target
			r["item_code"] = item_code or ""
			r["enabled"] = bool(frappe.utils.cint(enabled))
			r["description"] = description or ""
			is_new = False
			break

	if is_new:
		rules.insert(
			0,
			{
				"id": target_rule_id,
				"phrase": phrase,
				"target": target,
				"item_code": item_code or "",
				"enabled": bool(frappe.utils.cint(enabled)),
				"is_system": False,
				"description": description or "",
			},
		)

	settings.rules_json = json.dumps(rules)
	settings.save(ignore_permissions=True)
	frappe.db.commit()

	return {"status": "ok", "rule_id": target_rule_id, "rules": rules}


@frappe.whitelist()
def delete_voice_rule(rule_id):
	"""Delete a trained voice recognition rule."""
	frappe.only_for(("System Manager", "Administrator"))
	settings = frappe.get_single("Santu Voice Settings")
	rules = []
	if settings.rules_json:
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	rules = [r for r in rules if r.get("id") != rule_id]
	settings.rules_json = json.dumps(rules)
	settings.save(ignore_permissions=True)
	frappe.db.commit()

	return {"status": "ok", "rules": rules}


@frappe.whitelist()
def auto_train_from_catalog():
	"""Auto-train voice aliases from the current Item Master, brands, and categories."""
	frappe.only_for(("System Manager", "Administrator"))
	
	items = frappe.db.sql(
		"""
		SELECT item_code, item_name, brand, item_group 
		FROM `tabItem` 
		WHERE disabled = 0 AND is_stock_item = 1
		LIMIT 1000
		""",
		as_dict=True,
	)

	settings = frappe.get_single("Santu Voice Settings")
	rules = []
	if settings.rules_json:
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	existing_phrases = {r.get("phrase", "").lower() for r in rules}
	new_rules_count = 0

	# 1. Generate rules for brands
	brands = {it.brand for it in items if it.brand}
	for b in brands:
		clean_b = b.strip()
		lower_b = clean_b.lower()
		if lower_b not in existing_phrases:
			rules.append({
				"id": str(uuid.uuid4())[:8],
				"phrase": lower_b,
				"target": clean_b,
				"item_code": "",
				"enabled": True,
				"is_system": False,
				"description": f"Brand keyword ({clean_b})",
			})
			existing_phrases.add(lower_b)
			new_rules_count += 1

	# 2. Generate rules for items with specific common patterns (e.g. PVC, CPVC, GI, LED, etc.)
	for it in items:
		code = it.item_code
		name = it.item_name or code
		
		# Simple phonetic aliases
		clean_name = re.sub(r"[^a-zA-Z0-9\s/.-]", " ", name).strip()
		lower_name = clean_name.lower()

		# Look for fractions in item name (e.g. 1/2, 3/4, 1-1/4, 1.5, 25mm)
		if "1/2" in lower_name and "adha " + lower_name.replace("1/2", "").strip() not in existing_phrases:
			phrase = "adha " + lower_name.replace("1/2", "").strip()
			if len(phrase) > 4 and phrase not in existing_phrases:
				rules.append({
					"id": str(uuid.uuid4())[:8],
					"phrase": phrase[:40],
					"target": name,
					"item_code": code,
					"enabled": True,
					"is_system": False,
					"description": f"Voice shortcut for {code}",
				})
				existing_phrases.add(phrase)
				new_rules_count += 1

	settings.rules_json = json.dumps(rules)
	settings.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "ok",
		"items_analyzed": len(items),
		"new_rules_added": new_rules_count,
		"total_rules": len(rules),
	}


def _tokenize(text):
	"""Extract clean alphanumeric tokens."""
	if not text:
		return []
	clean = re.sub(r"[^\w\d/.-]", " ", str(text).lower())
	return [t for t in clean.split() if len(t) > 0]


def _levenshtein_similarity(s1, s2):
	"""Calculate simple Levenshtein ratio between two short strings."""
	if s1 == s2:
		return 1.0
	if not s1 or not s2:
		return 0.0
	len1, len2 = len(s1), len(s2)
	matrix = [[0] * (len2 + 1) for _ in range(len1 + 1)]
	for i in range(len1 + 1):
		matrix[i][0] = i
	for j in range(len2 + 1):
		matrix[0][j] = j
	for i in range(1, len1 + 1):
		for j in range(1, len2 + 1):
			cost = 0 if s1[i - 1] == s2[j - 1] else 1
			matrix[i][j] = min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost,
			)
	dist = matrix[len1][len2]
	max_len = max(len1, len2)
	return 1.0 - (dist / max_len)


@frappe.whitelist()
def test_voice_query(query):
	"""Super-intelligent voice recognition query tester with multi-token permutation & confidence ranking."""
	raw = (query or "").strip()
	if not raw:
		return {"raw_query": "", "transformed_query": "", "rules_applied": [], "matched_items": []}

	transformed = raw.lower()
	rules_applied = []

	settings = _get_or_create_settings()
	auto_unit = getattr(settings, "auto_unit_conversion", 1)
	fuzzy_enabled = getattr(settings, "fuzzy_matching", 1)

	# 1. Apply Fractions and units conversion
	if auto_unit:
		for pat, rep in DEFAULT_FRACTIONS:
			if re.search(pat, transformed, flags=re.IGNORECASE):
				transformed = re.sub(pat, rep, transformed, flags=re.IGNORECASE)
				rules_applied.append(f"Unit conversion: '{pat}' → '{rep}'")

	# 2. Apply Custom Trained Voice Rules with Multi-token permutation matching
	rules = []
	raw_rules = getattr(settings, "rules_json", None)
	if raw_rules:
		try:
			rules = json.loads(raw_rules)
		except Exception:
			rules = []

	matched_rule_items = []
	query_tokens = set(_tokenize(transformed))

	# Exact & Substring Rule Pass
	for r in rules:
		if not r.get("enabled", True):
			continue
		phrase = (r.get("phrase") or "").strip().lower()
		target = (r.get("target") or "").strip()
		if not phrase:
			continue

		# Exact substring
		if phrase in transformed:
			transformed = transformed.replace(phrase, target)
			rules_applied.append(f"Trained Alias: '{phrase}' → '{target}'")
			if r.get("item_code"):
				matched_rule_items.append({
					"item_code": r.get("item_code"),
					"confidence": 0.99,
					"reason": f"Direct Trained Voice Alias ('{phrase}')",
				})
			# Update rule hit_count
			r["hit_count"] = r.get("hit_count", 0) + 1
			continue

		# Token permutation overlap (e.g. '12 mod box anchor' matches trained 'anchor 12 mod box')
		p_tokens = set(_tokenize(phrase))
		if p_tokens and p_tokens.issubset(query_tokens):
			transformed = f"{target} {transformed}".strip()
			rules_applied.append(f"Token Permutation Match: '{phrase}' → '{target}'")
			if r.get("item_code"):
				matched_rule_items.append({
					"item_code": r.get("item_code"),
					"confidence": 0.95,
					"reason": f"Permutation Match ('{phrase}')",
				})
			r["hit_count"] = r.get("hit_count", 0) + 1

	# Clean multiple spaces
	transformed = re.sub(r"\s+", " ", transformed).strip()
	active_tokens = _tokenize(transformed)

	# 3. Intelligent Multi-Layer Ranked Search across Catalog
	items_pool = frappe.db.sql(
		"""
		SELECT name as item_code, item_name, standard_rate, stock_uom, item_group, brand, description
		FROM `tabItem` 
		WHERE disabled = 0 
		LIMIT 1000
		""",
		as_dict=True,
	)

	scored_items = []
	seen_codes = set()

	# A. Add Direct Rule Matches with High Priority
	for mi in matched_rule_items:
		code = mi["item_code"]
		if code not in seen_codes:
			item_obj = next((it for it in items_pool if it["item_code"] == code), None)
			if item_obj:
				scored_items.append({
					"item_code": item_obj["item_code"],
					"item_name": item_obj["item_name"],
					"standard_rate": item_obj["standard_rate"],
					"stock_uom": item_obj["stock_uom"],
					"item_group": item_obj["item_group"],
					"brand": item_obj["brand"],
					"confidence_pct": int(mi["confidence"] * 100),
					"match_reason": mi["reason"],
					"score": mi["confidence"] * 100,
				})
				seen_codes.add(code)

	# B. Compute Multi-Token & Phonetic Overlap Score for All Shop Items
	for it in items_pool:
		code = it["item_code"]
		if code in seen_codes:
			continue

		name_tokens = set(_tokenize(it["item_name"]))
		code_tokens = set(_tokenize(it["item_code"]))
		brand_tokens = set(_tokenize(it["brand"]))
		all_item_tokens = name_tokens | code_tokens | brand_tokens

		# 1. Exact Token Overlap
		overlap = set(active_tokens) & all_item_tokens
		overlap_ratio = len(overlap) / max(1, len(active_tokens))

		# 2. Sequential & Substring bonus
		name_lower = (it["item_name"] or "").lower()
		code_lower = (it["item_code"] or "").lower()
		substring_bonus = 0.0
		if transformed in name_lower or transformed in code_lower:
			substring_bonus = 0.4
		elif any(t in name_lower for t in active_tokens):
			substring_bonus = 0.2

		# 3. Fuzzy phonetic similarity if enabled
		fuzzy_bonus = 0.0
		if fuzzy_enabled and not overlap:
			for q_tok in active_tokens:
				for n_tok in name_tokens:
					sim = _levenshtein_similarity(q_tok, n_tok)
					if sim > 0.75:
						fuzzy_bonus = max(fuzzy_bonus, sim * 0.3)

		total_score = (overlap_ratio * 0.5) + substring_bonus + fuzzy_bonus
		if total_score > 0.25:
			conf_pct = min(98, max(40, int(total_score * 100)))
			reason = "Keyword Token Match" if overlap_ratio > 0.5 else ("Phonetic Match" if fuzzy_bonus > 0 else "Catalog Search")
			scored_items.append({
				"item_code": it["item_code"],
				"item_name": it["item_name"],
				"standard_rate": it["standard_rate"],
				"stock_uom": it["stock_uom"],
				"item_group": it["item_group"],
				"brand": it["brand"],
				"confidence_pct": conf_pct,
				"match_reason": reason,
				"score": total_score * 100,
			})
			seen_codes.add(code)

	# Sort candidates by match score descending
	scored_items.sort(key=lambda x: x["score"], reverse=True)

	return {
		"raw_query": raw,
		"transformed_query": transformed,
		"rules_applied": rules_applied,
		"matched_items": scored_items[:8],
	}


@frappe.whitelist()
def train_item_voice_alias(item_code, phrase, audio_base64=None, audio_format="webm"):
	"""Train a voice phrase directly for a specific catalog item and persist local audio dataset."""
	frappe.only_for(("System Manager", "Administrator"))
	phrase = (phrase or "").strip().lower()
	if not phrase:
		frappe.throw(_("Spoken phrase is required."))

	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item does not exist: {0}").format(item_code))

	it = frappe.get_doc("Item", item_code)
	item_name = it.item_name or item_code

	# 1. Save local audio file & ML Manifest to disk dataset folder
	audio_file_rel = None
	audio_file_url = None
	file_bytes_len = 0
	
	if audio_base64:
		try:
			import base64
			import csv
			import os
			import time

			dataset_dir = frappe.get_site_path("public", "files", "voice_dataset")
			if not os.path.exists(dataset_dir):
				os.makedirs(dataset_dir, exist_ok=True)

			clean_b64 = audio_base64
			if "," in clean_b64:
				clean_b64 = clean_b64.split(",", 1)[1]

			raw_audio = base64.b64decode(clean_b64)
			file_bytes_len = len(raw_audio)
			ts = int(time.time())
			clean_code = re.sub(r"[^a-zA-Z0-9_-]", "_", item_code)
			filename = f"{clean_code}_{ts}.{audio_format or 'webm'}"
			full_filepath = os.path.join(dataset_dir, filename)

			with open(full_filepath, "wb") as f:
				f.write(raw_audio)

			audio_file_rel = os.path.join("voice_dataset", filename)
			audio_file_url = f"/files/voice_dataset/{filename}"

			# Update dataset index JSON
			index_path = os.path.join(dataset_dir, "dataset_index.json")
			index_records = []
			if os.path.exists(index_path):
				try:
					with open(index_path, "r", encoding="utf-8") as f:
						index_records = json.load(f)
				except Exception:
					index_records = []

			new_record = {
				"item_code": item_code,
				"item_name": item_name,
				"phrase": phrase,
				"filename": filename,
				"file_url": audio_file_url,
				"file_size": file_bytes_len,
				"created_at": frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M:%S"),
			}
			index_records.insert(0, new_record)

			with open(index_path, "w", encoding="utf-8") as f:
				json.dump(index_records, f, indent=2)

			# Also write standard ML Manifest CSV (Machine-learning ready)
			manifest_path = os.path.join(dataset_dir, "dataset_manifest.csv")
			csv_exists = os.path.exists(manifest_path)
			with open(manifest_path, "a", newline="", encoding="utf-8") as f_csv:
				writer = csv.writer(f_csv)
				if not csv_exists:
					writer.writerow(["filename", "item_code", "item_name", "phrase", "file_size_bytes", "created_at"])
				writer.writerow([filename, item_code, item_name, phrase, file_bytes_len, new_record["created_at"]])

		except Exception as e:
			frappe.log_error("Voice Dataset Audio Save Error", str(e))

	# 2. Update Voice Rules in Database with Self-Learning Hit Weighting
	settings = frappe.get_single("Santu Voice Settings")
	rules = []
	if settings.rules_json:
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	# Check if exact rule already exists
	found = False
	new_id = str(uuid.uuid4())[:8]
	for r in rules:
		if r.get("phrase", "").lower() == phrase:
			r["target"] = item_name
			r["item_code"] = item_code
			r["enabled"] = True
			r["confidence_score"] = 1.0
			r["hit_count"] = r.get("hit_count", 0) + 1
			r["description"] = f"Trained shortcut for {item_name}"
			if audio_file_url:
				r["audio_url"] = audio_file_url
			found = True
			break

	if not found:
		rules.insert(
			0,
			{
				"id": new_id,
				"phrase": phrase,
				"target": item_name,
				"item_code": item_code,
				"enabled": True,
				"is_system": False,
				"confidence_score": 1.0,
				"hit_count": 1,
				"audio_url": audio_file_url,
				"description": f"Trained shortcut for {item_name}",
			},
		)

	settings.rules_json = json.dumps(rules)
	settings.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "ok",
		"item_code": item_code,
		"item_name": item_name,
		"phrase": phrase,
		"audio_url": audio_file_url,
		"file_size": file_bytes_len,
		"total_rules": len(rules),
	}



@frappe.whitelist()
def get_catalog_items_for_training(item_group=None, search=None, status="all", limit=1000):
	"""Get all shop items with their voice training status and aliases."""
	settings = _get_or_create_settings()
	rules = []
	if getattr(settings, "rules_json", None):
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	# Map rules by item_code and by target/phrase
	item_rules_map = {}
	for r in rules:
		code = r.get("item_code")
		if code:
			item_rules_map.setdefault(code, []).append(r)
		else:
			target = (r.get("target") or "").lower()
			if target:
				item_rules_map.setdefault(target, []).append(r)

	conditions = ["disabled = 0", "is_stock_item = 1"]
	values = []

	if item_group and item_group != "All Groups":
		conditions.append("item_group = %s")
		values.append(item_group)

	if search:
		conditions.append("(item_code LIKE %s OR item_name LIKE %s OR brand LIKE %s)")
		kw = f"%{search.strip()}%"
		values.extend([kw, kw, kw])

	sql = f"""
		SELECT name as item_code, item_name, item_group, brand, standard_rate, stock_uom
		FROM `tabItem`
		WHERE {' AND '.join(conditions)}
		ORDER BY item_name ASC
		LIMIT {cint(limit) or 1000}
	"""
	raw_items = frappe.db.sql(sql, tuple(values), as_dict=True)

	items = []
	trained_count = 0
	for it in raw_items:
		code = it["item_code"]
		name = (it["item_name"] or "").lower()
		
		# Find matched rules
		aliases = item_rules_map.get(code, [])
		if not aliases and name in item_rules_map:
			aliases = item_rules_map.get(name, [])

		alias_phrases = [a.get("phrase") for a in aliases if a.get("phrase")]
		is_trained = len(alias_phrases) > 0
		if is_trained:
			trained_count += 1

		it_data = {
			"item_code": it["item_code"],
			"item_name": it["item_name"] or it["item_code"],
			"item_group": it["item_group"] or "",
			"brand": it["brand"] or "",
			"standard_rate": it["standard_rate"] or 0,
			"stock_uom": it["stock_uom"] or "Nos",
			"aliases": alias_phrases,
			"is_trained": is_trained,
		}

		if status == "trained" and not is_trained:
			continue
		if status == "untrained" and is_trained:
			continue

		items.append(it_data)

	all_groups = ["All Groups"] + frappe.db.sql_list(
		"SELECT DISTINCT item_group FROM `tabItem` WHERE IFNULL(item_group, '') != '' ORDER BY item_group ASC"
	)

	return {
		"items": items,
		"total_count": len(raw_items),
		"trained_count": trained_count,
		"untrained_count": len(raw_items) - trained_count,
		"groups": all_groups,
	}


@frappe.whitelist()
def train_item_voice_alias(item_code, phrase, audio_base64=None, audio_format="webm"):
	"""Train a voice phrase directly for a specific catalog item and persist local audio file."""
	frappe.only_for(("System Manager", "Administrator"))
	phrase = (phrase or "").strip().lower()
	if not phrase:
		frappe.throw(_("Spoken phrase is required."))

	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item does not exist: {0}").format(item_code))

	it = frappe.get_doc("Item", item_code)
	item_name = it.item_name or item_code

	# 1. Save local audio file to disk dataset folder if provided
	audio_file_rel = None
	audio_file_url = None
	file_bytes_len = 0
	
	if audio_base64:
		try:
			import base64
			import os
			import time

			dataset_dir = frappe.get_site_path("public", "files", "voice_dataset")
			if not os.path.exists(dataset_dir):
				os.makedirs(dataset_dir, exist_ok=True)

			# Clean base64 header if present (e.g. data:audio/webm;base64,...)
			clean_b64 = audio_base64
			if "," in clean_b64:
				clean_b64 = clean_b64.split(",", 1)[1]

			raw_audio = base64.b64decode(clean_b64)
			file_bytes_len = len(raw_audio)
			ts = int(time.time())
			clean_code = re.sub(r"[^a-zA-Z0-9_-]", "_", item_code)
			filename = f"{clean_code}_{ts}.{audio_format or 'webm'}"
			full_filepath = os.path.join(dataset_dir, filename)

			with open(full_filepath, "wb") as f:
				f.write(raw_audio)

			audio_file_rel = os.path.join("voice_dataset", filename)
			audio_file_url = f"/files/voice_dataset/{filename}"

			# Update dataset index JSON
			index_path = os.path.join(dataset_dir, "dataset_index.json")
			index_records = []
			if os.path.exists(index_path):
				try:
					with open(index_path, "r", encoding="utf-8") as f:
						index_records = json.load(f)
				except Exception:
					index_records = []

			index_records.insert(0, {
				"item_code": item_code,
				"item_name": item_name,
				"phrase": phrase,
				"filename": filename,
				"file_url": audio_file_url,
				"file_size": file_bytes_len,
				"created_at": frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M:%S"),
			})

			with open(index_path, "w", encoding="utf-8") as f:
				json.dump(index_records, f, indent=2)

		except Exception as e:
			frappe.log_error("Voice Dataset Audio Save Error", str(e))

	# 2. Update Voice Rules in Database
	settings = frappe.get_single("Santu Voice Settings")
	rules = []
	if settings.rules_json:
		try:
			rules = json.loads(settings.rules_json)
		except Exception:
			rules = []

	# Check if exact rule already exists
	found = False
	new_id = str(uuid.uuid4())[:8]
	for r in rules:
		if r.get("phrase", "").lower() == phrase:
			r["target"] = item_name
			r["item_code"] = item_code
			r["enabled"] = True
			r["description"] = f"Trained shortcut for {item_name}"
			if audio_file_url:
				r["audio_url"] = audio_file_url
			found = True
			break

	if not found:
		rules.insert(
			0,
			{
				"id": new_id,
				"phrase": phrase,
				"target": item_name,
				"item_code": item_code,
				"enabled": True,
				"is_system": False,
				"audio_url": audio_file_url,
				"description": f"Trained shortcut for {item_name}",
			},
		)

	settings.rules_json = json.dumps(rules)
	settings.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "ok",
		"item_code": item_code,
		"item_name": item_name,
		"phrase": phrase,
		"audio_url": audio_file_url,
		"file_size": file_bytes_len,
		"total_rules": len(rules),
	}


@frappe.whitelist()
def get_voice_dataset_stats():
	"""Get stats of local audio recordings and dataset folder."""
	import os

	dataset_dir = frappe.get_site_path("public", "files", "voice_dataset")
	if not os.path.exists(dataset_dir):
		return {
			"total_recordings": 0,
			"disk_usage_mb": 0,
			"folder_path": dataset_dir,
			"recent_samples": [],
		}

	index_path = os.path.join(dataset_dir, "dataset_index.json")
	samples = []
	if os.path.exists(index_path):
		try:
			with open(index_path, "r", encoding="utf-8") as f:
				samples = json.load(f)
		except Exception:
			samples = []

	# Compute folder size
	total_bytes = 0
	file_count = 0
	for root, dirs, files in os.walk(dataset_dir):
		for f in files:
			if not f.startswith("."):
				file_count += 1
				fp = os.path.join(root, f)
				try:
					total_bytes += os.path.getsize(fp)
				except Exception:
					pass

	return {
		"total_recordings": len(samples) or file_count,
		"disk_usage_mb": round(total_bytes / (1024 * 1024), 2),
		"folder_path": dataset_dir,
		"recent_samples": samples[:20],
	}


