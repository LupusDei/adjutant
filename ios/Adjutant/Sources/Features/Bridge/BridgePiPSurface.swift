import AVFoundation
import Foundation
import UIKit

// MARK: - Production PiP surface (adj-207.5)

/// The production `BridgePiPHandoffTarget`: composes the native LiveKit subscriber
/// (`NativeAvatarClient`), the sample-buffer renderer (`AvatarSampleBufferRenderer` →
/// `AVSampleBufferDisplayLayer`), and the system PiP controller (`BridgePiPController`)
/// into the one object the hand-off coordinator drives (adj-207.5.1 / .5.2).
///
/// It is the SECOND subscriber to the ONE avatar session — it renders the avatar video
/// into a PiP-capable layer. It NEVER closes the Bridge session or stops audio: the
/// Phase-A WKWebView surface + `BridgeAudioSession` own voice + mic throughout, so audio
/// is continuous across floating → background → PiP → foreground (the continuity
/// invariant is structural — this type has no session/audio handle).
///
/// The native subscriber is started lazily on the first hand-off and released when PiP
/// ends, so the (unconfirmed-cost) 2nd Runway subscriber only exists while actually in
/// PiP — never for the whole session.
@MainActor
final class BridgePiPSurface: BridgePiPHandoffTarget {
    /// The hosting view whose backing layer is the `AVSampleBufferDisplayLayer` PiP
    /// controls. Mounted (typically off-screen / behind the WKWebView) by the host so
    /// the layer has a window — a requirement for `AVPictureInPictureController`.
    let hostView: AvatarSampleBufferUIView

    private let client: NativeAvatarClient
    private let renderer: AvatarSampleBufferRenderer
    private let pip: BridgePiPController
    private let sessionLiveProvider: () -> Bool
    private let restoreWindow: () -> Void

    /// True while a hand-off wants PiP up — used to start PiP the moment the native
    /// subscriber goes live (frames flowing), since the join is async.
    private var wantsPiP = false

    /// - Parameters:
    ///   - apiBaseURL: app API base; the native token is fetched from `{origin}/avatar/native-token`.
    ///   - sessionLive: whether the ONE Bridge session is currently live/backgrounded-live.
    ///   - restoreWindow: bring the in-app floating window back (called on PiP exit).
    convenience init(
        apiBaseURL: URL,
        sessionLive: @escaping () -> Bool,
        restoreWindow: @escaping () -> Void
    ) {
        let hostView = AvatarSampleBufferUIView()
        let display = SystemSampleBufferDisplay(layer: hostView.displayLayer)
        let renderer = AvatarSampleBufferRenderer(display: display)
        let tokenProvider = HTTPNativeAvatarTokenProvider(apiBaseURL: apiBaseURL)
        let room = LiveKitNativeAvatarRoom()
        let client = NativeAvatarClient(tokenProvider: tokenProvider, room: room)
        let avkit: PictureInPictureControlling? = AVKitPiPController(displayLayer: hostView.displayLayer)
        let pip = BridgePiPController(controller: avkit)
        self.init(
            hostView: hostView,
            client: client,
            renderer: renderer,
            pip: pip,
            sessionLive: sessionLive,
            restoreWindow: restoreWindow
        )
    }

    /// Designated initializer — all collaborators injected (production convenience above,
    /// spies possible for integration tests).
    init(
        hostView: AvatarSampleBufferUIView,
        client: NativeAvatarClient,
        renderer: AvatarSampleBufferRenderer,
        pip: BridgePiPController,
        sessionLive: @escaping () -> Bool,
        restoreWindow: @escaping () -> Void
    ) {
        self.hostView = hostView
        self.client = client
        self.renderer = renderer
        self.pip = pip
        self.sessionLiveProvider = sessionLive
        self.restoreWindow = restoreWindow

        client.frameSink = renderer
        client.onStateChanged = { [weak self] state in
            guard let self else { return }
            // Start PiP as soon as the avatar video is actually flowing.
            if state == .live, self.wantsPiP { self.pip.start() }
        }
        pip.onDidStop = { [weak self] in self?.handlePiPStopped() }
    }

    // MARK: BridgePiPHandoffTarget

    var isSessionLive: Bool { sessionLiveProvider() }
    var isPiPActive: Bool { pip.isPiPActive }
    var isPiPSupported: Bool { pip.isSupported }

    func enterPiP() {
        guard !pip.isPiPActive else { return }
        wantsPiP = true
        if client.isLive {
            pip.start()
        } else {
            // Join the room; PiP starts from onStateChanged when frames flow.
            Task { await client.start() }
        }
    }

    func exitPiP() {
        wantsPiP = false
        pip.stop()
    }

    func restoreInAppWindow() {
        wantsPiP = false
        restoreWindow()
        // Release the 2nd subscriber — the in-app surface is the WKWebView again.
        Task { await client.stop() }
    }

    // MARK: Internal

    /// The OS left PiP (foreground restore or the user closed the PiP window). Bring the
    /// in-app window back and drop the native subscriber — audio/session are untouched.
    private func handlePiPStopped() {
        restoreInAppWindow()
    }
}
