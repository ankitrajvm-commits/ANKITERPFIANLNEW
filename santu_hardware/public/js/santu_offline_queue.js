/* global frappe, $ */
// Bill kabhi na khoye, chahe server ek pal ke liye na mile.
//
// Is dukaan me app usi Mac par chalta hai (localhost:8000), isliye ghar ka
// internet jaane se billing NAHI rukti -- sirf WhatsApp rukta hai. Jo sach
// me rok deta hai wo hai server ka ek pal ke liye na milna: bench restart,
// ek bhaari query, ya wo MariaDB deadlock jo 2026-09-07 ko 500 de raha tha.
// Us ek pal me Save dabane par pehle sirf ek laal message aata tha aur
// cashier ko dobara Save dabana padta tha -- grahak counter par khada rehta
// tha aur kisi ko nahi pata hota tha ki bill bana ya nahi.
//
// Ab: aisa bill queue me chala jaata hai (browser me hi, localStorage me),
// counter agla grahak nipta sakta hai, aur server wapas aate hi bill apne
// aap chadh jaata hai.
//
// Do baar bill banne se bachav (sabse zaroori hissa): har bill ko pehli
// koshish se PEHLE ek key milti hai. Agar pehli koshish server tak pahunch
// gayi aur sirf jawab kho gaya, to dobara bhejne par server usi key se
// purani bill dhoondh leta hai aur nayi nahi banata
// (api._save_sale_invoice ka offline_key).
window.santu_offline_queue = (function () {
	const KEY = "santu_offline_bills";
	const RETRY_MS = 15000;
	let timer = null;
	let running = false;

	function read() {
		try {
			return JSON.parse(localStorage.getItem(KEY) || "[]") || [];
		} catch (e) {
			return [];
		}
	}

	function write(list) {
		try {
			localStorage.setItem(KEY, JSON.stringify(list));
		} catch (e) {
			// Storage bhar gaya ya band hai -- queue chup-chaap girni nahi
			// chahiye, warna cashier ko lagega bill safe hai aur wo hoga nahi.
			frappe.msgprint({
				title: __("Bill queue me nahi rakh paye"),
				indicator: "red",
				message: __("Browser ka storage bhara hua hai. Ye bill dobara banana padega."),
			});
		}
		render_badge();
	}

	function new_key() {
		return "off-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
	}

	// Sirf "server tak baat hi nahi pahunchi" wali dikkat queue me jaati hai.
	// Galat data (grahak nahi chuna, item ka rate nahi) dobara bhejne se bhi
	// theek nahi hoga -- wo cashier ko turant dikhna chahiye.
	function is_connection_problem(err) {
		if (!err) return false;
		if (navigator && navigator.onLine === false) return true;
		// `||` nahi chalega yahan: status 0 khud falsy hai, isliye `err.status
		// || err.xhr.status` use chhod kar aage badh jaata tha -- aur 0 hi wo
		// haalat hai jisme jawab bilkul nahi aaya (sabse zaroori case).
		let status = err.status;
		if (status === undefined || status === null) status = err.xhr && err.xhr.status;
		// 0 = jawab hi nahi aaya. 502/503/504 = server abhi taiyaar nahi.
		if (status === 0 || status === 502 || status === 503 || status === 504) return true;
		const text = ((err.message || "") + " " + (err.responseText || "")).toLowerCase();
		return (
			text.includes("networkerror") ||
			text.includes("failed to fetch") ||
			text.includes("could not connect") ||
			text.includes("connection") ||
			text.includes("timed out") ||
			text.includes("timeout")
		);
	}

	function add(payload, submit) {
		const list = read();
		list.push({
			key: payload.offline_key || new_key(),
			payload: payload,
			submit: submit ? 1 : 0,
			queued_at: new Date().toISOString(),
			tries: 0,
			last_error: null,
		});
		write(list);
		start();
		return list.length;
	}

	function count() {
		return read().length;
	}

	// Ek-ek karke bhejta hai, kram me -- taaki bill number usi kram me milein
	// jis kram me grahak aaye the.
	async function flush(loud) {
		if (running) return;
		const list = read();
		if (!list.length) return;
		running = true;
		let done = 0;
		let stopped = false;

		while (read().length && !stopped) {
			const current = read()[0];
			try {
				const r = await santu_sale_invoice.api.save(
					Object.assign({}, current.payload, { offline_key: current.key }),
					current.submit
				);
				const rest = read().slice(1);
				write(rest);
				done += 1;
				if (r && r.already_saved) {
					// Pehli koshish sach me pahunch gayi thi -- bill pehle se
					// bani hui hai, dobara nahi bani.
					frappe.show_alert(
						{ message: __("Bill {0} pehle hi ban chuki thi.", [r.bill_no || r.name]), indicator: "blue" },
						6
					);
				} else {
					frappe.show_alert(
						{ message: __("Ruka hua bill chadh gaya: {0}", [r.bill_no || r.name]), indicator: "green" },
						6
					);
				}
			} catch (e) {
				if (is_connection_problem(e)) {
					// Server abhi bhi nahi hai -- kram bigaade bina rukiye.
					stopped = true;
				} else {
					// Ye bill kabhi nahi chadhegi (galat data). Queue rok kar
					// cashier ko dikhaiye, warna wo hamesha atki rahegi.
					const list2 = read();
					list2[0].tries = (list2[0].tries || 0) + 1;
					list2[0].last_error = (e && e.message) || String(e);
					write(list2);
					stopped = true;
					frappe.msgprint({
						title: __("Ek ruka hua bill nahi chadh paya"),
						indicator: "red",
						message: __("Grahak: {0}<br>Wajah: {1}<br><br>Utilities me se ise dekh kar theek karna padega.", [
							frappe.utils.escape_html(current.payload.customer || "—"),
							frappe.utils.escape_html(list2[0].last_error || ""),
						]),
					});
				}
			}
		}

		running = false;
		render_badge();
		if (loud && !done) {
			frappe.show_alert({ message: __("Server abhi bhi nahi mil raha."), indicator: "orange" }, 5);
		}
		return done;
	}

	function start() {
		if (timer) return;
		timer = setInterval(() => {
			if (read().length) flush(false);
			else stop();
		}, RETRY_MS);
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
	}

	// Counter par ek chhoti patti -- kitne bill ruke hue hain. Isse cashier
	// ko hamesha pata rehta hai ki kuch baaki hai.
	function render_badge() {
		const n = count();
		let $b = $("#santu-offline-badge");
		if (!n) {
			$b.remove();
			return;
		}
		if (!$b.length) {
			$b = $(`<div id="santu-offline-badge" title="${__("Dabaiye — abhi bhejne ki koshish karein")}"></div>`).appendTo("body");
			$b.on("click", () => flush(true));
		}
		$b.text(`⏳ ${n} ${n === 1 ? __("bill ruka hai") : __("bill ruke hain")}`);
	}

	$(window).on("online", () => flush(false));
	$(document).ready(() => {
		render_badge();
		if (count()) start();
	});

	return { add, count, flush, read, is_connection_problem, new_key, render_badge };
})();
