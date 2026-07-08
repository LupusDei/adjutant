import SwiftUI
import UIKit

// MARK: - Host model

/// App-root owner of the single Bridge session + reusable surface (adj-207.1.2).
///
/// Exactly one `BridgeHost` exists for the app. It is mounted by
/// `BridgeHostContainer` in a `ZStack` ABOVE the navigation/tab bar, so the
/// avatar surface it holds survives when the Commander navigates other screens —
/// no unmount, no reload, no Runway re-provision. All Bridge intents
/// (open/close/show/hide) route through the owned `BridgeSession`, which
/// guarantees the single-session / single-credit-meter invariant.
///
/// Observation-framework `@Observable` so `BridgeHostContainer` re-renders when
/// `isSurfaceMounted` flips; `@MainActor` because it drives UI + WebKit.
@MainActor
@Observable
final class BridgeHost {
    /// The single session state machine. Public so surfaces/host views can read
    /// `state`/`focusRequestCount` and signal `markConnected()`.
    let session: BridgeSession

    /// The reusable Phase-A web surface the session drives and the host renders.
    let webSurface: BridgeWebSurface

    /// The US1 floating-window model (mode / frame / drag / resize / pill),
    /// owned here so window geometry persists above navigation alongside the
    /// session. Its controls route through the same single `session`.
    let windowModel: BridgeFloatingWindowModel

    /// The background-audio coordinator, when wired (production). `nil` in the
    /// foundational host tests, which don't exercise audio.
    let audio: BridgeAudioControlling?

    /// Phase-B system-PiP surface (adj-207.5): the native LiveKit subscriber +
    /// sample-buffer layer + PiP controller, composed as the hand-off target.
    ///
    /// Created **LAZILY** on the first PiP hand-off (background / pop-out) — NEVER at
    /// app launch. Constructing it eagerly in `init` would spin up a real LiveKit
    /// `Room()` + `AVPictureInPictureController` the moment `ContentView` initializes,
    /// which stalls app/test-host launch on a headless simulator (adj-207.5 regression
    /// fix). It stays `nil` in the foundational host tests and until PiP is first used.
    /// Its `hostView` is mounted behind app content once it exists.
    private(set) var pipSurface: BridgePiPSurface?

    /// Drives auto (background) + manual (pop-out) → system PiP and foreground restore
    /// (adj-207.5.1 / .5.2). Created together with `pipSurface`, lazily.
    private(set) var pipCoordinator: BridgePiPHandoffCoordinator?

    /// The API base URL retained so the PiP surface can be built lazily on first use.
    /// `nil` for the designated-init (test) path → no PiP surface is ever built.
    private var pipApiBaseURL: URL?

    /// - Parameters:
    ///   - connectTimeout: watchdog that fails the session if a connect never
    ///     reaches LIVE (adj-207.1.8). Pass `nil` to disable (unit tests);
    ///     production passes a real 20s timeout. Explicit (no default) because a
    ///     `@MainActor` default-argument value can't be built in this context.
    ///   - audio: background-audio coordinator (adj-207.3.2); `nil` in the
    ///     foundational host tests, a real `BridgeAudioSession` in production.
    init(
        webSurface: BridgeWebSurface,
        connectTimeout: BridgeConnectTimeout?,
        audio: BridgeAudioControlling? = nil
    ) {
        let session = BridgeSession(surface: webSurface, connectTimeout: connectTimeout, audio: audio)
        self.webSurface = webSurface
        self.audio = audio
        self.session = session

        // Seed a sensible initial layout from the current screen so the default
        // floating frame is reasonable before the first GeometryReader sync.
        // `minSize` is large enough that the top control row (mute/minimize/end
        // at ≥44pt) always fits without overflowing or colliding with the resize
        // grip, even at the smallest window size (adj-207.2.5 / adj-207.2.7).
        let screen = UIScreen.main.bounds.size
        let layout = BridgeWindowLayout(
            containerSize: screen,
            safeAreaInsets: BridgeWindowInsets(top: 47, leading: 0, bottom: 34, trailing: 0),
            minSize: CGSize(width: 168, height: 224)
        )
        // Wire the Mute control through the surface to the `/avatar` page's mic so
        // muting ACTUALLY disables the mic (adj-207.2.10): `muted` → mic disabled.
        self.windowModel = BridgeFloatingWindowModel(
            state: BridgeWindowState(layout: layout),
            controls: BridgeSessionWindowControls(session: session) { [webSurface] muted in
                webSurface.setMicEnabled(!muted)
            }
        )

        // Route the bottom-bar PiP button to the existing manual hand-off
        // (adj-207.2.13). Set after full init so `[weak self]` is valid; evaluated
        // lazily on tap, by which point production has a configured PiP URL.
        self.windowModel.onPopOutToPiP = { [weak self] in self?.popOutToPiP() }
    }

