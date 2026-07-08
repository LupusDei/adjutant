import XCTest
@testable import AdjutantUI

/// Tests for the system PiP controller wrapper (adj-207.4.4 / T011).
///
/// `BridgePiPController` wraps `AVPictureInPictureController` over the native avatar's
/// sample-buffer layer. These tests pin the three invariants against a spy AVKit seam:
///   1. Possibility gating — `start` is a no-op unless PiP is possible.
///   2. Single-window guard — `start` while active is a no-op (never a 2nd PiP window).
///   3. OS-driven state — `state`/callbacks track the async did-start/did-stop events.
@MainActor
final class BridgePiPControllerTests: XCTestCase {

    // MARK: - Spy seam

    private final class SpyPiP: PictureInPictureControlling {
        var isPictureInPicturePossible = true
        var isPictureInPictureActive = false

        var onDidStart: (() -> Void)?
        var onDidStop: (() -> Void)?
        var onFailedToStart: ((Error) -> Void)?
        var onPossibleChanged: (() -> Void)?

        private(set) var startCount = 0
        private(set) var stopCount = 0

        func startPictureInPicture() { startCount += 1 }
        func stopPictureInPicture() { stopCount += 1 }

        // Drive the OS-side transitions.
        func fireDidStart() { isPictureInPictureActive = true; onDidStart?() }
        func fireDidStop() { isPictureInPictureActive = false; onDidStop?() }
        func fireFailed(_ error: Error) { onFailedToStart?(error) }
        /// Simulate PiP becoming possible (frames flowing / layer on screen).
        func becomePossible() { isPictureInPicturePossible = true; onPossibleChanged?() }
    }

    private struct TestError: Error {}

    // MARK: - Start gating

    func testStartRequestsPiPWhenPossible() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)

        let started = controller.start()

        XCTAssertTrue(started)
        XCTAssertEqual(spy.startCount, 1)
    }

    func testStartIsNoOpWhenNotPossible() {
        let spy = SpyPiP()
        spy.isPictureInPicturePossible = false
        let controller = BridgePiPController(controller: spy)

        let started = controller.start()

        XCTAssertFalse(started)
        XCTAssertEqual(spy.startCount, 0)
    }

    func testStartIsNoOpWhenAlreadyActive() {
        let spy = SpyPiP()
        spy.isPictureInPictureActive = true
        let controller = BridgePiPController(controller: spy)

        let started = controller.start()

        XCTAssertFalse(started, "entering PiP while already in PiP must be a no-op")
        XCTAssertEqual(spy.startCount, 0)
    }

    func testStartIsNoOpWhenPiPUnsupported() {
        // nil controller = device without PiP support.
        let controller = BridgePiPController(controller: nil)

        let started = controller.start()

        XCTAssertFalse(started)
        XCTAssertFalse(controller.isPiPPossible)
        XCTAssertFalse(controller.isPiPActive)
    }

    // MARK: - Stop gating

    func testStopIsNoOpWhenNotActive() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)

        controller.stop()

        XCTAssertEqual(spy.stopCount, 0)
    }

    func testStopRequestsExitWhenActive() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)
        spy.fireDidStart() // now active

        controller.stop()

        XCTAssertEqual(spy.stopCount, 1)
    }

    // MARK: - OS-driven state + callbacks

    func testDidStartMovesToActiveAndFiresCallback() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)
        var started = false
        controller.onDidStart = { started = true }

        spy.fireDidStart()

        XCTAssertEqual(controller.state, .active)
        XCTAssertTrue(controller.isPiPActive)
        XCTAssertTrue(started)
    }

    func testDidStopMovesToInactiveAndFiresCallback() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)
        var stopped = false
        controller.onDidStop = { stopped = true }

        spy.fireDidStart()
        spy.fireDidStop()

        XCTAssertEqual(controller.state, .inactive)
        XCTAssertFalse(controller.isPiPActive)
        XCTAssertTrue(stopped)
    }

    func testFailedToStartResetsStateAndFiresCallback() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)
        var failed = false
        controller.onFailedToStart = { _ in failed = true }

        _ = controller.start()
        spy.fireFailed(TestError())

        XCTAssertEqual(controller.state, .inactive)
        XCTAssertTrue(failed)
    }

    // MARK: - Start-when-possible (adj-207.5.3)

    func testStartDefersWhenNotYetPossibleThenFiresWhenPossible() {
        let spy = SpyPiP()
        spy.isPictureInPicturePossible = false // frames not flowing yet
        let controller = BridgePiPController(controller: spy)

        let started = controller.start()

        // Not started NOW, but the intent is remembered — NOT a silent no-op.
        XCTAssertFalse(started)
        XCTAssertEqual(spy.startCount, 0)
        XCTAssertTrue(controller.isStartPending)

        // Frames flow → PiP becomes possible → the deferred start fires automatically.
        spy.becomePossible()
        XCTAssertEqual(spy.startCount, 1)
        XCTAssertFalse(controller.isStartPending)
    }

    func testPossibleChangeWithoutPendingStartDoesNothing() {
        let spy = SpyPiP()
        let controller = BridgePiPController(controller: spy)

        spy.becomePossible() // no start was requested

        XCTAssertEqual(spy.startCount, 0)
        XCTAssertFalse(controller.isStartPending)
    }

    func testCancelPendingStartStopsDeferredStart() {
        let spy = SpyPiP()
        spy.isPictureInPicturePossible = false
        let controller = BridgePiPController(controller: spy)

        _ = controller.start()          // pending
        XCTAssertTrue(controller.isStartPending)
        controller.cancelPendingStart()
        spy.becomePossible()            // must NOT start after cancel

        XCTAssertEqual(spy.startCount, 0)
        XCTAssertFalse(controller.isStartPending)
    }

    func testStopClearsPendingStart() {
        let spy = SpyPiP()
        spy.isPictureInPicturePossible = false
        let controller = BridgePiPController(controller: spy)

        _ = controller.start()          // pending
        controller.stop()               // aborts the hand-off
        spy.isPictureInPicturePossible = true
        spy.becomePossible()

        XCTAssertEqual(spy.startCount, 0, "a stopped hand-off never auto-enters PiP later")
        XCTAssertFalse(controller.isStartPending)
    }
}
