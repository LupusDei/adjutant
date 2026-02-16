import SwiftUI
import AdjutantKit

/// Standalone session view for Single Agent mode.
/// Automatically finds the first active session and shows SessionChatView for it.
/// Used as the Chat tab content when deployment mode is `.standalone`.
struct StandaloneSessionView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var loader = SessionLoader()

    var body: some View {
        Group {
            if let session = loader.activeSession, let client = loader.wsClient {
                SessionChatView(session: session, wsClient: client)
            } else if loader.isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task {
            await loader.loadIfNeeded()
        }
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("CONNECTING TO SESSION...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO ACTIVE SESSIONS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText(
                "Start an agent session to begin.",
                style: .body,
                glowIntensity: .none,
                color: theme.dim.opacity(0.6)
            )
            .multilineTextAlignment(.center)

            if let error = loader.errorMessage {
                CRTText(error, style: .caption, glowIntensity: .none, color: .red)
                    .padding(.top, CRTTheme.Spacing.sm)
            }

            Button {
                Task { await loader.refresh() }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14))
                    CRTText("REFRESH", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .padding(.top, CRTTheme.Spacing.sm)
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }
}

// MARK: - Session Loader

/// Holds the WebSocket client as a stable reference object so SwiftUI
/// doesn't recreate it across view updates.
@MainActor
private class SessionLoader: ObservableObject {
    @Published var activeSession: ManagedSession?
    @Published var wsClient: WebSocketClient?
    @Published var isLoading = true
    @Published var errorMessage: String?

    private var loaded = false

    func loadIfNeeded() async {
        guard !loaded else { return }
        loaded = true
        await refresh()
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        do {
            let sessions = try await AppState.shared.apiClient.getSessions()
            let active = sessions.first { $0.status != .offline }

            if let session = active {
                // Reuse existing client if still valid, otherwise create new
                if wsClient == nil {
                    let client = WebSocketClient(
                        baseURL: AppState.shared.apiBaseURL,
                        apiKey: AppState.shared.apiKey
                    )
                    client.connect()
                    wsClient = client
                }
                activeSession = session
            } else {
                activeSession = nil
                wsClient?.disconnect()
                wsClient = nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    deinit {
        wsClient?.disconnect()
    }
}
