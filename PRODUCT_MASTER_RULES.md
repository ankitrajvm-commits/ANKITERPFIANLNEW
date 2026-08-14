# PRODUCT_MASTER_RULES.md — Santu Hardware
### Product Master, Inventory & Category Architecture

> **STATUS: FROZEN — v1.0, approved 2026-07-30.** This is the source of
> truth for the product catalog data model. Future changes go through real
> usage first, then a deliberate revision — not indefinite pre-launch
> iteration. Companion to `BUSINESS_RULES.md` §4 and `DATABASE_RULES.md` §1.

---

## 1. THE FOUR DIMENSIONS

Every Item is classified along four independent axes. This is the core
insight of the whole design — don't conflate these, each answers a
different question:

| Dimension | Answers | ERPNext home | Cardinality |
|---|---|---|---|
| **Category / Subcategory** | "Where does a customer look for this?" | Item Group (tree) | One per Item |
| **Family** | "What fundamentally IS this thing?" | `Item Family` (new flat DocType) | One per Item |
| **Brand** | "Who makes it?" | Brand (native) | One per Item, optional |
| **Specifications** | "What are its measurable properties?" | `Item Specification` child table (new) | Many per Item |
| **Application (Tags)** | "What else is it useful for, beyond its primary category?" | Frappe Tags (native) | Many per Item, optional |

**Item Family decision:** built as a new flat DocType (not Tags) — after
elimination, no native ERPNext concept covers it (Item Group is committed to
Category, Brand means manufacturer, Item Attribute is Variant-only, Tags are
multi-value/optional and too loose for a mandatory single-value reporting
column). Structurally identical to Brand (one name field) — near-zero
maintenance cost.

---

## 2. CATEGORY / SUBCATEGORY TREE (Item Group) — v1.0

```
All Item Groups
├── Hardware & Fasteners
│   ├── Fasteners (Screws, Nuts, Bolts, Washers, Nails, Anchors)
│   ├── Door & Window Hardware (Hinges, Locks, Handles, Tower Bolts)
│   ├── Door & Window Fittings
│   ├── Kitchen Fittings
│   ├── Hand Tools / Power Tools / Cutting Tools / Measuring Tools
│   ├── Safety Equipment / Ropes & Chains
│   └── Garden Tools / Agriculture Tools
├── Electrical
│   ├── Wires & Cables / Switches & Sockets / MCB & Distribution
│   ├── Bulbs & Lighting / Fans / Pumps & Motors
│   ├── Conduits & Accessories / Electrical Tools
│   └── Consumables (electrical tape and similar — see §6 Finding 1)
├── Paints
│   ├── Interior Paint / Exterior Paint / Primer / Putty / Enamel
│   ├── Wood Finish / Waterproofing / Thinner & Solvents
│   └── Painting Tools & Accessories (brushes, rollers — see §6 Finding 2)
├── Plumbing
│   ├── Pipes → PVC / CPVC / UPVC / GI / HDPE / SWR
│   ├── Pipe Fittings → Elbow / Tee / Socket / Union / Reducer / Coupler / End Cap / Cross / Nipple
│   ├── Taps & Valves
│   └── Pipe Accessories (clips, clamps, supports — see §6 Finding 3)
├── Sanitary Ware → Bathroom Fittings / Bathroom Accessories
├── Water Tanks → Overhead Tanks / Underground Tanks / Loft Tanks
├── Adhesives → Adhesives / Sealants / Silicones / Epoxy / Teflon Tape / PVC Solvent Cement
├── Construction Materials → Wire Mesh & Fencing / Welding Accessories
└── Cleaning & Maintenance → Chemicals / Accessories / Brushes / Mops / Brooms / Safety Cleaning
```

9 top-level categories. Tree depth is flexible (2-4 levels), never forced
uniform. Category is independent of physical storage — Rack/Shelf/Bin
(already built) never has to match category structure.

## 3. PRODUCT FAMILY — v1.0 list

`Pipe, Pipe Fitting, Tap, Valve, Paint, Wire, Cable, Switch, Socket, MCB,
Bulb/Light, Fan, Pump, Motor, Conduit, Fastener, Hinge, Lock, Handle, Tower
Bolt, Hand Tool, Power Tool, Cutting Tool, Measuring Tool, Safety Gear, Rope,
Chain, Garden Tool, Agriculture Tool, Sanitary Fitting, Sanitary Accessory,
Water Tank, Adhesive, Sealant, Silicone, Epoxy, Tape, Solvent Cement, Wire
Mesh, Welding Accessory, Cleaning Chemical, Cleaning Accessory, Brush, Mop,
Broom, Kitchen Fitting, Door Fitting, Window Fitting`

Kept broader than the finest subcategory leaf on purpose (e.g. one Family
"Pipe Fitting" covers all 9 shape subcategories) so Family stays a genuinely
useful cross-cutting reporting dimension, not a duplicate of the tree.

