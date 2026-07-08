import XCTest
@testable import AdjutantUI

/// Tests for the foundational Bridge session state machine (adj-207.1.1 / T001).
///
/// `BridgeSession` is the SINGLE owner of the avatar stream. Its lifecycle
/// (idle → connecting → live → backgrounded → closed) drives every surface the
/// avatar can occupy. These tests pin the three load-bearing invariants:
///   1. Legal transitions advance state and emit the right surface effects.
///   2. Single-instance guard — opening while already active is a no-op that
///      focuses the existing session (never a second `prepare`).
///   3. Close tears the surface down EXACTLY ONCE, from any active state, and is
///      idempotent thereafter.
///
/// The surface (a WKWebView in Phase A) is behind the `BridgeSurface` protocol
/// seam so the state logic is unit-testable without a real webview.
@MainActor
final class BridgeSessionTests: XCTestCase {

    // MARK: - Test double

    /// Records every effect the session applies so tests can assert call counts
    /// and ordering without a real WKWebView.
    private final class SpyBridgeSurface: BridgeSurface {
        private(set) var prepareCount = 0
        private(set) var showCount = 0
        private(set) var hideCount = 0
        private(set) var teardownCount = 0
        private(set) var log: [String] = []

        func prepare() { prepareCount += 1; log.append("prepare") }
        func show() { showCount += 1; log.append("show") }
        func hide() { hideCount += 1; log.append("hide") }
        func teardown() { teardownCount += 1; log.append("teardown") }
    }

    private func makeSession() -> (BridgeSession, SpyBridgeSurface) {
        let surface = SpyBridgeSurface()
        return (BridgeSession(surface: surface), surface)
    }

    // MARK: - Initial state

    func testInitialStateIsIdle() {
        let (session, surface) = makeSession()
        XCTAssertEqual(session.state, .idle)
        XCTAssertFalse(session.isActive)
        XCTAssertEqual(surface.prepareCount, 0)
    }

    // MARK: - Legal transitions

    func testOpenFromIdleConnectsAndPreparesSurfaceOnce() {
        let (session, surface) = makeSession()
        session.open()
        XCTAssertEqual(session.state, .connecting)
        XCTAssertTrue(session.isActive)
        XCTAssertEqual(surface.prepareCount, 1)
    }

