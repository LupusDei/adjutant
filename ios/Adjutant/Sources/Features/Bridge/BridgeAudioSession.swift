import AVFoundation
import Foundation

// MARK: - Duplex mode

/// Whether the background audio session keeps the **microphone live** (full duplex,
/// the Commander can keep talking) or plays back only (`listenOnly`).
///
/// `listenOnly` is the **documented fallback** (US2): if iOS suspends WKWebView mic
/// capture in the background — or no input device is available — the build degrades
/// to playback-only with a visible indicator rather than silently losing the mic.
enum BridgeAudioDuplexMode: Equatable, Sendable {
    /// Mic + playback. The default: the Commander can talk while backgrounded.
    case fullDuplex
    /// Playback only — documented degrade when background mic is unreliable.
    case listenOnly
}

// MARK: - Interruption phase

/// A normalized audio interruption (phone call, Siri, another app taking audio).
///
/// Parsed from `AVAudioSession.interruptionNotification` by
/// `BridgeAudioSession.interruption(from:)` so the handling logic never touches
/// raw `userInfo` dictionaries and is unit-testable.
enum BridgeAudioInterruption: Equatable, Sendable {
    case began
    /// The system says the interruption ended; `shouldResume` reflects the
    /// `.shouldResume` option (true when we're allowed to reactivate).
    case ended(shouldResume: Bool)
}

// MARK: - Activation decision (pure)

/// What a disruption implies for the session's active state. Emitted by the pure
/// `BridgeAudioPolicy` and applied by `BridgeAudioSession` — keeping the *decision*
/// (pure, testable) separate from the *system call* (the seam).
enum BridgeAudioActivation: Equatable, Sendable {
    case activate
    case deactivate
    case noChange
}

// MARK: - AVAudioSession seam

/// The injectable seam over `AVAudioSession.sharedInstance()`.
///
/// Hoisting the three calls the Bridge needs behind a protocol lets the
/// interruption / route-change / duplex logic be fully unit-tested with a spy —
/// **no real audio hardware, no simulator media stack**. `SystemAudioSession`
/// forwards to the real singleton in production.
@MainActor
protocol AudioSessionControlling: AnyObject {
    func setCategory(
        _ category: AVAudioSession.Category,
        mode: AVAudioSession.Mode,
        options: AVAudioSession.CategoryOptions
    ) throws
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws

    /// Whether an input route (mic) is currently available — drives the
    /// full-duplex → listen-only auto-degrade.
    var isInputAvailable: Bool { get }
    /// Current output route port types (e.g. `.bluetoothA2DP`, `.carAudio`) — used
    /// for diagnostics / future route-aware policy.
    var currentRoutePortTypes: [AVAudioSession.Port] { get }
}

/// Production `AudioSessionControlling` backed by the real shared `AVAudioSession`.
@MainActor
final class SystemAudioSession: AudioSessionControlling {
    private let session = AVAudioSession.sharedInstance()

    func setCategory(
        _ category: AVAudioSession.Category,
        mode: AVAudioSession.Mode,
        options: AVAudioSession.CategoryOptions
    ) throws {
        try session.setCategory(category, mode: mode, options: options)
    }

    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
        try session.setActive(active, options: options)
    }

    var isInputAvailable: Bool { session.isInputAvailable }

    var currentRoutePortTypes: [AVAudioSession.Port] {
        session.currentRoute.outputs.map(\.portType)
    }
}

// MARK: - Policy (pure, no I/O, no isolation)

/// Pure audio-session policy: the category/mode/options for a given duplex mode and
/// the activation decision for each disruption. No `AVAudioSession` calls, no state
/// — every function is a value → value mapping so the load-bearing behaviour is
/// unit-tested in isolation from the hardware seam.
enum BridgeAudioPolicy {
    /// Category is always `.playAndRecord`: it is the only category that both plays
    /// avatar audio AND captures the mic, and it is the one gated by the `audio`
    /// `UIBackgroundMode` for background continuation. Listen-only keeps the same
    /// category (so the background-audio entitlement holds) and simply drops the
    /// voice-processing mode.
    static let category: AVAudioSession.Category = .playAndRecord

    /// Full-duplex uses `.voiceChat` (input processing + echo cancellation for a
    /// live conversation); listen-only uses `.default` (no capture processing).
    static func mode(for duplex: BridgeAudioDuplexMode) -> AVAudioSession.Mode {
        switch duplex {
        case .fullDuplex: return .voiceChat
        case .listenOnly: return .default
        }
    }

