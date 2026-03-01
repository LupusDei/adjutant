import XCTest
@testable import AdjutantKit

final class APIClientTests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        // Configure URLSession with mock protocol
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]

        // Create client with custom configuration
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none // Disable retries for tests
        )

        client = APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    // MARK: - Model Decoding Tests

    func testCrewMemberDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                [
                    "id": "agent-abc",
                    "name": "agent-abc",
                    "type": "agent",
                    "status": "working",
                    "currentTask": "Implementing feature",
                    "unreadMail": 2,
                    "firstSubject": "Task update",
                    "branch": "feature-xyz"
                ]
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let agents = try await client.getAgents()

        XCTAssertEqual(agents.count, 1)
        let agent = agents[0]
        XCTAssertEqual(agent.id, "agent-abc")
        XCTAssertEqual(agent.type, .agent)
        XCTAssertEqual(agent.status, .working)
        XCTAssertEqual(agent.branch, "feature-xyz")
    }

    // MARK: - Bead Source Endpoint Tests

    func testGetBeadSourcesDecoding() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "sources": [
                    [
                        "name": "my-project",
                        "path": "/home/user/my-project",
                        "hasBeads": true
                    ],
                    [
                        "name": "another-app",
                        "path": "/home/user/another-app",
                        "hasBeads": true
                    ],
                    [
                        "name": "empty-dir",
                        "path": "/home/user/empty-dir",
                        "hasBeads": false
                    ]
                ],
                "mode": "swarm"
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let response = try await client.getBeadSources()

        XCTAssertEqual(response.sources.count, 3)
        XCTAssertEqual(response.mode, "swarm")
        XCTAssertEqual(response.sources[0].name, "my-project")
        XCTAssertEqual(response.sources[0].path, "/home/user/my-project")
        XCTAssertTrue(response.sources[0].hasBeads)
        XCTAssertEqual(response.sources[1].name, "another-app")
        XCTAssertTrue(response.sources[1].hasBeads)
        XCTAssertEqual(response.sources[2].name, "empty-dir")
        XCTAssertFalse(response.sources[2].hasBeads)
    }

    func testGetBeadSourcesEmptyResponse() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "sources": [],
                "mode": "swarm"
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let response = try await client.getBeadSources()

        XCTAssertTrue(response.sources.isEmpty)
        XCTAssertEqual(response.mode, "swarm")
    }

    func testGetBeadSourcesSwarmMode() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "sources": [
                    [
                        "name": "shared-workspace",
                        "path": "/workspace/shared",
                        "hasBeads": true
                    ]
                ],
                "mode": "swarm"
            ],
            "timestamp": "2024-01-15T10:30:00.000Z"
        ])

        let response = try await client.getBeadSources()

        XCTAssertEqual(response.mode, "swarm")
        XCTAssertEqual(response.sources.count, 1)
        XCTAssertEqual(response.sources[0].name, "shared-workspace")
    }

    func testGetBeadSourcesRequestPath() async throws {
        var capturedRequest: URLRequest?

        MockURLProtocol.mockHandler = { request in
            capturedRequest = request
            let envelope: [String: Any] = [
                "success": true,
                "data": ["sources": [], "mode": "swarm"],
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

        _ = try await client.getBeadSources()

        XCTAssertNotNil(capturedRequest)
        XCTAssertEqual(capturedRequest!.httpMethod, "GET")
        XCTAssertTrue(capturedRequest!.url!.path.contains("/beads/sources"),
            "Request should hit /beads/sources endpoint")
    }

    func testGetBeadSourcesServerError() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500,
            code: "INTERNAL_ERROR",
            message: "Failed to scan directories"
        )

        do {
            _ = try await client.getBeadSources()
            XCTFail("Expected error to be thrown")
        } catch let error as APIClientError {
            guard case .serverError(let apiError) = error else {
                XCTFail("Expected serverError, got \(error)")
                return
            }
            XCTAssertEqual(apiError.code, "INTERNAL_ERROR")
        }
    }

    // MARK: - Bead Decoding Tests

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
                    "assignee": "adjutant/agent-abc",
                    "rig": "adjutant",
                    "source": "adjutant",
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

        _ = try await client.getBeads(status: .inProgress, limit: 100)

        XCTAssertNotNil(capturedRequest)
        let urlString = capturedRequest!.url!.absoluteString
        XCTAssertTrue(urlString.contains("status=in_progress"))
        XCTAssertTrue(urlString.contains("limit=100"))
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
        XCTAssertEqual(config.baseURL.absoluteString, "http://localhost:4201/api")
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
