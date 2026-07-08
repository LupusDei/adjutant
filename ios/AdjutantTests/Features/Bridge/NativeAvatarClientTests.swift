import XCTest
@testable import AdjutantUI

/// Tests for the native LiveKit avatar client (adj-207.4.2 / T009).
///
/// `NativeAvatarClient` fetches subscribe-only creds from `POST /avatar/native-token`
/// and joins the SAME Runway avatar room as a SECOND subscriber (never a second
/// session). These tests pin its lifecycle + single-subscriber invariant against a
/// stubbed token provider and a spy room seam — no LiveKit, no WebRTC, no network.
///
/// Load-bearing behaviours:
///   1. Happy path: fetch token → connect(url,token) → `.live` only once the avatar
///      video track subscribes (not merely on room-connect).
///   2. Token-fetch failure → `.failed`, room NEVER connected.
///   3. Connect failure → `.failed`.
///   4. Single-subscriber guard: re-entrant `start` never opens a second connection.
///   5. `stop` disconnects, detaches the sink, flushes the renderer.
///   6. Disconnect with error → `.failed`; clean disconnect → `.disconnected`.
@MainActor
final class NativeAvatarClientTests: XCTestCase {

    // MARK: - Test doubles

    /// Stub token provider — returns canned creds or throws a canned error.
    private struct StubTokenProvider: NativeAvatarTokenProviding {
        let result: Result<NativeAvatarCreds, NativeAvatarTokenError>
        // Records are captured via a reference box because the struct is Sendable.
        let calls: CallBox

        final class CallBox: @unchecked Sendable {
            private(set) var sessionIds: [String?] = []
            func record(_ id: String?) { sessionIds.append(id) }
            var count: Int { sessionIds.count }
        }

        func fetchNativeToken(sessionId: String?) async throws -> NativeAvatarCreds {
            calls.record(sessionId)
            switch result {
            case .success(let creds): return creds
            case .failure(let error): throw error
            }
        }
    }

    /// Spy room seam — records connect/disconnect/sink calls and lets the test drive
    /// the `onVideoTrackReady` / `onDisconnected` callbacks.
    private final class SpyRoom: NativeAvatarRoomConnecting {
        var onVideoTrackReady: (() -> Void)?
        var onDisconnected: ((Error?) -> Void)?

        private(set) var connectCalls: [(url: String, token: String)] = []
        private(set) var disconnectCount = 0
        private(set) var sinkHistory: [Bool] = [] // true = set, false = cleared

        var connectError: Error?

        func setFrameSink(_ sink: NativeAvatarFrameSink?) {
            sinkHistory.append(sink != nil)
        }

        func connect(url: String, token: String) async throws {
            connectCalls.append((url, token))
            if let connectError { throw connectError }
        }

        func disconnect() async { disconnectCount += 1 }

        // Drivers
        func fireVideoTrackReady() { onVideoTrackReady?() }
        func fireDisconnected(_ error: Error?) { onDisconnected?(error) }
    }

    private final class SpySink: NativeAvatarFrameSink {
        private(set) var enqueueCount = 0
        private(set) var flushCount = 0
        func enqueue(_ frame: NativeAvatarVideoFrame) { enqueueCount += 1 }
        func flush() { flushCount += 1 }
    }

    private struct TestError: Error {}

    private func makeCreds() -> NativeAvatarCreds {
        NativeAvatarCreds(
            sessionId: "sess-1",
            roomName: "room-abc",
            url: "wss://livekit.example/rtc",
            token: "jwt-token",
            avatarId: "avatar-x",
            expiresAt: nil
        )
    }

    private func makeClient(
        result: Result<NativeAvatarCreds, NativeAvatarTokenError>,
        room: SpyRoom
    ) -> (NativeAvatarClient, StubTokenProvider.CallBox) {
        let box = StubTokenProvider.CallBox()
        let provider = StubTokenProvider(result: result, calls: box)
        return (NativeAvatarClient(tokenProvider: provider, room: room), box)
    }

    // MARK: - Happy path

