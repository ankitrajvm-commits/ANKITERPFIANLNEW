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

	function show_lock_screen(message) {
		const overlay = document.createElement("div");
		overlay.id = "santu-applock-overlay";
		overlay.innerHTML = `
			<div class="santu-applock-card">
				<div class="santu-applock-logo">🔒</div>
				<div class="santu-applock-title">Santu Hardware</div>
				<div class="santu-applock-sub">${message ? message.replace(/</g, "&lt;") : "PIN daaliye"}</div>
				<input type="password" inputmode="numeric" autocomplete="off"
					maxlength="8" class="santu-applock-input" placeholder="••••">
				<div class="santu-applock-error"></div>
				<button type="button" class="santu-applock-btn">Unlock</button>
				<button type="button" class="santu-applock-fp" style="display:none;">&#128070; Fingerprint se kholo</button>
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

		// Try the fingerprint first, same as /santu_unlock — a re-lock
		// (via "Lock App") should feel exactly as fast to get back into as
		// the very first unlock did. Falls straight through to the PIN box
		// on any cancel/failure/not-set-up, and the BUTTON stays on screen so
		// a dismissed Touch ID sheet can be tried again without reloading
		// (2026-09-05: with no button, a cancelled prompt meant PIN only).
		const $fp = overlay.querySelector(".santu-applock-fp");

		async function try_fingerprint() {
			$fp.disabled = true;
			const ok = await santu_app_lock_webauthn.tryLogin();
			$fp.disabled = false;
			if (ok) {
				mark_unlocked();
				overlay.remove();
				reveal();
				return true;
			}
			$input.focus();
			return false;
		}

		(async () => {
			if (!window.santu_app_lock_webauthn) {
				$input.focus();
				return;
			}
			const fp = await santu_app_lock_webauthn.availability();
			if (!(fp.mode && fp.enrolled)) {
				$input.focus();
				return;
			}
			$fp.style.display = "block";
			$fp.addEventListener("click", try_fingerprint);
			await try_fingerprint();
		})();
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

	// ---------- replace Frappe's own login/logout surface ----------
	// Direct request (2026-09-04): "Frappe ka normal username + password
	// login system frontend par use nahi karna hai... single global PIN".
	//
	// The shop's browser already stays signed in to one real Frappe
	// session for days at a time (System Settings > Session Expiry,
	// extended further below) — this PIN was never meant to replace that
	// session, only to sit in front of it, the way a phone's lock screen
	// sits in front of an already-signed-in Google account. Signing all
	// the way out would mean the NEXT unlock needs Frappe's real
	// username/password form, which is exactly what this was asked to
	// remove. So "Log out" (both the custom More-menu one in
	// santu_topbar.js and Frappe's own native avatar-menu one — both call
	// this same function) is repointed to just re-lock: it clears the
	// unlocked flag and shows the PIN screen again, without ever calling
	// the real logout endpoint or touching the session cookie.
	//
	// `handle_session_expired` (frappe/public/js/frappe/desk.js) is the
	// one place ANY API call funnels into when the server reports the
	// session really has expired — the case this can't paper over, since
	// there is no valid session left to sit in front of. Rather than let
	// that fall through to Frappe's real /login page, it shows the PIN
	// screen with an explanatory message instead: still no
	// username/password form on screen, even though unlocking here can't
	// restore API access by itself (the shop would need an admin to sign
	// in for real). That trade-off is the honest one — there's no PIN
	// that regenerates a dead server-side session.
	// Plain information screen: no PIN input, because there's nothing valid
	// to check it against (no PIN configured). Used only for the genuine
	// session-expired case with App Lock off, where doing nothing would
	// leave the shop staring at a silently broken app with zero
	// explanation — but a real username/password form is exactly what was
	// asked to disappear, so this is the honest middle ground.
	function show_message_screen(message) {
		const overlay = document.createElement("div");
		overlay.id = "santu-applock-overlay";
		overlay.innerHTML = `
			<div class="santu-applock-card">
				<div class="santu-applock-logo">⚠️</div>
				<div class="santu-applock-title">Santu Hardware</div>
				<div class="santu-applock-sub">${message.replace(/</g, "&lt;")}</div>
				<button type="button" class="santu-applock-btn santu-applock-retry">Dobara Try Karein</button>
			</div>
		`;
		document.body.appendChild(overlay);
		overlay.style.visibility = "visible";
		overlay.querySelector(".santu-applock-retry").addEventListener("click", () => location.reload());
	}

	function relock(message) {
		// Guard against a dead-end screen: if no PIN is actually configured
		// (App Lock turned off, or session-expired firing before anyone has
		// ever set one up), showing the PIN prompt would trap the shop on a
		// screen nothing can unlock. Confirm a PIN really exists first.
		frappe
			.xcall(`${API}.get_app_lock_status`)
			.then((res) => {
				document.getElementById("santu-applock-overlay")?.remove();
				if (!res || !res.enabled) {
					if (message) {
						// Session-expired path with no PIN configured: explain,
						// don't silently do nothing and don't show Frappe's
						// real login form either.
						document.documentElement.style.visibility = "hidden";
						show_message_screen(
							message + " (App Lock abhi set nahi hai — Utilities > Cost Price Lock se PIN set karein.)"
						);
					} else {
						frappe.msgprint(
							__("App Lock abhi set nahi hai — Utilities > Cost Price Lock se pehle ek PIN set kariye.")
						);
					}
					return;
				}
				try {
					sessionStorage.removeItem(SESSION_KEY);
				} catch (e) {
					/* ignore */
				}
				document.documentElement.style.visibility = "hidden";
				show_lock_screen(message);
			})
			.catch(() => {
				// Can't even ask — same fail-open principle as boot(): do
				// nothing rather than risk an unrecoverable lock.
			});
	}

	function wire_frappe_app_overrides() {
		if (!window.frappe || !frappe.app) return false;
		frappe.app.logout = function () {
			relock();
		};
		frappe.app.handle_session_expired = function () {
			relock("Session dobara shuru karne ke liye ek baar Admin se sign in karwaiye.");
		};
		return true;
	}

	// `frappe.ready` does not exist as a public hook on this Frappe version
	// (confirmed live 2026-09-04 — it is `undefined`, not a function), so
	// boot() runs off DOMContentLoaded like any plain page script. Wiring
	// the logout/session-expired overrides can't wait for any DOM event at
	// all though: frappe.app itself is only created inside desk.js's own
	// `$(document).ready` handler, whose relative firing order against this
	// one isn't something to depend on. Poll for it instead — cheap, and
	// self-cancelling the moment frappe.app shows up.
	document.addEventListener("DOMContentLoaded", boot);
	(function poll_for_frappe_app() {
		if (wire_frappe_app_overrides()) return;
		const iv = setInterval(() => wire_frappe_app_overrides() && clearInterval(iv), 200);
		setTimeout(() => clearInterval(iv), 15000);
	})();

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
