import XCTest
@testable import AdjutantKit

final class APIClientTests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        // Configure URLSession with mock protocol
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]

        // Create client with custom configuration
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none // Disable retries for tests
        )

        client = APIClient(configuration: clientConfig)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    // MARK: - Response Envelope Tests

    func testSuccessfulResponseDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "powerState": "running",
                "town": ["name": "gastown", "root": "/Users/test"],
                "operator": ["name": "test", "email": "test@test.com", "unreadMail": 0],
                "infrastructure": [
                    "mayor": ["name": "mayor", "running": true, "unreadMail": 0],
                    "deacon": ["name": "deacon", "running": true, "unreadMail": 0],
                    "daemon": ["name": "daemon", "running": true, "unreadMail": 0]
                ],
                "rigs": [],
                "fetchedAt": "2024-01-15T10:30:00.000Z"
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let status = try await client.getStatus()

        XCTAssertEqual(status.powerState, .running)
        XCTAssertEqual(status.town.name, "gastown")
        XCTAssertEqual(status.operator.name, "test")
    }

    func testErrorResponseDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Resource not found"
        )

        do {
            _ = try await client.getStatus()
            XCTFail("Expected error to be thrown")
        } catch let error as APIClientError {
            guard case .serverError(let apiError) = error else {
                XCTFail("Expected serverError, got \(error)")
                return
            }
            XCTAssertEqual(apiError.code, "NOT_FOUND")
            XCTAssertEqual(apiError.message, "Resource not found")
        }
    }

    // MARK: - Error Handling Tests

    func testNetworkError() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockNetworkError(.notConnectedToInternet)

        do {
            _ = try await client.getStatus()
            XCTFail("Expected error to be thrown")
        } catch let error as APIClientError {
            guard case .networkError = error else {
                XCTFail("Expected networkError, got \(error)")
                return
            }
            XCTAssertTrue(error.isRetryable)
        }
    }

    func testTimeoutError() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockNetworkError(.timedOut)

        do {
            _ = try await client.getStatus()
            XCTFail("Expected error to be thrown")
        } catch let error as APIClientError {
            guard case .timeout = error else {
                XCTFail("Expected timeout, got \(error)")
                return
            }
            XCTAssertTrue(error.isRetryable)
        }
    }

    func testRateLimitError() async throws {
        MockURLProtocol.mockHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 429,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "application/json",
                    "Retry-After": "60"
                ]
            )!
            return (response, Data())
        }

        do {
            _ = try await client.getStatus()
            XCTFail("Expected error to be thrown")
        } catch let error as APIClientError {
            guard case .rateLimited(let retryAfter) = error else {
                XCTFail("Expected rateLimited, got \(error)")
                return
            }
            XCTAssertEqual(retryAfter, 60)
            XCTAssertTrue(error.isRetryable)
        }
    }

    // MARK: - Model Decoding Tests

    func testMessageDecoding() async throws {
        let messageJSON: [String: Any] = [
            "id": "gb-53tj",
            "from": "mayor/",
            "to": "overseer",
            "subject": "Test message",
            "body": "Test body content",
            "timestamp": "2024-01-15T10:00:00.000Z",
            "read": false,
            "priority": 2,
            "type": "notification",
            "threadId": "thread-abc123",
            "pinned": false,
            "isInfrastructure": false
        ]

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": messageJSON,
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let message = try await client.getMessage(id: "gb-53tj")

        XCTAssertEqual(message.id, "gb-53tj")
        XCTAssertEqual(message.from, "mayor/")
        XCTAssertEqual(message.subject, "Test message")
        XCTAssertEqual(message.priority, .normal)
        XCTAssertEqual(message.type, .notification)
        XCTAssertEqual(message.senderName, "mayor")
    }

    func testCrewMemberDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                [
                    "id": "greenplace/Toast",
                    "name": "Toast",
                    "type": "polecat",
                    "rig": "greenplace",
                    "status": "working",
                    "currentTask": "Implementing feature",
                    "unreadMail": 2,
                    "firstSubject": "Task update",
                    "branch": "polecat/feature-xyz"
                ]
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let agents = try await client.getAgents()

        XCTAssertEqual(agents.count, 1)
        let agent = agents[0]
        XCTAssertEqual(agent.id, "greenplace/Toast")
        XCTAssertEqual(agent.type, .polecat)
        XCTAssertEqual(agent.status, .working)
        XCTAssertEqual(agent.branch, "polecat/feature-xyz")
    }

    func testConvoyDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                [
                    "id": "convoy-001",
                    "title": "Feature Implementation",
                    "status": "in_progress",
                    "rig": "greenplace",
                    "progress": [
                        "completed": 3,
                        "total": 5
                    ],
                    "trackedIssues": [
                        [
                            "id": "gb-issue1",
                            "title": "Task 1",
                            "status": "closed",
                            "priority": 1
                        ]
                    ]
                ]
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let convoys = try await client.getConvoys()

        XCTAssertEqual(convoys.count, 1)
        let convoy = convoys[0]
        XCTAssertEqual(convoy.id, "convoy-001")
        XCTAssertEqual(convoy.progress.completed, 3)
        XCTAssertEqual(convoy.progress.total, 5)
        XCTAssertEqual(convoy.progress.percentage, 0.6)
        XCTAssertFalse(convoy.isComplete)
    }

    func testBeadDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                [
                    "id": "gb-53tj",
                    "title": "Implement feature",
                    "status": "in_progress",
                    "priority": 1,
                    "type": "feature",
                    "assignee": "greenplace/polecat-abc",
                    "rig": "greenplace",
                    "source": "greenplace",
                    "labels": ["frontend", "high-priority"],
                    "createdAt": "2024-01-10T08:00:00.000Z",
                    "updatedAt": "2024-01-15T09:30:00.000Z"
                ]
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let beads = try await client.getBeads()

        XCTAssertEqual(beads.count, 1)
        let bead = beads[0]
        XCTAssertEqual(bead.id, "gb-53tj")
        XCTAssertEqual(bead.priorityLevel, .high)
        XCTAssertEqual(bead.labels, ["frontend", "high-priority"])
    }

    // MARK: - Request Building Tests

    func testQueryParametersEncoding() async throws {
        var capturedRequest: URLRequest?

        MockURLProtocol.mockHandler = { request in
            capturedRequest = request
            let envelope: [String: Any] = [
                "success": true,
                "data": [],
                "timestamp": "2024-01-15T10:30:00.000Z"
            ]
            let data = try! JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await client.getBeads(rig: "greenplace", status: .inProgress, limit: 100)

        XCTAssertNotNil(capturedRequest)
        let urlString = capturedRequest!.url!.absoluteString
        XCTAssertTrue(urlString.contains("rig=greenplace"))
        XCTAssertTrue(urlString.contains("status=in_progress"))
        XCTAssertTrue(urlString.contains("limit=100"))
    }

    func testPostRequestBodyEncoding() async throws {
        var capturedRequest: URLRequest?

        MockURLProtocol.mockHandler = { request in
            capturedRequest = request
            let envelope: [String: Any] = [
                "success": true,
                "data": ["sent": true],
                "timestamp": "2024-01-15T10:30:00.000Z"
            ]
            let data = try! JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let sendRequest = SendMessageRequest(
            to: "mayor/",
            subject: "Test",
            body: "Test message",
            priority: .high
        )
        _ = try await client.sendMail(sendRequest)

        XCTAssertNotNil(capturedRequest)
        XCTAssertEqual(capturedRequest!.httpMethod, "POST")
        XCTAssertEqual(capturedRequest!.value(forHTTPHeaderField: "Content-Type"), "application/json")

        let bodyData = capturedRequest!.httpBody!
        let bodyJSON = try JSONSerialization.jsonObject(with: bodyData) as! [String: Any]
        XCTAssertEqual(bodyJSON["to"] as? String, "mayor/")
        XCTAssertEqual(bodyJSON["subject"] as? String, "Test")
        XCTAssertEqual(bodyJSON["priority"] as? Int, 1)
    }
}

// MARK: - Retry Policy Tests

final class RetryPolicyTests: XCTestCase {
    func testDelayCalculation() {
        let policy = RetryPolicy(
            maxAttempts: 3,
            baseDelay: 1.0,
            maxDelay: 10.0,
            multiplier: 2.0,
            jitter: 0.0 // No jitter for predictable testing
        )

        // First attempt: 1s
        XCTAssertEqual(policy.delay(forAttempt: 0), 1.0)

        // Second attempt: 2s
        XCTAssertEqual(policy.delay(forAttempt: 1), 2.0)

        // Third attempt: 4s
        XCTAssertEqual(policy.delay(forAttempt: 2), 4.0)

        // Fourth attempt: 8s
        XCTAssertEqual(policy.delay(forAttempt: 3), 8.0)

        // Fifth attempt: clamped to 10s
        XCTAssertEqual(policy.delay(forAttempt: 4), 10.0)
    }

    func testJitterAddsVariance() {
        let policy = RetryPolicy(
            maxAttempts: 3,
            baseDelay: 1.0,
            maxDelay: 10.0,
            multiplier: 2.0,
            jitter: 0.5
        )

        var delays: Set<Double> = []
        for _ in 0..<10 {
            delays.insert(policy.delay(forAttempt: 0))
        }

        // With 50% jitter on 1s base, delays should vary between 0.5s and 1.5s
        for delay in delays {
            XCTAssertTrue(delay >= 0.5 && delay <= 1.5, "Delay \(delay) out of expected range")
        }

        // Should have some variance (not all the same)
        XCTAssertTrue(delays.count > 1, "Expected variance in delays with jitter")
    }

    func testDefaultPolicy() {
        let policy = RetryPolicy.default
        XCTAssertEqual(policy.maxAttempts, 3)
        XCTAssertEqual(policy.baseDelay, 1.0)
        XCTAssertEqual(policy.maxDelay, 30.0)
        XCTAssertEqual(policy.multiplier, 2.0)
        XCTAssertEqual(policy.jitter, 0.1)
    }

    func testAggressivePolicy() {
        let policy = RetryPolicy.aggressive
        XCTAssertEqual(policy.maxAttempts, 5)
        XCTAssertEqual(policy.baseDelay, 0.5)
        XCTAssertEqual(policy.maxDelay, 60.0)
    }

    func testNonePolicy() {
        let policy = RetryPolicy.none
        XCTAssertEqual(policy.maxAttempts, 0)
    }
}

// MARK: - Error Tests

final class APIErrorTests: XCTestCase {
    func testIsRetryable() {
        XCTAssertTrue(APIClientError.networkError("test").isRetryable)
        XCTAssertTrue(APIClientError.timeout.isRetryable)
        XCTAssertTrue(APIClientError.rateLimited(retryAfter: nil).isRetryable)
        XCTAssertTrue(APIClientError.httpError(statusCode: 500, message: "").isRetryable)
        XCTAssertTrue(APIClientError.httpError(statusCode: 502, message: "").isRetryable)
        XCTAssertTrue(APIClientError.httpError(statusCode: 429, message: "").isRetryable)

        XCTAssertFalse(APIClientError.cancelled.isRetryable)
        XCTAssertFalse(APIClientError.decodingError("test").isRetryable)
        XCTAssertFalse(APIClientError.invalidRequest("test").isRetryable)
        XCTAssertFalse(APIClientError.httpError(statusCode: 400, message: "").isRetryable)
        XCTAssertFalse(APIClientError.httpError(statusCode: 401, message: "").isRetryable)
        XCTAssertFalse(APIClientError.httpError(statusCode: 404, message: "").isRetryable)
    }

    func testServerErrorRetryable() {
        let internalError = ApiError(code: "INTERNAL_ERROR", message: "Server error")
        let timeoutError = ApiError(code: "TIMEOUT", message: "Timed out")
        let notFoundError = ApiError(code: "NOT_FOUND", message: "Not found")

        XCTAssertTrue(APIClientError.serverError(internalError).isRetryable)
        XCTAssertTrue(APIClientError.serverError(timeoutError).isRetryable)
        XCTAssertFalse(APIClientError.serverError(notFoundError).isRetryable)
    }

    func testErrorDescriptions() {
        let error1 = APIClientError.networkError("No connection")
        XCTAssertTrue(error1.localizedDescription.contains("No connection"))

        let error2 = APIClientError.rateLimited(retryAfter: 60)
        XCTAssertTrue(error2.localizedDescription.contains("60"))

        let error3 = APIClientError.httpError(statusCode: 404, message: "Not Found")
        XCTAssertTrue(error3.localizedDescription.contains("404"))
    }

    func testErrorEquality() {
        let error1 = APIClientError.timeout
        let error2 = APIClientError.timeout
        XCTAssertEqual(error1, error2)

        let error3 = APIClientError.networkError("a")
        let error4 = APIClientError.networkError("a")
        XCTAssertEqual(error3, error4)

        let error5 = APIClientError.networkError("a")
        let error6 = APIClientError.networkError("b")
        XCTAssertNotEqual(error5, error6)
    }
}

final class APIClientConfigurationTests: XCTestCase {
    func testDevelopmentConfiguration() {
        let config = APIClientConfiguration.development
        XCTAssertEqual(config.baseURL.absoluteString, "http://localhost:3001/api")
        XCTAssertEqual(config.defaultTimeout, 30.0)
        XCTAssertEqual(config.terminalTimeout, 10.0)
        XCTAssertEqual(config.voiceTimeout, 60.0)
    }

    func testCustomConfiguration() {
        let config = APIClientConfiguration(
            baseURL: URL(string: "https://example.com/api")!,
            defaultTimeout: 15.0,
            terminalTimeout: 5.0,
            voiceTimeout: 120.0,
            retryPolicy: .aggressive
        )

        XCTAssertEqual(config.baseURL.absoluteString, "https://example.com/api")
        XCTAssertEqual(config.defaultTimeout, 15.0)
        XCTAssertEqual(config.terminalTimeout, 5.0)
        XCTAssertEqual(config.voiceTimeout, 120.0)
        XCTAssertEqual(config.retryPolicy.maxAttempts, 5)
    }
}

final class ApiErrorStructTests: XCTestCase {
    func testApiErrorDecoding() throws {
        let json = """
        {
            "code": "NOT_FOUND",
            "message": "Resource not found",
            "details": "The requested message does not exist"
        }
        """

        let error = try JSONDecoder().decode(ApiError.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(error.code, "NOT_FOUND")
        XCTAssertEqual(error.message, "Resource not found")
        XCTAssertEqual(error.details, "The requested message does not exist")
    }

    func testApiErrorWithoutDetails() throws {
        let json = """
        {
            "code": "INTERNAL_ERROR",
            "message": "Server error"
        }
        """

        let error = try JSONDecoder().decode(ApiError.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(error.code, "INTERNAL_ERROR")
        XCTAssertEqual(error.message, "Server error")
        XCTAssertNil(error.details)
    }

    func testApiErrorEquality() {
        let error1 = ApiError(code: "TEST", message: "Test message")
        let error2 = ApiError(code: "TEST", message: "Test message")
        XCTAssertEqual(error1, error2)
    }
}
