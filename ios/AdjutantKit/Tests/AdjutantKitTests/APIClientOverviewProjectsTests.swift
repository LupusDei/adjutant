import XCTest
@testable import AdjutantKit

/// Tests for `APIClient.getOverviewProjects()` (epic adj-208, US2 / adj-208.2.2).
///
/// Maps to `GET /api/overview/projects` (US1). The response is the standard
/// `ApiResponse<OverviewProjectsResponse>` envelope; the method returns the decoded
/// `data` payload and throws an `APIClientError` on an HTTP/error envelope.
///
/// Mirrors `APIClientStyleGuideTests`: an ephemeral session wired to `MockURLProtocol`,
/// `retryPolicy: .none` so error paths surface immediately.
final class APIClientOverviewProjectsTests: XCTestCase {
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

    // A realistic `data` payload (one project with activeEpic, one with null).
    private static let dataPayload: [String: Any] = [
        "projects": [
            [
                "projectId": "0e578d15-1111-2222-3333-444455556666",
                "name": "adjutant",
                "activeEpic": [
                    "id": "adj-208",
                    "title": "Mission Control",
                    "completionPercent": 0.42,
                    "closedChildren": 5,
                    "totalChildren": 12
                ],
                "epicsRemaining": 3,
                "openBeadsRemaining": 27,
                "agents": [
                    ["id": "engineer-ios-data", "status": "working"]
                ],
                "status": "on_track"
            ],
            [
                "projectId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "name": "beta",
                "activeEpic": NSNull(),
                "epicsRemaining": 0,
                "openBeadsRemaining": 4,
                "agents": [],
                "status": "blocked"
            ]
        ],
        "totals": [
            "projects": 2,
            "agentsActive": 1,
            "epicsRemaining": 3,
            "openBeadsRemaining": 31,
            "blocked": 1,
            "needsInput": 0,
            "portfolioCompletionPercent": 0.21
        ]
    ]

    // MARK: - Path + method

    func testHitsOverviewProjectsPathWithGet() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": Self.dataPayload,
                "timestamp": "2026-07-22T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.getOverviewProjects()
        XCTAssertTrue(capturedURL!.path.hasSuffix("/overview/projects"),
                      "Expected /overview/projects, got \(capturedURL!.path)")
        XCTAssertEqual(capturedMethod, "GET")
    }

    // MARK: - Success decode

    func testDecodesRollupFromEnvelope() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": Self.dataPayload,
            "timestamp": "2026-07-22T10:00:00.000Z"
        ])

        let rollup = try await client.getOverviewProjects()
        XCTAssertEqual(rollup.projects.count, 2)
        XCTAssertEqual(rollup.projects[0].name, "adjutant")
        XCTAssertEqual(rollup.projects[0].activeEpic?.id, "adj-208")
        XCTAssertNil(rollup.projects[1].activeEpic)
        XCTAssertEqual(rollup.totals.agentsActive, 1)
        XCTAssertEqual(rollup.totals.portfolioCompletionPercent, 0.21, accuracy: 0.0001)
    }

    // MARK: - Error path

    func testThrowsOnServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "INTERNAL_ERROR", message: "rollup failed"
        )
        do {
            _ = try await client.getOverviewProjects()
            XCTFail("Expected an error to be thrown on a 500 response")
        } catch {
            // expected — an HTTP/error envelope must surface, not decode to a value
        }
    }

    func testThrowsOnNetworkError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockNetworkError(.notConnectedToInternet)
        do {
            _ = try await client.getOverviewProjects()
            XCTFail("Expected a network error to be thrown")
        } catch {
            // expected
        }
    }
}
