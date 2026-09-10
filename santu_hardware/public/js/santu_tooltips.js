/* global frappe */
// Hover any control and be told what it does.
//
// The screens are full of icon-only buttons -- ⋮ ↻ ‹ › + × 🗑 🧮 -- that are
// obvious once you know them and unreadable until then (2026-08-30: "sare
// buttons pe hover krne se wo kon sa button aaye wo pata chale"). Rather
// than hand-writing a title on ~350 buttons and hoping every new one
// remembers, this reads a label at hover time and shows it in one bubble.
//
// Label, in order of trust:
//   1. data-tip        -- a screen saying exactly what it wants shown
//   2. title/aria-label-- what the button already declares
//   3. the glyph map   -- for icon-only buttons that declare nothing
// A button whose own face already spells out a word is left alone: repeating
// "Save" under a button that says Save is noise, not help.
(function () {
	const GLYPHS = {
		"+": "Naya jodein",
		"−": "Ek kam karein",
		"-": "Ek kam karein",
		"×": "Band karein",
		"✕": "Band karein",
		"✓": "Theek hai",
		"⋮": "Aur options",
		"☰": "Menu",
		"🗑": "Hataayein",
		"🧮": "Calculator",
		"🖨": "Print karein",
		"📗": "Account / ledger",
		"📄": "Document kholein",
		"💰": "Paisa / payment",
		"🔍": "Dhoondhein",
		"🎙️": "Bol kar likhein",
		"↻": "Refresh karein",
		"🔄": "Refresh karein",
		"⚙": "Settings",
		"✎": "Badlein",
		"➤": "Bhejein",
		"↗": "Naye tab me kholein",
		"‹": "Pichla",
		"›": "Agla",
		"▸": "Kholein",
	};

	// The close "x" inside a bill tab is a span, and closest() would
	// otherwise resolve it to the whole tab (whose face reads "#2026/1") and
	// find nothing to say. Listed here so it answers for itself.
	const SELECTOR =
		"button, [role='button'], [data-act], .santu-stock-uom-edit, .santu-icon-btn, [class*='-tab-x'], .close";
	let $tip = null;
	let timer = null;

	function bubble() {
		if (!$tip) {
			$tip = document.createElement("div");
			$tip.className = "santu-tip";
			document.body.appendChild($tip);
		}
		return $tip;
	}

	function label_for(el) {
		const explicit = el.getAttribute("data-tip") || el.getAttribute("title") || el.getAttribute("aria-label");
		if (explicit && explicit.trim()) return explicit.trim();
		const text = (el.textContent || "").trim();
		// Two letters in a row means the button already says a word.
		if (/[a-zA-Zऀ-ॿ]{2}/.test(text)) return null;
		if (GLYPHS[text]) return GLYPHS[text];
		// "+10", "+50" style quantity buttons.
		const m = text.match(/^([+-])\s*(\d+)$/);
		if (m) return (m[1] === "+" ? "Add " : "Ghatao ") + m[2];
		return null;
	}

	// Move a native title onto data-tip ONCE, permanently, instead of
	// stripping it on hover and putting it back on mouseout. The
	// strip-and-restore version lost labels for good whenever two hovers
	// overlapped -- the second read an element whose title the first had
	// already taken away. aria-label keeps the same text reachable to
	// screen readers now that title is gone.
	function adopt(el) {
		const t = el.getAttribute("title");
		if (t && t.trim() && !el.getAttribute("data-tip")) {
			el.setAttribute("data-tip", t.trim());
			if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", t.trim());
			el.removeAttribute("title");
		}
	}

	function show(el) {
		adopt(el);
		const text = label_for(el);
		if (!text) return;
		const t = bubble();
		t.textContent = text;
		t.classList.add("is-on");
		const r = el.getBoundingClientRect();
		const tr = t.getBoundingClientRect();
		let left = r.left + r.width / 2 - tr.width / 2;
		left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
		// Above by default, below when there is no room -- a tooltip clipped
		// off the top of the window is worse than none.
		const above = r.top > tr.height + 10;
		t.style.left = left + "px";
		t.style.top = (above ? r.top - tr.height - 6 : r.bottom + 6) + "px";
	}

	function hide() {
		if ($tip) $tip.classList.remove("is-on");
	}

	function target(e) {
		return e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
	}

	document.addEventListener(
		"mouseover",
		(e) => {
			const el = target(e);
			if (!el) return;
			clearTimeout(timer);
			timer = setTimeout(() => show(el), 120);
		},
		true
	);

	document.addEventListener(
		"mouseout",
		(e) => {
			const el = target(e);
			if (!el) return;
			clearTimeout(timer);
			hide();
		},
		true
	);

	// Keyboard users tab to a button and get the same answer.
	document.addEventListener("focusin", (e) => {
		const el = target(e);
		if (el) show(el);
	});
	document.addEventListener("focusout", () => hide());
	// A tooltip left hanging over a screen that has navigated away is a ghost.
	window.addEventListener("scroll", () => hide(), true);
	document.addEventListener("click", () => hide(), true);
})();
