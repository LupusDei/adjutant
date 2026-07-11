import CoreVideo
import Foundation
import os

/// Shared diagnostic log for the native PiP path (adj-207.5.3). Visible in the device
/// Console under subsystem `com.adjutant.bridge` — so a device build TELLS us where the
/// native connect / PiP hand-off breaks (token fetch, room join, track, frames, PiP).
let bridgePiPLog = Logger(subsystem: "com.adjutant.bridge", category: "pip")

// MARK: - Creds

/// Room-scoped LiveKit join creds for a READ-ONLY NATIVE consumer of the CURRENT
/// avatar session (adj-207.4.2). Returned by `POST /avatar/native-token`. The native
/// iOS client uses these to subscribe to the SAME Runway avatar room/video track for
/// system PiP — it NEVER starts a second Runway session (no double credit burn).
///
/// LiveKit-free value type so the client's logic is unit-testable without importing
/// the SDK. `Sendable` because it crosses the token-provider async boundary.
struct NativeAvatarCreds: Sendable, Equatable {
    let sessionId: String
    let roomName: String
    /// The LiveKit server URL (`wss://…`).
    let url: String
    /// Short-lived subscribe-only LiveKit access token.
    let token: String
    let avatarId: String?
    let expiresAt: String?
}

// MARK: - Token provider seam

/// Fetches `NativeAvatarCreds` from the backend broker. Behind a protocol so the
/// client's join logic is tested with a stub — no network, no live session.
/// `Sendable` so it is safe to hold across the client's async `start`.
protocol NativeAvatarTokenProviding: Sendable {
    /// Fetch room-scoped subscribe-only creds for the active avatar session.
    /// - Parameter sessionId: optionally pin to a specific session; the backend
    ///   409s if it isn't the active one. `nil` → whatever session is active.
    func fetchNativeToken(sessionId: String?) async throws -> NativeAvatarCreds
}

/// Errors the native-token fetch can surface, mapped from the backend contract in
/// `routes/avatar.ts` so callers can distinguish "no session to join" (expected,
/// retryable once a session exists) from a hard failure.
enum NativeAvatarTokenError: Error, Equatable {
    /// 409 — no active avatar session to subscribe to (the Bridge isn't live).
    case noActiveSession
    /// 501 — the backend has no native-consumer wiring (`getNativeConsumerCreds`).
    case unavailable
    /// 400 — malformed request.
    case badRequest
    /// Any other non-2xx / transport / decode failure, with the HTTP status if known.
    case failed(status: Int?)
}

// MARK: - Video frame + sink seam

/// A decoded avatar video frame, LiveKit-free so the renderer (adj-207.4.3) and its
/// tests never import the SDK. The LiveKit room adapter converts a `LiveKit.VideoFrame`
/// into this before handing it to the sink. `@unchecked Sendable`: `CVPixelBuffer` is a
/// CoreFoundation type without static `Sendable` conformance, but ownership is handed
/// off (the producer does not mutate it after emitting), so crossing to the main actor
/// is safe.
struct NativeAvatarVideoFrame: @unchecked Sendable {
    let pixelBuffer: CVPixelBuffer
    /// Capture timestamp in nanoseconds (from the WebRTC frame).
    let timeStampNs: Int64
}

/// Receives decoded frames from the subscribed avatar track. The
/// `AvatarSampleBufferRenderer` (adj-207.4.3) conforms; the room adapter pushes
/// frames here. `@MainActor` because the eventual `AVSampleBufferDisplayLayer`
/// enqueue must happen on the main thread.
@MainActor
protocol NativeAvatarFrameSink: AnyObject {
    /// Enqueue the next decoded frame for display.
    func enqueue(_ frame: NativeAvatarVideoFrame)
    /// Drop any queued frames and reset the display (stall / track-change / stop).
    func flush()
}

// MARK: - Room-state diagnostic (adj-207.5.7)

