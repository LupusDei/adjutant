import Foundation

// MARK: - Surface seam

/// The avatar rendering surface the Bridge session owns and drives.
///
/// In Phase A this is backed by a single, reusable `WKWebView` loading `/avatar`
/// (adj-207.1.3); in Phase B a native LiveKit view can adopt the same protocol.
/// Hoisting it behind a protocol keeps `BridgeSession`'s state logic unit-testable
/// with a spy — no real webview, no LiveKit, no simulator media stack required.
///
/// Semantics:
///   - `prepare()` — create/connect the surface exactly once per live session.
///   - `show()` / `hide()` — toggle visibility WITHOUT reloading or reconnecting.
///   - `teardown()` — destroy the surface and release the underlying stream.
///   - `onReady` — the surface fires this when it has actually loaded/connected
///     (WKWebView navigation-finished in Phase A); the session wires it to
///     `markConnected()` so open → connecting → LIVE completes (adj-207.1.5).
///   - `onFailure` — the surface fires this when the load fails
///     (navigation-failed); the session wires it to `markFailed()` so a broken
///     `/avatar` load does not hang on a black "connecting" screen (adj-207.1.8).
@MainActor
protocol BridgeSurface: AnyObject {
    func prepare()
    func show()
    func hide()
    func teardown()
    var onReady: (() -> Void)? { get set }
    var onFailure: (() -> Void)? { get set }
}

// MARK: - State

/// The lifecycle of the single Bridge session.
///
/// `idle → connecting → live → backgrounded → closed`. `backgrounded` is a live
/// session whose app has been backgrounded (audio continues, Phase A); it returns
/// to `live` on foreground. `closed` is terminal for a given run — re-opening
/// starts a fresh `connecting` cycle. `failed` is a dead-end that the surface load
/// failing (or a connect timeout) drops into instead of hanging on a black
/// "connecting" screen (adj-207.1.8); it offers `retry()` (→ connecting) or
/// `close()`.
enum BridgeSessionState: Equatable, Sendable {
    case idle
    case connecting
    case live
    case backgrounded
    case closed
    case failed
}

// MARK: - Events & effects

/// The inputs that can drive the session state machine.
enum BridgeSessionEvent: Equatable, Sendable {
    case open
    case connected
    case enterBackground
    case enterForeground
    case show
    case hide
    case close
    /// The surface load failed or the connect timed out (adj-207.1.8).
    case failed
    /// Re-attempt a fresh connection from the `failed` state (adj-207.1.8).
    case retry
}

/// Side effects the reducer asks the session to apply to its surface. Keeping
/// effects as data (not direct calls) makes every transition a pure, testable
/// value and keeps the state logic fully separate from the WebKit surface.
enum BridgeSessionEffect: Equatable, Sendable {
    case prepareSurface
    case showSurface
    case hideSurface
    case teardownSurface
    /// The single-instance guard was hit: an active session already exists, so
    /// focus it instead of creating a second one.
    case focusExisting
}

// MARK: - Reducer (pure)

/// Pure transition function for the Bridge session. No surface, no I/O — given a
/// state and an event it yields the next state plus the effects to apply. This is
/// the load-bearing invariant surface: single-instance guard, teardown-once, and
/// legal-transition-only are all decided here and unit-tested in isolation.
enum BridgeSessionReducer {
    static func reduce(
        _ state: BridgeSessionState,
        _ event: BridgeSessionEvent
    ) -> (state: BridgeSessionState, effects: [BridgeSessionEffect]) {
        switch (state, event) {
        // Open a brand-new session (from a cold, closed, or failed machine — a
        // failed session's surface is already torn down, so `open` = a clean retry).
        case (.idle, .open), (.closed, .open), (.failed, .open):
            return (.connecting, [.prepareSurface])

        // Single-instance guard: opening while ANY active session exists is a
        // no-op that focuses the existing surface — never a second `prepare`.
        case (.connecting, .open), (.live, .open), (.backgrounded, .open):
            return (state, [.focusExisting])

        // Connection established → go live and reveal the surface.
        case (.connecting, .connected):
            return (.live, [.showSurface])

        // Background / foreground continuity — the stream is NOT torn down.
        case (.live, .enterBackground):
            return (.backgrounded, [])
        case (.backgrounded, .enterForeground):
            return (.live, [])

        // Visibility is orthogonal to lifecycle: show/hide toggle the surface
        // (e.g. minimize-to-pill in US1) WITHOUT changing state or reconnecting.
        // Only meaningful while the surface exists.
        case (.live, .show), (.backgrounded, .show):
            return (state, [.showSurface])
        case (.live, .hide), (.backgrounded, .hide):
            return (state, [.hideSurface])

        // Close from any active state tears the surface down exactly once.
        case (.connecting, .close), (.live, .close), (.backgrounded, .close):
            return (.closed, [.teardownSurface])

        // Failure (load-fail or connect timeout) from any live/connecting state:
        // tear the surface down (so a retry is clean) and land in `failed`
        // instead of hanging on a black "connecting" screen (adj-207.1.8).
        case (.connecting, .failed), (.live, .failed), (.backgrounded, .failed):
            return (.failed, [.teardownSurface])

        // Recover from a failure: retry re-provisions a fresh surface; close ends
        // it (the surface is already gone, so no second teardown).
        case (.failed, .retry):
            return (.connecting, [.prepareSurface])
        case (.failed, .close):
            return (.closed, [])

        // Everything else (illegal / idempotent) is inert.
        default:
            return (state, [])
        }
    }
}

