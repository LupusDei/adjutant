import XCTest
import WebKit
@testable import AdjutantUI

/// Integration tests for the concrete WebKit engine (adj-207.1.5 / .1.6).
///
/// These exercise a REAL `WKWebView` on the simulator to pin two regressions:
///   1. navigation-finished fires `onReady` — the iOS go-live signal, since the
///      `/avatar` page emits no postMessage in default (non-iframe) mode (.1.5).
///   2. the `bridgeOpenSettings` script-message handler is registered on the
///      webview's LIVE configuration — a real in-page `postMessage` round-trips to
///      the injected action. Registering on the original (pre-init) config, as
///      before, would silently drop the message and this test would time out (.1.6).
///
/// The engine view is hosted in a real key window: an OFFSCREEN `WKWebView` gets
/// navigation-throttled, which made the go-live assertion flaky under full-suite
/// parallel load. Waits use a generous timeout for the same reason.
@MainActor
final class WKAvatarWebEngineTests: XCTestCase {

    /// Generous — real webview navigation can be slow under heavy parallel test load.
    private let asyncTimeout: TimeInterval = 30

    private func dataURL(html: String) -> URL {
        let b64 = Data(html.utf8).base64EncodedString()
        return URL(string: "data:text/html;base64,\(b64)")!
    }

    /// Host the engine's view in a visible window so its `WKWebView` is not
    /// throttled as an offscreen view (which delays navigation callbacks).
    private func hostInWindow(_ engine: WKAvatarWebEngine) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        engine.hostView.frame = window.bounds
        window.addSubview(engine.hostView)
        window.isHidden = false
        window.makeKeyAndVisible()
        return window
    }

    func testNavigationFinishedFiresOnReady() {
        let engine = WKAvatarWebEngine()
        let window = hostInWindow(engine)
        let ready = expectation(description: "onReady fires on navigation-finished")
        engine.onReady = { ready.fulfill() }

        engine.load(dataURL(html: "<html><body>ok</body></html>"))

        wait(for: [ready], timeout: asyncTimeout)
        engine.teardown()
        window.isHidden = true
    }

    func testOpenSettingsScriptMessageRoundTripsToInjectedAction() {
        // If the handler were registered on the ORIGINAL config (the .1.6 bug),
        // `window.webkit.messageHandlers.bridgeOpenSettings` would be undefined and
        // this action would never fire → timeout.
        let opened = expectation(description: "injected open-settings action fires from a real script message")
        let engine = WKAvatarWebEngine(onOpenSettings: { opened.fulfill() })
        let window = hostInWindow(engine)

        let html = """
        <html><body><script>
        window.webkit.messageHandlers.bridgeOpenSettings.postMessage('open');
        </script></body></html>
        """
        engine.load(dataURL(html: html))

        wait(for: [opened], timeout: asyncTimeout)
        engine.teardown()
        window.isHidden = true
    }

    func testTeardownRemovesTheWebViewAndIsIdempotent() {
        let engine = WKAvatarWebEngine()
        XCTAssertFalse(engine.hostView.subviews.isEmpty, "webview embedded before teardown")
        engine.teardown()
        XCTAssertTrue(engine.hostView.subviews.isEmpty, "webview detached on teardown")
        engine.teardown() // must not crash (symmetric handler removal)
    }
}
