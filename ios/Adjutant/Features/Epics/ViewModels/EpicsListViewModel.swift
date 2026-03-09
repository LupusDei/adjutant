import Foundation
import Combine
import AdjutantKit

/// Represents an epic with its progress information
struct EpicWithProgress: Identifiable, Equatable {
    let epic: BeadInfo
    let completedCount: Int
    let totalCount: Int
    /// Cost for this epic (loaded asynchronously, may be nil)
    var cost: Double?

    var id: String { epic.id }

    var progress: Double {
        guard totalCount > 0 else { return 0 }
        return Double(completedCount) / Double(totalCount)
    }

    var isComplete: Bool {
        epic.status == "closed" || (totalCount > 0 && completedCount == totalCount)
    }

    var progressText: String {
        "\(completedCount)/\(totalCount)"
    }

    /// Formatted cost string (e.g., "$12.50")
    var formattedCost: String? {
        guard let cost else { return nil }
        if cost < 0.01 && cost > 0 { return "<$0.01" }
        return String(format: "$%.2f", cost)
    }
}

/// ViewModel for the Epics list view.
/// Handles loading epics, categorizing into Open/Complete, and calculating progress.
/// Uses the server-side epics-with-progress endpoint (dependency graph based).
@MainActor
final class EpicsListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Open epics (have unclosed subtasks)
    @Published private(set) var openEpics: [EpicWithProgress] = []

    /// Complete epics (all subtasks closed)
    @Published private(set) var completeEpics: [EpicWithProgress] = []

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    private let pollingInterval: TimeInterval = 30.0

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
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
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadEpics()
    }

    /// Loads epics with server-computed progress from the dependency graph endpoint
    func loadEpics() async {
        await performAsyncAction { [weak self] in
            guard let self = self else { return }

            let response = try await self.apiClient.getEpicsWithProgress(status: "all")

            self.processEpics(response)

            // Update cache with epic BeadInfo for other views
            let epicInfos = response.map { $0.epic }
            ResponseCache.shared.updateEpics(epicInfos)

            // Fetch costs for each epic asynchronously (non-blocking)
            await self.loadEpicCosts(from: response)
        }
    }

    /// Fetches cost data for each epic and updates the corresponding EpicWithProgress entries.
    /// Failures are silently ignored — cost display is optional.
    private func loadEpicCosts(from response: [EpicWithProgressResponse]) async {
        for item in response {
            let epicId = item.epic.id
            let childIds = item.children.map { $0.id }
            do {
                let beadCost = try await apiClient.getBeadCost(
                    beadId: epicId,
                    children: childIds.isEmpty ? nil : childIds
                )
                // Update the cost in the correct array
                if let idx = openEpics.firstIndex(where: { $0.id == epicId }) {
                    openEpics[idx].cost = beadCost.totalCost
                } else if let idx = completeEpics.firstIndex(where: { $0.id == epicId }) {
                    completeEpics[idx].cost = beadCost.totalCost
                }
            } catch {
                // Cost loading failure is non-fatal — just skip
            }
        }
    }

    // MARK: - Processing

    /// Process server response and categorize epics into Open and Complete
    private func processEpics(_ response: [EpicWithProgressResponse]) {
        var open: [EpicWithProgress] = []
        var complete: [EpicWithProgress] = []

        for item in response {
            let epicWithProgress = EpicWithProgress(
                epic: item.epic,
                completedCount: item.closedCount,
                totalCount: item.totalCount
            )

            if epicWithProgress.isComplete {
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
