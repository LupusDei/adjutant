import Combine
import SwiftUI
import UIKit

// MARK: - Control seam

/// The compact-control surface the floating window drives: mute/end plus the
/// live indicator. Kept behind a protocol so the window chrome is unit-testable
/// with a spy and never reaches into `BridgeSession` internals directly. The
/// production backing is `BridgeSessionWindowControls`, which routes through the
/// single session — preserving the single-session invariant (restore is a pure
/// window-mode change and lives on the model, not here).
@MainActor
protocol BridgeWindowControlling: AnyObject {
    /// Whether the underlying Bridge session is live (incl. backgrounded — audio
    /// continues). Drives the pill's "LIVE" affordance.
    var isLive: Bool { get }
    /// Apply a mute state — performs the ACTUAL mic mute side effect (adj-207.2.10).
    /// The desired UI mute state is owned by `BridgeFloatingWindowModel` (so the
    /// icon is reactive); this only carries out the effect.
    func setMuted(_ muted: Bool)
    /// End the Bridge (tears the session down exactly once).
    func end()
}

/// Production `BridgeWindowControlling` backed by the single `BridgeSession`.
///
/// `end()` closes the session (teardown-once invariant lives in the session).
/// `isLive` is true while live or backgrounded. `setMuted` forwards to an
/// injectable hook that the app-root host wires to the avatar surface's mic
/// (`BridgeWebSurface.setMicEnabled` → the `/avatar` page's `bridge:mic`
/// command), so muting ACTUALLY disables the mic — no more privacy no-op
/// (adj-207.2.10). Mute STATE is not stored here; the `@Observable` model owns it.
@MainActor
final class BridgeSessionWindowControls: BridgeWindowControlling {
    private let session: BridgeSession
    private let onMuteChanged: (Bool) -> Void

    /// Unified close hook (adj-207.6.2). When set, `end()` routes through it instead of calling
    /// `session.close()` directly, so ending from the floating window tears down the WHOLE
    /// Bridge via ONE path — the WKWebView session AND (when built) the native PiP surface. The
    /// host wires this to `BridgeHost.close()`. `nil` falls back to a plain session close so
    /// standalone call sites (and tests) keep working. Settable post-init because the host can
    /// only capture `self` after full initialization.
    var onEnd: (() -> Void)?

    init(
        session: BridgeSession,
        onEnd: (() -> Void)? = nil,
        onMuteChanged: @escaping (Bool) -> Void = { _ in }
    ) {
        self.session = session
        self.onEnd = onEnd
        self.onMuteChanged = onMuteChanged
    }

    var isLive: Bool {
        switch session.state {
        case .live, .backgrounded:
            return true
        case .idle, .connecting, .closed, .failed:
            return false
        }
    }

    func setMuted(_ muted: Bool) {
        onMuteChanged(muted)
    }

    func end() {
        // Route through the unified host close when wired (tears down web + native PiP as one
        // path); otherwise close the session directly. Either way teardown is exactly-once
        // (both are idempotent), so the single-session invariant is preserved (adj-207.6.2).
        if let onEnd {
            onEnd()
        } else {
            session.close()
        }
    }
}

// MARK: - View model

/// Orchestrates the Bridge floating-window chrome (adj-207.2.2).
///
/// Holds the pure `BridgeWindowState` and the control seam, and exposes the
/// intents the SwiftUI view binds to: drag / resize / snap, minimize-to-pill and
/// restore, fullscreen toggle, mute / end, and layout (rotation / keyboard)
/// updates. All geometry delegates to `BridgeWindowState` (pure, already tested);
/// this model is the thin, testable bridge between gestures and that state. The
/// view is a declarative renderer over `currentFrame` + the `is*` flags.
@MainActor
@Observable
final class BridgeFloatingWindowModel {
    private(set) var state: BridgeWindowState
    private let controls: BridgeWindowControlling

    /// Desired mute state, owned here as `@Observable` stored state so the mute
    /// icon flips IMMEDIATELY when toggled (adj-207.2.10 — previously it was read
    /// through a non-observable control reference and never updated the view).
    private(set) var isMuted: Bool = false

    init(state: BridgeWindowState, controls: BridgeWindowControlling) {
        self.state = state
        self.controls = controls
    }

    // MARK: Derived display state

    var currentFrame: CGRect { state.currentFrame }
    var layout: BridgeWindowLayout { state.layout }

