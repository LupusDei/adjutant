import XCTest
@testable import AdjutantKit

/// Tests for the iOS project style-guide surface (epic adj-201, US4 / adj-201.5.1).
///
/// Response/request shapes are taken from the FROZEN backend contract
/// (`backend/src/routes/projects.ts` + `backend/src/services/projects-service.ts`),
/// NOT assumed TS-type shapes (Constitution Rule 1 / adj-067):
///
///   - `GET /api/projects/:id/style-guide` → `data` =
///       `{ brandColorPrimary: String?, brandColorSecondary: String? }`
///     (both may be null — an unset guide is a VALID state). Unknown id → 404.
///   - `PUT /api/projects/:id/style-guide` body `{ primary: String, secondary: String? }`
///     → `data` = the updated guide (same shape). Invalid hex → 400.
///     Clearing primary (empty) clears the whole guide.
///
/// The shared `APIClient` decoder is a plain `JSONDecoder()` (no key strategy), so the
/// backend already emits camelCase keys — these tests lock that.
final class APIClientStyleGuideTests: XCTestCase {
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

    // MARK: - Model decode (ProjectStyleGuide)

    /// A set guide decodes both colors from the `data` envelope.
    func testStyleGuideDecodesBothColors() throws {
        let json = """
        { "brandColorPrimary": "#00FF00", "brandColorSecondary": "#003300" }
        """.data(using: .utf8)!

        let guide = try JSONDecoder().decode(ProjectStyleGuide.self, from: json)
        XCTAssertEqual(guide.brandColorPrimary, "#00FF00")
        XCTAssertEqual(guide.brandColorSecondary, "#003300")
    }

    /// An unset guide (both null) is a valid, decodable state — NOT an error.
    func testStyleGuideDecodesUnsetAsNil() throws {
        let json = """
        { "brandColorPrimary": null, "brandColorSecondary": null }
        """.data(using: .utf8)!

        let guide = try JSONDecoder().decode(ProjectStyleGuide.self, from: json)
        XCTAssertNil(guide.brandColorPrimary)
        XCTAssertNil(guide.brandColorSecondary)
    }

    /// A primary with no secondary decodes (secondary is optional).
    func testStyleGuideDecodesPrimaryOnly() throws {
        let json = """
        { "brandColorPrimary": "#1a2b3c", "brandColorSecondary": null }
        """.data(using: .utf8)!

        let guide = try JSONDecoder().decode(ProjectStyleGuide.self, from: json)
        XCTAssertEqual(guide.brandColorPrimary, "#1a2b3c")
        XCTAssertNil(guide.brandColorSecondary)
    }

    /// Missing keys (defensive — older backends) decode to nil rather than throwing.
    func testStyleGuideDecodesWhenKeysAbsent() throws {
        let json = "{}".data(using: .utf8)!
        let guide = try JSONDecoder().decode(ProjectStyleGuide.self, from: json)
        XCTAssertNil(guide.brandColorPrimary)
        XCTAssertNil(guide.brandColorSecondary)
    }

    // MARK: - getProjectStyleGuide — path/method + decode

    func testGetStyleGuideHitsCorrectPathAndMethod() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": NSNull()],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.getProjectStyleGuide(projectId: "proj-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/projects/proj-001/style-guide"),
                      "Expected /projects/proj-001/style-guide, got \(capturedURL!.path)")
        XCTAssertEqual(capturedMethod, "GET")
    }

    func testGetStyleGuideDecodesGuide() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": "#003300"],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let guide = try await client.getProjectStyleGuide(projectId: "proj-001")
        XCTAssertEqual(guide.brandColorPrimary, "#00FF00")
        XCTAssertEqual(guide.brandColorSecondary, "#003300")
    }

    func testGetStyleGuideDecodesUnsetGuide() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["brandColorPrimary": NSNull(), "brandColorSecondary": NSNull()],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let guide = try await client.getProjectStyleGuide(projectId: "proj-001")
        XCTAssertNil(guide.brandColorPrimary)
        XCTAssertNil(guide.brandColorSecondary)
    }

    func testGetStyleGuideThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Project not found"
        )
        do {
            _ = try await client.getProjectStyleGuide(projectId: "nope")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - updateProjectStyleGuide — path/method + body + decode

    func testUpdateStyleGuideHitsCorrectPathAndMethod() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": "#003300"],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.updateProjectStyleGuide(
            projectId: "proj-001", primary: "#00FF00", secondary: "#003300"
        )
        XCTAssertTrue(capturedURL!.path.hasSuffix("/projects/proj-001/style-guide"),
                      "Expected /projects/proj-001/style-guide, got \(capturedURL!.path)")
        XCTAssertEqual(capturedMethod, "PUT")
    }

    /// The PUT body must be `{ "primary": ..., "secondary": ... }` — matching the
    /// backend Zod schema EXACTLY (not the model's brandColor* field names).
    func testUpdateStyleGuideEncodesPrimaryAndSecondaryBody() async throws {
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            if let data = MockURLProtocol.getBodyData(from: request) {
                capturedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": "#003300"],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.updateProjectStyleGuide(
            projectId: "proj-001", primary: "#00FF00", secondary: "#003300"
        )

        XCTAssertEqual(capturedBody?["primary"] as? String, "#00FF00")
        XCTAssertEqual(capturedBody?["secondary"] as? String, "#003300")
    }

    /// A nil secondary must still encode the `secondary` key as JSON null so the
    /// backend can distinguish "no secondary" from an omitted field.
    func testUpdateStyleGuideEncodesNullSecondary() async throws {
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            if let data = MockURLProtocol.getBodyData(from: request) {
                capturedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": NSNull()],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.updateProjectStyleGuide(
            projectId: "proj-001", primary: "#00FF00", secondary: nil
        )

        XCTAssertEqual(capturedBody?["primary"] as? String, "#00FF00")
        XCTAssertTrue(capturedBody?["secondary"] is NSNull,
                      "secondary must serialize as JSON null when nil, got \(String(describing: capturedBody?["secondary"]))")
    }

    func testUpdateStyleGuideDecodesUpdatedGuide() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["brandColorPrimary": "#1a2b3c", "brandColorSecondary": NSNull()],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let guide = try await client.updateProjectStyleGuide(
            projectId: "proj-001", primary: "#1a2b3c", secondary: nil
        )
        XCTAssertEqual(guide.brandColorPrimary, "#1a2b3c")
        XCTAssertNil(guide.brandColorSecondary)
    }

    /// Clearing the guide (empty primary) returns a both-null guide, not an error.
    func testUpdateStyleGuideClearReturnsUnsetGuide() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["brandColorPrimary": NSNull(), "brandColorSecondary": NSNull()],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])

        let guide = try await client.updateProjectStyleGuide(
            projectId: "proj-001", primary: "", secondary: nil
        )
        XCTAssertNil(guide.brandColorPrimary)
        XCTAssertNil(guide.brandColorSecondary)
    }

    func testUpdateStyleGuideThrowsOnInvalidHex() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 400, code: "BAD_REQUEST", message: "Invalid hex color"
        )
        do {
            _ = try await client.updateProjectStyleGuide(
                projectId: "proj-001", primary: "notahex", secondary: nil
            )
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    func testUpdateStyleGuideThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Project not found"
        )
        do {
            _ = try await client.updateProjectStyleGuide(
                projectId: "nope", primary: "#00FF00", secondary: nil
            )
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }
}
