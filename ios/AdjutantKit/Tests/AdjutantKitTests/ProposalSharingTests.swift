import XCTest
@testable import AdjutantKit

/// Tests for the iOS proposal HTML-sharing surface (epic adj-200, Path D / US4).
///
/// Response shapes are taken from the FROZEN Path A backend contract
/// (`backend/src/routes/proposals.ts` + `backend/src/services/proposal-store.ts`
/// `rowToProposal`), NOT assumed TS-type shapes (Constitution Rule 1 / adj-067):
///
///   - `GET  /api/proposals/:id`            → `data` = Proposal (camelCase, now incl.
///                                            `html?`, `isPublic`, `shareToken?`, `publishedAt?`)
///   - `POST /api/proposals/:id/publish`    → `data` = `{ proposal: Proposal, publicUrl: String }`
///   - `POST /api/proposals/:id/unpublish`  → `data` = `{ proposal: Proposal }`
///
/// The shared `APIClient` decoder is a plain `JSONDecoder()` (no key strategy), so the
/// backend already emits camelCase keys — these tests lock that.
final class ProposalSharingTests: XCTestCase {
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

    // MARK: - Model decode (adj-200.5.1)

    /// A published proposal decodes the new sharing fields.
    func testProposalDecodesSharingFieldsWhenPublished() throws {
        let json = """
        {
          "id": "p-001",
          "author": "raynor",
          "title": "Shareable proposal",
          "description": "Body text",
          "type": "engineering",
          "status": "pending",
          "createdAt": "2026-06-18 10:00:00",
          "updatedAt": "2026-06-18 10:05:00",
          "html": "<section class=\\"proposal\\"><h1>Hi</h1></section>",
          "isPublic": true,
          "shareToken": "abc123def456ghi7",
          "publishedAt": "2026-06-18 10:05:00"
        }
        """.data(using: .utf8)!

        let p = try JSONDecoder().decode(Proposal.self, from: json)
        XCTAssertEqual(p.id, "p-001")
        XCTAssertEqual(p.html, "<section class=\"proposal\"><h1>Hi</h1></section>")
        XCTAssertEqual(p.isPublic, true)
        XCTAssertEqual(p.shareToken, "abc123def456ghi7")
        XCTAssertEqual(p.publishedAt, "2026-06-18 10:05:00")
        XCTAssertTrue(p.isPublished, "isPublished should be true when isPublic == true")
    }

    /// A legacy / unpublished proposal that omits the new fields must NOT fail to decode
    /// (decode-safe optionals — older backends and unpublished rows).
    func testProposalDecodesWhenSharingFieldsAbsent() throws {
        let json = """
        {
          "id": "p-002",
          "author": "kerrigan",
          "title": "Legacy proposal",
          "description": "No html",
          "type": "product",
          "status": "accepted",
          "createdAt": "2026-06-18 09:00:00",
          "updatedAt": "2026-06-18 09:00:00"
        }
        """.data(using: .utf8)!

        let p = try JSONDecoder().decode(Proposal.self, from: json)
        XCTAssertNil(p.html)
        XCTAssertNil(p.shareToken)
        XCTAssertNil(p.publishedAt)
        // isPublic absent → treated as not published
        XCTAssertFalse(p.isPublished)
    }

    /// An explicitly-unpublished proposal retains its token but reports not-published.
    func testProposalUnpublishedRetainsTokenButNotPublic() throws {
        let json = """
        {
          "id": "p-003",
          "author": "raynor",
          "title": "Was published",
          "description": "Body",
          "type": "engineering",
          "status": "pending",
          "createdAt": "2026-06-18 08:00:00",
          "updatedAt": "2026-06-18 11:00:00",
          "html": "<p>x</p>",
          "isPublic": false,
          "shareToken": "tok0123456789abcd",
          "publishedAt": "2026-06-18 08:30:00"
        }
        """.data(using: .utf8)!

        let p = try JSONDecoder().decode(Proposal.self, from: json)
        XCTAssertEqual(p.shareToken, "tok0123456789abcd")
        XCTAssertEqual(p.isPublic, false)
        XCTAssertFalse(p.isPublished)
    }

