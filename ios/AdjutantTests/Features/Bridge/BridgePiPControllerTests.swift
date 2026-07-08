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

        private(set) var startCount = 0
        private(set) var stopCount = 0

        func startPictureInPicture() { startCount += 1 }
        func stopPictureInPicture() { stopCount += 1 }

        // Drive the OS-side transitions.
        func fireDidStart() { isPictureInPictureActive = true; onDidStart?() }
        func fireDidStop() { isPictureInPictureActive = false; onDidStop?() }
        func fireFailed(_ error: Error) { onFailedToStart?(error) }
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
}
