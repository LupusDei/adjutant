import AVFoundation
import AVKit
import Foundation

// MARK: - AVKit seam

/// The `AVPictureInPictureController` dependency behind a protocol so
/// `BridgePiPController`'s start/stop + possibility gating + single-controller guard
/// are unit-tested with a spy — no real AVKit, no device, no simulator media.
/// `AVKitPiPController` is the production adapter.
///
/// Callbacks bridge the AVKit delegate so the handoff coordinator (adj-207.5) learns
/// when the OS actually entered/left PiP (the transition is OS-driven and async).
@MainActor
protocol PictureInPictureControlling: AnyObject {
    /// Whether PiP can be started right now (enough content, foreground, supported).
    var isPictureInPicturePossible: Bool { get }
    /// Whether a PiP window is currently active.
    var isPictureInPictureActive: Bool { get }
    /// Fired when the OS finished entering PiP.
    var onDidStart: (() -> Void)? { get set }
    /// Fired when the OS finished leaving PiP (restore / user-close).
    var onDidStop: (() -> Void)? { get set }
    /// Fired when starting PiP fails.
    var onFailedToStart: ((Error) -> Void)? { get set }
    /// Fired when `isPictureInPicturePossible` changes — so a start requested BEFORE
    /// content was flowing can fire the moment PiP becomes possible (adj-207.5.3).
    var onPossibleChanged: (() -> Void)? { get set }
    func startPictureInPicture()
    func stopPictureInPicture()
}

// MARK: - Controller

/// Wraps the system Picture-in-Picture controller over the native avatar's
/// `AVSampleBufferDisplayLayer` (adj-207.4.4). It drives the ONE PiP window the Bridge
/// can occupy; the handoff coordinator (adj-207.5) calls `start`/`stop`.
///
/// Invariants (the tested behaviour):
///   - **Single controller**: exactly one PiP controller is wrapped; there is never a
///     second PiP window (`start` while active is a no-op).
///   - **Possibility gating**: `start` is a no-op unless the OS reports PiP possible
///     (and a controller exists — some devices don't support PiP).
///   - **State tracking**: `state`/`isPiPActive` reflect the OS-driven start/stop
///     transitions so the coordinator can restore the in-app window on exit.
///
/// `@MainActor @Observable` — AVKit is main-thread only and SwiftUI observes `state`.
@MainActor
@Observable
final class BridgePiPController {
    enum State: Equatable, Sendable {
        case inactive
        case active
    }

    private(set) var state: State = .inactive

    /// Forwarded to the handoff coordinator (adj-207.5): the OS entered / left PiP.
    var onDidStart: (() -> Void)?
    var onDidStop: (() -> Void)?
    var onFailedToStart: ((Error) -> Void)?

    /// `nil` when PiP is unsupported on this device — every intent is then a safe no-op.
    private let controller: PictureInPictureControlling?

    /// Cheap, allocation-free check of whether this device supports system PiP at
    /// all. Used to decide whether to lazily build the (expensive) native PiP surface
    /// — so we never construct a LiveKit room / AVKit controller on a device (or
    /// simulator) that can't do PiP anyway (adj-207.5).
    static var isDevicePiPSupported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

    /// True when a `start()` was requested but PiP was not yet possible (no frames /
    /// layer off-screen). It fires automatically once PiP becomes possible, so a
    /// hand-off isn't a silent no-op just because the request raced the first frame
    /// (adj-207.5.3).
    private(set) var isStartPending = false

    init(controller: PictureInPictureControlling?) {
        self.controller = controller
        controller?.onDidStart = { [weak self] in
            self?.isStartPending = false
            self?.state = .active
            bridgePiPLog.info("pip: did START")
            self?.onDidStart?()
        }
        controller?.onDidStop = { [weak self] in
            self?.isStartPending = false
            self?.state = .inactive
            bridgePiPLog.info("pip: did STOP")
            self?.onDidStop?()
        }
        controller?.onFailedToStart = { [weak self] error in
            self?.isStartPending = false
            self?.state = .inactive
            bridgePiPLog.error("pip: FAILED to start: \(error.localizedDescription, privacy: .public)")
            self?.onFailedToStart?(error)
        }
        controller?.onPossibleChanged = { [weak self] in
            self?.startIfPendingAndPossible()
        }
    }

    /// Whether this device supports PiP at all (a controller was created). Distinct
    /// from `isPiPPossible`, which is additionally false until content is flowing — the
    /// hand-off policy gates on *support*, then relies on the OS to make it possible.
    var isSupported: Bool { controller != nil }

    /// Whether PiP is supported AND currently possible to start.
    var isPiPPossible: Bool { controller?.isPictureInPicturePossible ?? false }

    /// Whether a PiP window is currently active (OS truth).
    var isPiPActive: Bool { controller?.isPictureInPictureActive ?? false }

