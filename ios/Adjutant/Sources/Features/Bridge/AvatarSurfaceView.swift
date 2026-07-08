import SwiftUI
import UIKit

/// SwiftUI host for a session-owned `BridgeWebSurface` (adj-207.1.3).
///
/// Critically, this representable does NOT create the webview — it embeds the
/// engine's already-live `hostView`, which the session/surface owns and keeps
/// alive. Remounting this view (e.g. across navigation) re-parents the SAME
/// webview rather than reloading it, which is the whole point of the persistent
/// surface. `makeUIView` returns only an empty container; the engine view is
/// attached in `updateUIView` once the surface has been prepared.
struct AvatarSurfaceView: UIViewRepresentable {
    let surface: BridgeWebSurface

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.backgroundColor = .black
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard let host = surface.presentationView else { return }
        // Attach (or re-attach) the persistent engine view exactly once per
        // container. Identity check avoids re-adding it on every SwiftUI update.
        guard host.superview !== container else { return }
        host.removeFromSuperview()
        host.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(host)
        NSLayoutConstraint.activate([
            host.topAnchor.constraint(equalTo: container.topAnchor),
            host.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            host.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])
    }
}