    /// Convenience: a default production host wired to the dashboard origin's
    /// `/avatar` page, with a real connect watchdog (adj-207.1.8) AND a real
    /// background-audio session (adj-207.3.2) so voice continues when backgrounded.
    convenience init(apiBaseURL: URL) {
        self.init(
            webSurface: BridgeWebSurface.makeDefault(url: Self.avatarURL(from: apiBaseURL)),
            connectTimeout: RealBridgeConnectTimeout(),
            audio: BridgeAudioSession.makeDefault()
        )
        // Phase B (adj-207.5): retain the base URL so the native PiP surface can be
        // built LAZILY on first hand-off. Do NOT build it here — eager construction
        // would create a LiveKit Room + AVPictureInPictureController at app launch.
        self.pipApiBaseURL = apiBaseURL
        // Now that the PiP URL is configured, offer the bottom-bar PiP control where
        // the device supports system PiP (adj-207.2.13).
        self.windowModel.isPiPSupported = isPiPAvailable
    }

    /// Lazily build the native PiP surface + hand-off coordinator on first use. No-op
    /// when already built, when there is no base URL (test path), or when the device
    /// does not support system PiP (so we never spin up a LiveKit room / AVKit
    /// controller where PiP is impossible — e.g. most simulators). Idempotent.
    private func ensurePiPSurface() {
        guard pipSurface == nil,
              let apiBaseURL = pipApiBaseURL,
              BridgePiPController.isDevicePiPSupported
        else { return }

        // `sessionLive` reads the ONE session; `restoreWindow` re-reveals the in-app
        // floating surface. Neither closure can close the session or stop audio, so
        // continuity across floating ↔ PiP is guaranteed.
        let surface = BridgePiPSurface(
            apiBaseURL: apiBaseURL,
            sessionLive: { [weak self] in
                guard let self else { return false }
                return self.session.state == .live || self.session.state == .backgrounded
            },
            restoreWindow: { [weak self] in self?.session.show() }
        )
        self.pipSurface = surface
        self.pipCoordinator = BridgePiPHandoffCoordinator(target: surface)
    }

    /// Whether the manual "pop out" control should be offered — cheap static PiP-support
    /// probe, so the button can appear WITHOUT eagerly building the PiP surface.
    var isPiPAvailable: Bool { pipApiBaseURL != nil && BridgePiPController.isDevicePiPSupported }

