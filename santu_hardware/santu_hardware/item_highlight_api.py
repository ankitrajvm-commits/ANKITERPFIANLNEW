"""Configurable item-name colour rules (2026-09-03 request: "agar mai koi v
saaman ko new colour dena chahu to wo ho jaye ... item name start with -
this, then ye colour apply, item name include this then ye colour apply" —
followed by "yaha se colour choose hoga [colour wheel], light theme
preferred, warna item nahi dikhega list me").

Rules are stored on the "Santu Item Highlight Settings" single (a "Santu
Item Highlight Rule" child row per rule) and read by every item-list screen
via frappe.boot at page load. The colour itself is a free hex value picked
from the doctype's native "Colour" (colour-wheel) field — santu_item_highlight.js
is the one place that turns a raw hex into an actual light/pastel tint (so
text always stays readable regardless of how saturated or dark the picked
colour is) and a CSS class per row. Kept out of utilities_api.py because
this is its own settings screen, not part of the Excel/PDF import flow.
"""

import re

import frappe

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_COLOR = "#f5d90a"


def _clean_hex(color: str) -> str:
	color = (color or "").strip()
	return color if HEX_RE.match(color) else DEFAULT_COLOR


def _rules_doc():
	return frappe.get_cached_doc("Santu Item Highlight Settings")


def get_item_highlight_rules() -> list:
	doc = _rules_doc()
	rules = []
	for r in doc.rules or []:
		if not r.enabled or not (r.value or "").strip():
			continue
		rules.append({
			"match_type": "starts_with" if r.match_type == "Starts With" else "contains",
			"value": r.value.strip(),
			"color": _clean_hex(r.color),
		})
	return rules


def extend_bootinfo(bootinfo):
	# Available synchronously the moment any Desk page's JS runs — no extra
	# round trip before the first item list can colour its rows.
	bootinfo.santu_item_highlight_rules = get_item_highlight_rules()


@frappe.whitelist()
def fetch_item_highlight_rules():
	doc = frappe.get_single("Santu Item Highlight Settings")
	return [
		{
			"name": r.name,
			"enabled": r.enabled,
			"match_type": r.match_type,
			"value": r.value,
			"color": _clean_hex(r.color),
		}
		for r in doc.rules or []
	]


@frappe.whitelist()
def save_item_highlight_rules(rules):
	frappe.only_for(("System Manager", "Administrator"))
	rules = frappe.parse_json(rules) if isinstance(rules, str) else (rules or [])

	doc = frappe.get_single("Santu Item Highlight Settings")
	doc.set("rules", [])
	for r in rules:
		value = (r.get("value") or "").strip()
		if not value:
			continue
		match_type = "Starts With" if r.get("match_type") in ("Starts With", "starts_with") else "Contains"
		doc.append("rules", {
			"enabled": 1 if r.get("enabled", 1) else 0,
			"match_type": match_type,
			"value": value,
			"color": _clean_hex(r.get("color")),
		})
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return fetch_item_highlight_rules()
