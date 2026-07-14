import AVFoundation
import CoreVideo
import SwiftUI
import XCTest
@testable import AdjutantUI

/// End-to-end acceptance for the Bridge PiP journey (adj-207.6.4 / T018).
///
/// The US4 acceptance path, exercised through the real collaborators behind their injected
/// seams:
///
///   open → float → navigate (session SURVIVES, no reconnect)
///        → background (audio CONTINUES; auto-PiP hand-off, session-swap)
///        → foreground (RESTORE into the in-app window)
///
/// with **exactly ONE Runway session / credit meter throughout**.
///
/// Because system PiP is device-gated (a headless CI simulator reports no PiP support, so
/// `BridgeHost` never builds the native surface), the journey is verified in two cohesive
/// halves that together cover the full path:
///   • Part 1 — the real `BridgeHost`: open → float → navigate → background(audio) → foreground,
///     asserting the surface survives navigation with no reload and background audio continues.
///   • Part 2 — the real `BridgeSession` ⇄ `BridgePiPSurface` wired like `BridgeHost`: the
///     background→auto-PiP session-swap and the foreground→restore, asserting one session
///     throughout and a clean hand-off both ways.
@MainActor
final class BridgePiPAcceptanceTests: XCTestCase {

    // MARK: - Spies

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

