// Recycle Bin — what was deleted, and a way to put it back.
//
// The page key here is HYPHENATED to match the Page record's own name
// (santu-recycle-bin), which is what every other screen in this app uses and
// what the sidebar links to. It was registered with underscores, so the
// sidebar's "Recycle Bin" entry led to a page-not-found (fixed 2026-08-29).
frappe.pages["santu-recycle-bin"].on_page_load = function (wrapper) {
	frappe.require("/assets/santu_hardware/css/santu_recycle_bin.css", function () {
		new SantuRecycleBin(wrapper);
	});
};

// The document types a shopkeeper would ever want back. Everything else in
// the bin (Files, Property Setters, backup logs, batch bundles…) is system
// bookkeeping and would only bury the real records.
const SANTU_RB_TYPES = [
	["Sales Invoice", "Sale Bill"],
	["POS Invoice", "POS Bill"],
	["Purchase Invoice", "Purchase Bill"],
	["Quotation", "Estimate"],
	["Sales Order", "Sales Order"],
	["Purchase Order", "Purchase Order"],
	["Delivery Note", "Delivery Challan"],
	["Payment Entry", "Payment"],
	["Customer", "Customer"],
	["Supplier", "Supplier"],
	["Item", "Item"],
];
const SANTU_RB_PAGE = 200;

