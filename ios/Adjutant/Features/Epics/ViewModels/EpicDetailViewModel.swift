import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Epic detail view.
/// Handles loading epic details and its subtasks.
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

    /// Loads the epic and its subtasks
    func loadEpicDetails() async {
        await performAsyncAction { [weak self] in
            guard let self = self else { return }

            // Fetch all beads to find the epic and its children
            let allBeads = try await self.apiClient.getBeads(rig: "all", status: .all)

            // Find the epic
            guard let epic = allBeads.first(where: { $0.id == self.epicId }) else {
                throw EpicDetailError.epicNotFound
            }

            self.epic = epic

            // Find subtasks that belong to this epic
            // Children are identified by hierarchical ID pattern: parent.X where X is numeric
            let epicIdPrefix = epic.id + "."
            let subtasks = allBeads.filter { bead in
                // Check hierarchical ID: child ID starts with parent ID followed by a dot
                // but only direct children (one level deep)
                guard bead.id.hasPrefix(epicIdPrefix) else { return false }
                let suffix = String(bead.id.dropFirst(epicIdPrefix.count))
                // Direct children have a simple numeric suffix (no more dots) or numeric.X pattern
                // e.g., for epic "l2r-gs0duv.1", children are "l2r-gs0duv.1.1", "l2r-gs0duv.1.2", etc.
                return !suffix.isEmpty && suffix.first?.isNumber == true
            }

            // Sort by priority then by updated date
            let sorted = subtasks.sorted { a, b in
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
