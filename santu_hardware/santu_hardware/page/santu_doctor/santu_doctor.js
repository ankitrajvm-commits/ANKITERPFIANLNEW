/* global frappe */

// Doctor — "kuch kaam nahi kar raha" ka ek hi jawab.
//
// Deliberately not a technical panel: each row says in plain Hindi what was
// checked and what it means, and where the app can repair something itself it
// offers exactly one button for that one thing. Nothing here runs on its own —
// the shop presses Jaanch, reads, and chooses.

frappe.pages["santu-doctor"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Doctor Uncle"),
		single_column: true,
	});
	$(page.wrapper).find(".page-head").hide();

	const $body = $(page.body);
	$body.html(`
		<div class="santu-doc">
			<div class="santu-doc-head">
				<div>
					<div class="santu-doc-title">${__("Doctor Uncle")}</div>
					<div class="santu-doc-sub">${__("App me kuch kaam na kare — khaaskar printer — to yahan se jaanchein.")}</div>
				</div>
				<div class="santu-doc-actions">
					<button type="button" class="santu-doc-run">${__("Sab jaanchein")}</button>
					<button type="button" class="santu-doc-fixall">${__("Sab theek karein")}</button>
				</div>
			</div>
			<div class="santu-doc-summary" style="display:none;"></div>
			<div class="santu-doc-list"></div>
		</div>
	`);

	const $list = $body.find(".santu-doc-list");
	const $summary = $body.find(".santu-doc-summary");
	const $run = $body.find(".santu-doc-run");

	const LABEL = {
		ok: __("Theek hai"),
		warn: __("Dhyan dein"),
		fail: __("Kharaab hai"),
		unknown: __("Pata nahi chala"),
	};

	// The browser-side QZ Tray probe used to live here. It was removed on
	// 2026-08-17 along with QZ itself: bills are printed by the server now,
	// so a red row about a browser bridge nothing uses would send whoever
	// reads this screen chasing a problem that cannot affect a bill. The
	// server-side checks — print queue ready, queue empty, USB reachable —
	// test the routes a bill actually takes.

	// One row per check: a coloured dot, what was checked, what was found,
	// and — only where the app can actually mend it — a single button for
	// that one thing.
	function row_html(r) {
		const status = r.status || "unknown";
		const esc = frappe.utils.escape_html;
		const fix =
			r.fix && (status === "fail" || status === "warn")
				? `<button type="button" class="santu-doc-fix" data-fix="${esc(r.fix)}">${esc(r.fix_label || __("Theek karein"))}</button>`
				: "";
		return `
			<div class="santu-doc-row is-${esc(status)}">
				<div class="santu-doc-dot"></div>
				<div class="santu-doc-text">
					<div class="santu-doc-row-title">${esc(r.title || "")}</div>
					<div class="santu-doc-row-detail">${esc(r.detail || "")}</div>
				</div>
				<div class="santu-doc-right">
					<span class="santu-doc-badge">${esc(LABEL[status] || status)}</span>
					${fix}
				</div>
			</div>`;
	}

	function render(results) {
		$list.html(results.map(row_html).join(""));
		// The button stays put whether or not anything is broken. Hiding it when
		// the shop is healthy meant the one control someone goes looking for in
		// a panic was missing exactly when they looked (2026-08-17 feedback) —
		// so it is always there, and simply reports that nothing needed doing.
		const fixable = results.filter((r) => r.fix && (r.status === "fail" || r.status === "warn")).length;
		$body.find(".santu-doc-fixall")
			.prop("disabled", false)
			.toggleClass("is-idle", fixable === 0)
			.text(fixable ? __("Sab theek karein ({0})", [fixable]) : __("Sab theek karein"));
		const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
		const bad = (counts.fail || 0) + (counts.warn || 0);
		$summary
			.show()
			.removeClass("is-clean is-bad")
			.addClass(bad ? "is-bad" : "is-clean")
			.text(
				bad
					? __("{0} cheezein dhyan maangti hain, {1} theek hain.", [bad, counts.ok || 0])
					: __("Sab theek hai — {0} jaanch paas.", [counts.ok || 0])
			);
	}

	function run() {
		$run.prop("disabled", true).text(__("Jaanch ho rahi hai…"));
		$list.html(`<div class="santu-doc-empty">${__("Ek-ek karke jaanch rahe hain…")}</div>`);
		frappe
			.xcall("santu_hardware.santu_hardware.doctor.run_checks")
			.then((server) => render((server && server.results) || []))
			.catch((e) => {
				$list.html(`<div class="santu-doc-empty">${__("Jaanch nahi ho payi.")} ${frappe.utils.escape_html(String((e && e.message) || ""))}</div>`);
			})
			// .finally(), not jQuery's .always(): frappe.xcall returns a native
			// Promise, so .always is undefined and throws synchronously — which
			// aborted on_page_load and left Frappe's page container hidden, so
			// the screen rendered into a box nobody could see.
			.finally(() => $run.prop("disabled", false).text(__("Sab jaanchein")));
	}

	$run.on("click", run);

	$body.find(".santu-doc-fixall").on("click", function () {
		const $btn = $(this);
		$btn.prop("disabled", true).text(__("Theek kar rahe hain…"));
		frappe
			.xcall("santu_hardware.santu_hardware.doctor.fix_everything")
			.then((r) => {
				const fixed = (r && r.fixed) || [];
				const failed = (r && r.failed) || [];
				let message = __("Theek karne layak kuch nahi tha — sab pehle se sahi hai.");
				let indicator = "blue";
				if (failed.length) {
					message = __("{0} theek hue, {1} nahi ho paye.", [fixed.length, failed.length]);
					indicator = "orange";
				} else if (fixed.length) {
					message = __("{0} cheezein theek kar di.", [fixed.length]);
					indicator = "green";
				}
				frappe.show_alert({ message, indicator });
				if (r && r.results) render(r.results);
				else run();
			})
			.catch(() => {
				frappe.show_alert({ message: __("Theek nahi ho paya."), indicator: "red" });
				$btn.prop("disabled", false).text(__("Sab theek karein"));
			});
	});

	$list.on("click", ".santu-doc-fix", function () {
		const $btn = $(this);
		const fix = $btn.data("fix");
		$btn.prop("disabled", true).text(__("Theek kar rahe hain…"));
		frappe
			.xcall("santu_hardware.santu_hardware.doctor.apply_fix", { fix })
			.then((r) => {
				frappe.show_alert({
					message: (r && r.message) || __("Ho gaya"),
					indicator: r && r.ok ? "green" : "orange",
				});
				run();
			})
			.catch(() => {
				frappe.show_alert({ message: __("Theek nahi ho paya."), indicator: "red" });
				$btn.prop("disabled", false).text(__("Theek karein"));
			});
	});

	run();
};
