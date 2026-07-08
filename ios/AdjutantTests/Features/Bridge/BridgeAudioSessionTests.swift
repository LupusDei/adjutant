import XCTest
import AVFoundation
@testable import AdjutantUI

/// Tests for the Phase-A background audio session (adj-207.3.1 / T006).
///
/// `BridgeAudioSession` configures `AVAudioSession` for full-duplex background
/// audio (`.playAndRecord`) so the Bridge keeps talking AND listening while the
/// app is backgrounded, and handles the two disruptions that break a live call:
/// **interruptions** (phone call / Siri) and **route changes** (AirPods, CarPlay).
///
/// The real `AVAudioSession.sharedInstance()` is hidden behind the
/// `AudioSessionControlling` seam so none of this touches real audio hardware —
/// a spy records every category/activation call. The transition decisions live in
/// the pure `BridgeAudioPolicy`, tested here in isolation from any I/O.
@MainActor
final class BridgeAudioSessionTests: XCTestCase {

    // MARK: - Test double (AVAudioSession seam)

    /// Records every call the session makes to the audio system so tests can
    /// assert configuration + activation without a real `AVAudioSession`.
    private final class SpyAudioSession: AudioSessionControlling {
        var inputAvailable = true
        var routePortTypes: [AVAudioSession.Port] = [.builtInSpeaker]

        var setCategoryError: Error?
        var setActiveError: Error?

        private(set) var categoryCalls:
            [(category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)] = []
        private(set) var activeCalls: [(active: Bool, options: AVAudioSession.SetActiveOptions)] = []

        var isInputAvailable: Bool { inputAvailable }
        var currentRoutePortTypes: [AVAudioSession.Port] { routePortTypes }

        func setCategory(
            _ category: AVAudioSession.Category,
            mode: AVAudioSession.Mode,
            options: AVAudioSession.CategoryOptions
        ) throws {
            if let setCategoryError { throw setCategoryError }
            categoryCalls.append((category, mode, options))
        }

