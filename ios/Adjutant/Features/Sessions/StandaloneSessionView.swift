import SwiftUI
import Combine
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
                VStack(spacing: 0) {
                    sessionSwitcherBar(current: session)
                    SessionChatView(session: session, wsClient: client)
                }
            } else if loader.isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task {
            await loader.loadIfNeeded()
        }
        .sheet(isPresented: $loader.showingSessionPicker) {
            SessionsView { session in
                loader.switchTo(session)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Session Switcher Bar

    private func sessionSwitcherBar(current: ManagedSession) -> some View {
        Button {
            loader.showingSessionPicker = true
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                StatusDot(.success, size: 6, pulse: current.status == .working)

                CRTText(current.name.uppercased(), style: .caption, glowIntensity: .subtle, color: theme.primary)
                    .lineLimit(1)

                Spacer()

                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "terminal")
                        .font(.system(size: 11, weight: .medium))
                    CRTText(
                        "SESSIONS (\(loader.sessions.count))",
                        style: .caption,
                        glowIntensity: .subtle
                    )
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundColor(theme.primary)
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(theme.primary.opacity(0.05))
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(theme.primary.opacity(0.2)),
                alignment: .bottom
            )
        }
        .buttonStyle(.plain)
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
    @Published var sessions: [ManagedSession] = []
    @Published var showingSessionPicker = false
    @Published var isLoading = true
    @Published var errorMessage: String?

    private var loaded = false
    private var cancellables = Set<AnyCancellable>()
    private var lastBaseURL: URL?

    init() {
        // Reconnect when the API base URL changes (e.g. user changes server in settings)
        AppState.shared.$apiBaseURL
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.reconnectWithNewURL()
            }
            .store(in: &cancellables)
    }

    func loadIfNeeded() async {
        guard !loaded else { return }
        loaded = true
        await refresh()
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        do {
            let allSessions = try await AppState.shared.apiClient.getSessions()
            sessions = allSessions
            let active = activeSession.flatMap { current in
                allSessions.first { $0.id == current.id }
            } ?? allSessions.first { $0.status != .offline }

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

    private func reconnectWithNewURL() {
        wsClient?.disconnect()
        wsClient = nil
        loaded = false
        Task { await refresh() }
    }

    func switchTo(_ session: ManagedSession) {
        showingSessionPicker = false
        activeSession = session

        // Ensure we have a WS client
        if wsClient == nil {
            let client = WebSocketClient(
                baseURL: AppState.shared.apiBaseURL,
                apiKey: AppState.shared.apiKey
            )
            client.connect()
            wsClient = client
        }
    }
}
