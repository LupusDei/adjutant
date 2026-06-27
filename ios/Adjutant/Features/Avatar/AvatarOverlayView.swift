import SwiftUI
import WebKit

/// The Bridge (prototype, adj-202.2.4): a full-screen overlay that opens the Adjutant
/// Runway avatar. Loads the backend-served `/avatar` page (which creates a Runway GWM-1
/// session server-side and renders the live avatar via the Runway web SDK) inside a
/// WKWebView. Not yet wired to the coordinator/MCP — this just talks to the character.
struct AvatarOverlayView: View {
    /// The dashboard API base URL (e.g. http://host:4201/api). The avatar page lives at
    /// the ORIGIN root (`/avatar`), so we strip the path component.
    let apiBaseURL: URL
    let onClose: () -> Void

    private var avatarURL: URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/avatar"
        components?.query = nil
        return components?.url ?? apiBaseURL
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            AvatarWebView(url: avatarURL)
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
    }
}

/// WKWebView wrapper configured for real-time media (WebRTC mic/video) so the Runway
/// avatar SDK can capture the microphone and play inline.
private struct AvatarWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        /// Auto-grant in-page mic/camera capture prompts (the page already lives behind a
        /// deliberate user action — opening The Bridge — and Info.plist carries the usage strings).
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }
    }
}