    var isFullscreen: Bool { state.mode == .fullscreen }
    var isFloating: Bool { state.mode == .floating }
    /// Minimized-to-hidden: nothing floats; session stays live (adj-207.2.12).
    var isHidden: Bool { state.isHidden }

    var isLive: Bool { controls.isLive }

    /// Whether the manual "pop out → system PiP" control should be offered — the
    /// host sets this from `isPiPAvailable` (device support + configured URL).
    /// Gates the PiP button in the bottom control bar (adj-207.2.13).
    var isPiPSupported: Bool = false

    /// Routed to the host's existing manual PiP hand-off (`popOutToPiP`) — the
    /// bottom-bar PiP button calls this; no duplicate hand-off logic (adj-207.2.13).
    var onPopOutToPiP: () -> Void = {}

    // MARK: Frame gestures

    func setFloatingFrame(_ frame: CGRect) { state.setFloatingFrame(frame) }
    func dragFloating(by translation: CGSize) { state.dragFloating(by: translation) }

    /// End a drag. `momentum` is the residual velocity-derived offset (predicted
    /// end minus where the finger lifted); applying it before snapping gives the
    /// window an inertial fling toward the edge (adj-207.2.4). Zero momentum
    /// reduces to a plain snap.
    func endDrag(momentum: CGSize = .zero) {
        if momentum != .zero {
            state.dragFloating(by: momentum)
        }
        state.endDrag()
    }

    func resize(handle: BridgeWindowResizeHandle, by translation: CGSize) {
        state.resizeFloating(handle: handle, by: translation)
    }

    // MARK: Mode

    /// Minimize to hidden — nothing floats; the LIVE tab reveals it (adj-207.2.12).
    func minimize() { state.minimize() }
    /// Reveal from hidden back to the last visible mode.
    func reveal() { state.reveal() }
    func enterFloating() { state.enterFloating() }
    func enterFullscreen() { state.enterFullscreen() }

    /// Trigger the host's manual PiP hand-off (adj-207.2.13).
    func popOutToPiP() { onPopOutToPiP() }

    func toggleFullscreen() {
        if state.mode == .fullscreen {
            state.enterFloating()
        } else {
            state.enterFullscreen()
        }
    }

    // MARK: Controls (route through the session seam)

    /// Flip the mute state (reactive) AND perform the real mic mute via the
    /// control seam → surface → `/avatar` page (adj-207.2.10).
    func toggleMute() {
        isMuted.toggle()
        controls.setMuted(isMuted)
    }

    func end() { controls.end() }

    // MARK: Environment

    func updateLayout(_ newLayout: BridgeWindowLayout) { state.updateLayout(newLayout) }

    /// Rebuild the layout from a live environment (container size, safe area,
    /// keyboard) while preserving the resize tuning, then re-clamp.
    func applyEnvironment(containerSize: CGSize, safeArea: BridgeWindowInsets, keyboardInset: CGFloat) {
        var updated = state.layout
        updated.containerSize = containerSize
        updated.safeAreaInsets = safeArea
        updated.keyboardInset = keyboardInset
        state.updateLayout(updated)
    }
}

// MARK: - Chrome constants (pure, testable)

/// Shared styling + layout constants for the Bridge window chrome, plus the pure
/// adaptive-layout decision. Kept as a value-free namespace so the a11y-critical
/// numbers (HIG hit target) and the overflow rule are unit-testable without a
/// running view (adj-207.2.5 / adj-207.2.7).
enum BridgeWindowChrome {
    /// Apple HIG minimum tappable size. Used as the BASE for `@ScaledMetric` hit
    /// targets in the view, so controls start at 44pt and grow with Dynamic Type.
    static let hitTarget: CGFloat = 44

    /// Continuous corner radius for the floating window + glass control clusters.
    static let cornerRadius: CGFloat = 22

    /// Vertical space (pt) the full-screen native control bar keeps above the
    /// safe-area bottom so it clears BOTH the home indicator AND the `/avatar`
    /// page's web mic/camera row, which is pinned at `bottom: 46pt +
    /// safe-area-inset-bottom` with ~44pt pills (adj-207.2.11). 46 (row offset)
    /// + ~44 (pill) + gap ⇒ 104, so the native bar sits just above the web row
    /// without occluding it.
    static let webControlsClearance: CGFloat = 104

