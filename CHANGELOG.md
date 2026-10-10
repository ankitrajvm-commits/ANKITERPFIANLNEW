# Kya-kya badla

Har release me kya badla, seedhi bhasha me. Sabse naya sabse upar.

## 1.1.0 — 25 September 2026

**WhatsApp**

- **"Kisi aur ko" bhejna.** Ab har bill screen pe do option hain — ek seedha
  grahak ko, doosra kisi aur number pe (munshi, bhai, driver). Number type
  karo, bas. Naam bhi daal sakte hain, warna chat me sirf number dikhega.
- Ye Billing, Estimate, dono Return, Purchase Bill, Chalan, Payment aur bill
  khol kar dekhne wale screen — sab pe hai.
- **Sale Order aur Purchase Order pe WhatsApp aa gaya** — pehle in dono pe
  bhejne ka koi raasta hi nahi tha.
- Kisi aur ko bheja hua bill ab grahak ke naam pe "bhej diya" nahi likhta —
  pehle likh deta tha, jisse lagta tha grahak ko mil gaya.

**Bill screen**

- **Tick (✓) ab rate aur unit dono item me save karta hai.** Pehle sirf rate
  jaata tha.
- **Unit badalne pe ab saaf warning aati hai** — "100 Pcs ab 100 Box dikhega".
  Stock ka number wahi rehta hai, sirf naam badalta hai, isliye bina bataye
  nahi hota.
- **Ek purani gadbad pakdi:** jis item me do unit set the (jaise Nos aur Box),
  tick dabane pe conversion 12 guna galat ho jaata tha, aur purana unit list
  se gayab ho jaata tha. Dono theek.
- **Price pe galat unit likha jaata tha** — rate Box ka hota tha par likha
  "per Nos". Ab dono saath badalte hain.
- **"Available" ab dabaya ja sakta hai.** Maal aa gaya? Bill chhode bina
  wahin se stock chadha do — kitna aaya aur naya rate. Billing aur Estimate
  dono pe.
- **Item ka naam badlo to pooch leta hai** ki poori list me bhi badalna hai
  ya sirf isi bill pe. Pehle sirf bill pe badalta tha, list me kabhi nahi
  jaata tha.
- Naam badalte waqt agar wahi naam kisi aur saaman ka hai to ab rok deta hai
  (warna do jagah stock bat jaata).
- Estimate me ab stock ka number dikhta hai — pehle dikhta hi nahi tha.

**Theek kiye gaye**

- **Left-right scroll.** Purchase Bill, Chalan, Sale Order, Purchase Order
  aur Expense — in paanch pe table khiskta hi nahi tha. Ab khiskta hai.
- **Scrollbar ab dikhta hai.** Mac use karte waqt scrollbar chhupa rehta hai,
  isliye lagta tha scroll hai hi nahi. Ab patli si patti hamesha dikhti hai.
- Bill ke column patle kiye — ab kam khiskana padta hai.
- **"Verify My Data" me minus stock ab laal Error nahi, sirf Warning hai.**
  Is dukaan me maal pehle bik jaata hai aur entry baad me hoti hai — ye
  gadbad nahi, normal hai. Isse roz "Needs Attention" dikhta rehta tha.
  Seedha raasta bhi likha hai: bill me "Available" pe dabakar stock chadha do.

**Excel export (Export Items)**

- **Sale price ab sab items me aata hai.** Pehle 817 me se sirf 193 ka price
  nikalta tha — export galat jagah se price padh raha tha. Ab 0 khaali.
- **MRP aur Minimum Stock** naye column jude.
- Column ke naam ab Import wale se milte hain, to export karke seedha wapas
  import kar sakte hain. (Stock wale column ka naam jaan-bujh ke "Stock"
  rakha hai, "Opening Stock" nahi — warna dobara import pe stock dugna ho
  jaata.)
- Export ab **0.2 second** me hota hai (pehle har item pe alag query chalti thi).
- **Purchase price (CP) 553 items me ab bhi khaali hai** — ye export ki
  gadbad nahi, wo kharid ka rate system me kahin likha hi nahi gaya. Jab
  stock chadhate waqt rate daalenge, tab se bharna shuru ho jayega.

**Doctor Uncle**

- Shikayat hone par bhi likha aata tha "Koi nayi shikayat nahi" — ab saaf
  likhta hai "2 nayi shikayat hai".

**Close Financial Year**

- **Bada bug:** "Proceed" ka button kabhi chalu ho hi nahi sakta tha. Code
  galti se **udhaar** ko rok samajh raha tha (aur udhaar to hamesha rehta
  hai), aur jis minus stock ko rokna chahiye tha use chhod raha tha. Ab
  udhaar sirf jaankari hai, aur rok sirf un cheezon pe hai jo dukaan sach me
  theek kar sakti hai.

**Aage koi bhi AI is app par kaam kare, uske liye niyam likh diye**

