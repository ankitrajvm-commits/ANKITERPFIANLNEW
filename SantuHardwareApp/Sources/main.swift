// Santu Hardware — native macOS shell.
//
// Ankit currently starts the shop by double-clicking start_server.command
// (opens a Terminal, runs `bench start`), then opening a browser tab and
// typing localhost:8000. This app replaces both steps: double-click the
// app, it starts the server itself if it isn't already running, and shows
// the app in a real window — no Terminal, no address bar, no browser tabs
// to accidentally close.
//
// It is a thin shell, not a rewrite: everything it shows is the same
// Frappe/santu_hardware app already running at localhost:8000. Quitting
// this window does NOT stop the server — the shop's data/backups/WhatsApp
// bridge keep running exactly as if this were a browser tab that got
// closed, matching how start_server.command already behaves today
// (BUSINESS_RULES.md SS1: one shared machine that stays on).

import Cocoa
import WebKit

// Points at /santu_unlock, not /app directly. This WebView's cookie jar
// starts completely empty on a fresh install — hitting /app with no
// session would get Frappe's own real username/password login page
// (app_include_js, which is what santu_app_lock.js's PIN screen rides on,
// only loads inside an ALREADY-authenticated Desk page, so it cannot
// intercept that first load at all). /santu_unlock is a plain
// guest-accessible page whose PIN entry establishes a real session via
// pin_login(), then redirects into /app itself — so a human never sees
// anything but the PIN prompt, on the very first launch included
// (2026-09-04 direct correction: "username and password concept hata kar
// pin system lao").
let SERVER_URL = URL(string: "http://localhost:8000/santu_unlock")!
let HEALTH_URL = URL(string: "http://localhost:8000/api/method/ping")!
let BENCH_DIR = "/Users/santuhardware/erpnext/frappe-bench"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
	var window: NSWindow!
	var webView: WKWebView!
	var statusLabel: NSTextField!
	var spinner: NSProgressIndicator!
	var serverProcess: Process?
	var pollTimer: Timer?
	// Strong refs: an NSWindow with no owner is released the moment this
	// method returns, taking the popup (and its download) with it.
	var popupWindows: [NSWindow] = []

	func applicationDidFinishLaunching(_ notification: Notification) {
		buildWindow()
		buildMenu()
		checkServerThenLoad()
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
		true
	}

	// Deliberately does NOT touch serverProcess here. `bench start` keeps
	// running in its own process group after this app exits, same as
	// closing a Terminal tab left it running before — the shop's server
	// should never depend on this window staying open.
	func applicationWillTerminate(_ notification: Notification) {
		pollTimer?.invalidate()
	}

	// ---------- window ----------

	func buildWindow() {
		let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
		let width: CGFloat = min(1400, screen.width - 40)
		let height: CGFloat = min(900, screen.height - 40)
		let rect = NSRect(x: (screen.width - width) / 2, y: (screen.height - height) / 2, width: width, height: height)

		window = NSWindow(
			contentRect: rect,
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered,
			defer: false
		)
		window.title = "Santu Hardware"
		window.minSize = NSSize(width: 900, height: 600)
		window.center()

		let container = NSView(frame: rect)

		let config = WKWebViewConfiguration()
		// Persistent (default) data store: the app's own PIN-unlock and
		// Frappe's session cookie must survive a quit/relaunch, exactly
		// like a browser tab that was never in Private Browsing.
		config.websiteDataStore = WKWebsiteDataStore.default()

		webView = WKWebView(frame: container.bounds, configuration: config)
		webView.autoresizingMask = [.width, .height]
		webView.navigationDelegate = self
		webView.uiDelegate = self
		webView.isHidden = true
		container.addSubview(webView)

		spinner = NSProgressIndicator(frame: NSRect(x: rect.width / 2 - 16, y: rect.height / 2 + 10, width: 32, height: 32))
		spinner.style = .spinning
		spinner.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
		spinner.startAnimation(nil)
		container.addSubview(spinner)

		statusLabel = NSTextField(labelWithString: "Server shuru ho raha hai…")
		statusLabel.frame = NSRect(x: rect.width / 2 - 160, y: rect.height / 2 - 30, width: 320, height: 24)
		statusLabel.alignment = .center
		statusLabel.font = NSFont.systemFont(ofSize: 14)
		statusLabel.textColor = .secondaryLabelColor
		statusLabel.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
		container.addSubview(statusLabel)

		window.contentView = container
		window.makeKeyAndOrderFront(nil)
		NSApp.activate(ignoringOtherApps: true)
	}

	func buildMenu() {
		let mainMenu = NSMenu()

		let appMenuItem = NSMenuItem()
		mainMenu.addItem(appMenuItem)
		let appMenu = NSMenu()
		appMenuItem.submenu = appMenu
		appMenu.addItem(withTitle: "Santu Hardware ke baare mein", action: nil, keyEquivalent: "")
		appMenu.addItem(NSMenuItem.separator())
		let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
		reload.target = self
		appMenu.addItem(reload)
		appMenu.addItem(NSMenuItem.separator())
		appMenu.addItem(withTitle: "Quit Santu Hardware", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

		let editMenuItem = NSMenuItem()
		mainMenu.addItem(editMenuItem)
		let editMenu = NSMenu(title: "Edit")
		editMenuItem.submenu = editMenu
		// Standard Cut/Copy/Paste/Select-All — without these, text fields in
		// the web view can't be edited with keyboard shortcuts at all.
		editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
		editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
		editMenu.addItem(NSMenuItem.separator())
		editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
		editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
		editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
		editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

		let windowMenuItem = NSMenuItem()
		mainMenu.addItem(windowMenuItem)
		let windowMenu = NSMenu(title: "Window")
		windowMenuItem.submenu = windowMenu
		windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
		windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
		NSApp.windowsMenu = windowMenu

		NSApp.mainMenu = mainMenu
	}

	@objc func reloadPage() {
		webView.reload()
	}

	// ---------- server lifecycle ----------

	func checkServerThenLoad() {
		pingServer { [weak self] alive in
			guard let self = self else { return }
			if alive {
				self.loadApp()
			} else {
				self.statusLabel.stringValue = "Server shuru ho raha hai…"
				self.startBenchServer()
				self.pollUntilServerReady()
			}
		}
	}

	func pingServer(completion: @escaping (Bool) -> Void) {
		var request = URLRequest(url: HEALTH_URL)
		request.timeoutInterval = 2
		let task = URLSession.shared.dataTask(with: request) { _, response, error in
			let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
			DispatchQueue.main.async { completion(ok) }
		}
		task.resume()
	}

	// Runs the exact same command start_server.command does, minus the
	// interactive "cleared old processes" chatter meant for a Terminal
	// window — this has no Terminal to print into. Detached (not a child
	// tied to this app's lifetime) so quitting the app can never take the
	// shop's server down with it.
	func startBenchServer() {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/bash")
		process.arguments = ["-c", "cd '\(BENCH_DIR)' && exec bench start"]
		process.standardOutput = FileHandle.nullDevice
		process.standardError = FileHandle.nullDevice
		do {
			try process.run()
			serverProcess = process
		} catch {
			statusLabel.stringValue = "Server start nahi ho paya: \(error.localizedDescription)"
		}
	}

	func pollUntilServerReady() {
		var attempts = 0
		pollTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] timer in
			guard let self = self else { timer.invalidate(); return }
			attempts += 1
			self.pingServer { alive in
				if alive {
					timer.invalidate()
					self.loadApp()
				} else if attempts > 80 {
					// ~2 minutes — a bench that hasn't come up by then has a
					// real problem this loop can't fix (port in use, a
					// crashed worker). Say so instead of spinning forever.
					timer.invalidate()
					self.statusLabel.stringValue =
						"Server start hone me bahut time lag raha hai. start_server.command chalakar terminal me error dekhiye."
				}
			}
		}
	}

	func loadApp() {
		statusLabel.isHidden = true
		spinner.isHidden = true
		webView.isHidden = false
		webView.load(URLRequest(url: SERVER_URL))
	}

	// If the page itself fails to load (server answered ping but Desk
	// isn't up yet, or a transient error), retry rather than leaving a
	// blank white webview with no explanation.
	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		retryLoadAfterDelay()
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		retryLoadAfterDelay()
	}

	func retryLoadAfterDelay() {
		webView.isHidden = true
		spinner.isHidden = false
		statusLabel.isHidden = false
		statusLabel.stringValue = "Dobara try kar rahe hain…"
		DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
			self?.webView.load(URLRequest(url: SERVER_URL))
		}
	}

	// ---------- downloads and window.open ----------
	//
	// A bare WKWebView silently drops BOTH of the things this app's PDFs
	// depend on (2026-09-04 report: "pdf download nh ho rha, a4 wala"):
	//
	//  * window.open(...) does nothing at all unless WKUIDelegate's
	//    createWebViewWith is implemented — and the khata's "Download PDF",
	//    every Reports export, the invoice preview and the sync/backup
	//    downloads all go through window.open (a dozen call sites across
	//    the web app).
	//  * A response that is an attachment (Content-Disposition, or a PDF
	//    the view cannot display inline) is simply abandoned unless the
	//    navigation response is explicitly turned into a WKDownload.
	//
	// Both are wired up here, so downloads land in ~/Downloads and are
	// revealed in Finder, the way they would from Safari.

	func webView(
		_ webView: WKWebView,
		createWebViewWith configuration: WKWebViewConfiguration,
		for navigationAction: WKNavigationAction,
		windowFeatures: WKWindowFeatures
	) -> WKWebView? {
		// A real second window, not a redirect of the main one.
		//
		// Half this app's window.open calls are `window.open("", "_blank")`
		// followed by w.document.write(...) — the khata's thermal Print
		// fallback and the bulk-update PDF preview both do exactly that.
		// Loading navigationAction.request.url in the MAIN web view (the
		// obvious shortcut) would hand those an empty URL and blank out the
		// whole app mid-sale. Returning a genuine new WKWebView is what the
		// API is asking for, and is what makes both shapes work: the ones
		// that write their own HTML, and the ones that point at a URL —
		// including a PDF, which then becomes a download through the
		// navigation-response handler below and closes its own window.
		let popup = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: configuration)
		popup.navigationDelegate = self
		popup.uiDelegate = self

		let window = NSWindow(
			contentRect: popup.frame,
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered,
			defer: false
		)
		window.title = "Santu Hardware"
		window.contentView = popup
		window.center()
		window.makeKeyAndOrderFront(nil)
		popupWindows.append(window)
		return popup
	}

	// window.close() from the page — and the PDF case, where the window is
	// only ever a carrier for a download that has already been handed off.
	func webViewDidClose(_ webView: WKWebView) {
		closePopup(hosting: webView)
	}

	func closePopup(hosting webView: WKWebView) {
		guard let idx = popupWindows.firstIndex(where: { $0.contentView === webView }) else { return }
		let window = popupWindows.remove(at: idx)
		window.orderOut(nil)
		window.close()
	}

	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationResponse: WKNavigationResponse,
		decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
	) {
		var isAttachment = false
		if let http = navigationResponse.response as? HTTPURLResponse,
		   let disposition = http.value(forHTTPHeaderField: "Content-Disposition") {
			isAttachment = disposition.lowercased().contains("attachment")
		}
		// canShowMIMEType is false for anything the view cannot render
		// itself — that plus an explicit attachment header covers both the
		// "save this file" and "unknown type" cases.
		if isAttachment || !navigationResponse.canShowMIMEType {
			decisionHandler(.download)
			return
		}
		decisionHandler(.allow)
	}

	func webView(
		_ webView: WKWebView,
		navigationResponse: WKNavigationResponse,
		didBecome download: WKDownload
	) {
		download.delegate = self
		// The popup existed only to carry this URL; the file is now being
		// saved, so the empty window it left behind should not linger.
		if webView !== self.webView {
			closePopup(hosting: webView)
		}
	}

	func webView(
		_ webView: WKWebView,
		navigationAction: WKNavigationAction,
		didBecome download: WKDownload
	) {
		download.delegate = self
	}

	// WKDownloadDelegate

	func download(
		_ download: WKDownload,
		decideDestinationUsing response: URLResponse,
		suggestedFilename: String,
		completionHandler: @escaping (URL?) -> Void
	) {
		let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
			?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")
		var target = downloads.appendingPathComponent(suggestedFilename)

		// Never overwrite an existing file — the shop downloads the same
		// khata repeatedly and each one should survive, as in any browser.
		if FileManager.default.fileExists(atPath: target.path) {
			let base = target.deletingPathExtension().lastPathComponent
			let ext = target.pathExtension
			var n = 2
			repeat {
				let name = ext.isEmpty ? "\(base)-\(n)" : "\(base)-\(n).\(ext)"
				target = downloads.appendingPathComponent(name)
				n += 1
			} while FileManager.default.fileExists(atPath: target.path)
		}
		completionHandler(target)
	}

	func downloadDidFinish(_ download: WKDownload) {
		guard let url = download.progress.fileURL else { return }
		NSWorkspace.shared.activateFileViewerSelecting([url])
	}

	func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
		let alert = NSAlert()
		alert.messageText = "Download poora nahi hua"
		alert.informativeText = error.localizedDescription
		alert.alertStyle = .warning
		alert.runModal()
	}
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
