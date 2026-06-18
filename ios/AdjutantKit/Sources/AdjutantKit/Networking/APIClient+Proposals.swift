import Foundation

// MARK: - Proposals Endpoints

extension APIClient {
    /// Fetches proposals with optional status, type, and project filters.
    ///
    /// Maps to `GET /api/proposals?status=&type=&project=`
    ///
    /// ## Example
    /// ```swift
    /// // Fetch all pending proposals
    /// let pending = try await client.fetchProposals(status: .pending)
    ///
    /// // Fetch all engineering proposals
    /// let engineering = try await client.fetchProposals(type: .engineering)
    ///
    /// // Fetch proposals for a specific project (by UUID)
    /// let scoped = try await client.fetchProposals(project: "a1b2c3d4-...")
    ///
    /// // Fetch all proposals (no filter)
    /// let all = try await client.fetchProposals()
    /// ```
    ///
    /// - Parameters:
    ///   - status: Optional status filter (pending, accepted, dismissed).
    ///   - type: Optional type filter (product, engineering).
    ///   - project: Optional project UUID filter. When provided, only proposals belonging to this project are returned.
    /// - Returns: An array of ``Proposal`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func fetchProposals(
        status: ProposalStatus? = nil,
        type: ProposalType? = nil,
        project: String? = nil
    ) async throws -> [Proposal] {
        var queryItems: [URLQueryItem] = []
        if let status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }
        if let type {
            queryItems.append(URLQueryItem(name: "type", value: type.rawValue))
        }
        if let project {
            queryItems.append(URLQueryItem(name: "project", value: project))
        }
        return try await requestWithEnvelope(
            .get,
            path: "/proposals",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Fetches a single proposal by ID.
    ///
    /// Maps to `GET /api/proposals/:id`
    ///
    /// - Parameter id: The proposal UUID.
    /// - Returns: A ``Proposal``.
    /// - Throws: ``APIClientError`` if the request fails or proposal is not found.
    public func getProposal(id: String) async throws -> Proposal {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/proposals/\(encodedId)")
    }

    /// Updates a proposal's status (accept or dismiss).
    ///
    /// Maps to `PATCH /api/proposals/:id`
    ///
    /// ## Example
    /// ```swift
    /// let accepted = try await client.updateProposalStatus(id: proposal.id, status: .accepted)
    /// print("Proposal \(accepted.title) accepted")
    /// ```
    ///
    /// - Parameters:
    ///   - id: The proposal UUID.
    ///   - status: The new status (accepted or dismissed).
    /// - Returns: The updated ``Proposal``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func updateProposalStatus(
        id: String,
        status: ProposalStatus
    ) async throws -> Proposal {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = UpdateProposalStatusRequest(status: status)
        return try await requestWithEnvelope(.patch, path: "/proposals/\(encodedId)", body: request)
    }

    // MARK: - Sharing (adj-200, Path D / US4)

    /// Publishes a proposal to its public `/p/:token` page and returns the updated
    /// proposal plus the full, no-API-key public URL (derived server-side from the
    /// request host).
    ///
    /// Maps to `POST /api/proposals/:id/publish` → `{ proposal, publicUrl }`.
    ///
    /// - Parameter id: The proposal UUID.
    /// - Returns: A ``PublishProposalResult`` carrying the updated ``Proposal`` and the
    ///   public URL string.
    /// - Throws: ``APIClientError`` if the request fails or the proposal is not found.
    public func publishProposal(id: String) async throws -> PublishProposalResult {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: PublishProposalResponse = try await requestWithEnvelope(
            .post,
            path: "/proposals/\(encodedId)/publish"
        )
        return PublishProposalResult(proposal: envelope.proposal, publicUrl: envelope.publicUrl)
    }

    /// Revokes public access to a proposal. The share token is retained (so a later
    /// re-publish revives the same link) but `GET /p/:token` will 404 until re-published.
    ///
    /// Maps to `POST /api/proposals/:id/unpublish` → `{ proposal }`.
    ///
    /// - Parameter id: The proposal UUID.
    /// - Returns: The updated ``Proposal`` (now with `isPublic == false`).
    /// - Throws: ``APIClientError`` if the request fails or the proposal is not found.
    public func unpublishProposal(id: String) async throws -> Proposal {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: UnpublishProposalResponse = try await requestWithEnvelope(
            .post,
            path: "/proposals/\(encodedId)/unpublish"
        )
        return envelope.proposal
    }

    // MARK: - Comments

    /// Fetches comments for a proposal.
    ///
    /// Maps to `GET /api/proposals/:id/comments`
    ///
    /// - Parameter proposalId: The proposal UUID.
    /// - Returns: An array of ``ProposalComment`` items ordered by creation date.
    /// - Throws: ``APIClientError`` if the request fails.
    public func fetchComments(proposalId: String) async throws -> [ProposalComment] {
        let encodedId = proposalId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? proposalId
        return try await requestWithEnvelope(.get, path: "/proposals/\(encodedId)/comments")
    }

    /// Posts a comment on a proposal.
    ///
    /// Maps to `POST /api/proposals/:id/comments`
    ///
    /// - Parameters:
    ///   - proposalId: The proposal UUID.
    ///   - author: The comment author.
    ///   - body: The comment body text.
    /// - Returns: The created ``ProposalComment``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func postComment(
        proposalId: String,
        author: String,
        body: String
    ) async throws -> ProposalComment {
        let encodedId = proposalId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? proposalId
        let request = CreateProposalCommentRequest(author: author, body: body)
        return try await requestWithEnvelope(.post, path: "/proposals/\(encodedId)/comments", body: request)
    }

    // MARK: - Revisions

    /// Fetches revision history for a proposal.
    ///
    /// Maps to `GET /api/proposals/:id/revisions`
    ///
    /// - Parameter proposalId: The proposal UUID.
    /// - Returns: An array of ``ProposalRevision`` items ordered by revision number.
    /// - Throws: ``APIClientError`` if the request fails.
    public func fetchRevisions(proposalId: String) async throws -> [ProposalRevision] {
        let encodedId = proposalId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? proposalId
        return try await requestWithEnvelope(.get, path: "/proposals/\(encodedId)/revisions")
    }
}
