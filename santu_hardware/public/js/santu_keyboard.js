/* Keyboard se list chunne ka ek hi tareeka, poore app ke liye.
 *
 * (2026-08-27, Ankit: "is app ko keyboard se chalne wala bana do. ki mouse
 * wagerah naa chuna pade")
 *
 * Dukaan me counter pe mouse uthana sabse bada rukawat tha: naam type karo,
 * list girti thi, par usme se chunne ke liye mouse chahiye hi tha — har
 * bill me, har item pe. Ab: ↑ ↓ se chalo, Enter se chuno, Esc se band karo.
 *
 * Ye function list ka apna click handler hi chalata hai (`.click()`), naya
 * logic nahi likhta — matlab keyboard se chunne aur mouse se chunne me
 * bilkul ek hi kaam hota hai, aur aage koi list ka behaviour badle to
 * dono jagah apne aap badal jayega.
 *
 * Istemaal:
 *     santu_kb_list({
 *         $input: <search box>,
 *         $dropdown: <girne wali list>,
 *         rowSelector: ".santu-bill-dd-row",
 *     });
 * Ek hi input pe dobara call karna surakshit hai — purana binding hat
 * jaata hai (screen dobara render hone pe yahi hota hai).
 */
window.santu_kb_list = function (opts) {
	const $input = opts.$input;
	const $dropdown = opts.$dropdown;
	const rowSelector = opts.rowSelector;
	if (!$input || !$input.length || !$dropdown || !$dropdown.length) return;

	const ACTIVE = "santu-kb-active";
	const ns = ".santu-kb";

	const rows = () => $dropdown.find(rowSelector).filter(":visible");

	const move = (step) => {
		const $all = rows();
		if (!$all.length) return;
		const cur = $all.index($all.filter("." + ACTIVE));
		// Kuch chuna nahi hai to ↓ pehle pe, ↑ aakhri pe le jaata hai.
		let next = cur < 0 ? (step > 0 ? 0 : $all.length - 1) : cur + step;
		// List ke aakhir se aage jaao to shuru pe wapas (aur ulta bhi) —
		// counter pe koi ye nahi dekhta ki list khatam kahan hui.
		if (next >= $all.length) next = 0;
		if (next < 0) next = $all.length - 1;
		$all.removeClass(ACTIVE);
		const $sel = $all.eq(next).addClass(ACTIVE);
		// Lambi list me chuni hui row dikhni bhi chahiye, warna neeche
		// chupchaap chalti rehti hai aur lagta hai kuch ho hi nahi raha.
		const el = $sel[0];
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
	};

	$input.off("keydown" + ns).on("keydown" + ns, function (ev) {
		const $all = rows();

		if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
			if (!$all.length) return;
			ev.preventDefault();
			// Arrow list ke liye hai, cursor ke liye nahi — warna cursor
			// text ke shuru/aakhir me kood jaata hai aur list wahin khadi
			// rehti hai.
			move(ev.key === "ArrowDown" ? 1 : -1);
			return;
		}

		if (ev.key === "Enter") {
			if (!$all.length) return;
			const $active = $all.filter("." + ACTIVE);
			// Kuch chuna na ho to pehli row — type karke seedha Enter
			// dabana sabse aam aadat hai.
			const $pick = $active.length ? $active : $all.first();
			ev.preventDefault();
			$pick.trigger("click");
			return;
		}

		if (ev.key === "Escape") {
			if (!$dropdown.is(":visible")) return;
			ev.preventDefault();
			$dropdown.hide();
			return;
		}
	});

	// Nayi list aane par purana highlight hata do, warna dobara search
	// karne pe teesri row bina wajah chuni hui dikhti hai.
	$input.off("input" + ns).on("input" + ns, () => {
		$dropdown.find("." + ACTIVE).removeClass(ACTIVE);
	});

	// Mouse aur keyboard ek dusre se na ladein: jis row pe mouse jaaye,
	// wahi chuni hui maani jaaye.
	$dropdown.off("mouseenter" + ns).on("mouseenter" + ns, rowSelector, function () {
		$dropdown.find("." + ACTIVE).removeClass(ACTIVE);
		$(this).addClass(ACTIVE);
	});
};