    private final class SpyAudioSession: AudioSessionControlling {
        var inputAvailable = true
        var routePortTypes: [AVAudioSession.Port] = [.builtInSpeaker]
        private(set) var activeCalls: [(active: Bool, options: AVAudioSession.SetActiveOptions)] = []
        var isInputAvailable: Bool { inputAvailable }
        var currentRoutePortTypes: [AVAudioSession.Port] { routePortTypes }
        func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws {}
        func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
            activeCalls.append((active, options))
        }
        var deactivations: Int { activeCalls.filter { !$0.active }.count }
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
        func start(_ onTimeout: @escaping () -> Void) { self.onTimeout = onTimeout }
        func cancel() { onTimeout = nil }
        func fire() { onTimeout?() }
    }

    /// Real `BridgeSession` ⇄ real `BridgePiPSurface`, wired like `BridgeHost`, with the ability
    /// to drive PiP all the way to OS-active (first frame + did-start).
    @MainActor
    private final class SwapHarness {
        let webSurface: SpyBridgeSurface
        let session: BridgeSession
        let room: SpyRoom
        let client: NativeAvatarClient
        let renderer: AvatarSampleBufferRenderer
        let spyPiP: SpyPiP
        let pipSurface: BridgePiPSurface
        let coordinator: BridgePiPHandoffCoordinator

        init() {
            let webSurface = SpyBridgeSurface()
            let session = BridgeSession(surface: webSurface, connectTimeout: nil)
            let room = SpyRoom()
            let client = NativeAvatarClient(
                tokenProvider: StubTokenProvider(creds: NativeAvatarCreds(
                    sessionId: "s", roomName: "r", url: "wss://x", token: "t", avatarId: nil, expiresAt: nil)),
                room: room)
            let renderer = AvatarSampleBufferRenderer(display: SpyDisplay())
            let spyPiP = SpyPiP()
            let pipSurface = BridgePiPSurface(
                hostView: AvatarSampleBufferUIView(),
                client: client,
                renderer: renderer,
                pip: BridgePiPController(controller: spyPiP),
                sessionLive: { [weak session] in session?.state == .live || session?.state == .backgrounded },
                closeInAppSession: { [weak session] in session?.close() },
                restoreWindow: { [weak session] in session?.open() },
                handoffDeadline: ManualTimeout())
            self.webSurface = webSurface
            self.session = session
            self.room = room
            self.client = client
            self.renderer = renderer
            self.spyPiP = spyPiP
            self.pipSurface = pipSurface
            self.coordinator = BridgePiPHandoffCoordinator(target: pipSurface, lowPowerModeProvider: { false })
        }

        var webMeterLive: Bool { webSurface.isBilling }
        var nativeMeterLive: Bool { client.state == .connecting || client.state == .live }
        var liveMeterCount: Int { (webMeterLive ? 1 : 0) + (nativeMeterLive ? 1 : 0) }

        func goLiveOnWeb() { session.open(); session.markConnected() }

        /// Drive the native subscriber to LIVE, enqueue the first frame (opens the PiP-start
        /// gate), and confirm the OS entered PiP — leaving the system in ACTIVE PiP.
        func driveIntoActivePiP() async {
            for _ in 0..<50 { if client.state == .connecting { break }; await Task.yield() }
            room.fireVideoReady()          // native live
            renderer.enqueue(makeFrame())  // first frame → pip.start() requested
            spyPiP.fireDidStart()          // OS confirms PiP active
        }

        private func makeFrame() -> NativeAvatarVideoFrame {
            var pb: CVPixelBuffer?
            CVPixelBufferCreate(kCFAllocatorDefault, 16, 16, kCVPixelFormatType_32BGRA,
                                [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &pb)
            return NativeAvatarVideoFrame(pixelBuffer: pb!, timeStampNs: 0)
        }
    }

    private final class SpyBridgeSurface: BridgeSurface {
        private(set) var prepareCount = 0
        private(set) var teardownCount = 0
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func prepare() { prepareCount += 1 }
        func show() {}
        func hide() {}
        func teardown() { teardownCount += 1 }
        var isBilling: Bool { prepareCount - teardownCount > 0 }
    }

    private func drain() async { for _ in 0..<50 { await Task.yield() } }

    // MARK: - Part 1: open → float → navigate → background(audio) → foreground

    func testAcceptancePart1_SurfaceSurvivesNavigationAndAudioContinues() {
        var engines: [SpyAvatarWebEngine] = []
        let url = URL(string: "http://localhost:4201/avatar")!
        let webSurface = BridgeWebSurface(url: url, engineFactory: {
            let e = SpyAvatarWebEngine(); engines.append(e); return e
        })
        let spyAudio = SpyAudioSession()
        let audio = BridgeAudioSession(controller: spyAudio, preferredMode: .fullDuplex, notificationCenter: NotificationCenter())
        let host = BridgeHost(webSurface: webSurface, connectTimeout: nil, audio: audio)

        // open → live
        host.windowModel.enterFullscreen()
        host.open()
        host.session.markConnected()
        XCTAssertEqual(host.session.state, .live)
        XCTAssertTrue(audio.isActive, "audio activates when the Bridge goes live")
        XCTAssertEqual(engines.count, 1)

        // float
        host.windowModel.enterFloating()
        XCTAssertTrue(host.windowModel.isFloating)

        // navigate across several screens — the surface must survive untouched
        for _ in 0..<5 { host.notePresentedContentChanged() }
        XCTAssertEqual(engines.count, 1, "navigation NEVER rebuilds the surface (one session)")
        XCTAssertEqual(engines.first?.loadCount, 1, "the avatar page is NEVER reloaded/reconnected")
        XCTAssertEqual(engines.first?.teardownCount, 0)
        XCTAssertTrue(host.session.isActive, "session survives navigation")

        // background — audio continues (re-asserted), session kept alive
        host.handleScenePhase(.background)
        XCTAssertEqual(host.session.state, .backgrounded)
        XCTAssertTrue(audio.isActive, "background audio continues")
        XCTAssertEqual(spyAudio.deactivations, 0, "audio is never deactivated across the journey")
        XCTAssertEqual(engines.first?.teardownCount, 0, "surface not torn down while backgrounded")

        // foreground — restored to live in-app, still one session
        host.handleScenePhase(.active)
        XCTAssertEqual(host.session.state, .live)
        XCTAssertTrue(audio.isActive)
        XCTAssertEqual(engines.count, 1, "exactly one Runway session across the whole journey")
        XCTAssertEqual(engines.first?.loadCount, 1)
        XCTAssertEqual(engines.first?.teardownCount, 0)
    }

    // MARK: - Part 2: background auto-PiP session-swap → foreground restore, ONE session

    func testAcceptancePart2_BackgroundAutoPiPSwapThenForegroundRestore() async {
        let h = SwapHarness()

        // live on the in-app WKWebView surface — one meter.
        h.goLiveOnWeb()
        XCTAssertEqual(h.liveMeterCount, 1)
        XCTAssertTrue(h.webMeterLive)

        // background → auto hand-off (session-swap): web closes, native takes over into PiP.
        h.session.enterBackground()
        h.coordinator.handleScenePhase(.background)
        await h.driveIntoActivePiP()

        XCTAssertFalse(h.webMeterLive, "web session closed by the swap")
        XCTAssertTrue(h.nativeMeterLive, "native session is the single meter during PiP")
        XCTAssertTrue(h.spyPiP.isPictureInPictureActive, "system PiP is active")
        XCTAssertEqual(h.liveMeterCount, 1, "exactly one meter in PiP")
        XCTAssertEqual(h.webSurface.teardownCount, 1)

        // foreground → exit PiP, then the OS did-stop restores the in-app window.
        h.coordinator.handleScenePhase(.active)
        XCTAssertGreaterThanOrEqual(h.spyPiP.stopCount, 1, "foreground requests leaving PiP")
        h.spyPiP.fireDidStop()          // OS confirms PiP left → restore
        h.session.markConnected()       // in-app web finishes reconnecting

        XCTAssertEqual(h.session.state, .live, "restored into the in-app window")
        await drain()
        XCTAssertFalse(h.nativeMeterLive, "native subscriber released on restore")
        XCTAssertGreaterThanOrEqual(h.room.disconnectCount, 1)
        XCTAssertEqual(h.liveMeterCount, 1, "exactly ONE session after the full round-trip")
        XCTAssertEqual(h.webSurface.prepareCount, 2, "web opened once, reopened once — never doubled")
    }

    /// The whole journey never leaves more than one meter live at any settled point, and a final
    /// close leaves zero — the end-to-end single-session guarantee.
    func testAcceptanceFullJourneyEndsClean() async {
        let h = SwapHarness()
        h.goLiveOnWeb()
        XCTAssertEqual(h.liveMeterCount, 1)

        h.session.enterBackground()
        h.coordinator.handleScenePhase(.background)
        await h.driveIntoActivePiP()
        XCTAssertEqual(h.liveMeterCount, 1)

        h.coordinator.handleScenePhase(.active)
        h.spyPiP.fireDidStop()
        h.session.markConnected()
        await drain()
        XCTAssertEqual(h.liveMeterCount, 1)

        // Close everything (host.close semantics): session close + native teardown.
        h.session.close()
        h.pipSurface.teardown()
        await drain()
        XCTAssertEqual(h.liveMeterCount, 0, "journey ends with zero live sessions — no leak")
    }
}