    func testMarkConnectedGoesLiveAndShowsSurface() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        XCTAssertEqual(session.state, .live)
        XCTAssertEqual(surface.showCount, 1)
    }

    func testFullLifecycleTransitions() {
        let (session, _) = makeSession()
        XCTAssertEqual(session.state, .idle)
        session.open()
        XCTAssertEqual(session.state, .connecting)
        session.markConnected()
        XCTAssertEqual(session.state, .live)
        session.enterBackground()
        XCTAssertEqual(session.state, .backgrounded)
        session.enterForeground()
        XCTAssertEqual(session.state, .live)
        session.close()
        XCTAssertEqual(session.state, .closed)
    }

    func testBackgroundThenForegroundRestoresLiveWithoutSurfaceTeardown() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()
        session.enterForeground()
        XCTAssertEqual(session.state, .live)
        // Backgrounding must NOT tear the stream down — continuity is the point.
        XCTAssertEqual(surface.teardownCount, 0)
    }

    // MARK: - Single-instance guard

    func testOpenWhileLiveIsNoOpAndFocusesExisting() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        XCTAssertEqual(surface.prepareCount, 1)

        session.open() // second open while live
        XCTAssertEqual(session.state, .live, "state must not change")
        XCTAssertEqual(surface.prepareCount, 1, "must NOT prepare a second surface")
        XCTAssertEqual(session.focusRequestCount, 1, "must record a focus request instead")
    }

    func testOpenWhileConnectingIsNoOpFocus() {
        let (session, surface) = makeSession()
        session.open()
        session.open()
        XCTAssertEqual(session.state, .connecting)
        XCTAssertEqual(surface.prepareCount, 1)
        XCTAssertEqual(session.focusRequestCount, 1)
    }

    func testOpenWhileBackgroundedIsNoOpFocus() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()
        session.open()
        XCTAssertEqual(session.state, .backgrounded)
        XCTAssertEqual(surface.prepareCount, 1)
        XCTAssertEqual(session.focusRequestCount, 1)
    }

    // MARK: - Close tears down exactly once

    func testCloseFromLiveTearsDownExactlyOnce() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.close()
        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(surface.teardownCount, 1)
        XCTAssertFalse(session.isActive)
    }

    func testCloseIsIdempotent() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.close()
        session.close()
        session.close()
        XCTAssertEqual(surface.teardownCount, 1, "teardown must fire exactly once")
    }

    func testCloseFromConnectingTearsDownOnce() {
        let (session, surface) = makeSession()
        session.open()
        session.close()
        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(surface.teardownCount, 1)
    }

    func testCloseFromBackgroundedTearsDownOnce() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()
        session.close()
        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(surface.teardownCount, 1)
    }

    func testCloseFromIdleIsNoOpAndNeverTearsDown() {
        let (session, surface) = makeSession()
        session.close()
        XCTAssertEqual(session.state, .idle)
        XCTAssertEqual(surface.teardownCount, 0)
    }

    // MARK: - Re-open reuses the machine

    func testReopenAfterCloseConnectsAgain() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.close()
        XCTAssertEqual(session.state, .closed)

        session.open() // re-open a fresh session after close
        XCTAssertEqual(session.state, .connecting)
        XCTAssertEqual(surface.prepareCount, 2, "re-open prepares the surface again")
    }

    // MARK: - Illegal transitions are ignored

    func testMarkConnectedFromIdleIsIgnored() {
        let (session, surface) = makeSession()
        session.markConnected()
        XCTAssertEqual(session.state, .idle)
        XCTAssertEqual(surface.showCount, 0)
    }

    func testEnterBackgroundFromConnectingIsIgnored() {
        let (session, _) = makeSession()
        session.open()
        session.enterBackground()
        XCTAssertEqual(session.state, .connecting, "cannot background before live")
    }

    func testEnterForegroundFromLiveIsIgnored() {
        let (session, _) = makeSession()
        session.open()
        session.markConnected()
        session.enterForeground()
        XCTAssertEqual(session.state, .live)
    }

    // MARK: - Show / hide route through the session (no lifecycle change)

    func testShowHideWhileLiveToggleSurfaceWithoutStateChange() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        let showsAfterConnect = surface.showCount
        session.hide()
        XCTAssertEqual(session.state, .live, "hide must not change state")
        XCTAssertEqual(surface.hideCount, 1)
        session.show()
        XCTAssertEqual(session.state, .live)
        XCTAssertEqual(surface.showCount, showsAfterConnect + 1)
        XCTAssertEqual(surface.teardownCount, 0, "visibility never tears down")
    }

    func testHideWhileConnectingIsIgnored() {
        let (session, surface) = makeSession()
        session.open()
        session.hide()
        XCTAssertEqual(session.state, .connecting)
        XCTAssertEqual(surface.hideCount, 0, "no surface to hide before live")
    }

    func testShowHideWhileBackgroundedTogglesSurface() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()
        session.hide()
        XCTAssertEqual(session.state, .backgrounded)
        XCTAssertEqual(surface.hideCount, 1)
    }

    // MARK: - Pure reducer (state/logic separate from the surface)

    func testReducerOpenFromIdlePreparesSurface() {
        let result = BridgeSessionReducer.reduce(.idle, .open)
        XCTAssertEqual(result.state, .connecting)
        XCTAssertEqual(result.effects, [.prepareSurface])
    }

    func testReducerOpenWhileLiveFocuses() {
        let result = BridgeSessionReducer.reduce(.live, .open)
        XCTAssertEqual(result.state, .live)
        XCTAssertEqual(result.effects, [.focusExisting])
    }

    func testReducerCloseFromLiveTearsDown() {
        let result = BridgeSessionReducer.reduce(.live, .close)
        XCTAssertEqual(result.state, .closed)
        XCTAssertEqual(result.effects, [.teardownSurface])
    }

    func testReducerCloseFromIdleIsInert() {
        let result = BridgeSessionReducer.reduce(.idle, .close)
        XCTAssertEqual(result.state, .idle)
        XCTAssertTrue(result.effects.isEmpty)
    }

    func testReducerConnectedFromIdleIsInert() {
        let result = BridgeSessionReducer.reduce(.idle, .connected)
        XCTAssertEqual(result.state, .idle)
        XCTAssertTrue(result.effects.isEmpty)
    }
}
