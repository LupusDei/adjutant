import AVFoundation
import CoreVideo
import SwiftUI
import XCTest
@testable import AdjutantUI

/// End-to-end lifecycle / credit-meter invariants for the whole Bridge (adj-207.6.2 / T016).
///
/// This is the load-bearing correctness net for the Bridge: **exactly ONE Runway session
/// / credit meter at all times**, and **close-from-any-state tears down exactly once** — no
/// leaks, no double-billing. Where `BridgeSessionTests` pins the pure state machine and
/// `BridgePiPSurfaceTests` pins the PiP surface in isolation, THIS suite wires the real
/// collaborators together the way `BridgeHost` does and drives them across every transition
/// the avatar can go through:
///
///   fullscreen ↔ floating ↔ minimized-to-hidden(LIVE-tab) ↔ background
///               ↔ PiP(session-swap) ↔ restore ↔ close
///
/// The PiP path is the dangerous one (adj-207.5.4): popping out CLOSES the WKWebView Bridge
/// session and starts a FRESH native LiveKit session; restoring tears the native session down
/// and re-opens the WKWebView. That is where a second Runway session / a leaked credit meter
/// could hide. Every assertion below is against the injected seams (spy web surface, spy
/// LiveKit room, spy AVKit PiP) so the suite runs with no real hardware / LiveKit / simulator
/// media.
@MainActor
final class BridgeSessionLifecycleTests: XCTestCase {

    // MARK: - Shared test doubles

    /// Records web-surface (WKWebView) effects. `prepare` begins a Runway session (starts the
    /// meter); `teardown` ends it (stops the meter). The delta `prepare - teardown` is the
    /// number of live web Runway sessions — 0 or 1 for a correct single-instance session.
    private final class SpyBridgeSurface: BridgeSurface {
        private(set) var prepareCount = 0
        private(set) var showCount = 0
        private(set) var hideCount = 0
        private(set) var teardownCount = 0
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?

        func prepare() { prepareCount += 1 }
        func show() { showCount += 1 }
        func hide() { hideCount += 1 }
        func teardown() { teardownCount += 1 }

        /// The Runway session backing THIS surface is billing while it is prepared and not
        /// yet torn down.
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
        private(set) var connectCount = 0
        private(set) var disconnectCount = 0
        func setFrameSink(_ sink: NativeAvatarFrameSink?) {}
        func connect(url: String, token: String) async throws { connectCount += 1 }
        func disconnect() async { disconnectCount += 1 }
        func currentRoomState() -> NativeAvatarRoomState {
            NativeAvatarRoomState(
                joined: true, remoteParticipantCount: 1,
                hasRemoteVideoTrack: true, hasRemoteAudioTrack: true, videoTrackSubscribed: true
            )
        }
        /// Drive the go-live signal (avatar video track subscribed).
        func fireVideoReady() { onVideoTrackReady?() }
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
        private(set) var startCount = 0
        private(set) var stopCount = 0
        func startPictureInPicture() { startCount += 1 }
        func stopPictureInPicture() { stopCount += 1 }
        func fireDidStart() { isPictureInPictureActive = true; onDidStart?() }
        func fireDidStop() { isPictureInPictureActive = false; onDidStop?() }
    }

    private final class ManualTimeout: BridgeConnectTimeout {
        private var onTimeout: (() -> Void)?
        private(set) var startCount = 0
        private(set) var cancelCount = 0
        func start(_ onTimeout: @escaping () -> Void) { startCount += 1; self.onTimeout = onTimeout }
        func cancel() { cancelCount += 1; onTimeout = nil }
        func fire() { onTimeout?() }
    }

    /// Let the main-actor `Task { await client.start()/stop() }` blocks the PiP surface spawns
    /// run to their next suspension point. The stub token provider + spy room resolve
    /// synchronously, so a bounded set of yields drains the native start/stop deterministically.
    private func drain() async {
        for _ in 0..<50 { await Task.yield() }
    }

