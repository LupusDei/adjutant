import SwiftUI
import AdjutantKit

/// Standalone session view for Single Agent mode.
/// Automatically finds the first active session and shows SessionChatView for it.
/// Used as the Chat tab content when deployment mode is `.standalone`.
struct StandaloneSessionView: View {
    @Environment(\.crtTheme) private var theme
    @State private var activeSession: ManagedSession?
    @State private var wsClient: WebSocketClient?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let session = activeSession, let client = wsClient {
                SessionChatView(session: session, wsClient: client)
            } else if isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task {
            await findActiveSession()
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

            if let error = errorMessage {
                CRTText(error, style: .caption, glowIntensity: .none, color: .red)
                    .padding(.top, CRTTheme.Spacing.sm)
            }

            Button {
                Task { await findActiveSession() }
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

    // MARK: - Data Loading

    private func findActiveSession() async {
        isLoading = true
        errorMessage = nil

        do {
            let sessions = try await AppState.shared.apiClient.getSessions()
            let active = sessions.first { $0.status != .offline }

            if let session = active {
                let client = WebSocketClient(
                    baseURL: AppState.shared.apiBaseURL,
                    apiKey: AppState.shared.apiKey
                )
                activeSession = session
                wsClient = client
            } else {
                activeSession = nil
                wsClient = nil
            }
        } catch {
            errorMessage = error.localizedDescription
            activeSession = nil
            wsClient = nil
        }

        isLoading = false
    }
}
