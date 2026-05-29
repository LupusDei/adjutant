import XCTest
@testable import AdjutantKit

/// Conversation-scoped routing for real-time `chat_message` events (adj-164.3.4 / T013).
///
/// The WebSocket fans out `chat_message` to every authenticated client. Each
/// client must drop messages that don't belong to the conversation it currently
/// has open. `WebSocketClient.shouldRoute` is the pure routing predicate; it is
/// also the iOS analogue of the web `useChatWebSocket` conversation filter.
///
/// Routing precedence (matches the ChatViewModel scoping contract):
///  - When the incoming message carries a `conversationId`, route IFF it equals
///    the open conversation id (strict — no bleed).
///  - When it has none (legacy rows before the backend stamps conversation ids),
///    fall back to routing by from/to matching the active recipient so the
///    client keeps working.
final class WebSocketConversationTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - WsServerMessage decodes conversationId

    func testChatMessageDecodesConversationId() throws {
        let json = """
        {"type":"chat_message","id":"m1","from":"raynor","to":"user",
         "body":"hi","conversationId":"dm_abc","timestamp":"2026-05-29T00:00:00Z"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "chat_message")
        XCTAssertEqual(msg.conversationId, "dm_abc")
    }

    func testChatMessageConversationIdNilWhenAbsent() throws {
        let json = """
        {"type":"chat_message","id":"m1","from":"raynor","to":"user","body":"hi"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertNil(msg.conversationId)
    }

    // MARK: - shouldRoute with conversationId present

    func testRoutesWhenConversationIdMatches() {
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "user",
                                  body: "hi", conversationId: "dm_abc")
        XCTAssertTrue(
            WebSocketClient.shouldRoute(message: msg, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }

    func testDoesNotRouteWhenConversationIdDiffers_BleedRegression() {
        // A message stamped for another DM must never reach this conversation,
        // even if its from/to would otherwise loosely match.
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "user",
                                  body: "hi", conversationId: "dm_OTHER")
        XCTAssertFalse(
            WebSocketClient.shouldRoute(message: msg, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }

    // MARK: - shouldRoute fallback (no conversationId)

    func testFallbackRoutesByFromWhenNoConversationId() {
        let msg = WsServerMessage(type: "chat_message", from: "raynor", to: "user", body: "hi")
        XCTAssertTrue(
            WebSocketClient.shouldRoute(message: msg, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }

    func testFallbackRoutesByToWhenNoConversationId() {
        // User's own echoed message: from=user, to=raynor.
        let msg = WsServerMessage(type: "chat_message", from: "user", to: "raynor", body: "hi")
        XCTAssertTrue(
            WebSocketClient.shouldRoute(message: msg, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }

    func testFallbackDoesNotRouteForeignAgent() {
        let msg = WsServerMessage(type: "chat_message", from: "kerrigan", to: "user", body: "hi")
        XCTAssertFalse(
            WebSocketClient.shouldRoute(message: msg, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }

    // MARK: - non-chat messages always route (control plane is not scoped)

    func testNonChatMessagesAlwaysRoute() {
        let typed = WsServerMessage(type: "delivered", clientId: "c", messageId: "x")
        XCTAssertTrue(
            WebSocketClient.shouldRoute(message: typed, openConversationId: "dm_abc", activeRecipient: "raynor")
        )
    }
}
