/* Santu Hardware Service Worker
 * Purpose: PWA installability, plus a tiny cache for the logo files.
 *
 * It deliberately does NOT sit in front of the app's normal traffic. The
 * previous version wrapped EVERY request that wasn't /api/ or /app/ in
 * `respondWith(caches.match(...) || fetch(...))`, which caused two real bugs
 * (both confirmed live on 2026-08-20):
 *
 *   1. Realtime died. socket.io runs on a different origin (localhost:9000),
 *      and re-issuing those cross-origin polling requests from inside the
 *      worker made every one of them fail — "Error connecting to socket.io:
 *      xhr poll error" on a loop. Proven by fetching the same socket.io URL
 *      from a tab this worker does not control, where it returns 200 fine.
 *
 *   2. A blip became a hard failure. There was no `.catch()`, so if `fetch`
 *      rejected even momentarily (server restarting, for instance) the
 *      rejected promise went straight to `respondWith` and the browser
 *      reported a network error for that file, instead of falling back to
 *      its own cache or retry. A page missing a stylesheet or script that
 *      way looks blank or broken and only comes back on a manual reload.
 *
 * So: same-origin GETs for the handful of files actually worth caching, and
 * everything else — API calls, desk pages, CSS/JS, fonts, sounds, socket.io —
 * is left completely alone for the browser to handle as it normally would.
 */

const CACHE = "santu-hw-v2";
const STATIC = [
	"/assets/santu_hardware/images/logo.svg",
	"/assets/santu_hardware/images/logo.png",
];

self.addEventListener("install", (e) => {
	e.waitUntil(
		caches
			.open(CACHE)
			// Never let one missing file abort the whole install and leave the
			// worker stuck: cache what is there, ignore what isn't.
			.then((c) => Promise.all(STATIC.map((u) => c.add(u).catch(() => {}))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", (e) => {
	const req = e.request;

	// Anything not a plain same-origin GET is none of this worker's business.
	// The origin check is what keeps socket.io (port 9000) working.
	if (req.method !== "GET") return;

	let url;
	try {
		url = new URL(req.url);
	} catch (err) {
		return;
	}
	if (url.origin !== self.location.origin) return;

	// Only the explicitly cached logos are served from here. Everything else
	// falls through to normal browser handling, HTTP cache and all.
	if (!STATIC.includes(url.pathname)) return;

	e.respondWith(
		caches
			.match(req)
			.then((cached) => cached || fetch(req))
			// Last line of defence: a failure here must still resolve to a real
			// response attempt rather than a rejected promise.
			.catch(() => fetch(req))
	);
});
