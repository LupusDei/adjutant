import AVFoundation
import CoreVideo
import SwiftUI
import XCTest
@testable import AdjutantUI

/// Interruption / edge-case matrix for the Bridge (adj-207.6.1 / T015).
///
/// Every real-world disruption a live Bridge can hit must resolve to a DEFINED state — no
/// crash, no orphaned session or credit meter, correct pause/resume. This suite drives each
/// one through the real handlers behind their injected seams and pins the outcome:
///
///   • incoming call / Siri  → audio relinquished, then resumed only when the system allows
///   • another app's PiP     → our PiP stops → restore to the in-app window (one session)
///   • Low Power Mode        → auto-PiP suppressed (audio-only bg), manual pop-out honored
///   • mic-permission denied → graceful listen-only degrade (playback continues), session kept
///   • network drop / reconnect → web: → failed → retry; native-in-PiP: → restore in-app (NO orphan)
///   • handoff timeout       → restore in-app + visible error (NO orphaned/dead Bridge)
///   • backgrounding mid-connect → session stays connecting, no PiP, no crash
///
/// All against spies — no phone call, no LiveKit, no AVKit, no real audio route.
@MainActor
final class BridgeInterruptionMatrixTests: XCTestCase {

    // MARK: - Audio seam spy

    private final class SpyAudioSession: AudioSessionControlling {
        var inputAvailable = true
        var routePortTypes: [AVAudioSession.Port] = [.builtInSpeaker]
        private(set) var activeCalls: [(active: Bool, options: AVAudioSession.SetActiveOptions)] = []
        private(set) var categoryCalls: [(category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)] = []
        var isInputAvailable: Bool { inputAvailable }
        var currentRoutePortTypes: [AVAudioSession.Port] { routePortTypes }
        func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws {
            categoryCalls.append((category, mode, options))
        }
        func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
            activeCalls.append((active, options))
        }
    }

    private func makeAudio(inputAvailable: Bool = true) -> (BridgeAudioSession, SpyAudioSession) {
        let spy = SpyAudioSession()
        spy.inputAvailable = inputAvailable
        return (BridgeAudioSession(controller: spy, preferredMode: .fullDuplex), spy)
    }

    // MARK: - Session / PiP seams (shared with the lifecycle suite's shapes)

    private final class SpyBridgeSurface: BridgeSurface {
        private(set) var prepareCount = 0
        private(set) var teardownCount = 0
        private(set) var showCount = 0
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func prepare() { prepareCount += 1 }
        func show() { showCount += 1 }
        func hide() {}
        func teardown() { teardownCount += 1 }
        func fireFailure() { onFailure?() }
        var isBilling: Bool { prepareCount - teardownCount > 0 }
    }

    private struct StubTokenProvider: NativeAvatarTokenProviding {
        let creds: NativeAvatarCreds
        func fetchNativeToken(sessionId: String?) async throws -> NativeAvatarCreds { creds }
    }

    private final class SpyRoom: NativeAvatarRoomConnecting {
        var onVideoTrackReady: (() -> Void)?
        var onAudioTrackReady: (() -> Void)?
        var onDisconnected: ((Error?) -> Void)?
        private(set) var disconnectCount = 0
        func setFrameSink(_ sink: NativeAvatarFrameSink?) {}
        func connect(url: String, token: String) async throws {}
        func disconnect() async { disconnectCount += 1 }
        func currentRoomState() -> NativeAvatarRoomState {
            NativeAvatarRoomState(joined: true, remoteParticipantCount: 1, hasRemoteVideoTrack: true, hasRemoteAudioTrack: true, videoTrackSubscribed: true)
        }
        func fireVideoReady() { onVideoTrackReady?() }
        /// Simulate a network drop of the LiveKit room (non-nil error = dropped connection).
        func fireDisconnected(_ error: Error?) { onDisconnected?(error) }
    }

    private final class SpyDisplay: SampleBufferDisplaying {
        var isReadyForMoreMediaData = true
        var renderStatus: SampleBufferRenderStatus = .rendering
        func enqueue(_ sampleBuffer: CMSampleBuffer) {}
        func flush() {}
    }

    private final class SpyPiP: PictureInPictureControlling {
        var isPictureInPicturePossible = true
        var isPictureInPictureActive = false
        var onDidStart: (() -> Void)?
        var onDidStop: (() -> Void)?
        var onFailedToStart: ((Error) -> Void)?
        var onPossibleChanged: (() -> Void)?
        func startPictureInPicture() {}
        func stopPictureInPicture() {}
        func fireDidStart() { isPictureInPictureActive = true; onDidStart?() }
        /// The OS stopped our PiP (another app took it, or the user closed it).
        func fireDidStop() { isPictureInPictureActive = false; onDidStop?() }
    }

    private final class ManualTimeout: BridgeConnectTimeout {
        private var onTimeout: (() -> Void)?
        func start(_ onTimeout: @escaping () -> Void) { self.onTimeout = onTimeout }
        func cancel() { onTimeout = nil }
        func fire() { onTimeout?() }
    }

    private final class SpyHandoffTarget: BridgePiPHandoffTarget {
        var isSessionLive = true
        var isPiPActive = false
        var isPiPSupported = true
        private(set) var enterCount = 0
        private(set) var exitCount = 0
        private(set) var restoreCount = 0
        func enterPiP() { enterCount += 1; isPiPActive = true }
        func exitPiP() { exitCount += 1; isPiPActive = false }
        func restoreInAppWindow() { restoreCount += 1 }
    }

    private struct DropError: Error {}

    /// Real `BridgeSession` ⇄ real `BridgePiPSurface`, wired like `BridgeHost`.
    @MainActor
    private final class SwapHarness {
        let webSurface: SpyBridgeSurface
        let session: BridgeSession
        let room: SpyRoom
        let client: NativeAvatarClient
        let spyPiP: SpyPiP
        let deadline: ManualTimeout
        let pipSurface: BridgePiPSurface
        let coordinator: BridgePiPHandoffCoordinator

        init(lowPowerMode: Bool = false) {
            let webSurface = SpyBridgeSurface()
            let session = BridgeSession(surface: webSurface, connectTimeout: nil)
            let room = SpyRoom()
            let client = NativeAvatarClient(
                tokenProvider: StubTokenProvider(creds: NativeAvatarCreds(
                    sessionId: "s", roomName: "r", url: "wss://x", token: "t", avatarId: nil, expiresAt: nil)),
                room: room)
            let spyPiP = SpyPiP()
            let deadline = ManualTimeout()
            let pipSurface = BridgePiPSurface(
                hostView: AvatarSampleBufferUIView(),
                client: client,
                renderer: AvatarSampleBufferRenderer(display: SpyDisplay()),
                pip: BridgePiPController(controller: spyPiP),
                sessionLive: { [weak session] in session?.state == .live || session?.state == .backgrounded },
                closeInAppSession: { [weak session] in session?.close() },
                restoreWindow: { [weak session] in session?.open() },
                handoffDeadline: deadline)
            self.webSurface = webSurface
            self.session = session
            self.room = room
            self.client = client
            self.spyPiP = spyPiP
            self.deadline = deadline
            self.pipSurface = pipSurface
            self.coordinator = BridgePiPHandoffCoordinator(target: pipSurface, lowPowerModeProvider: { lowPowerMode })
        }

        var webMeterLive: Bool { webSurface.isBilling }
        var nativeMeterLive: Bool { client.state == .connecting || client.state == .live }
        var liveMeterCount: Int { (webMeterLive ? 1 : 0) + (nativeMeterLive ? 1 : 0) }

        func goLiveOnWeb() { session.open(); session.markConnected() }

        func driveNativeLive() async {
            for _ in 0..<50 { if client.state == .connecting { break }; await Task.yield() }
            room.fireVideoReady()
        }
    }

    private func drain() async { for _ in 0..<50 { await Task.yield() } }

    // MARK: - Incoming call / Siri (audio interruption)

    /// An incoming call relinquishes audio while it rings, then resumes when the call ends and
    /// the system grants `.shouldResume` — the defined pause/resume, no lost session.
    func testIncomingCallPausesAudioThenResumesOnEnd() {
        let (audio, spy) = makeAudio()
        try? audio.activate()
        XCTAssertTrue(audio.isActive)

        audio.handleInterruption(.began)
        XCTAssertTrue(audio.isInterrupted, "call marks the session interrupted")
        XCTAssertFalse(audio.isActive, "audio relinquished for the call")
        XCTAssertFalse(audio.isListenOnly, "an interruption does not degrade the mic — it pauses")

        audio.handleInterruption(.ended(shouldResume: true))
        XCTAssertFalse(audio.isInterrupted)
        XCTAssertTrue(audio.isActive, "audio resumes after the call")
        // Last activation call reactivated the session.
        XCTAssertEqual(spy.activeCalls.last?.active, true)
    }

    /// Siri that ends WITHOUT `.shouldResume` leaves the session relinquished (defined) rather
    /// than force-reactivating over another app — no crash, no double-activation.
    func testSiriInterruptionWithoutResumeStaysRelinquished() {
        let (audio, _) = makeAudio()
        try? audio.activate()

        audio.handleInterruption(.began)
        audio.handleInterruption(.ended(shouldResume: false))

        XCTAssertFalse(audio.isInterrupted, "interruption cleared")
        XCTAssertFalse(audio.isActive, "no resume granted → stay relinquished (defined)")
    }

    // MARK: - Mic-permission denied (no input route)

    /// With no input route (mic permission denied / no device), activation degrades to
    /// listen-only: playback continues, the session stays active, and the degrade is recorded
    /// for the indicator — a defined fallback, not a silent failure or a lost session.
    func testMicPermissionDeniedDegradesToListenOnlyKeepingSession() {
        let (audio, _) = makeAudio(inputAvailable: false)

        try? audio.activate()

        XCTAssertTrue(audio.isActive, "audio session stays active (playback continues)")
        XCTAssertTrue(audio.isListenOnly, "degrades to listen-only when the mic is unavailable")
        XCTAssertEqual(audio.duplexMode, .listenOnly)
        XCTAssertNotNil(audio.listenOnlyReason, "the degrade reason is recorded for the UI indicator")
    }

    // MARK: - Low Power Mode

    func testLowPowerModeSuppressesAutoBackgroundPiP() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: true, pipActive: false, pipSupported: true, lowPowerMode: true),
            .none, "auto hand-off is suppressed under Low Power Mode")
    }

    func testAutoBackgroundPiPStillEntersWhenNotLowPower() {
        XCTAssertEqual(
            BridgePiPHandoffPolicy.onBackground(sessionLive: true, pipActive: false, pipSupported: true, lowPowerMode: false),
            .enterPiP)
    }

    /// The coordinator honors the low-power provider on background (no auto-PiP) but the manual
    /// pop-out is NOT gated — an explicit Commander request still enters PiP.
    func testCoordinatorLowPowerSkipsAutoButHonorsManualPopOut() {
        let target = SpyHandoffTarget()
        let coordinator = BridgePiPHandoffCoordinator(target: target, lowPowerModeProvider: { true })

        coordinator.handleScenePhase(.background)
        XCTAssertEqual(target.enterCount, 0, "Low Power Mode: no auto hand-off on background")

        coordinator.popOut()
        XCTAssertEqual(target.enterCount, 1, "manual pop-out is honored even in Low Power Mode")
    }

    /// End-to-end: backgrounding a live Bridge under Low Power Mode does NOT swap sessions — the
    /// web session stays live (audio-only continuation), exactly one meter, no native session.
    func testLowPowerBackgroundKeepsWebSessionNoSwap() async {
        let h = SwapHarness(lowPowerMode: true)
        h.goLiveOnWeb()
        h.session.enterBackground()

        h.coordinator.handleScenePhase(.background)
        await drain()

        XCTAssertTrue(h.webMeterLive, "web session kept — no PiP swap under Low Power Mode")
        XCTAssertFalse(h.nativeMeterLive, "no native session started")
        XCTAssertEqual(h.liveMeterCount, 1, "exactly one meter")
        XCTAssertEqual(h.webSurface.teardownCount, 0, "web session never closed by a suppressed hand-off")
    }

    // MARK: - Another app takes PiP

    /// While in native PiP, another app taking PiP makes the OS stop ours. We restore the in-app
    /// window and release the native subscriber — settling on exactly one session, no orphan.
    func testAnotherAppPiPStopsUsAndRestoresInApp() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertTrue(h.nativeMeterLive)

        // The OS stops our PiP because another app took the single system PiP window.
        h.spyPiP.fireDidStop()

        // We reopen the in-app WKWebView Bridge…
        XCTAssertEqual(h.session.state, .connecting, "restored the in-app window")
        await drain()
        // …and drop the native subscriber — one session, nothing orphaned.
        XCTAssertFalse(h.nativeMeterLive)
        XCTAssertGreaterThanOrEqual(h.room.disconnectCount, 1)
        XCTAssertEqual(h.liveMeterCount, 1)
    }

    // MARK: - Network drop / reconnect

    /// A network drop on the in-app WKWebView surface fails the session cleanly (surface torn
    /// down, meter released) and a retry reconnects — a defined failed→retry path, no orphan.
    func testWebNetworkDropFailsThenRetryReconnects() {
        let surface = SpyBridgeSurface()
        let session = BridgeSession(surface: surface)
        session.open()
        session.markConnected()
        XCTAssertEqual(session.state, .live)

        surface.fireFailure() // network drop → the WKWebView load/connection fails
        XCTAssertEqual(session.state, .failed, "network drop resolves to the defined failed state")
        XCTAssertEqual(surface.teardownCount, 1, "surface torn down — no leaked meter")
        XCTAssertFalse(session.isActive)

        session.retry()
        XCTAssertEqual(session.state, .connecting, "retry reconnects")
        XCTAssertEqual(surface.prepareCount, 2, "a fresh surface is provisioned on retry")
    }

    /// A native LiveKit drop WHILE IN PiP (the session-swap already closed the web session) must
    /// NOT orphan the Bridge: the failed hand-off restores the in-app window AND surfaces a
    /// visible error, so the Commander lands on a live in-app session, never a dead black screen.
    func testNativeNetworkDropInPiPRestoresInAppNoOrphan() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web closed by the swap")

        h.room.fireDisconnected(DropError()) // network drop of the native room

        // The in-app WKWebView Bridge is reopened (not left orphaned)…
        XCTAssertEqual(h.session.state, .connecting, "failed hand-off restores the in-app session")
        XCTAssertEqual(h.webSurface.prepareCount, 2, "web re-provisioned exactly once more")
        XCTAssertNotNil(h.pipSurface.lastError, "the drop surfaces a visible error, not a silent no-op")

        await drain()
        XCTAssertFalse(h.nativeMeterLive, "native subscriber released")
        XCTAssertEqual(h.liveMeterCount, 1, "settles on exactly one (web) session — nothing orphaned")
    }

    /// A hand-off that never becomes active (avatar video never arrives) times out into the same
    /// safe state: restore the in-app window + visible error — never a stuck/dead Bridge.
    func testHandoffTimeoutRestoresInAppAndSurfacesError() {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.pipSurface.enterPiP() // web closed; native start dispatched but never drives video

        h.deadline.fire() // watchdog: PiP never became active

        XCTAssertEqual(h.session.state, .connecting, "timeout restores the in-app session")
        XCTAssertEqual(h.webSurface.prepareCount, 2)
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web torn down once by the swap, not again")
        XCTAssertNotNil(h.pipSurface.lastError, "a stuck hand-off is a visible error, not an orphan")
    }

    // MARK: - Backgrounding mid-connect

    private final class SpyAvatarWebEngine: AvatarWebEngine {
        private(set) var loadCount = 0
        private(set) var teardownCount = 0
        var hidden = true
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func load(_ url: URL) { loadCount += 1 }
        func setHidden(_ hidden: Bool) { self.hidden = hidden }
        func setMicEnabled(_ enabled: Bool) {}
        func teardown() { teardownCount += 1 }
    }

    /// Backgrounding while the session is still CONNECTING (not yet live) must not crash, must
    /// not background/close the half-open session, and must not attempt a PiP hand-off. The
    /// connect simply continues; foreground leaves it connecting; it goes live normally.
    func testBackgroundingMidConnectStaysConnectingNoPiPNoCrash() {
        var engines: [SpyAvatarWebEngine] = []
        let url = URL(string: "http://localhost:4201/avatar")!
        let surface = BridgeWebSurface(url: url, engineFactory: {
            let e = SpyAvatarWebEngine(); engines.append(e); return e
        })
        let host = BridgeHost(webSurface: surface, connectTimeout: nil)

        host.open()
        XCTAssertEqual(host.session.state, .connecting)

        host.handleScenePhase(.background)
        XCTAssertEqual(host.session.state, .connecting, "a mid-connect background is inert — not backgrounded, not closed")
        XCTAssertNil(host.pipSurface, "no PiP surface spun up for a non-live background")

        host.handleScenePhase(.active)
        XCTAssertEqual(host.session.state, .connecting, "still connecting on return")

        host.session.markConnected()
        XCTAssertEqual(host.session.state, .live, "the connect completes normally")
        XCTAssertEqual(engines.count, 1, "exactly one surface throughout")
        XCTAssertEqual(engines.first?.teardownCount, 0, "nothing torn down by the interruption")
    }
}