    /// Bottom padding for the full-screen native control bar: the live safe-area
    /// bottom inset plus the web-controls clearance. Pure so the placement is
    /// unit-testable; the raw inset is read from the window at the view layer
    /// (adj-207.2.11).
    static func fullscreenControlBarBottomPadding(safeAreaBottom: CGFloat) -> CGFloat {
        max(0, safeAreaBottom) + webControlsClearance
    }

    /// Whether the window is wide enough to show the secondary (full-screen)
    /// control beside the essential mute / minimize / end trio without the row
    /// overflowing the window or colliding with the bottom-trailing resize grip.
    /// Below the threshold the view shows only the essentials.
    static func showsExpandedControls(availableWidth: CGFloat) -> Bool {
        // 4 hit targets + inter-item + container padding.
        availableWidth >= 4 * hitTarget + 40
    }
}

// MARK: - SwiftUI chrome

/// The draggable / resizable / minimizable Bridge floating window (adj-207.2.2).
///
/// A thin declarative renderer over `BridgeFloatingWindowModel`. It hosts the
/// injected avatar `surface` at `model.currentFrame` and, depending on mode,
/// dresses it with a drag bar, corner resize handles, a minimize-to-pill control,
/// and compact mute/end controls — or collapses it to a live pill that restores
/// on tap. Mounted in the app-root `BridgeHostContainer` ZStack so it floats
/// above navigated content. All behaviour lives in the model; this view only
/// wires gestures and paints state.
struct BridgeFloatingWindowView<Surface: View>: View {
    @State private var model: BridgeFloatingWindowModel
    private let surface: Surface

    /// Cumulative-translation accumulators so each incremental gesture delta is
    /// applied once (DragGesture reports cumulative translation).
    @State private var dragAccumulated: CGSize = .zero
    @State private var resizeAccumulated: CGSize = .zero
    @State private var keyboardInset: CGFloat = 0

    /// App theme (colors / accent) so the chrome matches the app design language
    /// instead of generic glass (adj-207.2.9).
    @Environment(\.crtTheme) private var theme
    /// Honor Reduce Motion — disables the live-pulse + inertial/spring animation
    /// (adj-207.2.6).
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Hit targets start at the 44pt HIG minimum and grow with Dynamic Type
    /// (adj-207.2.5). Icon glyphs scale too.
    @ScaledMetric(relativeTo: .body) private var hitTarget: CGFloat = 44
    @ScaledMetric(relativeTo: .body) private var controlIcon: CGFloat = 19

    init(model: BridgeFloatingWindowModel, @ViewBuilder surface: () -> Surface) {
        _model = State(initialValue: model)
        self.surface = surface()
    }

    // MARK: Animation (Reduce-Motion aware)

    private var modeAnimation: Animation? {
        reduceMotion ? nil : .interactiveSpring(response: 0.32, dampingFraction: 0.86)
    }