/// A LiveKit-free snapshot of the native room at (or near) the connect timeout — the
/// DECISIVE signal for why "no video received": did we JOIN? how many REMOTE
/// participants (is the avatar bot even there)? what track KINDS did they publish, and
/// is the video track actually subscribed? Surfaced verbatim in the banner + os_log so a
/// device tap tells us exactly where the pipeline stops.
struct NativeAvatarRoomState: Sendable, Equatable {
    /// Whether the LiveKit room connection reached `.connected`.
    let joined: Bool
    /// How many REMOTE participants are in the room (the avatar bot should be one).
    let remoteParticipantCount: Int
    /// Whether any remote participant published a VIDEO track publication.
    let hasRemoteVideoTrack: Bool
    /// Whether any remote participant published an AUDIO track publication.
    let hasRemoteAudioTrack: Bool
    /// Whether a remote video track is not just published but actually SUBSCRIBED
    /// (the decoded track object was received — frames should be flowing).
    let videoTrackSubscribed: Bool

    /// Concise, human-facing reason for the banner (raynor's decisive wording).
    var diagnosis: String {
        if !joined { return "did not join the LiveKit room" }
        if remoteParticipantCount == 0 {
            return "joined room, 0 remote participants (avatar never joined/started)"
        }
        if !hasRemoteVideoTrack {
            return hasRemoteAudioTrack
                ? "\(remoteParticipantCount) remote (avatar), tracks: audio only — no video published"
                : "\(remoteParticipantCount) remote (avatar), no tracks published"
        }
        if !videoTrackSubscribed {
            return "\(remoteParticipantCount) remote, video track present but not received"
        }
        return "\(remoteParticipantCount) remote, video present but no frames"
    }
}

// MARK: - Room seam

/// The LiveKit room dependency behind a protocol so `NativeAvatarClient`'s
/// connect/subscribe/teardown logic is unit-tested with a spy — no real LiveKit
/// room, no WebRTC stack, no simulator media. `LiveKitNativeAvatarRoom` is the
/// production adapter.
///
/// Contract:
///   - `setFrameSink(_:)` — where decoded avatar frames go; set BEFORE `connect`
///     so no early frame is lost. `nil` detaches.
///   - `connect(url:token:)` — join the room subscribe-only; throws on failure.
///   - `onVideoTrackReady` — fires when the remote avatar video track is subscribed
///     (the go-live signal; the client moves to `.live`).
///   - `onDisconnected` — fires on room disconnect; the associated error is `nil`
///     for a clean/local disconnect and non-`nil` for a dropped connection.
///   - `disconnect()` — leave the room and release the subscription.
@MainActor
protocol NativeAvatarRoomConnecting: AnyObject {
    var onVideoTrackReady: (() -> Void)? { get set }
    /// Fired when an AUDIO track subscribes. Used ONLY for diagnosis (adj-207.5.4): if
    /// the room joins and audio arrives but NO video track ever does, we can report the
    /// unmistakable "avatar sent audio only (no video track)" — the signature of Runway
    /// publishing video only to frontend/viewer participants, not backend handlers.
    var onAudioTrackReady: (() -> Void)? { get set }
    var onDisconnected: ((Error?) -> Void)? { get set }
    func setFrameSink(_ sink: NativeAvatarFrameSink?)
    func connect(url: String, token: String) async throws
    func disconnect() async
    /// Snapshot the current room state for the timeout diagnostic (adj-207.5.7).
    func currentRoomState() -> NativeAvatarRoomState
}

// MARK: - Client

