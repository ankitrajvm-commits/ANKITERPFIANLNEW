frappe.pages["santu-receive-stock"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Receive Stock",
		single_column: true,
	});

	$(page.wrapper).find(".page-head .page-actions").hide();

	render_receive_stock(page);
};

const SANTU_RECEIVE_DEBOUNCE_MS = 150;

function render_receive_stock(page) {
	const $root = $(`
		<div class="santu-receive">
			<div class="santu-receive-step santu-receive-step-search">
				<div class="santu-receive-hint">New stock arrived? Find the item first.</div>
				<input type="text" class="form-control santu-receive-search" placeholder="Type item name or code..." autocomplete="off" autofocus>
				<div class="santu-receive-results"></div>
				<div class="santu-receive-today"></div>
			</div>

			<div class="santu-receive-step santu-receive-step-form" style="display:none">
				<button class="santu-receive-back">&larr; Back</button>
				<div class="santu-receive-item-card"></div>

				<div class="santu-receive-block">
					<label>How much stock arrived?</label>
					<div class="santu-receive-qty-row">
						<button type="button" class="santu-receive-qty-btn santu-receive-qty-minus">−</button>
						<input type="number" class="santu-receive-qty-input" value="1" min="1" inputmode="numeric">
						<button type="button" class="santu-receive-qty-btn santu-receive-qty-plus">+</button>
					</div>
					<div class="santu-receive-qty-quick">
						<button type="button" class="santu-receive-qty-quick-btn" data-add="10">+10</button>
						<button type="button" class="santu-receive-qty-quick-btn" data-add="50">+50</button>
						<button type="button" class="santu-receive-qty-quick-btn" data-add="100">+100</button>
					</div>
				</div>

				<div class="santu-receive-block">
					<label>Rate per piece (optional — you can skip this)</label>
					<input type="number" class="form-control santu-receive-rate-input" placeholder="₹">
				</div>

				<button class="btn btn-primary btn-lg santu-receive-submit">✅ Add to Stock</button>
			</div>

			<div class="santu-receive-step santu-receive-step-success" style="display:none">
				<div class="santu-receive-success-icon">✅</div>
				<div class="santu-receive-success-text"></div>
				<button class="btn btn-primary btn-lg santu-receive-another">➕ Add Another Item</button>
			</div>
		</div>
	`).appendTo(page.body);

	const $search_step = $root.find(".santu-receive-step-search");
	const $form_step = $root.find(".santu-receive-step-form");
	const $success_step = $root.find(".santu-receive-step-success");

	const $search = $root.find(".santu-receive-search");
	const $results = $root.find(".santu-receive-results");
	const $today = $root.find(".santu-receive-today");

	let selected_item = null;
	let received_today = [];

	function show_step($step) {
		[$search_step, $form_step, $success_step].forEach(($s) => $s.hide());
		$step.show();
	}

	function render_today() {
		if (!received_today.length) {
			$today.empty();
			return;
		}
		const rows = received_today
			.map(
				(r) => `<div class="santu-receive-today-row">✅ ${frappe.utils.escape_html(r.item_name)} — +${r.qty}</div>`
			)
			.join("");
		$today.html(`<div class="santu-receive-today-title">Just added:</div>${rows}`);
	}

	let debounce_timer;
	$search.on("input", () => {
		clearTimeout(debounce_timer);
		debounce_timer = setTimeout(run_search, SANTU_RECEIVE_DEBOUNCE_MS);
	});

	function run_search() {
		const query = $search.val().trim();
		if (!query) {
			$results.empty();
			return;
		}
		frappe.call({
			method: "santu_hardware.santu_hardware.api.search_products",
			args: { query, limit: 15 },
			callback: (r) => render_results((r.message && r.message.results) || []),
		});
	}

	function render_results(results) {
		$results.empty();
		if (!results.length) {
			$results.append(`<div class="santu-dash-recent-empty">No item found.</div>`);
			return;
		}
		results.forEach((item) => {
			$(`
				<div class="santu-receive-result-card" role="button" tabindex="0">
					<div class="santu-receive-result-name">${frappe.utils.escape_html(item.item_name)}</div>
					<div class="santu-receive-result-meta">Currently in stock: ${item.available_qty ?? 0} ${frappe.utils.escape_html(santu_uom.abbr(item.stock_uom) || "")}</div>
				</div>
			`)
				.on("click", () => open_form(item))
				.appendTo($results);
		});
	}

	// Scan straight into "receive stock": the goods are in one hand and the
	// scanner in the other, so a recognised code jumps past searching and
	// lands on the quantity box, ready to type how many arrived.
	if (window.santu_barcode) {
		window.santu_barcode.listen((code) => {
			frappe
				.xcall("santu_hardware.santu_hardware.api.find_item_by_barcode", { barcode: code })
				.then((r) => {
					if (r && r.found) {
						open_form({
							item_code: r.item_code,
							item_name: r.item_name,
							item_name: r.item_name,
							stock_uom: r.stock_uom,
							available_qty: r.available_qty,
						});
						frappe.show_alert({ message: __("{0}", [r.item_name]), indicator: "green" });
						return;
					}
					// Unknown code: put it in the search box so the operator can
					// find the item by name and, once found, the Sale screen's
					// attach flow will bind it. Never a dead end.
					show_step($search_step);
					$search.val(code).trigger("focus").trigger("select");
					frappe.show_alert({
						message: __("Ye barcode kisi saman par nahi laga — naam se dhoondhiye"),
						indicator: "orange",
					});
				})
				.catch(() => {});
		}, "santu-receive-stock");
	}

	function open_form(item) {
		selected_item = item;
		$root.find(".santu-receive-item-card").html(`
			<div class="santu-receive-item-name">${frappe.utils.escape_html(item.item_name)}</div>
			<div class="santu-receive-item-meta">Currently in stock: ${item.available_qty ?? 0} ${frappe.utils.escape_html(santu_uom.abbr(item.stock_uom) || "")}</div>
		`);
		$root.find(".santu-receive-qty-input").val(1);
		$root.find(".santu-receive-rate-input").val("");
		show_step($form_step);
		$root.find(".santu-receive-qty-input").trigger("focus").trigger("select");
	}

	$root.find(".santu-receive-back").on("click", () => {
		show_step($search_step);
		$search.trigger("focus");
	});

	$root.find(".santu-receive-qty-minus").on("click", () => {
		const $input = $root.find(".santu-receive-qty-input");
		const val = Math.max(1, (parseInt($input.val(), 10) || 1) - 1);
		$input.val(val);
	});
	$root.find(".santu-receive-qty-plus").on("click", () => {
		const $input = $root.find(".santu-receive-qty-input");
		const val = (parseInt($input.val(), 10) || 0) + 1;
		$input.val(val);
	});
	$root.find(".santu-receive-qty-quick-btn").on("click", function () {
		const $input = $root.find(".santu-receive-qty-input");
		const add = parseInt($(this).data("add"), 10) || 0;
		const val = (parseInt($input.val(), 10) || 0) + add;
		$input.val(val);
	});

	$root.find(".santu-receive-submit").on("click", async () => {
		const qty = parseInt($root.find(".santu-receive-qty-input").val(), 10);
		const rate = $root.find(".santu-receive-rate-input").val();

		if (!selected_item || !qty || qty <= 0) {
			frappe.show_alert({ message: "Enter how much stock arrived first.", indicator: "orange" });
			return;
		}

		const $btn = $root.find(".santu-receive-submit");
		$btn.prop("disabled", true).text("Adding...");

		try {
			const args = { item_code: selected_item.item_code, qty: qty };
			if (rate) args.rate = rate;
			const result = await frappe.xcall("santu_hardware.santu_hardware.api.receive_stock_simple", args);

			received_today.unshift({ item_name: selected_item.item_name, qty });
			render_today();

			$root.find(".santu-receive-success-text").html(`
				<b>${frappe.utils.escape_html(selected_item.item_name)}</b><br>
				+${qty} ${frappe.utils.escape_html(selected_item.stock_uom || "")} added.<br>
				Total stock now: <b>${result.new_qty}</b> ${frappe.utils.escape_html(selected_item.stock_uom || "")}
			`);
			show_step($success_step);
		} catch (e) {
			frappe.show_alert({ message: "Something went wrong, please try again.", indicator: "red" });
		} finally {
			$btn.prop("disabled", false).text("✅ Add to Stock");
		}
	});

	$root.find(".santu-receive-another").on("click", () => {
		selected_item = null;
		$search.val("");
		$results.empty();
		show_step($search_step);
		$search.trigger("focus");
	});

	const pending_item = sessionStorage.getItem("santu_receive_item");
	if (pending_item) {
		sessionStorage.removeItem("santu_receive_item");
		$search.val(pending_item);
		run_search();
	}
}
