import XCTest
@testable import AdjutantKit

/// Tests for the conversations API client (adj-164.3.1 / T010).
///
/// Response shapes are taken from the merged backend contract:
///   - `GET /api/conversations`            → `backend/src/routes/conversations.ts`
///     returns `{ conversations: Conversation[], total }` inside the success
///     envelope, where each Conversation is the camelCase `rowToConversation`
///     shape: `{ id, kind, title, archived, createdAt, updatedAt }`.
///   - `GET /api/conversations/:id/messages` → `{ items: Message[], total, hasMore }`
///     where each Message carries `conversationId` (camelCase, from
///     `message-store.ts` `rowToMessage`).
///
/// These are NOT assumed TS-type shapes — they are the literal JSON the merged
/// routes emit (Constitution Rule 1).
final class APIClientConversationsTests: XCTestCase {
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

    // MARK: - getConversations

    func testGetConversationsDecodesRealShape() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "conversations": [
                    [
                        "id": "dm_abc123",
                        "kind": "dm",
                        "title": NSNull(),
                        "archived": false,
                        "createdAt": "2026-05-29 12:00:00",
                        "updatedAt": "2026-05-29 12:00:00"
                    ],
                    [
                        "id": "chan-1",
                        "kind": "channel",
                        "title": "ops",
                        "archived": false,
                        "createdAt": "2026-05-29 12:01:00",
                        "updatedAt": "2026-05-29 12:01:00"
                    ]
                ],
                "total": 2
            ],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let response = try await client.getConversations()

        XCTAssertEqual(response.total, 2)
        XCTAssertEqual(response.conversations.count, 2)
        let dm = response.conversations[0]
        XCTAssertEqual(dm.id, "dm_abc123")
        XCTAssertEqual(dm.kind, .dm)
        XCTAssertNil(dm.title)
        XCTAssertFalse(dm.archived)
        let channel = response.conversations[1]
        XCTAssertEqual(channel.kind, .channel)
        XCTAssertEqual(channel.title, "ops")
    }

    func testGetConversationsPassesMemberIdQueryParam() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["conversations": [], "total": 0],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        _ = try await client.getConversations(memberId: "raynor")

        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        XCTAssertTrue(components.path.hasSuffix("/conversations"))
        let memberParam = components.queryItems?.first(where: { $0.name == "memberId" })
        XCTAssertEqual(memberParam?.value, "raynor")
    }

    func testGetConversationsEmptyList() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["conversations": [], "total": 0],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let response = try await client.getConversations()
        XCTAssertEqual(response.total, 0)
        XCTAssertTrue(response.conversations.isEmpty)
    }

    func testGetConversationsThrowsOnServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "SERVER_ERROR", message: "boom"
        )

        do {
            _ = try await client.getConversations()
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - getConversationMessages

    func testGetConversationMessagesDecodesConversationId() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "items": [
                    [
                        "id": "m1",
                        "sessionId": NSNull(),
                        "agentId": "raynor",
                        "recipient": "user",
                        "role": "agent",
                        "body": "hello",
                        "metadata": NSNull(),
                        "deliveryStatus": "delivered",
                        "eventType": NSNull(),
                        "threadId": NSNull(),
                        "conversationId": "dm_abc123",
                        "createdAt": "2026-05-29 12:00:00",
                        "updatedAt": "2026-05-29 12:00:00"
                    ]
                ],
                "total": 1,
                "hasMore": false
            ],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let response = try await client.getConversationMessages(conversationId: "dm_abc123")

        XCTAssertEqual(response.items.count, 1)
        XCTAssertEqual(response.items[0].conversationId, "dm_abc123")
        XCTAssertEqual(response.items[0].body, "hello")
        XCTAssertFalse(response.hasMore)
    }

    func testGetConversationMessagesBuildsScopedPathAndPagination() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["items": [], "total": 0, "hasMore": false],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        _ = try await client.getConversationMessages(
            conversationId: "dm_abc123",
            before: "2026-05-29 11:00:00",
            beforeId: "m0",
            limit: 25
        )

        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        XCTAssertTrue(components.path.hasSuffix("/conversations/dm_abc123/messages"))
        let qi = components.queryItems ?? []
        XCTAssertEqual(qi.first(where: { $0.name == "before" })?.value, "2026-05-29 11:00:00")
        XCTAssertEqual(qi.first(where: { $0.name == "beforeId" })?.value, "m0")
        XCTAssertEqual(qi.first(where: { $0.name == "limit" })?.value, "25")
    }

    func testGetConversationMessagesPercentEncodesConversationId() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["items": [], "total": 0, "hasMore": false],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        _ = try await client.getConversationMessages(conversationId: "weird id/with slash")

        let path = capturedURL!.absoluteString
        XCTAssertFalse(path.contains("weird id/with slash"))
        XCTAssertTrue(path.contains("/messages"))
    }

    // MARK: - PersistentMessage conversationId

    func testPersistentMessageDecodesConversationIdField() throws {
        let json = """
        {
          "id": "m1",
          "agentId": "raynor",
          "recipient": "user",
          "role": "agent",
          "body": "hi",
          "deliveryStatus": "delivered",
          "conversationId": "dm_abc123",
          "createdAt": "2026-05-29 12:00:00",
          "updatedAt": "2026-05-29 12:00:00"
        }
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(PersistentMessage.self, from: json)
        XCTAssertEqual(msg.conversationId, "dm_abc123")
    }

    func testPersistentMessageConversationIdNilWhenAbsent() throws {
        let json = """
        {
          "id": "m1",
          "agentId": "raynor",
          "role": "agent",
          "body": "hi",
          "deliveryStatus": "delivered",
          "createdAt": "2026-05-29 12:00:00",
          "updatedAt": "2026-05-29 12:00:00"
        }
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(PersistentMessage.self, from: json)
        XCTAssertNil(msg.conversationId)
    }
}
