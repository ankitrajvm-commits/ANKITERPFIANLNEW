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
import LocalAuthentication

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

// ---------------------------------------------------------------------------
// Touch ID bridge.
//
// WebAuthn does NOT work inside a WKWebView. Measured on this exact Mac
// (MacBook Air M3, Touch ID enrolled and working) on 2026-09-05:
// `PublicKeyCredential` exists and `isSecureContext` is true, but
// `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
// resolves FALSE — platform authenticators are reserved for real browsers
// (Safari/Chrome), not embedded web views. The web-side fingerprint code
// only checked `PublicKeyCredential && isSecureContext`, so it believed it
// was available, tried, silently failed, and fell back to the PIN with no
// explanation — which is why the fingerprint has never once appeared on the
// lock screen inside this app.
//
// So the fingerprint is done natively here. The Keychain would have been the
// place to keep the secret, and it cannot be used: a biometric-ACL keychain
// item needs the `keychain-access-groups` entitlement, which needs a
// provisioning profile from the Apple Developer account. Measured the same
// day — SecItemAdd returns -34018 (errSecMissingEntitlement) without it, and
// signing with the entitlement but no profile makes macOS SIGKILL the app at
// launch. Both the legacy and the data-protection keychain behave this way.
//
// Instead: a random per-device token in a 0600 file under this app's own
// Application Support directory, read ONLY after LocalAuthentication says
// the fingerprint matched. The server holds that token hashed (pbkdf2, same
// as the PIN), only issues one against a correct PIN, and drops every token
// whenever the PIN changes — see app_lock_device_* in api.py. The token is
// worth exactly what the PIN is worth and no more; it is a local shortcut to
// a 4-digit counter lock, never an account credential.
final class TouchIDBridge: NSObject, WKScriptMessageHandlerWithReply {
	private var tokenURL: URL? {
		guard
			let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
		else { return nil }
		let folder = dir.appendingPathComponent("SantuHardware", isDirectory: true)
		if !FileManager.default.fileExists(atPath: folder.path) {
			try? FileManager.default.createDirectory(
				at: folder,
				withIntermediateDirectories: true,
				attributes: [.posixPermissions: 0o700]
			)
		}
		return folder.appendingPathComponent("applock.device", isDirectory: false)
	}

	private func hasToken() -> Bool {
		guard let url = tokenURL else { return false }
		return FileManager.default.fileExists(atPath: url.path)
	}

	private func biometryAvailable() -> Bool {
		var err: NSError?
		return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
	}

