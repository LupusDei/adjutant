import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for the selector's FULL, unfiltered project source on `MissionControlViewModel`
/// (adj-209.3.2.1). The selector must show EVERY project (so a deselected one can be
/// re-enabled), which cannot come from the server-filtered map rollup — it comes from a cheap
/// `GET /api/projects`. These tests cover `loadAllProjects()` + the `allProjects` property.
@MainActor
final class MissionControlViewModelAllProjectsTests: XCTestCase {
    private var viewModel: MissionControlViewModel!
    private var mockAPIClient: APIClient!

    override func setUp() async throws {
        mockAPIClient = makeMockAPIClient()
        viewModel = MissionControlViewModel(apiClient: mockAPIClient, defaults: makeEphemeralDefaults())
    }

    override func tearDown() async throws {
        viewModel.onDisappear()
        viewModel = nil
        mockAPIClient = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - Helpers

    private func makeMockAPIClient() -> APIClient {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        return APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    private func makeEphemeralDefaults() -> UserDefaults {
        let suite = "mc-allprojects-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    /// Envelope for `GET /api/projects` (a list of `Project`).
    private func projectsEnvelope(_ named: [(id: String, name: String)]) -> [String: Any] {
        let projects: [[String: Any]] = named.map {
            ["id": $0.id, "name": $0.name, "path": "/tmp/\($0.id)", "mode": "squad", "createdAt": "2026-01-01T00:00:00.000Z"]
        }
        return ["success": true, "data": projects, "timestamp": "2026-07-27T00:00:00.000Z"]
    }

    /// Route the mock by path: `/projects` returns the list; anything else 404s (this suite
    /// only exercises `loadAllProjects`).
    private func installProjectsMock(_ named: [(id: String, name: String)]) {
        let json = projectsEnvelope(named)
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/projects") {
                let data = try JSONSerialization.data(withJSONObject: json)
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                               headerFields: ["Content-Type": "application/json"])!
                return (response, data)
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (response, Data())
        }
    }

    private func installFailingMock() {
        MockURLProtocol.mockHandler = { _ in throw URLError(.notConnectedToInternet) }
    }

    // MARK: - Tests

    func testAllProjectsIsEmptyBeforeLoad() {
        XCTAssertTrue(viewModel.allProjects.isEmpty, "No project universe until loadAllProjects runs")
    }

    func testLoadAllProjectsPopulatesTheUniverse() async {
        installProjectsMock([("p0", "Alpha"), ("p1", "Bravo"), ("p2", "Charlie")])
        await viewModel.loadAllProjects()
        XCTAssertEqual(viewModel.allProjects.map(\.id), ["p0", "p1", "p2"])
        XCTAssertEqual(viewModel.allProjects.map(\.name), ["Alpha", "Bravo", "Charlie"])
    }

    func testLoadAllProjectsIsResilientOnFailure() async {
        installProjectsMock([("p0", "Alpha")])
        await viewModel.loadAllProjects()
        XCTAssertEqual(viewModel.allProjects.count, 1)

        // A subsequent failure must NOT clear the last good universe (selector stays usable offline).
        installFailingMock()
        await viewModel.loadAllProjects()
        XCTAssertEqual(viewModel.allProjects.map(\.name), ["Alpha"], "Failure keeps the last good project list")
    }
}
