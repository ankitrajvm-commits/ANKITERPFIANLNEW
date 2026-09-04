/* App Lock fingerprint (Touch ID) — the WebAuthn ceremony itself, shared
 * between two very different JS contexts that both need it:
 *   1. www/santu_unlock.html — a raw guest page with none of Desk's JS
 *      loaded, included there via a plain <script src="..."> tag.
 *   2. santu_app_lock.js's own re-lock overlay, and the "Add this Mac"
 *      button on Utilities > Cost Price Lock — both inside the normal
 *      app_include_js bundle.
 * One file, loaded in both places, rather than the same ~60 lines copied
 * into each — this codebase has been bitten before by a rule duplicated
 * across callers quietly drifting apart (see quick_create_item fanout).
 *
 * Depends only on frappe.xcall existing (true in both contexts — Desk
 * pages have it from core; santu_unlock.html loads frappe's own web
 * bundle for exactly this) and on window.__ / window.frappe.show_alert /
 * frappe.msgprint being present where used, which they are in both.
 */
(function () {
	const API = "santu_hardware.santu_hardware.api";

	function b64url(buffer) {
		const bytes = new Uint8Array(buffer);
		let s = "";
		for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
		return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	function from_b64url(str) {
		const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
		const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes.buffer;
	}

	function platform_authenticator_possible() {
		// Touch ID is reachable only over a secure context. localhost counts
		// as secure, so this works without a certificate on this one-Mac
		// setup.
		return !!(window.PublicKeyCredential && window.isSecureContext);
	}

	// santu_unlock.html has none of Desk's JS loaded, so frappe.xcall does
	// not exist there — only a plain window.fetch does. This falls back to
	// a raw POST (matching exactly what that page's own pin_login call
	// already does) whenever frappe.xcall is unavailable, and uses
	// frappe.xcall normally inside Desk. window.SANTU_CSRF_TOKEN is set by
	// santu_unlock.html itself (Jinja-rendered — that guest session has no
	// cookie to read one back out of); inside Desk frappe.xcall handles
	// CSRF on its own and this constant is simply unused.
	async function callMethod(method, args) {
		if (window.frappe && frappe.xcall) {
			return frappe.xcall(`${API}.${method}`, args);
		}
		const res = await fetch(`/api/method/${API}.${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Frappe-CSRF-Token": window.SANTU_CSRF_TOKEN || "",
			},
			body: JSON.stringify(args || {}),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error((data && data.exception) || "request failed");
		}
		return data.message;
	}

	window.santu_app_lock_webauthn = {
		available() {
			return platform_authenticator_possible();
		},

		// Attempts a fingerprint unlock. Resolves true only after the
		// server has verified the signature AND established a real
		// session (app_lock_touch_id_login_finish calls login_as itself,
		// same as pin_login) — false for "not set up", "cancelled", or
		// any failure, all treated alike: fall back to the PIN, never
		// leave the caller stuck.
		async tryLogin() {
			if (!platform_authenticator_possible()) return false;
			try {
				const opts = await callMethod("app_lock_touch_id_login_options");
				if (!opts || !opts.available) return false;

				const assertion = await navigator.credentials.get({
					publicKey: {
						challenge: from_b64url(opts.challenge),
						rpId: opts.rpId,
						timeout: opts.timeout,
						userVerification: "required",
						allowCredentials: (opts.allowCredentials || []).map((c) => ({
							type: "public-key",
							id: from_b64url(c.id),
						})),
					},
				});
				if (!assertion) return false;

				const res = await callMethod("app_lock_touch_id_login_finish", {
					credential_id: assertion.id,
					authenticator_data: b64url(assertion.response.authenticatorData),
					client_data: b64url(assertion.response.clientDataJSON),
					signature: b64url(assertion.response.signature),
				});
				return !!(res && res.ok);
			} catch (e) {
				// Cancelling the Touch ID sheet throws — that is a normal way
				// to say "let me type the PIN instead", not an error.
				return false;
			}
		},

		// Registers this Mac. Only ever called from an already-authenticated
		// Settings screen (the backend enforces System Manager + a PIN
		// already being set regardless).
		async register(label) {
			if (!platform_authenticator_possible()) {
				frappe.msgprint({
					title: __("Not available here"),
					message: __(
						"Fingerprint unlock needs a Mac with Touch ID, and the app opened over a secure address (https, or localhost)."
					),
					indicator: "orange",
				});
				return false;
			}
			try {
				const opts = await frappe.xcall(`${API}.app_lock_touch_id_register_options`);
				const cred = await navigator.credentials.create({
					publicKey: {
						challenge: from_b64url(opts.challenge),
						rp: opts.rp,
						user: {
							id: from_b64url(opts.user.id),
							name: opts.user.name,
							displayName: opts.user.displayName,
						},
						pubKeyCredParams: opts.pubKeyCredParams,
						timeout: opts.timeout,
						authenticatorSelection: {
							authenticatorAttachment: "platform",
							userVerification: "required",
							residentKey: "preferred",
						},
					},
				});
				if (!cred) return false;

				const spki = cred.response.getPublicKey && cred.response.getPublicKey();
				if (!spki) {
					frappe.msgprint(__("This browser could not share the device key. Please use Safari or Chrome."));
					return false;
				}

				const res = await frappe.xcall(`${API}.app_lock_touch_id_register_finish`, {
					credential_id: cred.id,
					public_key: b64url(spki),
					client_data: b64url(cred.response.clientDataJSON),
					label: label || navigator.platform || "This Mac",
				});
				if (res && res.ok) {
					frappe.show_alert({ message: __("Fingerprint added"), indicator: "green" });
					return true;
				}
				return false;
			} catch (e) {
				if (e && e.name === "NotAllowedError") return false; // cancelled
				frappe.msgprint(__("Could not set up fingerprint unlock on this Mac."));
				console.error(e);
				return false;
			}
		},
	};
})();
