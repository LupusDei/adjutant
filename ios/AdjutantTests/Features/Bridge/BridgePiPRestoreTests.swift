import SwiftUI
import XCTest
@testable import AdjutantUI

/// Tests for PiP → in-app restore + session/audio continuity (adj-207.5.2 / T014).
///
/// The load-bearing guarantee: hand-off NEVER drops the session or stops audio. The
/// coordinator is structurally incapable of it — its target seam exposes only
/// enter/exit-PiP + restore-window. These tests pin that:
///   1. Leaving PiP (foreground or OS-close) restores the in-app window.
///   2. The full hand-off round-trip touches ONLY PiP + window controls — never a
///      session close or audio stop.
@MainActor
final class BridgePiPRestoreTests: XCTestCase {

    /// A target that records EVERY possible side-effect, including ones the coordinator
    /// must never trigger (session close / audio stop). Those are modeled here so the
    /// test proves they stay at zero.
    private final class RecordingTarget: BridgePiPHandoffTarget {
        var isSessionLive = true
        var isPiPActive = false
        var isPiPSupported = true

        private(set) var enterCount = 0
        private(set) var exitCount = 0
        private(set) var restoreCount = 0
        // Continuity tripwires — must remain 0 across any hand-off.
        private(set) var sessionCloseCount = 0
        private(set) var audioStopCount = 0

        func enterPiP() {
            enterCount += 1
            isPiPActive = true // simulate the OS entering PiP
        }
        func exitPiP() {
            exitCount += 1
            isPiPActive = false // simulate the OS leaving PiP
        }
        func restoreInAppWindow() { restoreCount += 1 }

        // Not part of the protocol — proves the coordinator has no way to call these.
        func closeSession() { sessionCloseCount += 1 }
        func stopAudio() { audioStopCount += 1 }
    }

    func testPiPDidStopRestoresInAppWindow() {
        let target = RecordingTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handlePiPDidStop()

        XCTAssertEqual(target.restoreCount, 1)
    }

    func testForegroundRestoreExitsPiPThenRestoresWindow() {
        let target = RecordingTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        // Enter PiP on background…
        coordinator.handleScenePhase(.background)
        XCTAssertEqual(target.enterCount, 1)
        XCTAssertTrue(target.isPiPActive)

        // …return to foreground → exit PiP…
        coordinator.handleScenePhase(.active)
        XCTAssertEqual(target.exitCount, 1)
        XCTAssertFalse(target.isPiPActive)

        // …and the OS did-stop callback restores the in-app window.
        coordinator.handlePiPDidStop()
        XCTAssertEqual(target.restoreCount, 1)
    }

    func testHandoffRoundTripNeverClosesSessionOrStopsAudio() {
        let target = RecordingTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handleScenePhase(.background) // enter
        coordinator.handleScenePhase(.inactive)   // blip
        coordinator.handleScenePhase(.active)     // exit
        coordinator.handlePiPDidStop()            // restore
        coordinator.popOut()                      // manual re-enter

        // The continuity invariant: no session close, no audio stop, ever.
        XCTAssertEqual(target.sessionCloseCount, 0)
        XCTAssertEqual(target.audioStopCount, 0)
    }
}
