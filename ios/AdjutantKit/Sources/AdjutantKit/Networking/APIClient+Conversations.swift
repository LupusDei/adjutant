import Foundation

// MARK: - Conversations Endpoints (adj-164.3.1)

extension APIClient {
    /// List the conversations a member belongs to.
    ///
    /// Maps to `GET /api/conversations?memberId=`. The backend defaults the
    /// member to the dashboard operator (`"user"`) when `memberId` is omitted,
    /// so callers fetching the user's own conversations can pass `nil`.
    ///
    /// - Parameter memberId: Optional member id to scope the listing. Nil uses
    ///   the server-side default (`"user"`).
    /// - Returns: A ``ConversationsListResponse`` with conversations and total.
    public func getConversations(
        memberId: String? = nil
    ) async throws -> ConversationsListResponse {
        var queryItems: [URLQueryItem] = []
        if let memberId {
            queryItems.append(URLQueryItem(name: "memberId", value: memberId))
        }
        return try await requestWithEnvelope(
            .get,
            path: "/conversations",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Fetch the messages of a single conversation, scoped strictly by
    /// conversation id (the root-cause fix for wrong-thread bleed).
    ///
    /// Maps to `GET /api/conversations/:id/messages?before=&beforeId=&limit=`.
    /// The server returns items in chronological (oldest-first) order.
    ///
    /// - Parameters:
    ///   - conversationId: The conversation to scope to.
    ///   - before: ISO/sqlite timestamp cursor for older-message pagination.
    ///   - beforeId: Message id cursor disambiguating same-second rows.
    ///   - limit: Max messages to return (server clamps to 1...200).
    /// - Returns: A ``MessagesListResponse`` scoped to the conversation.
    public func getConversationMessages(
        conversationId: String,
        before: String? = nil,
        beforeId: String? = nil,
        limit: Int? = nil
    ) async throws -> MessagesListResponse {
        let encodedId = conversationId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? conversationId

        var queryItems: [URLQueryItem] = []
        if let before {
            queryItems.append(URLQueryItem(name: "before", value: before))
        }
        if let beforeId {
            queryItems.append(URLQueryItem(name: "beforeId", value: beforeId))
        }
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }

        return try await requestWithEnvelope(
            .get,
            path: "/conversations/\(encodedId)/messages",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }
}
