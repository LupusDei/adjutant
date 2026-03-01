import Foundation
import Combine
import AdjutantKit

/// ViewModel for the beads list view, handling bead fetching,
/// filtering, and actions.
@MainActor
final class BeadsListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All beads (before filtering)
    @Published private(set) var beads: [BeadInfo] = []

    /// Filtered beads based on current filter
    @Published private(set) var filteredBeads: [BeadInfo] = []

    /// Current filter selection
    @Published var currentFilter: BeadFilter = .open {
        didSet { applyFilter() }
    }

    /// Search query text
    @Published var searchText: String = "" {
        didSet { applyFilter() }
    }

    /// Whether search is active
    @Published var isSearching: Bool = false

    /// Current sort selection (persisted to UserDefaults)
    @Published var currentSort: BeadSort = .lastUpdated {
        didSet {
            UserDefaults.standard.set(currentSort.rawValue, forKey: "beads_sort_preference")
            applyFilter()
        }
    }

    /// Available bead sources for the source filter dropdown
    @Published private(set) var beadSources: [BeadSource] = []

    /// Currently selected source filter (nil = all)
    @Published var selectedSource: String?

    // MARK: - Filter Types

    /// Available bead filter options
    enum BeadFilter: String, CaseIterable, Identifiable {
        case all
        case open
        case assigned
        case priority

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .all: return "ALL"
            case .open: return "OPEN"
            case .assigned: return "ASSIGNED"
            case .priority: return "PRIORITY"
            }
        }

        var systemImage: String {
            switch self {
            case .all: return "circle.grid.3x3"
            case .open: return "circle"
            case .assigned: return "person.fill"
            case .priority: return "exclamationmark.triangle"
            }
        }
    }

    // MARK: - Sort Types

    /// Available bead sort options
    enum BeadSort: String, CaseIterable, Identifiable {
        case lastUpdated
        case priority
        case createdDate
        case alphabetical
        case assignee

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .lastUpdated: return "LAST UPDATED"
            case .priority: return "PRIORITY"
            case .createdDate: return "CREATED"
            case .alphabetical: return "A-Z"
            case .assignee: return "ASSIGNEE"
            }
        }

        var systemImage: String {
            switch self {
            case .lastUpdated: return "clock.arrow.circlepath"
            case .priority: return "exclamationmark.triangle"
            case .createdDate: return "calendar"
            case .alphabetical: return "textformat.abc"
            case .assignee: return "person.fill"
            }
        }
    }

    // MARK: - Dependencies

    private let apiClient: APIClient?
    private let dataSync = DataSyncService.shared

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        loadSortPreference()
        setupDataSyncObserver()
        loadFromCache()
    }

    /// Loads the saved sort preference from UserDefaults
    private func loadSortPreference() {
        if let savedSort = UserDefaults.standard.string(forKey: "beads_sort_preference"),
           let sort = BeadSort(rawValue: savedSort) {
            currentSort = sort
        }
    }

    /// Loads cached beads for immediate display
    private func loadFromCache() {
        let cached = ResponseCache.shared.beads
        if !cached.isEmpty {
            beads = cached
            applyFilter()
        }
    }

    /// Sets up observation of DataSyncService beads updates
    private func setupDataSyncObserver() {
        dataSync.$beads
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newBeads in
                guard let self = self else { return }
                // Server already filtered by rig — use results directly.
                // Empty results are valid (project may have no beads or fetch failed).
                self.beads = newBeads
                self.applyFilter()
            }
            .store(in: &cancellables)

        // Surface beads fetch errors to the UI
        dataSync.$beadsError
            .receive(on: DispatchQueue.main)
            .sink { [weak self] error in
                guard let self = self else { return }
                if let error = error {
                    self.errorMessage = "Failed to load beads: \(error)"
                }
            }
            .store(in: &cancellables)
    }

    deinit {
        // Cleanup handled by cancellables
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        dataSync.subscribeBeads()
    }

    override func onDisappear() {
        super.onDisappear()
        dataSync.unsubscribeBeads()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadBeads()
    }

    /// Loads beads from the API via DataSyncService
    func loadBeads() async {
        guard let apiClient else {
            // Use mock data for preview/testing
            await performAsync {
                self.beads = Self.mockBeads
                self.applyFilter()
            }
            return
        }

        await performAsync(showLoading: beads.isEmpty) {
            await self.dataSync.refreshBeads(rig: self.selectedSource)
        }

        // Fetch bead sources for source filter
        await fetchBeadSources(apiClient: apiClient)
    }

    /// Fetches available projects from the API for the source filter dropdown.
    /// Uses the projects API (same list as the Projects tab) so the dropdown
    /// shows all registered projects.
    private func fetchBeadSources(apiClient: APIClient) async {
        do {
            let projects = try await apiClient.getProjects()
            beadSources = projects.map {
                BeadSource(name: $0.name, path: $0.path, hasBeads: true)
            }
        } catch {
            // Non-critical — source filter just won't show options
        }
    }

    // MARK: - Private Helpers

    /// Types excluded from the beads list (matches frontend EXCLUDED_TYPES)
    private static let excludedTypes: Set<String> = ["message", "epic", "convoy", "agent", "wisp"]

    /// Applies the current filter and search to beads
    /// Note: Rig filtering is now done server-side via the API rig parameter
    private func applyFilter() {
        var result = beads

        // Filter out non-task types (messages, epics, wisps, etc.)
        result = result.filter { !Self.excludedTypes.contains($0.type.lowercased()) }

        // Apply status filter
        switch currentFilter {
        case .all:
            break
        case .open:
            result = result.filter { $0.status != "closed" }
        case .assigned:
            result = result.filter { $0.assignee != nil && !$0.assignee!.isEmpty }
        case .priority:
            result = result.filter { $0.priority <= 1 } // P0 and P1
        }

        // Apply search
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter { bead in
                bead.title.lowercased().contains(query) ||
                bead.id.lowercased().contains(query) ||
                (bead.description?.lowercased().contains(query) ?? false) ||
                (bead.assignee?.lowercased().contains(query) ?? false) ||
                bead.labels.contains { $0.lowercased().contains(query) }
            }
        }

        // Apply sort
        result = sortBeads(result)

        filteredBeads = result
    }

    /// Sorts beads according to the current sort selection
    private func sortBeads(_ beads: [BeadInfo]) -> [BeadInfo] {
        beads.sorted { a, b in
            switch currentSort {
            case .lastUpdated:
                // Most recent first (updatedAt or createdAt)
                let dateA = a.updatedDate ?? a.createdDate ?? Date.distantPast
                let dateB = b.updatedDate ?? b.createdDate ?? Date.distantPast
                return dateA > dateB

            case .priority:
                // Lower priority number = higher priority (P0 first)
                if a.priority != b.priority {
                    return a.priority < b.priority
                }
                // Tie-break by last updated
                let dateA = a.updatedDate ?? a.createdDate ?? Date.distantPast
                let dateB = b.updatedDate ?? b.createdDate ?? Date.distantPast
                return dateA > dateB

            case .createdDate:
                // Newest first
                let dateA = a.createdDate ?? Date.distantPast
                let dateB = b.createdDate ?? Date.distantPast
                return dateA > dateB

            case .alphabetical:
                // Case-insensitive alphabetical by title
                return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending

            case .assignee:
                // Group by assignee, unassigned last, then alphabetical within groups
                let assigneeA = a.assignee ?? ""
                let assigneeB = b.assignee ?? ""
                if assigneeA.isEmpty && !assigneeB.isEmpty {
                    return false // Unassigned sorts last
                }
                if !assigneeA.isEmpty && assigneeB.isEmpty {
                    return true // Assigned sorts first
                }
                if assigneeA != assigneeB {
                    return assigneeA.localizedCaseInsensitiveCompare(assigneeB) == .orderedAscending
                }
                // Same assignee: sort by priority
                return a.priority < b.priority
            }
        }
    }

    // MARK: - Status Updates

    /// Updates a bead's status locally for optimistic UI updates.
    /// Call this for immediate UI feedback during drag-and-drop.
    func updateBeadStatusLocally(beadId: String, newStatus: String) {
        beads = beads.map { bead in
            if bead.id == beadId {
                return BeadInfo(
                    id: bead.id,
                    title: bead.title,
                    description: bead.description,
                    status: newStatus,
                    priority: bead.priority,
                    type: bead.type,
                    assignee: bead.assignee,
                    rig: bead.rig,
                    source: bead.source,
                    labels: bead.labels,
                    createdAt: bead.createdAt,
                    updatedAt: bead.updatedAt
                )
            }
            return bead
        }
        applyFilter()
    }


    // MARK: - Computed Properties

    /// Beads sorted and type-filtered but not status-filtered, for Kanban display.
    /// The Kanban board needs all statuses (each gets its own column), but still
    /// needs sorting and type exclusion applied.
    var kanbanBeads: [BeadInfo] {
        let result = beads.filter { !Self.excludedTypes.contains($0.type.lowercased()) }
        return sortBeads(result)
    }

    /// Unique rig names extracted from bead sources (excludes "town" and "unknown")
    /// Matches frontend BeadsView.tsx rigOptions logic
    var rigOptions: [String] {
        var rigs = Set<String>()
        for bead in beads {
            let source = bead.source
            if !source.isEmpty && source != "town" && source != "unknown" {
                rigs.insert(source)
            }
        }
        return Array(rigs).sorted()
    }

    /// Count of open beads
    var openCount: Int {
        beads.filter { $0.status != "closed" }.count
    }

    /// Count of priority beads (P0-P1)
    var priorityCount: Int {
        beads.filter { $0.priority <= 1 }.count
    }

    /// Whether there are any beads
    var isEmpty: Bool {
        filteredBeads.isEmpty
    }

    /// Empty state message based on current filter
    var emptyStateMessage: String {
        if !searchText.isEmpty {
            return "No beads match your search"
        }
        switch currentFilter {
        case .all:
            return "No beads found"
        case .open:
            return "No open beads"
        case .assigned:
            return "No assigned beads"
        case .priority:
            return "No priority beads"
        }
    }

    /// Get status type for badge display.
    /// Valid statuses: open, hooked, in_progress, closed.
    /// In Swarm mode, hooked is treated as in_progress.
    func statusType(for bead: BeadInfo) -> BadgeView.Style.StatusType {
        // In swarm mode (default), hooked is treated as in_progress
        let status = bead.status.lowercased() == "hooked"
            ? "in_progress"
            : bead.status.lowercased()
        switch status {
        case "closed":
            return .offline
        case "hooked", "in_progress":
            return .info
        case "open":
            return .success
        default:
            return .success
        }
    }
}

