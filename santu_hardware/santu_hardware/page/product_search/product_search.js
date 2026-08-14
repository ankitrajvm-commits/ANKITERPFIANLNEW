frappe.pages["product-search"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Product Search",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_product_search(page);
};

const SANTU_SEARCH_DEBOUNCE_MS = 150;
// Below this score, the top hit isn't confident enough to auto-open
// without a tap — matches api.py's _SCORE_NAME_PREFIX tier.
const SANTU_AUTO_OPEN_MIN_SCORE = 800;

function render_product_search(page) {
	const $wrap = $(`
		<div class="santu-search-screen">
			<div class="santu-search-bar">
				<input type="text" class="santu-search-input" placeholder="Scan barcode, or search product name, brand, category..." autocomplete="off" autofocus />
			</div>
			<div class="santu-search-hint">Type to search — barcode scans open the product instantly.</div>
			<div class="santu-search-results"></div>
			<div class="santu-search-empty" style="display:none">No products found. Try a different word, or check the spelling.</div>
		</div>
	`).appendTo(page.body);

	const $input = $wrap.find(".santu-search-input");
	const $results = $wrap.find(".santu-search-results");
	const $empty = $wrap.find(".santu-search-empty");

	let debounce_timer = null;
	let last_query_token = 0;

	function run_search(auto_open) {
		const query = $input.val().trim();
		if (!query) {
			$results.empty();
			$empty.hide();
			return;
		}
		const this_token = ++last_query_token;
		const t0 = performance.now();

		frappe.call({
			method: "santu_hardware.santu_hardware.api.search_products",
			args: { query, limit: 20 },
			callback: (r) => {
				// A slower, stale response landing after a faster newer one
				// would otherwise flash outdated results while typing fast.
				if (this_token !== last_query_token) return;
				const elapsed_ms = Math.round(performance.now() - t0);
				render_results(r.message, query, auto_open, elapsed_ms);
			},
		});
	}

	function render_results(data, query, auto_open, elapsed_ms) {
		const results = (data && data.results) || [];
		$results.empty();

		if (!results.length) {
			$empty.show();
			return;
		}
		$empty.hide();

		results.forEach((item) => {
			const is_exact = data.exact_match === item.item_code;
			const $card = build_result_card(item, is_exact);
			$results.append($card);
		});

		if (auto_open && data.exact_match && results[0].score >= SANTU_AUTO_OPEN_MIN_SCORE) {
			// "Barcode scan should immediately open the correct item without
			// any additional click" — auto-expand the top card rather than
			// waiting for a tap when the match is unambiguous.
			$results.find(".santu-result-card").first().addClass("santu-result-expanded");
		}

		if (window.console && elapsed_ms !== undefined) {
			// Not user-facing — a quick local signal while validating that
			// this genuinely "feels instant" (ROADMAP.md Phase 2.5 requirement).
			console.debug(`[Product Search] "${query}" → ${results.length} results in ${elapsed_ms}ms`);
		}
	}

	function build_result_card(item, is_exact) {
		const qty = item.available_qty;
		let stock_class = "santu-stock-out";
		let stock_label = "Out of stock";
		if (qty === null || qty === undefined) {
			stock_class = "santu-stock-unknown";
			stock_label = "—";
		} else if (qty <= 0) {
			stock_class = "santu-stock-out";
			stock_label = "Out of stock";
		} else if (qty <= 5) {
			stock_class = "santu-stock-low";
			stock_label = `${qty} ${item.stock_uom || ""} left`;
		} else {
			stock_class = "santu-stock-ok";
			stock_label = `${qty} ${item.stock_uom || ""} in stock`;
		}

		const price = item.price ? `₹ ${format_currency_plain(item.price)}` : "—";
		const subtitle = [item.brand, item.item_group].filter(Boolean).join(" · ");

		const $card = $(`
			<div class="santu-result-card ${is_exact ? "santu-result-exact" : ""}" tabindex="0" role="button">
				<div class="santu-result-main">
					<div class="santu-result-name">${frappe.utils.escape_html(item.item_name)}</div>
					<div class="santu-result-subtitle">${frappe.utils.escape_html(subtitle || item.item_code)}</div>
				</div>
				<div class="santu-result-price santu-figures">${price}</div>
				<div class="santu-result-stock ${stock_class}">${stock_label}</div>
			</div>
		`);

		$card.on("click", () => $card.toggleClass("santu-result-expanded"));
		$card.on("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				$card.toggleClass("santu-result-expanded");
			}
		});

		return $card;
	}

	function format_currency_plain(value) {
		return frappe.format(value, { fieldtype: "Currency" }).replace(/^\D+/, "");
	}

	$input.on("input", () => {
		clearTimeout(debounce_timer);
		debounce_timer = setTimeout(() => run_search(false), SANTU_SEARCH_DEBOUNCE_MS);
	});

	$input.on("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			clearTimeout(debounce_timer);
			run_search(true);
		} else if (e.key === "Escape") {
			$input.val("");
			$results.empty();
			$empty.hide();
		}
	});
}
