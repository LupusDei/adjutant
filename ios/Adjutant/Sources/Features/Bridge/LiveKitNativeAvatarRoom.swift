import AVFoundation
import CoreVideo
import Foundation
import LiveKit

// MARK: - Production LiveKit room adapter (adj-207.4.2)

/// The production `NativeAvatarRoomConnecting` — wraps a real LiveKit `Room`, joins the
/// avatar room **subscribe-only**, keeps ONLY the avatar **video** track (audio is
/// unsubscribed so the Phase-A WKWebView remains the single audio owner — no echo, no
/// double playback), and streams decoded frames to the attached `NativeAvatarFrameSink`.
///
/// This is the one file that imports LiveKit. All of `NativeAvatarClient`'s logic is
/// tested against the `NativeAvatarRoomConnecting` seam with a spy, so the SDK only has
/// to compile — the media path is exercised on device.
///
/// Single-session invariant: this NEVER creates a Runway session. It joins an existing
/// room with subscribe-only creds vended by `POST /avatar/native-token`.
@MainActor
final class LiveKitNativeAvatarRoom: NSObject, NativeAvatarRoomConnecting {
    var onVideoTrackReady: (() -> Void)?
    var onAudioTrackReady: (() -> Void)?
    var onDisconnected: ((Error?) -> Void)?

    private let room: Room
    private weak var frameSink: NativeAvatarFrameSink?

    /// The renderer adapter bridging LiveKit `VideoFrame`s → `NativeAvatarVideoFrame`s.
    /// Retained for the life of the subscription so LiveKit's weak renderer reference
    /// stays alive.
    private var renderer: FrameForwardingRenderer?
    private var videoTrack: RemoteVideoTrack?

    init(room: Room = Room()) {
        self.room = room
        super.init()
        room.add(delegate: self)
    }

    func setFrameSink(_ sink: NativeAvatarFrameSink?) {
        frameSink = sink
    }

    func connect(url: String, token: String) async throws {
        // Explicit autoSubscribe (adj-207.5.7): the GWM-1 avatar is a LiveKit AGENT that
        // joins + publishes its video track LATE (1-10s after we connect). autoSubscribe
        // (default true, set explicitly here) is what makes that late track auto-subscribe
        // and reach `didSubscribeTrack` — the exact mechanism the Runway JS SDK relies on.
        try await room.connect(url: url, token: token, connectOptions: ConnectOptions(autoSubscribe: true))
        // Full-duplex (adj-207.5.6): in the session-swap the native client is the sole
        // connection, so it must publish the mic for the Commander to keep talking to the
        // avatar in PiP. Best-effort — a mic-permission/publish hiccup must not fail the
        // join (the avatar video + audio still work one-way).
        do {
            try await room.localParticipant.setMicrophone(enabled: true)
            bridgePiPLog.info("room: mic published (full-duplex)")
        } catch {
            bridgePiPLog.error("room: mic publish failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func currentRoomState() -> NativeAvatarRoomState {
        let joined = room.connectionState == .connected
        let remotes = room.remoteParticipants.values
        var hasVideo = false
        var hasAudio = false
        var videoSubscribed = false
        for participant in remotes {
            for pub in participant.trackPublications.values {
                switch pub.kind {
                case .video:
                    hasVideo = true
                    if pub.isSubscribed { videoSubscribed = true }
                case .audio:
                    hasAudio = true
                default:
                    break
                }
            }
        }
        return NativeAvatarRoomState(
            joined: joined,
            remoteParticipantCount: remotes.count,
            hasRemoteVideoTrack: hasVideo,
            hasRemoteAudioTrack: hasAudio,
            videoTrackSubscribed: videoSubscribed
        )
    }

    func disconnect() async {
        if let track = videoTrack, let renderer {
            track.remove(videoRenderer: renderer)
        }
        renderer = nil
        videoTrack = nil
        await room.disconnect()
    }

    // MARK: Track wiring

    private func attachVideoTrack(_ track: RemoteVideoTrack) {
        guard renderer == nil else { return } // keep the first avatar video track only
        bridgePiPLog.info("room: subscribed to remote avatar VIDEO track — attaching renderer")
        let sink = frameSink
        let renderer = FrameForwardingRenderer { frame in
            // Hop to the main actor to hand the frame to the sink (which drives an
            // AVSampleBufferDisplayLayer). Mirrors the SDK's own per-frame pattern.
            Task { @MainActor in sink?.enqueue(frame) }
        }
        track.add(videoRenderer: renderer)
        self.renderer = renderer
        self.videoTrack = track
        onVideoTrackReady?()
    }
}

// MARK: - RoomDelegate

extension LiveKitNativeAvatarRoom: RoomDelegate {
    // Delegate callbacks arrive off the main actor; hop back on before touching state.

    // Timeline diagnostics (adj-207.5.7): log the avatar agent JOINING and PUBLISHING so
    // the device Console shows exactly how far the pipeline gets before the timeout.
    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            bridgePiPLog.info("room: remote participant JOINED \(String(describing: participant.identity), privacy: .public)")
        }
    }

