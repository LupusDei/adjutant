import Foundation
import Combine
import AdjutantKit

/// Represents an epic with its progress information
struct EpicWithProgress: Identifiable, Equatable {
    let epic: BeadInfo
    let completedCount: Int
    let totalCount: Int

    var id: String { epic.id }

    var progress: Double {
        guard totalCount > 0 else { return 0 }
        return Double(completedCount) / Double(totalCount)
    }

    var isComplete: Bool {
        totalCount > 0 && completedCount == totalCount
    }

    var progressText: String {
        "\(completedCount)/\(totalCount)"
    }
}

/// ViewModel for the Epics list view.
/// Handles loading epics, categorizing into Open/Complete, and calculating progress.
@MainActor
final class EpicsListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Open epics (have unclosed subtasks)
    @Published private(set) var openEpics: [EpicWithProgress] = []

    /// Complete epics (all subtasks closed)
    @Published private(set) var completeEpics: [EpicWithProgress] = []

    /// All beads (used for calculating subtask progress)
    private var allBeads: [BeadInfo] = []

    // MARK: - Dependencies

    private let apiClient: APIClient

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
        loadFromCache()
    }

    /// Loads cached epics for immediate display
    private func loadFromCache() {
        let cached = ResponseCache.shared.epics
        if !cached.isEmpty {
            processEpics(cached, allBeads: ResponseCache.shared.beads)
        }
    }

    deinit {
        pollingTask?.cancel()
    }

    /// Sets up observation of rig filter changes from AppState
    private func setupRigFilterObserver() {
        AppState.shared.$selectedRig
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task {
                    await self?.refresh()
                }
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
        await loadEpics()
    }

    /// Loads epics and all beads from the API
    func loadEpics() async {
        await performAsyncAction { [weak self] in
            guard let self = self else { return }

            // Fetch epics (type: epic)
            let rigFilter = self.selectedRig ?? "all"
            let epics = try await self.apiClient.getBeads(
                rig: rigFilter,
                type: "epic"
            )

            // Fetch all beads to calculate subtask progress
            let beads = try await self.apiClient.getBeads(
                rig: rigFilter,
                status: .all
            )

            self.allBeads = beads
            self.processEpics(epics, allBeads: beads)

            // Update cache
            ResponseCache.shared.updateEpics(epics)
        }
    }

    // MARK: - Processing

    /// Process epics and categorize them into Open and Complete
    private func processEpics(_ epics: [BeadInfo], allBeads: [BeadInfo]) {
        var open: [EpicWithProgress] = []
        var complete: [EpicWithProgress] = []

        for epic in epics {
            // Find subtasks that belong to this epic
            // Children are identified by hierarchical ID pattern: parent.X where X is numeric
            let epicIdPrefix = epic.id + "."
            let subtasks = allBeads.filter { bead in
                // Check hierarchical ID: child ID starts with parent ID followed by a dot
                guard bead.id.hasPrefix(epicIdPrefix) else { return false }
                let suffix = String(bead.id.dropFirst(epicIdPrefix.count))
                // Direct children have a numeric prefix (e.g., "1", "1.2", "12")
                return !suffix.isEmpty && suffix.first?.isNumber == true
            }

            let completedCount = subtasks.filter { $0.status == "closed" }.count
            let totalCount = subtasks.count

            let epicWithProgress = EpicWithProgress(
                epic: epic,
                completedCount: completedCount,
                totalCount: totalCount
            )

            // Categorize based on epic status and subtask completion
            if epic.status == "closed" || (totalCount > 0 && completedCount == totalCount) {
                complete.append(epicWithProgress)
            } else {
                open.append(epicWithProgress)
            }
        }

        // Sort by most recently updated
        open.sort { ($0.epic.updatedDate ?? .distantPast) > ($1.epic.updatedDate ?? .distantPast) }
        complete.sort { ($0.epic.updatedDate ?? .distantPast) > ($1.epic.updatedDate ?? .distantPast) }

        self.openEpics = open
        self.completeEpics = complete
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

    /// Whether the view is empty (no epics)
    var isEmpty: Bool {
        openEpics.isEmpty && completeEpics.isEmpty
    }

    /// Total number of epics
    var totalCount: Int {
        openEpics.count + completeEpics.count
    }
}
