import Foundation
import Combine
import AdjutantKit

/// ViewModel for the proposal detail view.
/// Handles proposal loading, status updates, sending to agent, and formatting.
@MainActor
final class ProposalDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The proposal data
    @Published private(set) var proposal: Proposal?

    /// Whether the send-to-agent action succeeded (drives alert)
    @Published var sendSuccess: Bool = false

    // MARK: - Private Properties

    private let proposalId: String
    private let apiClient: APIClient

    // MARK: - Initialization

    init(proposalId: String, apiClient: APIClient? = nil) {
        self.proposalId = proposalId
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func refresh() async {
        await loadProposal()
    }

    // MARK: - Public Methods

    /// Loads the proposal detail via GET /api/proposals/:id
    func loadProposal() async {
        let result = await performAsync(showLoading: proposal == nil) { [self] in
            try await self.apiClient.getProposal(id: self.proposalId)
        }
        if let result { proposal = result }
    }

    /// Accepts the proposal
    func accept() async {
        await performAsyncAction(showLoading: false) { [self] in
            let updated = try await self.apiClient.updateProposalStatus(id: self.proposalId, status: .accepted)
            self.proposal = updated
        }
    }

    /// Dismisses the proposal
    func dismiss() async {
        await performAsyncAction(showLoading: false) { [self] in
            let updated = try await self.apiClient.updateProposalStatus(id: self.proposalId, status: .dismissed)
            self.proposal = updated
        }
    }

    /// Sends the proposal to an agent for epic planning via chat message
    func sendToAgent() async {
        guard let proposal else { return }
        let body = """
        ## Proposal: \(proposal.title)

        **Type:** \(proposal.type.rawValue)
        **Author:** \(proposal.author)
        **Status:** \(proposal.status.rawValue)

        ### Description

        \(proposal.description)

        ---

        Please use /speckit.specify to create a feature specification from this proposal, then /speckit.plan to generate an implementation plan, and /speckit.beads to create executable beads for orchestration.
        """

        await performAsyncAction(showLoading: false) { [self] in
            _ = try await self.apiClient.sendChatMessage(
                agentId: "user",
                body: body,
                threadId: "proposal-\(self.proposalId)"
            )
            self.sendSuccess = true
        }
    }

    // MARK: - Computed Properties

    /// Formatted creation date
    var formattedCreatedDate: String {
        guard let date = proposal?.createdDate else { return "Unknown" }
        return formatDate(date)
    }

    /// Formatted update date
    var formattedUpdatedDate: String {
        guard let proposal else { return "Unknown" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: proposal.updatedAt) ?? ISO8601DateFormatter().date(from: proposal.updatedAt)
        guard let date else { return proposal.updatedAt }
        return formatDate(date)
    }

    // MARK: - Private Helpers

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