// MARK: - Connect timeout seam

/// Schedules a single "connect took too long" callback, cancellable, injected so
/// the timeout→failed path is unit-testable without waiting on wall-clock time
/// (adj-207.1.8). Production uses `RealBridgeConnectTimeout`; tests drive a manual
/// double.
@MainActor
protocol BridgeConnectTimeout: AnyObject {
    /// (Re)start the timer. Replaces any pending callback.
    func start(_ onTimeout: @escaping () -> Void)
    /// Cancel a pending callback (connected, closed, or already failed).
    func cancel()
}

/// Production connect timeout backed by a cancellable main-queue work item.
@MainActor
final class RealBridgeConnectTimeout: BridgeConnectTimeout {
    private let seconds: TimeInterval
    private var workItem: DispatchWorkItem?

    init(seconds: TimeInterval = 20) {
        self.seconds = seconds
    }

    func start(_ onTimeout: @escaping () -> Void) {
        cancel()
        let item = DispatchWorkItem { onTimeout() }
        workItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    func cancel() {
        workItem?.cancel()
        workItem = nil
    }
}

// MARK: - Session

/// The single owner of the Bridge avatar stream.
///
/// Exactly one `BridgeSession` exists app-wide; it is hosted above the SwiftUI
/// navigation (see `BridgeHostContainer`, adj-207.1.2) so the surface survives
/// screen changes. All surface transitions (full ↔ floating ↔ pill ↔ background
/// ↔ PiP, added by later phases) are state changes on this object, guaranteeing
/// exactly one Runway session / credit meter.
///
/// Observable via the Observation framework so SwiftUI re-renders on `state`
/// changes without `ObservableObject` boilerplate. `@MainActor` because it drives
/// UIKit/WebKit surfaces and SwiftUI state.
@MainActor
@Observable
final class BridgeSession {
    /// The current lifecycle state. Observed by the host + surface views.
    private(set) var state: BridgeSessionState = .idle

    /// How many times an `open()` was coalesced into a focus request because a
    /// session was already active. Surfaced so the UI can bring the existing
    /// window to front (and for the single-instance guard tests).
    private(set) var focusRequestCount = 0

    private let surface: BridgeSurface
    private let connectTimeout: BridgeConnectTimeout?

    /// Optional background-audio coordinator (adj-207.3.2). When present, lifecycle
    /// transitions drive it: going live / backgrounding starts background audio;
    /// closing (or failing) stops it. `nil` for the foundational state-machine
    /// tests, which don't exercise audio. The pure reducer is deliberately NOT
    /// aware of audio — the hook lives in `dispatch` so the reducer's effect
    /// contract is unchanged.
    private let audio: BridgeAudioControlling?

    /// - Parameters:
    ///   - surface: the avatar surface the session owns and drives.
    ///   - connectTimeout: optional watchdog that fails the session if it never
    ///     reaches `live` (adj-207.1.8). Defaults to `nil` (no timeout) so pure
    ///     state tests are timer-free; production (`BridgeHost`) injects a real one.
    ///   - audio: optional background-audio coordinator (adj-207.3.2); `nil` in the
    ///     pure state tests, a real `BridgeAudioSession` in production.
    init(
        surface: BridgeSurface,
        connectTimeout: BridgeConnectTimeout? = nil,
        audio: BridgeAudioControlling? = nil
    ) {
        self.surface = surface
        self.connectTimeout = connectTimeout
        self.audio = audio
        // Wire the surface's load/connect + failure signals to the machine so the
        // session actually reaches LIVE in production (adj-207.1.5) and drops to
        // `failed` on a broken load (adj-207.1.8).
        surface.onReady = { [weak self] in self?.markConnected() }
        surface.onFailure = { [weak self] in self?.markFailed() }
    }

