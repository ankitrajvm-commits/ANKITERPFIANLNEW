frappe.pages["santu-low-stock"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Low Stock",
		single_column: true,
	});
	$(page.wrapper).find(".page-head").hide();
	$(page.main).addClass("santu-lowstock-page-main");
	render_low_stock(page);
};

frappe.pages["santu-low-stock"].on_page_show = function (wrapper) {
	$(wrapper).find(".page-head").hide();
};

const SANTU_LOW_STOCK_SECTIONS = [
	{ status: "out", label: "Out of Stock", tone: "out" },
	{ status: "low", label: "Low Stock", tone: "low" },
	{ status: "running_out_soon", label: "Running Out", tone: "soon" },
];

function render_low_stock(page) {
	const $root = $(`
		<div class="santu-lowstock">
			<div class="santu-lowstock-page-header">
				<div class="santu-lowstock-title-text">Low Stock</div>
				<div class="santu-lowstock-header-actions">
					<button type="button" class="santu-lowstock-share-btn">Share</button>
					<button type="button" class="santu-lowstock-add-btn">+ Receive Stock</button>
				</div>
			</div>
			<div class="santu-lowstock-tabs"></div>
			<div class="santu-lowstock-toolbar">
				<input type="text" class="santu-lowstock-search" placeholder="Search item">
			</div>
			<div class="santu-lowstock-card">
				<div class="santu-lowstock-body"></div>
			</div>
		</div>
	`).appendTo(page.body);

	const state = { tab: "all", search: "", rows: [] };

	const tabs = [{ status: "all", label: "All" }, ...SANTU_LOW_STOCK_SECTIONS];
	const $tabs = $root.find(".santu-lowstock-tabs");
	tabs.forEach((t) => {
		$(`<button type="button" class="santu-lowstock-tab${t.status === "all" ? " is-active" : ""}" data-tab="${t.status}">${t.label}</button>`)
			.on("click", function () {
				state.tab = t.status;
				$tabs.find(".santu-lowstock-tab").removeClass("is-active");
				$(this).addClass("is-active");
				paint();
			})
			.appendTo($tabs);
	});

	let debounce;
	$root.find(".santu-lowstock-search").on("input", function () {
		state.search = this.value;
		clearTimeout(debounce);
		debounce = setTimeout(paint, 200);
	});
	$root.find(".santu-lowstock-share-btn").on("click", () => share_low_stock_on_whatsapp(state.rows));
	$root.find(".santu-lowstock-add-btn").on("click", () => frappe.set_route("santu-receive-stock"));

	function paint() {
		render_rows($root, state.rows, state.search, state.tab);
	}

	$root.find(".santu-lowstock-body").html(`<div class="santu-lowstock-loading">Loading…</div>`);
	frappe
		.xcall("santu_hardware.santu_hardware.api.get_low_stock_items")
		.then((rows) => {
			state.rows = rows || [];
			paint();
		})
		.catch(() => {
			$root.find(".santu-lowstock-body").html(`<div class="santu-lowstock-empty-text">Could not load low stock.</div>`);
		});
}

function render_rows($root, rows, search, tab) {
	const term = (search || "").trim().toLowerCase();
	let filtered = term
		? rows.filter(
				(r) =>
					(r.item_name || "").toLowerCase().includes(term) ||
					(r.item_code || "").toLowerCase().includes(term)
			)
		: rows.slice();
	if (tab && tab !== "all") filtered = filtered.filter((r) => r.status === tab);

	const $body = $root.find(".santu-lowstock-body");
	$body.empty();

	if (!rows.length) {
		$body.html(`
			<div class="santu-lowstock-empty">
				<div class="santu-lowstock-empty-title">No Low Stock Items.</div>
				<div class="santu-lowstock-empty-text">Everything is above its alert level.</div>
			</div>
		`);
		return;
	}

	if (!filtered.length) {
		$body.html(`<div class="santu-lowstock-empty-text">No matching item.</div>`);
		return;
	}

	const name_counts = {};
	filtered.forEach((r) => {
		name_counts[r.item_name] = (name_counts[r.item_name] || 0) + 1;
	});

	const $wrap = $(`
		<div class="santu-lowstock-table-wrap">
			<table class="santu-lowstock-table">
				<thead>
					<tr>
						<th>Item</th>
						<th class="num">Qty</th>
						<th class="num">Reorder</th>
						<th>Status</th>
						<th class="num">Order</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		</div>
	`).appendTo($body);
	const $tbody = $wrap.find("tbody");
	filtered.forEach((row) => $tbody.append(build_row(row, name_counts[row.item_name] > 1)));
}