    /// Enter system PiP. Returns `true` when a start was actually requested. When PiP
    /// is supported + not active but not YET possible (frames haven't flowed / layer
    /// not on screen), the request is REMEMBERED (`isStartPending`) and fires
    /// automatically once PiP becomes possible — so the hand-off is never a silent
    /// no-op that just races the first frame (adj-207.5.3). No-op when unsupported or
    /// already active.
    @discardableResult
    func start() -> Bool {
        guard let controller else {
            bridgePiPLog.error("pip: start requested but PiP unsupported on this device")
            return false
        }
        guard !controller.isPictureInPictureActive else { return false }
        if controller.isPictureInPicturePossible {
            isStartPending = false
            bridgePiPLog.info("pip: starting (possible=true)")
            controller.startPictureInPicture()
            return true
        }
        // Not possible yet — remember the intent; fire on the possibility change.
        isStartPending = true
        bridgePiPLog.info("pip: start deferred — PiP not possible yet (awaiting frames/onscreen)")
        return false
    }

    /// Cancel a deferred start (e.g. the hand-off was aborted). Idempotent.
    func cancelPendingStart() { isStartPending = false }

    /// Fired when PiP possibility changes: if a start was pending and PiP is now
    /// possible, start it.
    private func startIfPendingAndPossible() {
        guard isStartPending, let controller,
              controller.isPictureInPicturePossible,
              !controller.isPictureInPictureActive
        else { return }
        isStartPending = false
        bridgePiPLog.info("pip: possibility became true — starting deferred PiP")
        controller.startPictureInPicture()
    }

    /// Leave system PiP (restore to the app). No-op when not active. Also clears any
    /// pending start so an aborted hand-off doesn't later auto-enter PiP.
    func stop() {
        isStartPending = false
        guard let controller, controller.isPictureInPictureActive else { return }
        controller.stopPictureInPicture()
    }
}

// MARK: - Live-stream playback delegate

/// `AVPictureInPictureSampleBufferPlaybackDelegate` for a LIVE avatar stream: there is
/// no timeline to scrub, so it reports an infinite (live) time range, never paused, and
/// completes skip requests immediately. It also permits background audio playback so
/// the Phase-A audio session keeps voice + mic alive while in PiP over other apps.
final class BridgePiPPlaybackDelegate: NSObject, AVPictureInPictureSampleBufferPlaybackDelegate {
    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        setPlaying playing: Bool
    ) {
        // Live stream — playback is not user-pausable; nothing to toggle.
    }

    func pictureInPictureControllerTimeRangeForPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> CMTimeRange {
        // A live stream: start now, run forever. This makes AVKit show a live PiP
        // window (no scrubber) rather than a fixed-duration player.
        CMTimeRange(start: .zero, duration: .positiveInfinity)
    }

    func pictureInPictureControllerIsPlaybackPaused(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {
        // The avatar layer resizes with the PiP window automatically; nothing to do.
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        skipByInterval skipInterval: CMTime,
        completion completionHandler: @escaping () -> Void
    ) {
        // Live stream — skipping is meaningless; acknowledge immediately.
        completionHandler()
    }

    func pictureInPictureControllerShouldProhibitBackgroundAudioPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        // We DO want background audio — the Phase-A session keeps voice + mic alive.
        false
    }
}

// MARK: - AVKit adapter (production)

/// Production `PictureInPictureControlling` wrapping a real
/// `AVPictureInPictureController` built over the avatar sample-buffer display layer.
/// Returns `nil` from the failable init when the device does not support PiP, so
/// `BridgePiPController` degrades to a no-op rather than crashing.
final class AVKitPiPController: NSObject, PictureInPictureControlling {
    var onDidStart: (() -> Void)?
    var onDidStop: (() -> Void)?
    var onFailedToStart: ((Error) -> Void)?
    var onPossibleChanged: (() -> Void)?

    private let controller: AVPictureInPictureController
    /// Retained for the controller's lifetime (AVKit holds the delegate weakly).
    private let playbackDelegate: BridgePiPPlaybackDelegate
    /// KVO on `isPictureInPicturePossible` so a deferred start can fire the moment PiP
    /// becomes possible (frames flowing / layer on screen) — adj-207.5.3.
    private var possibleObservation: NSKeyValueObservation?

    @MainActor
    init?(displayLayer: AVSampleBufferDisplayLayer) {
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return nil }
        let playbackDelegate = BridgePiPPlaybackDelegate()
        let contentSource = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: displayLayer,
            playbackDelegate: playbackDelegate
        )
        self.controller = AVPictureInPictureController(contentSource: contentSource)
        self.playbackDelegate = playbackDelegate
        super.init()
        controller.delegate = self
        // Keep the PiP button/first-frame available as soon as content flows.
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        possibleObservation = controller.observe(\.isPictureInPicturePossible, options: [.new]) { [weak self] ctrl, _ in
            bridgePiPLog.info("pip: isPictureInPicturePossible=\(ctrl.isPictureInPicturePossible ? "true" : "false", privacy: .public)")
            // KVO delivers on the main thread for AVKit UI properties.
            MainActor.assumeIsolated { self?.onPossibleChanged?() }
        }
    }

    deinit { possibleObservation?.invalidate() }

    @MainActor var isPictureInPicturePossible: Bool { controller.isPictureInPicturePossible }
    @MainActor var isPictureInPictureActive: Bool { controller.isPictureInPictureActive }

    @MainActor func startPictureInPicture() { controller.startPictureInPicture() }
    @MainActor func stopPictureInPicture() { controller.stopPictureInPicture() }
}

extension AVKitPiPController: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        onDidStart?()
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        onDidStop?()
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        onFailedToStart?(error)
    }
}