    private static func avatarURL(from apiBaseURL: URL) -> URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/avatar"
        components?.query = nil
        return components?.url ?? apiBaseURL
    }

    /// The surface is mounted in the app-root ZStack whenever a session exists.
    /// This is a pure function of lifecycle — navigation NEVER changes it. Stays
    /// true while minimized-to-hidden (session live), so the webview keeps running.
    var isSurfaceMounted: Bool { session.isActive }

    // MARK: LIVE-tab toggle + indicator (adj-207.2.12)

    /// Whether a Bridge session is active (connecting / live / backgrounded) — the
    /// bottom-tab LIVE item reflects this as its live indicator, even while hidden.
    var isBridgeLive: Bool { session.isActive }

    /// Whether the Bridge is minimized-to-hidden (live but not shown).
    var isBridgeHidden: Bool { windowModel.isHidden }

    /// The LIVE tab is the SINGLE way in and out (adj-207.2.12):
    /// - no session  → open a fresh one (shown full-screen);
    /// - live+hidden → reveal it (show the surface again);
    /// - live+shown  → minimize it to hidden (nothing floats; session stays live).
    func toggleFromLiveTab() {
        if !session.isActive {
            windowModel.enterFullscreen()   // ensure the new session presents visibly
            open()
        } else if windowModel.isHidden {
            windowModel.reveal()
        } else {
            windowModel.minimize()
        }
    }

    // MARK: Intents (all route through the session)

    func open() { session.open() }
    func show() { session.show() }
    func hide() { session.hide() }

    /// Close the Bridge. The session tears down the WKWebView surface EXACTLY once
    /// (the single-session / teardown-once invariant). If a Phase-B PiP surface was
    /// built, also leave PiP + drop the native LiveKit subscriber (idempotent) so the
    /// close cleans up BOTH surfaces — one session, fully torn down.
    func close() {
        session.close()
        pipSurface?.teardown()
    }

    /// True when background audio has degraded to listen-only (mic dropped) — drives
    /// the listen-only indicator (adj-207.3.2).
    var isListenOnly: Bool { session.isListenOnly }

    /// Route SwiftUI `scenePhase` changes into the session's background/foreground
    /// hooks (adj-207.3.2). Backgrounding a LIVE Bridge activates background audio
    /// and keeps the avatar audio path alive; returning to `.active` restores it.
    /// Guards on the current state so `.inactive` blips and non-live sessions are
    /// no-ops (the single-session invariant holds).
    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            if session.state == .live { session.enterBackground() }
        case .active:
            if session.state == .backgrounded { session.enterForeground() }
        default:
            break
        }
        // Phase B (adj-207.5.1 / .5.2): auto-enter system PiP on background + restore
        // on foreground. Additive to the audio handling above; the session/audio are
        // untouched, so voice + mic stay continuous across the transition.
        //
        // Build the PiP surface lazily, and ONLY when it could actually be needed:
        // on background while the session is live (auto hand-off). Never on the
        // `.inactive` blip, never when idle — so we don't spin up a LiveKit room for
        // a backgrounding that isn't a live Bridge.
        if phase == .background, session.state == .live || session.state == .backgrounded {
            ensurePiPSurface()
        }
        pipCoordinator?.handleScenePhase(phase)
    }

    /// Manual "pop out" control (adj-207.5.1): enter system PiP on demand. No-op if
    /// already in PiP, not live, or PiP is unsupported. Builds the PiP surface lazily
    /// on first use.
    func popOutToPiP() {
        ensurePiPSurface()
        pipCoordinator?.popOut()
    }

    /// Visible PiP hand-off error, if any (adj-207.5.3) — so a failed pop-out shows a
    /// banner instead of silently doing nothing. `nil` while healthy.
    var pipError: String? { pipSurface?.lastError }

    /// Dismiss the PiP error banner.
    func dismissPiPError() { pipSurface?.clearError() }

    /// Hook the host container calls when the underlying navigated content
    /// changes. It is intentionally a NO-OP on the surface: the whole point of
    /// hoisting the host above navigation is that screen changes never touch the
    /// live avatar. Kept explicit so the invariant is testable.
    func notePresentedContentChanged() {
        // No-op by design — see doc comment.
    }
}

// MARK: - Host container view

