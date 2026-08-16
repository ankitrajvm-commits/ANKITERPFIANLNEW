/**
 * Santu Hardware Sale module — intensive UI test runner
 * Usage: node santu_sale_ui_test.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SANTU_UI_BASE || "http://localhost:8000";
const SCREENSHOT_DIR = path.join(__dirname, "tmp_santu_ui_screenshots");
const VIEWS = [
	{ key: "invoices", title: "Sale Invoices" },
	{ key: "quotation", title: "Estimate / Quotation" },
	{ key: "proforma", title: "Proforma Invoice" },
	{ key: "payment_in", title: "Payment In" },
	{ key: "sales_order", title: "Sales Order" },
	{ key: "delivery_challan", title: "Delivery Challan" },
	{ key: "sales_return", title: "Sales Return" },
];
const PERIODS = ["Today", "This Month", "This Year"];

const results = [];
const consoleErrors = [];

function record(id, name, status, notes, screenshot = null) {
	results.push({ id, name, status, notes, screenshot });
}

function getSession() {
	const benchDir = path.resolve(__dirname, "../../../..");
	const out = execSync(
		`cd "${benchDir}" && bench --site site1.local execute santu_hardware.tests.create_ui_session.create_session`,
		{ encoding: "utf8" }
	).trim();
	return JSON.parse(out);
}

async function shot(page, name) {
	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	const file = path.join(SCREENSHOT_DIR, `${name}.png`);
	await page.screenshot({ path: file, fullPage: true });
	return file;
}

async function waitForSalePage(page, timeout = 30000) {
	await page.waitForSelector(".santu-sale", { timeout });
	await page.waitForFunction(
		() => {
			const loading = document.querySelector(".santu-sale-txn-wrap .text-muted, .santu-sale-txn-wrap .santu-sale-empty");
			const rows = document.querySelectorAll(".santu-sale-txn-row");
			return rows.length > 0 || loading || document.querySelector(".santu-sale-empty");
		},
		{ timeout }
	);
}

async function loginWithSession(context) {
	try {
		const session = getSession();
		await context.addCookies([
			{ name: "sid", value: session.sid, domain: "localhost", path: "/" },
			{ name: "system_user", value: "yes", domain: "localhost", path: "/" },
			{ name: "user_id", value: "Administrator", domain: "localhost", path: "/" },
			{ name: "full_name", value: "Administrator", domain: "localhost", path: "/" },
		]);
		return session;
	} catch (e) {
		throw new Error(`Could not create session: ${e.message}`);
	}
}

async function main() {
	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	try {
		await loginWithSession(context);
	} catch (e) {
		record(0, "Session bootstrap", "FAIL", e.message);
		await browser.close();
		printReport();
		process.exit(1);
	}

	const page = await context.newPage();
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			const text = msg.text();
			if (/santu_sale|santu-sale|santu_sale_/i.test(text)) {
				consoleErrors.push(text);
			}
		}
	});

	// --- Test 1: Dashboard ---
	try {
		await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
		await waitForSalePage(page);
		const hasRoot = (await page.locator(".santu-sale").count()) > 0;
		const hasSummary = (await page.locator(".santu-sale-summary-card").count()) > 0;
		const rowCount = await page.locator(".santu-sale-txn-row").count();
		const hasEmpty = (await page.locator(".santu-sale-empty").count()) > 0;
		const hasRows = rowCount > 0;
		if (hasRoot && hasSummary && (hasRows || hasEmpty)) {
			record(
				1,
				"Dashboard loads with summary + table",
				"PASS",
				`Summary card visible; ${rowCount} transaction row(s)${hasEmpty ? " (empty state shown)" : ""}`
			);
		} else {
			const ss = await shot(page, "test1-dashboard");
			record(
				1,
				"Dashboard loads with summary + table",
				"FAIL",
				`root=${hasRoot}, summary=${hasSummary}, rows=${rowCount}, empty=${hasEmpty}`,
				ss
			);
		}
	} catch (e) {
		const ss = await shot(page, "test1-dashboard-error");
		record(1, "Dashboard loads with summary + table", "FAIL", e.message, ss);
	}

	// --- Test 2: View dropdown ---
	for (const view of VIEWS) {
		try {
			await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
			await waitForSalePage(page);
			await page.locator(".santu-sale-page-title").click();
			await page.locator(`.santu-sale-title-menu button[data-view="${view.key}"]`).click();
			await page.waitForTimeout(1500);
			const title = await page.locator(".santu-sale-title-text").innerText();
			const hasSale = (await page.locator(".santu-sale").count()) > 0;
			const ok = hasSale && title.includes(view.title.split(" / ")[0].split(" ")[0]);
			if (ok) {
				record(2, `View: ${view.title}`, "PASS", `Title shows "${title}"`);
			} else {
				const ss = await shot(page, `test2-view-${view.key}`);
				record(2, `View: ${view.title}`, "FAIL", `Title="${title}", santu-sale=${hasSale}`, ss);
			}
		} catch (e) {
			const ss = await shot(page, `test2-view-${view.key}-error`);
			record(2, `View: ${view.title}`, "FAIL", e.message, ss);
		}
	}

	// --- Test 3: Period filters ---
	await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
	await waitForSalePage(page);
	for (const period of PERIODS) {
		try {
			await page.selectOption(".santu-sale-period", period);
			await page.waitForTimeout(2000);
			const selected = await page.locator(".santu-sale-period").inputValue();
			const hasSummary = (await page.locator(".santu-sale-summary-card").count()) > 0;
			if (selected === period && hasSummary) {
				record(3, `Period: ${period}`, "PASS", `Filter applied, summary reloaded`);
			} else {
				const ss = await shot(page, `test3-period-${period.replace(/\s/g, "-")}`);
				record(3, `Period: ${period}`, "FAIL", `selected=${selected}, summary=${hasSummary}`, ss);
			}
		} catch (e) {
			const ss = await shot(page, `test3-period-error`);
			record(3, `Period: ${period}`, "FAIL", e.message, ss);
		}
	}

	// --- Test 4: Row click opens santu-view-invoice ---
	try {
		await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
		await waitForSalePage(page);
		const rowCount = await page.locator(".santu-sale-txn-row").count();
		if (rowCount === 0) {
			record(4, "Row click → santu-view-invoice", "SKIP", "No transaction rows to click");
		} else {
			await page.locator(".santu-sale-txn-row").first().click();
			await page.waitForTimeout(2500);
			const route = await page.evaluate(() => frappe.get_route().join("/"));
			const hasViewPage = (await page.locator(".santu-view-invoice, [data-page-route*='santu-view-invoice']").count()) > 0;
			const isNativeForm = route.startsWith("Form/");
			const ok = route.includes("santu-view-invoice") || hasViewPage;
			if (ok && !isNativeForm) {
				record(4, "Row click → santu-view-invoice", "PASS", `Route: ${route}`);
			} else {
				const ss = await shot(page, "test4-row-click");
				record(
					4,
					"Row click → santu-view-invoice",
					"FAIL",
					`Route=${route}, nativeForm=${isNativeForm}, viewPage=${hasViewPage}`,
					ss
				);
			}
		}
	} catch (e) {
		const ss = await shot(page, "test4-row-click-error");
		record(4, "Row click → santu-view-invoice", "FAIL", e.message, ss);
	}

	// --- Test 5: santu-sale-invoice page ---
	try {
		await page.goto(`${BASE}/app/santu-sale-invoice`, { waitUntil: "networkidle", timeout: 60000 });
		await page.waitForSelector(".santu-si2", { timeout: 30000 });
		const hasPage = (await page.locator(".santu-si2").count()) > 0;
		// Customer search
		const custInput = page.locator(".santu-si2-customer-search").first();
		let custOk = false;
		if ((await custInput.count()) > 0) {
			await custInput.click();
			await custInput.fill("a");
			await page.waitForTimeout(1500);
			custOk = (await page.locator(".santu-si2-customer-dropdown li, .santu-si2-dd-row").count()) > 0;
		}
		// Item add — open inline search if needed
		if ((await page.locator(".santu-si2-item-search").count()) === 0) {
			await page.locator(".santu-si2-add-item, button:has-text('Add Item'), [data-action='add-item']").first().click({ timeout: 5000 }).catch(() => {});
		}
		const itemInput = page.locator(".santu-si2-item-search").first();
		let itemOk = false;
		if ((await itemInput.count()) > 0) {
			await itemInput.click();
			await itemInput.fill("a");
			await page.waitForTimeout(1500);
			itemOk = (await page.locator(".santu-si2-item-dropdown li, .santu-si2-item-row").count()) > 0;
		}
		if (hasPage && (custOk || itemOk)) {
			record(
				5,
				"santu-sale-invoice loads, search customer, add item",
				"PASS",
				`Page loaded; customer search=${custOk}; item search=${itemOk}`
			);
		} else if (hasPage) {
			const ss = await shot(page, "test5-sale-invoice");
			record(
				5,
				"santu-sale-invoice loads, search customer, add item",
				"PARTIAL",
				`Page loaded but search dropdowns: customer=${custOk}, item=${itemOk}`,
				ss
			);
		} else {
			const ss = await shot(page, "test5-sale-invoice");
			record(5, "santu-sale-invoice loads, search customer, add item", "FAIL", "Page did not load", ss);
		}
	} catch (e) {
		const ss = await shot(page, "test5-sale-invoice-error");
		record(5, "santu-sale-invoice loads, search customer, add item", "FAIL", e.message, ss);
	}

	// --- Test 6: WhatsApp button on saved invoice ---
	try {
		await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
		await waitForSalePage(page);
		const rowCount = await page.locator(".santu-sale-txn-row").count();
		if (rowCount === 0) {
			record(6, "Send on WhatsApp on saved invoice", "SKIP", "No saved invoices in list");
		} else {
			await page.locator(".santu-sale-txn-row").first().click();
			await page.waitForTimeout(2500);
			const waBtn = page.locator('button[data-action="whatsapp"], button:has-text("Send on WhatsApp")');
			const count = await waBtn.count();
			if (count > 0) {
				record(6, "Send on WhatsApp on saved invoice", "PASS", `Found ${count} WhatsApp button(s)`);
			} else {
				const ss = await shot(page, "test6-whatsapp");
				record(6, "Send on WhatsApp on saved invoice", "FAIL", "No WhatsApp button on view page", ss);
			}
		}
	} catch (e) {
		const ss = await shot(page, "test6-whatsapp-error");
		record(6, "Send on WhatsApp on saved invoice", "FAIL", e.message, ss);
	}

	// --- Test 7: santu-billing POS ---
	try {
		await page.goto(`${BASE}/app/santu-billing`, { waitUntil: "networkidle", timeout: 60000 });
		await page.waitForTimeout(3000);
		const route = await page.evaluate(() => frappe.get_route().join("/"));
		const onLogin = route.includes("login") || (await page.locator("#login_email, .login-content").count()) > 0;
		const hasBilling =
			route.includes("santu-billing") ||
			(await page.locator(".santu-billing, .santu-pos, [data-page-route*='santu-billing']").count()) > 0;
		if (onLogin) {
			record(7, "santu-billing (POS) accessible", "FAIL", "Redirected to login");
		} else if (hasBilling) {
			record(7, "santu-billing (POS) accessible", "PASS", `Route: ${route}`);
		} else {
			const ss = await shot(page, "test7-billing");
			record(7, "santu-billing (POS) accessible", "FAIL", `Unexpected route: ${route}`, ss);
		}
	} catch (e) {
		const ss = await shot(page, "test7-billing-error");
		record(7, "santu-billing (POS) accessible", "FAIL", e.message, ss);
	}

	// --- Test 8: Sidebar Sale link ---
	try {
		await page.goto(`${BASE}/app/santu-dashboard`, { waitUntil: "networkidle", timeout: 60000 });
		await page.waitForTimeout(2000);
		const saleLink = page.locator('.santu-fixed-sidebar a[data-route="santu-sale"], .santu-fixed-sidebar [data-nav-key="sale"], .santu-fixed-sidebar:has-text("Sale")').first();
		if ((await saleLink.count()) === 0) {
			// try expanding Sale group
			await page.locator('.santu-fixed-sidebar .santu-sidebar-group:has-text("Sale"), .santu-fixed-sidebar button:has-text("Sale")').first().click();
		}
		await page.locator('.santu-fixed-sidebar a[href*="santu-sale"], .santu-fixed-sidebar [data-route="santu-sale"]').first().click({ timeout: 10000 });
		await page.waitForTimeout(2500);
		const route = await page.evaluate(() => frappe.get_route().join("/"));
		const hasSale = (await page.locator(".santu-sale").count()) > 0;
		const isNativeList = route.startsWith("List/Sales Invoice") || route.startsWith("Form/");
		if (hasSale && route.includes("santu-sale") && !isNativeList) {
			record(8, "Sidebar Sale link → custom UI", "PASS", `Route: ${route}`);
		} else {
			const ss = await shot(page, "test8-sidebar");
			record(8, "Sidebar Sale link → custom UI", "FAIL", `Route=${route}, santu-sale=${hasSale}, native=${isNativeList}`, ss);
		}
	} catch (e) {
		const ss = await shot(page, "test8-sidebar-error");
		record(8, "Sidebar Sale link → custom UI", "FAIL", e.message, ss);
	}

	// --- Test 9: Share button on row ---
	try {
		await page.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
		await waitForSalePage(page);
		const shareBtn = page.locator('.santu-sale-row-btn[title="Share"], .santu-sale-row-btn[data-action="share"]');
		const count = await shareBtn.count();
		if (count > 0) {
			record(9, "Share button on sale list row", "PASS", `Found ${count} share button(s)`);
		} else {
			const ss = await shot(page, "test9-share");
			record(9, "Share button on sale list row", "FAIL", "No share buttons visible on transaction rows", ss);
		}
	} catch (e) {
		const ss = await shot(page, "test9-share-error");
		record(9, "Share button on sale list row", "FAIL", e.message, ss);
	}

	// --- Test 10: Hard refresh, no santu_sale JS errors ---
	const refreshErrors = [];
	const refreshPage = await context.newPage();
	refreshPage.on("console", (msg) => {
		if (msg.type() === "error") {
			const text = msg.text();
			if (/santu_sale|santu-sale|santu_sale_/i.test(text)) {
				refreshErrors.push(text);
			}
		}
	});
	try {
		await refreshPage.goto(`${BASE}/app/santu-sale`, { waitUntil: "networkidle", timeout: 60000 });
		await refreshPage.reload({ waitUntil: "networkidle" });
		await refreshPage.waitForTimeout(3000);
		if (refreshErrors.length === 0) {
			record(10, "Hard refresh — no santu_sale console errors", "PASS", "No santu_sale-related console errors");
		} else {
			const ss = await shot(refreshPage, "test10-console-errors");
			record(
				10,
				"Hard refresh — no santu_sale console errors",
				"FAIL",
				`${refreshErrors.length} error(s): ${refreshErrors.slice(0, 3).join(" | ")}`,
				ss
			);
		}
	} catch (e) {
		const ss = await shot(refreshPage, "test10-refresh-error");
		record(10, "Hard refresh — no santu_sale console errors", "FAIL", e.message, ss);
	}

	await browser.close();
	printReport();
}

function printReport() {
	const report = { results, consoleErrors: [...new Set([...consoleErrors])], screenshotDir: SCREENSHOT_DIR };
	fs.writeFileSync(path.join(__dirname, "tmp_santu_ui_report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
