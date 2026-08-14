frappe.pages["santu-low-stock"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Low Stock",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_low_stock(page);
};

const SANTU_LOW_STOCK_SECTIONS = [
	{ status: "out", label: "Out of Stock", icon: "🔴", tone: "urgent" },
	{ status: "low", label: "Low Stock", icon: "🟠", tone: "warning" },
	{ status: "running_out_soon", label: "Selling Fast — Running Out Soon", icon: "🟡", tone: "notice" },
];

function render_low_stock(page) {
	const $root = $(`<div class="santu-lowstock"></div>`).appendTo(page.body);

	$root.html(`
		<div class="santu-lowstock-filters">
			<input type="text" class="form-control santu-lowstock-search" placeholder="Search item...">
			<button class="btn btn-default santu-lowstock-share">Share List on WhatsApp</button>
		</div>
		<div class="santu-lowstock-summary"></div>
		<div class="santu-lowstock-body"></div>
	`);

	const $search = $root.find(".santu-lowstock-search");

	let all_rows = [];

	const reload = async () => {
		$root.find(".santu-lowstock-body").html(`<div class="santu-dash-loading">Loading...</div>`);
		all_rows = await frappe.xcall("santu_hardware.santu_hardware.api.get_low_stock_items");
		render_rows($root, all_rows, $search.val());
	};

	let debounce;
	$search.on("input", () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => render_rows($root, all_rows, $search.val()), 200);
	});

	$root.find(".santu-lowstock-share").on("click", () => share_low_stock_on_whatsapp(all_rows));

	reload();
}

function render_rows($root, rows, search) {
	const term = (search || "").trim().toLowerCase();
	const filtered = term
		? rows.filter(
				(r) =>
					r.item_name.toLowerCase().includes(term) || r.item_code.toLowerCase().includes(term)
			)
		: rows;

	const $summary = $root.find(".santu-lowstock-summary");
	const out_count = rows.filter((r) => r.status === "out").length;
	const low_count = rows.filter((r) => r.status === "low").length;
	const soon_count = rows.filter((r) => r.status === "running_out_soon").length;

	if (!rows.length) {
		$summary.html(`<div class="santu-lowstock-allgood">✅ Everything is in stock — nothing is low.</div>`);
	} else {
		$summary.html(`
			<div class="santu-lowstock-summary-row">
				${out_count ? `<div class="santu-lowstock-chip santu-tone-urgent">🔴 ${out_count} Out of Stock</div>` : ""}
				${low_count ? `<div class="santu-lowstock-chip santu-tone-warning">🟠 ${low_count} Low Stock</div>` : ""}
				${soon_count ? `<div class="santu-lowstock-chip santu-tone-notice">🟡 ${soon_count} Running Out Soon</div>` : ""}
			</div>
		`);
	}

	const $body = $root.find(".santu-lowstock-body");
	$body.empty();

	if (!rows.length) return;

	if (term && !filtered.length) {
		$body.append(`<div class="santu-dash-recent-empty">No matching item.</div>`);
		return;
	}

	// Two Item masters can share the exact same name (confirmed live: this
	// shop has duplicate item records like two "WUDFIN PU-11 CLEAR 1LT
	// 10X1" — one at 0 qty, one at 1 qty) — without disambiguation a
	// shopkeeper scanning the Out of Stock list sees that name once,
	// assumes that's the only one, and never notices the second, distinct
	// item sitting in the Low Stock section below (2026-08-06, reported
	// live: "1 stock wala item show hi nahi ho raha", actually was showing
	// correctly but looked identical to its 0-stock namesake).
	const name_counts = {};
	filtered.forEach((r) => {
		name_counts[r.item_name] = (name_counts[r.item_name] || 0) + 1;
	});

	SANTU_LOW_STOCK_SECTIONS.forEach((section) => {
		const section_rows = filtered.filter((r) => r.status === section.status);
		if (!section_rows.length) return;

		const $section = $(`
			<div class="santu-lowstock-section">
				<div class="santu-lowstock-section-title santu-tone-${section.tone}">${section.icon} ${section.label} (${section_rows.length})</div>
				<div class="santu-lowstock-list"></div>
			</div>
		`).appendTo($body);

		const $list = $section.find(".santu-lowstock-list");
		section_rows.forEach((row) => $list.append(build_row(row, name_counts[row.item_name] > 1)));
	});
}

function build_row(row, show_code) {
	let meta;
	if (row.status === "out") {
		meta = `0 ${frappe.utils.escape_html(row.stock_uom)} left`;
	} else if (row.status === "low") {
		meta = `${row.available_qty} ${frappe.utils.escape_html(row.stock_uom)} left · reorder level ${row.reorder_level}`;
	} else {
		meta = `${row.available_qty} ${frappe.utils.escape_html(row.stock_uom)} left · selling ~${row.daily_pace}/day · ~${row.days_remaining} days remaining`;
	}
	if (show_code) {
		meta += ` · <span class="santu-lowstock-row-code">${frappe.utils.escape_html(row.item_code)}</span>`;
	}

	return $(`
		<div class="santu-lowstock-row" role="button" tabindex="0">
			<div class="santu-lowstock-row-main">
				<div class="santu-lowstock-row-name">${frappe.utils.escape_html(row.item_name)}</div>
				<div class="santu-lowstock-row-meta">${meta}</div>
			</div>
			<div class="santu-lowstock-row-suggest">
				${row.suggested_reorder_qty > 0 ? `Order ~${row.suggested_reorder_qty}` : ""}
			</div>
		</div>
	`).on("click", () => frappe.set_route("Form", "Item", row.item_code));
}

function share_low_stock_on_whatsapp(rows) {
	if (!rows.length) {
		frappe.show_alert({ message: "No low stock items right now.", indicator: "green" });
		return;
	}

	const lines = ["*Low Stock List — Santu Hardware*", ""];
	SANTU_LOW_STOCK_SECTIONS.forEach((section) => {
		const section_rows = rows.filter((r) => r.status === section.status);
		if (!section_rows.length) return;
		lines.push(`${section.icon} ${section.label}:`);
		section_rows.forEach((r) => {
			const qty_text = r.status === "out" ? "0" : `${r.available_qty}`;
			lines.push(`- ${r.item_name} (${qty_text} ${r.stock_uom} left${r.suggested_reorder_qty ? `, order ~${r.suggested_reorder_qty}` : ""})`);
		});
		lines.push("");
	});

	const message = lines.join("\n").trim();
	window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
}
