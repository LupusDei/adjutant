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

    private func makeSurface(
        tokenResult: Result<NativeAvatarCreds, NativeAvatarTokenError> = .success(
            NativeAvatarCreds(sessionId: "s", roomName: "r", url: "wss://x", token: "t", avatarId: nil, expiresAt: nil)
        )
    ) -> (BridgePiPSurface, SpyPiP, ManualTimeout, SpyRoom) {
        let room = SpyRoom()
        let client = NativeAvatarClient(tokenProvider: StubTokenProvider(result: tokenResult), room: room)
        let display = SpyDisplay()
        let renderer = AvatarSampleBufferRenderer(display: display)
        let spyPiP = SpyPiP()
        let pip = BridgePiPController(controller: spyPiP)
        let deadline = ManualTimeout()
        let surface = BridgePiPSurface(
            hostView: AvatarSampleBufferUIView(),
            client: client,
            renderer: renderer,
            pip: pip,
            sessionLive: { true },
            restoreWindow: {},
            handoffDeadline: deadline
        )
        return (surface, spyPiP, deadline, room)
    }

    // MARK: - Visible failure

    func testEnterPiPStartsCleanWithNoError() {
        let (surface, _, deadline, _) = makeSurface()
        surface.enterPiP()
        XCTAssertNil(surface.lastError, "no error until something actually fails")
        XCTAssertEqual(deadline.startCount, 1, "watchdog armed on enterPiP")
    }

    func testHandoffTimeoutSurfacesVisibleError() {
        let (surface, spyPiP, deadline, _) = makeSurface()
        surface.enterPiP()               // client not live → async join + deadline armed

        deadline.fire()                  // PiP never became active in time

        XCTAssertEqual(spyPiP.isPictureInPictureActive, false)
        let error = surface.lastError
        XCTAssertNotNil(error, "a stuck hand-off must surface a visible error, not silent nothing")
        XCTAssertTrue(error?.hasPrefix("Couldn't start Picture in Picture") == true)
    }

    func testDidStartClearsErrorAndCancelsDeadline() {
        let (surface, spyPiP, deadline, _) = makeSurface()
        surface.enterPiP()
        deadline.fire()                  // sets an error
        XCTAssertNotNil(surface.lastError)

        spyPiP.fireDidStart()            // PiP actually started → success

        XCTAssertNil(surface.lastError, "a successful start clears the error banner")
        XCTAssertGreaterThanOrEqual(deadline.cancelCount, 1)
    }

    func testExitPiPCancelsDeadline() {
        let (surface, _, deadline, _) = makeSurface()
        surface.enterPiP()
        surface.exitPiP()

        XCTAssertGreaterThanOrEqual(deadline.cancelCount, 1)
        deadline.fire()                  // canceled → no late error
        XCTAssertNil(surface.lastError)
    }

    func testClearErrorDismissesBanner() {
        let (surface, _, deadline, _) = makeSurface()
        surface.enterPiP()
        deadline.fire()
        XCTAssertNotNil(surface.lastError)

        surface.clearError()
        XCTAssertNil(surface.lastError)
    }
}
