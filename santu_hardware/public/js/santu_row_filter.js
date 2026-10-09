/* global frappe, $ */
// "Is bill me wo ek item kahan hai?" — a search box over the lines ALREADY
// added to a bill, estimate, challan, order or return.
//
// A 50-line bill is normal here (the Pinkal Singh estimate is 48), and
// finding one line in it meant scrolling the whole grid and reading every
// row (2026-10-07 request: "to find that one item which has been already
// added there takes too much efforts").
//
// Deliberately ONE shared file rather than an edit to each of the item-entry
// screens. Those screens re-render their rows constantly — every quantity
// keystroke, every stock refresh — and eleven separate copies of this would
// be eleven places to break. Same reasoning as santu_qty_prefix.js, which is
// the other behaviour shared across exactly these screens.
//
// It only ever HIDES table rows. The bill's own data, row order, totals and
// save payload are untouched — a hidden row is still on the bill, which is
// why the counter is told how many are hidden rather than left to wonder.
(function () {
	// Both grid families in this app, which differ only in their wrapper:
	// Billing/Estimate/Returns use .santu-bill-grid, the si2 screens
	// (Challan/Orders/Purchase) use .santu-si2-table. Rows in both carry
	// data-row, which is what makes one implementation possible.
	const GRIDS = ".santu-bill-grid, .santu-si2-table";
	const BOX_CLASS = "santu-rowfilter";
	// Below this many lines the box is noise — a 4-item bill is read at a
	// glance and the row heights are what the counter is used to.
	const MIN_ROWS = 8;

	const state = { query: "" };

	function rows_of($grid) {
		return $grid.find("tbody tr[data-row]");
	}

	function row_text($tr) {
		// Cached per render: every keystroke would otherwise walk the whole
		// row's DOM again, and a 60-line bill makes that visible.
		let t = $tr.data("santu-ft");
		if (t == null) {
			// Only the code and name cells. Including the whole row would match
			// quantities and rates too, so typing "12" would light up every line
			// priced 12 — the opposite of narrowing down.
			const $cells = $tr.find(".c-code, .c-name, .santu-si2-col-item, .santu-si2-col-code");
			t = ($cells.length ? $cells.text() : $tr.find("td").slice(0, 3).text())
				.toLowerCase()
				.replace(/\s+/g, " ")
				.trim();
			$tr.data("santu-ft", t);
		}
		return t;
	}

	function apply($grid) {
		const q = (state.query || "").toLowerCase().trim();
		const $rows = rows_of($grid);
		let shown = 0;
		$rows.each(function () {
			const $tr = $(this);
			const hit = !q || row_text($tr).indexOf(q) !== -1;
			// A plain style toggle, not .hide(): these are table rows, and the
			// screens' own code reads them back by data-row.
			$tr.css("display", hit ? "" : "none");
			if (hit) shown++;
		});
		const $box = $grid.closest(".santu-rowfilter-host").find("." + BOX_CLASS);
		const $count = $box.find(".santu-rowfilter-count");
		if (!q) {
			$count.text("");
			$box.removeClass("is-filtering");
		} else {
			$count.text(__("{0} of {1}", [shown, $rows.length]));
			$box.toggleClass("is-filtering", true);
			$box.toggleClass("is-empty", shown === 0);
		}
	}

	function mount($grid) {
		const $host = $grid.closest(".santu-si2-table-wrap, .santu-bill-grid-wrap").length
			? $grid.closest(".santu-si2-table-wrap, .santu-bill-grid-wrap")
			: $grid.parent();
		$host.addClass("santu-rowfilter-host");

		let $box = $host.find("." + BOX_CLASS);
		if (!$box.length) {
			$box = $(`
				<div class="${BOX_CLASS}">
					<span class="santu-rowfilter-ico">🔍</span>
					<input type="text" class="santu-rowfilter-input"
						placeholder="${__("Is bill me saman dhundhein…")}"
						autocomplete="off" spellcheck="false">
					<span class="santu-rowfilter-count"></span>
					<button type="button" class="santu-rowfilter-clear" title="${__("Saaf karein")}">✕</button>
				</div>
			`);
			$host.prepend($box);

			const $input = $box.find(".santu-rowfilter-input");
			$input.on("input", function () {
				state.query = this.value;
				apply($grid);
			});
			$input.on("keydown", function (e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					state.query = "";
					this.value = "";
					apply($grid);
				}
			});
			$box.find(".santu-rowfilter-clear").on("click", function () {
				state.query = "";
				$input.val("").focus();
				apply($grid);
			});
		}
		return $box;
	}

	function refresh() {
		const $grid = $(GRIDS).filter(":visible").first();
		if (!$grid.length) return;
		const $rows = rows_of($grid);
		if ($rows.length < MIN_ROWS) {
			// Too few lines to need it — and a filter left over from a longer
			// bill must not keep rows hidden on the next one.
			$grid.closest(".santu-rowfilter-host").find("." + BOX_CLASS).remove();
			if (state.query) {
				state.query = "";
				$rows.css("display", "");
			}
			return;
		}
		const $box = mount($grid);
		// A re-render replaces the rows, so the typed query has to be put back
		// over the new ones or the search silently stops working the moment a
		// quantity is changed.
		const $input = $box.find(".santu-rowfilter-input");
		if ($input.val() !== state.query) $input.val(state.query);
		apply($grid);
	}

	// The screens never announce a re-render, so this watches for one. Debounced
	// because a single render fires many mutations.
	let timer = null;
	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(refresh, 80);
	}

	function start() {
		const target = document.querySelector(".main-section") || document.body;
		new MutationObserver(schedule).observe(target, { childList: true, subtree: true });
		schedule();
	}

	// Leaving a screen must not carry one bill's search over to the next.
	$(document).on("page-change", function () {
		state.query = "";
		schedule();
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}

	// Exposed for tests and for a screen that wants to clear the box itself.
	window.santu_row_filter = {
		clear() {
			state.query = "";
			refresh();
		},
		get query() {
			return state.query;
		},
	};
})();