    /// True when the background audio session has degraded to listen-only (mic
    /// dropped). Surfaced for the SwiftUI listen-only indicator; `false` when there
    /// is no audio coordinator.
    var isListenOnly: Bool { audio?.isListenOnly ?? false }

    /// True while a session exists in a connecting/live/backgrounded state.
    var isActive: Bool {
        switch state {
        case .connecting, .live, .backgrounded:
            return true
        case .idle, .closed, .failed:
            return false
        }
    }

    // MARK: Intents

    /// Open the Bridge. Starts a new session when idle/closed; a no-op focus when
    /// one is already active (the single-instance invariant).
    func open() { dispatch(.open) }

    /// Signal that the surface finished connecting (Runway session live). Only
    /// meaningful while `connecting`; ignored otherwise.
    func markConnected() { dispatch(.connected) }

    /// App moved to the background while live — keep the stream alive (audio).
    func enterBackground() { dispatch(.enterBackground) }

    /// App returned to the foreground — restore the live surface.
    func enterForeground() { dispatch(.enterForeground) }

    /// Reveal the surface (restore from minimized/hidden). No reconnect; only
    /// meaningful while a surface exists.
    func show() { dispatch(.show) }

    /// Hide the surface (e.g. minimize) without closing the session. No teardown.
    func hide() { dispatch(.hide) }

    /// Close the Bridge, tearing the surface down exactly once. Idempotent.
    func close() { dispatch(.close) }

    /// Fail the session (surface load error or connect timeout). Drops to `failed`
    /// from any connecting/live state; inert otherwise (adj-207.1.8).
    func markFailed() { dispatch(.failed) }

    /// Retry a failed session — re-provisions a fresh surface (adj-207.1.8).
    func retry() { dispatch(.retry) }

    // MARK: Machine

    private func dispatch(_ event: BridgeSessionEvent) {
        let previous = state
        let result = BridgeSessionReducer.reduce(state, event)
        state = result.state
        for effect in result.effects {
            apply(effect)
        }
        updateConnectWatchdog(from: previous, to: state)
        applyAudioTransition(from: previous, to: state)
    }

    /// Arm the connect watchdog on entering `connecting`; disarm it the moment we
    /// leave (LIVE, closed, or already failed) so it can only fire during an
    /// in-flight connect (adj-207.1.8).
    private func updateConnectWatchdog(from previous: BridgeSessionState, to current: BridgeSessionState) {
        guard previous != current else { return }
        if current == .connecting {
            connectTimeout?.start { [weak self] in self?.markFailed() }
        } else if previous == .connecting {
            connectTimeout?.cancel()
        }
    }

    /// Background-audio hook (adj-207.3.2). Runs AFTER the pure reducer so the
    /// reducer stays audio-agnostic. Only real state changes drive audio:
    ///   - → `.live` (go-live, or restore on foreground): start/keep audio active.
    ///   - → `.backgrounded`: re-assert background audio so voice continues while
    ///     the app is backgrounded (the WKWebView surface is left alive — never
    ///     hidden or torn down — so its audio path keeps running).
    ///   - → `.closed` / `.failed`: stop the audio session (the surface is torn
    ///     down in both, so there is no live avatar audio to keep alive).
    /// A no-op focus (open while already active) does not change state, so it never
    /// restarts audio.
    private func applyAudioTransition(from old: BridgeSessionState, to new: BridgeSessionState) {
        guard let audio, old != new else { return }
        switch new {
        case .live, .backgrounded:
            audio.startBackgroundAudio()
        case .closed, .failed:
            audio.stopBackgroundAudio()
        case .idle, .connecting:
            break
        }
    }

    private func apply(_ effect: BridgeSessionEffect) {
        switch effect {
        case .prepareSurface:
            surface.prepare()
        case .showSurface:
            surface.show()
        case .hideSurface:
            surface.hide()
        case .teardownSurface:
            surface.teardown()
        case .focusExisting:
            focusRequestCount += 1
            surface.show()
        }
    }
}
