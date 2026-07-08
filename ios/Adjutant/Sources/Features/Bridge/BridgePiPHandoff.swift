import SwiftUI

// MARK: - Pure handoff policy

/// The action the PiP hand-off should take for a given trigger (adj-207.5). Pure data
/// so the auto/manual/restore decisions are unit-tested in isolation from AVKit,
/// LiveKit, and scenePhase plumbing.
enum BridgePiPHandoffAction: Equatable, Sendable {
    /// Start the native subscriber + enter system PiP (background auto or manual pop-out).
    case enterPiP
    /// Leave system PiP and restore the in-app surface (foreground).
    case exitPiP
    /// Nothing to do (not live, already in the target state, PiP unsupported).
    case none
}

/// The load-bearing hand-off decisions (adj-207.5.1 / .5.2), pure and total.
///
/// US4 acceptance criteria, encoded:
///   - **Auto**: on background, a LIVE Bridge that isn't already in PiP enters PiP.
///   - **Manual**: a pop-out control enters PiP under the same precondition.
///   - **No-op if already in PiP**: entering PiP while active is `.none`.
///   - **Restore**: on foreground, an active PiP exits (→ in-app window).
///
/// Crucially, NONE of these actions closes the session or stops audio — continuity is
/// structural (see `BridgePiPHandoffCoordinator`).
enum BridgePiPHandoffPolicy {
    /// App moved to the background.
    static func onBackground(sessionLive: Bool, pipActive: Bool, pipSupported: Bool) -> BridgePiPHandoffAction {
        guard pipSupported, sessionLive, !pipActive else { return .none }
        return .enterPiP
    }

    /// App returned to the foreground.
    static func onForeground(pipActive: Bool) -> BridgePiPHandoffAction {
        pipActive ? .exitPiP : .none
    }

    /// Manual "pop out" control tapped.
    static func onManualPopOut(sessionLive: Bool, pipActive: Bool, pipSupported: Bool) -> BridgePiPHandoffAction {
        guard pipSupported, sessionLive, !pipActive else { return .none }
        return .enterPiP
    }
}

// MARK: - Hand-off target seam

/// What the coordinator can drive during a hand-off (adj-207.5). Deliberately narrow:
/// there is **no** "close session" or "stop audio" capability, so the continuity
/// invariant (audio + mic unbroken across floating → background → PiP → foreground) is
/// guaranteed by construction — the coordinator simply cannot break it.
///
/// Production composes this from `NativeAvatarClient` + `BridgePiPController` +
/// `BridgeHost` (the floating window); tests use a spy.
@MainActor
protocol BridgePiPHandoffTarget: AnyObject {
    /// Whether the ONE Bridge session is live (or backgrounded-but-live).
    var isSessionLive: Bool { get }
    /// Whether a system PiP window is currently active.
    var isPiPActive: Bool { get }
    /// Whether PiP is supported / possible on this device.
    var isPiPSupported: Bool { get }

    /// Start the native LiveKit subscriber (if needed) and request system PiP.
    func enterPiP()
    /// Request leaving system PiP (the OS then drives the did-stop callback).
    func exitPiP()
    /// Bring the in-app floating window back to the foreground surface, and release the
    /// native subscriber. NEVER touches the session or audio.
    func restoreInAppWindow()
}

// MARK: - Coordinator

/// Ties scenePhase + the manual pop-out control to the pure hand-off policy and applies
/// the resulting action to a `BridgePiPHandoffTarget` (adj-207.5.1 / .5.2).
///
/// Continuity (adj-207.5.2): the coordinator only ever enters/exits PiP and restores
/// the in-app window. It never closes the session or stops audio, so voice + mic stay
/// live across every transition — the WKWebView surface and the Phase-A
/// `BridgeAudioSession` keep running throughout.
@MainActor
final class BridgePiPHandoffCoordinator {
    private let target: BridgePiPHandoffTarget

    init(target: BridgePiPHandoffTarget) {
        self.target = target
    }

    /// Route a SwiftUI scenePhase change into the hand-off policy.
    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            apply(BridgePiPHandoffPolicy.onBackground(
                sessionLive: target.isSessionLive,
                pipActive: target.isPiPActive,
                pipSupported: target.isPiPSupported
            ))
        case .active:
            apply(BridgePiPHandoffPolicy.onForeground(pipActive: target.isPiPActive))
        case .inactive:
            break // transient — never trigger hand-off on the inactive blip
        @unknown default:
            break
        }
    }

    /// The manual "pop out" control was tapped.
    func popOut() {
        apply(BridgePiPHandoffPolicy.onManualPopOut(
            sessionLive: target.isSessionLive,
            pipActive: target.isPiPActive,
            pipSupported: target.isPiPSupported
        ))
    }

    /// Wire this to the PiP controller's `onDidStop` — the OS left PiP (user closed it
    /// or foreground restore), so bring the in-app window back. Idempotent + safe even
    /// if PiP stopped for a reason other than an explicit `exitPiP`.
    func handlePiPDidStop() {
        target.restoreInAppWindow()
    }

    private func apply(_ action: BridgePiPHandoffAction) {
        switch action {
        case .enterPiP: target.enterPiP()
        case .exitPiP: target.exitPiP()
        case .none: break
        }
    }
}
