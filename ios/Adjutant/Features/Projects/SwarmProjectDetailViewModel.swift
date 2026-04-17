import Foundation
import Combine
import AdjutantKit

/// ViewModel for the swarm project detail view.
/// Manages sessions, swarms, and project actions.
@MainActor
final class SwarmProjectDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    @Published private(set) var project: Project
    @Published private(set) var sessions: [ManagedSession] = []
    @Published private(set) var swarms: [SwarmInfo] = []
    @Published private(set) var isCreatingSession = false
    @Published private(set) var isCreatingSwarm = false
    @Published private(set) var isDeletingProject = false
    @Published var showDeleteConfirmation = false
    @Published var autoDevelopEnabled = false
    @Published private(set) var autoDevelopStatus: AutoDevelopStatus?
    @Published private(set) var isTogglingAutoDevelop = false

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(project: Project, apiClient: APIClient? = nil) {
        self.project = project
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: sessions.isEmpty && swarms.isEmpty) {
            async let fetchedSessions = self.apiClient.getSessions()
            async let fetchedSwarms = self.apiClient.getSwarms()

            let (allSessions, allSwarms) = try await (fetchedSessions, fetchedSwarms)

            // Filter to sessions belonging to this project
            self.sessions = allSessions.filter { $0.projectPath == self.project.path }
            self.swarms = allSwarms.filter { $0.projectPath == self.project.path }

            // Refresh the project itself
            if let updated = try? await self.apiClient.getProject(id: self.project.id) {
                self.project = updated
                self.autoDevelopEnabled = updated.autoDevelop ?? false
            }
        }

        // Fetch auto-develop status separately (non-critical)
        await fetchAutoDevelopStatus()
    }

    // MARK: - Actions

    /// Create a new swarm agent session for this project.
    /// Pass a name to choose a specific callsign; omit for random assignment.
    func createSession(name: String? = nil) async -> ManagedSession? {
        isCreatingSession = true
        defer { isCreatingSession = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.createSession(
                CreateSessionRequest(
                    name: name,
                    projectPath: self.project.path,
                    mode: "swarm"
                )
            )
        }

        if result != nil {
            await refresh()
        }
        return result
    }

    /// Create a new swarm for this project
    func createSwarm(agentCount: Int = 3) async -> SwarmInfo? {
        isCreatingSwarm = true
        defer { isCreatingSwarm = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.createSwarm(
                CreateSwarmRequest(
                    projectPath: self.project.path,
                    agentCount: agentCount
                )
            )
        }

        if result != nil {
            await refresh()
        }
        return result
    }

    /// Kill a session
    func killSession(_ session: ManagedSession) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.killSession(id: session.id)
        }
        await refresh()
    }

    /// Delete the project registration
    func deleteProject() async -> Bool {
        isDeletingProject = true
        defer { isDeletingProject = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.deleteProject(id: self.project.id)
        }
        return result?.deleted ?? false
    }

    // MARK: - Auto-Develop

    /// Fetch the current auto-develop status for this project.
    func fetchAutoDevelopStatus() async {
        let result = await performAsync(showLoading: false) {
            try await self.apiClient.getAutoDevelopStatus(projectId: self.project.id)
        }
        if let status = result {
            self.autoDevelopStatus = status
            self.autoDevelopEnabled = status.enabled
        }
    }

    /// Toggle auto-develop on or off for this project.
    func toggleAutoDevelop() async {
        let newValue = !autoDevelopEnabled
        isTogglingAutoDevelop = true
        defer { isTogglingAutoDevelop = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.updateProjectAutoDevelop(
                projectId: self.project.id,
                autoDevelop: newValue
            )
        }

        if let updatedProject = result {
            self.project = updatedProject
            self.autoDevelopEnabled = newValue
            // Refresh the status after toggling
            await fetchAutoDevelopStatus()
        }
    }

    /// Update auto-develop with a new vision context (used for escalation response).
    func updateVisionContext(_ visionContext: String) async {
        isTogglingAutoDevelop = true
        defer { isTogglingAutoDevelop = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.updateProjectAutoDevelop(
                projectId: self.project.id,
                autoDevelop: true,
                visionContext: visionContext
            )
        }

        if let updatedProject = result {
            self.project = updatedProject
            await fetchAutoDevelopStatus()
        }
    }

    // MARK: - Computed Properties

    var activeSessionCount: Int {
        sessions.filter { $0.status != .offline }.count
    }

    var hasActiveSessions: Bool {
        activeSessionCount > 0
    }

    var abbreviatedPath: String {
        let path = project.path
        if let homeRange = path.range(of: "/Users/") {
            let afterUsers = path[homeRange.upperBound...]
            if let slashIndex = afterUsers.firstIndex(of: "/") {
                return "~" + String(afterUsers[slashIndex...])
            }
        }
        return path
    }
}
