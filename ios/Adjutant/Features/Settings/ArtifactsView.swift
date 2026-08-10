import SwiftUI
import WebKit
import AdjutantKit

/// The Artifacts library screen — reached from an **ARTIFACTS** row in Settings
/// (epic adj-j7az6, Phase 4 / US4).
///
/// Lists the fleet-wide (global/personal) artifacts. Each artifact can be opened in a
/// WKWebView viewer (rendering the composed, self-contained document), published /
/// unpublished, shared via its public link, saved to Files, and deleted. All list +
/// load/error + publish/save/share/delete logic lives in the AdjutantKit
/// ``ArtifactsViewModel`` (unit-tested); this view is CI-verified.
struct ArtifactsView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ArtifactsViewModel

    /// Present the viewer when non-nil (bound to the VM selection).
    @State private var showShareSheet = false
    @State private var shareItems: [Any] = []

    init(
        apiClient: APIClient? = nil,
        serverBaseURL: (() -> String?)? = nil
    ) {
        let client = apiClient ?? AppState.shared.apiClient
        let baseURL = serverBaseURL ?? { ServerProfileStore.shared.active?.baseURL }
        _viewModel = StateObject(wrappedValue: ArtifactsViewModel(apiClient: client, serverBaseURL: baseURL))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.md) {
                header

                if viewModel.isLoading && viewModel.artifacts.isEmpty {
                    loadingState
                } else if let error = viewModel.errorMessage, viewModel.artifacts.isEmpty {
                    errorState(error)
                } else if viewModel.isEmpty {
                    emptyState
                } else {
                    ForEach(viewModel.artifacts) { artifact in
                        ArtifactRow(
                            artifact: artifact,
                            shareURL: viewModel.shareURL(for: artifact),
                            isWorking: viewModel.isWorking,
                            onView: { openViewer(artifact) },
                            onTogglePublish: {
                                Task<Void, Never> { await viewModel.togglePublished(artifact) }
                            },
                            onShare: {
                                if let url = viewModel.shareURL(for: artifact) {
                                    shareItems = [url]
                                    showShareSheet = true
                                }
                            },
                            onSave: { saveToFiles(artifact) },
                            onDelete: {
                                Task<Void, Never> { await viewModel.delete(artifact) }
                            }
                        )
                    }
                }
            }
            .padding(.vertical, CRTTheme.Spacing.md)
            .padding(.horizontal, CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        .navigationTitle("ARTIFACTS")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if viewModel.artifacts.isEmpty { await viewModel.load() }
        }
        .refreshable { await viewModel.load() }
        .sheet(item: $viewModel.selectedArtifact) { artifact in
            ArtifactViewerScreen(
                artifact: artifact,
                viewModel: viewModel,
                onSave: { saveToFiles(artifact) }
            )
        }
        .sheet(isPresented: $showShareSheet) {
            ArtifactShareSheet(items: shareItems)
        }
    }

    // MARK: - Actions

    private func openViewer(_ artifact: Artifact) {
        Task<Void, Never> { await viewModel.openDocument(for: artifact) }
    }

    /// Fetch the composed document, write it to a file, and present the share sheet so the
    /// user can Save to Files. This is the critical mobile download flow.
    private func saveToFiles(_ artifact: Artifact) {
        Task<Void, Never> {
            do {
                let html: String
                if let loaded = viewModel.documentHTML, viewModel.selectedArtifact?.id == artifact.id {
                    html = loaded
                } else {
                    html = try await AppState.shared.apiClient.downloadArtifactDocument(id: artifact.id)
                }
                let filename = artifactDownloadFilename(for: artifact)
                let url = try writeArtifactDocument(html, filename: filename)
                shareItems = [url]
                showShareSheet = true
            } catch {
                // Surface via the VM's error channel for a consistent UX.
                await viewModel.load()
            }
        }
    }

    // MARK: - Header & states

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText("ARTIFACTS", style: .header)
                CRTText("PUBLISHED HTML PAGES", style: .caption, color: theme.dim)
            }
            Spacer()
        }
    }

    private var loadingState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            ProgressView().tint(theme.primary)
            CRTText("LOADING…", style: .caption, color: theme.dim)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "doc.richtext")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)
            CRTText("NO ARTIFACTS", style: .subheader)
            CRTText(
                "Artifacts published by agents appear here. Open one to view, share, or save it to Files.",
                style: .caption,
                color: theme.dim
            )
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(CRTTheme.Spacing.lg)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundColor(CRTTheme.State.error)
            CRTText("FAILED TO LOAD", style: .subheader)
            CRTText(message, style: .caption, color: theme.dim)
                .multilineTextAlignment(.center)
            CRTButton("RETRY", variant: .secondary, size: .medium) {
                Task<Void, Never> { await viewModel.load() }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(CRTTheme.Spacing.lg)
    }
}

