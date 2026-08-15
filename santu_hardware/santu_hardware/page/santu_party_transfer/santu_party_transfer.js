/* global frappe, santu_sale_invoice, santu_purchase_invoice, santu_party_transfer */
// Santu Hardware — Party to Party Transfer (2026-08-15). The "+" menu's
// "Party To Party Transfer" pointed at the raw Journal Entry form, and once
// new-<doctype> routes started redirecting to their own quick screens it
// landed on Expense — which a transfer is not.
//
// Two real cases this exists for, both routine at a counter:
//   * one party settles another's dues (a relative pays the bill);
//   * the same person is both customer and supplier, and what they owe you
//     needs netting off against what you owe them.
//
// Each side picks its own party TYPE, which is what makes the second case
// expressible at all. Balances are shown in plain language ("owes you" /
// "you owe") so nobody has to read a signed ledger figure.
frappe.pages["santu-party-transfer"].on_page_load = function (wrapper) {
	frappe.require(
		[
			"/assets/santu_hardware/js/santu_sale_invoice/santu_sale_invoice_api.js",
			"/assets/santu_hardware/js/santu_purchase_invoice/santu_purchase_invoice_api.js",
			"/assets/santu_hardware/js/santu_party_transfer/santu_party_transfer_api.js",
		],
		() => {
			const page = frappe.ui.make_app_page({
				parent: wrapper,
				title: "Party to Party Transfer",
				single_column: true,
			});
			$(page.wrapper).find(".page-head").hide();
			$(page.main).addClass("santu-si2-page-main");
			santu_party_transfer_page.init(page);
		}
	);
};

// Fresh form on every visit — a half-typed transfer left from last time is
// worse than an empty one, and on_page_load only fires once per session.
frappe.pages["santu-party-transfer"].on_page_show = function () {
	if (window.santu_party_transfer_page && santu_party_transfer_page.page) santu_party_transfer_page.reset();
};