/// The native, read-only LiveKit consumer of the ONE avatar session (adj-207.4.2).
///
/// It fetches subscribe-only creds from `POST /avatar/native-token`, joins the SAME
/// Runway avatar room, and streams the avatar video track's frames to a
/// `NativeAvatarFrameSink` (the sample-buffer renderer). It is a **second SUBSCRIBER**
/// to the single session — never a second session — so the single-session / single-
/// credit-meter invariant is preserved (the backend `native-token` route never calls
/// `broker.startSession`).
///
/// Isolation: `@MainActor` (a global actor — this IS actor isolation) to match the
/// video layer + PiP controller it ultimately feeds, avoiding cross-actor churn on the
/// hot frame path. `@Observable` so SwiftUI/PiP handoff can react to `state`.
@MainActor
@Observable
final class NativeAvatarClient {
    /// Lifecycle of the native subscriber. `idle → connecting → live`, or
    /// `→ failed` on a token/connect error, `→ disconnected` on stop / clean drop.
    enum State: Equatable, Sendable {
        case idle
        case connecting
        case live
        case failed
        case disconnected
    }

    private(set) var state: State = .idle {
        didSet { if oldValue != state { onStateChanged?(state) } }
    }

    /// Fired on every distinct `state` transition. The PiP surface glue (adj-207.5)
    /// uses it to start system PiP the moment the avatar video goes `.live` (frames
    /// flowing) rather than racing the async join. `nil` for the unit tests.
    var onStateChanged: ((State) -> Void)?

    /// The creds obtained for the current join, for diagnostics / re-use. `nil`
    /// until a token has been fetched.
    private(set) var creds: NativeAvatarCreds?

    /// Human-readable reason the last connect FAILED (token error, room-join error, or
    /// timeout waiting for the avatar video). Drives the visible PiP error surface
    /// (adj-207.5.3) so a stuck connect is NEVER a silent no-op. `nil` while healthy.
    private(set) var failureReason: String?

    /// Where the subscribed avatar frames are rendered. Assign the sample-buffer
    /// renderer (adj-207.4.3) before `start`; the client wires it to the room.
    weak var frameSink: NativeAvatarFrameSink?

    private let tokenProvider: NativeAvatarTokenProviding
    private let room: NativeAvatarRoomConnecting

    /// Watchdog that fails the join if the avatar video track never subscribes
    /// (adj-207.5.3) — so a 2nd-subscriber that Runway never sends video to surfaces a
    /// VISIBLE error instead of hanging in `.connecting` forever. Injected so the
    /// timeout path is unit-testable without wall-clock time; `nil` disables it (pure
    /// tests that drive the callbacks directly).
    private let connectTimeout: BridgeConnectTimeout?

    init(
        tokenProvider: NativeAvatarTokenProviding,
        room: NativeAvatarRoomConnecting,
        connectTimeout: BridgeConnectTimeout? = nil
    ) {
        self.tokenProvider = tokenProvider
        self.room = room
        self.connectTimeout = connectTimeout
        room.onVideoTrackReady = { [weak self] in self?.handleVideoTrackReady() }
        room.onDisconnected = { [weak self] error in self?.handleDisconnected(error) }
    }

    /// True once the avatar video track is subscribed and frames are flowing.
    var isLive: Bool { state == .live }

    // MARK: Intents

