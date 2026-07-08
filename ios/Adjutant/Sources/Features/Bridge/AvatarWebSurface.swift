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
@MainActor
protocol AvatarWebEngine: AnyObject {
    func load(_ url: URL)
    func setHidden(_ hidden: Bool)
    func teardown()
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
/// `bridgeOpenSettings` → iOS Settings bridge were moved here from the old
/// `AvatarOverlayView.AvatarWebView` (adj-202.5.4) so the surface — not a
/// transient SwiftUI view — owns the webview and its coordinator.
@MainActor
final class WKAvatarWebEngine: NSObject, AvatarWebEngine {
    /// Container the webview is embedded into; this is what the SwiftUI
    /// representable hosts, so the webview itself is never re-parented on remount.
    let hostView: UIView
    private let webView: WKWebView

    override init() {
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
        super.init()

        // Bridge the page's permission banner (adj-202.5.4) to the OS Settings app.
        config.userContentController.add(self, name: Self.openSettingsHandler)
        webView.uiDelegate = self

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

    func teardown() {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.openSettingsHandler)
        webView.uiDelegate = nil
        webView.removeFromSuperview()
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
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        Task { @MainActor in
            UIApplication.shared.open(url)
        }
    }
}