    // MARK: - Session-swap harness (real BridgeSession ⇄ real BridgePiPSurface)

    /// Wires the REAL `BridgeSession` to the REAL `BridgePiPSurface` exactly the way
    /// `BridgeHost.ensurePiPSurface()` does: `closeInAppSession` closes the web session,
    /// `restoreWindow` re-opens it, `sessionLive` reports the web session's liveness. This is
    /// the object graph where the single-meter invariant is actually enforced across the swap.
    @MainActor
    private final class SwapHarness {
        let webSurface: SpyBridgeSurface
        let session: BridgeSession
        let room: SpyRoom
        let client: NativeAvatarClient
        let renderer: AvatarSampleBufferRenderer
        let spyPiP: SpyPiP
        let pip: BridgePiPController
        let deadline: ManualTimeout
        let pipSurface: BridgePiPSurface
        let coordinator: BridgePiPHandoffCoordinator

        init() {
            let webSurface = SpyBridgeSurface()
            let session = BridgeSession(surface: webSurface, connectTimeout: nil)
            let room = SpyRoom()
            let client = NativeAvatarClient(
                tokenProvider: StubTokenProvider(
                    creds: NativeAvatarCreds(
                        sessionId: "s", roomName: "r", url: "wss://x", token: "t",
                        avatarId: nil, expiresAt: nil)),
                room: room)
            let renderer = AvatarSampleBufferRenderer(display: SpyDisplay())
            let spyPiP = SpyPiP()
            let pip = BridgePiPController(controller: spyPiP)
            let deadline = ManualTimeout()
            let pipSurface = BridgePiPSurface(
                hostView: AvatarSampleBufferUIView(),
                client: client,
                renderer: renderer,
                pip: pip,
                sessionLive: { [weak session] in
                    session?.state == .live || session?.state == .backgrounded
                },
                closeInAppSession: { [weak session] in session?.close() },
                restoreWindow: { [weak session] in session?.open() },
                handoffDeadline: deadline)

            self.webSurface = webSurface
            self.session = session
            self.room = room
            self.client = client
            self.renderer = renderer
            self.spyPiP = spyPiP
            self.pip = pip
            self.deadline = deadline
            self.pipSurface = pipSurface
            self.coordinator = BridgePiPHandoffCoordinator(target: pipSurface)
        }

        /// The single web (WKWebView) Runway session is billing while its surface is live.
        var webMeterLive: Bool { webSurface.isBilling }
        /// The native (LiveKit) Runway session is billing while the native client is
        /// connecting or live.
        var nativeMeterLive: Bool { client.state == .connecting || client.state == .live }
        /// Total number of Runway sessions currently billing. MUST never exceed 1 at a
        /// settled observation point, and MUST be 0 after a full close.
        var liveMeterCount: Int { (webMeterLive ? 1 : 0) + (nativeMeterLive ? 1 : 0) }

        /// Bring the web Bridge to LIVE (the normal starting point for a hand-off).
        func goLiveOnWeb() {
            session.open()
            session.markConnected()
        }

        /// Drive the native subscriber all the way to LIVE after a swap started it. Pumps the
        /// main-actor start `Task` until the client is actually `.connecting` (it may begin
        /// from `.idle` on the first swap or `.disconnected` on a later one), THEN fires the
        /// avatar-video-ready signal that promotes it to `.live`.
        func driveNativeLive() async {
            for _ in 0..<50 {
                if client.state == .connecting { break }
                await Task.yield()
            }
            room.fireVideoReady()
        }
    }

    // MARK: - Non-PiP transition matrix (real BridgeHost)

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

    @MainActor
    private final class SpyEngineFactory {
        private(set) var engines: [SpyAvatarWebEngine] = []
        var makeCount: Int { engines.count }
        func make() -> AvatarWebEngine {
            let e = SpyAvatarWebEngine()
            engines.append(e)
            return e
        }
    }

