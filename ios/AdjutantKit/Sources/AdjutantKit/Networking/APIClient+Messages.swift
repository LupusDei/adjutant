import Foundation

// MARK: - Messages Endpoints

extension APIClient {
    /// Fetch messages, optionally scoped to an agent.
    ///
    /// Maps to `GET /api/messages?agentId=&before=&beforeId=&limit=`
    ///
    /// - Parameters:
    ///   - agentId: Filter by agent (to/from). Nil returns all messages.
    ///   - before: ISO 8601 timestamp cursor for pagination.
    ///   - beforeId: Message ID cursor for pagination.
    ///   - limit: Max messages to return. Server default applies if nil.
    /// - Returns: A ``MessagesListResponse`` with items, total, and hasMore.
    public func getMessages(
        agentId: String? = nil,
        before: String? = nil,
        beforeId: String? = nil,
        limit: Int? = nil
    ) async throws -> MessagesListResponse {
        var queryItems: [URLQueryItem] = []
        if let agentId {
            queryItems.append(URLQueryItem(name: "agentId", value: agentId))
        }
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
            path: "/messages",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Send a chat message to an agent.
    ///
    /// Maps to `POST /api/messages`
    ///
    /// - Parameters:
    ///   - agentId: The agent to send to.
    ///   - body: Message body text.
    ///   - threadId: Optional thread ID for grouping.
    /// - Returns: A ``SendChatMessageResponse`` with messageId and timestamp.
    public func sendChatMessage(
        agentId: String,
        body: String,
        threadId: String? = nil
    ) async throws -> SendChatMessageResponse {
        let request = SendChatMessageRequest(to: agentId, body: body, threadId: threadId)
        return try await requestWithEnvelope(.post, path: "/messages", body: request)
    }

    /// Mark a single message as read.
    ///
    /// Maps to `PATCH /api/messages/:id/read`
    ///
    /// - Parameter messageId: The message ID to mark as read.
    public func markMessageRead(messageId: String) async throws -> SuccessResponse {
        let encodedId = messageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? messageId
        return try await requestWithEnvelope(.patch, path: "/messages/\(encodedId)/read")
    }

    /// Mark all messages from an agent as read.
    ///
    /// Maps to `PATCH /api/messages/read-all?agentId=`
    ///
    /// - Parameter agentId: The agent whose messages to mark as read.
    public func markAllMessagesRead(agentId: String) async throws -> SuccessResponse {
        let queryItems = [URLQueryItem(name: "agentId", value: agentId)]
        return try await requestWithEnvelope(
            .patch,
            path: "/messages/read-all",
            queryItems: queryItems
        )
    }

    /// Get unread message counts per agent.
    ///
    /// Maps to `GET /api/messages/unread`
    ///
    /// - Returns: An ``UnreadCountsResponse`` with per-agent counts.
    public func getUnreadCounts() async throws -> UnreadCountsResponse {
        try await requestWithEnvelope(.get, path: "/messages/unread")
    }
}