class SantuRecycleBin {
	constructor(wrapper) {
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Recycle Bin",
			single_column: true,
		});

		this.$root = $(this.page.body);
		this.documents = [];
		this.limit = SANTU_RB_PAGE;
		this.loading = false;

		this.make();
	}

	make() {
		this.page.set_primary_action(
			"Refresh",
			() => {
				this.limit = SANTU_RB_PAGE;
				this.load_data();
			},
			"refresh"
		);

		this.$root.html(`
			<div class="santu-rb-main">
				<div class="santu-rb-header">
					<h1 class="santu-rb-title">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
						Recycle Bin
					</h1>
					<div class="santu-rb-sub">Deleted bills, parties and items — restore anything by mistake deleted.</div>
				</div>
				<div class="santu-rb-controls">
					<input type="text" class="santu-rb-search form-control" placeholder="Search by bill number / name…" />
					<select class="santu-rb-filter" id="santu-rb-doctype-filter">
						<option value="">All Types</option>
						${SANTU_RB_TYPES.map(([dt, label]) =>
							`<option value="${frappe.utils.escape_html(dt)}">${frappe.utils.escape_html(label)}</option>`
						).join("")}
					</select>
				</div>
				<div class="santu-rb-card">
					<div class="santu-rb-list-container"></div>
				</div>
			</div>
		`);

		this.bind_events();
		this.load_data();
	}

	bind_events() {
		// Searching and filtering re-query the SERVER. They used to filter an
		// already-capped 1,000-row fetch in the browser, and because the bin
		// is dominated by Files and Property Setters that cap was used up
		// long before the shop's own bills appeared — so the page showed
		// almost nothing to restore even with thousands of bills in the bin
		// (fixed 2026-08-29).
		this.$root.find(".santu-rb-search").on(
			"input",
			frappe.utils.debounce(() => {
				this.limit = SANTU_RB_PAGE;
				this.load_data();
			}, 300)
		);
		this.$root.find("#santu-rb-doctype-filter").on("change", () => {
			this.limit = SANTU_RB_PAGE;
			this.load_data();
		});

		this.$root.on("click", ".santu-rb-btn-restore", (e) => {
			const $b = $(e.currentTarget);
			this.restore_document($b.data("name"), $b.data("docname"), $b.data("doctype"));
		});
		this.$root.on("click", ".santu-rb-more", () => {
			this.limit += SANTU_RB_PAGE;
			this.load_data();
		});
	}

	_filters() {
		const search = (this.$root.find(".santu-rb-search").val() || "").trim();
		const type = this.$root.find("#santu-rb-doctype-filter").val();
		const filters = {};
		filters.deleted_doctype = type ? type : ["in", SANTU_RB_TYPES.map(([dt]) => dt)];
		if (search) filters.deleted_name = ["like", `%${search}%`];
		return filters;
	}

	load_data() {
		if (this.loading) return;
		this.loading = true;
		const $c = this.$root.find(".santu-rb-list-container");
		if (!this.documents.length) $c.html(`<div class="santu-rb-empty"><div class="santu-rb-empty-text">Loading…</div></div>`);

		// Goes through our own endpoint, not frappe.db.get_list, because both
		// readable columns live inside the archived JSON: the bill NUMBER
		// (the SINV docname must never be shown) and the party name
		// (2026-09-08: "recycle bin me customer name v likhe harek me").
		frappe
			.xcall("santu_hardware.santu_hardware.utilities_api.get_recycle_bin_documents", {
				doctype_filter: this.$root.find("#santu-rb-doctype-filter").val() || null,
				doctypes: JSON.stringify(SANTU_RB_TYPES.map(([dt]) => dt)),
				search: (this.$root.find(".santu-rb-search").val() || "").trim() || null,
				limit: this.limit,
			})
			.then((res) => {
				this.loading = false;
				this.has_more = !!(res && res.has_more);
				this.documents = (res && res.rows) || [];
				this.render_list();
			})
			.catch((e) => {
				this.loading = false;
				$c.html(
					`<div class="santu-rb-empty"><div class="santu-rb-empty-icon">⚠️</div>
					 <div class="santu-rb-empty-text">Could not read the recycle bin.<br><small>${frappe.utils.escape_html(
							(e && e.message) || String(e)
						)}</small></div></div>`
				);
			});
	}

	render_list() {
		const label_for = (dt) => (SANTU_RB_TYPES.find(([d]) => d === dt) || [dt, dt])[1];
		const $c = this.$root.find(".santu-rb-list-container");

		if (!this.documents.length) {
			$c.html(`
				<div class="santu-rb-empty">
					<div class="santu-rb-empty-icon">🗑️</div>
					<div class="santu-rb-empty-text">Nothing deleted to show here.</div>
				</div>
			`);
			return;
		}

		let html = `
			<table class="santu-rb-table">
				<thead>
					<tr>
						<th>Document</th>
						<th>Customer / Party</th>
						<th>Type</th>
						<th>Deleted On</th>
						<th>Deleted By</th>
						<th style="width: 110px; text-align: right;">Action</th>
					</tr>
				</thead>
				<tbody>
		`;

		this.documents.forEach((d) => {
			// Every one of these came out of the database and is rendered into
			// HTML, so all four go through escape_html — a bill number or a
			// customer name can legitimately contain & or quotes. owner and
			// deleted_name are also guarded against being empty, which used
			// to throw on `.charAt(0)` and blank the whole table.
			// `label` is the shop's own bill number (never the SINV docname)
			// and `party` is whose document it was — both dug out of the
			// archived JSON server-side, since the document itself is gone.
			const docname = frappe.utils.escape_html(d.label || d.deleted_name || "(unnamed)");
			const party = d.party
				? frappe.utils.escape_html(d.party)
				: `<span style="color:#9ca3af;">—</span>`;
			const owner = d.owner || "—";
			const initial = frappe.utils.escape_html((owner[0] || "?").toUpperCase());
			html += `
				<tr>
					<td><div class="santu-rb-docname">${docname}</div></td>
					<td><div class="santu-rb-party">${party}</div></td>
					<td><span class="santu-rb-doctype">${frappe.utils.escape_html(label_for(d.deleted_doctype))}</span></td>
					<td><div class="santu-rb-date">${frappe.datetime.str_to_user(d.creation)}</div></td>
					<td>
						<div class="santu-rb-user">
							<span class="avatar avatar-small"><div class="avatar-frame standard-image" title="${frappe.utils.escape_html(
								owner
							)}">${initial}</div></span>
							${frappe.utils.escape_html(owner)}
						</div>
					</td>
					<td style="text-align: right;">
						<button type="button" class="santu-rb-btn-restore"
							data-name="${frappe.utils.escape_html(d.name)}"
							data-docname="${docname}"
							data-doctype="${frappe.utils.escape_html(d.deleted_doctype)}">Restore</button>
					</td>
				</tr>
			`;
		});

		html += `</tbody></table>`;
		if (this.has_more) {
			html += `<div class="santu-rb-morewrap"><button type="button" class="santu-rb-more">Show more</button></div>`;
		}
		$c.html(html);
	}

	restore_document(name, docname, doctype) {
		frappe.confirm(`Restore <b>${docname}</b> back into ${frappe.utils.escape_html(doctype || "the system")}?`, () => {
			frappe.call({
				// Guarded wrapper, NOT frappe's raw restore. The raw one
				// re-inserts a cancelled bill as a fresh draft carrying the
				// same customer-facing bill number as the live one, under a
				// different docname, and says nothing about either — which
				// is how bill number 26 came to exist twice (2026-08-29).
				method: "santu_hardware.santu_hardware.utilities_api.restore_deleted_document",
				args: { name: name },
				freeze: true,
				freeze_message: "Restoring…",
				callback: (r) => {
					if (r.exc || !r.message) return;
					const m = r.message;
					if (m.renamed) {
						frappe.msgprint({
							title: __("Restored under a new number"),
							indicator: "orange",
							message: __(
								"{0} came back as <b>{1}</b> — the old number could not be reused. Please check it before using it.",
								[m.requested_name, m.name]
							),
						});
					} else {
						frappe.show_alert({ message: `${docname} restored`, indicator: "green" });
					}
					this.load_data();
				},
				// A restore genuinely can fail — the bill number may already
				// be live, or something it linked to is itself gone. The
				// original code only handled success, so a failure left the
				// row sitting there with no explanation at all.
				error: () => this.load_data(),
			});
		});
	}
}
