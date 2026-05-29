import XCTest
@testable import AdjutantKit

/// Channel subscribe/unsubscribe encoding + channel-message routing (adj-164.6.4 / T027).
///
/// Room-scoped fan-out (`backend/src/services/ws-server.ts`) delivers a channel
/// post only to clients that have explicitly subscribed to that conversation.
/// The iOS client must therefore:
///   1. Encode `{ type: "subscribe"|"unsubscribe", conversationId }` client
///      messages — matching the server's `handleSubscribe`/`handleUnsubscribe`.
///   2. Route an incoming `chat_message` to the open channel ONLY when its
///      `conversationId` equals the open channel id (strict — no cross-room bleed).
final class WebSocketChannelTests: XCTestCase {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Client message encoding carries conversationId

    func testSubscribeClientMessageEncodesConversationId() throws {
        let msg = WsClientMessage(type: "subscribe", conversationId: "chan-ops")
        let data = try encoder.encode(msg)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["type"] as? String, "subscribe")
        XCTAssertEqual(obj?["conversationId"] as? String, "chan-ops")
    }

    func testUnsubscribeClientMessageEncodesConversationId() throws {
        let msg = WsClientMessage(type: "unsubscribe", conversationId: "chan-ops")
        let data = try encoder.encode(msg)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["type"] as? String, "unsubscribe")
        XCTAssertEqual(obj?["conversationId"] as? String, "chan-ops")
    }

    func testConversationIdOmittedWhenNil() throws {
        // A plain message must not carry a null conversationId key.
        let msg = WsClientMessage(type: "message", to: "raynor", body: "hi")
        let data = try encoder.encode(msg)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNil(obj?["conversationId"])
    }

    // MARK: - Channel message routing predicate

    func testRoutesChannelMessageWhenConversationIdMatches() {
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "chan-ops",
                                  body: "status", conversationId: "chan-ops")
        XCTAssertTrue(
            WebSocketClient.shouldRouteChannel(message: msg, openChannelId: "chan-ops")
        )
    }

    func testDoesNotRouteChannelMessageForOtherChannel_BleedRegression() {
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "chan-dev",
                                  body: "status", conversationId: "chan-dev")
        XCTAssertFalse(
            WebSocketClient.shouldRouteChannel(message: msg, openChannelId: "chan-ops")
        )
    }

    func testDoesNotRouteChannelMessageWithoutConversationId() {
        // Channels are strictly conversation-id scoped — a broadcast with no
        // conversationId is never a channel message and must not bleed into a room.
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "user", body: "hi")
        XCTAssertFalse(
            WebSocketClient.shouldRouteChannel(message: msg, openChannelId: "chan-ops")
        )
    }

    func testNonChatChannelMessagesAlwaysRoute() {
        // Control-plane messages are never room-scoped.
        let msg = WsServerMessage(type: "connected", lastSeq: 1)
        XCTAssertTrue(
            WebSocketClient.shouldRouteChannel(message: msg, openChannelId: "chan-ops")
        )
    }
}
