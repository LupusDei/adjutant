import Foundation
import Combine
import AdjutantKit

/// ViewModel for the bead detail view.
/// Handles bead loading, status updates, and formatting.
@MainActor
final class BeadDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The bead being displayed
    @Published private(set) var bead: BeadInfo?

    /// Related beads (blocking/blocked by) - placeholder for future API support
    @Published private(set) var blockingBeads: [BeadInfo] = []
    @Published private(set) var blockedByBeads: [BeadInfo] = []

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

    /// Loads the bead by filtering from the full beads list
    func loadBead() async {
        await performAsyncAction {
            // Load all beads and find the one we want
            let allBeads = try await self.apiClient.getBeads(rig: "all", status: .all)
            self.bead = allBeads.first { $0.id == self.beadId }

            if self.bead == nil {
                throw BeadDetailError.notFound(self.beadId)
            }
        }
    }

    /// Updates the bead's status
    func updateStatus(_ newStatus: String) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.updateBeadStatus(id: self.beadId, status: newStatus)
            // Reload to get updated data
            await self.loadBead()
        }
    }

    // MARK: - Computed Properties

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
