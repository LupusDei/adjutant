import XCTest
import SwiftUI
import AdjutantKit
@testable import AdjutantUI

/// Layout and structural tests for OpenQuestionsView (adj-181.5 / T042).
///
/// These tests verify the structural contract of the view via its ViewModel:
/// - The ViewModel correctly models the question data for display
/// - Suggested options are exposed on the question model
/// - Context and category are surfaced
/// - Answer and dismiss operations reach the backend (ViewModel → API)
///
/// Full pixel-accurate rendering requires an iOS simulator. These tests use
/// the real `OpenQuestionsViewModel` with a `MockURLProtocol`-backed
/// `APIClient` to verify behaviour without network I/O.
@MainActor
final class OpenQuestionsViewLayoutTests: XCTestCase {
    private var viewModel: OpenQuestionsViewModel!
    private var mockAPIClient: APIClient!

    override func setUp() async throws {
        mockAPIClient = createMockAPIClient()
        viewModel = OpenQuestionsViewModel(apiClient: mockAPIClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        mockAPIClient = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - Helpers

    private func createMockAPIClient() -> APIClient {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        return APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    private func questionJSON(
        id: String,
        agentId: String = "raynor",
        urgency: String = "normal",
        category: String? = nil,
        context: String? = nil,
        suggestedOptions: [String]? = nil
    ) -> [String: Any] {
        var q: [String: Any] = [
            "id": id,
            "projectId": "proj-uuid",
            "agentId": agentId,
            "body": "Question body for \(id)",
            "urgency": urgency,
            "status": "open",
            "createdAt": "2026-05-31 10:00:00",
            "updatedAt": "2026-05-31 10:00:00"
        ]
        if let category { q["category"] = category }
        if let context { q["context"] = context }
        if let opts = suggestedOptions { q["suggestedOptions"] = opts }
        return q
    }

    // MARK: - View construction

    func testViewConstructsWithViewModel() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true, "data": [],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.loadQuestions()

        // Constructing the view must not throw or crash
        let view = OpenQuestionsView(viewModel: viewModel)
        // The view is a value type — just checking it can be created
        XCTAssertNotNil(view)
    }

    func testViewModelExposesQuestionsForRendering() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                questionJSON(id: "q-001"),
                questionJSON(id: "q-002")
            ],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.filteredQuestions.count, 2)
    }

    func testViewModelEmptyStateHasZeroQuestions() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true, "data": [],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertTrue(viewModel.filteredQuestions.isEmpty)
    }

    func testQuestionRowExposesContextField() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001", context: "Rich framing for the General")],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.filteredQuestions.first?.context, "Rich framing for the General")
    }

    func testQuestionRowExposesCategoryChip() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001", category: "action_required")],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.filteredQuestions.first?.category, .actionRequired)
    }

    func testQuestionRowExposesSuggestedOptions() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001", suggestedOptions: ["Yes", "No", "Later"])],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.filteredQuestions.first?.suggestedOptions, ["Yes", "No", "Later"])
    }

    func testQuestionRowExposesUrgencyBadge() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001", urgency: "blocking")],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.filteredQuestions.first?.urgency, .blocking)
    }

    // MARK: - Answer interaction (via ViewModel)

    func testAnswerViaChosenOptionRemovesRowFromList() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001", suggestedOptions: ["SQLite", "Postgres"])],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.answer(questionId: "q-001", chosenOption: "SQLite")

        XCTAssertTrue(viewModel.filteredQuestions.isEmpty,
                      "Answered question should leave the open list")
    }

    func testAnswerViaFreeTextRemovesRowFromList() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001")],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.answer(questionId: "q-001", answerBody: "Do the thing.")

        XCTAssertTrue(viewModel.filteredQuestions.isEmpty)
    }

    // MARK: - Dismiss interaction (via ViewModel)

    func testDismissRemovesRowFromList() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [questionJSON(id: "q-001"), questionJSON(id: "q-002")],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
        await viewModel.dismiss(questionId: "q-001")

        XCTAssertEqual(viewModel.filteredQuestions.count, 1)
        XCTAssertFalse(viewModel.filteredQuestions.contains(where: { $0.id == "q-001" }))
    }
}
