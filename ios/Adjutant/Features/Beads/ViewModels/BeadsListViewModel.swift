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

    /// Currently selected rig filter (synced from AppState)
    private var selectedRig: String? {
        AppState.shared.selectedRig
    }

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

    // MARK: - Configuration

    /// Polling interval for auto-refresh
    private let pollingInterval: TimeInterval = 30.0

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient
        super.init()
        setupRigFilterObserver()
    }

    /// Sets up observation of rig filter changes from AppState
    private func setupRigFilterObserver() {
        AppState.shared.$selectedRig
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.applyFilter()
            }
            .store(in: &cancellables)
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        stopPolling()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadBeads()
    }

    /// Loads beads from the API
    func loadBeads() async {
        guard let apiClient = apiClient else {
            // Use mock data for preview/testing
            await performAsync {
                self.beads = Self.mockBeads
                self.applyFilter()
            }
            return
        }

        await performAsync { [weak self] in
            guard let self = self else { return }
            let response = try await apiClient.getBeads(status: .all)
            self.beads = response.sorted {
                // Sort by priority (lower = higher), then by updated date
                if $0.priority != $1.priority {
                    return $0.priority < $1.priority
                }
                return ($0.updatedDate ?? $0.createdDate ?? Date.distantPast) >
                       ($1.updatedDate ?? $1.createdDate ?? Date.distantPast)
            }
            self.applyFilter()
        }
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await refreshSilently()
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Silently refresh data in the background (no loading indicator)
    private func refreshSilently() async {
        guard let apiClient = apiClient else { return }

        await performAsync(showLoading: false) { [weak self] in
            guard let self = self else { return }
            let response = try await apiClient.getBeads(status: .all)
            self.beads = response.sorted {
                if $0.priority != $1.priority {
                    return $0.priority < $1.priority
                }
                return ($0.updatedDate ?? $0.createdDate ?? Date.distantPast) >
                       ($1.updatedDate ?? $1.createdDate ?? Date.distantPast)
            }
            self.applyFilter()
        }
    }

    // MARK: - Private Helpers

    /// Applies the current filter and search to beads
    private func applyFilter() {
        var result = beads

        // Apply rig filter
        if let rig = selectedRig {
            result = result.filter { bead in
                beadMatchesRig(bead, rig: rig)
            }
        }

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
                (bead.assignee?.lowercased().contains(query) ?? false) ||
                bead.labels.contains { $0.lowercased().contains(query) }
            }
        }

        filteredBeads = result
    }

    /// Checks if a bead is related to a specific rig
    private func beadMatchesRig(_ bead: BeadInfo, rig: String) -> Bool {
        let rigLower = rig.lowercased()
        // Match if bead source, rig, or assignee contains the rig name
        return bead.source.lowercased() == rigLower ||
               bead.rig?.lowercased() == rigLower ||
               (bead.assignee?.lowercased().hasPrefix(rigLower + "/") ?? false)
    }

    // MARK: - Computed Properties

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

    /// Get status type for badge display
    func statusType(for bead: BeadInfo) -> BadgeView.Style.StatusType {
        switch bead.status.lowercased() {
        case "closed":
            return .offline
        case "blocked", "deferred":
            return .warning
        case "hooked", "in_progress":
            return .info
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
            id: "hq-001",
            title: "Coordinate cross-rig deployment",
            status: "blocked",
            priority: 1,
            type: "epic",
            assignee: "mayor/",
            rig: nil,
            source: "town",
            labels: ["coordination", "deployment"],
            createdAt: "2026-01-20T10:00:00Z",
            updatedAt: "2026-01-24T09:00:00Z"
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
