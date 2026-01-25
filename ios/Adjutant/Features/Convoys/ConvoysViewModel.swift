import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Convoys list view.
/// Handles loading convoys, filtering by rig, and sorting.
@MainActor
final class ConvoysViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All convoys from the API
    @Published private(set) var convoys: [Convoy] = []

    /// Filtered convoys based on rig selection
    @Published private(set) var filteredConvoys: [Convoy] = []

    /// Current sort option
    @Published var sortOption: SortOption = .latestActivity {
        didSet { applyFiltersAndSort() }
    }

    /// Expanded convoy IDs
    @Published var expandedConvoyIds: Set<String> = []

    // MARK: - Sort Types

    /// Available sort options
    enum SortOption: String, CaseIterable, Identifiable {
        case latestActivity
        case urgency
        case leastComplete
        case convoyId

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .latestActivity: return "LATEST ACTIVITY"
            case .urgency: return "URGENCY (P0-P4)"
            case .leastComplete: return "LEAST COMPLETE"
            case .convoyId: return "CONVOY ID"
            }
        }
    }

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    private let pollingInterval: TimeInterval = 30.0

    /// Currently selected rig filter (synced from AppState)
    private var selectedRig: String? {
        AppState.shared.selectedRig
    }

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        setupRigFilterObserver()
    }

    deinit {
        pollingTask?.cancel()
    }

    /// Sets up observation of rig filter changes from AppState
    private func setupRigFilterObserver() {
        AppState.shared.$selectedRig
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.applyFiltersAndSort()
            }
            .store(in: &cancellables)
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadConvoys()
    }

    /// Loads convoys from the API
    func loadConvoys() async {
        guard let apiClient = apiClient else {
            // Use mock data for preview/testing
            await performAsync {
                self.convoys = Self.mockConvoys
                self.applyFiltersAndSort()
            }
            return
        }

        await performAsync { [weak self] in
            guard let self = self else { return }
            let loadedConvoys = try await apiClient.getConvoys()
            self.convoys = loadedConvoys
            self.applyFiltersAndSort()
        }
    }

    // MARK: - Filtering and Sorting

    /// Applies rig filter and current sort to convoys
    private func applyFiltersAndSort() {
        var result = convoys

        // Apply rig filter
        if let rig = selectedRig {
            result = result.filter { $0.rig == rig }
        }

        // Apply sort
        switch sortOption {
        case .latestActivity:
            // Sort by most recent update (using first tracked issue's updatedAt if available)
            result = result.sorted { c1, c2 in
                let date1 = c1.trackedIssues.compactMap { $0.updatedAt }.max() ?? ""
                let date2 = c2.trackedIssues.compactMap { $0.updatedAt }.max() ?? ""
                return date1 > date2
            }
        case .urgency:
            // Sort by highest priority (lowest number = highest priority)
            result = result.sorted { c1, c2 in
                let p1 = c1.trackedIssues.compactMap { $0.priority }.min() ?? 4
                let p2 = c2.trackedIssues.compactMap { $0.priority }.min() ?? 4
                return p1 < p2
            }
        case .leastComplete:
            // Sort by lowest completion percentage
            result = result.sorted { c1, c2 in
                c1.progress.percentage < c2.progress.percentage
            }
        case .convoyId:
            // Sort alphabetically by ID
            result = result.sorted { $0.id < $1.id }
        }

        filteredConvoys = result
    }

    // MARK: - Actions

    /// Toggles the expanded state of a convoy
    func toggleExpanded(_ convoyId: String) {
        if expandedConvoyIds.contains(convoyId) {
            expandedConvoyIds.remove(convoyId)
        } else {
            expandedConvoyIds.insert(convoyId)
        }
    }

    /// Checks if a convoy is expanded
    func isExpanded(_ convoyId: String) -> Bool {
        expandedConvoyIds.contains(convoyId)
    }

    // MARK: - Polling

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await refresh()
            }
        }
    }

    // MARK: - Computed Properties

    /// Total progress across all filtered convoys
    var totalProgress: Double {
        guard !filteredConvoys.isEmpty else { return 0 }
        let totalCompleted = filteredConvoys.reduce(0) { $0 + $1.progress.completed }
        let totalItems = filteredConvoys.reduce(0) { $0 + $1.progress.total }
        guard totalItems > 0 else { return 0 }
        return Double(totalCompleted) / Double(totalItems)
    }

    /// Number of incomplete convoys
    var incompleteCount: Int {
        filteredConvoys.filter { !$0.isComplete }.count
    }

    /// Whether the view is empty (no convoys after filtering)
    var isEmpty: Bool {
        filteredConvoys.isEmpty
    }
}

// MARK: - Mock Data

extension ConvoysViewModel {
    static let mockConvoys: [Convoy] = [
        Convoy(
            id: "convoy-001",
            title: "iOS App MVP Release",
            status: "open",
            rig: "adjutant",
            progress: ConvoyProgress(completed: 7, total: 12),
            trackedIssues: [
                TrackedIssue(id: "adj-001", title: "Implement Dashboard View", status: "closed", assignee: "polecat/basalt", priority: 1),
                TrackedIssue(id: "adj-002", title: "Implement Mail List", status: "closed", assignee: "polecat/amber", priority: 1),
                TrackedIssue(id: "adj-003", title: "Implement Convoys View", status: "in_progress", assignee: "polecat/flint", priority: 2),
                TrackedIssue(id: "adj-004", title: "Implement Crew View", status: "open", priority: 2),
                TrackedIssue(id: "adj-005", title: "Add unit tests", status: "open", priority: 3)
            ]
        ),
        Convoy(
            id: "convoy-002",
            title: "Backend API Improvements",
            status: "open",
            rig: "gastown",
            progress: ConvoyProgress(completed: 3, total: 5),
            trackedIssues: [
                TrackedIssue(id: "gt-001", title: "Add convoy endpoints", status: "closed", priority: 1),
                TrackedIssue(id: "gt-002", title: "Improve error handling", status: "closed", priority: 2),
                TrackedIssue(id: "gt-003", title: "Add rate limiting", status: "open", priority: 2)
            ]
        ),
        Convoy(
            id: "convoy-003",
            title: "Documentation Sprint",
            status: "open",
            rig: nil,
            progress: ConvoyProgress(completed: 1, total: 4),
            trackedIssues: [
                TrackedIssue(id: "doc-001", title: "API documentation", status: "closed", priority: 2),
                TrackedIssue(id: "doc-002", title: "User guide", status: "open", priority: 3),
                TrackedIssue(id: "doc-003", title: "Developer setup guide", status: "open", priority: 3)
            ]
        )
    ]
}
