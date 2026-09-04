/* App Login PIN (2026-09-04 direct request: "isme login krne ke liye PIN
 * set kr do") — separate from Privacy Mode's PIN (santu_privacy.js), which
 * only gates seeing cost price. This one gates using the app AT ALL on the
 * shared shop computer: the browser here normally just stays signed in
 * (BUSINESS_RULES.md SS1 — one shared machine, no per-device login flow),
 * so anyone who walks up to it currently gets straight in. When this is
 * turned on, every fresh browser tab shows a full-screen PIN prompt before
 * any Desk content is usable.
 *
 * First script in app_include_js on purpose (hooks.py) — it has to hide the
 * page before there is anything worth looking at, not after.
 */
(function () {
	const API = "santu_hardware.santu_hardware.api";
	const SESSION_KEY = "santu_applock_unlocked";

	// Hide everything the instant this file runs, before the rest of Desk
	// has a chance to paint. Reversed below once we know whether a lock is
	// even needed — most loads it comes right back in well under a second.
	document.documentElement.style.visibility = "hidden";

	function reveal() {
		document.documentElement.style.visibility = "";
	}

	function already_unlocked() {
		try {
			return sessionStorage.getItem(SESSION_KEY) === "1";
		} catch (e) {
			// Private browsing / storage disabled: fail open rather than
			// lock the shop out of its own till over a browser setting.
			return true;
		}
	}

	function mark_unlocked() {
		try {
			sessionStorage.setItem(SESSION_KEY, "1");
		} catch (e) {
			/* nothing to do if storage is unavailable */
		}
	}

	function show_lock_screen() {
		const overlay = document.createElement("div");
		overlay.id = "santu-applock-overlay";
		overlay.innerHTML = `
			<div class="santu-applock-card">
				<div class="santu-applock-logo">🔒</div>
				<div class="santu-applock-title">Santu Hardware</div>
				<div class="santu-applock-sub">PIN daaliye</div>
				<input type="password" inputmode="numeric" autocomplete="off"
					maxlength="8" class="santu-applock-input" placeholder="••••">
				<div class="santu-applock-error"></div>
				<button type="button" class="santu-applock-btn">Unlock</button>
			</div>
		`;
		document.body.appendChild(overlay);
		// The rest of the page stays hidden (visibility: hidden on <html>);
		// this overlay opts back into being visible on top of that.
		overlay.style.visibility = "visible";

		const $input = overlay.querySelector(".santu-applock-input");
		const $error = overlay.querySelector(".santu-applock-error");
		const $btn = overlay.querySelector(".santu-applock-btn");

		function attempt() {
			const pin = $input.value.trim();
			if (!pin) return;
			$btn.disabled = true;
			$error.textContent = "";
			frappe
				.xcall(`${API}.check_app_lock_pin`, { pin })
				.then((res) => {
					$btn.disabled = false;
					if (res && res.ok) {
						mark_unlocked();
						overlay.remove();
						reveal();
					} else {
						$error.textContent = "Galat PIN. Dobara try kariye.";
						$input.value = "";
						$input.focus();
					}
				})
				.catch(() => {
					$btn.disabled = false;
					$error.textContent = "Kuch gadbad hui. Dobara try kariye.";
				});
		}

		$btn.addEventListener("click", attempt);
		$input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") attempt();
		});
		setTimeout(() => $input.focus(), 50);
	}

	function boot() {
		if (already_unlocked()) {
			reveal();
			return;
		}
		frappe
			.xcall(`${API}.get_app_lock_status`)
			.then((res) => {
				if (res && res.enabled) {
					show_lock_screen();
				} else {
					reveal();
				}
			})
			.catch(() => {
				// Can't reach the server to ask — fail open. A lock that can
				// silently strand the shop is worse than no lock.
				reveal();
			});
	}

	if (window.frappe && frappe.ready) {
		frappe.ready(boot);
	} else {
		document.addEventListener("DOMContentLoaded", boot);
	}

	// ---------- settings dialog, used from Utilities > Cost Price Lock ----------
	window.santu_app_lock = {
		status() {
			return frappe.xcall(`${API}.get_app_lock_status`);
		},

		set_pin_dialog(current_enabled) {
			return new Promise((resolve) => {
				let settled = false;
				const finish = (value) => {
					if (settled) return;
					settled = true;
					resolve(value);
				};
				const fields = [];
				if (current_enabled) {
					fields.push({
						fieldtype: "Password",
						fieldname: "current_pin",
						label: __("Current PIN"),
						reqd: 1,
					});
				}
				fields.push(
					{ fieldtype: "Password", fieldname: "new_pin", label: __("New PIN (4 to 8 digits)"), reqd: 1 },
					{ fieldtype: "Password", fieldname: "confirm_pin", label: __("Type it again"), reqd: 1 }
				);
				const d = new frappe.ui.Dialog({
					title: current_enabled ? __("Change app login PIN") : __("Set app login PIN"),
					fields,
					primary_action_label: __("Save"),
					primary_action: async (v) => {
						if (v.new_pin !== v.confirm_pin) {
							frappe.show_alert({ message: __("The two PINs do not match."), indicator: "orange" });
							return;
						}
						try {
							await frappe.xcall(`${API}.set_app_lock_pin`, {
								new_pin: v.new_pin,
								current_pin: v.current_pin || null,
								enabled: 1,
							});
							finish(true);
							d.hide();
							frappe.show_alert({ message: __("PIN saved"), indicator: "green" });
						} catch (e) {
							// Server message already shown by frappe.xcall.
						}
					},
				});
				d.onhide = () => finish(false);
				d.show();
			});
		},

		disable() {
			return frappe.xcall(`${API}.set_app_lock_pin`, { enabled: 0 });
		},
	};
})();
