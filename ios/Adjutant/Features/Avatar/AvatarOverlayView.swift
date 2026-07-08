import SwiftUI
import UIKit

/// The Bridge (adj-202.2.4, refactored adj-207.1.3): opens the Adjutant Runway
/// avatar. The backend-served `/avatar` page (which creates a Runway GWM-1
/// session server-side and renders the live avatar via the Runway web SDK) is now
/// rendered by a session-owned, REUSABLE `BridgeWebSurface` — the WKWebView and
/// its permission coordinator live in `WKAvatarWebEngine`, not in this transient
/// view. That surface is what the app-root Bridge host (adj-207.1.2) hoists above
/// navigation so the stream survives screen changes; here it is used in the
/// legacy standalone (full-screen) presentation, which owns and tears down its
/// own surface on dismiss.
///
/// The mic + camera controls and self-view live INSIDE the /avatar page, so the
/// overlay stays thin: a Close button plus the native Settings bridge (handled in
/// the engine). Video defaults OFF on the page — opening the Bridge requests the
/// mic only, so the camera TCC prompt never fires until the Commander taps the
/// camera control (adj-202.5.4).
struct AvatarOverlayView: View {
    let onClose: () -> Void

    /// The reusable avatar surface. In this standalone presentation the view owns
    /// it (`ownsSurface == true`) and tears it down on disappear; when a host
    /// injects a shared surface it is left alone.
    @State private var surface: BridgeWebSurface
    private let ownsSurface: Bool

    /// Legacy standalone presentation: builds its own default surface from the
    /// dashboard API base URL (the avatar page lives at the ORIGIN root `/avatar`).
    init(apiBaseURL: URL, onClose: @escaping () -> Void) {
        self.onClose = onClose
        self.ownsSurface = true
        _surface = State(initialValue: BridgeWebSurface.makeDefault(url: Self.avatarURL(from: apiBaseURL)))
    }

    /// Host-driven presentation (adj-207.1.2): renders a shared, session-owned
    /// surface without managing its lifecycle.
    init(surface: BridgeWebSurface, onClose: @escaping () -> Void) {
        self.onClose = onClose
        self.ownsSurface = false
        _surface = State(initialValue: surface)
    }

    private static func avatarURL(from apiBaseURL: URL) -> URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/avatar"
        components?.query = nil
        return components?.url ?? apiBaseURL
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            AvatarSurfaceView(surface: surface)
                .ignoresSafeArea()

            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .shadow(radius: 4)
                    .padding(16)
            }
            .accessibilityLabel("Close Adjutant")
        }
        .onAppear {
            surface.prepare()
            surface.show()
        }
        .onDisappear {
            // Only the standalone presentation tears the stream down; a hosted,
            // shared surface persists across navigation (adj-207.1.2).
            if ownsSurface {
                surface.teardown()
            }
        }
    }
}
