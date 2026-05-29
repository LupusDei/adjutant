import XCTest
@testable import AdjutantKit

/// Tests for the channels API client (adj-164.6.1 / T024).
///
/// Response shapes are taken from the merged backend contract
/// (`backend/src/routes/channels.ts`), NOT assumed TS-type shapes
/// (Constitution Rule 1):
///
///   - `POST /api/channels`              → success-envelope `data` = a Conversation
///     (`{ id, kind, title, archived, createdAt, updatedAt }`), HTTP 201.
///   - `GET  /api/channels`              → `data` = `{ channels: ChannelSummary[], total }`
///     where each ChannelSummary is a Conversation plus a denormalized
///     `memberCount` integer.
///   - `POST /api/channels/:id/join`     → `data` = `{ success: true }`.
///   - `POST /api/channels/:id/leave`    → `data` = `{ success: true }`.
///   - `POST /api/channels/:id/messages` → `data` = `{ messageId, timestamp }`, HTTP 201.
final class APIClientChannelsTests: XCTestCase {
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

    // MARK: - Channel model decode

    func testChannelDecodesChannelSummaryShape() throws {
        let json = """
        {
          "id": "chan-ops",
          "kind": "channel",
          "title": "ops",
          "archived": false,
          "memberCount": 3,
          "createdAt": "2026-05-29 12:00:00",
          "updatedAt": "2026-05-29 12:05:00"
        }
        """.data(using: .utf8)!

        let channel = try JSONDecoder().decode(Channel.self, from: json)
        XCTAssertEqual(channel.id, "chan-ops")
        XCTAssertEqual(channel.title, "ops")
        XCTAssertEqual(channel.kind, .channel)
        XCTAssertFalse(channel.archived)
        XCTAssertEqual(channel.memberCount, 3)
    }

    func testChannelMemberCountDefaultsToZeroWhenAbsent() throws {
        // `POST /api/channels` returns a bare Conversation with no memberCount;
        // decoding it as a Channel must not throw — the count defaults to 0.
        let json = """
        {
          "id": "chan-new",
          "kind": "channel",
          "title": "new-room",
          "archived": false,
          "createdAt": "2026-05-29 12:00:00",
          "updatedAt": "2026-05-29 12:00:00"
        }
        """.data(using: .utf8)!

        let channel = try JSONDecoder().decode(Channel.self, from: json)
        XCTAssertEqual(channel.memberCount, 0)
    }

    // MARK: - listChannels

