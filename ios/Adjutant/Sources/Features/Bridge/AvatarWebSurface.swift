import Foundation
import UIKit
import WebKit

// MARK: - Web engine seam

/// The WebKit dependency of the Phase-A avatar surface, behind a protocol so the
/// create-once / reuse contract can be unit-tested without a real `WKWebView` or
/// network. `BridgeWebSurface` owns exactly one of these for the life of a
/// session and never rebuilds it across hide/show.
///
/// Contract:
///   - `load(_:)` connects the page (Runway/LiveKit session) — called ONCE per engine.
///   - `setHidden(_:)` toggles visibility WITHOUT reloading or reconnecting.
///   - `teardown()` stops loading and detaches — called once when the session closes.
///   - `onReady` fires when the page finishes loading (navigation-finished) —
///     the go-live signal for iOS, since the `/avatar` page emits NO postMessage
///     in default (non-iframe) mode (adj-207.1.5).
///   - `onFailure` fires when the load fails (navigation-failed) (adj-207.1.8).
@MainActor
protocol AvatarWebEngine: AnyObject {
    func load(_ url: URL)
    func setHidden(_ hidden: Bool)
    /// Enable/disable the page microphone by mirroring the web chrome's
    /// `bridge:mic` command to the `/avatar` page (adj-207.2.10). `enabled: false`
    /// mutes — this is what makes the floating-window Mute button ACTUALLY mute
    /// instead of a privacy no-op.
    func setMicEnabled(_ enabled: Bool)
    func teardown()
    var onReady: (() -> Void)? { get set }
    var onFailure: (() -> Void)? { get set }
}

// MARK: - Reusable surface

/// The session-owned, reusable avatar surface (adj-207.1.3).
///
/// Owns a single `AvatarWebEngine` created lazily on `prepare()` and reused
/// across every `show()`/`hide()`. Because the `BridgeSession` (and, from
/// adj-207.1.2, the app-root host) retains this object, the underlying webview
/// survives SwiftUI navigation — no per-screen reload, no Runway re-provision.
///
/// Implements `BridgeSurface`, so `BridgeSession` drives it directly:
/// `open → prepare`, `markConnected → show`, `close → teardown`.
@MainActor
final class BridgeWebSurface: BridgeSurface {
    /// The avatar page URL (ORIGIN `/avatar`).
    let url: URL

    /// Injectable engine builder — real `WKAvatarWebEngine` in production, a spy
    /// in tests. Keeps WebKit out of the reuse-logic tests.
    private let engineFactory: () -> AvatarWebEngine

    /// The single live engine, or `nil` before `prepare()` / after `teardown()`.
    private(set) var engine: AvatarWebEngine?

    /// Last-applied visibility. Mirrors the engine and survives across show/hide.
    private(set) var isHidden: Bool = true

    /// Fired when the underlying engine finishes loading / fails — the session
    /// wires these to `markConnected()` / `markFailed()` (adj-207.1.5 / .1.8).
    var onReady: (() -> Void)?
    var onFailure: (() -> Void)?

    init(url: URL, engineFactory: @escaping () -> AvatarWebEngine) {
        self.url = url
        self.engineFactory = engineFactory
    }

    /// Production surface backed by a real `WKWebView` engine.
    static func makeDefault(url: URL) -> BridgeWebSurface {
        BridgeWebSurface(url: url, engineFactory: { WKAvatarWebEngine() })
    }

    /// The embeddable UIView for the live engine, if any — hosted by the SwiftUI
    /// `AvatarSurfaceView`. `nil` before prepare / after teardown, or for a
    /// non-WebKit engine. Kept off the `AvatarWebEngine` protocol so the reuse
    /// logic stays testable without UIKit views.
    var presentationView: UIView? {
        (engine as? WKAvatarWebEngine)?.hostView
    }

    // MARK: BridgeSurface

    /// Create + connect the engine EXACTLY once. Re-entrant calls are no-ops, so
    /// navigation churn (which can re-invoke prepare) never reloads the page.
    func prepare() {
        guard engine == nil else { return }
        let newEngine = engineFactory()
        // Forward the engine's load/fail signals up to the session (adj-207.1.5/.1.8).
        newEngine.onReady = { [weak self] in self?.onReady?() }
        newEngine.onFailure = { [weak self] in self?.onFailure?() }
        newEngine.load(url)
        newEngine.setHidden(isHidden)
        engine = newEngine
    }

    /// Reveal the existing surface. No reload, no reconnect. Safe before prepare.
    func show() {
        isHidden = false
        engine?.setHidden(false)
    }

    /// Conceal the existing surface without tearing it down. No reload.
    func hide() {
        isHidden = true
        engine?.setHidden(true)
    }

