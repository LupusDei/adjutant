import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Projects List.
/// Mode-aware: shows rigs in gastown mode, registered projects in swarm mode.
@MainActor
final class ProjectsListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All rigs from the status API (gastown mode)
    @Published private(set) var rigs: [RigStatus] = []

    /// All projects from the projects API (swarm mode)
    @Published private(set) var projects: [Project] = []

    /// Current search query
    @Published var searchText: String = "" {
        didSet { applyFilters() }
    }

    /// Filtered rigs for display (gastown)
    @Published private(set) var filteredRigs: [RigStatus] = []

    /// Filtered projects for display (swarm)
    @Published private(set) var filteredProjects: [Project] = []

    // MARK: - Create Sheet State

    /// Whether the create project sheet is showing
    @Published var showingCreateSheet = false

    /// Path for new project
    @Published var newProjectPath = ""

    /// Optional name override for new project
    @Published var newProjectName = ""

    /// Whether a create operation is in progress
    @Published var isCreating = false

    // MARK: - Dependencies

    private let apiClient: APIClient

    /// Current deployment mode
    var deploymentMode: DeploymentMode {
        AppState.shared.deploymentMode
    }

    /// Whether we're in gastown mode (shows rigs)
    var isGastownMode: Bool {
        deploymentMode == .gastown
    }

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
    }

    // MARK: - Data Loading

    override func refresh() async {
        if isGastownMode {
            await refreshGastown()
        } else {
            await refreshProjects()
        }
    }

    private func refreshGastown() async {
        await performAsync(showLoading: rigs.isEmpty) {
            let status = try await self.apiClient.getStatus()
            self.rigs = status.rigs.sorted { $0.name.lowercased() < $1.name.lowercased() }
            self.applyFilters()
        }
    }

    private func refreshProjects() async {
        await performAsync(showLoading: projects.isEmpty) {
            self.projects = try await self.apiClient.getProjects()
            self.applyFilters()
        }
    }

    // MARK: - Project Actions (swarm)

    /// Create a project from an existing directory path
    func createFromPath(_ path: String, name: String? = nil) async -> Project? {
        await performAsync(showLoading: false) {
            let project = try await self.apiClient.createProject(
                CreateProjectRequest(path: path, name: name)
            )
            await self.refreshProjects()
            return project
        }
    }

    /// Create a project from the create sheet inputs
    func createProjectFromSheet() async {
        let path = newProjectPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }

        isCreating = true
        let name = newProjectName.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = await createFromPath(path, name: name.isEmpty ? nil : name)
        isCreating = false

        if result != nil {
            showingCreateSheet = false
            newProjectPath = ""
            newProjectName = ""
        }
    }

    /// Trigger project discovery on the backend
    func discoverProjects() async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.discoverProjects()
            await self.refreshProjects()
        }
    }

    /// Delete a project registration
    func deleteProject(_ project: Project) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.deleteProject(id: project.id)
            self.projects.removeAll { $0.id == project.id }
            self.applyFilters()
        }
    }

    /// Activate a project
    func activateProject(_ project: Project) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.activateProject(id: project.id)
            await self.refreshProjects()
        }
    }

    // MARK: - Filtering

    private func applyFilters() {
        if isGastownMode {
            applyRigFilters()
        } else {
            applyProjectFilters()
        }
    }

    private func applyRigFilters() {
        if searchText.isEmpty {
            filteredRigs = rigs
        } else {
            let query = searchText.lowercased()
            filteredRigs = rigs.filter { rig in
                rig.name.lowercased().contains(query) ||
                rig.path.lowercased().contains(query)
            }
        }
    }

    private func applyProjectFilters() {
        if searchText.isEmpty {
            filteredProjects = projects
        } else {
            let query = searchText.lowercased()
            filteredProjects = projects.filter { project in
                project.name.lowercased().contains(query) ||
                project.path.lowercased().contains(query)
            }
        }
    }

    /// Clear all filters
    func clearFilters() {
        searchText = ""
    }

    // MARK: - Computed Properties (gastown)

    /// Total agent count across all rigs
    var totalAgentCount: Int {
        rigs.reduce(0) { $0 + agentCount(for: $1) }
    }

    /// Whether any filters are active
    var hasActiveFilters: Bool {
        !searchText.isEmpty
    }

    /// Agent count for a single rig
    func agentCount(for rig: RigStatus) -> Int {
        var count = 2 // witness + refinery
        count += rig.crew.count
        count += rig.polecats.count
        return count
    }

    /// Running agent count for a single rig
    func runningAgentCount(for rig: RigStatus) -> Int {
        var count = 0
        if rig.witness.running { count += 1 }
        if rig.refinery.running { count += 1 }
        count += rig.crew.filter { $0.running }.count
        count += rig.polecats.filter { $0.running }.count
        return count
    }

    // MARK: - Computed Properties (swarm)

    /// Total number of projects
    var totalProjectCount: Int {
        projects.count
    }

    /// Total active sessions across all projects
    var totalSessionCount: Int {
        projects.reduce(0) { $0 + $1.sessions.count }
    }

    /// Subtitle text for the header
    var headerSubtitle: String {
        if isGastownMode {
            return "\(filteredRigs.count) RIGS \u{2022} \(totalAgentCount) AGENTS"
        } else {
            return "\(filteredProjects.count) PROJECTS \u{2022} \(totalSessionCount) SESSIONS"
        }
    }

    /// Item count for display
    var itemCount: Int {
        isGastownMode ? filteredRigs.count : filteredProjects.count
    }

    /// Whether the list has items
    var hasItems: Bool {
        isGastownMode ? !filteredRigs.isEmpty : !filteredProjects.isEmpty
    }

    /// Whether initial data is empty (not just filtered)
    var hasNoData: Bool {
        isGastownMode ? rigs.isEmpty : projects.isEmpty
    }
}
