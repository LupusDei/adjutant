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
    /// Whether the mic is currently muted.
    var isMuted: Bool { get }
    /// Toggle the mic mute state.
    func toggleMute()
    /// End the Bridge (tears the session down exactly once).
    func end()
}

/// Production `BridgeWindowControlling` backed by the single `BridgeSession`.
///
/// `end()` closes the session (teardown-once invariant lives in the session).
/// `isLive` is true while live or backgrounded. Mute is tracked here as a flag
/// and forwarded to an injectable hook — Phase A wires it to the WKWebView's mic
/// (JS bridge) and Phase B to the native LiveKit track; the window chrome only
/// needs the toggle + state.
@MainActor
final class BridgeSessionWindowControls: BridgeWindowControlling {
    private let session: BridgeSession
    private let onMuteChanged: (Bool) -> Void

    private(set) var isMuted: Bool = false

    init(session: BridgeSession, onMuteChanged: @escaping (Bool) -> Void = { _ in }) {
        self.session = session
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

    func toggleMute() {
        isMuted.toggle()
        onMuteChanged(isMuted)
    }

    func end() {
        session.close()
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

    init(state: BridgeWindowState, controls: BridgeWindowControlling) {
        self.state = state
        self.controls = controls
    }

    // MARK: Derived display state

    var currentFrame: CGRect { state.currentFrame }
    var layout: BridgeWindowLayout { state.layout }

    var isFullscreen: Bool { state.mode == .fullscreen }
    var isFloating: Bool { state.mode == .floating }
    var isPill: Bool { state.mode == .pill }

    var isLive: Bool { controls.isLive }
    var isMuted: Bool { controls.isMuted }

    // MARK: Frame gestures

    func setFloatingFrame(_ frame: CGRect) { state.setFloatingFrame(frame) }
    func dragFloating(by translation: CGSize) { state.dragFloating(by: translation) }
    func endDrag() { state.endDrag() }
    func resize(handle: BridgeWindowResizeHandle, by translation: CGSize) {
        state.resizeFloating(handle: handle, by: translation)
    }

    // MARK: Mode

    func minimize() { state.minimizeToPill() }
    func restore() { state.restore() }
    func enterFloating() { state.enterFloating() }
    func enterFullscreen() { state.enterFullscreen() }

    func toggleFullscreen() {
        if state.mode == .fullscreen {
            state.enterFloating()
        } else {
            state.enterFullscreen()
        }
    }

    // MARK: Controls (route through the session seam)

    func toggleMute() { controls.toggleMute() }
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

    init(model: BridgeFloatingWindowModel, @ViewBuilder surface: () -> Surface) {
        _model = State(initialValue: model)
        self.surface = surface()
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
        if model.isPill {
            pill
        } else {
            windowedSurface
        }
    }

    // MARK: Windowed (fullscreen + floating) surface

    private var windowedSurface: some View {
        let frame = model.currentFrame
        let floating = model.isFloating
        return ZStack(alignment: .top) {
            surface
                .clipShape(RoundedRectangle(cornerRadius: floating ? 18 : 0, style: .continuous))

            if floating {
                dragBar
            }
        }
        .frame(width: frame.width, height: frame.height)
        .overlay(alignment: .bottom) {
            if floating { controlBar }
        }
        .overlay(alignment: .bottomTrailing) {
            if floating { resizeHandle }
        }
        .overlay(alignment: .topTrailing) {
            if model.isFullscreen { fullscreenControls }
        }
        .overlay {
            if floating {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
            }
        }
        .shadow(color: .black.opacity(floating ? 0.45 : 0), radius: 24, x: 0, y: 12)
        .position(x: frame.midX, y: frame.midY)
        .animation(.interactiveSpring(response: 0.32, dampingFraction: 0.86), value: model.isFloating)
    }

    /// The top grab bar — the primary drag affordance for the floating window.
    private var dragBar: some View {
        Capsule()
            .fill(Color.white.opacity(0.55))
            .frame(width: 40, height: 5)
            .padding(.top, 8)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .accessibilityLabel("Drag Bridge window")
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                let delta = CGSize(
                    width: value.translation.width - dragAccumulated.width,
                    height: value.translation.height - dragAccumulated.height
                )
                model.dragFloating(by: delta)
                dragAccumulated = value.translation
            }
            .onEnded { _ in
                dragAccumulated = .zero
                model.endDrag()
            }
    }

    /// Bottom-trailing corner resize grip (aspect preserved by the model).
    private var resizeHandle: some View {
        Image(systemName: "arrow.up.left.and.arrow.down.right")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white.opacity(0.85))
            .frame(width: 28, height: 28)
            .background(.ultraThinMaterial, in: Circle())
            .padding(6)
            .contentShape(Rectangle())
            .gesture(resizeGesture)
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

    /// Compact mute / end / minimize / expand controls for the floating window.
    private var controlBar: some View {
        HStack(spacing: 14) {
            controlButton(
                systemName: model.isMuted ? "mic.slash.fill" : "mic.fill",
                label: model.isMuted ? "Unmute" : "Mute",
                tint: model.isMuted ? .orange : .white
            ) { model.toggleMute() }

            controlButton(systemName: "minus.circle.fill", label: "Minimize", tint: .white) {
                model.minimize()
            }

            controlButton(
                systemName: model.isFullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                label: model.isFullscreen ? "Shrink" : "Full screen",
                tint: .white
            ) { model.toggleFullscreen() }

            controlButton(systemName: "xmark.circle.fill", label: "End Bridge", tint: .red) {
                model.end()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.bottom, 10)
    }

    /// Full-screen affordances: shrink to the floating window, or end the Bridge.
    private var fullscreenControls: some View {
        HStack(spacing: 12) {
            controlButton(
                systemName: "arrow.down.right.and.arrow.up.left",
                label: "Shrink to window",
                tint: .white
            ) { model.enterFloating() }

            controlButton(systemName: "xmark.circle.fill", label: "End Bridge", tint: .white) {
                model.end()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(16)
    }

    private func controlButton(
        systemName: String,
        label: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Pill (minimized, live)

    private var pill: some View {
        let frame = model.currentFrame
        return ZStack(alignment: .topTrailing) {
            surface
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))

            if model.isLive {
                LivePulse()
                    .frame(width: 12, height: 12)
                    .padding(4)
            }
        }
        .frame(width: frame.width, height: frame.height)
        .shadow(color: .black.opacity(0.4), radius: 12, x: 0, y: 6)
        .contentShape(Circle())
        .onTapGesture { model.restore() }
        .accessibilityElement()
        .accessibilityLabel(model.isLive ? "Bridge is live — tap to restore" : "Bridge — tap to restore")
        .accessibilityAddTraits(.isButton)
        .position(x: frame.midX, y: frame.midY)
        .animation(.interactiveSpring(response: 0.32, dampingFraction: 0.86), value: model.isPill)
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

// MARK: - Live pulse

/// A small pulsing green dot signalling the pill is a live session.
private struct LivePulse: View {
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(Color.green)
            .overlay(
                Circle()
                    .stroke(Color.green.opacity(0.7), lineWidth: 2)
                    .scaleEffect(animating ? 1.9 : 1.0)
                    .opacity(animating ? 0.0 : 0.8)
            )
            .onAppear {
                withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) {
                    animating = true
                }
            }
            .accessibilityHidden(true)
    }
}
