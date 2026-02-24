import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Proposals tab, handling fetching, filtering,
/// and status updates (accept/dismiss) for agent proposals.
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
        await load()
    }

    /// Fetches proposals from the API using the current filters.
    func load() async {
        let result = await performAsync(showLoading: proposals.isEmpty) { [self] in
            try await self.apiClient.fetchProposals(
                status: self.statusFilter,
                type: self.typeFilter
            )
        }
        if let result {
            proposals = result
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