    /// Route options: allow Bluetooth (HFP mic for AirPods/CarPlay) + A2DP + AirPlay
    /// and default to the speaker. We deliberately do **not** set `.mixWithOthers`:
    /// the avatar is the primary conversational audio, not a background layer.
    static func options(for duplex: BridgeAudioDuplexMode) -> AVAudioSession.CategoryOptions {
        [.allowBluetooth, .allowBluetoothA2DP, .allowAirPlay, .defaultToSpeaker]
    }

    /// An interruption's effect on activation: `began` relinquishes, `ended`
    /// reactivates only when the system grants `.shouldResume`.
    static func interruptionActivation(_ phase: BridgeAudioInterruption) -> BridgeAudioActivation {
        switch phase {
        case .began: return .deactivate
        case .ended(let shouldResume): return shouldResume ? .activate : .noChange
        }
    }

    /// A route change's effect: only `oldDeviceUnavailable` (headphones/CarPlay
    /// dropped) needs a re-assert so audio recovers on the new route; other reasons
    /// route automatically and need no action.
    static func routeChangeActivation(reason: AVAudioSession.RouteChangeReason) -> BridgeAudioActivation {
        switch reason {
        case .oldDeviceUnavailable: return .activate
        default: return .noChange
        }
    }
}

// MARK: - Bridge coordination seam

/// The narrow surface `BridgeSession` drives on lifecycle transitions, behind a
/// protocol so the background-audio hook (adj-207.3.2) is unit-testable with a spy
/// — the session never needs a real `AVAudioSession`. `start`/`stop` bundle
/// configuration + activation + notification observation so the session only
/// expresses intent ("we're live / backgrounded" → start; "closed" → stop).
@MainActor
protocol BridgeAudioControlling: AnyObject {
    /// Configure + activate background audio and begin observing interruptions /
    /// route changes. Idempotent — safe to call on every live/background transition.
    func startBackgroundAudio()
    /// Deactivate the session and stop observing.
    func stopBackgroundAudio()
    /// Whether the audio session has degraded to listen-only (mic dropped), for the
    /// UI indicator.
    var isListenOnly: Bool { get }
}

extension BridgeAudioSession: BridgeAudioControlling {
    func startBackgroundAudio() {
        startObserving()
        try? activate()
    }

    func stopBackgroundAudio() {
        try? deactivate()
        stopObserving()
    }
}

// MARK: - Session

/// Configures + owns the `AVAudioSession` for the Bridge's Phase-A background audio
/// (adj-207.3.1). Attaches to the ONE `BridgeSession` (single-session invariant):
/// activated on go-live / background entry, deactivated on close.
///
/// Isolation: `@MainActor` — the same isolation domain as `BridgeSession` and the
/// SwiftUI `listen-only` indicator it drives, so there is no cross-actor async
/// churn on the hot interruption/route paths. All shared mutable state
/// (`isActive`, `duplexMode`, `isInterrupted`) is therefore protected by the main
/// actor; notification callbacks hop onto it. `@Observable` so SwiftUI re-renders
/// when `isListenOnly` flips.
///
/// Design: the *decisions* live in the pure `BridgeAudioPolicy`; this type only
/// applies them through the injected `AudioSessionControlling` seam and tracks
/// observable state.
@MainActor
@Observable
final class BridgeAudioSession {

    // MARK: Observable state

    /// Current duplex mode. Starts at the preferred mode; may auto-degrade to
    /// `.listenOnly` on `activate()` (no input) or via `degradeToListenOnly`.
    private(set) var duplexMode: BridgeAudioDuplexMode

    /// Whether the session is currently active (audio routed).
    private(set) var isActive: Bool = false

    /// True between an interruption `began` and its `ended`.
    private(set) var isInterrupted: Bool = false

    /// The reason recorded the first time the session degraded to listen-only, for
    /// the UI indicator / diagnostics. `nil` while full-duplex.
    private(set) var listenOnlyReason: String?

    /// Convenience for the SwiftUI listen-only indicator.
    var isListenOnly: Bool { duplexMode == .listenOnly }

    // MARK: Dependencies

    private let controller: AudioSessionControlling
    private let notificationCenter: NotificationCenter
    private var observerTokens: [NSObjectProtocol] = []

    init(
        controller: AudioSessionControlling,
        preferredMode: BridgeAudioDuplexMode = .fullDuplex,
        notificationCenter: NotificationCenter = .default
    ) {
        self.controller = controller
        self.duplexMode = preferredMode
        self.notificationCenter = notificationCenter
    }

    /// Production convenience: real `AVAudioSession`, full-duplex preferred.
    static func makeDefault(preferredMode: BridgeAudioDuplexMode = .fullDuplex) -> BridgeAudioSession {
        BridgeAudioSession(controller: SystemAudioSession(), preferredMode: preferredMode)
    }

