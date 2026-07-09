import AVFoundation
import XCTest
@testable import AdjutantUI

/// Tests for the visible-failure behaviour of the production PiP surface (adj-207.5.3).
///
/// The real-device bug was: tapping "pop out" did NOTHING — the native client never
/// reached `.live`, so `pip.start()` never fired and there was no error. These tests
/// pin that a stuck / failed hand-off now surfaces a VISIBLE `lastError` (never a silent
/// no-op), and that a success clears it — all against injected seams (no LiveKit/AVKit).
@MainActor
final class BridgePiPSurfaceTests: XCTestCase {

    // MARK: - Local spies

    private struct StubTokenProvider: NativeAvatarTokenProviding {
        let result: Result<NativeAvatarCreds, NativeAvatarTokenError>
        func fetchNativeToken(sessionId: String?) async throws -> NativeAvatarCreds {
            switch result {
            case .success(let c): return c
            case .failure(let e): throw e
            }
        }
    }

    private final class SpyRoom: NativeAvatarRoomConnecting {
        var onVideoTrackReady: (() -> Void)?
        var onAudioTrackReady: (() -> Void)?
        var onDisconnected: ((Error?) -> Void)?
        func setFrameSink(_ sink: NativeAvatarFrameSink?) {}
        func connect(url: String, token: String) async throws {}
        func disconnect() async {}
    }

    private final class SpyDisplay: SampleBufferDisplaying {
        var isReadyForMoreMediaData = true
        var renderStatus: SampleBufferRenderStatus = .rendering
        func enqueue(_ sampleBuffer: CMSampleBuffer) {}
        func flush() {}
    }

    private final class SpyPiP: PictureInPictureControlling {
        var isPictureInPicturePossible = false
        var isPictureInPictureActive = false
        var onDidStart: (() -> Void)?
        var onDidStop: (() -> Void)?
        var onFailedToStart: ((Error) -> Void)?
        var onPossibleChanged: (() -> Void)?
        private(set) var startCount = 0
        func startPictureInPicture() { startCount += 1 }
        func stopPictureInPicture() {}
        func fireDidStart() { isPictureInPictureActive = true; onDidStart?() }
    }

    private final class ManualTimeout: BridgeConnectTimeout {
        private(set) var startCount = 0
        private(set) var cancelCount = 0
        private var onTimeout: (() -> Void)?
        func start(_ onTimeout: @escaping () -> Void) { startCount += 1; self.onTimeout = onTimeout }
        func cancel() { cancelCount += 1; onTimeout = nil }
        func fire() { onTimeout?() }
    }

    /// Records the session-swap side effects (adj-207.5.4) so ordering + counts are testable.
    private final class SwapRecorder {
        private(set) var log: [String] = []
        func close() { log.append("close") }
        func restore() { log.append("restore") }
    }

    private func makeSurface(
        tokenResult: Result<NativeAvatarCreds, NativeAvatarTokenError> = .success(
            NativeAvatarCreds(sessionId: "s", roomName: "r", url: "wss://x", token: "t", avatarId: nil, expiresAt: nil)
        )
    ) -> (BridgePiPSurface, SpyPiP, ManualTimeout, SpyRoom, SwapRecorder) {
        let room = SpyRoom()
        let client = NativeAvatarClient(tokenProvider: StubTokenProvider(result: tokenResult), room: room)
        let display = SpyDisplay()
        let renderer = AvatarSampleBufferRenderer(display: display)
        let spyPiP = SpyPiP()
        let pip = BridgePiPController(controller: spyPiP)
        let deadline = ManualTimeout()
        let swap = SwapRecorder()
        let surface = BridgePiPSurface(
            hostView: AvatarSampleBufferUIView(),
            client: client,
            renderer: renderer,
            pip: pip,
            sessionLive: { true },
            closeInAppSession: { swap.close() },
            restoreWindow: { swap.restore() },
            handoffDeadline: deadline
        )
        return (surface, spyPiP, deadline, room, swap)
    }

    // MARK: - Visible failure

    func testEnterPiPStartsCleanWithNoError() {
        let (surface, _, deadline, _, _) = makeSurface()
        surface.enterPiP()
        XCTAssertNil(surface.lastError, "no error until something actually fails")
        XCTAssertEqual(deadline.startCount, 1, "watchdog armed on enterPiP")
    }

    func testHandoffTimeoutSurfacesVisibleError() {
        let (surface, spyPiP, deadline, _, _) = makeSurface()
        surface.enterPiP()               // client not live → async join + deadline armed

        deadline.fire()                  // PiP never became active in time

        XCTAssertEqual(spyPiP.isPictureInPictureActive, false)
        let error = surface.lastError
        XCTAssertNotNil(error, "a stuck hand-off must surface a visible error, not silent nothing")
        XCTAssertTrue(error?.hasPrefix("Couldn't start Picture in Picture") == true)
    }

    func testDidStartClearsErrorAndCancelsDeadline() {
        let (surface, spyPiP, deadline, _, _) = makeSurface()
        surface.enterPiP()
        deadline.fire()                  // sets an error
        XCTAssertNotNil(surface.lastError)

        spyPiP.fireDidStart()            // PiP actually started → success

        XCTAssertNil(surface.lastError, "a successful start clears the error banner")
        XCTAssertGreaterThanOrEqual(deadline.cancelCount, 1)
    }

    func testExitPiPCancelsDeadline() {
        let (surface, _, deadline, _, _) = makeSurface()
        surface.enterPiP()
        surface.exitPiP()

        XCTAssertGreaterThanOrEqual(deadline.cancelCount, 1)
        deadline.fire()                  // canceled → no late error
        XCTAssertNil(surface.lastError)
    }

    func testClearErrorDismissesBanner() {
        let (surface, _, deadline, _, _) = makeSurface()
        surface.enterPiP()
        deadline.fire()
        XCTAssertNotNil(surface.lastError)

        surface.clearError()
        XCTAssertNil(surface.lastError)
    }

    // MARK: - Session-swap (adj-207.5.4)

    func testEnterPiPClosesWKWebViewSessionBeforeStartingNative() {
        let (surface, _, _, _, swap) = makeSurface()

        surface.enterPiP()   // client not live → session-swap path

        // The WKWebView Bridge is closed FIRST (single-session invariant), before the
        // fresh native session starts.
        XCTAssertEqual(swap.log, ["close"], "pop-out closes the in-app session (no two live sessions)")
    }

    func testRestoreReopensWKWebViewSession() {
        let (surface, _, _, _, swap) = makeSurface()
        surface.enterPiP()          // ["close"]

        surface.restoreInAppWindow() // PiP ended → re-open the WKWebView Bridge

        XCTAssertEqual(swap.log, ["close", "restore"])
    }
}