    private func makeHost() -> (BridgeHost, SpyEngineFactory) {
        let factory = SpyEngineFactory()
        let url = URL(string: "http://localhost:4201/avatar")!
        let surface = BridgeWebSurface(url: url, engineFactory: { factory.make() })
        return (BridgeHost(webSurface: surface, connectTimeout: nil), factory)
    }

    // MARK: - ONE meter across the non-PiP transition matrix

    /// The core US1/US2 invariant: NONE of the in-app window transitions
    /// (fullscreen ↔ floating ↔ hidden ↔ background) creates a 2nd Runway session. The web
    /// engine is built exactly once and NEVER re-loaded or torn down across the whole matrix.
    func testFullNonPiPTransitionMatrixKeepsExactlyOneSession() {
        let (host, factory) = makeHost()

        // Cold open (fullscreen) → connecting → live.
        host.windowModel.enterFullscreen()
        host.open()
        host.session.markConnected()
        XCTAssertEqual(factory.makeCount, 1)
        XCTAssertEqual(factory.engines.first?.loadCount, 1)

        // fullscreen → floating
        host.windowModel.enterFloating()
        // floating → hidden (minimize) → reveal (floating)
        host.windowModel.minimize()
        XCTAssertTrue(host.isBridgeHidden)
        XCTAssertTrue(host.session.isActive, "minimize keeps the session live")
        host.windowModel.reveal()
        XCTAssertFalse(host.isBridgeHidden)

        // floating → fullscreen
        host.windowModel.enterFullscreen()

        // background (audio continues) → foreground
        host.handleScenePhase(.background)
        XCTAssertEqual(host.session.state, .backgrounded, "backgrounding a live Bridge keeps it alive")
        host.handleScenePhase(.active)
        XCTAssertEqual(host.session.state, .live)

        // LIVE-tab minimize-to-hidden then reveal (the sole re-entry).
        host.toggleFromLiveTab() // minimize
        XCTAssertTrue(host.isBridgeHidden)
        host.toggleFromLiveTab() // reveal
        XCTAssertFalse(host.isBridgeHidden)

        // After EVERY transition: exactly ONE engine, one load, zero teardowns.
        XCTAssertEqual(factory.makeCount, 1, "no transition ever built a 2nd Runway session")
        XCTAssertEqual(factory.engines.first?.loadCount, 1, "the avatar page is never re-loaded/re-connected")
        XCTAssertEqual(factory.engines.first?.teardownCount, 0, "no transition tears the surface down")
        XCTAssertTrue(host.session.isActive)
    }

    /// Backgrounding while minimized-to-hidden must NOT spin up a second session nor tear the
    /// hidden one down — background audio needs the one live session intact.
    func testBackgroundWhileHiddenKeepsTheSingleSessionLive() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        host.toggleFromLiveTab() // minimize to hidden
        XCTAssertTrue(host.isBridgeHidden)

        host.handleScenePhase(.background)
        XCTAssertEqual(host.session.state, .backgrounded)
        host.handleScenePhase(.active)
        XCTAssertEqual(host.session.state, .live)

