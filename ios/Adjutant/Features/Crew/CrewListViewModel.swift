import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Crew List feature.
/// Handles loading agents, filtering by rig, and searching by name.
@MainActor
final class CrewListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All crew members from the API
    @Published private(set) var allCrewMembers: [CrewMember] = []

    /// Filtered and grouped crew members for display
    @Published private(set) var groupedCrewMembers: [AgentTypeGroup] = []

    /// Current search query
    @Published var searchText: String = "" {
        didSet { applyFilters() }
    }

    /// Current rig filter (nil = all rigs)
    @Published var selectedRig: String? {
        didSet { applyFilters() }
    }

    /// Available rigs for filtering
    @Published private(set) var availableRigs: [String] = []

    // MARK: - Types

    /// Grouped crew members by agent type
    struct AgentTypeGroup: Identifiable {
        let type: AgentType
        let members: [CrewMember]

        var id: AgentType { type }

        var displayName: String {
            switch type {
            case .mayor: return "MAYOR"
            case .deacon: return "DEACONS"
            case .witness: return "WITNESSES"
            case .refinery: return "REFINERIES"
            case .crew: return "CREW"
            case .polecat: return "POLECATS"
            }
        }

        /// Sort order for hierarchy (Mayor > Deacons > Witnesses > Polecats)
        var sortOrder: Int {
            switch type {
            case .mayor: return 0
            case .deacon: return 1
            case .witness: return 2
            case .refinery: return 3
            case .crew: return 4
            case .polecat: return 5
            }
        }
    }

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let dataSync = DataSyncService.shared

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        setupDataSyncObserver()
        loadFromCache()
    }

    /// Loads cached crew for immediate display
    private func loadFromCache() {
        let cached = ResponseCache.shared.crewMembers
        if !cached.isEmpty {
            allCrewMembers = cached
            updateAvailableRigs()
            applyFilters()
        }
    }

    /// Sets up observation of DataSyncService crew updates
    private func setupDataSyncObserver() {
        dataSync.$crew
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newCrew in
                guard let self = self, !newCrew.isEmpty else { return }
                self.allCrewMembers = newCrew
                self.updateAvailableRigs()
                self.applyFilters()
            }
            .store(in: &cancellables)
    }

    deinit {
        // Cleanup handled by cancellables
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        dataSync.subscribeCrew()
    }

    override func onDisappear() {
        super.onDisappear()
        dataSync.unsubscribeCrew()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsync(showLoading: allCrewMembers.isEmpty) {
            await self.dataSync.refreshCrew()
        }
    }

    // MARK: - Filtering

    /// Apply search and rig filters to create grouped display data
    private func applyFilters() {
        var filtered = allCrewMembers

        // Apply rig filter
        if let rig = selectedRig {
            filtered = filtered.filter { $0.rig == rig }
        }

        // Apply search filter
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            filtered = filtered.filter { member in
                member.name.lowercased().contains(query) ||
                member.id.lowercased().contains(query) ||
                (member.currentTask?.lowercased().contains(query) ?? false)
            }
        }

        // Group by type and sort
        let grouped = Dictionary(grouping: filtered) { $0.type }
        groupedCrewMembers = grouped.map { type, members in
            AgentTypeGroup(
                type: type,
                members: members.sorted { $0.name.lowercased() < $1.name.lowercased() }
            )
        }
        .sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Update the list of available rigs from loaded data
    private func updateAvailableRigs() {
        let rigs = Set(allCrewMembers.compactMap { $0.rig })
        availableRigs = rigs.sorted()
    }

    /// Clear all filters
    func clearFilters() {
        searchText = ""
        selectedRig = nil
    }

    // MARK: - Computed Properties

    /// Total count of displayed crew members
    var displayedCount: Int {
        groupedCrewMembers.reduce(0) { $0 + $1.members.count }
    }

    /// Whether any filters are active
    var hasActiveFilters: Bool {
        !searchText.isEmpty || selectedRig != nil
    }
}
