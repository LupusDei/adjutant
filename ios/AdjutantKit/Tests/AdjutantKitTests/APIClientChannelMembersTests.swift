import XCTest
@testable import AdjutantKit

/// Tests for the channel-members API client (adj-4wrro).
///
/// The response shape is pinned to the REAL backend serialization, NOT an
/// assumed TS shape (Constitution Rule 1). `GET /api/channels/:id/members`
/// returns `success({ members, total })` where each member is the exact
/// `rowToMember(...)` output from `conversation-store.ts`:
///
///   { conversationId, memberId, memberKind, role, joinedAt, lastReadAt }
///
/// `lastReadAt` is `null` for a member who has never read the room. The iOS
/// `ChannelMember` model MUST tolerate that null and the extra fields the
/// spawn brief abbreviated to `{ memberId, memberKind, role }`.
final class APIClientChannelMembersTests: XCTestCase {
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

    // MARK: - ChannelMember model decode

    func testChannelMemberDecodesRealRowToMemberShape() throws {
        // Exact `rowToMember` output (conversation-store.ts) — owner with a read watermark.
        let json = """
        {
          "conversationId": "chan-ops",
          "memberId": "user",
          "memberKind": "user",
          "role": "owner",
          "joinedAt": "2026-05-29 12:00:00",
          "lastReadAt": "2026-05-29 12:30:00"
        }
        """.data(using: .utf8)!

        let member = try JSONDecoder().decode(ChannelMember.self, from: json)
        XCTAssertEqual(member.id, "user")
        XCTAssertEqual(member.memberId, "user")
        XCTAssertEqual(member.memberKind, .user)
        XCTAssertEqual(member.role, "owner")
        XCTAssertEqual(member.conversationId, "chan-ops")
        XCTAssertEqual(member.joinedAt, "2026-05-29 12:00:00")
        XCTAssertEqual(member.lastReadAt, "2026-05-29 12:30:00")
    }

    func testChannelMemberDecodesNullLastReadAt() throws {
        // A member who never opened the room: lastReadAt is JSON null.
        let json = """
        {
          "conversationId": "chan-ops",
          "memberId": "raynor",
          "memberKind": "agent",
          "role": "member",
          "joinedAt": "2026-05-29 12:01:00",
          "lastReadAt": null
        }
        """.data(using: .utf8)!

        let member = try JSONDecoder().decode(ChannelMember.self, from: json)
        XCTAssertEqual(member.memberId, "raynor")
        XCTAssertEqual(member.memberKind, .agent)
        XCTAssertNil(member.lastReadAt)
    }

    // MARK: - getChannelMembers

    func testGetChannelMembersDecodesRealShape() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "members": [
                    [
                        "conversationId": "chan-ops",
                        "memberId": "user",
                        "memberKind": "user",
                        "role": "owner",
                        "joinedAt": "2026-05-29 12:00:00",
                        "lastReadAt": "2026-05-29 12:30:00"
                    ],
                    [
                        "conversationId": "chan-ops",
                        "memberId": "raynor",
                        "memberKind": "agent",
                        "role": "member",
                        "joinedAt": "2026-05-29 12:01:00",
                        "lastReadAt": NSNull()
                    ]
                ],
                "total": 2
            ],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let members = try await client.getChannelMembers(channelId: "chan-ops")
        XCTAssertEqual(members.count, 2)
        XCTAssertEqual(members[0].memberId, "user")
        XCTAssertEqual(members[0].memberKind, .user)
        XCTAssertEqual(members[1].memberId, "raynor")
        XCTAssertEqual(members[1].memberKind, .agent)
        XCTAssertNil(members[1].lastReadAt)
    }

    func testGetChannelMembersHitsCorrectPath() async throws {
        var capturedURL: URL?
        var capturedMethod: String?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            capturedMethod = request.httpMethod
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["members": [], "total": 0],
                "timestamp": "2026-05-29T12:00:00.000Z"
            ])(request)
        }

        _ = try await client.getChannelMembers(channelId: "chan-alpha")
        XCTAssertEqual(capturedMethod, "GET")
        XCTAssertTrue(capturedURL!.path.hasSuffix("/channels/chan-alpha/members"))
    }

    func testGetChannelMembersEmpty() async throws {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["members": [], "total": 0],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])

        let members = try await client.getChannelMembers(channelId: "chan-empty")
        XCTAssertTrue(members.isEmpty)
    }

    func testGetChannelMembersThrowsOn404() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "Channel not found"
        )
        do {
            _ = try await client.getChannelMembers(channelId: "nope")
            XCTFail("Expected error for unknown channel")
        } catch {
            // expected
        }
    }
}
