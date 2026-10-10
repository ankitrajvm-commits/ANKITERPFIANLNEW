/// Port of api.py's UOM_ABBR / uom_abbr() — the printed short form of a
/// unit ("Foot" -> "Ft", "Nos" -> "Pcs"). Kept as its own file so the bill
/// built here prints the same unit text the PC bill does; an unknown unit
/// passes through unchanged rather than disappearing.
const Map<String, String> kUomAbbr = {
  'nos': 'Pcs',
  'piece': 'Pcs',
  'pcs': 'Pcs',
  'foot': 'Ft',
  'feet': 'Ft',
  'ft': 'Ft',
  'meter': 'Mtr',
  'metre': 'Mtr',
  'mtr': 'Mtr',
  'kg': 'Kg',
  'kilogram': 'Kg',
  'gram': 'Gm',
  'gm': 'Gm',
  'litre': 'Ltr',
  'liter': 'Ltr',
  'ltr': 'Ltr',
  'box': 'Box',
  'dozen': 'Dzn',
  'pair': 'Pair',
  'set': 'Set',
  'bag': 'Bag',
  'bundle': 'Bdl',
  'roll': 'Roll',
  'packet': 'Pkt',
  'unit': 'Unit',
};

String uomAbbr(String? uom) {
  if (uom == null || uom.trim().isEmpty) return '';
  return kUomAbbr[uom.trim().toLowerCase()] ?? uom;
}
