import Foundation
import Combine
import AdjutantKit

/// ViewModel for the agent session switcher.
/// Manages listing sessions, switching active session, and start/stop controls.
@MainActor
final class SessionsViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All sessions from the API
    @Published private(set) var sessions: [ManagedSession] = []

    /// Currently selected session ID (for switching focus)
    @Published var activeSessionId: String?

    /// Whether a session action is in flight (create/kill)
    @Published private(set) var isActioning = false

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        let result = await performAsync(showLoading: sessions.isEmpty) {
            try await self.apiClient.getSessions()
        }
        if let sessions = result {
            self.sessions = sessions.sorted { $0.lastActivity > $1.lastActivity }
            // Auto-select first session if none selected
            if activeSessionId == nil, let first = self.sessions.first {
                activeSessionId = first.id
            }
        }
    }

    // MARK: - Session Actions

    /// Create a new session
    func createSession(projectPath: String, mode: String = "standalone", name: String? = nil) async {
        isActioning = true
        defer { isActioning = false }

        let request = CreateSessionRequest(
            name: name,
            projectPath: projectPath,
            mode: mode
        )

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.createSession(request)
        }

        if let session = result {
            sessions.insert(session, at: 0)
            activeSessionId = session.id
        }
    }

    /// Kill a session by ID
    func killSession(id: String) async {
        isActioning = true
        defer { isActioning = false }

        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.killSession(id: id)
        }

        sessions.removeAll { $0.id == id }
        if activeSessionId == id {
            activeSessionId = sessions.first?.id
        }
    }

    /// Switch the active session
    func switchTo(sessionId: String) {
        activeSessionId = sessionId
    }

    // MARK: - Computed Properties

    /// The currently active session
    var activeSession: ManagedSession? {
        sessions.first { $0.id == activeSessionId }
    }

    /// Sessions grouped by status for display
    var liveSessionCount: Int {
        sessions.filter { $0.status != .offline }.count
    }
}
