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
        // Default RoomOptions: we publish nothing (no mic/camera) — a pure subscriber.
        try await room.connect(url: url, token: token)
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

    nonisolated func room(
        _ room: Room,
        participant: RemoteParticipant,
        didSubscribeTrack publication: RemoteTrackPublication
    ) {
        let track = publication.track
        Task { @MainActor in
            if let videoTrack = track as? RemoteVideoTrack {
                self.attachVideoTrack(videoTrack)
            } else if track is RemoteAudioTrack {
                // Video-only subscriber: drop audio so the WKWebView owns it (no echo).
                try? await publication.set(subscribed: false)
            }
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            self.onDisconnected?(error)
        }
    }

    nonisolated func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        Task { @MainActor in
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
