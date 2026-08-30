/* CPVC item ki pehchaan — poore system me sirf yahi ek jagah.
 *
 * (2026-08-27, Ankit: "ab future me jo v cpvc ka add ho usme v pilaa wala css
 * aayega naa?")
 *
 * Rang kahin store nahi hota. Har baar jab list bante hai, item ka naam/code
 * padh kar yahin decide hota hai — isliye kal jo naya CPVC item banega, wo
 * apne aap pila ho jaayega. Koi list update nahi karni, koi tick nahi lagana.
 *
 * Pehle ye regex 12 files me copy tha. Ek jagah laaya gaya hai kyunki is
 * codebase me copy-paste kiya hua rule pehle bhi chupchaap aadha-adhoora reh
 * chuka hai (quick_create_item, native form whitelist) — rule badle to sab
 * screens ek saath badlein.
 *
 * Match jaan-boojh kar SAKHT hai — sirf seedha "cpvc" (chhote/bade akshar
 * dono chalega). Beech me dot/space allow karne ki koshish ki thi, par usse
 * "PLASTIC PVC PIPE" jaisa naam galti se pila ho jaata hai ("plasti-C PVC"
 * me c-p-v-c aa jaata hai). Dukaan ke saare 54 CPVC item seedha "CPVC" hi
 * likhte hain, isliye sakht match hi theek hai.
 */
window.santu_is_cpvc_item = function (item_code, item_name) {
	return /cpvc/i.test(item_code || "") || /cpvc/i.test(item_name || "");
};

/* Table ki row pe lagane wali class — `${santu_cpvc_row_class(code, name)}`
 * seedha <tr class="..."> me daal do. CPVC na ho to khaali string. */
window.santu_cpvc_row_class = function (item_code, item_name) {
	return window.santu_is_cpvc_item(item_code, item_name) ? "santu-cpvc-row" : "";
};

/* Search ki suggestion list ke liye — wahan row <div> hoti hai, <tr> nahi,
 * isliye uski apni class hai. */
window.santu_cpvc_dd_class = function (item_code, item_name) {
	return window.santu_is_cpvc_item(item_code, item_name) ? "santu-cpvc-dd-row" : "";
};
