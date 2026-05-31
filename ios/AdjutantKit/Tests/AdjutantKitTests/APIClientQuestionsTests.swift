import XCTest
@testable import AdjutantKit

/// Tests for the questions API client (adj-181.5.1 / T040a).
///
/// Response shapes are taken from the merged backend contract
/// (`backend/src/routes/questions.ts`), NOT assumed TS-type shapes
/// (Constitution Rule 1 / adj-067):
///
///   - `GET  /api/questions`              → `data` = `[AgentQuestion]`
///   - `POST /api/questions/:id/answer`   → `data` = `{ success: true }`
///   - `POST /api/questions/:id/dismiss`  → `data` = `{ success: true }`
///
/// AgentQuestion shape from backend `question-store.ts` rowToQuestion:
///   { id, projectId, agentId, body, context?, category?, suggestedOptions?,
///     urgency, status, answerBody?, chosenOption?, answeredBy?, beadId?,
///     conversationId?, createdAt, answeredAt?, updatedAt }
final class APIClientQuestionsTests: XCTestCase {
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

    // MARK: - AgentQuestion model decode

    func testAgentQuestionDecodesFullShape() throws {
        let json = """
        {
          "id": "q-001",
          "projectId": "proj-uuid-1234",
          "agentId": "raynor",
          "body": "Should I use SQLite or Postgres?",
          "context": "I'm building the store layer and need a persistence decision.",
          "category": "decision",
          "suggestedOptions": ["SQLite", "Postgres"],
          "urgency": "high",
          "status": "open",
          "answerBody": null,
          "chosenOption": null,
          "answeredBy": null,
          "beadId": "adj-181",
          "conversationId": "dm_abc123",
          "createdAt": "2026-05-31 10:00:00",
          "answeredAt": null,
          "updatedAt": "2026-05-31 10:00:00"
        }
        """.data(using: .utf8)!

        let q = try JSONDecoder().decode(AgentQuestion.self, from: json)
        XCTAssertEqual(q.id, "q-001")
        XCTAssertEqual(q.projectId, "proj-uuid-1234")
        XCTAssertEqual(q.agentId, "raynor")
        XCTAssertEqual(q.body, "Should I use SQLite or Postgres?")
        XCTAssertEqual(q.context, "I'm building the store layer and need a persistence decision.")
        XCTAssertEqual(q.category, .decision)
        XCTAssertEqual(q.suggestedOptions, ["SQLite", "Postgres"])
        XCTAssertEqual(q.urgency, .high)
        XCTAssertEqual(q.status, .open)
        XCTAssertNil(q.answerBody)
        XCTAssertNil(q.chosenOption)
        XCTAssertNil(q.answeredBy)
        XCTAssertEqual(q.beadId, "adj-181")
        XCTAssertEqual(q.conversationId, "dm_abc123")
        XCTAssertEqual(q.createdAt, "2026-05-31 10:00:00")
        XCTAssertNil(q.answeredAt)
    }

    func testAgentQuestionDecodesMinimalShape() throws {
        // Backend may omit all optional fields — must not throw
        let json = """
        {
          "id": "q-002",
          "projectId": "proj-uuid-1234",
          "agentId": "kerrigan",
          "body": "Access to secret?",
          "urgency": "blocking",
          "status": "open",
          "createdAt": "2026-05-31 09:00:00",
          "updatedAt": "2026-05-31 09:00:00"
        }
        """.data(using: .utf8)!

        let q = try JSONDecoder().decode(AgentQuestion.self, from: json)
        XCTAssertEqual(q.id, "q-002")
        XCTAssertEqual(q.urgency, .blocking)
        XCTAssertEqual(q.status, .open)
        XCTAssertNil(q.context)
        XCTAssertNil(q.category)
        XCTAssertNil(q.suggestedOptions)
        XCTAssertNil(q.beadId)
        XCTAssertNil(q.conversationId)
    }

    func testAgentQuestionDecodesAnsweredShape() throws {
        let json = """
        {
          "id": "q-003",
          "projectId": "proj-uuid-1234",
          "agentId": "raynor",
          "body": "Use A or B?",
          "urgency": "normal",
          "status": "answered",
          "answerBody": "Use A \u{2014} it's simpler.",
          "chosenOption": "A",
          "answeredBy": "user",
          "createdAt": "2026-05-31 08:00:00",
          "answeredAt": "2026-05-31 08:30:00",
          "updatedAt": "2026-05-31 08:30:00"
        }
        """.data(using: .utf8)!

        let q = try JSONDecoder().decode(AgentQuestion.self, from: json)
        XCTAssertEqual(q.status, .answered)
        XCTAssertEqual(q.answerBody, "Use A \u{2014} it's simpler.")
        XCTAssertEqual(q.chosenOption, "A")
        XCTAssertEqual(q.answeredBy, "user")
        XCTAssertEqual(q.answeredAt, "2026-05-31 08:30:00")
    }

    func testAgentQuestionDecodesDismissedShape() throws {
        let json = """
        {
          "id": "q-004",
          "projectId": "proj-uuid-1234",
          "agentId": "raynor",
          "body": "Old question",
          "urgency": "low",
          "status": "dismissed",
          "createdAt": "2026-05-30 08:00:00",
          "updatedAt": "2026-05-30 09:00:00"
        }
        """.data(using: .utf8)!

        let q = try JSONDecoder().decode(AgentQuestion.self, from: json)
        XCTAssertEqual(q.status, .dismissed)
    }

