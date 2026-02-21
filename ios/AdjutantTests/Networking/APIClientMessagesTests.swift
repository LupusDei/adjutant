import XCTest
import AdjutantKit

final class APIClientMessagesTests: XCTestCase {
    private var apiClient: APIClient!

    override func setUp() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        apiClient = APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }

    override func tearDown() async throws {
        apiClient = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - getMessages

    func testGetMessagesReturnsItems() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        MockURLProtocol.mockHandler = { request in
            XCTAssertTrue(request.url!.path.hasSuffix("/messages"))
            XCTAssertEqual(request.httpMethod, "GET")

            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "items": [
                        [
                            "id": "msg-1",
                            "sessionId": NSNull(),
                            "agentId": "coder",
                            "recipient": "user",
                            "role": "agent",
                            "body": "Hello from coder",
                            "metadata": NSNull(),
                            "deliveryStatus": "delivered",
                            "eventType": NSNull(),
                            "threadId": NSNull(),
                            "createdAt": now,
                            "updatedAt": now
                        ]
                    ],
                    "total": 1,
                    "hasMore": false
                ],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let result = try await apiClient.getMessages()
        XCTAssertEqual(result.items.count, 1)
        XCTAssertEqual(result.items.first?.agentId, "coder")
        XCTAssertEqual(result.items.first?.body, "Hello from coder")
        XCTAssertEqual(result.items.first?.role, .agent)
        XCTAssertFalse(result.hasMore)
    }

    func testGetMessagesWithAgentIdFilter() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedURL: URL?

        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            let envelope: [String: Any] = [
                "success": true,
                "data": ["items": [] as [[String: Any]], "total": 0, "hasMore": false],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await apiClient.getMessages(agentId: "researcher")

        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        let agentParam = components.queryItems?.first(where: { $0.name == "agentId" })
        XCTAssertEqual(agentParam?.value, "researcher")
    }

    func testGetMessagesWithPagination() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedURL: URL?

        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            let envelope: [String: Any] = [
                "success": true,
                "data": ["items": [] as [[String: Any]], "total": 0, "hasMore": false],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await apiClient.getMessages(before: now, limit: 50)

        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        let beforeParam = components.queryItems?.first(where: { $0.name == "before" })
        let limitParam = components.queryItems?.first(where: { $0.name == "limit" })
        XCTAssertEqual(beforeParam?.value, now)
        XCTAssertEqual(limitParam?.value, "50")
    }

    // MARK: - sendChatMessage

    func testSendChatMessagePostsCorrectBody() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedBody: [String: Any]?

        MockURLProtocol.mockHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url!.path.hasSuffix("/messages"))

            if let body = request.httpBody {
                capturedBody = try JSONSerialization.jsonObject(with: body) as? [String: Any]
            }

            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg-new", "timestamp": now],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let result = try await apiClient.sendChatMessage(agentId: "coder", body: "Build the feature")

        XCTAssertEqual(result.messageId, "msg-new")
        XCTAssertEqual(capturedBody?["to"] as? String, "coder")
        XCTAssertEqual(capturedBody?["body"] as? String, "Build the feature")
    }

    func testSendChatMessageWithThreadId() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedBody: [String: Any]?

        MockURLProtocol.mockHandler = { request in
            if let body = request.httpBody {
                capturedBody = try JSONSerialization.jsonObject(with: body) as? [String: Any]
            }
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg-2", "timestamp": now],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await apiClient.sendChatMessage(agentId: "coder", body: "Reply", threadId: "thread-1")

        XCTAssertEqual(capturedBody?["threadId"] as? String, "thread-1")
    }

    // MARK: - markMessageRead

    func testMarkMessageReadUsesCorrectPath() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedURL: URL?

        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            XCTAssertEqual(request.httpMethod, "PATCH")

            let envelope: [String: Any] = [
                "success": true,
                "data": ["read": true],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await apiClient.markMessageRead(messageId: "msg-42")

        XCTAssertTrue(capturedURL!.path.contains("/messages/msg-42/read"))
    }

    // MARK: - markAllMessagesRead

    func testMarkAllMessagesReadSendsAgentId() async throws {
        let now = ISO8601DateFormatter().string(from: Date())
        var capturedURL: URL?

        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            XCTAssertEqual(request.httpMethod, "PATCH")

            let envelope: [String: Any] = [
                "success": true,
                "data": ["read": true],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await apiClient.markAllMessagesRead(agentId: "researcher")

        XCTAssertTrue(capturedURL!.path.contains("/messages/read-all"))
        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        let agentParam = components.queryItems?.first(where: { $0.name == "agentId" })
        XCTAssertEqual(agentParam?.value, "researcher")
    }

    // MARK: - getUnreadCounts

    func testGetUnreadCountsReturnsAgentCounts() async throws {
        let now = ISO8601DateFormatter().string(from: Date())

        MockURLProtocol.mockHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertTrue(request.url!.path.contains("/messages/unread"))

            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "counts": [
                        ["agentId": "coder", "count": 3],
                        ["agentId": "researcher", "count": 1]
                    ]
                ],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let result = try await apiClient.getUnreadCounts()

        XCTAssertEqual(result.counts.count, 2)
        XCTAssertEqual(result.counts.first?.agentId, "coder")
        XCTAssertEqual(result.counts.first?.count, 3)
    }

    // MARK: - Error handling

    func testGetMessagesHandlesServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500,
            code: "INTERNAL_ERROR",
            message: "Database error"
        )

        do {
            _ = try await apiClient.getMessages()
            XCTFail("Expected error")
        } catch {
            // Expected
        }
    }
}

