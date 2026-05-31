import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

/// Tests for OpenQuestionsViewModel (adj-181.5.3 / T041a).
///
/// Covers: initial state, load, sort order (blocking→high→normal→low then
/// oldest-first within tier), live WS updates (new question added, answered /
/// dismissed leaves the open list), answer via chosenOption, answer via free
/// text, combined answer, dismiss, and category/agent/urgency filter state.
@MainActor
final class OpenQuestionsViewModelTests: XCTestCase {
    private var viewModel: OpenQuestionsViewModel!
    private var mockAPIClient: APIClient!
    private var cancellables = Set<AnyCancellable>()

    override func setUp() async throws {
        mockAPIClient = createMockAPIClient()
        viewModel = OpenQuestionsViewModel(apiClient: mockAPIClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        mockAPIClient = nil
        MockURLProtocol.mockHandler = nil
        cancellables.removeAll()
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
        status: String = "open",
        category: String? = nil,
        createdAt: String = "2026-05-31 10:00:00",
        suggestedOptions: [String]? = nil
    ) -> [String: Any] {
        var q: [String: Any] = [
            "id": id,
            "projectId": "proj-uuid",
            "agentId": agentId,
            "body": "Question \(id)",
            "urgency": urgency,
            "status": status,
            "createdAt": createdAt,
            "updatedAt": createdAt
        ]
        if let category { q["category"] = category }
        if let opts = suggestedOptions { q["suggestedOptions"] = opts }
        return q
    }

    private func mockQuestionsList(_ questions: [[String: Any]]) -> MockURLProtocol.MockHandler {
        MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": questions,
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
    }

    private func mockAnswerSuccess() -> MockURLProtocol.MockHandler {
        MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])
    }

    // MARK: - Initial State

    func testInitialState() {
        XCTAssertTrue(viewModel.questions.isEmpty)
        XCTAssertNil(viewModel.filterCategory)
        XCTAssertNil(viewModel.filterAgentId)
        XCTAssertNil(viewModel.filterUrgency)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoading)
    }

    // MARK: - Load

    func testLoadQuestionsPopulatesList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "high"),
            questionJSON(id: "q-002", urgency: "normal")
        ])

        await viewModel.loadQuestions()

        XCTAssertEqual(viewModel.questions.count, 2)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadQuestionsEmptyListSucceeds() async {
        MockURLProtocol.mockHandler = mockQuestionsList([])
        await viewModel.loadQuestions()
        XCTAssertTrue(viewModel.questions.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadQuestionsSetsErrorOnFailure() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "SERVER_ERROR", message: "oops"
        )
        await viewModel.loadQuestions()
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.questions.isEmpty)
    }

    // MARK: - Sort Order (blocking→high→normal→low, then oldest-first within tier)

    func testSortOrderBlockingBeforeHighBeforeNormalBeforeLow() async {
        // Deliberately provide in reverse priority order; expect re-sorted output.
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-low",     urgency: "low",      createdAt: "2026-05-31 10:00:00"),
            questionJSON(id: "q-normal",  urgency: "normal",   createdAt: "2026-05-31 10:00:00"),
            questionJSON(id: "q-high",    urgency: "high",     createdAt: "2026-05-31 10:00:00"),
            questionJSON(id: "q-blocking",urgency: "blocking", createdAt: "2026-05-31 10:00:00")
        ])

        await viewModel.loadQuestions()

        let ids = viewModel.questions.map { $0.id }
        XCTAssertEqual(ids, ["q-blocking", "q-high", "q-normal", "q-low"])
    }

    func testSortOrderOldestFirstWithinSameTier() async {
        // Two questions at the same urgency — older one should appear first.
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-newer", urgency: "high", createdAt: "2026-05-31 11:00:00"),
            questionJSON(id: "q-older", urgency: "high", createdAt: "2026-05-31 09:00:00")
        ])

        await viewModel.loadQuestions()

        let ids = viewModel.questions.map { $0.id }
        XCTAssertEqual(ids, ["q-older", "q-newer"])
    }

    // MARK: - Live WS Updates

    func testLiveUpdateAddsNewQuestion() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal")
        ])
        await viewModel.loadQuestions()
        XCTAssertEqual(viewModel.questions.count, 1)

        // Simulate WS question:new event
        let newQ = AgentQuestion(
            id: "q-002",
            projectId: "proj-uuid",
            agentId: "kerrigan",
            body: "New question",
            urgency: .blocking,
            status: .open,
            createdAt: "2026-05-31 12:00:00",
            updatedAt: "2026-05-31 12:00:00"
        )
        viewModel.handleQuestionNew(newQ)

        XCTAssertEqual(viewModel.questions.count, 2)
        // Blocking should now be first
        XCTAssertEqual(viewModel.questions.first?.id, "q-002")
    }

    func testLiveUpdateAnsweredQuestionLeavesOpenList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal"),
            questionJSON(id: "q-002", urgency: "high")
        ])
        await viewModel.loadQuestions()
        XCTAssertEqual(viewModel.questions.count, 2)

        // Simulate WS question:answered event — q-001 should leave the open list
        viewModel.handleQuestionAnswered(id: "q-001")

        XCTAssertEqual(viewModel.questions.count, 1)
        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-001" }))
    }

    func testLiveUpdateDismissedQuestionLeavesOpenList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal"),
            questionJSON(id: "q-002", urgency: "high")
        ])
        await viewModel.loadQuestions()
        XCTAssertEqual(viewModel.questions.count, 2)

        // Simulate WS question:dismissed event
        viewModel.handleQuestionDismissed(id: "q-002")

        XCTAssertEqual(viewModel.questions.count, 1)
        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-002" }))
    }

    func testLiveNewQuestionDeduplicatesIfAlreadyPresent() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal")
        ])
        await viewModel.loadQuestions()

        // Simulate receiving the same question again (race condition / reconnect replay)
        let existingQ = AgentQuestion(
            id: "q-001",
            projectId: "proj-uuid",
            agentId: "raynor",
            body: "Question q-001",
            urgency: .normal,
            status: .open,
            createdAt: "2026-05-31 10:00:00",
            updatedAt: "2026-05-31 10:00:00"
        )
        viewModel.handleQuestionNew(existingQ)

        XCTAssertEqual(viewModel.questions.count, 1, "Duplicate question must not be added twice")
    }

    // MARK: - Answer (chosenOption)

    func testAnswerWithChosenOptionCallsAPIAndRemovesFromList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal",
                         suggestedOptions: ["SQLite", "Postgres"])
        ])
        await viewModel.loadQuestions()

        // Switch mock to answer endpoint
        MockURLProtocol.mockHandler = mockAnswerSuccess()
        await viewModel.answer(questionId: "q-001", chosenOption: "SQLite")

        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-001" }),
                       "Answered question must leave the open list")
        XCTAssertNil(viewModel.errorMessage)
    }

    // MARK: - Answer (free text)

    func testAnswerWithFreeTextCallsAPIAndRemovesFromList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "high")
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = mockAnswerSuccess()
        await viewModel.answer(questionId: "q-001", answerBody: "Use the second option.")

        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-001" }))
        XCTAssertNil(viewModel.errorMessage)
    }

    // MARK: - Answer (combined)

    func testAnswerWithBothFieldsCallsAPIAndRemovesFromList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "blocking",
                         suggestedOptions: ["Completed"])
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = mockAnswerSuccess()
        await viewModel.answer(
            questionId: "q-001",
            answerBody: "Done — key added.",
            chosenOption: "Completed"
        )

        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-001" }))
        XCTAssertNil(viewModel.errorMessage)
    }

    func testAnswerSetsErrorOnAPIFailure() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal")
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Not found"
        )
        await viewModel.answer(questionId: "q-001", answerBody: "x")

        // On failure, question stays in the list and errorMessage is set
        XCTAssertTrue(viewModel.questions.contains(where: { $0.id == "q-001" }))
        XCTAssertNotNil(viewModel.errorMessage)
    }

    // MARK: - Dismiss

    func testDismissCallsAPIAndRemovesFromList() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "low"),
            questionJSON(id: "q-002", urgency: "normal")
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = mockAnswerSuccess()
        await viewModel.dismiss(questionId: "q-001")

        XCTAssertFalse(viewModel.questions.contains(where: { $0.id == "q-001" }))
        XCTAssertEqual(viewModel.questions.count, 1)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testDismissSetsErrorOnAPIFailure() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "normal")
        ])
        await viewModel.loadQuestions()

        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "SERVER_ERROR", message: "boom"
        )
        await viewModel.dismiss(questionId: "q-001")

        XCTAssertTrue(viewModel.questions.contains(where: { $0.id == "q-001" }),
                      "On failure, question stays in list")
        XCTAssertNotNil(viewModel.errorMessage)
    }

    // MARK: - Filtering

    func testFilterByCategory() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", category: "decision"),
            questionJSON(id: "q-002", category: "clarification"),
            questionJSON(id: "q-003")  // no category
        ])
        await viewModel.loadQuestions()

        viewModel.filterCategory = .decision

        let filtered = viewModel.filteredQuestions
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "q-001")
    }

    func testFilterByAgentId() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", agentId: "raynor"),
            questionJSON(id: "q-002", agentId: "kerrigan")
        ])
        await viewModel.loadQuestions()

        viewModel.filterAgentId = "raynor"

        let filtered = viewModel.filteredQuestions
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "q-001")
    }

    func testFilterByUrgency() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", urgency: "high"),
            questionJSON(id: "q-002", urgency: "normal"),
            questionJSON(id: "q-003", urgency: "high")
        ])
        await viewModel.loadQuestions()

        viewModel.filterUrgency = .high

        let filtered = viewModel.filteredQuestions
        XCTAssertEqual(filtered.count, 2)
        XCTAssertTrue(filtered.allSatisfy { $0.urgency == .high })
    }

    func testMultipleFiltersAreComposable() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", agentId: "raynor", urgency: "high", category: "decision"),
            questionJSON(id: "q-002", agentId: "raynor", urgency: "normal", category: "decision"),
            questionJSON(id: "q-003", agentId: "kerrigan", urgency: "high", category: "decision")
        ])
        await viewModel.loadQuestions()

        viewModel.filterAgentId = "raynor"
        viewModel.filterUrgency = .high

        let filtered = viewModel.filteredQuestions
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "q-001")
    }

    func testClearingFiltersShowsAllQuestions() async {
        MockURLProtocol.mockHandler = mockQuestionsList([
            questionJSON(id: "q-001", agentId: "raynor"),
            questionJSON(id: "q-002", agentId: "kerrigan")
        ])
        await viewModel.loadQuestions()

        viewModel.filterAgentId = "raynor"
        XCTAssertEqual(viewModel.filteredQuestions.count, 1)

        viewModel.filterAgentId = nil
        XCTAssertEqual(viewModel.filteredQuestions.count, 2)
    }
}
