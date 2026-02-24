import Foundation

// MARK: - Proposals Endpoints

extension APIClient {
    /// Fetches proposals with optional status and type filters.
    ///
    /// Maps to `GET /api/proposals?status=&type=`
    ///
    /// ## Example
    /// ```swift
    /// // Fetch all pending proposals
    /// let pending = try await client.fetchProposals(status: .pending)
    ///
    /// // Fetch all engineering proposals
    /// let engineering = try await client.fetchProposals(type: .engineering)
    ///
    /// // Fetch all proposals (no filter)
    /// let all = try await client.fetchProposals()
    /// ```
    ///
    /// - Parameters:
    ///   - status: Optional status filter (pending, accepted, dismissed).
    ///   - type: Optional type filter (product, engineering).
    /// - Returns: An array of ``Proposal`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func fetchProposals(
        status: ProposalStatus? = nil,
        type: ProposalType? = nil
    ) async throws -> [Proposal] {
        var queryItems: [URLQueryItem] = []
        if let status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }
        if let type {
            queryItems.append(URLQueryItem(name: "type", value: type.rawValue))
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
}
