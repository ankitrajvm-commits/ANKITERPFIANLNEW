/// The same unit list every screen's UNIT dropdown offers on the PC
/// (santu_uom.js) — one shared list here for the same reason: so Billing,
/// Purchase and Estimate never drift into offering different units for the
/// same item.
const kUnitOptions = [
  'Kg', 'Pcs', 'Unit', 'Gm', 'Ltr', 'Millilitre', 'Mtr', 'Centimeter',
  'Millimeter', 'Ft', 'Inch', 'Box', 'Pkt', 'Bag', 'Bdl', 'Roll', 'Coil',
  'Set', 'Pair', 'Dzn', 'Can', 'Square Meter', 'Square Foot', 'Tonne',
  'Kilometer',
];

/// A typed-in unit (from an older bill, or a custom one) that isn't in the
/// standard list should still show up as the selected value instead of
/// silently resetting — this returns the full list with it added if missing.
List<String> unitOptionsWith(String current) {
  if (current.isEmpty || kUnitOptions.contains(current)) return kUnitOptions;
  return [current, ...kUnitOptions];
}
