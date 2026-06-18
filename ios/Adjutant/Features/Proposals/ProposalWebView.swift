import SwiftUI
import WebKit
import AdjutantKit

/// A `UIViewRepresentable` wrapping `WKWebView` that renders a proposal's self-contained,
/// pre-sanitized HTML via `loadHTMLString` (adj-200, Path D / US4).
///
/// Because the HTML is self-contained (inline CSS/SVG, no external resources, no scripts —
/// the Path A compose contract), this works for PRIVATE proposals too: no network round-trip
/// and no public `/p/:token` route are required to read a proposal as a page.
///
/// JavaScript is disabled and link activations are routed to the system browser so the
/// in-app viewer stays a read-only renderer.
struct ProposalWebView: UIViewRepresentable {
    /// The self-contained HTML document to render.
    let html: String
    /// Bound loading flag — true while the document is loading.
    @Binding var isLoading: Bool
    /// Bound error message — set when rendering fails, nil otherwise.
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Self-contained documents need no scripting; disabling it hardens the viewer.
        let pagePrefs = WKWebpagePreferences()
        pagePrefs.allowsContentJavaScript = false
        configuration.defaultWebpagePreferences = pagePrefs

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        // Match the CRT dark backdrop so the document fades in over black, not white.
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Reload only when the html actually changes (avoids reload loops on re-render).
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html

        // Defer binding mutation out of the view-update pass.
        DispatchQueue.main.async {
            isLoading = true
            loadError = nil
        }
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: ProposalWebView
        /// The html currently loaded into the web view (dedupes redundant reloads).
        var loadedHTML: String?

        init(_ parent: ProposalWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }

        /// Render-only viewer: user taps on links open in the system browser instead of
        /// navigating inside the embedded web view.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}

/// Full-screen host for ``ProposalWebView``: fetches the proposal by id, then renders its
/// HTML as a page with loading / error / empty states. Resolved by the
/// `.proposalWebView(id:)` route (adj-200.5.3).
struct ProposalPageView: View {
    @Environment(\.crtTheme) private var theme

    let proposalId: String
    private let apiClient: APIClient

    @State private var proposal: Proposal?
    @State private var isFetching = true
    @State private var fetchError: String?
    @State private var isRendering = false
    @State private var renderError: String?

    init(proposalId: String, apiClient: APIClient? = nil) {
        self.proposalId = proposalId
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let proposal {
                if let html = proposal.html,
                   !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ProposalWebView(html: html, isLoading: $isRendering, loadError: $renderError)
                        .ignoresSafeArea(edges: .bottom)
                    if isRendering { overlay(text: "RENDERING…") }
                    if let renderError { errorState(message: renderError) }
                } else {
                    emptyState
                }
            } else if isFetching {
                overlay(text: "LOADING…")
            } else {
                errorState(message: fetchError ?? "Failed to load proposal.")
            }
        }
        .navigationTitle("PROPOSAL")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isFetching = true
        fetchError = nil
        do {
            proposal = try await apiClient.getProposal(id: proposalId)
        } catch {
            fetchError = error.localizedDescription
        }
        isFetching = false
    }

    private func overlay(text: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            ProgressView()
                .tint(theme.primary)
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(theme.dim)
        }
        .padding(CRTTheme.Spacing.lg)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "doc.plaintext")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)
            Text("NO PAGE CONTENT")
                .font(.system(.headline, design: .monospaced))
                .foregroundColor(theme.primary)
            Text("This proposal has no HTML body to render as a page.")
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(theme.dim)
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.lg)
    }

    private func errorState(message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.red)
            Text("RENDER ERROR")
                .font(.system(.headline, design: .monospaced))
                .foregroundColor(theme.primary)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(theme.dim)
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.lg)
    }
}
