import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Projects List.
/// Shows registered projects from the projects API.
@MainActor
final class ProjectsListViewModel: BaseViewModel {
    // MARK: - Types

    /// Mode for the create project sheet
    enum CreationMode: String, CaseIterable, Identifiable {
        case cloneUrl = "CLONE URL"
        case localPath = "LOCAL PATH"

        var id: String { rawValue }
    }

    // MARK: - Published Properties

    /// All projects from the projects API
    @Published private(set) var projects: [Project] = []

    /// Current search query
    @Published var searchText: String = "" {
        didSet { applyFilters() }
    }

    /// Filtered projects for display
    @Published private(set) var filteredProjects: [Project] = []

    // MARK: - Create Sheet State

    /// Whether the create project sheet is showing
    @Published var showingCreateSheet = false {
        didSet {
            if !showingCreateSheet {
                resetCreateSheet()
            }
        }
    }

    /// Current creation mode (clone URL or local path)
    @Published var creationMode: CreationMode = .cloneUrl

    /// Path for new project (local path mode)
    @Published var newProjectPath = ""

    /// Clone URL for new project (clone mode)
    @Published var newCloneUrl = ""

    /// Target directory for cloning into
    @Published var newTargetDir = ""

    /// Optional name override for new project
    @Published var newProjectName = ""

    /// Whether a create operation is in progress
    @Published var isCreating = false

    // MARK: - Dependencies

    private let apiClient: APIClient

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
        await refreshProjects()
    }

    private func refreshProjects() async {
        await performAsync(showLoading: projects.isEmpty) {
            self.projects = try await self.apiClient.getProjects()
            self.applyFilters()
            // Restore client-side project selection from persisted ID
            AppState.shared.restoreSelectedProject(from: self.projects)
        }
    }

    // MARK: - Project Actions

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

    /// Create a project from the create sheet inputs (handles both modes)
    func createProjectFromSheet() async {
        isCreating = true
        let name = newProjectName.trimmingCharacters(in: .whitespacesAndNewlines)
        let optionalName = name.isEmpty ? nil : name

        let result: Project?
        switch creationMode {
        case .cloneUrl:
            let url = newCloneUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !url.isEmpty else {
                isCreating = false
                return
            }
            let targetDir = newTargetDir.trimmingCharacters(in: .whitespacesAndNewlines)
            result = await createFromClone(url, targetDir: targetDir.isEmpty ? nil : targetDir, name: optionalName)

        case .localPath:
            let path = newProjectPath.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !path.isEmpty else {
                isCreating = false
                return
            }
            result = await createFromPath(path, name: optionalName)
        }

        isCreating = false

        if result != nil {
            showingCreateSheet = false
        }
    }

    /// Create a project by cloning a remote repository
    func createFromClone(_ url: String, targetDir: String? = nil, name: String? = nil) async -> Project? {
        await performAsync(showLoading: false) {
            let project = try await self.apiClient.createProject(
                CreateProjectRequest(cloneUrl: url, name: name, targetDir: targetDir)
            )
            await self.refreshProjects()
            return project
        }
    }

    /// Reset all create sheet fields to defaults
    private func resetCreateSheet() {
        creationMode = .cloneUrl
        newProjectPath = ""
        newCloneUrl = ""
        newTargetDir = ""
        newProjectName = ""
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

    // MARK: - Filtering

    private func applyFilters() {
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

    // MARK: - Computed Properties

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
        "\(filteredProjects.count) PROJECTS \u{2022} \(totalSessionCount) SESSIONS"
    }

    /// Whether any filters are active
    var hasActiveFilters: Bool {
        !searchText.isEmpty
    }

    /// Whether the list has items
    var hasItems: Bool {
        !filteredProjects.isEmpty
    }

    /// Whether initial data is empty (not just filtered)
    var hasNoData: Bool {
        projects.isEmpty
    }
}