// MARK: - PersistentMessage Model Tests

final class PersistentMessageTests: XCTestCase {
    func testDecodingFromJSON() throws {
        let json = """
        {
            "id": "msg-1",
            "sessionId": null,
            "agentId": "coder",
            "recipient": "user",
            "role": "agent",
            "body": "Hello",
            "metadata": null,
            "deliveryStatus": "delivered",
            "eventType": null,
            "threadId": null,
            "createdAt": "2026-02-21T12:00:00.000Z",
            "updatedAt": "2026-02-21T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(PersistentMessage.self, from: json)
        XCTAssertEqual(message.id, "msg-1")
        XCTAssertEqual(message.agentId, "coder")
        XCTAssertEqual(message.role, .agent)
        XCTAssertEqual(message.deliveryStatus, .delivered)
        XCTAssertNil(message.sessionId)
        XCTAssertNil(message.metadata)
    }

    func testDecodingWithMetadata() throws {
        let json = """
        {
            "id": "msg-2",
            "sessionId": "sess-1",
            "agentId": "user",
            "recipient": "coder",
            "role": "user",
            "body": "Build it",
            "metadata": {"tool": "claude", "priority": 1},
            "deliveryStatus": "pending",
            "eventType": "chat_message",
            "threadId": "thread-1",
            "createdAt": "2026-02-21T12:00:00.000Z",
            "updatedAt": "2026-02-21T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(PersistentMessage.self, from: json)
        XCTAssertEqual(message.sessionId, "sess-1")
        XCTAssertEqual(message.role, .user)
        XCTAssertEqual(message.deliveryStatus, .pending)
        XCTAssertEqual(message.eventType, "chat_message")
        XCTAssertEqual(message.threadId, "thread-1")
        XCTAssertNotNil(message.metadata)
        XCTAssertEqual(message.metadata?["tool"], .string("claude"))
        XCTAssertEqual(message.metadata?["priority"], .int(1))
    }

    func testEncodingRoundTrip() throws {
        let original = PersistentMessage(
            id: "msg-rt",
            agentId: "coder",
            recipient: "user",
            role: .agent,
            body: "Round trip test",
            deliveryStatus: .sent,
            createdAt: "2026-02-21T12:00:00.000Z",
            updatedAt: "2026-02-21T12:00:00.000Z"
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(PersistentMessage.self, from: data)

        XCTAssertEqual(original, decoded)
    }

    func testDateParsing() {
        let message = PersistentMessage(
            id: "msg-date",
            agentId: "coder",
            role: .agent,
            body: "test",
            createdAt: "2026-02-21T12:00:00.000Z",
            updatedAt: "2026-02-21T12:00:00.000Z"
        )

        XCTAssertNotNil(message.date)
    }

    func testSenderName() {
        let agentMsg = PersistentMessage(
            id: "1", agentId: "coder", role: .agent, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        XCTAssertEqual(agentMsg.senderName, "coder")

        let userMsg = PersistentMessage(
            id: "2", agentId: "user", role: .user, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        XCTAssertEqual(userMsg.senderName, "You")
    }

    func testIsFromUser() {
        let userMsg = PersistentMessage(
            id: "1", agentId: "user", role: .user, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        XCTAssertTrue(userMsg.isFromUser)

        let agentMsg = PersistentMessage(
            id: "2", agentId: "coder", role: .agent, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        XCTAssertFalse(agentMsg.isFromUser)
    }

    func testHashable() {
        let msg1 = PersistentMessage(
            id: "msg-1", agentId: "coder", role: .agent, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        let msg2 = PersistentMessage(
            id: "msg-1", agentId: "coder", role: .agent, body: "hi",
            createdAt: "2026-02-21T12:00:00Z", updatedAt: "2026-02-21T12:00:00Z"
        )
        XCTAssertEqual(msg1, msg2)
        XCTAssertEqual(msg1.hashValue, msg2.hashValue)
    }
}

// MARK: - UnreadCount Tests

final class UnreadCountTests: XCTestCase {
    func testDecoding() throws {
        let json = """
        {"agentId": "coder", "count": 5}
        """.data(using: .utf8)!

        let count = try JSONDecoder().decode(UnreadCount.self, from: json)
        XCTAssertEqual(count.agentId, "coder")
        XCTAssertEqual(count.count, 5)
    }
}

// MARK: - AnyCodableValue Tests

final class AnyCodableValueTests: XCTestCase {
    func testDecodeString() throws {
        let json = "\"hello\"".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodableValue.self, from: json)
        XCTAssertEqual(val, .string("hello"))
    }

    func testDecodeInt() throws {
        let json = "42".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodableValue.self, from: json)
        XCTAssertEqual(val, .int(42))
    }

    func testDecodeBool() throws {
        let json = "true".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodableValue.self, from: json)
        XCTAssertEqual(val, .bool(true))
    }

    func testDecodeNull() throws {
        let json = "null".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodableValue.self, from: json)
        XCTAssertEqual(val, .null)
    }

    func testEncodeRoundTrip() throws {
        let values: [String: AnyCodableValue] = [
            "name": .string("test"),
            "count": .int(3),
            "active": .bool(true)
        ]
        let data = try JSONEncoder().encode(values)
        let decoded = try JSONDecoder().decode([String: AnyCodableValue].self, from: data)
        XCTAssertEqual(decoded, values)
    }
}