    func testAgentQuestionCategoryDecodes() throws {
        let categories: [(String, QuestionCategory)] = [
            ("decision", .decision),
            ("clarification", .clarification),
            ("approval", .approval),
            ("action_required", .actionRequired),
            ("other", .other)
        ]
        for (raw, expected) in categories {
            let json = """
            {
              "id": "q-x", "projectId": "p", "agentId": "a",
              "body": "b", "urgency": "normal", "status": "open",
              "category": "\(raw)",
              "createdAt": "2026-05-31 10:00:00", "updatedAt": "2026-05-31 10:00:00"
            }
            """.data(using: .utf8)!
            let q = try JSONDecoder().decode(AgentQuestion.self, from: json)
            XCTAssertEqual(q.category, expected, "category \(raw) did not decode correctly")
        }
    }

    // MARK: - listQuestions — request shape

    func testListQuestionsHitsCorrectPath() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": [],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.listQuestions()
        XCTAssertTrue(capturedURL!.path.hasSuffix("/questions"),
                      "Expected /questions path, got \(capturedURL!.path)")
        XCTAssertNil(capturedURL!.query, "No query params expected for default call")
    }

    func testListQuestionsWithStatusFilter() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true, "data": [],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.listQuestions(status: .open)
        let queryItems = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertTrue(queryItems?.contains(URLQueryItem(name: "status", value: "open")) == true)
    }

    func testListQuestionsWithAllFilters() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true, "data": [],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        _ = try await client.listQuestions(
            status: .open,
            projectId: "proj-uuid",
            category: .decision,
            agentId: "raynor",
            urgency: .high
        )

        let comps = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)
        let items = comps?.queryItems ?? []
        let dict = Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        XCTAssertEqual(dict["status"], "open")
        XCTAssertEqual(dict["projectId"], "proj-uuid")
        XCTAssertEqual(dict["category"], "decision")
        XCTAssertEqual(dict["agentId"], "raynor")
        XCTAssertEqual(dict["urgency"], "high")
    }

    // MARK: - listQuestions — response decode

    func testListQuestionsDecodesArray() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                [
                    "id": "q-001",
                    "projectId": "proj-uuid",
                    "agentId": "raynor",
                    "body": "Decision needed",
                    "urgency": "blocking",
                    "status": "open",
                    "createdAt": "2026-05-31 10:00:00",
                    "updatedAt": "2026-05-31 10:00:00"
                ],
                [
                    "id": "q-002",
                    "projectId": "proj-uuid",
                    "agentId": "kerrigan",
                    "body": "Clarify the spec",
                    "urgency": "normal",
                    "status": "open",
                    "createdAt": "2026-05-31 09:00:00",
                    "updatedAt": "2026-05-31 09:00:00"
                ]
            ],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        let questions = try await client.listQuestions()
        XCTAssertEqual(questions.count, 2)
        XCTAssertEqual(questions[0].id, "q-001")
        XCTAssertEqual(questions[0].urgency, .blocking)
        XCTAssertEqual(questions[1].id, "q-002")
    }

    func testListQuestionsDecodesEmpty() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [],
            "timestamp": "2026-05-31T10:00:00.000Z"
        ])

        let questions = try await client.listQuestions()
        XCTAssertTrue(questions.isEmpty)
    }

    func testListQuestionsThrowsOnServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "SERVER_ERROR", message: "internal error"
        )
        do {
            _ = try await client.listQuestions()
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - answerQuestion — request shape

    func testAnswerQuestionHitsCorrectPath() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.answerQuestion(questionId: "q-001", answerBody: "Yes, do it.")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/questions/q-001/answer"),
                      "Expected /questions/q-001/answer, got \(capturedURL!.path)")
    }

    func testAnswerQuestionWithAnswerBodyOnlySendsBody() async throws {
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.answerQuestion(questionId: "q-001", answerBody: "Use Postgres")

        let body = try XCTUnwrap(capturedBody)
        let obj = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(obj?["answerBody"] as? String, "Use Postgres")
        XCTAssertNil(obj?["chosenOption"])
    }

    func testAnswerQuestionWithChosenOptionOnlySendsOption() async throws {
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.answerQuestion(questionId: "q-001", chosenOption: "SQLite")

        let body = try XCTUnwrap(capturedBody)
        let obj = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(obj?["chosenOption"] as? String, "SQLite")
        XCTAssertNil(obj?["answerBody"])
    }

    func testAnswerQuestionWithBothFieldsSendsBoth() async throws {
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.answerQuestion(
            questionId: "q-001",
            answerBody: "Done \u{2014} key added.",
            chosenOption: "Completed"
        )

        let body = try XCTUnwrap(capturedBody)
        let obj = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(obj?["answerBody"] as? String, "Done \u{2014} key added.")
        XCTAssertEqual(obj?["chosenOption"] as? String, "Completed")
    }

    func testAnswerQuestionThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Question not found"
        )
        do {
            try await client.answerQuestion(questionId: "nonexistent", answerBody: "x")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - dismissQuestion — request shape

    func testDismissQuestionHitsCorrectPath() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.dismissQuestion(questionId: "q-001")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/questions/q-001/dismiss"),
                      "Expected /questions/q-001/dismiss, got \(capturedURL!.path)")
    }

    func testDismissQuestionSendsPostMethod() async throws {
        var capturedRequest: URLRequest?
        MockURLProtocol.mockHandler = { request in
            capturedRequest = request
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-31T10:00:00.000Z"
            ])(request)
        }

        try await client.dismissQuestion(questionId: "q-001")
        XCTAssertEqual(capturedRequest?.httpMethod, "POST")
    }

    func testDismissQuestionThrowsOnNotFound() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Question not found"
        )
        do {
            try await client.dismissQuestion(questionId: "nonexistent")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }
}