	/// Touch ID prompt. `.deviceOwnerAuthenticationWithBiometrics` — NOT the
	/// variant that falls back to the Mac's login password: this is a
	/// shortcut for the shop's PIN, and a password box is no shortcut.
	private func authenticate(reason: String, completion: @escaping (Bool) -> Void) {
		let ctx = LAContext()
		ctx.localizedCancelTitle = "PIN daalenge"
		guard biometryAvailable() else {
			completion(false)
			return
		}
		ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, _ in
			DispatchQueue.main.async { completion(ok) }
		}
	}

	private func writeToken(_ token: String) -> String? {
		guard let url = tokenURL else { return "no application support directory" }
		guard let data = token.data(using: .utf8), !token.isEmpty else { return "empty token" }
		do {
			try data.write(to: url, options: [.atomic, .completeFileProtection])
			try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
			return nil
		} catch {
			return error.localizedDescription
		}
	}

	private func readToken() -> String? {
		guard let url = tokenURL, let data = try? Data(contentsOf: url) else { return nil }
		return String(data: data, encoding: .utf8)
	}

	func forgetToken() {
		if let url = tokenURL { try? FileManager.default.removeItem(at: url) }
	}

	func userContentController(
		_ controller: WKUserContentController,
		didReceive message: WKScriptMessage,
		replyHandler: @escaping (Any?, String?) -> Void
	) {
		let body = message.body as? [String: Any] ?? [:]
		switch body["action"] as? String ?? "" {
		case "status":
			replyHandler(["available": biometryAvailable(), "enrolled": hasToken()], nil)

		case "save":
			let token = body["token"] as? String ?? ""
			guard biometryAvailable() else {
				replyHandler(["ok": false, "error": "is Mac par Touch ID available nahi hai"], nil)
				return
			}
			// Ask for the finger while enrolling too, so whoever switches it on
			// is the person whose finger will open the shop from then on.
			authenticate(reason: "fingerprint chalu karne ke liye") { ok in
				guard ok else {
					replyHandler(["ok": false, "error": "cancelled"], nil)
					return
				}
				let err = self.writeToken(token)
				replyHandler(["ok": err == nil, "error": err as Any], nil)
			}

		case "get":
			guard hasToken() else {
				replyHandler(["ok": false, "error": "not set up"], nil)
				return
			}
			authenticate(reason: "Santu Hardware kholne ke liye") { ok in
				guard ok, let token = self.readToken() else {
					replyHandler(["ok": false, "error": "cancelled"], nil)
					return
				}
				replyHandler(["ok": true, "token": token], nil)
			}

		case "forget":
			forgetToken()
			replyHandler(["ok": true], nil)

		default:
			replyHandler(nil, "unknown action")
		}
	}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
	var window: NSWindow!
	var webView: WKWebView!
	var statusLabel: NSTextField!
	var spinner: NSProgressIndicator!
	var serverProcess: Process?
	var pollTimer: Timer?
	var downloadDestinations: [ObjectIdentifier: URL] = [:]
	var popupWindows: [ObjectIdentifier: NSWindow] = [:]
	var popupsThatRendered: Set<ObjectIdentifier> = []
	let touchIDBridge = TouchIDBridge()
	var suppressRetryUntil = Date.distantPast

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
		window.isReleasedWhenClosed = false
		window.minSize = NSSize(width: 900, height: 600)
		window.center()

		let container = NSView(frame: rect)

		let config = WKWebViewConfiguration()
		// Persistent (default) data store: the app's own PIN-unlock and
		// Frappe's session cookie must survive a quit/relaunch, exactly
		// like a browser tab that was never in Private Browsing.
		config.websiteDataStore = WKWebsiteDataStore.default()
		// Native Touch ID, reachable from the page as
		// webkit.messageHandlers.santuTouchID — WebAuthn cannot work in a
		// WKWebView (see TouchIDBridge). Registered on the shared user
		// content controller so the unlock page AND the in-Desk re-lock
		// overlay both see it.
		config.userContentController.addScriptMessageHandler(
			touchIDBridge,
			contentWorld: .page,
			name: "santuTouchID"
		)

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
		appMenu.addItem(
			withTitle: "Santu Hardware ke baare mein",
			action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
			keyEquivalent: ""
		)
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
		handleNavigationFailure(in: webView, error: error)
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		handleNavigationFailure(in: webView, error: error)
	}

	// Retrying has to cover a real mid-shift bench crash (otherwise the counter
	// is left staring at a dead page with only Cmd+R to save it), while never
	// firing for the two harmless cases that also surface as "failures":
	// a popup window's own load, and WebKit tearing down a frame load it just
	// handed to a WKDownload — which is what every single Save-PDF does.
	func handleNavigationFailure(in webView: WKWebView, error: Error) {
		guard webView === self.webView else { return }
		guard !isNavigationCancellation(error) else { return }
		guard Date() >= suppressRetryUntil else { return }
		retryLoadAfterDelay()
	}

	// Converting a navigation into a download cancels the frame load, and the
	// error WebKit reports for it is not consistent — NSURLErrorCancelled from
	// the URL loader, "frame load interrupted" (102) from WebKit's own domain.
	// Matching on codes alone proved unreliable, hence the timestamp guard too.
	func isNavigationCancellation(_ error: Error) -> Bool {
		let error = error as NSError
		if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
		if error.domain == "WebKitErrorDomain" && (error.code == 102 || error.code == 101) { return true }
		return false
	}

	func noteDownloadStarted() {
		suppressRetryUntil = Date().addingTimeInterval(3)
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

	// ---------- popups ----------

	// window.open() must get a genuinely separate window. Loading it into the
	// main WebView instead looks like it works, but it navigates the POS app
	// away mid-sale — the exact failure DESIGN_DECISIONS.md:1417 records
	// ("open the invoice preview, press Back, the system immediately asks me
	// to create a new bill"), which the JS side deliberately stopped doing.
	// The popup reuses the configuration WebKit hands us, so it shares the
	// same cookie jar and stays logged in behind the PIN.
	func webView(
		_ webView: WKWebView,
		createWebViewWith configuration: WKWebViewConfiguration,
		for navigationAction: WKNavigationAction,
		windowFeatures: WKWindowFeatures
	) -> WKWebView? {
		let frame = NSRect(x: 0, y: 0, width: 1000, height: 700)
		let popup = WKWebView(frame: frame, configuration: configuration)
		popup.navigationDelegate = self
		popup.uiDelegate = self
		popup.autoresizingMask = [.width, .height]

		let popupWindow = NSWindow(
			contentRect: frame,
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered,
			defer: false
		)
		popupWindow.title = "Santu Hardware"
		// Defaults to true for hand-built windows, a pre-ARC convention: AppKit
		// would release the window on close on top of ARC releasing our own
		// reference, and the double release segfaulted the app mid-animation.
		popupWindow.isReleasedWhenClosed = false
		popupWindow.contentView = popup
		popupWindow.center()
		popupWindow.makeKeyAndOrderFront(nil)

		popupWindows[ObjectIdentifier(popup)] = popupWindow
		return popup
	}

	func webViewDidClose(_ webView: WKWebView) {
		closePopup(webView)
	}

	// Deferred: these calls arrive from inside WebKit delegate callbacks, and
	// tearing the window (and with it the WKWebView) down while WebKit is still
	// unwinding that call is asking for a use-after-free.
	func closePopup(_ webView: WKWebView) {
		let id = ObjectIdentifier(webView)
		popupsThatRendered.remove(id)
		guard let popupWindow = popupWindows.removeValue(forKey: id) else { return }
		DispatchQueue.main.async { popupWindow.close() }
	}

	// A window.open() whose target turns out to be a PDF/CSV leaves its popup
	// stranded as an empty white window — the download goes to disk and nothing
	// ever paints. Emptiness can't be read off `url`, which WebKit has already
	// pointed at the request by the time the download decision lands; what
	// distinguishes these is that the popup never finished a navigation.
	func closePopupIfNothingRendered(_ webView: WKWebView) {
		let id = ObjectIdentifier(webView)
		guard popupWindows[id] != nil, !popupsThatRendered.contains(id) else { return }
		closePopup(webView)
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		popupsThatRendered.insert(ObjectIdentifier(webView))
	}

	// ---------- file upload ----------

	// WKWebView has no built-in file picker: a bare <input type="file"> click
	// does nothing unless the app supplies one via WKUIDelegate. Frappe's
	// attach/image-upload dialogs rely on this.
	func webView(
		_ webView: WKWebView,
		runOpenPanelWith parameters: WKOpenPanelParameters,
		initiatedByFrame frame: WKFrameInfo,
		completionHandler: @escaping ([URL]?) -> Void
	) {
		let panel = NSOpenPanel()
		panel.allowsMultipleSelection = parameters.allowsMultipleSelection
		panel.canChooseDirectories = parameters.allowsDirectories
		panel.canChooseFiles = true
		// Sheet, not a free-floating panel: on the shop's single always-on
		// screen a detached picker can end up behind the app window with no
		// obvious way back to it.
		let parent = frame.webView?.window ?? window
		if let parent = parent {
			panel.beginSheetModal(for: parent) { response in
				completionHandler(response == .OK ? panel.urls : nil)
			}
		} else {
			panel.begin { response in
				completionHandler(response == .OK ? panel.urls : nil)
			}
		}
	}

	// ---------- downloads ----------

	// The shop's own Save-PDF path (post_sale_popup.js) builds a Blob and
	// clicks a synthetic `<a download>`. WKWebView does not treat that as a
	// download on its own — without returning .download here it tries to
	// NAVIGATE the main frame to the blob: URL, fails, and our retry handler
	// then bounced the whole app back to the unlock screen on a loop.
	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationAction: WKNavigationAction,
		decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
	) {
		if navigationAction.shouldPerformDownload {
			noteDownloadStarted()
			decisionHandler(.download)
		} else {
			decisionHandler(.allow)
		}
	}

	// Print formats (PDF), backups, and CSV exports arrive as a download
	// response rather than a normal page navigation — without opting into
	// WKDownload here, WKWebView just shows a blank/failed load for them.
	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationResponse: WKNavigationResponse,
		decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
	) {
		if navigationResponse.canShowMIMEType && !navigationResponse.isForMainFrame {
			decisionHandler(.allow)
			return
		}
		let isAttachment = (navigationResponse.response as? HTTPURLResponse)?
			.value(forHTTPHeaderField: "Content-Disposition")?
			.localizedCaseInsensitiveContains("attachment") ?? false
		// Anything WebKit can render is rendered, unless the server explicitly
		// marked it as an attachment. Only genuinely unrenderable content falls
		// through to a download — an earlier version keyed this off the response
		// being an HTTPURLResponse, which quietly downloaded blob:/data: pages.
		if navigationResponse.canShowMIMEType && !isAttachment {
			decisionHandler(.allow)
		} else {
			noteDownloadStarted()
			decisionHandler(.download)
		}
	}

	func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
		download.delegate = self
		closePopupIfNothingRendered(webView)
	}

	func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
		download.delegate = self
		closePopupIfNothingRendered(webView)
	}

	func download(
		_ download: WKDownload,
		decideDestinationUsing response: URLResponse,
		suggestedFilename: String,
		completionHandler: @escaping (URL?) -> Void
	) {
		let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
		// base/ext come from the ORIGINAL name, never from the candidate being
		// tested — deriving them inside the loop made each attempt build on the
		// last one's suffix ("bill (1) (2).pdf" instead of "bill (2).pdf"), so
		// names grew a new "(n)" on every re-download of the same bill.
		let originalName = suggestedFilename.isEmpty ? "download" : suggestedFilename
		let base = (originalName as NSString).deletingPathExtension
		let ext = (originalName as NSString).pathExtension
		var destination = downloadsDir.appendingPathComponent(originalName)
		var counter = 1
		while FileManager.default.fileExists(atPath: destination.path) {
			let candidate = ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)"
			destination = downloadsDir.appendingPathComponent(candidate)
			counter += 1
		}
		downloadDestinations[ObjectIdentifier(download)] = destination
		completionHandler(destination)
	}

	// A silent save is indistinguishable from a failed one at the counter, so
	// show the finished file in Finder — the shop needs to see the bill PDF
	// actually landed somewhere it can be printed or shared from.
	func downloadDidFinish(_ download: WKDownload) {
		guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
		NSWorkspace.shared.activateFileViewerSelecting([url])
	}

	func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
		downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
		let alert = NSAlert()
		alert.messageText = "Download fail ho gaya"
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
