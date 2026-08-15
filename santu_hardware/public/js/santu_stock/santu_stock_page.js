/* global frappe, santu_stock, format_number */
frappe.provide("santu_stock");

// The Stock Summary screen's controller factory. Lives as a static asset so
// the Reports page can embed this exact screen rather than re-skinning a
// generic report — same arrangement santu_sale uses, and for the same reason:
// the shop should only ever learn one stock table. Each caller gets its own
// instance so the standalone page and an embedded copy never share $root.
santu_stock.create_page = function () {
	return {
	init($container, opts = {}) {
		this.$container = $container;
		this.page = opts.page || null;
		// Reports embeds this same screen twice: once plainly, and once as
		// "Low Stock Summary" with the filter already switched on.
		this.state = { search: "", item_group: "", only_low: !!opts.only_low, sort: "item_name", dir: 1 };
		this.render_shell();
		this.load();
	},

	render_shell() {
		const $root = $(`
			<div class="santu-stock">
				<div class="santu-stock-header">
					<div class="santu-stock-title">Stock Summary</div>
					<div class="santu-stock-header-actions">
						<button type="button" class="btn santu-stock-add-btn">+ Add Item</button>
					</div>
				</div>

				<div class="santu-stock-filters">
					<div class="santu-stock-search-wrap">
						<span class="santu-stock-search-icon" aria-hidden="true">🔍</span>
						<input type="text" class="santu-stock-search" placeholder="Search item, code or rack">
					</div>
					<select class="santu-stock-group" aria-label="Category"><option value="">All Categories</option></select>
					<label class="santu-stock-lowtoggle">
						<input type="checkbox" class="santu-stock-only-low"> Only low stock
					</label>
					<button type="button" class="santu-stock-refresh" title="Refresh">↻</button>
				</div>

				<div class="santu-stock-cards"></div>
				<div class="santu-stock-table-wrap"></div>
			</div>
		`).appendTo(this.$container);

		this.$root = $root;
		this.$cards = $root.find(".santu-stock-cards");
		this.$table = $root.find(".santu-stock-table-wrap");
		this.$group = $root.find(".santu-stock-group");

		let timer = null;
		$root.find(".santu-stock-search").on("input", (e) => {
			this.state.search = e.target.value;
			clearTimeout(timer);
			timer = setTimeout(() => this.load(), 300);
		});
		this.$group.on("change", (e) => {
			this.state.item_group = e.target.value;
			this.load();
		});
		$root.find(".santu-stock-only-low").on("change", (e) => {
			this.state.only_low = e.target.checked;
			this.load();
		});
		$root.find(".santu-stock-only-low").prop("checked", this.state.only_low);
		$root.find(".santu-stock-refresh").on("click", () => this.load());
		$root.find(".santu-stock-add-btn").on("click", () => frappe.set_route("santu-add-item"));
	},

	load() {
		this.$table.html(`<div class="santu-stock-loading">Loading…</div>`);
		frappe
			.xcall("santu_hardware.santu_hardware.api.get_stock_summary", {
				search: this.state.search || null,
				item_group: this.state.item_group || null,
				only_low: this.state.only_low ? 1 : 0,
			})
			.then((data) => {
				this.data = data;
				if (this.$group.children().length <= 1) {
					(data.item_groups || []).forEach((g) =>
						this.$group.append(`<option value="${frappe.utils.escape_html(g)}">${frappe.utils.escape_html(g)}</option>`)
					);
					this.$group.val(this.state.item_group || "");
				}
				this.render_cards(data.summary);
				this.render_table(data.rows);
			})
			.catch((e) => {
				this.$cards.empty();
				this.$table.html(`<div class="santu-stock-empty">Could not load stock.</div>`);
				console.error(e);
			});
	},

	_money(v) {
		return `₹ ${format_number(v || 0, null, 2)}`;
	},

	render_cards(s) {
		s = s || {};
		// "Stock Value" is what the goods cost the shop; "Sale Value" is what
		// they would fetch at today's prices. The gap between them is the only
		// profit figure a shopkeeper can act on before anything is sold.
		this.$cards.html(`
			<div class="santu-stock-card">
				<div class="santu-stock-card-label">Stock Value <span title="What this stock cost you">(at cost)</span></div>
				<div class="santu-stock-card-value">${this._money(s.stock_value)}</div>
				<div class="santu-stock-card-sub">${format_number(s.items || 0, null, 0)} items · ${format_number(s.total_qty || 0, null, 0)} pieces</div>
			</div>
			<div class="santu-stock-card">
				<div class="santu-stock-card-label">Sale Value <span title="What this stock would fetch at today's prices">(at selling price)</span></div>
				<div class="santu-stock-card-value">${this._money(s.sale_value)}</div>
				<div class="santu-stock-card-sub">If everything sold at today's rate</div>
			</div>
			<div class="santu-stock-card santu-stock-card-profit">
				<div class="santu-stock-card-label">Profit if all sold</div>
				<div class="santu-stock-card-value">${this._money(s.potential_profit)}</div>
				<div class="santu-stock-card-sub">Sale value minus cost</div>
			</div>
			<div class="santu-stock-card ${s.low_count ? "santu-stock-card-warn" : ""}">
				<div class="santu-stock-card-label">Running Low</div>
				<div class="santu-stock-card-value">${format_number(s.low_count || 0, null, 0)}</div>
				<div class="santu-stock-card-sub">Items at or below their alert level</div>
			</div>
		`);
	},

	_sorted(rows) {
		const key = this.state.sort;
		const dir = this.state.dir;
		return rows.slice().sort((a, b) => {
			const x = a[key], y = b[key];
			if (typeof x === "string" || typeof y === "string") {
				return dir * String(x || "").localeCompare(String(y || ""));
			}
			return dir * ((x || 0) - (y || 0));
		});
	},

	render_table(rows) {
		if (!rows || !rows.length) {
			this.$table.html(`
				<div class="santu-stock-empty">
					<div class="santu-stock-empty-icon">📦</div>
					<div class="santu-stock-empty-title">Nothing to show</div>
					<div class="santu-stock-empty-sub">No product matches this search.</div>
				</div>
			`);
			return;
		}

		const head = [
			["item_name", "ITEM", "left"],
			["qty", "IN STOCK", "right"],
			["cost_rate", "PURCHASE RATE", "right"],
			["sale_rate", "SALE RATE", "right"],
			["margin", "PROFIT / PIECE", "right"],
			["stock_value", "STOCK VALUE", "right"],
		];

		const $t = $(`
			<table class="santu-stock-table">
				<thead><tr>${head
					.map(
						([k, label, align]) =>
							`<th class="santu-stock-th-${align}" data-sort="${k}">${label}${
								this.state.sort === k ? (this.state.dir === 1 ? " ▲" : " ▼") : ""
							}</th>`
					)
					.join("")}</tr></thead>
				<tbody></tbody>
			</table>
		`);

		const $tb = $t.find("tbody");
		this._sorted(rows).forEach((r) => {
			// A dash, not "₹ 0.00": an item nobody has priced yet has no
			// selling rate, and showing zero would read as "sells for nothing".
			const dash = `<span class="santu-stock-dash">—</span>`;
			const $tr = $(`
				<tr class="${r.low ? "santu-stock-row-low" : ""}">
					<td class="santu-stock-td-item">
						<div class="santu-stock-item-name">${frappe.utils.escape_html(r.item_name)}</div>
						<div class="santu-stock-item-sub">${frappe.utils.escape_html(r.item_code)}${
							r.rack ? ` · Rack ${frappe.utils.escape_html(r.rack)}` : ""
						}</div>
					</td>
					<td class="santu-stock-td-num">
						<span class="${r.low ? "santu-stock-qty-low" : ""}">${format_number(r.qty, null, 0)}</span>
						<span class="santu-stock-uom">${frappe.utils.escape_html(r.uom || "")}</span>
					</td>
					<td class="santu-stock-td-num">${r.cost_rate ? this._money(r.cost_rate) : dash}</td>
					<td class="santu-stock-td-num">${r.sale_rate ? this._money(r.sale_rate) : dash}</td>
					<td class="santu-stock-td-num">${
						r.margin === null || r.margin === undefined
							? dash
							: `<span class="${r.margin < 0 ? "santu-stock-loss" : "santu-stock-gain"}">${this._money(
									r.margin
							  )}${r.margin_pct !== null ? ` <small>(${format_number(r.margin_pct, null, 0)}%)</small>` : ""}</span>`
					}</td>
					<td class="santu-stock-td-num">${this._money(r.stock_value)}</td>
				</tr>
			`);
			$tr.on("click", () => {
				frappe.route_options = { item_code: r.item_code };
				frappe.set_route("santu-items");
			});
			$tb.append($tr);
		});

		$t.find("th[data-sort]").on("click", (e) => {
			const k = $(e.currentTarget).data("sort");
			if (this.state.sort === k) this.state.dir = -this.state.dir;
			else {
				this.state.sort = k;
				// Names read best A–Z; every money or quantity column is asked
				// about biggest-first ("what's my costliest stock?").
				this.state.dir = k === "item_name" ? 1 : -1;
			}
			this.render_table(this.data.rows);
		});

		this.$table.empty().append($t);
	},
};
};
