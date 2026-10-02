// Santu Hardware — every error / warning the counter sees, in simple Hinglish.
//
// 2026-09-19, Ankit: "jo v warning ya failure show ho screen pe bhaiya ko wo
// hindi me aaye, bhaiya ko english halka halka aata hai but complete nh,
// unhe aacche se samjhao ki ye error aaya ya warning aaya to ise aap aise
// resolve kr sakte ho".
//
// 2026-09-25, Ankit: "devnagri me error ya warning mat likho, use bs hinglish
// me translate kr do" — same plain Hindi words, Roman letters. Nothing that
// appears on screen is in Devanagari any more.
//
// One layer in front of frappe.msgprint (which is also how every server
// error reaches the screen) and frappe.confirm:
//   * a known message (ERPNext's own English, or our older Hinglish/English
//     ones) is replaced by  Kya hua  +  Kya karein  (1-3 plain steps);
//   * an unknown English error still gets a frame -- "Kuch gadbad hui, photo
//     khinch kar Ankit ko bhejein" -- with the original in small grey text so
//     Ankit can still read what really happened.
// The original text is always kept (small, grey) under the Hinglish.
(function () {
	if (window.santu_hindi_errors) return;

	const RULES = [
		// ---------- stock / items ----------
		{ re: /Valuation Rate.*(required|missing)|Valuation Rate Missing/i, title: "Saaman ki kharid keemat nahi mili",
		  what: "Is saaman ki kharid keemat (CP) system me nahi hai.",
		  todo: ["Bill dobara save karein — ab aisa saaman bina CP ke bhi bik jata hai.", "Baad me Update Items In Bulk me iski kharid keemat bhar dein taaki munafa sahi dikhe."] },
		{ re: /(Insufficient Stock|not available in|units of .* needed in Warehouse|Negative Stock)/i, title: "Stock kam hai",
		  what: "Is saaman ka stock bill ki matra se kam hai.",
		  todo: ["Matra jaanch lein.", "Saaman aa gaya hai to pehle Receive Stock me stock chadhaiye, phir bill banaiye."] },
		{ re: /cannot be a fraction|Must be Whole Number/i, title: "Aadhi matra nahi li gayi",
		  what: "Is unit me dashamlav (jaise 9.5) wali matra ruki hui thi.",
		  todo: ["Bill dobara save karein — ab aadhi matra chalti hai.", "Phir bhi ruke to screen ki photo Ankit ko bhejein."] },
		{ re: /Name cannot contain special characters/i, title: "Naam me galat nishan",
		  what: "Naam me < ya > jaise nishan nahi chalte.",
		  todo: ["Naam me se < > hata dein aur phir save karein."] },
		{ re: /(Duplicate entry|already exists)/i, title: "Ye pehle se maujood hai",
		  what: "Isi naam / number ka record pehle se system me hai.",
		  todo: ["Naya banane ki jagah purana wala dhoondh kar chunein.", "Sach me alag hai to naam me size / brand jod dein."] },
		// ---------- party / phone ----------
		{ re: /is not a valid Phone Number|Invalid (Mobile|Phone)/i, title: "Phone number galat hai",
		  what: "Phone number sahi nahi hai.",
		  todo: ["Poora 10 ank ka mobile number daalein, jaise 9876543210."] },
		{ re: /Add a phone number or an address for (.+?) — one of the two is needed/i, title: "Phone ya pata chahiye",
		  what: (m) => `${m[1]} ka na phone number hai na pata.`,
		  todo: ["Party kholkar phone number ya pata daalein, phir save karein."] },
		{ re: /ka na phone number hai na address/i, title: "Udhaar ke liye phone ya pata chahiye",
		  what: "Is grahak ka na phone number hai na pata, isliye udhaar nahi chhod sakte.",
		  todo: ["Party kholkar phone number ya pata daalein, phir bill banaiye.", "Ya poora paisa lekar bill banaiye."] },
		{ re: /Walk-in \(Sales\) par udhaar/i, title: "Walk-in par udhaar nahi",
		  what: "Bina naam wale grahak (SALES) par paisa baaki nahi chhod sakte — baad me kisse maangenge?",
		  todo: ["Poora paisa lein.", "Ya grahak ka naam chunkar bill banaiye."] },
		{ re: /^(Grahak chuniye|Pehle customer chuniye|Select or add a customer|Select a customer|Please select a Customer)/i, title: "Grahak nahi chuna",
		  what: "Bill par grahak ka naam nahi hai.", todo: ["Upar grahak wale dibbe me naam / phone likhkar chunein (F11).", "Bina naam ke bill ke liye SALES chunein."] },
		{ re: /Please select a Supplier/i, title: "Mahajan nahi chuna", what: "Mahajan (supplier) ka naam nahi chuna.",
		  todo: ["Upar party wale dibbe me mahajan ka naam likhkar chunein."] },
		// ---------- bill contents / payment ----------
		{ re: /(Kam se kam ek saaman|Add at least one item|at least one item|Bill me kam se kam ek saaman)/i, title: "Bill me saaman nahi",
		  what: "Bill khaali hai.", todo: ["Upar khoj wale dibbe me saaman ka naam / code likhkar jodein."] },
		{ re: /Enter an amount greater than zero/i, title: "Rakam nahi daali", what: "Rakam 0 hai.",
		  todo: ["Jitna paisa mila / diya, wo rakam daalein."] },
		{ re: /Select a payment type/i, title: "Payment ka tarika nahi chuna", what: "Nakad / UPI / Bank me se kuch nahi chuna.",
		  todo: ["Payment mode chunein (Cash / UPI / Bank)."] },
		{ re: /₹\s*([\d,\.]+) is more than what's currently due.*advance/i, title: "Bakaya se zyada paisa",
		  what: (m) => `₹ ${m[1]} is party ke bakaya se zyada hai.`,
		  todo: ["Aage badhein to zyada paisa advance (agle bill me katega) ke roop me jama hoga.", "Galti se zyada likha hai to rakam theek karein."] },
		{ re: /Paisa Kaise Settle Hoga/i, title: "Paisa kaise lautega?", what: "Wapsi ka paisa kaise niptana hai, ye nahi chuna.",
		  todo: ["'Khaate me jama' (agli kharid me katega) ya 'Paisa wapas (Refund)' me se ek chunein."] },
		{ re: /qty sahi daaliye|rate sahi daaliye/i, title: "Matra ya rate galat", what: "Matra ya rate 0 / galat hai.",
		  todo: ["Matra aur rate 0 se zyada daalein."] },
		// ---------- printing ----------
		{ re: /Chhapa NAHI|Print nahi hua|Ye bill print nahi hue/i, title: "Print nahi nikla", what: "Bill save hai, par printer se kagaz nahi nikla.",
		  todo: ["Printer chalu hai aur kagaz hai, dekh lein.", "Phir 'dobara chhapo' dabaiye."] },
		{ re: /(printer is not connected|Pipe error|printer.*(busy|stall))/i, title: "Printer juda nahi / vyast hai",
		  what: "Printer se baat nahi ho pa rahi.",
		  todo: ["Printer chalu hai, kagaz hai aur taar juda hai — dekh lein.", "Pichhla print poora hone dein, phir dobara dabaiye.", "Phir bhi na chale to printer band karke chalu karein."] },
		{ re: /Koi printer chuna hua nahi hai/i, title: "Printer nahi chuna", what: "Setting me koi printer chuna hua nahi hai.",
		  todo: ["Utilities → Printer Settings me printer chunein."] },
		// ---------- system / clashes / permission / network ----------
		{ re: /(Record has changed since last read|Deadlock found|try restarting transaction|QueryDeadlockError|has been modified after you have opened it|TimestampMismatch)/i,
		  title: "Ek saath do kaam takra gaye", what: "Usi samay kisi aur ne (ya doosre tab ne) yahi record badla.",
		  todo: ["2 second rukkar phir se save karein.", "Baar-baar ho to page reload karein (Cmd+R)."] },
		{ re: /(not permitted|Insufficient Permission|PermissionError|You don't have permission|Not allowed)/i, title: "Ijazat nahi hai",
		  what: "Is kaam ki ijazat is user ko nahi hai.", todo: ["Ankit se ye ijazat dilwaiye."] },
		{ re: /(Missing Values Required|Value missing for|is mandatory|Mandatory fields required)/i, title: "Kuch zaroori bharna baaki hai",
		  what: "Koi zaroori khana khaali hai.", todo: ["Laal / * wale khane bharein, phir save karein."] },
		{ re: /(Request Timed Out|timed out|Network Error|Failed to fetch|Server Error|502 Bad Gateway|503|Connection refused|ERR_CONNECTION)/i,
		  title: "System se jawab nahi mila", what: "Computer aur system ke beech sampark toot gaya ya bahut der lagi.",
		  todo: ["10 second rukein, phir dobara karein — bill do baar nahi banega.", "Na chale to Santu Hardware app band karke phir kholein."] },
		{ re: /Posting Date.*(before|after)|backdat/i, title: "Tareekh purani hai", what: "Ye entry purani tareekh ki hai.",
		  todo: ["Tareekh aaj ki karein, ya purani tareekh jaan-bujh kar hai to aage badhein."] },
	];

	// Anything still arriving in Devanagari is left exactly as it came -- the
	// rules below all match English/Hinglish, so it would fall through anyway.
	const DEVANAGARI = /[ऀ-ॿ]/;
	const HINGLISH = /\b(hai|nahi|kijiye|daaliye|chuniye|karein|karna|kya|hoga|gaya|raha|chahiye|kisse|saaman|grahak|baaki|udhaar)\b/i;

	function strip(html) {
		let raw = String(html == null ? "" : html).trim();
		// server messages sometimes arrive as the JSON of the whole message
		// object ({"message": "...", "indicator": "red", ...})
		if (raw.startsWith("{")) {
			try {
				const o = JSON.parse(raw);
				if (o && o.message) raw = String(o.message);
			} catch (e) {
				/* not JSON */
			}
		}
		const d = document.createElement("div");
		d.innerHTML = raw;
		return (d.innerText || d.textContent || "").trim();
	}

	function box(title, what, todo, original) {
		const steps = (todo || []).map((t) => `<li>${frappe.utils.escape_html(t)}</li>`).join("");
		const orig = original
			? `<div class="santu-hindi-orig" style="margin-top:10px;font-size:11px;color:#9ca3af;">${frappe.utils.escape_html(original).slice(0, 400)}</div>`
			: "";
		return {
			title,
			html: `<div class="santu-hindi-error" style="font-size:15px;line-height:1.65;">
				<div><b>Kya hua:</b> ${frappe.utils.escape_html(what)}</div>
				<div style="margin-top:8px;"><b>Kya karein:</b><ol style="margin:4px 0 0 18px;padding:0;">${steps}</ol></div>
				${orig}</div>`,
		};
	}

	function translate(message, title) {
		// Our own questions (frappe.confirm) are already written in plain
		// Hinglish and are NOT failures -- framing them as "Kya hua / Kya
		// karein" made a simple yes/no read like something had gone wrong.
		// Marking one santu-plain leaves it exactly as written.
		if (typeof message === "string" && message.indexOf("santu-plain") !== -1) return null;
		const text = strip(message);
		if (!text || DEVANAGARI.test(text)) return null;
		for (const r of RULES) {
			const m = text.match(r.re);
			if (m) return box(r.title, typeof r.what === "function" ? r.what(m) : r.what, r.todo, text);
		}
		if (HINGLISH.test(text)) {
			// our own older Roman-Hindi messages: keep the words, add the frame
			return box("Dhyan dein", text, ["Upar likhi baat theek karke phir se save karein.", "Samajh na aaye to screen ki photo Ankit ko bhejein."], "");
		}
		const looks_like_error = /(error|exception|fail|invalid|not found|cannot|could not|unable|traceback|required|missing|wrong)/i.test(text + " " + (title || ""));
		if (!looks_like_error) return null; // an ordinary English info line (e.g. a report note)
		return box("Kuch gadbad hui", "System ne ye kaam poora nahi kiya.",
			["Ek baar phir se karke dekhein.", "Phir bhi yahi aaye to screen ki photo khinch kar Ankit ko bhejein."], text);
	}

	const orig_msgprint = frappe.msgprint;
	frappe.msgprint = function (msg, title, is_minimizable) {
		try {
			const is_obj = msg && typeof msg === "object" && !Array.isArray(msg);
			const text = is_obj ? msg.message : msg;
			const t = translate(text, is_obj ? msg.title : title);
			if (t) {
				if (is_obj) {
					return orig_msgprint.call(this, Object.assign({}, msg, { message: t.html, title: t.title }), title, is_minimizable);
				}
				return orig_msgprint.call(this, t.html, t.title, is_minimizable);
			}
		} catch (e) {
			/* never let the translator hide the original message */
		}
		return orig_msgprint.apply(this, arguments);
	};

	const orig_confirm = frappe.confirm;
	frappe.confirm = function (message, ...rest) {
		try {
			const t = translate(message);
			if (t) message = `<div style="font-weight:600;margin-bottom:6px;">${t.title}</div>${t.html}`;
		} catch (e) {
			/* keep original */
		}
		const d = orig_confirm.call(this, message, ...rest);
		// Title and buttons too -- "Confirm / Yes / No" meant nothing at the counter.
		try {
			if (d && d.set_title) d.set_title("Pakka karein?");
			if (d && d.get_primary_btn) d.get_primary_btn().text("Haan, aage badhein");
			if (d && d.get_secondary_btn) d.get_secondary_btn().text("Nahi");
		} catch (e) {
			/* labels are cosmetic */
		}
		return d;
	};

	window.santu_hindi_errors = { translate, RULES };
})();
