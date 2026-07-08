import SwiftUI
import XCTest
@testable import AdjutantUI

/// Tests for PiP hand-off entry — auto-on-background + manual pop-out (adj-207.5.1 / T013).
///
/// Covers the pure policy (the acceptance criteria) and the coordinator's dispatch onto
/// a spy target. No AVKit, no LiveKit, no scenePhase plumbing.
@MainActor
final class BridgePiPHandoffTests: XCTestCase {

    // MARK: - Spy target

    private final class SpyTarget: BridgePiPHandoffTarget {
        var isSessionLive = true
        var isPiPActive = false
        var isPiPSupported = true

        private(set) var enterCount = 0
        private(set) var exitCount = 0
        private(set) var restoreCount = 0

        func enterPiP() { enterCount += 1 }
        func exitPiP() { exitCount += 1 }
        func restoreInAppWindow() { restoreCount += 1 }
    }

    // MARK: - Pure policy: background auto-enter

    func testBackgroundEntersPiPWhenLiveAndNotActive() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: true, pipActive: false, pipSupported: true),
            .enterPiP
        )
    }

    func testBackgroundNoOpWhenNotLive() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: false, pipActive: false, pipSupported: true),
            .none
        )
    }

    func testBackgroundNoOpWhenAlreadyInPiP() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: true, pipActive: true, pipSupported: true),
            .none
        )
    }

    func testBackgroundNoOpWhenPiPUnsupported() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: true, pipActive: false, pipSupported: false),
            .none
        )
    }

    // MARK: - Pure policy: manual pop-out

    func testManualPopOutEntersPiPWhenLive() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onManualPopOut(sessionLive: true, pipActive: false, pipSupported: true),
            .enterPiP
        )
    }

    func testManualPopOutNoOpWhenAlreadyInPiP() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onManualPopOut(sessionLive: true, pipActive: true, pipSupported: true),
            .none
        )
    }

    // MARK: - Pure policy: foreground restore

    func testForegroundExitsPiPWhenActive() {
        XCTAssertEqual(BridgePiPHandoffPolicy.onForeground(pipActive: true), .exitPiP)
    }

    func testForegroundNoOpWhenNotActive() {
        XCTAssertEqual(BridgePiPHandoffPolicy.onForeground(pipActive: false), .none)
    }

    // MARK: - Coordinator dispatch

    func testCoordinatorBackgroundDrivesEnterPiP() {
        let target = SpyTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handleScenePhase(.background)

        XCTAssertEqual(target.enterCount, 1)
        XCTAssertEqual(target.exitCount, 0)
    }

    func testCoordinatorInactiveIsNoOp() {
        let target = SpyTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handleScenePhase(.inactive)

        XCTAssertEqual(target.enterCount, 0)
        XCTAssertEqual(target.exitCount, 0)
        XCTAssertEqual(target.restoreCount, 0)
    }

    func testCoordinatorForegroundWhileInPiPDrivesExit() {
        let target = SpyTarget()
        target.isPiPActive = true
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handleScenePhase(.active)

        XCTAssertEqual(target.exitCount, 1)
    }

    func testCoordinatorPopOutDrivesEnterPiP() {
        let target = SpyTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.popOut()

        XCTAssertEqual(target.enterCount, 1)
    }

    func testCoordinatorBackgroundWhenNotLiveIsNoOp() {
        let target = SpyTarget()
        target.isSessionLive = false
        let coordinator = BridgePiPHandoffCoordinator(target: target)

        coordinator.handleScenePhase(.background)

        XCTAssertEqual(target.enterCount, 0)
    }
}
