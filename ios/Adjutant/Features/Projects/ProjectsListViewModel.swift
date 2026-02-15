import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Projects List, showing rigs as projects with agent counts.
@MainActor
final class ProjectsListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All rigs from the status API
    @Published private(set) var rigs: [RigStatus] = []

    /// Current search query
    @Published var searchText: String = "" {
        didSet { applyFilters() }
    }

    /// Filtered rigs for display
    @Published private(set) var filteredRigs: [RigStatus] = []

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
        await performAsync(showLoading: rigs.isEmpty) {
            let status = try await self.apiClient.getStatus()
            self.rigs = status.rigs.sorted { $0.name.lowercased() < $1.name.lowercased() }
            self.applyFilters()
        }
    }

    // MARK: - Filtering

    private func applyFilters() {
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

    /// Clear all filters
    func clearFilters() {
        searchText = ""
    }

    // MARK: - Computed Properties

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
}