/// Root container that mounts app content and overlays the persistent Bridge
/// surface ABOVE it (adj-207.1.2).
///
/// ```
/// BridgeHostContainer(host: bridgeHost) {
///     MainTabView(...)   // navigation / tab bar live here, underneath
/// }
/// ```
///
/// The surface is a sibling of `content` in the ZStack, NOT a child of the
/// navigation stack, so navigating `content` cannot unmount or reload it. When
/// no session is active the overlay is absent (zero cost).
struct BridgeHostContainer<Content: View>: View {
    @State private var host: BridgeHost
    @Environment(\.scenePhase) private var scenePhase
    private let content: Content

    init(host: BridgeHost, @ViewBuilder content: () -> Content) {
        _host = State(initialValue: host)
        self.content = content()
    }

    var body: some View {
        ZStack {
            // Phase B (adj-207.5): the native sample-buffer layer that feeds system
            // PiP, mounted BEHIND app content — occluded in-app (the WKWebView floating
            // window is the in-app surface), but present in the window so the OS can
            // lift it into a PiP window over other apps on hand-off. Not hidden (PiP
            // needs a live, un-hidden layer), just covered.
            if host.isSurfaceMounted, let pipSurface = host.pipSurface {
                HostedUIView(view: pipSurface.hostView)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            content

            if host.isSurfaceMounted {
                // US1 (adj-207.2): the draggable / resizable / minimize-to-pill
                // floating window, hosting the persistent avatar surface. Mounted
                // here in the app-root ZStack so it floats above navigated content.
                BridgeFloatingWindowView(model: host.windowModel) {
                    // US1 (adj-207.2) owns the window chrome (drag/resize/pill/
                    // close) via `windowModel`. US2 (adj-207.3) overlays the
                    // listen-only indicator on the avatar so a background mic
                    // degrade is visible inside the floating window.
                    AvatarSurfaceView(surface: host.webSurface)
                        .overlay(alignment: .top) {
                            if host.isListenOnly {
                                listenOnlyIndicator
                            }
                        }
                        // adj-207.5.3: a failed PiP hand-off shows a VISIBLE banner
                        // instead of a silent no-op. Tap to dismiss.
                        .overlay(alignment: .bottom) {
                            if let error = host.pipError {
                                pipErrorBanner(error)
                            }
                        }
                    // NB: the manual "pop out → PiP" control now lives IN the
                    // bottom control bar (adj-207.2.13), not a stranded top-corner
                    // overlay — see BridgeFloatingWindowView.fullscreenControlBar.
                }
                .transition(.opacity)
            }
        }
        // Route app foreground/background into the Bridge session so voice
        // continues while backgrounded (adj-207.3.2).
        .onChange(of: scenePhase) { _, newPhase in
            host.handleScenePhase(newPhase)
        }
    }

    /// Listen-only indicator (adj-207.3.2): shown when background full-duplex mic
    /// degrades to playback-only, so the degrade is visible — not a silent failure.
    private var listenOnlyIndicator: some View {
        Label("LISTEN-ONLY", systemImage: "mic.slash.fill")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.orange.opacity(0.85), in: Capsule())
            .padding(.top, 18)
            .frame(maxWidth: .infinity, alignment: .center)
            .allowsHitTesting(false)
            .accessibilityLabel("Bridge is listen-only; microphone paused")
    }

    /// PiP hand-off error banner (adj-207.5.3): a failed pop-out is never silent. Tap to
    /// dismiss.
    private func pipErrorBanner(_ message: String) -> some View {
        Button {
            host.dismissPiPError()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "pip.exit")
                Text(message)
                    .font(.system(size: 12, weight: .semibold))
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.red.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
            .padding(10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Picture in Picture error: \(message). Tap to dismiss.")
    }
}

// MARK: - Existing-view host

/// Hosts an already-constructed `UIView` in SwiftUI (adj-207.5). Used to mount the
/// PiP surface's sample-buffer display view — which must be a single, stable instance
/// (the PiP controller holds its layer) — rather than one SwiftUI recreates.
private struct HostedUIView: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