    // MARK: - publishProposal — request shape + decode (adj-200.5.1)

    func testPublishProposalHitsCorrectPathAndMethod() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [
                    "proposal": Self.publishedProposalDict(id: "p-001", token: "abc123def456ghi7"),
                    "publicUrl": "http://test.local/p/abc123def456ghi7"
                ],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.publishProposal(id: "p-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/proposals/p-001/publish"),
                      "Expected /proposals/p-001/publish, got \(capturedURL!.path)")
        XCTAssertEqual(capturedMethod, "POST")
    }

    func testPublishProposalDecodesProposalAndPublicURL() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "proposal": Self.publishedProposalDict(id: "p-001", token: "abc123def456ghi7"),
                "publicUrl": "http://test.local/p/abc123def456ghi7"
            ],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let result = try await client.publishProposal(id: "p-001")
        XCTAssertEqual(result.proposal.id, "p-001")
        XCTAssertEqual(result.proposal.isPublic, true)
        XCTAssertEqual(result.proposal.shareToken, "abc123def456ghi7")
        XCTAssertEqual(result.publicUrl, "http://test.local/p/abc123def456ghi7")
    }

    func testPublishProposalThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Proposal not found"
        )
        do {
            _ = try await client.publishProposal(id: "nope")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - unpublishProposal — request shape + decode (adj-200.5.1)

    func testUnpublishProposalHitsCorrectPathAndMethod() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [
                    "proposal": Self.unpublishedProposalDict(id: "p-001", token: "abc123def456ghi7")
                ],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.unpublishProposal(id: "p-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/proposals/p-001/unpublish"),
                      "Expected /proposals/p-001/unpublish, got \(capturedURL!.path)")
        XCTAssertEqual(capturedMethod, "POST")
    }

    func testUnpublishProposalDecodesProposalAndClearsPublic() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "proposal": Self.unpublishedProposalDict(id: "p-001", token: "abc123def456ghi7")
            ],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let proposal = try await client.unpublishProposal(id: "p-001")
        XCTAssertEqual(proposal.id, "p-001")
        XCTAssertEqual(proposal.isPublic, false)
        XCTAssertFalse(proposal.isPublished)
        // token is retained across unpublish (Path A contract)
        XCTAssertEqual(proposal.shareToken, "abc123def456ghi7")
    }

    func testUnpublishProposalThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Proposal not found"
        )
        do {
            _ = try await client.unpublishProposal(id: "nope")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - Fixtures (camelCase, matching backend rowToProposal)

    private static func publishedProposalDict(id: String, token: String) -> [String: Any] {
        [
            "id": id,
            "author": "raynor",
            "title": "Shareable proposal",
            "description": "Body text",
            "type": "engineering",
            "status": "pending",
            "createdAt": "2026-06-18 10:00:00",
            "updatedAt": "2026-06-18 10:05:00",
            "html": "<section class=\"proposal\"><h1>Hi</h1></section>",
            "isPublic": true,
            "shareToken": token,
            "publishedAt": "2026-06-18 10:05:00"
        ]
    }

    private static func unpublishedProposalDict(id: String, token: String) -> [String: Any] {
        [
            "id": id,
            "author": "raynor",
            "title": "Shareable proposal",
            "description": "Body text",
            "type": "engineering",
            "status": "pending",
            "createdAt": "2026-06-18 10:00:00",
            "updatedAt": "2026-06-18 11:00:00",
            "html": "<section class=\"proposal\"><h1>Hi</h1></section>",
            "isPublic": false,
            "shareToken": token,
            "publishedAt": "2026-06-18 10:05:00"
        ]
    }
}
