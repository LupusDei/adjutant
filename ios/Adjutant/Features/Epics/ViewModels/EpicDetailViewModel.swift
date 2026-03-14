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

    /// Epic cost data (loaded asynchronously)
    @Published private(set) var epicCost: BeadCost?

    /// Non-fatal error when children fail to load but epic is available
    @Published var childrenErrorMessage: String?

    /// Controls the agent picker sheet
    @Published var showingAgentPicker = false

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
        childrenErrorMessage = nil
        await loadEpicDetails()
    }

    /// Loads the epic and its children using the dependency graph endpoints.
    /// Uses cached data for instant display, then fetches fresh data.
    /// Epic detail and children are fetched independently so a children
    /// failure doesn't prevent showing the epic header.
    func loadEpicDetails() async {
        // Show cached epic immediately if available
        if epic == nil, let cached = ResponseCache.shared.epics.first(where: { $0.id == epicId }) {
            epic = cached
        }

        // Only show loading spinner if we have no cached data to display
        await performAsyncAction(showLoading: epic == nil) { [weak self] in
            guard let self = self else { return }

            let client = self.apiClient
            let id = self.epicId

            // Launch independent unstructured tasks so one failure
            // doesn't cancel the other via structured concurrency
            let epicHandle = Task<BeadDetail?, Error> {
                try await client.getBeadDetail(id: id)
            }
            let childrenHandle = Task<[BeadInfo]?, Error> {
                try await client.getEpicChildren(epicId: id)
            }

            // Await both results independently
            var epicResult: BeadDetail?
            var childrenResult: [BeadInfo]?
            var firstError: Error?

            do {
                epicResult = try await epicHandle.value
            } catch {
                if !(error is CancellationError) {
                    firstError = error
                }
            }

            do {
                childrenResult = try await childrenHandle.value
            } catch {
                if firstError == nil, !(error is CancellationError) {
                    firstError = error
                }
            }

            // Update epic if we got fresh data
            if let detail = epicResult {
                self.epic = detail.asBeadInfo
            }

            // Update children if we got them
            if let children = childrenResult {
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

            // If we have no epic data at all, propagate the error
            if epicResult == nil && self.epic == nil, let error = firstError {
                throw error
            }

            // If only children failed but we have the epic, show a non-fatal error
            if childrenResult == nil, let error = firstError, self.epic != nil {
                self.childrenErrorMessage = error.localizedDescription
            }

            // Fetch epic cost (non-blocking, uses children for aggregation)
            await self.loadEpicCost()
        }
    }

    /// Loads cost data for the epic, aggregated with children if available.
    private func loadEpicCost() async {
        let childIds = subtasks.map { $0.id }
        do {
            epicCost = try await apiClient.getBeadCost(
                beadId: epicId,
                children: childIds.isEmpty ? nil : childIds
            )
        } catch {
            // Cost loading failure is non-fatal
        }
    }

    // MARK: - Actions

    /// Updates the epic's status
    func updateStatus(_ newStatus: String) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.updateBeadStatus(id: self.epicId, status: newStatus)
            await self.loadEpicDetails()
        }
    }

    /// Assigns the epic to an agent and sets status to in_progress
    func assignEpic(to agent: CrewMember) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.assignBead(id: self.epicId, assignee: agent.id)
            _ = try await self.apiClient.updateBeadStatus(id: self.epicId, status: "in_progress")
            await self.loadEpicDetails()
        }
    }

    /// Unassigns the epic (clears assignee and sets status back to open)
    func unassignEpic() async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.assignBead(id: self.epicId, assignee: "")
            _ = try await self.apiClient.updateBeadStatus(id: self.epicId, status: "open")
            await self.loadEpicDetails()
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

    /// Formatted epic cost (e.g., "$47.32")
    var formattedCost: String? {
        guard let cost = epicCost?.totalCost, cost > 0 else { return nil }
        if cost < 0.01 { return "<$0.01" }
        return String(format: "$%.2f", cost)
    }

    /// Number of sessions contributing to the epic's cost
    var costSessionCount: Int {
        epicCost?.sessionCount ?? 0
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
