import Foundation
import Combine

/// Observable view model owning the publish / unpublish / share state for a single
/// proposal (adj-200, Path D / US4).
///
/// Lives in AdjutantKit (not the app target) so the publish-toggle and share-URL logic
/// is unit-testable without an app host. The active server base URL is injected as a
/// closure (`serverBaseURL`) — the app passes
/// `{ ServerProfileStore.shared.active?.baseURL }` — so the share URL is always built
/// from the active ``ServerProfile`` via ``publicProposalURL(base:token:)``.
@MainActor
public final class ProposalSharingViewModel: ObservableObject {
    /// The current proposal (updated after publish / unpublish).
    @Published public private(set) var proposal: Proposal
    /// True while a publish/unpublish request is in flight.
    @Published public private(set) var isWorking: Bool = false
    /// Human-readable error message from the last failed operation, else nil.
    @Published public private(set) var errorMessage: String?

    private let apiClient: APIClient
    private let serverBaseURL: () -> String?

    public init(
        proposal: Proposal,
        apiClient: APIClient,
        serverBaseURL: @escaping () -> String?
    ) {
        self.proposal = proposal
        self.apiClient = apiClient
        self.serverBaseURL = serverBaseURL
    }

    /// Whether the proposal is currently published.
    public var isPublished: Bool { proposal.isPublished }

    /// The public share URL, built from the active server base and the proposal's share
    /// token. Returns nil when the proposal is not published, has no token, or there is
    /// no active server — i.e. there is nothing valid to share.
    public var shareURL: URL? {
        guard proposal.isPublished, let token = proposal.shareToken, let base = serverBaseURL() else {
            return nil
        }
        return publicProposalURL(base: base, token: token)
    }

    /// Publishes the proposal; on success flips `isPublished` and exposes `shareURL`.
    public func publish() async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        do {
            let result = try await apiClient.publishProposal(id: proposal.id)
            proposal = result.proposal
        } catch {
            errorMessage = Self.describe(error)
        }
        isWorking = false
    }

    /// Unpublishes the proposal; on success clears `shareURL` (token is retained server-side).
    public func unpublish() async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        do {
            proposal = try await apiClient.unpublishProposal(id: proposal.id)
        } catch {
            errorMessage = Self.describe(error)
        }
        isWorking = false
    }

    /// Toggles publish state based on the current value.
    public func togglePublished() async {
        if isPublished {
            await unpublish()
        } else {
            await publish()
        }
    }

    private static func describe(_ error: Error) -> String {
        if let apiError = error as? APIClientError {
            return apiError.localizedDescription
        }
        return error.localizedDescription
    }
}