// MARK: - Mock Data

extension BeadsListViewModel {
    /// Mock beads for preview and testing
    static let mockBeads: [BeadInfo] = [
        BeadInfo(
            id: "adj-001",
            title: "Implement Beads Tracker View",
            status: "in_progress",
            priority: 1,
            type: "feature",
            assignee: "adjutant/polecats/flint",
            rig: "adjutant",
            source: "adjutant",
            labels: ["ios", "feature"],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: "2026-01-25T14:30:00Z"
        ),
        BeadInfo(
            id: "adj-002",
            title: "Fix theme ambiguity issue",
            status: "open",
            priority: 0,
            type: "bug",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: ["bug", "swift"],
            createdAt: "2026-01-25T08:00:00Z",
            updatedAt: nil
        ),
        BeadInfo(
            id: "adj-003",
            title: "Add unit tests for BeadsListViewModel",
            status: "open",
            priority: 2,
            type: "task",
            assignee: "adjutant/crew/bob",
            rig: "adjutant",
            source: "adjutant",
            labels: ["testing"],
            createdAt: "2026-01-24T16:00:00Z",
            updatedAt: nil
        ),
        BeadInfo(
            id: "adj-004",
            title: "Completed feature from last sprint",
            status: "closed",
            priority: 3,
            type: "feature",
            assignee: "adjutant/polecats/flint",
            rig: "adjutant",
            source: "adjutant",
            labels: ["done"],
            createdAt: "2026-01-15T10:00:00Z",
            updatedAt: "2026-01-22T17:00:00Z"
        )
    ]
}
