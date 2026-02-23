import Foundation
import Combine
import AdjutantKit

/// ViewModel for the bead detail view.
/// Handles bead loading, status updates, and formatting.
@MainActor
final class BeadDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The bead info (for compatibility with existing view bindings)
    @Published private(set) var bead: BeadInfo?

    /// Full bead detail with description, dependencies, etc.
    @Published private(set) var beadDetail: BeadDetail?

    /// Controls the agent picker sheet
    @Published var showingAgentPicker = false

    // MARK: - Private Properties

    private let beadId: String
    private let apiClient: APIClient

    // MARK: - Initialization

    init(beadId: String, apiClient: APIClient? = nil) {
        self.beadId = beadId
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func refresh() async {
        await loadBead()
    }

    // MARK: - Public Methods

    /// Loads full bead detail via GET /api/beads/:id
    func loadBead() async {
        await performAsyncAction {
            let detail = try await self.apiClient.getBeadDetail(id: self.beadId)
            self.beadDetail = detail
            self.bead = detail.asBeadInfo
        }
    }

    /// Updates the bead's status
    func updateStatus(_ newStatus: String) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.updateBeadStatus(id: self.beadId, status: newStatus)
            await self.loadBead()
        }
    }

    /// Assigns the bead to an agent
    func assignBead(to agent: CrewMember) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.assignBead(id: self.beadId, assignee: agent.id)
            await self.loadBead()
        }
    }

    // MARK: - Computed Properties

    /// Full description text
    var descriptionText: String? {
        guard let desc = beadDetail?.description, !desc.isEmpty else { return nil }
        return desc
    }

    /// Dependencies where this bead blocks others
    var blocksDeps: [BeadDependency] {
        beadDetail?.blocksDeps ?? []
    }

    /// Dependencies where this bead is blocked by others
    var blockedByDeps: [BeadDependency] {
        beadDetail?.blockedByDeps ?? []
    }

    /// Parent epic ID derived from bead ID hierarchy
    var parentEpicId: String? {
        beadDetail?.parentEpicId
    }

    /// Whether this bead has any dependencies
    var hasDependencies: Bool {
        !blocksDeps.isEmpty || !blockedByDeps.isEmpty
    }

    /// Agent state if assigned
    var agentState: String? {
        beadDetail?.agentState
    }

    /// Formatted closed date
    var formattedClosedDate: String? {
        guard let date = beadDetail?.closedDate else { return nil }
        return formatDate(date)
    }

    /// Whether the bead is pinned
    var isPinned: Bool {
        beadDetail?.pinned ?? false
    }

    /// Formatted creation date
    var formattedCreatedDate: String {
        guard let date = bead?.createdDate else { return "Unknown" }
        return formatDate(date)
    }

    /// Formatted update date
    var formattedUpdatedDate: String {
        guard let date = bead?.updatedDate else { return "Never" }
        return formatDate(date)
    }

    /// Priority display text
    var priorityText: String {
        guard let priority = bead?.priority else { return "" }
        switch priority {
        case 0: return "P0 URGENT"
        case 1: return "P1 HIGH"
        case 2: return "P2 NORMAL"
        case 3: return "P3 LOW"
        case 4: return "P4 LOWEST"
        default: return "P\(priority)"
        }
    }

    /// Status display text
    var statusText: String {
        guard let status = bead?.status else { return "" }
        return status.replacingOccurrences(of: "_", with: " ").uppercased()
    }

    /// Formatted assignee (short form)
    var formattedAssignee: String? {
        guard let assignee = bead?.assignee, !assignee.isEmpty else { return nil }
        let parts = assignee.split(separator: "/")
        return parts.last.map(String.init) ?? assignee
    }

    /// Full assignee path
    var fullAssignee: String? {
        bead?.assignee
    }

    // MARK: - Private Helpers

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Errors

enum BeadDetailError: LocalizedError {
    case notFound(String)

    var errorDescription: String? {
        switch self {
        case .notFound(let id):
            return "Bead '\(id)' not found"
        }
    }
}