    func testStartFetchesTokenAndConnectsThenGoesLiveOnTrack() async {
        let room = SpyRoom()
        let (client, calls) = makeClient(result: .success(makeCreds()), room: room)

        await client.start(sessionId: "sess-1")

        // Token fetched once, room connected with the creds' url + token.
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.sessionIds, ["sess-1"])
        XCTAssertEqual(room.connectCalls.count, 1)
        XCTAssertEqual(room.connectCalls.first?.url, "wss://livekit.example/rtc")
        XCTAssertEqual(room.connectCalls.first?.token, "jwt-token")
        XCTAssertEqual(client.creds?.roomName, "room-abc")

        // Room joined but the video track hasn't arrived yet → still connecting.
        XCTAssertEqual(client.state, .connecting)
        XCTAssertFalse(client.isLive)

        // Track subscribes → live.
        room.fireVideoTrackReady()
        XCTAssertEqual(client.state, .live)
        XCTAssertTrue(client.isLive)
    }

    func testStartWiresSinkBeforeConnect() async {
        let room = SpyRoom()
        let sink = SpySink()
        let (client, _) = makeClient(result: .success(makeCreds()), room: room)
        client.frameSink = sink

        await client.start()

        // Sink is set before the connect call so no early frame is dropped.
        XCTAssertEqual(room.sinkHistory.first, true)
    }

    // MARK: - Failure paths

    func testTokenFetchFailureLeavesFailedAndNeverConnects() async {
        let room = SpyRoom()
        let (client, _) = makeClient(result: .failure(.noActiveSession), room: room)

        await client.start()

        XCTAssertEqual(client.state, .failed)
        XCTAssertTrue(room.connectCalls.isEmpty, "room must not connect when token fetch fails")
        // Sink was set then cleared on failure.
        XCTAssertEqual(room.sinkHistory.last, false)
    }

    func testConnectFailureLeavesFailed() async {
        let room = SpyRoom()
        room.connectError = TestError()
        let (client, _) = makeClient(result: .success(makeCreds()), room: room)

        await client.start()

        XCTAssertEqual(client.state, .failed)
        XCTAssertEqual(room.connectCalls.count, 1)
    }

    // MARK: - Single-subscriber guard

    func testReentrantStartDoesNotOpenSecondConnection() async {
        let room = SpyRoom()
        let (client, calls) = makeClient(result: .success(makeCreds()), room: room)

        await client.start()          // → connecting
        await client.start()          // no-op (connecting)
        room.fireVideoTrackReady()    // → live
        await client.start()          // no-op (live)

        XCTAssertEqual(calls.count, 1, "token fetched exactly once")
        XCTAssertEqual(room.connectCalls.count, 1, "room connected exactly once")
    }

    // MARK: - Stop + disconnect

    func testStopDisconnectsDetachesSinkAndFlushes() async {
        let room = SpyRoom()
        let sink = SpySink()
        let (client, _) = makeClient(result: .success(makeCreds()), room: room)
        client.frameSink = sink

        await client.start()
        room.fireVideoTrackReady()
        await client.stop()

        XCTAssertEqual(room.disconnectCount, 1)
        XCTAssertEqual(room.sinkHistory.last, false, "sink detached on stop")
        XCTAssertEqual(sink.flushCount, 1, "renderer flushed on stop")
        XCTAssertEqual(client.state, .disconnected)
    }

    func testDisconnectWithErrorGoesFailed() async {
        let room = SpyRoom()
        let (client, _) = makeClient(result: .success(makeCreds()), room: room)

        await client.start()
        room.fireVideoTrackReady()
        room.fireDisconnected(TestError())

        XCTAssertEqual(client.state, .failed)
    }

    func testCleanDisconnectGoesDisconnected() async {
        let room = SpyRoom()
        let (client, _) = makeClient(result: .success(makeCreds()), room: room)

        await client.start()
        room.fireVideoTrackReady()
        room.fireDisconnected(nil)

        XCTAssertEqual(client.state, .disconnected)
    }

    // MARK: - Token decode contract

    func testDecodeParsesNativeTokenResponse() throws {
        let json = """
        {"sessionId":"s1","roomName":"r1","url":"wss://lk/rtc","token":"tok",
         "avatarId":"av1","consumer":"native","subscribeOnly":true,"expiresAt":"2026-01-01T00:00:00Z"}
        """.data(using: .utf8)!

        let creds = try HTTPNativeAvatarTokenProvider.decode(json)

        XCTAssertEqual(creds.sessionId, "s1")
        XCTAssertEqual(creds.roomName, "r1")
        XCTAssertEqual(creds.url, "wss://lk/rtc")
        XCTAssertEqual(creds.token, "tok")
        XCTAssertEqual(creds.avatarId, "av1")
        XCTAssertEqual(creds.expiresAt, "2026-01-01T00:00:00Z")
    }

    func testDecodeRejectsMissingToken() {
        let json = #"{"sessionId":"s1","roomName":"r1","url":"wss://lk/rtc"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try HTTPNativeAvatarTokenProvider.decode(json))
    }

    func testNativeTokenURLDerivesFromApiBase() {
        let base = URL(string: "http://host:4201/api")!
        let url = HTTPNativeAvatarTokenProvider.nativeTokenURL(from: base)
        XCTAssertEqual(url.absoluteString, "http://host:4201/avatar/native-token")
    }

    // MARK: - Connect timeout + failure reason (adj-207.5.3)

    /// Manual watchdog double — captures the timeout callback so the test fires it
    /// deterministically (no wall-clock).
    private final class ManualTimeout: BridgeConnectTimeout {
        private(set) var startCount = 0
        private(set) var cancelCount = 0
        private var onTimeout: (() -> Void)?
        func start(_ onTimeout: @escaping () -> Void) { startCount += 1; self.onTimeout = onTimeout }
        func cancel() { cancelCount += 1; onTimeout = nil }
        func fire() { onTimeout?() }
    }

    private func makeClientWithTimeout(
        result: Result<NativeAvatarCreds, NativeAvatarTokenError>,
        room: SpyRoom,
        timeout: ManualTimeout
    ) -> NativeAvatarClient {
        let provider = StubTokenProvider(result: result, calls: .init())
        return NativeAvatarClient(tokenProvider: provider, room: room, connectTimeout: timeout)
    }

    func testConnectTimeoutFailsWithVisibleReasonWhenNoVideoTrack() async {
        let room = SpyRoom()
        let timeout = ManualTimeout()
        let client = makeClientWithTimeout(result: .success(makeCreds()), room: room, timeout: timeout)

        await client.start()          // joins room, stays .connecting (no video track fired)
        XCTAssertEqual(client.state, .connecting)
        XCTAssertEqual(timeout.startCount, 1, "watchdog armed on start")

        timeout.fire()                // the avatar video never arrived

        XCTAssertEqual(client.state, .failed)
        XCTAssertNotNil(client.failureReason)
        XCTAssertTrue(client.failureReason?.contains("timed out") == true,
                      "reason surfaces the no-video timeout, not a silent hang")
    }

    func testTimeoutCanceledOnceLive() async {
        let room = SpyRoom()
        let timeout = ManualTimeout()
        let client = makeClientWithTimeout(result: .success(makeCreds()), room: room, timeout: timeout)

        await client.start()
        room.fireVideoTrackReady()    // → live, watchdog canceled
        XCTAssertEqual(client.state, .live)
        XCTAssertGreaterThanOrEqual(timeout.cancelCount, 1)

        timeout.fire()                // a late fire must NOT knock a live client to failed
        XCTAssertEqual(client.state, .live)
        XCTAssertNil(client.failureReason)
    }

    func testTokenFailureSetsHumanReadableFailureReason() async {
        let room = SpyRoom()
        let timeout = ManualTimeout()
        let client = makeClientWithTimeout(result: .failure(.noActiveSession), room: room, timeout: timeout)

        await client.start()

        XCTAssertEqual(client.state, .failed)
        XCTAssertEqual(client.failureReason, "no active Bridge session to attach to")
        XCTAssertGreaterThanOrEqual(timeout.cancelCount, 1, "watchdog canceled on token failure")
    }

    func testConnectErrorSetsFailureReason() async {
        let room = SpyRoom()
        room.connectError = TestError()
        let timeout = ManualTimeout()
        let client = makeClientWithTimeout(result: .success(makeCreds()), room: room, timeout: timeout)

        await client.start()

        XCTAssertEqual(client.state, .failed)
        XCTAssertTrue(client.failureReason?.contains("room join failed") == true)
    }
}