## 4. SPECIFICATIONS — `Item Specification` child table

Fields: `Spec Name (Link) | Spec Value (Data) | Unit (Data) | Display Order (Int)`

Spec Name master list (flat, extensible — add a new spec by adding one
record, zero code change):

`Material, Grade/Tier, Color, Diameter, Width, Height, Depth, Thickness,
Length, Weight, Pressure Rating, Schedule, Gauge, Core, Voltage Rating,
Ampere Rating, Modules/Ways, Pole, Wattage, Bulb Type, Base Type, Sweep Size,
Speed, HP, Phase, Finish, Volume, Coverage, Type`

This — not Item Attribute/Variants — is the mechanism for structured,
filterable, per-item measurable properties, because Item Attribute only
exists on Variant-generating Template Items (verified against the actual
Frappe/ERPNext source, not assumed). Item Attribute + Variants stays reserved
for the one case that's genuinely combinatorial: Paints with large
color × size grids.

## 5. ATTRIBUTE MATRIX (data-entry guidance, not a hard schema constraint)

| Family | Required | Optional | Default Unit | Search Priority |
|---|---|---|---|---|
| Pipe | Diameter | Length, Pressure, Schedule, Color | mm/inch | 1. Diameter |
| Pipe Fitting | Diameter, Material | Pressure Rating | inch | 1. Diameter, 2. Material |
| Paint | Volume | Color, Finish, Grade, Coverage | L | 1. Brand, 2. Volume, 3. Color |
| Wire/Cable | Gauge | Core, Voltage, Length | sqmm | 1. Gauge |
| Switch/Socket | Ampere | Modules | A | 1. Ampere |
| MCB | Ampere, Pole | — | A | 1. Ampere |
| Bulb/Light | Wattage, Type | Base Type | W | 1. Wattage, 2. Type |
| Fan | Sweep Size | Speed | mm | 1. Sweep Size |
| Pump/Motor | HP | Voltage, Phase | HP | 1. HP |
| Tap/Valve | Type | Material, Diameter | — | 1. Type |
| Fastener | Diameter, Length | Material, Grade | mm | 1. Diameter, 2. Length |
| Water Tank | Volume | Material, Type | L | 1. Volume |

## 6. STRESS TEST — 100 sample products, findings applied

93/100 fit cleanly on first pass. 5 real gaps found and resolved into the
tree above (§2); one boundary case confirmed correctly out of scope for now.

1. **Electrical Tape** → Electrical → Consumables, not grouped with Teflon
   Tape under Adhesives. Finding: "group by supplier" doesn't generalize —
   category placement follows how each product is actually bought/used.
2. **Paint Brushes/Rollers** → new subcategory `Paints → Painting Tools & Accessories`.
3. **Pipe Clips/Clamps** → new subcategory `Plumbing → Pipe Accessories`.
4. **Water Tanks had zero subcategories** → added Overhead/Underground/Loft.
5. **Water Filter Cartridges** → left out of scope for v1.0 (appliance-adjacent,
   same boundary as room heaters/appliances). Revisit only if the shop
   actually starts stocking water-purifier consumables.
6. Reducer fittings (dual diameter) — resolved by convention: Item Name
   carries the full size string ("1×0.5 inch"), the structured Diameter spec
   holds the primary/larger size. Not a schema issue.
7. "Weight" was missing from the Specification master until the stress test
   caught it (glue/putty/welding rod sold by weight, not volume) — added.

Full 100-row table with brand/spec/tag detail per product available on
request — not duplicated here to keep this document a reference, not a log.

## 7. BARCODE STRATEGY — confirmed, zero build needed

Native `Item Barcode` child table (verified schema: `barcode`, `barcode_type`
Select, `uom`) already supports multiple barcodes per item. Convention:
- Manufacturer barcode → real symbology (EAN / UPC-A / GTIN)
- Internal/self-generated barcode → CODE-39 (standard for home-printed labels)
- QR is a label-printing concern, not a data concern — any barcode value can
  be QR-encoded at print time. No schema impact. Actual label printing stays
  in `ROADMAP.md`'s unscheduled Future Ideas until there's real demand for it.

## 8. AI-SEARCH READINESS

Structured Specifications (§4) mean a future semantic search can query
`Spec Name=Diameter, Value=1 inch` directly instead of parsing free text —
strictly better than text-only matching. Concrete implication for Item
Naming: always compose names as Brand + Family + key specs in plain words
("Astral CPVC Elbow 1 inch"), so today's keyword search works immediately
while the structured data underneath is what a future AI search upgrades to,
with no rework required either way.

---

*Deferred, not needed now:* `INVENTORY_RULES.md` (stock-count/purchase/damage
workflows) — real interview material exists in this conversation but wasn't
the focus once priorities shifted to UX (per direction 2026-07-30). Revisit
when inventory *operations* (not just the master data model) become the
active work item.
