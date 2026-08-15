/* global frappe, santu_set_privacy_mode, santu_is_privacy_mode_active */

// Privacy Mode's lock. What it guards is cost price — the number that tells
// a customer leaning over the counter exactly what margin they are being
// asked to pay. Until now it was guarded by the string "7739" written into
// the source, and nothing on any screen called the toggle at all.
//
// Unlock order: Touch ID if this Mac has been registered, PIN otherwise.
// The fingerprint is a shortcut for the PIN, never a replacement — the PIN
// must exist first, and changing it retires every registered fingerprint.
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
		// as secure, so this works in development without a certificate.
		return !!(window.PublicKeyCredential && window.isSecureContext);
	}

	window.santu_privacy = {
		status() {
			return frappe.xcall(`${API}.get_privacy_status`);
		},

		// ---------- unlocking ----------

		async unlock() {
			const st = await this.status();
			if (!st.pin_set) {
				if (!st.can_manage) {
					frappe.msgprint({
						title: __("Locked"),
						message: __("Cost price is locked and no PIN has been set yet. Ask the owner to set one in Settings."),
						indicator: "orange",
					});
					return false;
				}
				const set_now = await new Promise((resolve) =>
					frappe.confirm(
						__("No PIN has been set for viewing cost price. Set one now?"),
						() => resolve(true),
						() => resolve(false)
					)
				);
				if (!set_now) return false;
				const done = await this.set_pin_dialog();
				if (!done) return false;
			}

			if (st.touch_id_devices && platform_authenticator_possible()) {
				const ok = await this._try_touch_id();
				if (ok) return true;
				// Falling through to the PIN is deliberate: a finger that will
				// not read, or a cancelled prompt, must not lock someone out
				// mid-sale.
			}
			return await this._ask_pin();
		},

		async _try_touch_id() {
			try {
				const opts = await frappe.xcall(`${API}.touch_id_login_options`);
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

				const res = await frappe.xcall(`${API}.touch_id_login_finish`, {
					credential_id: assertion.id,
					authenticator_data: b64url(assertion.response.authenticatorData),
					client_data: b64url(assertion.response.clientDataJSON),
					signature: b64url(assertion.response.signature),
				});
				return !!(res && res.ok);
			} catch (e) {
				// Cancelling the Touch ID sheet throws; that is a normal way to
				// say "let me type it instead", not an error worth showing.
				return false;
			}
		},

		_ask_pin() {
			return new Promise((resolve) => {
				// d.hide() fires onhide, so a plain `onhide -> resolve(false)`
				// beats the success path's own resolve(true) and the unlock
				// silently fails. Settle once, deliberately.
				let settled = false;
				const finish = (value) => {
					if (settled) return;
					settled = true;
					resolve(value);
				};
				const d = new frappe.ui.Dialog({
					title: __("Show cost price"),
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "hint",
							options: `<div class="santu-privacy-hint">${__(
								"Cost price stays hidden so customers cannot see your margin."
							)}</div>`,
						},
						{ fieldtype: "Password", fieldname: "pin", label: __("PIN"), reqd: 1 },
					],
					primary_action_label: __("Unlock"),
					primary_action: async (v) => {
						const res = await frappe.xcall(`${API}.check_privacy_mode_pin`, { pin: v.pin });
						if (res && res.ok) {
							finish(true);
							d.hide();
						} else {
							frappe.show_alert({ message: __("Wrong PIN"), indicator: "red" });
						}
					},
					secondary_action_label: __("Cancel"),
					secondary_action: () => {
						finish(false);
						d.hide();
					},
				});
				d.onhide = () => finish(false);
				d.show();
				setTimeout(() => d.fields_dict.pin && d.fields_dict.pin.$input.focus(), 150);
			});
		},

		// ---------- managing ----------

		set_pin_dialog() {
			return new Promise((resolve) => {
				let settled = false;
				const finish = (value) => {
					if (settled) return;
					settled = true;
					resolve(value);
				};
				this.status().then((st) => {
					const fields = [];
					if (st.pin_set && !st.can_manage) {
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
					if (st.pin_set && st.touch_id_devices) {
						fields.push({
							fieldtype: "HTML",
							fieldname: "warn",
							options: `<div class="santu-privacy-warn">${__(
								"Changing the PIN will also remove the {0} fingerprint(s) already registered. You can add them again afterwards.",
								[st.touch_id_devices]
							)}</div>`,
						});
					}

					const d = new frappe.ui.Dialog({
						title: st.pin_set ? __("Change cost-price PIN") : __("Set cost-price PIN"),
						fields,
						primary_action_label: __("Save"),
						primary_action: async (v) => {
							if (v.new_pin !== v.confirm_pin) {
								frappe.show_alert({ message: __("The two PINs do not match."), indicator: "orange" });
								return;
							}
							try {
								await frappe.xcall(`${API}.set_privacy_pin`, {
									new_pin: v.new_pin,
									current_pin: v.current_pin || null,
								});
								finish(true);
								d.hide();
								frappe.show_alert({ message: __("PIN saved"), indicator: "green" });
							} catch (e) {
								// The server's message says exactly what is wrong
								// with the PIN; frappe has already shown it.
							}
						},
					});
					d.onhide = () => finish(false);
					d.show();
				});
			});
		},

		async register_touch_id() {
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
				const opts = await frappe.xcall(`${API}.touch_id_register_options`);
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
							// "platform" is what keeps this on the Mac's own
							// Secure Enclave rather than a USB key.
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

				const res = await frappe.xcall(`${API}.touch_id_register_finish`, {
					credential_id: cred.id,
					public_key: b64url(spki),
					client_data: b64url(cred.response.clientDataJSON),
					label: navigator.platform || "This Mac",
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

		async manage_dialog() {
			const st = await this.status();
			const d = new frappe.ui.Dialog({
				title: __("Cost Price Lock"),
				fields: [{ fieldtype: "HTML", fieldname: "body" }],
			});
			const render = async () => {
				const s = await this.status();
				d.fields_dict.body.$wrapper.html(`
					<div class="santu-privacy-manage">
						<p>${__(
							"Cost price is hidden on the billing and sale screens so a customer standing at the counter cannot see your margin. Unlock it when you need to judge a discount."
						)}</p>
						<div class="santu-privacy-row">
							<span>${__("PIN")}</span>
							<b>${s.pin_set ? __("Set") : __("Not set")}</b>
							<button class="btn btn-sm santu-privacy-set-pin">${s.pin_set ? __("Change") : __("Set PIN")}</button>
						</div>
						<div class="santu-privacy-row">
							<span>${__("Fingerprint (Touch ID)")}</span>
							<b>${s.touch_id_devices ? __("{0} device(s)", [s.touch_id_devices]) : __("Not set up")}</b>
							<button class="btn btn-sm santu-privacy-add-touch" ${s.pin_set ? "" : "disabled"}>${__("Add this Mac")}</button>
						</div>
						${
							s.pin_set
								? ""
								: `<div class="santu-privacy-warn">${__("Set a PIN first — the fingerprint is a shortcut for it.")}</div>`
						}
					</div>
				`);
				d.$wrapper.find(".santu-privacy-set-pin").on("click", async () => {
					if (await this.set_pin_dialog()) render();
				});
				d.$wrapper.find(".santu-privacy-add-touch").on("click", async () => {
					if (await this.register_touch_id()) render();
				});
			};
			await render();
			d.show();
			return st;
		},
	};

	// The single entry point every screen calls. Turning privacy OFF stays
	// free — only revealing costs is gated.
	window.santu_toggle_privacy_mode = async function () {
		if (typeof santu_is_privacy_mode_active === "function" && santu_is_privacy_mode_active()) {
			santu_set_privacy_mode(false);
			return false;
		}
		const ok = await window.santu_privacy.unlock();
		if (ok) santu_set_privacy_mode(true);
		return ok;
	};
})();
