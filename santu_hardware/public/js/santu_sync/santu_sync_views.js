/* global santu_sync, frappe */
frappe.provide("santu_sync");

/* A backup nobody has opened is a promise, not a backup. Every dump is
   re-read and decompressed after it is written, and this column shows the
   answer — so "Success" can never quietly mean "the command exited 0". */
function santu_sync_verified_cell(r) {
	if (r.status !== "Success") return "";
	const note = frappe.utils.escape_html(r.verify_note || "");
	if (r.verified) return `<span class="santu-sync-text-green" title="${note}">✔ Checked</span>`;
	return `<span class="santu-sync-status-failed" title="${note}">Not checked</span>`;
}

santu_sync.views = {
	async render($wrap, view, { reload } = {}) {
		$wrap.html(`<div class="santu-sync-loading">Loading…</div>`);
		try {
			if (view === "sync_share") return this._sync_share($wrap, reload);
			if (view === "auto_backup") return this._auto_backup($wrap, reload);
			if (view === "backup_computer") return this._backup_computer($wrap, reload);
			if (view === "backup_drive") return this._backup_drive($wrap, reload);
			if (view === "restore_backup") return this._restore($wrap, reload);
		} catch (e) {
			$wrap.html(`<div class="santu-sync-error">${frappe.utils.escape_html(e.message || "Failed to load")}</div>`);
		}
	},

	_history_table($parent, rows, actions = {}) {
		if (!rows.length) {
			$parent.append(`<div class="santu-sync-empty">No backups yet.</div>`);
			return;
		}
		const $t = $(`
			<table class="santu-sync-table">
				<thead><tr>
					<th>Date</th><th>Type</th><th>Location</th><th>Size</th><th>Status</th><th>Checked</th><th>Created By</th><th>Actions</th>
				</tr></thead><tbody></tbody>
			</table>
		`);
		const $tb = $t.find("tbody");
		rows.forEach((r) => {
			const $tr = $(`
				<tr>
					<td>${frappe.utils.escape_html(r.date_label || "")}</td>
					<td>${frappe.utils.escape_html(r.backup_type)}</td>
					<td>${frappe.utils.escape_html(r.location)}</td>
					<td>${frappe.utils.escape_html(r.size_label || "")}</td>
					<td><span class="santu-sync-status santu-sync-status-${(r.status || "").toLowerCase().replace(" ", "-")}">${frappe.utils.escape_html(r.status)}</span></td>
					<td>${santu_sync_verified_cell(r)}</td>
					<td>${frappe.utils.escape_html(r.created_by_user || "")}</td>
					<td class="santu-sync-actions"></td>
				</tr>
			`);
			const $act = $tr.find(".santu-sync-actions");
			if (r.status === "Success" && actions.download) {
				$act.append(`<button class="santu-sync-link-btn" data-a="dl">Download</button>`);
				$tr.find('[data-a="dl"]').on("click", () => window.open(santu_sync.api.downloadUrl(r.name), "_blank"));
			}
			if (actions.restore) {
				$act.append(`<button class="santu-sync-link-btn" data-a="rs">Restore</button>`);
				$tr.find('[data-a="rs"]').on("click", () => actions.restore(r));
			}
			if (actions.delete) {
				$act.append(`<button class="santu-sync-link-btn danger" data-a="del">Delete</button>`);
				$tr.find('[data-a="del"]').on("click", async () => {
					if (!await frappe.confirm("Delete this backup?")) return;
					await santu_sync.api.deleteBackup(r.name);
					frappe.show_alert({ message: "Backup deleted", indicator: "green" });
					actions.delete();
				});
			}
			$tb.append($tr);
		});
		$parent.append($t);
	},

	async _sync_share($wrap, reload) {
		const [dash, users, roles] = await Promise.all([
			santu_sync.api.dashboard(),
			santu_sync.api.staff(),
			santu_sync.api.roles(),
		]);
		const sync = dash.sync;
		const is_admin = frappe.user.has_role("System Manager");

		$wrap.empty();
		if (!sync.staff_sharing_enabled && !sync.enabled) {
			$wrap.append(`
				<div class="santu-sync-hero">
					<div class="santu-sync-hero-icon">☁️</div>
					<h2>Sync & Share</h2>
					<p>Securely sync your business data and share access with your staff.</p>
					<p class="santu-sync-muted">Logged in as <b>${frappe.utils.escape_html(dash.current_user)}</b></p>
					${is_admin ? `<button class="btn btn-primary santu-sync-primary-btn santu-sync-enable-btn">Configure Sync</button>` : ""}
				</div>
			`);
			if (is_admin) {
				$wrap.find(".santu-sync-enable-btn").on("click", () => this._show_sync_config_dialog(reload));
			}
			return;
		}

		$wrap.append(`
			<div class="santu-sync-cards">
				<div class="santu-sync-card">
					<div class="santu-sync-card-label">Sync Status</div>
					<div class="santu-sync-card-value">${frappe.utils.escape_html(sync.status)}</div>
					<div class="santu-sync-card-sub">Last: ${santu_sync.utils.format_dt(sync.last_sync_on)} | Pending: ${sync.pending_changes || 0}</div>
					${sync.last_error ? `<div class="santu-sync-error-text">${frappe.utils.escape_html(sync.last_error)}</div>` : ""}
				</div>
			</div>
		`);

		if (is_admin) {
			$wrap.append(`<div class="santu-sync-section"><h3>Staff Access</h3><div class="santu-sync-staff-wrap"></div></div>`);
			const $sw = $wrap.find(".santu-sync-staff-wrap");
			$sw.append(`<div class="santu-sync-toolbar"><button class="btn btn-sm btn-primary santu-sync-add-user">+ Add User</button></div>`);
			const $table = $(`<table class="santu-sync-table"><thead><tr>
				<th>User</th><th>Email</th><th>Roles</th><th>Last Login</th><th>Actions</th>
			</tr></thead><tbody></tbody></table>`);
			users.forEach((u) => {
				const $tr = $(`<tr>
					<td>${frappe.utils.escape_html(u.full_name || u.name)}</td>
					<td>${frappe.utils.escape_html(u.email || "")}</td>
					<td>${frappe.utils.escape_html(u.roles || "")}</td>
					<td>${frappe.utils.escape_html(u.last_login || "")}</td>
					<td class="santu-sync-actions">
						<button class="santu-sync-link-btn" data-u="${frappe.utils.escape_html(u.name)}">Edit</button>
						<button class="santu-sync-link-btn danger" data-d="${frappe.utils.escape_html(u.name)}">Disable</button>
					</td>
				</tr>`);
				$tr.find("[data-u]").on("click", () => this._edit_user_roles(u, roles, reload));
				$tr.find("[data-d]").on("click", async () => {
					if (!await frappe.confirm(`Disable ${u.name}?`)) return;
					await santu_sync.api.disableUser(u.name);
					frappe.show_alert({ message: "User disabled", indicator: "orange" });
					reload();
				});
				$table.find("tbody").append($tr);
			});
			$sw.append($table);
			$sw.find(".santu-sync-add-user").on("click", () => window.santu_open_add_user("Staff", reload));
		}
	},

	_show_sync_config_dialog(reload) {
		santu_sync.api.syncSettings().then((s) => {
			const d = new frappe.ui.Dialog({
				title: "Configure Sync & Share",
				fields: [
					{ fieldname: "staff_sharing_enabled", fieldtype: "Check", label: "Enable Staff Sharing", default: s.staff_sharing_enabled },
					{ fieldname: "sync_enabled", fieldtype: "Check", label: "Enable Sync Queue (local)", default: s.sync_enabled },
					{ fieldname: "cloud_sync_url", fieldtype: "Data", label: "Cloud Sync URL (optional)", default: s.cloud_sync_url },
				],
				primary_action_label: "Save",
				primary_action(values) {
					santu_sync.api.saveSyncSettings(values).then(() => {
						frappe.show_alert({ message: "Sync settings saved", indicator: "green" });
						d.hide();
						reload();
					});
				},
			});
			d.show();
		});
	},

	_edit_user_roles(user, role_groups, reload) {
		const all_roles = role_groups.flatMap((g) => g.existing || g.roles);
		const current = (user.roles || "").split(",").map((r) => r.trim()).filter(Boolean);
		const d = new frappe.ui.Dialog({
			title: `Edit Access — ${user.name}`,
			fields: [{ fieldname: "roles_html", fieldtype: "HTML" }],
			primary_action_label: "Save",
			primary_action() {
				const selected = [];
				d.$wrapper.find(".santu-sync-role-chk:checked").each(function () {
					selected.push($(this).val());
				});
				santu_sync.api.saveRoles(user.name, selected).then(() => {
					frappe.show_alert({ message: "Roles updated", indicator: "green" });
					d.hide();
					reload();
				});
			},
		});
		let html = `<div class="santu-sync-role-grid">`;
		role_groups.forEach((g) => {
			html += `<div class="santu-sync-role-group"><b>${g.group}</b><br>`;
			(g.existing || g.roles).forEach((role) => {
				const chk = current.includes(role) ? "checked" : "";
				html += `<label><input type="checkbox" class="santu-sync-role-chk" value="${role}" ${chk}> ${role}</label><br>`;
			});
			html += `</div>`;
		});
		html += `</div>`;
		d.fields_dict.roles_html.$wrapper.html(html);
		d.show();
	},

	async _auto_backup($wrap, reload) {
		const [settings, history] = await Promise.all([santu_sync.api.backupSettings(), santu_sync.api.history()]);
		$wrap.empty();
		$wrap.append(`
			<div class="santu-sync-card santu-sync-settings-card">
				<h3>Auto Backup Settings</h3>
				<div class="santu-sync-form-grid">
					<label><input type="checkbox" class="santu-sync-auto-en"> Enable Auto Backup</label>
					<label>Frequency <select class="santu-sync-freq form-control"><option>Daily</option><option>Weekly</option><option>Custom</option></select></label>
					<label>Backup Time <input type="time" class="santu-sync-time form-control"></label>
					<label>Retain <input type="number" class="santu-sync-retain form-control" min="1" max="100"></label>
					<label><input type="checkbox" class="santu-sync-inc-files"> Include Files</label>
				</div>
				<button class="btn btn-primary santu-sync-save-settings">Save Settings</button>
			</div>
			<div class="santu-sync-status-row">
				<span>Last Backup: <b>${santu_sync.utils.format_dt(settings.last_backup_on)}</b></span>
				<span>Next Backup: <b>${santu_sync.utils.format_dt(settings.next_backup_on)}</b></span>
				<span>Status: <b class="santu-sync-status-${(settings.last_backup_status || "never").toLowerCase()}">${frappe.utils.escape_html(settings.last_backup_status || "Never")}</b></span>
			</div>
			<div class="santu-sync-section"><h3>Backup History</h3><div class="santu-sync-history"></div></div>
		`);
		$wrap.find(".santu-sync-auto-en").prop("checked", !!settings.auto_backup_enabled);
		$wrap.find(".santu-sync-freq").val(settings.backup_frequency || "Daily");
		$wrap.find(".santu-sync-time").val((settings.backup_time || "02:00:00").slice(0, 5));
		$wrap.find(".santu-sync-retain").val(settings.retention_count || 10);
		$wrap.find(".santu-sync-inc-files").prop("checked", settings.include_files !== 0);

		$wrap.find(".santu-sync-save-settings").on("click", async () => {
			await santu_sync.api.saveBackupSettings({
				auto_backup_enabled: $wrap.find(".santu-sync-auto-en").is(":checked") ? 1 : 0,
				backup_frequency: $wrap.find(".santu-sync-freq").val(),
				backup_time: $wrap.find(".santu-sync-time").val() + ":00",
				retention_count: $wrap.find(".santu-sync-retain").val(),
				include_files: $wrap.find(".santu-sync-inc-files").is(":checked") ? 1 : 0,
			});
			frappe.show_alert({ message: "Settings saved", indicator: "green" });
			reload();
		});

		this._history_table($wrap.find(".santu-sync-history"), history, {
			download: true,
			delete: reload,
		});
	},

	async _backup_computer($wrap, reload) {
		const history = await santu_sync.api.history();
		$wrap.empty();
		$wrap.append(`
			<div class="santu-sync-hero santu-sync-hero-compact">
				<div class="santu-sync-hero-icon">💾</div>
				<h2>Backup To Computer</h2>
				<p>Save a full copy of your shop's data — all bills, parties, items and photos — so nothing is lost.</p>
				<button class="btn btn-primary santu-sync-primary-btn santu-sync-create-backup">Create Backup</button>
			</div>
			<div class="santu-sync-section"><h3>Backup History</h3><div class="santu-sync-history"></div></div>
		`);
		$wrap.find(".santu-sync-create-backup").on("click", async () => {
			const $btn = $wrap.find(".santu-sync-create-backup");
			$btn.prop("disabled", true).text("Creating backup…");
			try {
				const r = await santu_sync.api.createBackup(true);
				frappe.show_alert({ message: r.message || "Backup created successfully", indicator: "green" });
				reload();
			} catch (e) {
				frappe.msgprint(e.message || "Backup failed");
			} finally {
				$btn.prop("disabled", false).text("Create Backup");
			}
		});
		this._history_table($wrap.find(".santu-sync-history"), history, { download: true, delete: reload });
	},

	async _backup_drive($wrap, reload) {
		const gd = await santu_sync.api.gdrive();
		$wrap.empty();
		const connected = gd.connected;
		const statusLabel = connected ? "Connected" : gd.refresh_token_set ? "Authorized (disabled)" : "Not Connected";

		$wrap.append(`
			<div class="santu-sync-card">
				<h3>Google Drive</h3>
				<div class="santu-sync-status-row">
					<span>Status: <b class="${connected ? "santu-sync-text-green" : ""}">${statusLabel}</b></span>
					<span>Last Upload: <b>${santu_sync.utils.format_dt(gd.last_backup_on)}</b></span>
				</div>
				${gd.email ? `<p>Account: ${frappe.utils.escape_html(gd.email)}</p>` : ""}
				${!gd.available ? `<div class="santu-sync-config-msg">Google Drive backup is not switched on for this shop yet.</div>` : ""}
				<div class="santu-sync-toolbar">
					${!connected ? `<button class="btn btn-primary santu-sync-gd-connect">Connect Google Drive</button>` : ""}
					${connected ? `<button class="btn btn-primary santu-sync-gd-upload">Upload Backup Now</button>` : ""}
									</div>
				${!connected ? `<p class="santu-sync-muted">Google Drive has to be linked once by whoever set up this software. Ask them to do it, then come back here.</p>` : ""}
			</div>
		`);

		$wrap.find(".santu-sync-gd-connect").on("click", async () => {
			try {
				const url = await santu_sync.api.gdriveAuth();
				if (url) window.open(url, "_blank");
			} catch (e) {
				frappe.msgprint(e.message || "Could not start Google authorization");
			}
		});
		$wrap.find(".santu-sync-gd-upload").on("click", async () => {
			try {
				await santu_sync.api.gdriveUpload();
				frappe.show_alert({ message: "Backup upload queued", indicator: "green" });
				reload();
			} catch (e) {
				frappe.msgprint(e.message || "Upload failed");
			}
		});
	},

	async _restore($wrap, reload) {
		const history = await santu_sync.api.history().then((rows) => rows.filter((r) => r.status === "Success"));
		$wrap.empty();
		$wrap.append(`
			<div class="santu-sync-warning">
				<strong>⚠️ Warning:</strong> Restoring a backup will replace current database data. A safety backup is created automatically before restore begins.
			</div>
			<div class="santu-sync-section"><h3>Select Backup to Restore</h3><div class="santu-sync-history"></div></div>
		`);
		this._history_table($wrap.find(".santu-sync-history"), history, {
			restore: (r) => this._confirm_restore(r, reload),
		});
	},

	_confirm_restore(row, reload) {
		const d = new frappe.ui.Dialog({
			title: "Restore Backup",
			fields: [
				{ fieldtype: "HTML", fieldname: "warn", options: `<p>Restore <b>${frappe.utils.escape_html(row.name)}</b>?</p><p>Type <b>RESTORE</b> below to confirm.</p>` },
				{ fieldname: "confirm", fieldtype: "Data", label: "Confirmation", reqd: 1 },
			],
			primary_action_label: "Restore Backup",
			primary_action(values) {
				santu_sync.api.restoreBackup(row.name, values.confirm).then((res) => {
					frappe.msgprint(`Restore queued. Safety backup: ${res.safety_backup}. The site may restart.`);
					d.hide();
					reload();
				});
			},
		});
		d.show();
	},
};
