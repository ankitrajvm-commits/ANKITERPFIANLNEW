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

	// ---- native Touch ID (the Mac app) --------------------------------
	//
	// WebAuthn DOES NOT WORK INSIDE THE MAC APP. Measured 2026-09-05 on the
	// shop's own MacBook Air M3 with Touch ID enrolled: inside a WKWebView
	// `window.PublicKeyCredential` exists and `isSecureContext` is true, but
	// `isUserVerifyingPlatformAuthenticatorAvailable()` resolves FALSE —
	// platform authenticators are only handed to real browsers. The old
	// availability check tested just the first two, so the lock screen
	// believed fingerprint was available, silently failed, and dropped to
	// "PIN daaliye" every single time. That is why the fingerprint has never
	// appeared in the app, however many times it was asked for.
	//
	// The Mac shell therefore exposes a native bridge (TouchIDBridge in
	// SantuHardwareApp/Sources/main.swift). Same rule as before: the
	// fingerprint is a SHORTCUT FOR THE PIN, never a replacement — Touch ID
	// only releases a device token this Mac was given in exchange for a
	// correct PIN, and the server will only trade that token for the same
	// session pin_login hands out. Changing the PIN retires every token.
	// Nothing is trusted that the server would not have trusted from a
	// typed PIN. (The Keychain cannot hold that token: a biometric ACL
	// needs an entitlement this app has no provisioning profile for —
	// SecItemAdd returns -34018 and a signed-with-entitlement build is
	// SIGKILLed at launch. Measured 2026-09-05.)
	function native_bridge() {
		try {
			return (window.webkit && webkit.messageHandlers && webkit.messageHandlers.santuTouchID) || null;
		} catch (e) {
			return null;
		}
	}

	async function native_call(action, extra) {
		const bridge = native_bridge();
		if (!bridge) return null;
		try {
			return await bridge.postMessage(Object.assign({ action }, extra || {}));
		} catch (e) {
			return null;
		}
	}

	function platform_authenticator_possible() {
		// Touch ID is reachable only over a secure context. localhost counts
		// as secure, so this works without a certificate on this one-Mac
		// setup.
		return !!(window.PublicKeyCredential && window.isSecureContext);
	}

	// The honest check the old one skipped — having the API is not the same
	// as having a usable fingerprint sensor behind it.
	async function platform_authenticator_really_available() {
		if (!platform_authenticator_possible()) return false;
		try {
			return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
		} catch (e) {
			return false;
		}
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
			return !!native_bridge() || platform_authenticator_possible();
		},

		// What the lock screen actually needs to draw itself honestly:
		//   mode      "native" | "webauthn" | null   (null = no fingerprint here)
		//   enrolled  is a fingerprint set up on THIS Mac yet
		// Async because both backends can only answer for real
		// asynchronously; the old sync available() could not tell "there is
		// a sensor" from "there is an API that will refuse you".
		async availability() {
			if (native_bridge()) {
				const st = await native_call("status");
				if (!(st && st.available)) return { mode: null, enrolled: false };
				// Enrolled means BOTH sides agree: this Mac has a token AND
				// the server still honours one. Changing the PIN clears the
				// server list, so a Mac holding a retired token must fall
				// back to the PIN rather than offering a button that fails.
				let server_devices = 0;
				try {
					const s = await callMethod("app_lock_device_status");
					server_devices = (s && s.devices) || 0;
				} catch (e) {
					server_devices = 0;
				}
				return { mode: "native", enrolled: !!st.enrolled && server_devices > 0 };
			}
			if (!(await platform_authenticator_really_available())) {
				return { mode: null, enrolled: false };
			}
			let enrolled = false;
			try {
				const opts = await callMethod("app_lock_touch_id_login_options");
				enrolled = !!(opts && opts.available);
			} catch (e) {
				/* treat as not set up */
			}
			return { mode: "webauthn", enrolled };
		},

		// Enrol THIS Mac: mint a random device token, have the app store it
		// behind Touch ID, and register its hash against the current PIN.
		// The PIN is checked server-side by app_lock_device_register, and is
		// never itself written to disk. Native shell only.
		async nativeEnroll(pin) {
			const bytes = new Uint8Array(32);
			crypto.getRandomValues(bytes);
			const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

			// The Mac goes first: if the fingerprint prompt is cancelled,
			// nothing is registered on the server either, so the two can
			// never disagree about whether this Mac is enrolled.
			const saved = await native_call("save", { token });
			if (!saved || !saved.ok) return false;
			try {
				const res = await callMethod("app_lock_device_register", {
					pin,
					token,
					label: navigator.platform || "This Mac",
				});
				if (res && res.ok) return true;
			} catch (e) {
				/* fall through to the rollback below */
			}
			await native_call("forget");
			return false;
		},

		async nativeForget() {
			await native_call("forget");
		},

		// Attempts a fingerprint unlock. Resolves true only after the
		// server has verified the signature AND established a real
		// session (app_lock_touch_id_login_finish calls login_as itself,
		// same as pin_login) — false for "not set up", "cancelled", or
		// any failure, all treated alike: fall back to the PIN, never
		// leave the caller stuck.
		async tryLogin() {
			// Native: Touch ID releases this Mac's device token, and the
			// server trades that token for a session — the same session
			// pin_login hands out, on the same terms.
			if (native_bridge()) {
				const res = await native_call("get");
				if (!res || !res.ok || !res.token) return false;
				try {
					const out = await callMethod("app_lock_device_login", { token: res.token });
					return !!(out && out.ok);
				} catch (e) {
					return false;
				}
			}
			if (!(await platform_authenticator_really_available())) return false;
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
		async register(label, pin) {
			// Native shell: nothing to register with the server — the PIN
			// goes into the Mac's Keychain behind Touch ID. Needs the PIN,
			// checked server-side first so a wrong one can never be stored.
			if (native_bridge()) {
				const entered = pin || (await new Promise((resolve) => {
					frappe.prompt(
						[{ fieldtype: "Password", fieldname: "pin", label: __("Apna App Lock PIN daaliye"), reqd: 1 }],
						(v) => resolve(v.pin),
						__("Fingerprint chalu karein"),
						__("Confirm")
					);
				}));
				if (!entered) return false;
				// No separate PIN check here — app_lock_device_register
				// verifies it server-side before it will store anything, so
				// checking twice only adds a second way for the two to
				// disagree.
				if (await this.nativeEnroll(entered)) {
					frappe.show_alert({ message: __("Fingerprint chalu ho gaya"), indicator: "green" });
					return true;
				}
				frappe.msgprint(__("Is Mac par fingerprint chalu nahi ho paya."));
				return false;
			}
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
