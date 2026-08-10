import XCTest
@testable import AdjutantKit

/// Tests for the iOS Artifacts model + API client surface (epic adj-j7az6, Phase 4 / US4).
///
/// Response shapes are taken from the FROZEN Phase-1 backend contract
/// (`backend/src/routes/artifacts.ts` + `backend/src/services/artifact-store.ts`
/// `rowToArtifact`), NOT assumed TS-type shapes (Constitution Rule 1 / adj-067):
///
///   - `GET  /api/artifacts`               → `data` = [Artifact] (camelCase, newest-first)
///   - `GET  /api/artifacts/:id`           → `data` = Artifact
///   - `POST /api/artifacts`               → `data` = Artifact (201)
///   - `DELETE /api/artifacts/:id`         → `data` = `{ id, deleted: true }`
///   - `POST /api/artifacts/:id/publish`   → `data` = `{ artifact: Artifact, publicUrl: String }`
///   - `POST /api/artifacts/:id/unpublish` → `data` = `{ artifact: Artifact }`
///   - `GET  /api/artifacts/:id/download`  → raw text/html body (composed document)
///
/// The shared `APIClient` decoder is a plain `JSONDecoder()` (no key strategy), so the
/// backend already emits camelCase keys — these tests lock that.
final class ArtifactAPITests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        client = APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    // MARK: - Model decode

    func testArtifactDecodesPublishedFields() throws {
        let json = """
        {
          "id": "a-001",
          "title": "Launch Page",
          "slug": "launch-page",
          "description": "A landing page",
          "html": "<main><h1>Hi</h1></main>",
          "isPublic": true,
          "shareToken": "abc123def456ghi7",
          "publishedAt": "2026-08-10 10:05:00",
          "createdBy": "raynor",
          "createdAt": "2026-08-10 10:00:00",
          "updatedAt": "2026-08-10 10:05:00"
        }
        """.data(using: .utf8)!

        let a = try JSONDecoder().decode(Artifact.self, from: json)
        XCTAssertEqual(a.id, "a-001")
        XCTAssertEqual(a.title, "Launch Page")
        XCTAssertEqual(a.slug, "launch-page")
        XCTAssertEqual(a.description, "A landing page")
        XCTAssertEqual(a.html, "<main><h1>Hi</h1></main>")
        XCTAssertEqual(a.isPublic, true)
        XCTAssertEqual(a.shareToken, "abc123def456ghi7")
        XCTAssertEqual(a.publishedAt, "2026-08-10 10:05:00")
        XCTAssertEqual(a.createdBy, "raynor")
        XCTAssertTrue(a.isPublished)
    }

    /// An unpublished artifact omits the optional sharing/slug fields and must still decode.
    func testArtifactDecodesWhenOptionalFieldsAbsent() throws {
        let json = """
        {
          "id": "a-002",
          "title": "Draft",
          "html": "<p>x</p>",
          "isPublic": false,
          "createdAt": "2026-08-10 09:00:00",
          "updatedAt": "2026-08-10 09:00:00"
        }
        """.data(using: .utf8)!

        let a = try JSONDecoder().decode(Artifact.self, from: json)
        XCTAssertNil(a.slug)
        XCTAssertNil(a.description)
        XCTAssertNil(a.shareToken)
        XCTAssertNil(a.publishedAt)
        XCTAssertNil(a.createdBy)
        XCTAssertFalse(a.isPublished)
    }

    // MARK: - fetchArtifacts

    func testFetchArtifactsHitsCorrectPathAndDecodesList() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [
                    Self.artifactDict(id: "a-001", published: true),
                    Self.artifactDict(id: "a-002", published: false)
                ],
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        let artifacts = try await client.fetchArtifacts()
        XCTAssertEqual(artifacts.count, 2)
        XCTAssertEqual(artifacts[0].id, "a-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts"))
        XCTAssertEqual(capturedMethod, "GET")
    }

    // MARK: - getArtifact

    func testGetArtifactHitsCorrectPath() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": Self.artifactDict(id: "a-001", published: true),
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        let a = try await client.getArtifact(id: "a-001")
        XCTAssertEqual(a.id, "a-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts/a-001"))
    }

    // MARK: - createArtifact

    func testCreateArtifactPostsBodyAndDecodes() async throws {
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            capturedMethod = request.httpMethod
            if let data = MockURLProtocol.getBodyData(from: request) {
                capturedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
            return try MockURLProtocol.mockResponse(statusCode: 201, json: [
                "success": true,
                "data": Self.artifactDict(id: "a-100", published: false),
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        let a = try await client.createArtifact(
            title: "New Page",
            html: "<main>hi</main>",
            description: "desc"
        )
        XCTAssertEqual(a.id, "a-100")
        XCTAssertEqual(capturedMethod, "POST")
        XCTAssertEqual(capturedBody?["title"] as? String, "New Page")
        XCTAssertEqual(capturedBody?["html"] as? String, "<main>hi</main>")
        XCTAssertEqual(capturedBody?["description"] as? String, "desc")
    }

    // MARK: - deleteArtifact

    func testDeleteArtifactHitsCorrectPathAndMethod() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["id": "a-001", "deleted": true],
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        try await client.deleteArtifact(id: "a-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts/a-001"))
        XCTAssertEqual(capturedMethod, "DELETE")
    }

    // MARK: - publishArtifact

    func testPublishArtifactHitsCorrectPathAndDecodesPublicURL() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [
                    "artifact": Self.artifactDict(id: "a-001", published: true),
                    "publicUrl": "http://test.local/a/abc123def456ghi7"
                ],
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        let result = try await client.publishArtifact(id: "a-001")
        XCTAssertEqual(result.artifact.id, "a-001")
        XCTAssertEqual(result.artifact.isPublic, true)
        XCTAssertEqual(result.publicUrl, "http://test.local/a/abc123def456ghi7")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts/a-001/publish"))
        XCTAssertEqual(capturedMethod, "POST")
    }

    // MARK: - unpublishArtifact

    func testUnpublishArtifactHitsCorrectPathAndDecodes() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [
                    "artifact": Self.artifactDict(id: "a-001", published: false)
                ],
                "timestamp": "2026-08-10T10:00:00.000Z"
            ])(request)
        }

        let a = try await client.unpublishArtifact(id: "a-001")
        XCTAssertEqual(a.id, "a-001")
        XCTAssertEqual(a.isPublic, false)
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts/a-001/unpublish"))
    }

    func testPublishArtifactThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Artifact not found"
        )
        do {
            _ = try await client.publishArtifact(id: "nope")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - downloadArtifactDocument (composed HTML as String)

    func testDownloadArtifactDocumentReturnsComposedHTML() async throws {
        var capturedURL: URL?
        let doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><h1>Doc</h1></body></html>"
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "text/html; charset=utf-8",
                    "Content-Disposition": "attachment; filename=\"doc.html\""
                ]
            )!
            return (response, doc.data(using: .utf8)!)
        }

        let html = try await client.downloadArtifactDocument(id: "a-001")
        XCTAssertEqual(html, doc)
        XCTAssertTrue(capturedURL!.path.hasSuffix("/artifacts/a-001/download"))
    }

    // MARK: - publicArtifactURL helper

    func testPublicArtifactURLStripsApiSuffix() {
        let url = publicArtifactURL(base: "https://host.example.com/api", token: "tok123")
        XCTAssertEqual(url?.absoluteString, "https://host.example.com/a/tok123")
    }

    func testPublicArtifactURLWithoutApiSuffix() {
        let url = publicArtifactURL(base: "https://host.example.com", token: "tok123")
        XCTAssertEqual(url?.absoluteString, "https://host.example.com/a/tok123")
    }

    func testPublicArtifactURLWithPort() {
        let url = publicArtifactURL(base: "http://localhost:4201/api", token: "abc")
        XCTAssertEqual(url?.absoluteString, "http://localhost:4201/a/abc")
    }

    func testPublicArtifactURLEmptyTokenReturnsNil() {
        XCTAssertNil(publicArtifactURL(base: "https://host.example.com/api", token: ""))
    }

    func testPublicArtifactURLDoesNotStripApiInsideHost() {
        let url = publicArtifactURL(base: "https://api.example.com/api", token: "tok")
        XCTAssertEqual(url?.absoluteString, "https://api.example.com/a/tok")
    }

    // MARK: - Fixtures (camelCase, matching backend rowToArtifact)

    static func artifactDict(id: String, published: Bool) -> [String: Any] {
        var dict: [String: Any] = [
            "id": id,
            "title": "Artifact \(id)",
            "html": "<main><h1>\(id)</h1></main>",
            "isPublic": published,
            "createdAt": "2026-08-10 10:00:00",
            "updatedAt": "2026-08-10 10:05:00"
        ]
        if published {
            dict["shareToken"] = "abc123def456ghi7"
            dict["publishedAt"] = "2026-08-10 10:05:00"
        }
        return dict
    }
}
