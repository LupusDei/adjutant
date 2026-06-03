import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for SwarmOverviewViewModel's open-questions integration (adj-181.20).
///
/// Covers:
/// - openQuestions populated when listQuestions returns items → banner would show
/// - openQuestions empty when listQuestions returns [] → banner hidden
/// - openQuestions stays [] and overview still loads when listQuestions throws
@MainActor
final class SwarmOverviewViewModelTests: XCTestCase {
    private var viewModel: SwarmOverviewViewModel!
    private var mockAPIClient: APIClient!

    override func setUp() async throws {
        mockAPIClient = makeMockAPIClient()
        viewModel = SwarmOverviewViewModel(apiClient: mockAPIClient)
    }

    override func tearDown() async throws {
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

    /// Minimal valid GlobalOverviewResponse JSON envelope.
    private var overviewJSON: Any {
        [
            "success": true,
            "data": [
                "projects": [],
                "agents": [],
                "beads": [
                    "inProgress": [],
                    "recentlyClosed": []
                ],
                "epics": [
                    "inProgress": [],
                    "recentlyCompleted": []
                ],
                "unreadMessages": []
            ] as [String: Any],
            "timestamp": "2026-06-01T00:00:00.000Z"
        ] as [String: Any]
    }

    /// Minimal valid TimelineEventsResponse JSON envelope.
    private var timelineJSON: Any {
        [
            "success": true,
            "data": [
                "events": [],
                "total": 0,
                "hasMore": false
            ] as [String: Any],
            "timestamp": "2026-06-01T00:00:00.000Z"
        ] as [String: Any]
    }

    /// Build a questions list envelope containing the given question dicts.
    private func questionsEnvelope(_ items: [[String: Any]]) -> Any {
        [
            "success": true,
            "data": items,
            "timestamp": "2026-06-01T00:00:00.000Z"
        ] as [String: Any]
    }

    /// Build a minimal AgentQuestion dict for use in mock responses.
    private func questionDict(
        id: String,
        urgency: String = "normal",
        status: String = "open"
    ) -> [String: Any] {
        [
            "id": id,
            "projectId": "proj-uuid-1234",
            "agentId": "raynor",
            "body": "What should I do with \(id)?",
            "urgency": urgency,
            "status": status,
            "createdAt": "2026-06-01 10:00:00",
            "updatedAt": "2026-06-01 10:00:00"
        ]
    }

    /// Install a routing mock handler that serves different JSON per URL path.
    /// `routes` maps a path substring (e.g. "/questions") to its response JSON.
    /// Any unmatched path falls back to a 200 empty success envelope.
    private func installRoutingMock(routes: [String: Any]) {
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            let json: Any
            if let match = routes.keys.first(where: { path.contains($0) }) {
                json = routes[match]!
            } else {
                // Unmatched — return a generic success so the call doesn't throw
                json = ["success": true, "data": [], "timestamp": "2026-06-01T00:00:00.000Z"] as [String: Any]
            }
            let data = try JSONSerialization.data(withJSONObject: json)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }

    /// Install a mock that returns a network error for any path matching `pathSubstring`.
    private func installErrorMock(for pathSubstring: String, otherwise: Any) {
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if path.contains(pathSubstring) {
                throw URLError(.badServerResponse)
            }
            // Serve valid JSON for all other paths
            let data = try JSONSerialization.data(withJSONObject: otherwise)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }

    // MARK: - Initial State

    func testInitialState_openQuestionsIsEmpty() {
        XCTAssertTrue(viewModel.openQuestions.isEmpty,
            "openQuestions must be empty before any refresh — banner must not appear at launch")
    }

    // MARK: - Questions Populated → Banner Would Show

    func testRefresh_withOpenQuestions_populatesOpenQuestions() async {
        installRoutingMock(routes: [
            "/overview": overviewJSON,
            "/events/timeline": timelineJSON,
            "/questions": questionsEnvelope([
                questionDict(id: "q-001", urgency: "high"),
                questionDict(id: "q-002", urgency: "normal")
            ])
        ])

        await viewModel.refresh()

        XCTAssertEqual(viewModel.openQuestions.count, 2,
            "Banner should show when listQuestions returns items")
        XCTAssertTrue(viewModel.openQuestions.contains { $0.id == "q-001" })
        XCTAssertTrue(viewModel.openQuestions.contains { $0.id == "q-002" })
    }

    func testRefresh_withBlockingQuestion_isReflectedInOpenQuestions() async {
        installRoutingMock(routes: [
            "/overview": overviewJSON,
            "/events/timeline": timelineJSON,
            "/questions": questionsEnvelope([
                questionDict(id: "q-block-001", urgency: "blocking")
            ])
        ])

        await viewModel.refresh()

        XCTAssertEqual(viewModel.openQuestions.count, 1)
        XCTAssertEqual(viewModel.openQuestions.first?.urgency, .blocking,
            "Blocking questions must surface so the view can show the error-color badge")
    }

    // MARK: - Empty Questions → Banner Hidden

    func testRefresh_withEmptyQuestions_opensQuestionsRemainsEmpty() async {
        installRoutingMock(routes: [
            "/overview": overviewJSON,
            "/events/timeline": timelineJSON,
            "/questions": questionsEnvelope([])
        ])

        await viewModel.refresh()

        XCTAssertTrue(viewModel.openQuestions.isEmpty,
            "Banner must be hidden when there are no open questions")
    }

    // MARK: - Questions Fetch Error → Overview Still Loads

    func testRefresh_whenQuestionsFetchThrows_overviewStillLoadsAndOpenQuestionsStaysEmpty() async {
        // /questions errors; /overview and /timeline succeed
        installErrorMock(for: "/questions", otherwise: overviewJSON)

        // Install a routing override that serves timeline correctly too
        let overviewRef = overviewJSON
        let timelineRef = timelineJSON
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if path.contains("/questions") {
                throw URLError(.badServerResponse)
            }
            let json: Any = path.contains("/events/timeline") ? timelineRef : overviewRef
            let data = try JSONSerialization.data(withJSONObject: json)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        await viewModel.refresh()

        // Overview must load despite questions error
        XCTAssertNotNil(viewModel.overview,
            "Main overview must load even if questions fetch fails")

        // openQuestions must default to empty — not a crash or stuck state
        XCTAssertTrue(viewModel.openQuestions.isEmpty,
            "openQuestions must be [] when fetch throws — banner must stay hidden")

        // The questions error must NOT propagate to the user-visible error message
        XCTAssertNil(viewModel.errorMessage,
            "A questions fetch failure must not replace the main errorMessage")
    }

    // MARK: - Second Refresh Clears Stale Questions

    func testRefresh_afterQuestionsAnswered_openQuestionsUpdatesToEmpty() async {
        // First refresh: one open question
        installRoutingMock(routes: [
            "/overview": overviewJSON,
            "/events/timeline": timelineJSON,
            "/questions": questionsEnvelope([questionDict(id: "q-001")])
        ])
        await viewModel.refresh()
        XCTAssertEqual(viewModel.openQuestions.count, 1)

        // Second refresh: question is now answered — list is empty
        installRoutingMock(routes: [
            "/overview": overviewJSON,
            "/events/timeline": timelineJSON,
            "/questions": questionsEnvelope([])
        ])
        await viewModel.refresh()

        XCTAssertTrue(viewModel.openQuestions.isEmpty,
            "openQuestions must reflect the latest server state on each refresh")
    }
}
