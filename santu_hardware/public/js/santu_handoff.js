/* global frappe */
// One place that reads a screen-to-screen handoff.
//
// Every "convert this to a bill", "edit this challan", "collect payment from
// this party" works the same way: the sending screen puts the document on
// frappe.route_options and changes the route, and the receiving screen reads
// it. Eleven screens were each doing that reading by hand, 27 times over, and
// the same three mistakes kept being made:
//
//   1. clearing route_options BEFORE reading every field off it, so whatever
//      was read later came back undefined -- that is why "Edit Bill" opened a
//      blank screen (2026-10-02);
//   2. forgetting to read the field at all, so the button did nothing and said
//      nothing -- four "Edit" buttons sat dead for about a year (2026-10-07);
//   3. reading it only in on_page_show, which does not fire when Desk is
//      already on that route, so the handoff sat unread (2026-10-01).
//
// claim() makes all three impossible: it reads the whole bag first, clears it
// once, and runs the one handler that matches. A screen that uses it cannot
// half-read a handoff.
(function () {
	window.santu_handoff = {
		// What is waiting, without taking it. For a screen that needs to look
		// before it is ready to act (init_data still loading, say).
		peek() {
			return frappe.route_options || null;
		},

		/**
		 * Take the pending handoff for this screen and run its handler.
		 *
		 * @param {object} page     the screen's own page object. Nothing is
		 *                          claimed until `page.init_data` is set --
		 *                          on_page_show fires before the screen has
		 *                          loaded on a cold open, and the handoff must
		 *                          wait for init() rather than be dropped.
		 * @param {object} handlers { route_option_name: function }, called
		 *                          with `page` as `this` and the option's
		 *                          value as the first argument. The whole bag
		 *                          is passed as the second argument for the
		 *                          rare case that needs a sibling field
		 *                          (source_doctype alongside prefill).
		 * @returns {boolean}       true if a handler ran, so the caller can
		 *                          return instead of falling through to its
		 *                          normal render.
		 */
		claim(page, handlers) {
			const bag = frappe.route_options;
			if (!bag || !page || !page.init_data) return false;

			// Read every key off the bag BEFORE anything is cleared. This is
			// the ordering that was got wrong by hand, repeatedly.
			const names = Object.keys(handlers || {});
			const found = names.find((n) => bag[n] !== undefined && bag[n] !== null);
			if (!found) return false;

			const value = bag[found];
			const handler = handlers[found];
			if (typeof handler !== "function") return false;

			// Cleared exactly once, and only when a handler is really going to
			// run -- a handoff meant for a different screen must survive.
			frappe.route_options = null;
			handler.call(page, value, bag);
			return true;
		},
	};
})();
