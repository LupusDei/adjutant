import Foundation

// MARK: - Artifacts Endpoints (epic adj-j7az6, Phase 4 / US4)

extension APIClient {
    /// Fetches all artifacts (newest-first). Artifacts are global/personal — no project scope.
    ///
    /// Maps to `GET /api/artifacts` → `data` = `[Artifact]`.
    ///
    /// - Returns: An array of ``Artifact`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func fetchArtifacts() async throws -> [Artifact] {
        try await requestWithEnvelope(.get, path: "/artifacts")
    }

    /// Fetches a single artifact by id.
    ///
    /// Maps to `GET /api/artifacts/:id` → `data` = `Artifact`.
    ///
    /// - Parameter id: The artifact UUID.
    /// - Returns: An ``Artifact``.
    /// - Throws: ``APIClientError`` if the request fails or the artifact is not found.
    public func getArtifact(id: String) async throws -> Artifact {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/artifacts/\(encodedId)")
    }

    /// Creates a new artifact from authored HTML.
    ///
    /// Maps to `POST /api/artifacts` → `data` = `Artifact` (201).
    ///
    /// - Parameters:
    ///   - title: The artifact title (required).
    ///   - html: The self-contained authored HTML body (required).
    ///   - description: Optional summary.
    ///   - slug: Optional URL/download-friendly slug.
    /// - Returns: The created ``Artifact``.
    /// - Throws: ``APIClientError`` if validation fails or the request errors.
    public func createArtifact(
        title: String,
        html: String,
        description: String? = nil,
        slug: String? = nil
    ) async throws -> Artifact {
        let request = CreateArtifactRequest(title: title, html: html, description: description, slug: slug)
        return try await requestWithEnvelope(.post, path: "/artifacts", body: request)
    }

    /// Deletes an artifact.
    ///
    /// Maps to `DELETE /api/artifacts/:id` → `data` = `{ id, deleted: true }`.
    ///
    /// - Parameter id: The artifact UUID.
    /// - Throws: ``APIClientError`` if the request fails or the artifact is not found.
    public func deleteArtifact(id: String) async throws {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        // The server returns `{ id, deleted }`; we only care that the request succeeds.
        let _: DeleteArtifactResponse = try await requestWithEnvelope(.delete, path: "/artifacts/\(encodedId)")
    }

    /// Publishes an artifact to its public `/a/:token` page and returns the updated
    /// artifact plus the full, no-API-key public URL (derived server-side from the
    /// request host so it is correct behind a tunnel / reverse proxy).
    ///
    /// Maps to `POST /api/artifacts/:id/publish` → `{ artifact, publicUrl }`.
    ///
    /// - Parameter id: The artifact UUID.
    /// - Returns: A ``PublishArtifactResult`` carrying the updated ``Artifact`` and the public URL.
    /// - Throws: ``APIClientError`` if the request fails or the artifact is not found.
    public func publishArtifact(id: String) async throws -> PublishArtifactResult {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: PublishArtifactResponse = try await requestWithEnvelope(
            .post,
            path: "/artifacts/\(encodedId)/publish"
        )
        return PublishArtifactResult(artifact: envelope.artifact, publicUrl: envelope.publicUrl)
    }

    /// Revokes public access to an artifact. The share token is retained (so a later
    /// re-publish revives the same link) but `GET /a/:token` will 404 until re-published.
    ///
    /// Maps to `POST /api/artifacts/:id/unpublish` → `{ artifact }`.
    ///
    /// - Parameter id: The artifact UUID.
    /// - Returns: The updated ``Artifact`` (now with `isPublic == false`).
    /// - Throws: ``APIClientError`` if the request fails or the artifact is not found.
    public func unpublishArtifact(id: String) async throws -> Artifact {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: UnpublishArtifactResponse = try await requestWithEnvelope(
            .post,
            path: "/artifacts/\(encodedId)/unpublish"
        )
        return envelope.artifact
    }

    /// Downloads the composed, sanitized, self-contained artifact document as an HTML
    /// string — for the WKWebView viewer AND the save-to-Files flow. Works for PRIVATE
    /// artifacts too (this is the authed owner download endpoint).
    ///
    /// Maps to `GET /api/artifacts/:id/download` → raw `text/html` body.
    ///
    /// - Parameter id: The artifact UUID.
    /// - Returns: The composed HTML document as a `String`.
    /// - Throws: ``APIClientError`` if the request fails, the artifact is not found, or the
    ///   body is not valid UTF-8.
    public func downloadArtifactDocument(id: String) async throws -> String {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let (data, _) = try await requestData(.get, path: "/artifacts/\(encodedId)/download")
        guard let html = String(data: data, encoding: .utf8) else {
            throw APIClientError.decodingError("Artifact document was not valid UTF-8")
        }
        return html
    }
}

/// Decoded `data` envelope for `DELETE /api/artifacts/:id` → `{ id, deleted }`.
private struct DeleteArtifactResponse: Decodable {
    let id: String
    let deleted: Bool
}