    /// Fetch creds and join the avatar room subscribe-only. No-op if a join is
    /// already in flight or live (single-subscriber guard) — re-entrant `start`
    /// never opens a second connection. On any token/connect error the client
    /// lands in `.failed` (retryable via another `start`).
    func start(sessionId: String? = nil) async {
        switch state {
        case .connecting, .live:
            return // already joining / joined — never a second subscription
        case .idle, .failed, .disconnected:
            break
        }

        failureReason = nil
        state = .connecting
        // Arm the watchdog: if the avatar video never subscribes, fail VISIBLY
        // instead of hanging in `.connecting` (adj-207.5.3).
        connectTimeout?.start { [weak self] in self?.handleConnectTimeout() }
        // Wire the sink up-front so frames that arrive the instant the track
        // subscribes are not dropped.
        room.setFrameSink(frameSink)

        let fetched: NativeAvatarCreds
        do {
            bridgePiPLog.info("native-token: fetching (sessionId=\(sessionId ?? "current", privacy: .public))")
            fetched = try await tokenProvider.fetchNativeToken(sessionId: sessionId)
        } catch {
            fail(reason: Self.describeTokenError(error))
            return
        }
        creds = fetched
        bridgePiPLog.info("native-token: got creds room=\(fetched.roomName, privacy: .public) url=\(fetched.url, privacy: .public)")

        do {
            bridgePiPLog.info("room: joining \(fetched.roomName, privacy: .public)")
            try await room.connect(url: fetched.url, token: fetched.token)
            bridgePiPLog.info("room: joined \(fetched.roomName, privacy: .public) — awaiting avatar video track")
        } catch {
            fail(reason: "room join failed: \(error.localizedDescription)")
            return
        }
        // Connected — remain `.connecting` until `onVideoTrackReady` fires, so
        // `.live` means "avatar video is actually flowing", not merely "room joined".
    }

    /// Leave the room and detach the sink. Idempotent — safe to call when idle.
    func stop() async {
        connectTimeout?.cancel()
        room.setFrameSink(nil)
        frameSink?.flush()
        await room.disconnect()
        state = .disconnected
    }

    // MARK: Room callbacks

    private func handleVideoTrackReady() {
        // Only a live connect (still connecting) transitions to live; a late
        // callback after stop/failure is ignored.
        guard state == .connecting else { return }
        connectTimeout?.cancel()
        bridgePiPLog.info("track: avatar video subscribed — client LIVE")
        state = .live
    }

    private func handleDisconnected(_ error: Error?) {
        // A local stop already moved us to `.disconnected`; don't overwrite.
        guard state == .connecting || state == .live else { return }
        connectTimeout?.cancel()
        if let error {
            fail(reason: "disconnected: \(error.localizedDescription)")
        } else {
            state = .disconnected
        }
    }

    /// Watchdog fired: the room joined but no avatar video track arrived in time — the
    /// most likely real-device symptom of Runway not sending video to a 2nd subscriber
    /// (adj-207.5.3). Fail VISIBLY so the PiP surface can tell the user + it's logged.
    private func handleConnectTimeout() {
        guard state == .connecting else { return }
        // DECISIVE room-state diagnostic (adj-207.5.7): at the timeout, snapshot the room
        // so we know EXACTLY where the pipeline stops — did we join? is the avatar bot a
        // remote participant? did it publish video/audio? This distinguishes "avatar never
        // joined/published" (the avatar-start-handshake gap) from "video present but not
        // received" (a subscribe/decode issue) — instead of a generic "no video".
        let s = room.currentRoomState()
        bridgePiPLog.error(
            "room-state @timeout: joined=\(s.joined ? "yes" : "no", privacy: .public) remotes=\(s.remoteParticipantCount, privacy: .public) video=\(s.hasRemoteVideoTrack ? "yes" : "no", privacy: .public) audio=\(s.hasRemoteAudioTrack ? "yes" : "no", privacy: .public) videoSubscribed=\(s.videoTrackSubscribed ? "yes" : "no", privacy: .public)"
        )
        fail(reason: s.diagnosis)
    }

    /// Central failure path: cancel the watchdog, detach the sink, record the reason,
    /// log it, and land in `.failed`.
    private func fail(reason: String) {
        connectTimeout?.cancel()
        room.setFrameSink(nil)
        failureReason = reason
        bridgePiPLog.error("native connect FAILED: \(reason, privacy: .public)")
        state = .failed
    }