- Nayi file `AI_OPERATING_RULES.md` — jo baatein sirf *is* computer aur *is*
  database ke baare me hain, aur jo na pata ho to nuksan hota hai:
  - **App ki do copy hain** aur dono ko barabar rakhna zaroori hai, warna
    likha hua code chalta hi nahi. Ye baat pehle kahin likhi hi nahi thi.
  - Live data (asli bill, asli grahak) par kya karna safe hai, kya nahi —
    kabhi thok-bajaake delete nahi, sirf naam se; stock/khaate chhune se
    pehle snapshot.
  - Test ke niyam: TEST naam ke record, asli grahak ko kabhi message/print
    nahi, bill number waapas theek karna, aur kachra poora saaf karna.
  - **Asli keemat kahan rakhi hai** — sale price Item Price me hai, Item par
    nahi; CP Bin me hai. Galat jagah padhne se aadha data khaali dikhta hai.
  - Error/warning sirf Hinglish me, Devanagari me nahi.
  - Frappe ki wo galtiyaan jo baar-baar hoti hain (jaise ijaazat ka tag
    lagana bhool jaana — isi se saare custom report band pade the).
- `ERP_MASTER_PROMPT.md` ke document map me ye file jod di, aur
  `CODING_STANDARDS.md` ki "kabhi mat karna" aur "jaanch" wali list me bhi.

**Ab har error / warning Hinglish me**

- Pehle screen par gadbad ki baat Hindi (Devanagari) me aati thi. Ab wahi
  baat, wahi shabd, par **Roman letters** me — "Stock kam hai", "Kya hua",
  "Kya karein", "Ijazat nahi hai".