function status_label(status) {
	if (status === "out") return { text: "Out of Stock", cls: "santu-lowstock-pill-out" };
	if (status === "low") return { text: "Low Stock", cls: "santu-lowstock-pill-low" };
	return { text: "Running Out", cls: "santu-lowstock-pill-soon" };
}

function build_row(row, show_code) {
	const esc = frappe.utils.escape_html;
	const st = status_label(row.status);
	const qty_cls = row.status === "out" ? "santu-lowstock-qty-out" : row.status === "low" ? "santu-lowstock-qty-low" : "santu-lowstock-qty-soon";
	const name = show_code
		? `${esc(row.item_name)} <span class="santu-lowstock-code">${esc(row.item_code)}</span>`
		: esc(row.item_name);
	const order = row.suggested_reorder_qty > 0 ? row.suggested_reorder_qty : "—";

	return $(`
		<tr class="santu-lowstock-row">
			<td>
				<div class="santu-lowstock-name">${name}</div>
			</td>
			<td class="num ${qty_cls}">${row.available_qty} ${esc(row.stock_uom || "")}</td>
			<td class="num">${row.reorder_level}</td>
			<td><span class="santu-lowstock-pill ${st.cls}">${st.text}</span></td>
			<td class="num">${order}</td>
		</tr>
	`).on("click", () => {
		frappe.route_options = { item_code: row.item_code };
		frappe.set_route("santu-stock");
	});
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
		lines.push(`*${section.label}:*`);
		section_rows.forEach((r) => {
			const qty_text = r.status === "out" ? "0" : `${r.available_qty}`;
			lines.push(`- ${r.item_name} (${qty_text} ${r.stock_uom} left${r.suggested_reorder_qty ? `, order ~${r.suggested_reorder_qty}` : ""})`);
		});
		lines.push("");
	});

	// Sends through the same WhatsApp Connect (Meta bridge) integration the
	// bills already go out on, same as the Parties screen's WhatsApp button
	// (2026-08-18: "santuhardware app me whatsapp already hai jaha pe bill
	// jata hai, wahi map kr do"). There's no "pick a contact" step on the
	// Cloud API bridge the way wa.me's own picker had, so the number is
	// asked for up front instead.
	const message = lines.join("\n").trim();
	frappe.require("/assets/santu_hardware/js/santu_whatsapp_connect/wa_connect_api.js", () => {
		santu_wa_connect.api.status().then((status) => {
			if (status.state !== "CONNECTED") {
				frappe.set_route("santu-whatsapp-connect");
				return;
			}
			frappe.prompt(
				{ fieldtype: "Data", fieldname: "phone", label: __("Send to (phone number)"), reqd: 1 },
				(v) => {
					const digits = (v.phone || "").replace(/\D/g, "");
					const num = digits.length === 10 ? "91" + digits : digits;
					frappe.dom.freeze(__("Sending…"));
					santu_wa_connect.api
						.send(num, message)
						.then(() => {
							frappe.dom.unfreeze();
							frappe.show_alert({ message: __("Sent"), indicator: "green" });
						})
						.catch(() => frappe.dom.unfreeze());
				},
				__("Share Low Stock List on WhatsApp"),
				__("Send")
			);
		});
	});
}