    private var snapAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.42, dampingFraction: 0.72)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                content
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            .onAppear { syncEnvironment(proxy) }
            .onChange(of: proxy.size) { _, _ in syncEnvironment(proxy) }
            .onChange(of: keyboardInset) { _, _ in syncEnvironment(proxy) }
            .onReceive(Self.keyboardHeightPublisher) { height in
                keyboardInset = height
            }
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    private var content: some View {
        if model.isHidden {
            hiddenSurface
        } else {
            windowedSurface
        }
    }

    // MARK: Hidden (minimized) — nothing floats, session stays live (adj-207.2.12)

    /// When minimized, the Bridge is HIDDEN entirely: no surface, no chrome, no
    /// pill, no floating controls. The webview is kept in the hierarchy (composited
    /// at zero opacity, non-interactive) so the LiveKit stream + audio keep running
    /// — the session is never torn down. Re-entry is via the bottom-tab LIVE item.
    private var hiddenSurface: some View {
        let frame = model.currentFrame
        return surface
            .frame(width: frame.width, height: frame.height)
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .position(x: frame.midX, y: frame.midY)
    }

    // MARK: Windowed (fullscreen + floating) surface

    private var windowedSurface: some View {
        let frame = model.currentFrame
        let floating = model.isFloating
        let radius: CGFloat = floating ? BridgeWindowChrome.cornerRadius : 0
        return surface
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .frame(width: frame.width, height: frame.height)
            // Whole-body drag (adj-207.2.3): a clear layer beneath the controls so
            // the entire window — not just a thin bar — is a drag handle. Header,
            // resize grip and buttons are added AFTER, so they win hit-testing.
            .overlay {
                if floating {
                    Color.clear
                        .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                        .gesture(dragGesture)
                        .accessibilityHidden(true)
                }
            }
            .overlay(alignment: .top) {
                if floating { headerBar(availableWidth: frame.width) }
            }
            .overlay(alignment: .bottomTrailing) {
                if floating { resizeHandle }
            }
            // Full-screen controls live at the BOTTOM, safe-area aware, so they
            // never sit under the Dynamic Island / status bar (untappable) and
            // clear the web mic/camera row (adj-207.2.11).
            .overlay(alignment: .bottom) {
                if model.isFullscreen {
                    fullscreenControlBar
                        .padding(.bottom, BridgeWindowChrome.fullscreenControlBarBottomPadding(
                            safeAreaBottom: bottomSafeInset))
                }
            }
            .overlay {
                if floating {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(theme.accent.opacity(0.35), lineWidth: 1)
                        .allowsHitTesting(false)
                }
            }
            .shadow(color: .black.opacity(floating ? 0.4 : 0), radius: 22, x: 0, y: 12)
            .position(x: frame.midX, y: frame.midY)
            .animation(modeAnimation, value: model.isFloating)
    }

    // MARK: Drag (whole-body) with momentum

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                let delta = CGSize(
                    width: value.translation.width - dragAccumulated.width,
                    height: value.translation.height - dragAccumulated.height
                )
                model.dragFloating(by: delta)
                dragAccumulated = value.translation
            }
            .onEnded { value in
                // Inertial fling (adj-207.2.4): carry the residual predicted
                // velocity past the finger-lift point, then snap. Reduce Motion
                // suppresses the fling (adj-207.2.6).
                let momentum: CGSize = reduceMotion ? .zero : CGSize(
                    width: value.predictedEndTranslation.width - dragAccumulated.width,
                    height: value.predictedEndTranslation.height - dragAccumulated.height
                )
                dragAccumulated = .zero
                withAnimation(snapAnimation) {
                    model.endDrag(momentum: momentum)
                }
            }
    }

    // MARK: Resize

    /// Bottom-trailing corner resize grip — a ≥44pt hit target (adj-207.2.5),
    /// isolated in the corner away from the top control bar (adj-207.2.7).
    private var resizeHandle: some View {
        Image(systemName: "arrow.down.forward.and.arrow.up.backward")
            .font(.system(size: controlIcon * 0.8, weight: .bold))
            .foregroundStyle(theme.textPrimary.opacity(0.9))
            .frame(width: hitTarget, height: hitTarget)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(theme.accent.opacity(0.3), lineWidth: 0.5))
            .contentShape(Circle())
            // High priority so the corner resizes rather than dragging the body.
            .highPriorityGesture(resizeGesture)
            .padding(6)
            .accessibilityLabel("Resize Bridge window")
    }

    private var resizeGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                let delta = CGSize(
                    width: value.translation.width - resizeAccumulated.width,
                    height: value.translation.height - resizeAccumulated.height
                )
                model.resize(handle: .bottomRight, by: delta)
                resizeAccumulated = value.translation
            }
            .onEnded { _ in resizeAccumulated = .zero }
    }

    // MARK: Controls

    /// Top control cluster for the floating window. Lives at the TOP so it never
    /// collides with the bottom-trailing resize grip (adj-207.2.7); it also drops
    /// the secondary (full-screen) control on narrow windows so the row never
    /// overflows. Essentials (mute / minimize / end) are always present.
    private func headerBar(availableWidth: CGFloat) -> some View {
        let expanded = BridgeWindowChrome.showsExpandedControls(availableWidth: availableWidth)
        return HStack(spacing: expanded ? 4 : 0) {
            if expanded {
                Capsule()
                    .fill(theme.textPrimary.opacity(0.4))
                    .frame(width: 28, height: 5)
                    .padding(.leading, 4)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }

            controlButton(
                systemName: model.isMuted ? "mic.slash.fill" : "mic.fill",
                label: model.isMuted ? "Unmute microphone" : "Mute microphone",
                tint: model.isMuted ? CRTTheme.State.warning : theme.accent
            ) { model.toggleMute() }

            controlButton(systemName: "minus", label: "Minimize", tint: theme.textPrimary) {
                withAnimation(modeAnimation) { model.minimize() }
            }

            if expanded {
                controlButton(
                    systemName: "arrow.up.left.and.arrow.down.right",
                    label: "Full screen",
                    tint: theme.textPrimary
                ) { withAnimation(modeAnimation) { model.toggleFullscreen() } }
            }

            controlButton(systemName: "xmark", label: "End Bridge", tint: CRTTheme.State.error) {
                model.end()
            }
        }
        .padding(.horizontal, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.accent.opacity(0.2), lineWidth: 0.5))
        .contentShape(Capsule())
        .gesture(dragGesture)
        .padding(.horizontal, 8)
        .padding(.top, 8)
    }

    /// Full-screen native control bar (adj-207.2.11). Pinned to the BOTTOM (see
    /// the caller's safe-area-aware padding) so it clears the Dynamic Island /
    /// status bar and sits just above the web mic/camera row. Translucent so the
    /// avatar shows through; ≥44pt targets, VoiceOver labels, Reduce-Motion via
    /// `modeAnimation`. Provides the reported minimize + close, plus mute (now a
    /// working native control, adj-207.2.10) and shrink-to-window.
    private var fullscreenControlBar: some View {
        HStack(spacing: 4) {
            controlButton(
                systemName: model.isMuted ? "mic.slash.fill" : "mic.fill",
                label: model.isMuted ? "Unmute microphone" : "Mute microphone",
                tint: model.isMuted ? CRTTheme.State.warning : theme.accent
            ) { model.toggleMute() }

            controlButton(systemName: "minus", label: "Minimize", tint: theme.textPrimary) {
                withAnimation(modeAnimation) { model.minimize() }
            }

            controlButton(
                systemName: "arrow.down.right.and.arrow.up.left",
                label: "Shrink to window",
                tint: theme.textPrimary
            ) { withAnimation(modeAnimation) { model.enterFloating() } }

            // Manual "pop out" → system PiP, relocated from the stranded top corner
            // into this bar (adj-207.2.13). Hidden where PiP is unsupported so it's
            // never a dead button; routes through the host's existing hand-off.
            if model.isPiPSupported {
                controlButton(
                    systemName: "pip.enter",
                    label: "Pop out to Picture in Picture",
                    tint: theme.textPrimary
                ) { model.popOutToPiP() }
            }

            controlButton(systemName: "xmark", label: "End Bridge", tint: CRTTheme.State.error) {
                model.end()
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.accent.opacity(0.25), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.35), radius: 10, x: 0, y: 4)
    }

    /// The live bottom safe-area inset from the key window — reliable even though
    /// the surface uses `.ignoresSafeArea()` (which zeroes `GeometryReader`'s
    /// reported insets). Drives the full-screen control bar's safe-area clearance
    /// (adj-207.2.11).
    private var bottomSafeInset: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }?
            .safeAreaInsets.bottom ?? 0
    }

    /// A single control: a Dynamic-Type-scaled glyph inside a ≥44pt hit target
    /// (adj-207.2.5).
    private func controlButton(
        systemName: String,
        label: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: controlIcon, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: hitTarget, height: hitTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Environment sync

    private func syncEnvironment(_ proxy: GeometryProxy) {
        let insets = proxy.safeAreaInsets
        model.applyEnvironment(
            containerSize: proxy.size,
            safeArea: BridgeWindowInsets(
                top: insets.top,
                leading: insets.leading,
                bottom: insets.bottom,
                trailing: insets.trailing
            ),
            keyboardInset: keyboardInset
        )
    }

    /// Publishes the current keyboard overlap height on show/hide/change.
    private static var keyboardHeightPublisher: AnyPublisher<CGFloat, Never> {
        let willChange = NotificationCenter.default
            .publisher(for: UIResponder.keyboardWillChangeFrameNotification)
            .compactMap { notification -> CGFloat? in
                guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
                    return nil
                }
                let screenH = UIScreen.main.bounds.height
                // Overlap of the keyboard with the screen bottom (0 when offscreen).
                return max(0, screenH - frame.origin.y)
            }
        let willHide = NotificationCenter.default
            .publisher(for: UIResponder.keyboardWillHideNotification)
            .map { _ in CGFloat(0) }
        return willChange.merge(with: willHide).eraseToAnyPublisher()
    }
}