    // MARK: Activation

    /// Configure `.playAndRecord` for the current duplex mode and activate the
    /// session so audio continues in the background. If full-duplex was requested
    /// but no input route exists, auto-degrades to listen-only first (documented
    /// fallback). Throws (and stays inactive) if the system rejects the config.
    func activate() throws {
        if duplexMode == .fullDuplex && !controller.isInputAvailable {
            setListenOnly(reason: "no microphone input route available")
        }
        try configure()
        try controller.setActive(true, options: [])
        isActive = true
        isInterrupted = false
    }

    /// Deactivate the session, notifying other apps so they can resume.
    func deactivate() throws {
        try controller.setActive(false, options: [.notifyOthersOnDeactivation])
        isActive = false
    }

    /// Degrade to listen-only (playback continues, mic dropped) with a recorded
    /// reason and a reconfigure. Idempotent — a second call while already
    /// listen-only is a no-op and keeps the original reason. This is the
    /// documented graceful degrade when background full-duplex mic proves
    /// unreliable (US2), NOT a silent failure.
    func degradeToListenOnly(reason: String) {
        guard duplexMode != .listenOnly else { return }
        setListenOnly(reason: reason)
        try? configure()
    }

    // MARK: Disruption handlers

    /// Apply an interruption (phone call / Siri). `began` marks interrupted +
    /// relinquishes; `ended(shouldResume:)` clears it and reactivates when allowed.
    func handleInterruption(_ phase: BridgeAudioInterruption) {
        switch phase {
        case .began: isInterrupted = true
        case .ended: isInterrupted = false
        }
        apply(BridgeAudioPolicy.interruptionActivation(phase))
    }

    /// Apply a route change (AirPods/CarPlay connect or disconnect). Recovers the
    /// session when the previous device vanished; inert otherwise.
    func handleRouteChange(reason: AVAudioSession.RouteChangeReason) {
        apply(BridgeAudioPolicy.routeChangeActivation(reason: reason))
    }

    // MARK: Observation wiring (production)

    /// Subscribe to interruption + route-change notifications and route them
    /// through the handlers. Kept explicit (not auto-started in `init`) so tests
    /// drive the handlers directly. Idempotent.
    func startObserving() {
        guard observerTokens.isEmpty else { return }
        let interruption = notificationCenter.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let phase = BridgeAudioSession.interruption(from: note) else { return }
            MainActor.assumeIsolated { self?.handleInterruption(phase) }
        }
        let route = notificationCenter.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let reason = BridgeAudioSession.routeChangeReason(from: note) else { return }
            MainActor.assumeIsolated { self?.handleRouteChange(reason: reason) }
        }
        observerTokens = [interruption, route]
    }

    /// Tear down notification observers.
    func stopObserving() {
        for token in observerTokens { notificationCenter.removeObserver(token) }
        observerTokens.removeAll()
    }

    // MARK: Notification parsing (pure, static)

    /// Parse an `AVAudioSession.interruptionNotification` into a normalized phase,
    /// or `nil` if the `userInfo` is malformed.
    static func interruption(from notification: Notification) -> BridgeAudioInterruption? {
        guard
            let info = notification.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return nil }

        switch type {
        case .began:
            return .began
        case .ended:
            let optsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optsRaw)
            return .ended(shouldResume: options.contains(.shouldResume))
        @unknown default:
            return nil
        }
    }

    /// Parse an `AVAudioSession.routeChangeNotification` into its reason, or `nil`.
    static func routeChangeReason(from notification: Notification) -> AVAudioSession.RouteChangeReason? {
        guard
            let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
        else { return nil }
        return reason
    }

    // MARK: Private

    private func configure() throws {
        try controller.setCategory(
            BridgeAudioPolicy.category,
            mode: BridgeAudioPolicy.mode(for: duplexMode),
            options: BridgeAudioPolicy.options(for: duplexMode)
        )
    }

    private func setListenOnly(reason: String) {
        duplexMode = .listenOnly
        if listenOnlyReason == nil { listenOnlyReason = reason }
    }

    private func apply(_ activation: BridgeAudioActivation) {
        switch activation {
        case .activate: try? activate()
        case .deactivate: try? deactivate()
        case .noChange: break
        }
    }

    // No `deinit` cleanup: a nonisolated deinit cannot touch the @MainActor
    // `observerTokens`, and the observer blocks capture `[weak self]` (they no-op
    // after dealloc). There is exactly ONE `BridgeAudioSession` app-wide and it is
    // retained for the app lifetime, so teardown flows through `stopObserving()`
    // (wired into the Bridge session close path in adj-207.3.2).
}