    /// Map a token-fetch error to a concise, user-facing reason.
    private static func describeTokenError(_ error: Error) -> String {
        switch error {
        case NativeAvatarTokenError.noActiveSession:
            return "no active Bridge session to attach to"
        case NativeAvatarTokenError.unavailable:
            return "native PiP is not configured on the server"
        case NativeAvatarTokenError.badRequest:
            return "bad native-token request"
        case NativeAvatarTokenError.failed(let status):
            return "native-token fetch failed (HTTP \(status.map(String.init) ?? "?"))"
        default:
            return "native-token fetch failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - HTTP token provider (production)

/// Production `NativeAvatarTokenProviding` — POSTs to `{origin}/avatar/native-token`
/// (same-origin, no API key, mounted before `apiKeyAuth` like `/avatar`). Derives the
/// origin from the app's API base URL exactly like `BridgeHost.avatarURL`, so the
/// native subscriber targets the same backend the WKWebView surface loaded.
///
/// LiveKit-free (pure HTTP + JSON), so it is unit-testable with a stubbed
/// `URLProtocol` and imposes no SDK dependency on the token path.
struct HTTPNativeAvatarTokenProvider: NativeAvatarTokenProviding {
    private let endpoint: URL
    private let session: URLSession

    /// - Parameter apiBaseURL: the app's API base URL (e.g. `http://host:4201/api`).
    ///   The path is replaced with `/avatar/native-token`, matching the root-mounted
    ///   public avatar routes.
    init(apiBaseURL: URL, session: URLSession = .shared) {
        self.endpoint = Self.nativeTokenURL(from: apiBaseURL)
        self.session = session
    }

    /// Explicit-endpoint initializer for tests.
    init(endpoint: URL, session: URLSession = .shared) {
        self.endpoint = endpoint
        self.session = session
    }

    static func nativeTokenURL(from apiBaseURL: URL) -> URL {
        // adj-207.5.4 (session-swap): the native client starts a FRESH session it owns
        // (free backend-handler slot) rather than connect_backend'ing the live session
        // (that 400s — slot held by the Adjutant tool loop). `/avatar/native-session`
        // starts the fresh session; the older `/avatar/native-token` is kept server-side
        // for reference. Response shape is identical.
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/avatar/native-session"
        components?.query = nil
        return components?.url ?? apiBaseURL
    }

    func fetchNativeToken(sessionId: String?) async throws -> NativeAvatarCreds {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = sessionId.map { ["sessionId": $0] } ?? [:]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            bridgePiPLog.error("native-token: transport error to \(endpoint.absoluteString, privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw NativeAvatarTokenError.failed(status: nil)
        }

        guard let http = response as? HTTPURLResponse else {
            bridgePiPLog.error("native-token: non-HTTP response from \(endpoint.absoluteString, privacy: .public)")
            throw NativeAvatarTokenError.failed(status: nil)
        }
        if http.statusCode != 200 {
            let bodyText = String(data: data, encoding: .utf8) ?? ""
            bridgePiPLog.error("native-token: HTTP \(http.statusCode) from \(endpoint.absoluteString, privacy: .public) body=\(bodyText, privacy: .public)")
        }
        switch http.statusCode {
        case 200:
            break
        case 400:
            throw NativeAvatarTokenError.badRequest
        case 409:
            throw NativeAvatarTokenError.noActiveSession
        case 501:
            throw NativeAvatarTokenError.unavailable
        default:
            throw NativeAvatarTokenError.failed(status: http.statusCode)
        }

        return try Self.decode(data)
    }

    /// Parse the `native-token` JSON response into creds. Kept `static` + internal so
    /// the decode contract is unit-testable against a real response fixture.
    static func decode(_ data: Data) throws -> NativeAvatarCreds {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let roomName = object["roomName"] as? String,
            let url = object["url"] as? String,
            let token = object["token"] as? String,
            let sessionId = object["sessionId"] as? String
        else {
            throw NativeAvatarTokenError.failed(status: 200)
        }
        return NativeAvatarCreds(
            sessionId: sessionId,
            roomName: roomName,
            url: url,
            token: token,
            avatarId: object["avatarId"] as? String,
            expiresAt: object["expiresAt"] as? String
        )
    }
}
