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

    init(webSurface: BridgeWebSurface) {
        let session = BridgeSession(surface: webSurface)
        self.webSurface = webSurface
        self.session = session

        // Seed a sensible initial layout from the current screen so the default
        // floating frame is reasonable before the first GeometryReader sync.
        let screen = UIScreen.main.bounds.size
        let layout = BridgeWindowLayout(
            containerSize: screen,
            safeAreaInsets: BridgeWindowInsets(top: 47, leading: 0, bottom: 34, trailing: 0)
        )
        self.windowModel = BridgeFloatingWindowModel(
            state: BridgeWindowState(layout: layout),
            controls: BridgeSessionWindowControls(session: session)
        )
    }

    /// Convenience: a default host wired to the dashboard origin's `/avatar` page.
    convenience init(apiBaseURL: URL) {
        self.init(webSurface: BridgeWebSurface.makeDefault(url: Self.avatarURL(from: apiBaseURL)))
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
    private let content: Content

    init(host: BridgeHost, @ViewBuilder content: () -> Content) {
        _host = State(initialValue: host)
        self.content = content()
    }

    var body: some View {
        ZStack {
            content

            if host.isSurfaceMounted {
                // US1 (adj-207.2): the draggable / resizable / minimize-to-pill
                // floating window, hosting the persistent avatar surface. Mounted
                // here in the app-root ZStack so it floats above navigated content.
                BridgeFloatingWindowView(model: host.windowModel) {
                    AvatarSurfaceView(surface: host.webSurface)
                }
                .transition(.opacity)
            }
        }
    }
}