        func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
            if let setActiveError { throw setActiveError }
            activeCalls.append((active, options))
        }
    }

    private struct DummyError: Error {}

    private func makeSession(
        preferred: BridgeAudioDuplexMode = .fullDuplex,
        inputAvailable: Bool = true
    ) -> (BridgeAudioSession, SpyAudioSession) {
        let spy = SpyAudioSession()
        spy.inputAvailable = inputAvailable
        return (BridgeAudioSession(controller: spy, preferredMode: preferred), spy)
    }

    // MARK: - Initial state (seam untouched until activation)

    func testInitialStateIsInactiveFullDuplexAndTouchesNothing() {
        let (session, spy) = makeSession()
        XCTAssertFalse(session.isActive)
        XCTAssertFalse(session.isInterrupted)
        XCTAssertEqual(session.duplexMode, .fullDuplex)
        XCTAssertFalse(session.isListenOnly)
        XCTAssertTrue(spy.categoryCalls.isEmpty, "must not configure the system before activate()")
        XCTAssertTrue(spy.activeCalls.isEmpty)
    }

    // MARK: - Activation / configuration

    func testActivateConfiguresPlayAndRecordForBackgroundAndActivates() throws {
        let (session, spy) = makeSession()
        try session.activate()

        XCTAssertEqual(spy.categoryCalls.count, 1)
        XCTAssertEqual(spy.categoryCalls.first?.category, .playAndRecord)
        // Full-duplex → voiceChat mode (input processing / echo cancellation).
        XCTAssertEqual(spy.categoryCalls.first?.mode, .voiceChat)
        // Bluetooth options so AirPods/CarPlay mic + playback work.
        let opts = spy.categoryCalls.first?.options ?? []
        XCTAssertTrue(opts.contains(.allowBluetooth))
        XCTAssertTrue(opts.contains(.allowBluetoothA2DP))
        // The avatar is the primary audio — it must NOT mix with others.
        XCTAssertFalse(opts.contains(.mixWithOthers))

        XCTAssertEqual(spy.activeCalls.count, 1)
        XCTAssertEqual(spy.activeCalls.first?.active, true)
        XCTAssertTrue(session.isActive)
    }

    func testActivatePropagatesConfigurationErrorAndStaysInactive() {
        let (session, spy) = makeSession()
        spy.setCategoryError = DummyError()
        XCTAssertThrowsError(try session.activate())
        XCTAssertFalse(session.isActive)
        XCTAssertTrue(spy.activeCalls.isEmpty, "must not activate when configuration failed")
    }

    // MARK: - Full-duplex auto-degrade to listen-only

    func testActivateAutoDegradesToListenOnlyWhenNoMicInput() throws {
        let (session, spy) = makeSession(preferred: .fullDuplex, inputAvailable: false)
        try session.activate()

        XCTAssertEqual(session.duplexMode, .listenOnly)
        XCTAssertTrue(session.isListenOnly)
        // Listen-only reconfigures with the non-voice-processing mode.
        XCTAssertEqual(spy.categoryCalls.first?.mode, .default)
        // Category stays playAndRecord (background-audio entitlement is category-gated).
        XCTAssertEqual(spy.categoryCalls.first?.category, .playAndRecord)
    }

    func testDegradeToListenOnlySetsIndicatorAndReconfigures() throws {
        let (session, spy) = makeSession()
        try session.activate()
        XCTAssertFalse(session.isListenOnly)
        let priorConfigs = spy.categoryCalls.count

        session.degradeToListenOnly(reason: "background mic suspended by iOS")

        XCTAssertTrue(session.isListenOnly)
        XCTAssertEqual(session.duplexMode, .listenOnly)
        XCTAssertEqual(session.listenOnlyReason, "background mic suspended by iOS")
        XCTAssertGreaterThan(spy.categoryCalls.count, priorConfigs, "degrade must reconfigure the session")
        XCTAssertEqual(spy.categoryCalls.last?.mode, .default)
    }

    func testDegradeToListenOnlyIsIdempotent() throws {
        let (session, spy) = makeSession()
        try session.activate()
        session.degradeToListenOnly(reason: "first")
        let after = spy.categoryCalls.count
        session.degradeToListenOnly(reason: "second")
        XCTAssertEqual(spy.categoryCalls.count, after, "already listen-only → no extra reconfigure")
        XCTAssertEqual(session.listenOnlyReason, "first", "reason from the first degrade is retained")
    }

    // MARK: - Interruptions (phone call / Siri)

    func testInterruptionBeganMarksInterruptedAndDeactivates() throws {
        let (session, spy) = makeSession()
        try session.activate()

        session.handleInterruption(.began)

        XCTAssertTrue(session.isInterrupted)
        XCTAssertFalse(session.isActive)
        XCTAssertEqual(spy.activeCalls.last?.active, false, "began must relinquish the session")
    }

    func testInterruptionEndedWithResumeReactivates() throws {
        let (session, spy) = makeSession()
        try session.activate()
        session.handleInterruption(.began)
        let beforeResume = spy.activeCalls.count

        session.handleInterruption(.ended(shouldResume: true))

        XCTAssertFalse(session.isInterrupted)
        XCTAssertTrue(session.isActive)
        XCTAssertEqual(spy.activeCalls.last?.active, true)
        XCTAssertGreaterThan(spy.activeCalls.count, beforeResume)
    }

    func testInterruptionEndedWithoutResumeStaysInactive() throws {
        let (session, _) = makeSession()
        try session.activate()
        session.handleInterruption(.began)

        session.handleInterruption(.ended(shouldResume: false))

        XCTAssertFalse(session.isInterrupted)
        XCTAssertFalse(session.isActive, "no resume hint → stay paused, do not steal audio focus back")
    }

    // MARK: - Route changes (AirPods / CarPlay)

    func testRouteChangeOldDeviceUnavailableReactivatesToRecover() throws {
        let (session, spy) = makeSession()
        try session.activate()
        let before = spy.activeCalls.count

        // e.g. AirPods pulled out / CarPlay unplugged.
        session.handleRouteChange(reason: .oldDeviceUnavailable)

        XCTAssertGreaterThan(spy.activeCalls.count, before, "route loss must re-assert the session")
        XCTAssertEqual(spy.activeCalls.last?.active, true)
        XCTAssertTrue(session.isActive)
    }

    func testRouteChangeUnknownReasonIsInert() throws {
        let (session, spy) = makeSession()
        try session.activate()
        let before = spy.activeCalls.count

        session.handleRouteChange(reason: .newDeviceAvailable)

        XCTAssertEqual(spy.activeCalls.count, before, "a new device routes automatically — no re-activation needed")
    }

    // MARK: - deactivate()

    func testDeactivateNotifiesOthersAndClearsActive() throws {
        let (session, spy) = makeSession()
        try session.activate()

        try session.deactivate()

        XCTAssertFalse(session.isActive)
        XCTAssertEqual(spy.activeCalls.last?.active, false)
        XCTAssertTrue(spy.activeCalls.last?.options.contains(.notifyOthersOnDeactivation) ?? false)
    }

    // MARK: - Pure policy (no seam, no I/O)

    func testPolicyInterruptionActivation() {
        XCTAssertEqual(BridgeAudioPolicy.interruptionActivation(.began), .deactivate)
        XCTAssertEqual(BridgeAudioPolicy.interruptionActivation(.ended(shouldResume: true)), .activate)
        XCTAssertEqual(BridgeAudioPolicy.interruptionActivation(.ended(shouldResume: false)), .noChange)
    }

    func testPolicyRouteChangeActivation() {
        XCTAssertEqual(BridgeAudioPolicy.routeChangeActivation(reason: .oldDeviceUnavailable), .activate)
        XCTAssertEqual(BridgeAudioPolicy.routeChangeActivation(reason: .newDeviceAvailable), .noChange)
        XCTAssertEqual(BridgeAudioPolicy.routeChangeActivation(reason: .categoryChange), .noChange)
    }

    func testPolicyModePerDuplexMode() {
        XCTAssertEqual(BridgeAudioPolicy.mode(for: .fullDuplex), .voiceChat)
        XCTAssertEqual(BridgeAudioPolicy.mode(for: .listenOnly), .default)
    }

    // MARK: - Notification parsing (pure)

    func testParseInterruptionBeganNotification() {
        let note = Notification(
            name: AVAudioSession.interruptionNotification,
            object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue]
        )
        XCTAssertEqual(BridgeAudioSession.interruption(from: note), .began)
    }

    func testParseInterruptionEndedWithResumeNotification() {
        let note = Notification(
            name: AVAudioSession.interruptionNotification,
            object: nil,
            userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue
            ]
        )
        XCTAssertEqual(BridgeAudioSession.interruption(from: note), .ended(shouldResume: true))
    }

    func testParseInterruptionEndedWithoutResumeNotification() {
        let note = Notification(
            name: AVAudioSession.interruptionNotification,
            object: nil,
            userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                AVAudioSessionInterruptionOptionKey: UInt(0)
            ]
        )
        XCTAssertEqual(BridgeAudioSession.interruption(from: note), .ended(shouldResume: false))
    }

    func testParseInterruptionReturnsNilForMalformedNotification() {
        let note = Notification(name: AVAudioSession.interruptionNotification, object: nil, userInfo: nil)
        XCTAssertNil(BridgeAudioSession.interruption(from: note))
    }

    func testParseRouteChangeReasonNotification() {
        let note = Notification(
            name: AVAudioSession.routeChangeNotification,
            object: nil,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue]
        )
        XCTAssertEqual(BridgeAudioSession.routeChangeReason(from: note), .oldDeviceUnavailable)
    }
}
