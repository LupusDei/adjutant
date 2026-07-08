import XCTest
import SwiftUI
@testable import AdjutantUI

/// Tests for the background-audio hook on `BridgeSession` (adj-207.3.2 / T007).
///
/// When the app backgrounds while the Bridge is live, the session must **activate
/// background audio and keep the WKWebView avatar audio path alive** (never tear
/// the surface down), and it must **restore on foreground**. When the audio session
/// degrades to listen-only, the session exposes that as an observable indicator.
///
/// The audio coordinator is behind the `BridgeAudioControlling` seam and the surface
/// behind `BridgeSurface`, so this logic is unit-tested with spies — no real
/// `AVAudioSession`, no WKWebView.
@MainActor
final class BridgeBackgroundAudioTests: XCTestCase {

    // MARK: - Test doubles

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
    }

    private final class SpyBridgeAudio: BridgeAudioControlling {
        private(set) var startCount = 0
        private(set) var stopCount = 0
        var listenOnly = false

        func startBackgroundAudio() { startCount += 1 }
        func stopBackgroundAudio() { stopCount += 1 }
        var isListenOnly: Bool { listenOnly }
    }

    private func makeSession() -> (BridgeSession, SpyBridgeSurface, SpyBridgeAudio) {
        let surface = SpyBridgeSurface()
        let audio = SpyBridgeAudio()
        return (BridgeSession(surface: surface, audio: audio), surface, audio)
    }

    // MARK: - Go-live activates audio

    func testGoingLiveStartsBackgroundAudio() {
        let (session, _, audio) = makeSession()
        session.open()
        XCTAssertEqual(audio.startCount, 0, "connecting must not start audio before it is live")
        session.markConnected()
        XCTAssertEqual(audio.startCount, 1, "going live starts the audio session")
    }

    // MARK: - Background entry hook

    func testEnteringBackgroundReAssertsBackgroundAudio() {
        let (session, _, audio) = makeSession()
        session.open()
        session.markConnected()
        let afterLive = audio.startCount

        session.enterBackground()

        XCTAssertEqual(session.state, .backgrounded)
        XCTAssertGreaterThan(audio.startCount, afterLive, "backgrounding re-asserts background audio")
    }

    func testBackgroundKeepsAvatarAudioPathAlive() {
        let (session, surface, _) = makeSession()
        session.open()
        session.markConnected()

        session.enterBackground()

        XCTAssertEqual(surface.teardownCount, 0, "avatar surface must NOT be torn down on background")
        XCTAssertEqual(surface.hideCount, 0, "surface stays live so the audio path keeps running")
    }

    // MARK: - Foreground restore

    func testForegroundRestoresLiveWithoutTeardown() {
        let (session, surface, _) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()

        session.enterForeground()

        XCTAssertEqual(session.state, .live)
        XCTAssertEqual(surface.teardownCount, 0)
    }

    // MARK: - Close stops audio + tears down

    func testCloseStopsBackgroundAudioAndTearsDownSurface() {
        let (session, surface, audio) = makeSession()
        session.open()
        session.markConnected()

        session.close()

        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(audio.stopCount, 1, "closing stops the audio session")
        XCTAssertEqual(surface.teardownCount, 1, "closing tears the surface down exactly once")
    }

    func testCloseFromBackgroundStopsAudio() {
        let (session, _, audio) = makeSession()
        session.open()
        session.markConnected()
        session.enterBackground()

        session.close()

        XCTAssertEqual(session.state, .closed)
        XCTAssertEqual(audio.stopCount, 1)
    }

    // MARK: - Listen-only indicator

    func testListenOnlyIndicatorReflectsAudioDegrade() {
        let (session, _, audio) = makeSession()
        session.open()
        session.markConnected()
        XCTAssertFalse(session.isListenOnly)

        audio.listenOnly = true
        XCTAssertTrue(session.isListenOnly, "session surfaces the audio session's listen-only degrade")
    }

    // MARK: - Nil-audio safety (foundational sessions have no coordinator)

    func testSessionWithoutAudioCoordinatorRunsLifecycleSafely() {
        let surface = SpyBridgeSurface()
        let session = BridgeSession(surface: surface) // no audio injected

        session.open()
        session.markConnected()
        session.enterBackground()
        session.enterForeground()
        session.close()

        XCTAssertEqual(session.state, .closed)
        XCTAssertFalse(session.isListenOnly, "no coordinator → not listen-only, and no crash")
        XCTAssertEqual(surface.teardownCount, 1)
    }

    // MARK: - Audio not started on a no-op focus

    func testOpeningWhileLiveDoesNotRestartAudio() {
        let (session, _, audio) = makeSession()
        session.open()
        session.markConnected()
        let afterLive = audio.startCount

        session.open() // single-instance guard → focus, not a new session

        XCTAssertEqual(audio.startCount, afterLive, "a focus no-op must not restart audio")
    }

    // MARK: - scenePhase routing through the host

    /// No-op web engine so a real `BridgeWebSurface`/`BridgeHost` can be built
    /// without WebKit or network.
    private final class NoopAvatarWebEngine: AvatarWebEngine {
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func load(_ url: URL) {}
        func setHidden(_ hidden: Bool) {}
        func teardown() {}
    }

    private func makeHost() -> (BridgeHost, SpyBridgeAudio) {
        let audio = SpyBridgeAudio()
        let surface = BridgeWebSurface(
            url: URL(string: "http://localhost:4201/avatar")!,
            engineFactory: { NoopAvatarWebEngine() }
        )
        return (BridgeHost(webSurface: surface, connectTimeout: nil, audio: audio), audio)
    }

    func testScenePhaseBackgroundWhileLiveEntersBackgroundAndActivatesAudio() {
        let (host, audio) = makeHost()
        host.open()
        host.session.markConnected()
        let afterLive = audio.startCount

        host.handleScenePhase(.background)

        XCTAssertEqual(host.session.state, .backgrounded)
        XCTAssertGreaterThan(audio.startCount, afterLive)
    }

    func testScenePhaseActiveRestoresLive() {
        let (host, _) = makeHost()
        host.open()
        host.session.markConnected()
        host.handleScenePhase(.background)

        host.handleScenePhase(.active)

        XCTAssertEqual(host.session.state, .live)
    }

    func testScenePhaseBackgroundWhenNotLiveIsNoOp() {
        let (host, audio) = makeHost()
        host.open() // still connecting, not live

        host.handleScenePhase(.background)

        XCTAssertEqual(host.session.state, .connecting, "no live session → background is inert")
        XCTAssertEqual(audio.startCount, 0)
    }

    func testHostExposesListenOnlyIndicator() {
        let (host, audio) = makeHost()
        host.open()
        host.session.markConnected()
        XCTAssertFalse(host.isListenOnly)

        audio.listenOnly = true
        XCTAssertTrue(host.isListenOnly)
    }
}
