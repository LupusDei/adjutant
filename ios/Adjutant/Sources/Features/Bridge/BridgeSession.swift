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
@MainActor
protocol BridgeSurface: AnyObject {
    func prepare()
    func show()
    func hide()
    func teardown()
}

// MARK: - State

/// The lifecycle of the single Bridge session.
///
/// `idle → connecting → live → backgrounded → closed`. `backgrounded` is a live
/// session whose app has been backgrounded (audio continues, Phase A); it returns
/// to `live` on foreground. `closed` is terminal for a given run — re-opening
/// starts a fresh `connecting` cycle.
enum BridgeSessionState: Equatable, Sendable {
    case idle
    case connecting
    case live
    case backgrounded
    case closed
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
        // Open a brand-new session (from a cold or previously-closed machine).
        case (.idle, .open), (.closed, .open):
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

        // Everything else (illegal / idempotent) is inert.
        default:
            return (state, [])
        }
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

    init(surface: BridgeSurface) {
        self.surface = surface
    }

    /// True while a session exists in a connecting/live/backgrounded state.
    var isActive: Bool {
        switch state {
        case .connecting, .live, .backgrounded:
            return true
        case .idle, .closed:
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

    // MARK: Machine

    private func dispatch(_ event: BridgeSessionEvent) {
        let result = BridgeSessionReducer.reduce(state, event)
        state = result.state
        for effect in result.effects {
            apply(effect)
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
