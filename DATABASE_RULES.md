# DATABASE_RULES.md — Santu Hardware
### DocType Design, Folder Structure, Naming Conventions, Data Model

> Companion to `ERP_MASTER_PROMPT.md`. Applies the Golden Rule and Decision Matrix
> to database/schema decisions specifically.

---

## 1. CORE PRINCIPLE

Prefer **extending ERPNext's native DocTypes** (via Custom Fields, Property Setters,
Client/Server Scripts) over creating brand-new DocTypes, unless the concept truly
doesn't exist in ERPNext. New DocTypes should be rare and justified via the Decision
Matrix in `ERP_MASTER_PROMPT.md` §7.

---

## 1.1 DEPENDENCY: `india_compliance` APP

ERPNext core dropped India GST/HSN localisation in v14 (see
`erpnext/patches/v14_0/remove_india_localisation.py`) — `Item.gst_hsn_code`,
`Company.gstin`/`pan`/`gst_category`, and GSTIN-aware Address fields no longer
exist in core ERPNext at all. The Frappe-ecosystem-standard replacement is the
`india_compliance` app (github.com/resilient-tech/india-compliance,
`version-15` branch), installed alongside `erpnext` and `santu_hardware`.

This follows §1's own rule — extend native functionality rather than
hand-rolling our own HSN/GSTIN fields and GST tax logic, which would mean
maintaining GST-compliance-critical code ourselves instead of using the
standard app the rest of the ERPNext-India ecosystem relies on. Any future
fresh install of this bench must run:
```bash
bench get-app https://github.com/resilient-tech/india-compliance --branch version-15
bench --site <site> install-app india_compliance
```
before `santu_hardware`, so `gst_hsn_code` exists when Item fixtures load.

---

## 2. LIKELY CUSTOM FIELD ADDITIONS (Not New DocTypes)

- **Item**: Rack Number, Shelf Number, Bin Location, Alternative Items, multi-unit
  conversion setup (may use ERPNext's native UOM + Conversion Factor first).
- **Sales Invoice / POS Invoice**: Privacy-Mode-linked fields for margin display
  (calculated, not stored redundantly where avoidable), delivery/loading/transport/
  labour charges (may map to existing Sales Taxes and Charges table where possible).
- **Customer**: Customer Type (Contractor/Electrician/Plumber/Painter/etc.),
  Favourite Products, WhatsApp Number (if not covered by Mobile No).

---

## 3. LIKELY NEW DOCTYPES (Only Where Justified)

- **Privacy Mode Settings** — stores the Privacy Mode password/PIN, timeout duration.
- **Price Change Log** — records who changed a price, old value, new value,
  timestamp, linked invoice/line. (Check first whether Frappe's built-in Version /
  Track Changes can serve this before building a dedicated log.)
- **Shop Mode Config** — which 8 buttons show, any shop-specific toggles.

Any addition to this list must go through the Decision Matrix first.

---

## 4. NAMING CONVENTIONS

- Custom app name: `santu_hardware` (snake_case, Frappe convention).
- DocTypes: PascalCase display name, clearly prefixed/scoped to avoid confusion with
  core DocTypes — e.g. `Santu Privacy Settings`, not a bare generic name.
- Python files: snake_case, one responsibility per file.
- JS files: camelCase functions, PascalCase for any component-style modules.
- Custom Fields: prefixed consistently (e.g. `custom_rack_number`) per Frappe
  convention, documented in this file as they're added.

  | DocType | Fieldname | Type | Added (Phase) |
  |---|---|---|---|
  | Item | `santu_location_section` | Section Break ("Shop Location") | 1 |
  | Item | `custom_rack_number` | Data | 1 |
  | Item | `custom_shelf_number` | Data | 1 |
  | Item | `custom_column_break_location` | Column Break | 1 |
  | Item | `custom_bin_location` | Data | 1 |
  | Stock Reconciliation | `custom_adjustment_reason` | Select (Damage/Theft/Count Correction/Other) | 2 |

  Defined in `santu_hardware/setup/install.py::create_item_location_fields()`
  and `create_stock_adjustment_reason_field()`, wired to the `after_install`
  hook so a fresh install of this app always has them — not a one-off
  console change.

  **New DocType (Phase 2):** `Staff Member` — flat list (Staff Name, Active),
  same pattern as native Brand. Backs the shift-start tile selector
  (UX_STRATEGY.md SS4.2); not in the original "Likely New DocTypes" list
  above since the need only became clear during UX design, not at the
  original Product Master pass.

  **New Role (Phase 2):** `Cashier` — desk_access, minimal DocType
  permissions (POS Invoice, Customer, Payment Entry, Staff Member, and the
  read-only masters POS billing needs). Granted access to the Point of Sale
  Page explicitly (Page.roles), since Page-level and DocType-level
  permissions are separate systems in Frappe.

  **Permanent core-bug workaround (Phase 2):** `santu_hardware/__init__.py`
  monkey-patches `erpnext.selling.doctype.customer.customer.get_loyalty_programs`
  to return `[]`. That function builds a raw-SQL-expression filter key that
  produces malformed SQL on this MariaDB version, breaking every Customer
  save without a loyalty_program set — i.e. all of them, since this shop has
  no use for loyalty programs. Confirmed via direct reproduction, not
  assumed; wrapped in try/except so a future ERPNext version renaming the
  function doesn't break app startup.

---

## 5. FOLDER STRUCTURE

```
santu_hardware/
├── santu_hardware/
│   ├── doctype/              # Custom DocTypes (e.g. Privacy Mode Settings)
│   ├── custom/                # Custom Field definitions, Property Setters
│   ├── public/
│   │   ├── js/                 # Billing screen JS, Shop Mode UI
│   │   └── css/                 # Theme, dark/light mode
│   ├── www/                    # Shop Mode landing page (if custom portal used)
│   ├── templates/
│   │   └── print_formats/     # Invoice, Estimate, Challan (buying price stripped)
│   ├── report/                 # Custom reports (Margin, Price Change, etc.)
│   ├── hooks.py                # App hooks — event handlers, permission overrides
│   └── config/
├── ERP_MASTER_PROMPT.md
├── BUSINESS_RULES.md
├── UI_GUIDELINES.md
├── DATABASE_RULES.md
├── ROADMAP.md
├── CODING_STANDARDS.md
└── README.md
```

---

## 6. DATA INTEGRITY RULES

- Buying price fields must be excluded at the **permission/query level** for
  cashier role, not just hidden via CSS/JS — a hidden-but-fetched field is a data
  leak. Enforce via Frappe permission rules / field-level permissions or by
  stripping the field server-side before it reaches a cashier-role session.
- Print formats must be built/verified to never include buying price/margin fields,
  checked explicitly in the testing checklist (`CODING_STANDARDS.md`).
- Multi-unit conversions must use ERPNext's native UOM Conversion Factor mechanism
  wherever possible, to keep stock calculations upgrade-safe and avoid parallel
  custom conversion logic that can drift out of sync.

---

## 7. BACKUP & DATA SAFETY

- Nightly automated local backup (via `bench backup` or scheduled job) to an
  external drive or designated folder.
- Restore process documented and tested periodically, not just assumed to work.
- Any schema-changing customization must include a rollback note (see
  `CODING_STANDARDS.md` §Response Format).
