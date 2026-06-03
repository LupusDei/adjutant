import XCTest
@testable import AdjutantKit

/// CONTRACT TEST — iOS question API decode vs the REAL backend response shapes.
///
/// Three production bugs (adj-181.20/.21/.22) all had the same root cause: the iOS
/// client decoded the wrong `data` envelope shape, the decode threw at runtime, and
/// the unit tests passed only because they mocked the SAME wrong shape. This test
/// pins the iOS side to the ACTUAL backend output and — critically — asserts that the
/// OLD wrong shapes THROW, so this class of bug cannot silently return.
///
/// Backend source of truth (keep these shapes in sync):
///   - GET  /api/questions          → `success({ questions: [AgentQuestion], total })`
///       backend/src/routes/questions.ts (res.json(success({ questions, total })))
///       pinned by backend/tests/unit/questions-routes.test.ts (asserts data.questions/total)
///   - POST /api/questions/:id/answer  → `success({ question: AgentQuestion })`
///   - POST /api/questions/:id/dismiss → `success({ question: AgentQuestion })`
///       pinned by questions-routes.test.ts (asserts data.question.status)
final class QuestionsContractTests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        client = APIClient(
            configuration: APIClientConfiguration(
                baseURL: URL(string: "http://test.local/api")!,
                retryPolicy: .none
            ),
            urlSessionConfiguration: sessionConfig
        )
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    /// One AgentQuestion exactly as the backend `question-store.ts` rowToQuestion emits it.
    private func question(status: String = "open") -> [String: Any] {
        [
            "id": "q-contract-001",
            "projectId": "f1e8f895",
            "agentId": "swann",
            "body": "Contract question",
            "context": "ctx",
            "category": "decision",
            "suggestedOptions": ["A", "B"],
            "urgency": "high",
            "status": status,
            "createdAt": "2026-06-03 10:00:00",
            "updatedAt": "2026-06-03 10:00:00"
        ]
    }

    // MARK: - GET /api/questions → data = { questions, total }

    func testListContract_decodesRealEnvelope() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["questions": [question()], "total": 1],
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        let result = try await client.listQuestions()
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].id, "q-contract-001")
    }

    func testListContract_oldBareArrayShapeThrows() async {
        // The pre-fix bug: backend returns {questions,total}, iOS decoded a bare array.
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [question()],   // WRONG legacy shape
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        do {
            _ = try await client.listQuestions()
            XCTFail("Bare-array data should NOT decode as { questions, total } — contract regressed")
        } catch { /* expected: decode throws */ }
    }

    // MARK: - POST /:id/answer → data = { question }

    func testAnswerContract_decodesRealEnvelope() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["question": question(status: "answered")],
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        try await client.answerQuestion(questionId: "q-contract-001", chosenOption: "A")
    }

    func testAnswerContract_oldSuccessShapeThrows() async {
        // The pre-fix bug: backend returns {question}, iOS decoded {success:Bool}.
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],   // WRONG legacy shape
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        do {
            try await client.answerQuestion(questionId: "q-contract-001", chosenOption: "A")
            XCTFail("{ success } data should NOT decode as { question } — contract regressed")
        } catch { /* expected: decode throws */ }
    }

    // MARK: - POST /:id/dismiss → data = { question }

    func testDismissContract_decodesRealEnvelope() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["question": question(status: "dismissed")],
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        try await client.dismissQuestion(questionId: "q-contract-001")
    }

    func testDismissContract_oldSuccessShapeThrows() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],   // WRONG legacy shape
            "timestamp": "2026-06-03T10:00:00.000Z"
        ])
        do {
            try await client.dismissQuestion(questionId: "q-contract-001")
            XCTFail("{ success } data should NOT decode as { question } — contract regressed")
        } catch { /* expected: decode throws */ }
    }
}
