import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for `MissionControlViewModel` (adj-208.2.3): the loading/loaded/error state machine,
/// `refresh()` re-fetch, and poll start/stop lifecycle. Mirrors `SwarmOverviewViewModel`
/// conventions and mocks the network via `MockURLProtocol`.
@MainActor
final class MissionControlViewModelTests: XCTestCase {
    private var viewModel: MissionControlViewModel!
    private var mockAPIClient: APIClient!

    override func setUp() async throws {
        mockAPIClient = makeMockAPIClient()
        installSuccessMock(projectNames: ["Alpha"])
        viewModel = MissionControlViewModel(apiClient: mockAPIClient)
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

    private func rollupEnvelope(projectNames: [String]) -> Any {
        let projects: [[String: Any]] = projectNames.enumerated().map { idx, name in
            [
                "projectId": "p\(idx)",
                "name": name,
                "activeEpic": [
                    "id": "e\(idx)", "title": "Epic \(name)",
                    "completionPercent": 40, "closedChildren": 2, "totalChildren": 5
                ] as [String: Any],
                "epicsRemaining": 1,
                "openBeadsRemaining": 3,
                "agents": [["id": "a\(idx)", "status": "working"] as [String: Any]],
                "status": "on_track"
            ]
        }
        return [
            "success": true,
            "data": [
                "projects": projects,
                "totals": [
                    "projects": projectNames.count, "agentsActive": projectNames.count,
                    "epicsRemaining": projectNames.count, "openBeadsRemaining": projectNames.count * 3,
                    "blocked": 0, "needsInput": 0, "portfolioCompletionPercent": 40
                ] as [String: Any]
            ] as [String: Any],
            "timestamp": "2026-07-01T00:00:00.000Z"
        ] as [String: Any]
    }

    private func installSuccessMock(projectNames: [String]) {
        let json = rollupEnvelope(projectNames: projectNames)
        MockURLProtocol.mockHandler = { request in
            let data = try JSONSerialization.data(withJSONObject: json)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])!
            return (response, data)
        }
    }

    private func installErrorMock() {
        MockURLProtocol.mockHandler = { _ in throw URLError(.badServerResponse) }
    }

    // MARK: - Initial state

    func testInitialStateIsLoading() {
        XCTAssertEqual(viewModel.state, .loading, "VM starts in loading before any fetch")
        XCTAssertNil(viewModel.rollup, "No rollup until loaded")
    }

    // MARK: - refresh success → loaded

    func testRefreshSuccessTransitionsToLoaded() async {
        await viewModel.refresh()
        guard case let .loaded(rollup) = viewModel.state else {
            return XCTFail("Expected .loaded, got \(viewModel.state)")
        }
        XCTAssertEqual(rollup.projects.count, 1)
        XCTAssertEqual(rollup.projects.first?.name, "Alpha")
        XCTAssertEqual(rollup.totals.projects, 1)
        XCTAssertEqual(viewModel.rollup?.projects.first?.name, "Alpha")
    }

    // MARK: - refresh failure → error

    func testRefreshFailureTransitionsToError() async {
        installErrorMock()
        await viewModel.refresh()
        guard case .error = viewModel.state else {
            return XCTFail("Expected .error from a failed first load, got \(viewModel.state)")
        }
    }

    // MARK: - refresh re-fetches

    func testRefreshReFetchesLatestData() async {
        await viewModel.refresh()
        XCTAssertEqual(viewModel.rollup?.projects.count, 1)

        installSuccessMock(projectNames: ["Alpha", "Bravo"])
        await viewModel.refresh()
        XCTAssertEqual(viewModel.rollup?.projects.count, 2, "refresh() must re-fetch the latest rollup")
    }

    // MARK: - resilience: failure after a good load keeps the last data

    func testFailureAfterLoadedKeepsLastGoodData() async {
        await viewModel.refresh()
        XCTAssertEqual(viewModel.rollup?.projects.count, 1)

        installErrorMock()
        await viewModel.refresh()
        XCTAssertEqual(viewModel.rollup?.projects.count, 1,
                       "A later poll failure must not blank the map — keep the last good rollup")
    }

    // MARK: - poll lifecycle

    func testOnAppearStartsPolling() {
        XCTAssertFalse(viewModel.isPolling)
        viewModel.onAppear()
        XCTAssertTrue(viewModel.isPolling, "onAppear starts the ~30s poll")
    }

    func testOnDisappearStopsPolling() {
        viewModel.onAppear()
        XCTAssertTrue(viewModel.isPolling)
        viewModel.onDisappear()
        XCTAssertFalse(viewModel.isPolling, "onDisappear stops the poll")
    }
}
