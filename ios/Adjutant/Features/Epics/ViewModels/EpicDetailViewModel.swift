import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Epic detail view.
/// Handles loading epic details and its subtasks using the dependency graph.
@MainActor
final class EpicDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The epic being displayed
    @Published private(set) var epic: BeadInfo?

    /// Subtasks belonging to this epic
    @Published private(set) var subtasks: [BeadInfo] = []

    /// Open subtasks
    @Published private(set) var openSubtasks: [BeadInfo] = []

    /// Closed subtasks
    @Published private(set) var closedSubtasks: [BeadInfo] = []

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let epicId: String

    // MARK: - Initialization

    init(epicId: String, apiClient: APIClient? = nil) {
        self.epicId = epicId
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadEpicDetails()
    }

    /// Loads the epic and its children using the dependency graph endpoints
    func loadEpicDetails() async {
        await performAsyncAction { [weak self] in
            guard let self = self else { return }

            // Fetch epic detail and children in parallel
            async let epicTask = self.apiClient.getBeadDetail(id: self.epicId)
            async let childrenTask = self.apiClient.getEpicChildren(epicId: self.epicId)

            let (epicDetail, children) = try await (epicTask, childrenTask)

            self.epic = epicDetail.asBeadInfo

            // Sort by priority then by updated date
            let sorted = children.sorted { a, b in
                if a.priority != b.priority {
                    return a.priority < b.priority
                }
                return (a.updatedDate ?? .distantPast) > (b.updatedDate ?? .distantPast)
            }

            self.subtasks = sorted
            self.openSubtasks = sorted.filter { $0.status != "closed" }
            self.closedSubtasks = sorted.filter { $0.status == "closed" }
        }
    }

    // MARK: - Computed Properties

    /// Progress percentage
    var progress: Double {
        guard !subtasks.isEmpty else { return 0 }
        return Double(closedSubtasks.count) / Double(subtasks.count)
    }

    /// Progress text (e.g., "3/5")
    var progressText: String {
        "\(closedSubtasks.count)/\(subtasks.count)"
    }

    /// Whether the epic is complete
    var isComplete: Bool {
        !subtasks.isEmpty && closedSubtasks.count == subtasks.count
    }

    /// Formatted creation date
    var formattedCreatedDate: String {
        guard let date = epic?.createdDate else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Formatted update date
    var formattedUpdatedDate: String {
        guard let date = epic?.updatedDate else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Errors

enum EpicDetailError: LocalizedError {
    case epicNotFound

    var errorDescription: String? {
        switch self {
        case .epicNotFound:
            return "Epic not found"
        }
    }
}
