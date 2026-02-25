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
        epic.status == "closed" || (totalCount > 0 && completedCount == totalCount)
    }

    var progressText: String {
        "\(completedCount)/\(totalCount)"
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

    /// Loads epics with server-computed progress from the dependency graph endpoint
    func loadEpics() async {
        await performAsyncAction { [weak self] in
            guard let self = self else { return }

            let response = try await self.apiClient.getEpicsWithProgress(status: "all")

            self.processEpics(response)

            // Update cache with epic BeadInfo for other views
            let epicInfos = response.map { $0.epic }
            ResponseCache.shared.updateEpics(epicInfos)
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
