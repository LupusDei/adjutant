import XCTest
import WebKit
@testable import AdjutantUI

/// Tests for the concrete WebKit engine (adj-207.1.5 / .1.6 / .1.10).
///
/// Two layers so the logic is ALWAYS covered, even where a real webview can't run:
///
///   • Seam tests (always run, no navigation): call the `WKNavigationDelegate` /
///     script-message routing directly to prove the wiring
///     (didFinish→onReady, didFail→onFailure, message-name→action). These need no
///     rendering host, so they are deterministic in a headless CI simulator.
///
///   • Integration tests (real `WKWebView`, suffixed `_Integration`): drive a
///     SELF-CONTAINED page via `loadHTMLString` (no network) hosted in a real key
///     window, to additionally prove the end-to-end (nav actually fires, and — the
///     load-bearing .1.6 assertion — that the script handler is registered on the
///     LIVE config). A headless CI simulator can't reliably run WKWebView
///     navigation/JS, and the host `CI` env var does NOT propagate into the
///     simulator test process (so a runtime `XCTSkip` can't detect CI). They are
///     therefore skipped in CI DETERMINISTICALLY via `-skip-testing:` flags in
///     `.github/workflows/ios-tests.yml`, and run locally / on a rendering host.
///     The seam tests keep the logic covered everywhere (adj-207.1.10).
@MainActor
final class WKAvatarWebEngineTests: XCTestCase {

    /// Generous — real webview navigation can be slow under heavy parallel load.
    private let asyncTimeout: TimeInterval = 30

    /// Host the engine's view in a visible key window so its `WKWebView` is not
    /// throttled as an offscreen view (which delays navigation callbacks).
    private func hostInWindow(_ engine: WKAvatarWebEngine) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        engine.hostView.frame = window.bounds
        window.addSubview(engine.hostView)
        window.isHidden = false
        window.makeKeyAndVisible()
        return window
    }

    // MARK: - Seam tests (no real navigation — always run, CI-deterministic)

    func testDidFinishDelegateFiresOnReady() {
        let engine = WKAvatarWebEngine()
        var readyCount = 0
        engine.onReady = { readyCount += 1 }

        // Drive the navigation delegate directly — proves the go-live wiring
        // (adj-207.1.5) without a real navigation.
        engine.webView(WKWebView(), didFinish: nil)

        XCTAssertEqual(readyCount, 1, "didFinish must fire onReady")
    }

    func testDidFailDelegateFiresOnFailure() {
        let engine = WKAvatarWebEngine()
        var failureCount = 0
        engine.onFailure = { failureCount += 1 }

        let error = NSError(domain: "test", code: -1)
        engine.webView(WKWebView(), didFail: nil, withError: error)

        XCTAssertEqual(failureCount, 1, "didFail must fire onFailure (adj-207.1.8)")
    }

    func testDidFailProvisionalDelegateFiresOnFailure() {
        let engine = WKAvatarWebEngine()
        var failureCount = 0
        engine.onFailure = { failureCount += 1 }

        let error = NSError(domain: "test", code: -1005) // NSURLErrorNetworkConnectionLost-ish
        engine.webView(WKWebView(), didFailProvisionalNavigation: nil, withError: error)

        XCTAssertEqual(failureCount, 1, "didFailProvisionalNavigation must fire onFailure")
    }

    func testReceiveOpenSettingsMessageFiresInjectedAction() {
        var opened = 0
        let engine = WKAvatarWebEngine(onOpenSettings: { opened += 1 })

        // Route the message by name — proves the handler→action mapping (adj-207.1.6)
        // without constructing a WKScriptMessage (which has no public init).
        engine.receiveScriptMessage(named: "bridgeOpenSettings")

        XCTAssertEqual(opened, 1, "the bridgeOpenSettings message must invoke the open-settings action")
    }

    func testReceiveUnknownMessageDoesNothing() {
        var opened = 0
        let engine = WKAvatarWebEngine(onOpenSettings: { opened += 1 })

        engine.receiveScriptMessage(named: "somethingElse")

        XCTAssertEqual(opened, 0, "unknown message names must be ignored")
    }

    func testTeardownRemovesTheWebViewAndIsIdempotent() {
        let engine = WKAvatarWebEngine()
        XCTAssertFalse(engine.hostView.subviews.isEmpty, "webview embedded before teardown")
        engine.teardown()
        XCTAssertTrue(engine.hostView.subviews.isEmpty, "webview detached on teardown")
        engine.teardown() // must not crash (symmetric handler removal)
    }

    // MARK: - Integration tests (real WKWebView)
    // Skipped in CI via `-skip-testing:` in .github/workflows/ios-tests.yml (a
    // headless CI sim can't reliably drive WKWebView nav/JS and `CI` doesn't reach
    // the sim process). Run locally / on a rendering host. Logic covered by the
    // seam tests above regardless.

    func testNavigationFinishedFiresOnReady_Integration() {
        let engine = WKAvatarWebEngine()
        let window = hostInWindow(engine)
        let ready = expectation(description: "onReady fires on real navigation-finished")
        engine.onReady = { ready.fulfill() }

        engine.loadHTMLString("<html><body>ok</body></html>", baseURL: URL(string: "http://localhost/"))

        wait(for: [ready], timeout: asyncTimeout)
        engine.teardown()
        window.isHidden = true
    }

    func testOpenSettingsScriptMessageRoundTripsToInjectedAction_Integration() {
        // End-to-end proof that the handler is registered on the LIVE config
        // (adj-207.1.6): if it were on the original (pre-copy) config,
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
        engine.loadHTMLString(html, baseURL: URL(string: "http://localhost/"))

        wait(for: [opened], timeout: asyncTimeout)
        engine.teardown()
        window.isHidden = true
    }
}