window.santu_party_transfer_page = {
	init(page) {
		this.page = page;
		this.reset();
	},

	reset() {
		this.state = {
			posting_date: frappe.datetime.get_today(),
			amount: 0,
			notes: "",
			from: { party_type: "Customer", party: null, label: null, balance: null },
			to: { party_type: "Customer", party: null, label: null, balance: null },
		};
		this.render();
	},

	render() {
		const s = this.state;
		$(this.page.body).html(`
			<div class="santu-si2 santu-ptp">
				<div class="santu-si2-body">
					<div class="santu-si2-header">
						<div class="santu-si2-header-title">Party to Party Transfer</div>
					</div>

					<div class="santu-ptp-row">
						${this._side_html("from", "From")}
						<div class="santu-ptp-arrow" aria-hidden="true">→</div>
						${this._side_html("to", "To")}
					</div>

					<div class="santu-ptp-fields">
						<div class="santu-ptp-field">
							<label>Amount</label>
							<input type="number" min="0" step="0.01" class="santu-ptp-amount" value="${s.amount || ""}" placeholder="0">
						</div>
						<div class="santu-ptp-field">
							<label>Date</label>
							<input type="date" class="santu-ptp-date" value="${s.posting_date}">
						</div>
						<div class="santu-ptp-field santu-ptp-field-wide">
							<label>Notes</label>
							<input type="text" class="santu-ptp-notes" value="${frappe.utils.escape_html(s.notes || "")}" placeholder="Why is this being transferred? (optional)">
						</div>
					</div>

					<div class="santu-ptp-preview"></div>

					<div class="santu-si2-actionbar">
						<div class="santu-si2-actionbar-left"></div>
						<div class="santu-si2-actionbar-right">
							<button type="button" class="santu-si2-btn santu-si2-btn-primary" data-action="save">Save <span class="santu-si2-kbd">Ctrl+S</span></button>
						</div>
					</div>
				</div>
			</div>
		`);
		this.$root = $(this.page.body).find(".santu-si2");
		this._bind();
		this._render_preview();
	},

	_side_html(side, heading) {
		const d = this.state[side];
		return `
			<div class="santu-ptp-side" data-side="${side}">
				<div class="santu-ptp-side-head">${heading}</div>
				<div class="santu-ptp-type">
					<label><input type="radio" name="ptp-${side}-type" value="Customer" ${d.party_type === "Customer" ? "checked" : ""}> Customer</label>
					<label><input type="radio" name="ptp-${side}-type" value="Supplier" ${d.party_type === "Supplier" ? "checked" : ""}> Supplier</label>
				</div>
				<div class="santu-si2-customer-search-wrap">
					<input type="text" class="santu-ptp-search" placeholder="Search by Name/Phone" autocomplete="off" value="${frappe.utils.escape_html(d.label || "")}">
					<div class="santu-si2-customer-dropdown" style="display:none;"></div>
				</div>
				<div class="santu-ptp-balance"></div>
			</div>
		`;
	},

	_render_balance(side) {
		const d = this.state[side];
		const $b = this.$root.find(`.santu-ptp-side[data-side="${side}"] .santu-ptp-balance`);
		if (!d.party || !d.balance) {
			$b.empty();
			return;
		}
		const b = d.balance;
		if (!b.direction) {
			$b.html(`<span class="santu-ptp-bal-none">Settled — no balance</span>`);
			return;
		}
		const owes_you = b.direction === "owes_you";
		$b.html(`
			<span class="santu-ptp-bal ${owes_you ? "santu-ptp-bal-in" : "santu-ptp-bal-out"}">
				${owes_you ? "Owes you" : "You owe"} ₹ ${format_number(b.balance, null, 2)}
			</span>
		`);
	},

	// What each side actually ends up with. The posting is always "credit
	// the From account, debit the To account" — that's the only pairing that
	// balances — but what that MEANS flips with the account type, because a
	// customer sits in Debtors (an asset) and a supplier in Creditors (a
	// liability). Crediting a customer means they owe you less; crediting a
	// supplier means you owe them MORE. Saying "balance goes down" for both
	// would be a lie half the time, so each side states its own effect.
	_effect_text(side, party_type, amount) {
		const money = `₹ ${format_number(amount, null, 2)}`;
		if (side === "from") {
			return party_type === "Customer" ? `will owe you ${money} less` : `you will owe ${money} more`;
		}
		return party_type === "Customer" ? `will owe you ${money} more` : `you will owe ${money} less`;
	},

	_render_preview() {
		const s = this.state;
		const $p = this.$root.find(".santu-ptp-preview");
		const amt = Number(s.amount) || 0;
		if (!s.from.party || !s.to.party || amt <= 0) {
			$p.empty();
			return;
		}
		const from_effect = this._effect_text("from", s.from.party_type, amt);
		const to_effect = this._effect_text("to", s.to.party_type, amt);
		// The netting case (customer on one side, supplier on the other) is
		// the one people reach for most, and it's worth naming so they can
		// see at a glance they've picked the right direction.
		const is_netting = s.from.party_type !== s.to.party_type;
		$p.html(`
			<div class="santu-ptp-preview-box">
				<div><b>${frappe.utils.escape_html(s.from.label)}</b> ${from_effect}.</div>
				<div><b>${frappe.utils.escape_html(s.to.label)}</b> ${to_effect}.</div>
				${is_netting ? `<div class="santu-ptp-preview-note">Settling a customer balance against a supplier balance.</div>` : ""}
			</div>
		`);
	},

	_bind() {
		const s = this.state;
		const $r = this.$root;

		["from", "to"].forEach((side) => {
			const $side = $r.find(`.santu-ptp-side[data-side="${side}"]`);
			$side.find(`input[name="ptp-${side}-type"]`).on("change", (e) => {
				s[side].party_type = e.target.value;
				s[side].party = null;
				s[side].label = null;
				s[side].balance = null;
				$side.find(".santu-ptp-search").val("");
				this._render_balance(side);
				this._render_preview();
			});
			$side.find(".santu-ptp-search").on(
				"input",
				frappe.utils.debounce((e) => this._search(side, $(e.target).val()), 250)
			);
		});

		$(document).off("click.santu-ptp").on("click.santu-ptp", (e) => {
			if (!$(e.target).closest(".santu-si2-customer-search-wrap").length) {
				$r.find(".santu-si2-customer-dropdown").hide();
			}
		});

		$r.find(".santu-ptp-amount").on("input", (e) => {
			s.amount = Math.max(Number(e.target.value) || 0, 0);
			this._render_preview();
		});
		$r.find(".santu-ptp-date").on("change", (e) => (s.posting_date = e.target.value));
		$r.find(".santu-ptp-notes").on("input", (e) => (s.notes = e.target.value));

		$r.find("[data-action='save']").on("click", () => this._save());
		$(document).off("keydown.santu-ptp").on("keydown.santu-ptp", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s" && frappe.get_route()[0] === "santu-party-transfer") {
				e.preventDefault();
				this._save();
			}
		});
	},

	_search(side, q) {
		const s = this.state;
		const $dd = this.$root.find(`.santu-ptp-side[data-side="${side}"] .santu-si2-customer-dropdown`);
		if (!q || q.length < 2) {
			$dd.hide().empty();
			return;
		}
		const is_customer = s[side].party_type === "Customer";
		const search = is_customer
			? santu_sale_invoice.api.search_customers(q)
			: santu_purchase_invoice.api.search_suppliers(q);
		search.then((rows) => {
			$dd.empty();
			(rows || []).forEach((p) => {
				const label = p.customer_name || p.supplier_name || p.name;
				$(`
					<div class="santu-si2-dd-row">
						<div class="santu-si2-dd-row-main">
							<div class="santu-si2-dd-row-text">
								<b>${frappe.utils.escape_html(label)}</b>
								${p.mobile_no ? `<span>${frappe.utils.escape_html(p.mobile_no)}</span>` : ""}
							</div>
						</div>
					</div>
				`)
					.on("click", () => this._select(side, p.name, label))
					.appendTo($dd);
			});
			if (!(rows || []).length) {
				$dd.append(`<div class="santu-si2-dd-row santu-pay-dd-empty">No match.</div>`);
			}
			$dd.show();
		});
	},

	_select(side, name, label) {
		const s = this.state;
		s[side].party = name;
		s[side].label = label;
		this.$root.find(`.santu-ptp-side[data-side="${side}"] .santu-ptp-search`).val(label);
		this.$root.find(`.santu-ptp-side[data-side="${side}"] .santu-si2-customer-dropdown`).hide().empty();
		santu_party_transfer.api.balance(s[side].party_type, name).then((b) => {
			s[side].balance = b;
			this._render_balance(side);
		});
		this._render_preview();
	},

	_save() {
		const s = this.state;
		if (!s.from.party || !s.to.party) {
			frappe.msgprint(__("Select both parties."));
			return;
		}
		if (s.from.party_type === s.to.party_type && s.from.party === s.to.party) {
			frappe.msgprint(__("Pick two different parties."));
			return;
		}
		const amount = Number(s.amount) || 0;
		if (amount <= 0) {
			frappe.msgprint(__("Enter an amount greater than zero."));
			return;
		}

		frappe.dom.freeze(__("Saving…"));
		santu_party_transfer.api
			.save(
				{
					from_party_type: s.from.party_type,
					from_party: s.from.party,
					to_party_type: s.to.party_type,
					to_party: s.to.party,
					amount,
					posting_date: s.posting_date,
					notes: s.notes || null,
				},
				1
			)
			.then((r) => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Saved {0}", [r.name]), indicator: "green" });
				window.santu_open_invoice_view("Journal Entry", r.name);
			})
			.catch(() => frappe.dom.unfreeze());
	},
};
