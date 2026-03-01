import Foundation
import Combine
import AdjutantKit
#if canImport(UIKit)
import UIKit
#endif

/// ViewModel for the Agent List feature.
/// Handles loading agents, filtering by rig, and searching by name.
@MainActor
final class AgentListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All crew members from the API
    @Published private(set) var allCrewMembers: [CrewMember] = []

    /// Filtered and grouped crew members for display
    @Published private(set) var groupedCrewMembers: [AgentTypeGroup] = []

    /// Current search query
    @Published var searchText: String = "" {
        didSet { applyFilters() }
    }

    /// Current status filter (nil = all statuses)
    @Published var selectedStatus: CrewMemberStatus? {
        didSet { applyFilters() }
    }

    /// Count of agents per status (computed from allCrewMembers, ignoring filters)
    @Published private(set) var statusCounts: [CrewMemberStatus: Int] = [:]

    /// Beads in progress grouped by assignee name
    @Published private(set) var beadsInProgressByAgent: [String: Int] = [:]

    /// Current in-progress bead ID per agent name
    @Published private(set) var currentBeadByAgent: [String: String] = [:]

    /// Total bead count (all statuses) per agent name
    @Published private(set) var totalBeadsByAgent: [String: Int] = [:]

    /// Total beads in progress across all agents
    @Published private(set) var totalBeadsInProgress: Int = 0

    // MARK: - Types

    /// Grouped crew members by agent type
    struct AgentTypeGroup: Identifiable {
        let type: AgentType
        let members: [CrewMember]

        var id: AgentType { type }

        var displayName: String {
            switch type {
            case .user: return "USERS"
            case .agent: return "AGENTS"
            }
        }

        /// Sort order for display
        var sortOrder: Int {
            switch type {
            case .agent: return 0
            case .user: return 1
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
        Task { await fetchBeadCounts() }
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
        await fetchBeadCounts()
    }

    /// Fetches bead data for agent context display
    private func fetchBeadCounts() async {
        do {
            // Fetch in-progress beads for workload summary
            let inProgressBeads = try await apiClient.getBeads(status: .inProgress)
            var ipCounts: [String: Int] = [:]
            var currentBead: [String: String] = [:]
            for bead in inProgressBeads {
                if let assignee = bead.assignee, !assignee.isEmpty {
                    let name = assignee.components(separatedBy: "/").last ?? assignee
                    ipCounts[name, default: 0] += 1
                    // Use the first in-progress bead as the "current" bead
                    if currentBead[name] == nil {
                        currentBead[name] = bead.id
                    }
                }
            }
            beadsInProgressByAgent = ipCounts
            currentBeadByAgent = currentBead
            totalBeadsInProgress = inProgressBeads.count

            // Fetch all open beads for total counts per agent
            let allBeads = try await apiClient.getBeads()
            var totals: [String: Int] = [:]
            for bead in allBeads {
                if let assignee = bead.assignee, !assignee.isEmpty {
                    let name = assignee.components(separatedBy: "/").last ?? assignee
                    totals[name, default: 0] += 1
                }
            }
            totalBeadsByAgent = totals
        } catch {
            // Non-critical: silently fail, leave counts at zero
            print("[AgentListViewModel] Bead fetch failed: \(error.localizedDescription)")
        }
    }

    /// Gets bead context for a specific agent
    func beadContext(for member: CrewMember) -> AgentBeadContext {
        AgentBeadContext(
            assignedCount: totalBeadsByAgent[member.name] ?? 0,
            currentBeadId: currentBeadByAgent[member.name]
        )
    }

    // MARK: - Filtering

    /// Apply search, rig, and status filters to create grouped display data
    private func applyFilters() {
        // Update status counts from full unfiltered list
        updateStatusCounts()

        var filtered = allCrewMembers

        // Apply status filter
        if let status = selectedStatus {
            filtered = filtered.filter { $0.status == status }
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

    /// Update status counts from the full agent list (ignoring filters)
    private func updateStatusCounts() {
        var counts: [CrewMemberStatus: Int] = [:]
        for member in allCrewMembers {
            counts[member.status, default: 0] += 1
        }
        statusCounts = counts
    }

    /// Clear all filters
    func clearFilters() {
        searchText = ""
        selectedStatus = nil
    }

    // MARK: - Agent Actions

    /// Terminates an agent's session
    /// - Parameter member: The crew member to terminate
    /// - Returns: True if termination was successful
    @discardableResult
    func terminateAgent(_ member: CrewMember) async -> Bool {
        let sessionId = member.sessionId ?? member.id

        do {
            _ = try await apiClient.killSession(id: sessionId)

            #if canImport(UIKit)
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.success)
            #endif

            await refresh()
            return true
        } catch {
            handleError(error)
            return false
        }
    }

    // MARK: - Computed Properties

    /// Total count of displayed crew members
    var displayedCount: Int {
        groupedCrewMembers.reduce(0) { $0 + $1.members.count }
    }

    /// Whether any filters are active
    var hasActiveFilters: Bool {
        !searchText.isEmpty || selectedStatus != nil
    }
}
