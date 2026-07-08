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
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?

        func prepare() { prepareCount += 1; log.append("prepare") }
        func show() { showCount += 1; log.append("show") }
        func hide() { hideCount += 1; log.append("hide") }
        func teardown() { teardownCount += 1; log.append("teardown") }

        /// Simulate the surface finishing its load / failing (drives the session's
        /// wired go-live / failure handlers).
        func fireReady() { onReady?() }
        func fireFailure() { onFailure?() }
    }

    /// Manually-triggered connect watchdog so timeout→failed is testable with no
    /// wall-clock wait (adj-207.1.8).
    private final class ManualConnectTimeout: BridgeConnectTimeout {
        private(set) var startCount = 0
        private(set) var cancelCount = 0
        private var pending: (() -> Void)?
        var isArmed: Bool { pending != nil }

        func start(_ onTimeout: @escaping () -> Void) { startCount += 1; pending = onTimeout }
        func cancel() { cancelCount += 1; pending = nil }
        /// Fire the pending timeout (no-op if disarmed).
        func fire() { pending?() }
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

    // MARK: - Surface-ready wiring drives go-live (adj-207.1.5)

    func testSurfaceReadyEventTransitionsSessionToLive() {
        let (session, surface) = makeSession()
        session.open()
        XCTAssertEqual(session.state, .connecting)
        // The session must have wired the surface's ready signal to markConnected.
        surface.fireReady()
        XCTAssertEqual(session.state, .live, "surface ready must drive connecting→live")
        XCTAssertEqual(surface.showCount, 1)
    }

    func testSurfaceReadyBeforeOpenIsInert() {
        let (session, surface) = makeSession()
        surface.fireReady() // no connect in flight
        XCTAssertEqual(session.state, .idle)
    }

    func testSurfaceFailureEventTransitionsSessionToFailed() {
        let (session, surface) = makeSession()
        session.open()
        surface.fireFailure()
        XCTAssertEqual(session.state, .failed, "surface load-failure must drive connecting→failed")
        XCTAssertEqual(surface.teardownCount, 1, "failed surface is torn down for a clean retry")
        XCTAssertFalse(session.isActive)
    }

    // MARK: - Failure / retry / timeout (adj-207.1.8)

    func testMarkFailedFromLiveGoesFailedAndTearsDown() {
        let (session, surface) = makeSession()
        session.open()
        session.markConnected()
        session.markFailed()
        XCTAssertEqual(session.state, .failed)
        XCTAssertEqual(surface.teardownCount, 1)
    }

    func testRetryFromFailedReconnects() {
        let (session, surface) = makeSession()
        session.open()
        surface.fireFailure()
        XCTAssertEqual(session.state, .failed)
        session.retry()
        XCTAssertEqual(session.state, .connecting)
        XCTAssertEqual(surface.prepareCount, 2, "retry re-provisions the surface")
    }

    func testOpenFromFailedAlsoReconnects() {
        let (session, _) = makeSession()
        session.open()
        session.markFailed()
        session.open()
        XCTAssertEqual(session.state, .connecting)
    }

    func testCloseFromFailedGoesClosedWithoutDoubleTeardown() {
        let (session, surface) = makeSession()
        session.open()
        session.markFailed()
        XCTAssertEqual(surface.teardownCount, 1)
        session.close()
        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(surface.teardownCount, 1, "surface already torn down on failure — no second teardown")
    }

    func testMarkFailedFromIdleIsInert() {
        let (session, surface) = makeSession()
        session.markFailed()
        XCTAssertEqual(session.state, .idle)
        XCTAssertEqual(surface.teardownCount, 0)
    }

    func testConnectTimeoutFiresFailedWhenConnectStalls() {
        let surface = SpyBridgeSurface()
        let timeout = ManualConnectTimeout()
        let session = BridgeSession(surface: surface, connectTimeout: timeout)
        session.open()
        XCTAssertEqual(session.state, .connecting)
        XCTAssertTrue(timeout.isArmed, "watchdog armed on connecting")
        timeout.fire() // connect never completed
        XCTAssertEqual(session.state, .failed, "timeout must fail a stalled connect")
        XCTAssertEqual(surface.teardownCount, 1)
    }

    func testConnectTimeoutCancelledOnGoLive() {
        let surface = SpyBridgeSurface()
        let timeout = ManualConnectTimeout()
        let session = BridgeSession(surface: surface, connectTimeout: timeout)
        session.open()
        session.markConnected()
        XCTAssertEqual(session.state, .live)
        XCTAssertEqual(timeout.cancelCount, 1, "watchdog cancelled once live")
        timeout.fire() // stale fire after cancel — should be a no-op (disarmed)
        XCTAssertEqual(session.state, .live, "a cancelled watchdog must not fail a live session")
    }

    func testConnectTimeoutRearmedOnRetry() {
        let surface = SpyBridgeSurface()
        let timeout = ManualConnectTimeout()
        let session = BridgeSession(surface: surface, connectTimeout: timeout)
        session.open()
        timeout.fire()                      // → failed
        XCTAssertEqual(session.state, .failed)
        session.retry()                     // → connecting again
        XCTAssertEqual(session.state, .connecting)
        XCTAssertEqual(timeout.startCount, 2, "watchdog re-armed on retry")
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

    func testReducerFailedFromConnectingTearsDown() {
        let result = BridgeSessionReducer.reduce(.connecting, .failed)
        XCTAssertEqual(result.state, .failed)
        XCTAssertEqual(result.effects, [.teardownSurface])
    }

    func testReducerRetryFromFailedPreparesSurface() {
        let result = BridgeSessionReducer.reduce(.failed, .retry)
        XCTAssertEqual(result.state, .connecting)
        XCTAssertEqual(result.effects, [.prepareSurface])
    }

    func testReducerCloseFromFailedIsInertTeardown() {
        let result = BridgeSessionReducer.reduce(.failed, .close)
        XCTAssertEqual(result.state, .closed)
        XCTAssertTrue(result.effects.isEmpty, "surface already torn down on failure")
    }
}
