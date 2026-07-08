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
    /// sample-buffer layer + PiP controller, composed as the hand-off target. `nil`
    /// in the foundational host tests; created by the production `init(apiBaseURL:)`.
    /// Its `hostView` is mounted behind app content so the PiP display layer has a
    /// window.
    private(set) var pipSurface: BridgePiPSurface?

    /// Drives auto (background) + manual (pop-out) → system PiP and foreground restore
    /// (adj-207.5.1 / .5.2). `nil` until the production surface is wired.
    private(set) var pipCoordinator: BridgePiPHandoffCoordinator?

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

        // Phase B (adj-207.5): compose the native PiP surface + hand-off coordinator.
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

    private static func avatarURL(from apiBaseURL: URL) -> URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/avatar"
        components?.query = nil
        return components?.url ?? apiBaseURL
    }

    /// The surface is mounted in the app-root ZStack whenever a session exists.
    /// This is a pure function of lifecycle — navigation NEVER changes it.
    var isSurfaceMounted: Bool { session.isActive }

    // MARK: Intents (all route through the session)

    func open() { session.open() }
    func close() { session.close() }
    func show() { session.show() }
    func hide() { session.hide() }

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
        pipCoordinator?.handleScenePhase(phase)
    }

    /// Manual "pop out" control (adj-207.5.1): enter system PiP on demand. No-op if
    /// already in PiP, not live, or PiP is unsupported.
    func popOutToPiP() {
        pipCoordinator?.popOut()
    }

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
                        // US4 (adj-207.5.1): manual "pop out" → system PiP, shown only
                        // where PiP is supported.
                        .overlay(alignment: .topLeading) {
                            if host.pipSurface?.isPiPSupported == true {
                                popOutButton
                            }
                        }
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

    /// Manual "pop out" control (adj-207.5.1) — enters system PiP on demand.
    private var popOutButton: some View {
        Button {
            host.popOutToPiP()
        } label: {
            Image(systemName: "pip.enter")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .padding(8)
                .background(.black.opacity(0.55), in: Circle())
        }
        .padding(8)
        .accessibilityLabel("Pop out to Picture in Picture")
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
