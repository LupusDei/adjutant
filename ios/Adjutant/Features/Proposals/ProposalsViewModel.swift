import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Proposals tab, handling fetching, filtering,
/// and status updates (accept/dismiss) for agent proposals.
/// Automatically scopes proposals to the active project on launch.
@MainActor
final class ProposalsViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All proposals matching the current filters
    @Published private(set) var proposals: [Proposal] = []

    /// Status filter — nil shows all statuses
    @Published var statusFilter: ProposalStatus? = .pending {
        didSet { Task { await load() } }
    }

    /// Type filter — nil shows all types
    @Published var typeFilter: ProposalType? = nil {
        didSet { Task { await load() } }
    }

    /// Active project name used to scope proposals. Loaded automatically on appear.
    @Published private(set) var activeProjectName: String?

    /// All available projects for the project picker
    @Published private(set) var projects: [Project] = []

    /// User-selected project name filter. nil = all projects.
    /// Defaults to active project on first load.
    @Published var selectedProjectName: String? {
        didSet { Task { await load() } }
    }

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        loadProjects()
        loadActiveProjectScope()
        super.onAppear()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await load()
    }

    /// Fetches proposals from the API using the current filters,
    /// scoped to the selected project (or active project) when available.
    func load() async {
        let result = await performAsync(showLoading: proposals.isEmpty) { [self] in
            try await self.apiClient.fetchProposals(
                status: self.statusFilter,
                type: self.typeFilter,
                project: self.selectedProjectName
            )
        }
        if let result {
            proposals = result
        }
    }

    /// Loads available projects for the project picker.
    private func loadProjects() {
        Task<Void, Never> { [weak self] in
            guard let self else { return }
            do {
                self.projects = try await self.apiClient.getProjects()
            } catch {
                // Non-critical — project picker will be empty
            }
        }
    }

    /// Loads the active project from the API and sets it as the default project scope.
    /// Only sets the default if the user hasn't already selected a project.
    private func loadActiveProjectScope() {
        Task<Void, Never> { [weak self] in
            guard let self else { return }
            do {
                let projects = try await self.apiClient.getProjects()
                if let activeProject = projects.first(where: { $0.active }) {
                    self.activeProjectName = activeProject.name
                    // Only set default if user hasn't already selected a project
                    if self.selectedProjectName == nil {
                        self.selectedProjectName = activeProject.name
                    }
                }
            } catch {
                // Non-critical — proposals will show unfiltered
            }
        }
    }

    // MARK: - Actions

    /// Accepts a proposal by ID and refreshes the list.
    func accept(id: String) async {
        await performAsyncAction(showLoading: false) { [self] in
            _ = try await self.apiClient.updateProposalStatus(id: id, status: .accepted)
        }
        await load()
    }

    /// Dismisses a proposal by ID and refreshes the list.
    func dismiss(id: String) async {
        await performAsyncAction(showLoading: false) { [self] in
            _ = try await self.apiClient.updateProposalStatus(id: id, status: .dismissed)
        }
        await load()
    }

    /// Marks a proposal as completed by ID and refreshes the list.
    func complete(id: String) async {
        await performAsyncAction(showLoading: false) { [self] in
            _ = try await self.apiClient.updateProposalStatus(id: id, status: .completed)
        }
        await load()
    }

    // MARK: - Computed Properties

    /// Whether the proposals list is empty
    var isEmpty: Bool {
        proposals.isEmpty
    }

    /// Human-readable empty state message based on current filters
    var emptyStateMessage: String {
        if let status = statusFilter {
            return "No \(status.rawValue) proposals"
        }
        return "No proposals yet"
    }
}