    nonisolated func room(
        _ room: Room,
        participant: RemoteParticipant,
        didPublishTrack publication: RemoteTrackPublication
    ) {
        let kind = publication.kind == .video ? "video" : (publication.kind == .audio ? "audio" : "other")
        Task { @MainActor in
            bridgePiPLog.info("room: remote PUBLISHED track kind=\(kind, privacy: .public) (autoSubscribe should now subscribe it)")
        }
    }

    nonisolated func room(
        _ room: Room,
        participant: RemoteParticipant,
        didSubscribeTrack publication: RemoteTrackPublication
    ) {
        let track = publication.track
        let kind = track is RemoteVideoTrack ? "video" : (track is RemoteAudioTrack ? "audio" : "other")
        Task { @MainActor in
            bridgePiPLog.info("room: didSubscribeTrack kind=\(kind, privacy: .public) participant=\(String(describing: participant.identity), privacy: .public)")
            if let videoTrack = track as? RemoteVideoTrack {
                self.attachVideoTrack(videoTrack)
            } else if track is RemoteAudioTrack {
                // SESSION-SWAP (adj-207.5.6): the WKWebView is CLOSED during PiP, so the
                // native client is the sole connection — KEEP the avatar audio subscribed so
                // the avatar talks in PiP (LiveKit auto-plays it; no echo now that nothing
                // else owns audio). Still note arrival for the audio-only diagnosis.
                self.onAudioTrackReady?()
            }
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            bridgePiPLog.error("room: disconnected error=\(error?.localizedDescription ?? "none", privacy: .public)")
            self.onDisconnected?(error)
        }
    }

    nonisolated func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        Task { @MainActor in
            bridgePiPLog.error("room: failed to connect error=\(error?.localizedDescription ?? "unknown", privacy: .public)")
            self.onDisconnected?(error ?? LiveKitError(.network))
        }
    }
}

// MARK: - Frame-forwarding renderer

/// A LiveKit `VideoRenderer` that converts each decoded `VideoFrame` into a
/// LiveKit-free `NativeAvatarVideoFrame` and forwards it. Rendering is `nonisolated`
/// (LiveKit calls it on a media thread); the forwarding closure is `@Sendable`.
private final class FrameForwardingRenderer: NSObject, VideoRenderer {
    private let onFrame: @Sendable (NativeAvatarVideoFrame) -> Void

    init(onFrame: @escaping @Sendable (NativeAvatarVideoFrame) -> Void) {
        self.onFrame = onFrame
    }

    // Sample-buffer display owns sizing/adaptation; we don't gate the stream.
    @MainActor var isAdaptiveStreamEnabled: Bool { false }
    @MainActor var adaptiveStreamSize: CGSize { .zero }

    nonisolated func render(frame: VideoFrame) {
        guard let pixelBuffer = frame.toCVPixelBuffer() else { return }
        onFrame(NativeAvatarVideoFrame(pixelBuffer: pixelBuffer, timeStampNs: frame.timeStampNs))
    }
}
