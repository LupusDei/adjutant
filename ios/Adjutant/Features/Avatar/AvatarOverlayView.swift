import SwiftUI
import UIKit
import WebKit

/// The Bridge (prototype, adj-202.2.4): a full-screen overlay that opens the Adjutant
/// Runway avatar. Loads the backend-served `/avatar` page (which creates a Runway GWM-1
/// session server-side and renders the live avatar via the Runway web SDK) inside a
/// WKWebView. Not yet wired to the coordinator/MCP — this just talks to the character.
///
/// The mic + camera controls and self-view live INSIDE the /avatar page (rendered for the
/// self-connecting default mode), so the overlay stays thin: a Close button plus a native
/// bridge that lets the page's permission banner deep-link to iOS Settings (adj-202.5.4).
/// Video defaults OFF on the page — opening the Bridge requests the mic only, so the camera
/// TCC prompt never fires until the Commander taps the camera control (adj-202.5.4).
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

        // Bridge the page's permission banner (adj-202.5.4) to the OS Settings app. A web page
        // cannot open iOS Settings on its own, so the page posts to this handler when the
        // Commander taps "Open Settings" after denying the camera/mic permission.
        config.userContentController.add(context.coordinator, name: "bridgeOpenSettings")

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

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        // Remove the script-message handler so its strong ref to the coordinator is released.
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bridgeOpenSettings")
    }

    final class Coordinator: NSObject, WKUIDelegate, WKScriptMessageHandler {
        /// Auto-grant in-page mic/camera capture prompts (the page already lives behind a
        /// deliberate user action — opening The Bridge — and Info.plist carries the usage strings).
        /// This answers the WebKit-layer prompt only; the OS-level TCC alert is separate, and a
        /// denial surfaces in-page as a friendly banner (adj-202.5.4), not a raw error.
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }

        /// Open the app's Settings page so the Commander can re-enable a denied camera/mic
        /// permission (adj-202.5.4).
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == "bridgeOpenSettings" else { return }
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            DispatchQueue.main.async {
                UIApplication.shared.open(url)
            }
        }
    }
}