// MARK: - Artifact Row

private struct ArtifactRow: View {
    @Environment(\.crtTheme) private var theme

    let artifact: Artifact
    let shareURL: URL?
    let isWorking: Bool
    let onView: () -> Void
    let onTogglePublish: () -> Void
    let onShare: () -> Void
    let onSave: () -> Void
    let onDelete: () -> Void

    var body: some View {
        CRTCard {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                        CRTText(artifact.title, style: .body, glowIntensity: .subtle)
                            .fixedSize(horizontal: false, vertical: true)
                        CRTText(artifact.relativeDate, style: .caption, color: theme.dim)
                    }
                    Spacer()
                    visibilityBadge
                }

                HStack(spacing: CRTTheme.Spacing.sm) {
                    CRTButton("VIEW", variant: .secondary, size: .small, action: onView)

                    CRTButton(
                        artifact.isPublished ? "UNPUBLISH" : "PUBLISH",
                        variant: artifact.isPublished ? .danger : .primary,
                        size: .small,
                        isLoading: isWorking,
                        action: onTogglePublish
                    )
                    .disabled(isWorking)

                    Spacer()
                }

                HStack(spacing: CRTTheme.Spacing.sm) {
                    CRTButton("SAVE", variant: .secondary, size: .small, action: onSave)

                    if shareURL != nil {
                        CRTButton("SHARE", variant: .secondary, size: .small, action: onShare)
                    }

                    Spacer()

                    CRTButton("DELETE", variant: .danger, size: .small, action: onDelete)
                        .disabled(isWorking)
                }

                if let url = shareURL {
                    CRTText(url.absoluteString, style: .caption, color: theme.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var visibilityBadge: some View {
        let isPublic = artifact.isPublished
        let color = isPublic ? CRTTheme.State.success : theme.dim
        return HStack(spacing: CRTTheme.Spacing.xxs) {
            Circle().fill(color).frame(width: 7, height: 7)
            CRTText(isPublic ? "PUBLIC" : "PRIVATE", style: .caption, color: color)
        }
    }
}

// MARK: - Viewer Screen

/// Full-screen sheet that renders the selected artifact's composed document in a WKWebView
/// with a Save / Done toolbar.
private struct ArtifactViewerScreen: View {
    @Environment(\.crtTheme) private var theme

    let artifact: Artifact
    @ObservedObject var viewModel: ArtifactsViewModel
    let onSave: () -> Void

    @State private var isRendering = false
    @State private var renderError: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if let html = viewModel.documentHTML {
                    ArtifactWebView(html: html, isLoading: $isRendering, loadError: $renderError)
                        .ignoresSafeArea(edges: .bottom)
                    if isRendering { overlay("RENDERING…") }
                    if let renderError { errorOverlay(renderError) }
                } else if viewModel.isLoadingDocument {
                    overlay("LOADING…")
                } else if let docError = viewModel.documentError {
                    errorOverlay(docError)
                }
            }
            .navigationTitle(artifact.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("DONE") { viewModel.closeDocument() }
                        .foregroundColor(theme.primary)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        onSave()
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .foregroundColor(theme.primary)
                    .disabled(viewModel.documentHTML == nil)
                }
            }
        }
    }

    private func overlay(_ text: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            ProgressView().tint(theme.primary)
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(theme.dim)
        }
    }

    private func errorOverlay(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundColor(.red)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(theme.dim)
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.lg)
    }
}

// MARK: - WKWebView

/// Renders a self-contained, pre-sanitized artifact document via `loadHTMLString`.
/// JavaScript is disabled and link taps open in the system browser — a read-only viewer.
private struct ArtifactWebView: UIViewRepresentable {
    let html: String
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let pagePrefs = WKWebpagePreferences()
        pagePrefs.allowsContentJavaScript = false
        configuration.defaultWebpagePreferences = pagePrefs

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        DispatchQueue.main.async {
            isLoading = true
            loadError = nil
        }
        webView.loadHTMLString(html, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: ArtifactWebView
        var loadedHTML: String?

        init(_ parent: ArtifactWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
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

// MARK: - Share Sheet

/// Thin `UIActivityViewController` wrapper for sharing the public URL or a saved `.html` file.
private struct ArtifactShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - Preview

#Preview("Artifacts") {
    NavigationStack {
        ArtifactsView()
    }
}