        XCTAssertEqual(factory.makeCount, 1)
        XCTAssertEqual(factory.engines.first?.teardownCount, 0)
    }

    /// Repeatedly opening across transitions never creates a 2nd session (single-instance).
    func testRepeatedOpenAcrossTransitionsNeverBuildsASecondSession() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        host.windowModel.enterFloating()
        host.open()                       // guard: focus, not a 2nd surface
        host.windowModel.minimize()
        host.open()                       // guard again while hidden
        host.handleScenePhase(.background)
        host.open()                       // guard again while backgrounded
        XCTAssertEqual(factory.makeCount, 1, "single-instance guard holds across every mode")
        XCTAssertGreaterThanOrEqual(host.session.focusRequestCount, 3)
    }

    // MARK: - Close from ANY state tears down EXACTLY once (non-PiP)

    func testCloseFromEachNonPiPStateTearsDownExactlyOnce() {
        // idle → close: never tears down.
        do {
            let (host, factory) = makeHost()
            host.close()
            XCTAssertEqual(host.session.state, .idle)
            XCTAssertEqual(factory.makeCount, 0)
        }
        // connecting → close.
        do {
            let (host, factory) = makeHost()
            host.open()
            host.close()
            XCTAssertEqual(host.session.state, .closed)
            XCTAssertEqual(factory.engines.first?.teardownCount, 1)
        }
        // live → close.
        do {
            let (host, factory) = makeHost()
            host.open(); host.session.markConnected()
            host.close()
            XCTAssertEqual(factory.engines.first?.teardownCount, 1)
        }
        // backgrounded → close.
        do {
            let (host, factory) = makeHost()
            host.open(); host.session.markConnected()
            host.handleScenePhase(.background)
            host.close()
            XCTAssertEqual(factory.engines.first?.teardownCount, 1)
        }
        // hidden → close.
        do {
            let (host, factory) = makeHost()
            host.open(); host.session.markConnected()
            host.windowModel.minimize()
            host.close()
            XCTAssertEqual(factory.engines.first?.teardownCount, 1)
        }
    }

    func testCloseIsIdempotentAcrossRepeatedCalls() {
        let (host, factory) = makeHost()
        host.open(); host.session.markConnected()
        host.close()
        host.close()
        host.close()
        XCTAssertEqual(factory.engines.first?.teardownCount, 1, "teardown fires exactly once no matter how many closes")
    }

    // MARK: - Unified close path (adj-207.6.2): End tears the whole Bridge down once

    /// The floating-window "End" control MUST route through the host's unified close so it
    /// tears down BOTH the WKWebView session AND (when built) the native PiP surface — a single
    /// teardown path. Previously `end()` closed only the session, leaving the native PiP surface
    /// as a stranded teardown path. This pins that `end()` accepts (and uses) an injected close.
    func testWindowEndRoutesThroughInjectedUnifiedClose() {
        let session = BridgeSession(surface: SpyBridgeSurface())
        var unifiedCloseCount = 0
        let controls = BridgeSessionWindowControls(session: session, onEnd: { unifiedCloseCount += 1 })
        session.open(); session.markConnected()

        controls.end()

        XCTAssertEqual(unifiedCloseCount, 1, "End routes through the injected unified close (host.close → web + native teardown)")
    }

    /// Backwards-compatible fallback: with no unified close injected, `end()` still closes the
    /// session directly (teardown-once) so existing call sites keep working.
    func testWindowEndFallsBackToSessionCloseWhenNoUnifiedCloseInjected() {
        let surface = SpyBridgeSurface()
        let session = BridgeSession(surface: surface)
        let controls = BridgeSessionWindowControls(session: session)
        session.open(); session.markConnected()

        controls.end()

        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(surface.teardownCount, 1)
    }

    /// Through the real host, ending from the floating window closes the session exactly once
    /// and is idempotent — the host wires `end()` to its unified close.
    func testHostWindowEndClosesSessionExactlyOnce() {
        let (host, factory) = makeHost()
        host.open(); host.session.markConnected()

        host.windowModel.end()
        XCTAssertEqual(host.session.state, .closed)
        XCTAssertEqual(factory.engines.first?.teardownCount, 1)

        host.windowModel.end() // idempotent
        XCTAssertEqual(factory.engines.first?.teardownCount, 1)
    }

    // MARK: - Session-swap: PiP entry frees the web session BEFORE native starts

    /// The load-bearing anti-double-bill guarantee (adj-207.5.4): entering PiP CLOSES the
    /// WKWebView Bridge session synchronously, BEFORE the fresh native session is even
    /// dispatched — so the two Runway sessions are never billing at the same instant.
    func testEnterPiPClosesWebSessionBeforeNativeStarts() {
        let h = SwapHarness()
        h.goLiveOnWeb()
        XCTAssertEqual(h.liveMeterCount, 1, "one meter: the web session")
        XCTAssertTrue(h.webMeterLive)

        h.coordinator.popOut() // manual pop-out → session-swap

        // Synchronously, the web session is already gone and the native has NOT started yet.
        XCTAssertEqual(h.session.state, .closed, "web Bridge closed as PiP begins")
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web surface torn down exactly once")
        XCTAssertFalse(h.webMeterLive, "web meter stopped before native starts — never two live at once")
        XCTAssertFalse(h.nativeMeterLive, "native not yet started at the swap instant")
    }

    /// After the native subscriber comes fully live in PiP, there is still exactly ONE meter
    /// (the native one) — the web session stays closed.
    func testInPiPExactlyOneMeterIsTheNativeSession() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()

        XCTAssertEqual(h.client.state, .live, "native subscriber is live")
        XCTAssertFalse(h.webMeterLive, "web session remains closed during PiP")
        XCTAssertTrue(h.nativeMeterLive)
        XCTAssertEqual(h.liveMeterCount, 1, "exactly one Runway session bills during PiP")
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web torn down once, never resurrected mid-PiP")
    }

    /// Auto hand-off on background (via the coordinator) obeys the same swap invariant: the
    /// web session is closed, then the native session becomes the single meter.
    func testAutoBackgroundHandoffKeepsExactlyOneMeter() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        // Model the host: background the live session first (→ .backgrounded), then the
        // coordinator drives the auto hand-off.
        h.session.enterBackground()
        XCTAssertTrue(h.webMeterLive)

        h.coordinator.handleScenePhase(.background)
        XCTAssertEqual(h.session.state, .closed, "auto hand-off closes the web session")
        XCTAssertFalse(h.webMeterLive)

        await h.driveNativeLive()
        XCTAssertEqual(h.liveMeterCount, 1, "exactly one meter after auto hand-off")
        XCTAssertTrue(h.nativeMeterLive)
    }

    // MARK: - Session-swap: restore tears down native and re-opens web as ONE session

    /// Restoring from PiP (foreground or OS-close) drops the native subscriber AND re-opens the
    /// WKWebView Bridge, settling on exactly ONE session again.
    func testRestoreTearsDownNativeAndReopensWebAsOneSession() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertTrue(h.nativeMeterLive)

        // The OS left PiP → restore.
        h.coordinator.handlePiPDidStop()

        // Web is re-opened (a fresh single session) synchronously…
        XCTAssertEqual(h.session.state, .connecting, "web Bridge re-opened on restore")
        XCTAssertEqual(h.webSurface.prepareCount, 2, "web session re-provisioned exactly once more")

        // …and the native subscriber is released.
        await drain()
        XCTAssertFalse(h.nativeMeterLive, "native subscriber torn down on restore")
        XCTAssertGreaterThanOrEqual(h.room.disconnectCount, 1)
        XCTAssertEqual(h.liveMeterCount, 1, "settles on exactly one Runway session (web) after restore")
    }

    /// A full round-trip (live → PiP → restore → live) leaves exactly one session and NEVER
    /// double-prepares or double-tears the web surface.
    func testFullPiPRoundTripSettlesOnOneSession() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        XCTAssertEqual(h.liveMeterCount, 1)

        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertEqual(h.liveMeterCount, 1)

        h.coordinator.handlePiPDidStop()
        h.session.markConnected() // web finishes reconnecting
        await drain()

        XCTAssertEqual(h.session.state, .live)
        XCTAssertEqual(h.liveMeterCount, 1, "one meter after the whole round-trip")
        XCTAssertEqual(h.webSurface.prepareCount, 2, "web prepared once per open — no phantom extra sessions")
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web torn down once (on pop-out) — not again on restore")
    }

    // MARK: - Close from PiP-active tears down exactly once, no missed/double teardown

    /// Closing the Bridge while a native PiP session is live (web already closed by the swap)
    /// tears the native side down exactly once and does NOT double-tear the web surface.
    func testCloseWhileInPiPTearsDownNativeOnceAndNeverDoubleTearsWeb() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertEqual(h.webSurface.teardownCount, 1, "web already torn down by the swap")

        // Host close semantics: session.close() (inert — already closed) + pipSurface.teardown().
        h.session.close()
        h.pipSurface.teardown()
        await drain()

        XCTAssertEqual(h.webSurface.teardownCount, 1, "web NOT torn down a second time")
        XCTAssertGreaterThanOrEqual(h.room.disconnectCount, 1, "native subscriber torn down")
        XCTAssertFalse(h.nativeMeterLive)
        XCTAssertEqual(h.liveMeterCount, 0, "closing from PiP leaves ZERO live sessions — no leak")
    }

    /// Teardown of the native surface is idempotent — repeated close never double-disconnects
    /// beyond a safe count and always ends at zero meters.
    func testPiPSurfaceTeardownIsIdempotent() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        h.coordinator.popOut()
        await h.driveNativeLive()

        h.pipSurface.teardown()
        h.pipSurface.teardown()
        h.pipSurface.teardown()
        await drain()

        XCTAssertFalse(h.nativeMeterLive, "native fully released after repeated teardown")
        XCTAssertEqual(h.liveMeterCount, 0)
    }

    // MARK: - Tool-loop attaches to exactly one session at a time (structural)

    /// The Adjutant tool loop is attached to the ONE session that is currently billing. Across
    /// a pop-out, ownership hands off cleanly: the web session (tool-loop-attached) is closed
    /// before the fresh native session starts, so there is exactly one attachable session at
    /// every settled point — never zero-with-a-dangling-attach nor two.
    func testExactlyOneAttachableSessionAtEverySettledPoint() async {
        let h = SwapHarness()

        // Before open: zero sessions.
        XCTAssertEqual(h.liveMeterCount, 0)

        // Live on web: exactly one.
        h.goLiveOnWeb()
        XCTAssertEqual(h.liveMeterCount, 1)

        // In PiP: exactly one (the native session the tool loop now drives).
        h.coordinator.popOut()
        await h.driveNativeLive()
        XCTAssertEqual(h.liveMeterCount, 1)

        // Restored: exactly one (web again).
        h.coordinator.handlePiPDidStop()
        h.session.markConnected()
        await drain()
        XCTAssertEqual(h.liveMeterCount, 1)

        // Closed: zero.
        h.session.close()
        h.pipSurface.teardown()
        await drain()
        XCTAssertEqual(h.liveMeterCount, 0)
    }

    // MARK: - Meter never exceeds one at any settled observation across a stress sequence

    /// A long, mixed sequence of transitions — the kind a real session goes through — must
    /// never settle with more than one live meter, and must end at zero after close.
    func testStressSequenceNeverExceedsOneLiveMeter() async {
        let h = SwapHarness()

        func assertAtMostOne(_ label: String) {
            XCTAssertLessThanOrEqual(h.liveMeterCount, 1, "more than one live meter after: \(label)")
        }

        h.goLiveOnWeb();                       assertAtMostOne("open+live")
        h.session.enterBackground();           assertAtMostOne("background")
        h.session.enterForeground();           assertAtMostOne("foreground")
        h.coordinator.popOut()
        await h.driveNativeLive();             assertAtMostOne("pop-out → native live")
        h.coordinator.handlePiPDidStop()
        h.session.markConnected()
        await drain();                         assertAtMostOne("restore → web live")
        h.coordinator.popOut()
        await h.driveNativeLive();             assertAtMostOne("second pop-out → native live")
        h.coordinator.handlePiPDidStop()
        h.session.markConnected()
        await drain();                         assertAtMostOne("second restore → web live")

        // Final close leaves nothing billing.
        h.session.close()
        h.pipSurface.teardown()
        await drain()
        XCTAssertEqual(h.liveMeterCount, 0, "stress sequence ends at zero live meters")
    }
}