    func testListChannelsDecodesRealShape() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "channels": [
                    [
                        "id": "chan-alpha",
                        "kind": "channel",
                        "title": "alpha",
                        "archived": false,
                        "memberCount": 2,
                        "createdAt": "2026-05-29 12:00:00",
                        "updatedAt": "2026-05-29 12:00:00"
                    ]
                ],
                "total": 1
            ],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let response = try await client.listChannels()
        XCTAssertEqual(response.total, 1)
        XCTAssertEqual(response.channels.count, 1)
        XCTAssertEqual(response.channels[0].title, "alpha")
        XCTAssertEqual(response.channels[0].memberCount, 2)
    }

    func testListChannelsEmpty() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["channels": [], "total": 0],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let response = try await client.listChannels()
        XCTAssertEqual(response.total, 0)
        XCTAssertTrue(response.channels.isEmpty)
    }

    func testListChannelsHitsCorrectPath() async throws {
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["channels": [], "total": 0],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }
        _ = try await client.listChannels()
        XCTAssertTrue(capturedURL!.path.hasSuffix("/channels"))
    }

    // MARK: - createChannel

    func testCreateChannelDecodesConversation() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(
            statusCode: 201,
            json: [
                "success": true,
                "data": [
                    "id": "chan-new",
                    "kind": "channel",
                    "title": "new-room",
                    "archived": false,
                    "createdAt": "2026-05-29 12:00:00",
                    "updatedAt": "2026-05-29 12:00:00"
                ],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ]
        )

        let channel = try await client.createChannel(title: "new-room")
        XCTAssertEqual(channel.id, "chan-new")
        XCTAssertEqual(channel.title, "new-room")
        XCTAssertEqual(channel.kind, .channel)
        XCTAssertEqual(channel.memberCount, 0)
    }

    func testCreateChannelSendsTitleInBody() async throws {
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(
                statusCode: 201,
                json: [
                    "success": true,
                    "data": [
                        "id": "chan-new", "kind": "channel", "title": "ops",
                        "archived": false,
                        "createdAt": "2026-05-29 12:00:00", "updatedAt": "2026-05-29 12:00:00"
                    ],
                    "timestamp": "2026-05-29T12:00:00.000Z"
                ]
            )(request)
        }

        _ = try await client.createChannel(title: "ops")

        let body = try XCTUnwrap(capturedBody)
        let obj = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(obj?["title"] as? String, "ops")
    }

    func testCreateChannelThrowsOnServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 400, code: "BAD_REQUEST", message: "title is required"
        )
        do {
            _ = try await client.createChannel(title: "")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - joinChannel

    func testJoinChannelHitsCorrectPathAndBody() async throws {
        var capturedURL: URL?
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        try await client.joinChannel(channelId: "chan-alpha", memberId: "raynor", memberKind: .agent)

        XCTAssertTrue(capturedURL!.path.hasSuffix("/channels/chan-alpha/join"))
        let obj = try JSONSerialization.jsonObject(with: XCTUnwrap(capturedBody)) as? [String: Any]
        XCTAssertEqual(obj?["memberId"] as? String, "raynor")
        XCTAssertEqual(obj?["memberKind"] as? String, "agent")
    }

    func testJoinChannelThrowsOn404() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Channel not found"
        )
        do {
            try await client.joinChannel(channelId: "nope", memberId: "raynor", memberKind: .agent)
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - leaveChannel

    func testLeaveChannelHitsCorrectPathAndBody() async throws {
        var capturedURL: URL?
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["success": true],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        try await client.leaveChannel(channelId: "chan-alpha", memberId: "raynor")

        XCTAssertTrue(capturedURL!.path.hasSuffix("/channels/chan-alpha/leave"))
        let obj = try JSONSerialization.jsonObject(with: XCTUnwrap(capturedBody)) as? [String: Any]
        XCTAssertEqual(obj?["memberId"] as? String, "raynor")
    }

    func testLeaveChannelThrowsOnServerError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Channel not found"
        )
        do {
            try await client.leaveChannel(channelId: "nope", memberId: "raynor")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }

    // MARK: - postToChannel

    func testPostToChannelDecodesMessageId() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(
            statusCode: 201,
            json: [
                "success": true,
                "data": ["messageId": "msg-99", "timestamp": "2026-05-29 12:06:00"],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ]
        )

        let response = try await client.postToChannel(
            channelId: "chan-alpha", body: "status?", senderId: "user"
        )
        XCTAssertEqual(response.messageId, "msg-99")
        XCTAssertEqual(response.timestamp, "2026-05-29 12:06:00")
    }

    func testPostToChannelSendsBodyAndSender() async throws {
        var capturedURL: URL?
        var capturedBody: Data?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedBody = MockURLProtocol.getBodyData(from: request)
            return try MockURLProtocol.mockResponse(
                statusCode: 201,
                json: [
                    "success": true,
                    "data": ["messageId": "m1", "timestamp": "2026-05-29 12:06:00"],
                    "timestamp": "2026-05-29T12:00:00.000Z"
                ]
            )(request)
        }

        _ = try await client.postToChannel(channelId: "chan-alpha", body: "hi there", senderId: "user")

        XCTAssertTrue(capturedURL!.path.hasSuffix("/channels/chan-alpha/messages"))
        let obj = try JSONSerialization.jsonObject(with: XCTUnwrap(capturedBody)) as? [String: Any]
        XCTAssertEqual(obj?["body"] as? String, "hi there")
        XCTAssertEqual(obj?["senderId"] as? String, "user")
    }

    func testPostToChannelThrowsOn403() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 403, code: "FORBIDDEN", message: "not a member"
        )
        do {
            _ = try await client.postToChannel(channelId: "chan-alpha", body: "x", senderId: "stranger")
            XCTFail("Expected error")
        } catch {
            // expected
        }
    }
}
