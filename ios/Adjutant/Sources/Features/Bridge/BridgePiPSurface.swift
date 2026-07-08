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
@Observable
final class BridgePiPSurface: BridgePiPHandoffTarget {
    /// The hosting view whose backing layer is the `AVSampleBufferDisplayLayer` PiP
    /// controls. Mounted (typically off-screen / behind the WKWebView) by the host so
    /// the layer has a window — a requirement for `AVPictureInPictureController`.
    let hostView: AvatarSampleBufferUIView

    /// User-facing error when a PiP hand-off could NOT complete (native connect failed
    /// / timed out, or PiP never became possible). Drives the visible banner so the
    /// pop-out is NEVER a silent no-op (adj-207.5.3). `nil` while healthy / in PiP.
    private(set) var lastError: String?

    private let client: NativeAvatarClient
    private let renderer: AvatarSampleBufferRenderer
    private let pip: BridgePiPController
    private let sessionLiveProvider: () -> Bool
    private let restoreWindow: () -> Void

    /// Overall hand-off watchdog: if PiP has not become ACTIVE within the deadline
    /// after a pop-out, surface a visible error (adj-207.5.3). Injected so the timeout
    /// path is unit-testable; `nil` disables it.
    private let handoffDeadline: BridgeConnectTimeout?

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
        // 12s watchdog on the native join: if the avatar video never arrives, the
        // client fails VISIBLY instead of hanging (adj-207.5.3).
        let client = NativeAvatarClient(
            tokenProvider: tokenProvider,
            room: room,
            connectTimeout: RealBridgeConnectTimeout(seconds: 12)
        )
        let avkit: PictureInPictureControlling? = AVKitPiPController(displayLayer: hostView.displayLayer)
        let pip = BridgePiPController(controller: avkit)
        self.init(
            hostView: hostView,
            client: client,
            renderer: renderer,
            pip: pip,
            sessionLive: sessionLive,
            restoreWindow: restoreWindow,
            handoffDeadline: RealBridgeConnectTimeout(seconds: 15)
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
        restoreWindow: @escaping () -> Void,
        handoffDeadline: BridgeConnectTimeout? = nil
    ) {
        self.hostView = hostView
        self.client = client
        self.renderer = renderer
        self.pip = pip
        self.sessionLiveProvider = sessionLive
        self.restoreWindow = restoreWindow
        self.handoffDeadline = handoffDeadline

        client.frameSink = renderer
        client.onStateChanged = { [weak self] state in
            guard let self else { return }
            switch state {
            case .live where self.wantsPiP:
                // Avatar video is flowing — request PiP (starts now or when possible).
                self.pip.start()
            case .failed where self.wantsPiP:
                // Native connect failed — surface it, don't hang silently.
                self.failHandoff(reason: self.client.failureReason ?? "the native connection failed")
            default:
                break
            }
        }
        pip.onDidStart = { [weak self] in
            // PiP is up — success. Clear any pending error + the watchdog.
            self?.handoffDeadline?.cancel()
            self?.lastError = nil
        }
        pip.onDidStop = { [weak self] in self?.handlePiPStopped() }
        pip.onFailedToStart = { [weak self] error in
            self?.failHandoff(reason: error.localizedDescription)
        }
    }

    /// Dismiss the visible error (user tapped it away).
    func clearError() { lastError = nil }

    // MARK: BridgePiPHandoffTarget

    var isSessionLive: Bool { sessionLiveProvider() }
    var isPiPActive: Bool { pip.isPiPActive }
    var isPiPSupported: Bool { pip.isSupported }

    func enterPiP() {
        guard !pip.isPiPActive else { return }
        lastError = nil
        wantsPiP = true
        // Arm the overall watchdog: if PiP isn't ACTIVE by the deadline, fail visibly.
        handoffDeadline?.start { [weak self] in self?.handleHandoffTimeout() }
        bridgePiPLog.info("handoff: enterPiP requested (clientLive=\(self.client.isLive ? "yes" : "no", privacy: .public))")
        if client.isLive {
            pip.start()
        } else {
            // Join the room; PiP starts from onStateChanged when frames flow.
            Task { await client.start() }
        }
    }

    func exitPiP() {
        wantsPiP = false
        handoffDeadline?.cancel()
        pip.stop()
    }

    func restoreInAppWindow() {
        wantsPiP = false
        handoffDeadline?.cancel()
        restoreWindow()
        // Release the 2nd subscriber — the in-app surface is the WKWebView again.
        Task { await client.stop() }
    }

    /// Full teardown of the native side when the Bridge session CLOSES (adj-207.5):
    /// leave PiP (if active) and drop the native LiveKit subscriber. Idempotent — safe
    /// to call when nothing is active. The WKWebView surface + audio are torn down by
    /// the session itself, so this only cleans up the Phase-B additions.
    func teardown() {
        wantsPiP = false
        handoffDeadline?.cancel()
        pip.stop()
        Task { await client.stop() }
    }

    // MARK: Internal

    /// The OS left PiP (foreground restore or the user closed the PiP window). Bring the
    /// in-app window back and drop the native subscriber — audio/session are untouched.
    private func handlePiPStopped() {
        restoreInAppWindow()
    }

    /// The overall watchdog fired without PiP becoming active (adj-207.5.3).
    private func handleHandoffTimeout() {
        guard wantsPiP, !pip.isPiPActive else { return }
        // Best-known reason: a client failure, else "still connecting", else "no video".
        let reason = client.failureReason
            ?? (client.isLive ? "Picture in Picture didn't become available (no video frames)"
                              : "timed out connecting to the avatar")
        failHandoff(reason: reason)
    }

    /// Surface a visible hand-off failure and clean up the aborted attempt (stop the
    /// pending PiP + release the native subscriber). Never touches the session/audio.
    private func failHandoff(reason: String) {
        guard wantsPiP else { return }
        wantsPiP = false
        handoffDeadline?.cancel()
        pip.cancelPendingStart()
        lastError = "Couldn't start Picture in Picture — \(reason)"
        bridgePiPLog.error("handoff FAILED: \(reason, privacy: .public)")
        // Drop the 2nd subscriber; the WKWebView in-app surface remains the avatar.
        Task { await client.stop() }
    }
}
