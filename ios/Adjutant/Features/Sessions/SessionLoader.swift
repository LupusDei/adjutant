import SwiftUI
import Combine
import AdjutantKit

// MARK: - Session Loader

/// Holds the WebSocket client as a stable reference object so SwiftUI
/// doesn't recreate it across view updates.
/// Shared between SwarmSessionView and UnifiedChatView.
@MainActor
class SessionLoader: ObservableObject {
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