- Confirm wale dibbe ke button bhi: **"Haan, aage badhein" / "Nahi"**.
- Bill/Payment save hone wala message bhi Hinglish me ("Bill #904 save ho
  gaya").
- Jo sawaal sirf haan/na poochte hain (jaise "poori list me bhi yahi naam kar
  dein?") unhe ab galti se error jaisa dibba nahi banaya jaata.
- Grahak ko jaane wale WhatsApp message (udhaar ki yaad-dilai waghairah)
  **Hindi me hi rahenge** — wo grahak ke liye hain, dukaan ke liye nahi.

**Bill par saaman ka stock ab sach dikhata hai**

- Line ke neeche jo "Available: N" likha aata hai, wo **sirf ek baar** bhara
  jaata tha — jab saaman bill me joda gaya. Uske baad kabhi nahi badalta tha.
  Matlab bill khula rakha ho aur beech me maal aa jaye, to line par purana hi
  number dikhta rehta tha.
- Pakda kaise: khuli bill par **15** likha tha jabki asli stock **13** tha.
  Estimate par to **0** dikh raha tha, jabki 13 mila.
- Ab ye number khud theek ho jaata hai — screen par wapas aate hi, aur jab
  aap "Available" pe dabakar stock chadhate hain tab bhi (us saaman ki saari
  lines ek saath).
- Billing aur Estimate dono par.

**WhatsApp par PDF ka naam ab grahak ke naam se**

- Pehle grahak ko `SINV-26-01109-1.pdf` jaisi file milti thi — andar ka code,
  jo unke kisi kaam ka nahi, aur har bill dikhne me ek jaisa.
- Ab naam aise aate hain: **"Raju Kr Sharma - Bill 885.pdf"**,
  **"Sunil Chaurasiya - Estimate 1595.pdf"**, **"Sabre Alam - Chalan
  24-09-2026.pdf"**.
- Har file ka naam **alag** hota hai — bill number aakhir me lagta hai, to ek
  hi grahak ke kai bill WhatsApp me aapas me nahi ulajhte. Jin cheezon ka bill
  number nahi hota (chalan, payment) unme tareekh-samay lagta hai.
- Hindi naam bhi sahi rehte hain, aur lamba naam chhota hota hai par **number
  kabhi nahi katta**.

**Bill ke message se paise ka hisaab hataya**

- Pehle message me "Payment Breakdown" (kul, jama, baaki) likha aata tha —
  wahi baat PDF me pehle se hoti hai, isliye message lamba aur uljhan bhara
  lagta tha. Ab message sirf itna kehta hai ki bill saath me laga hai.
- Estimate, Chalan, Return aur Payment ke message me bhi ab saaf likha aata
  hai ki file saath me lagi hai.
- Ye message Settings ke andar bhi save rehte hain, isliye **wahan ki copy
  bhi saath me theek ki gayi** — warna badla hua text jaata hi nahi.

**WhatsApp pe bill wapas PDF me jaata hai**

- Kuch dinon se grahak ko bill **photo (PNG)** me jaa raha tha, PDF me nahi.
  Wajah: 23 September ko jab "WhatsApp A4 Library" juda aur dukaan ne koi A4
  roop chun liya, tabhi se code PDF wala raasta chhod kar photo wale raaste
  pe chala jaata tha — dono ke liye ek hi variable tha. Ab bill **PDF** me
  hi jaata hai, aur chuna hua A4 roop bhi sahi lagta hai.
- Size bhi 2 MB ki photo se ghat kar **86 KB ki PDF** ho gayi.
- Photo sirf 80mm wali counter parchi ke liye hai — aur wahi rahega. Dono
  raaste ab alag-alag hain, taaki dobara aapas me na mil jaayein.
- Jaanch: Sale bill, Estimate, Chalan aur Payment — **chaaron ab PDF**.

**Reports**

- **Sabse badi gadbad: har "custom" report band pada tha.** Party Statement,
  All Parties, Sale Purchase By Party, Item Detail, Discount Report, aur
  teeno Expense report — kholne par "इजाज़त नहीं है" aata tha. Wajah: jo
  function ye reports chalata hai uspe ijaazat ka tag lagana hi reh gaya tha
  (uske theek neeche wale function pe laga hua tha). Ab saare 9 chalte hain.
- **Sale Invoices ki list ajeeb dikhti thi.** Tareekh "25-09-2026" teen line
  me toot jaati thi aur rows ooncha-neecha ho jaate the — header me "mat
  todo" likha tha par body me nahi. Ab ek line me, sab rows barabar, aur
  **Amount poora dikhta hai** (pehle kat raha tha).
- **"Stock Detail" report ab chalti hai** — 1881 entry. Pehle poori report
  atak jaati thi (neeche wajah dekhiye).
- Baaki saare report chala kar dekhe — **sab theek**.

**Purana test ka kachra hataya**

- 7 September ke ek test ne **"ZZ Force Unit Test"** naam ka saaman banaya
  tha — 50 nag @ ₹10. Saaman to mit gaya par uski entry, ledger aur **₹500
  ki hisaab-kitaab wali entry** reh gayi thi. Wahi ek entry poori "Stock
  Detail" report tod rahi thi, aur ₹500 ka jhootha maal khaaton me pada tha.
  Ab poori tarah saaf — asli stock kahin nahi hila, sirf ₹500 ka jhooth nikla.

**Jaanch**

- Har bill screen pe **100 saaman** daal kar dekha gaya — Billing, Estimate,
  dono Return, Purchase Bill, Chalan, Sale Order, Purchase Order. Sab bina
  atke chale.
- **Saare 46 report chala kar dekhe — ab sab chalte hain.**
- 16 screen khol kar dekhe — ek bhi error nahi.

**App**

- Mac ki **4 alag-alag app copy** mil gayi thin, aur jo roz khulti thi usi me
  **fingerprint wala feature gayab tha**. Nayi app source se banai gayi jisme
  sab kuch hai, aur baki hata di gayin.

## 1.0.0 — 17 August 2026

Pehla poora version, jo dukaan par roz chalne ke liye taiyaar hai.

**Bharosa (sabse zaroori)**

- **Backup ab sach me hota hai.** Pehle backup ka poora system bana hua tha
  par switch band tha — ek bhi backup nahi ban raha tha. Ab raat 2 baje poora
  backup, aur dukaan ke samay har 2 ghante me chhota backup. Bijli gayi to
  zyada se zyada 2 ghante ka kaam jaayega, poora din nahi.
- **Har backup khol kar jaancha jaata hai.** Sirf "ban gaya" likhna kaafi
  nahi — file khol kar dekhi jaati hai. Jo jaanch me fail ho wo "Success"
  nahi ban sakta.
- **Backup ka doosra raasta.** Agar app ka background system band ho jaaye
  to bhi computer khud backup le lega.
- **Bill kabhi nahi khoyega.** Har bill ki PDF apne aap folder me rakhi
  jaati hai; na bane to dobara banane ka button Doctor Uncle me hai.
- **Printing ke teen raaste.** Pehle QZ Tray, wo na chale to seedha USB se
  printer, wo bhi na chale to PDF khul jaata hai. Ab QZ band hone par bhi
  bill nikal jayega.
- **"Bill chhap gaya?"** — print ke baad ek chhota sawal. Kaagaz khatam ho
  to printer khud nahi bataata, isliye ek tap se pata chal jaata hai.
  Dobara chhapne par parchi par **DUPLICATE / NAKAL** likha aata hai.
- **Jo bill nahi chhapa** wo Sale screen par peeli patti me dikhta hai, ek
  button se dobara chhap jaata hai.

**Shikayat aur jaanch**

- **"Kuch gadbad hai? Batao"** — Sale screen ke More menu me. Ek line likh
  dijiye; screen, bill aur version apne aap jud jaate hain.
- App me kahin bhi koi gadbad ho to wo apne aap likh li jaati hai — pehle
  ye sirf ek chhipi hui list me jaati thi jo koi nahi kholta tha.
- **Doctor Uncle me 6 nayi jaanch** — backup, computer ki jagah, atke hue
  bill, printer ka doosra raasta, bill ki PDF, aur nayi shikayat.

**Theek kiye gaye**

- Doctor Uncle kabhi-kabhi "jaanch rahe hain…" par hamesha ke liye atak
  jaata tha (QZ Tray jawab nahi deta tha). Ab 6 second baad aage badh jaata
  hai.
- Bill ki PDF dobara banane wala kaam background me kabhi chal hi nahi sakta
  tha — ek purani gadbad jo abhi pakdi gayi.
- Backup ka samay `12:13:49.655113` jaisa ajeeb value ban gaya tha, ab saaf
  `02:00` hai.
- Screen purani dikhne wali dikkat ab nahi hogi — version apne aap badalta
  hai, haath se badalne ki zaroorat nahi.