    /// Enable/disable the page mic (adj-207.2.10). Forwards to the live engine;
    /// a safe no-op before `prepare()` / after `teardown()`. The app-root host
    /// wires the floating-window Mute control to this so muting truly disables the
    /// mic on the `/avatar` page.
    func setMicEnabled(_ enabled: Bool) {
        engine?.setMicEnabled(enabled)
    }

    /// Destroy the engine and release the stream. Idempotent — a second call
    /// (e.g. a double close) does nothing.
    func teardown() {
        engine?.teardown()
        engine = nil
        isHidden = true
    }
}

// MARK: - WebKit engine (production)

/// The concrete Phase-A engine: a single reusable `WKWebView` configured for
/// real-time media (WebRTC mic/video) loading the Runway `/avatar` page.
///
/// The WebKit config, in-page capture-permission auto-grant, and the
/// `bridgeOpenSettings` → iOS Settings bridge live here (originally adj-202.5.4)
/// so the surface — not a transient SwiftUI view — owns the webview and its
/// coordinator. This is the SINGLE way the Bridge webview is created
/// (adj-207.1.7 removed the divergent `AvatarOverlayView` path).
@MainActor
final class WKAvatarWebEngine: NSObject, AvatarWebEngine {
    /// Container the webview is embedded into; this is what the SwiftUI
    /// representable hosts, so the webview itself is never re-parented on remount.
    let hostView: UIView
    private let webView: WKWebView

    /// Go-live / failure signals (adj-207.1.5 / .1.8), fired from the navigation
    /// delegate.
    var onReady: (() -> Void)?
    var onFailure: (() -> Void)?

    /// What to do when the page's permission banner asks to open iOS Settings —
    /// injectable so the script-message round-trip is testable without actually
    /// leaving the app (adj-207.1.6). Defaults to opening the real Settings app.
    private let openSettingsAction: () -> Void

    init(onOpenSettings: (() -> Void)? = nil) {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let container = UIView(frame: .zero)
        container.backgroundColor = .black
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false

        self.hostView = container
        self.webView = webView
        self.openSettingsAction = onOpenSettings ?? {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
        super.init()

        // Bridge the page's permission banner (adj-202.5.4) to the OS Settings app.
        // CRITICAL (adj-207.1.6): register on the webView's OWN configuration —
        // WKWebView COPIES the configuration at init, so a handler added to the
        // original `config` after `WKWebView(configuration:)` is silently dropped.
        webView.configuration.userContentController.add(self, name: Self.openSettingsHandler)
        webView.uiDelegate = self
        webView.navigationDelegate = self

        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])
    }

    private static let openSettingsHandler = "bridgeOpenSettings"

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    func setHidden(_ hidden: Bool) {
        hostView.isHidden = hidden
    }

    /// Mirror the web chrome's `bridge:mic` command to the `/avatar` page by
    /// dispatching the same same-origin window message the page listens for
    /// (see `backend/src/routes/avatar.ts`). The page toggles the LiveKit mic
    /// track only when the desired state differs, so this is idempotent
    /// (adj-207.2.10).
    func setMicEnabled(_ enabled: Bool) {
        let js = "window.postMessage({ type: 'bridge:mic', enabled: \(enabled ? "true" : "false") }, location.origin);"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func teardown() {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.openSettingsHandler)
        webView.uiDelegate = nil
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
    }

    /// Invoke the injected Open-Settings action. Internal so the round-trip test
    /// can assert it fires from a real script message (adj-207.1.6).
    func invokeOpenSettings() {
        openSettingsAction()
    }
}

// MARK: - WebKit delegates

extension WKAvatarWebEngine: WKUIDelegate, WKScriptMessageHandler {
    /// Auto-grant in-page mic/camera capture prompts (the page already lives
    /// behind a deliberate user action — opening The Bridge — and Info.plist
    /// carries the usage strings). This answers the WebKit-layer prompt only; the
    /// OS-level TCC alert is separate, and a denial surfaces in-page as a friendly
    /// banner (adj-202.5.4), not a raw error.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    /// Open the app's Settings page so the Commander can re-enable a denied
    /// camera/mic permission (adj-202.5.4).
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.openSettingsHandler else { return }
        invokeOpenSettings()
    }
}

// MARK: - Navigation (go-live + failure)

extension WKAvatarWebEngine: WKNavigationDelegate {
    /// The `/avatar` page finished loading. In iOS default mode the page emits no
    /// postMessage (its `post()` is iframe-only), so navigation-finished IS the
    /// go-live signal that drives `markConnected()` (adj-207.1.5).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onReady?()
    }

    /// The load failed after the response started — fail the session rather than
    /// hang on a black "connecting" screen (adj-207.1.8).
    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        onFailure?()
    }

    /// The provisional load failed (DNS/connection/unreachable origin) — the most
    /// common broken-`/avatar` case. Fail the session (adj-207.1.8).
    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        onFailure?()
    }
}
