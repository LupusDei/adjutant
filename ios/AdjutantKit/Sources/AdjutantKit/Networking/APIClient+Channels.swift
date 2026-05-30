import Foundation

// MARK: - Channels Endpoints (adj-164.6.1)

/// Acknowledgement payload returned by `join`/`leave` (`{ success: true }`).
private struct ChannelActionAck: Decodable {
    let success: Bool
}

/// Request body for `POST /api/channels`.
private struct CreateChannelRequest: Encodable {
    let title: String
    let createdBy: String?
}

/// Request body for `POST /api/channels/:id/join`.
private struct JoinChannelRequest: Encodable {
    let memberId: String
    let memberKind: String
}

/// Request body for `POST /api/channels/:id/leave`.
private struct LeaveChannelRequest: Encodable {
    let memberId: String
}

/// Request body for `POST /api/channels/:id/messages`.
private struct PostChannelMessageRequest: Encodable {
    let body: String
    let senderId: String
}

extension APIClient {
    /// List all channels with their denormalized member counts.
    ///
    /// Maps to `GET /api/channels` →
    /// `{ channels: ChannelSummary[], total }` inside the success envelope.
    ///
    /// - Returns: A ``ChannelsListResponse`` (channels + total).
    public func listChannels() async throws -> ChannelsListResponse {
        try await requestWithEnvelope(.get, path: "/channels")
    }

    /// List the current members of a channel (adj-4wrro).
    ///
    /// Maps to `GET /api/channels/:id/members` →
    /// `{ members: ConversationMember[], total }` inside the success envelope.
    /// Used by the roster sheet and to filter the add-agent picker down to
    /// agents who are not already members.
    ///
    /// - Parameter channelId: The channel whose membership to fetch.
    /// - Returns: The channel's members (may be empty).
    /// - Throws: ``APIClientError`` on 404 (unknown channel).
    public func getChannelMembers(channelId: String) async throws -> [ChannelMember] {
        let encodedId = channelId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? channelId
        let response: ChannelMembersResponse = try await requestWithEnvelope(
            .get,
            path: "/channels/\(encodedId)/members"
        )
        return response.members
    }

    /// Create a new channel. The backend adds the creator (`createdBy`, default
    /// the dashboard operator `"user"`) as the channel owner.
    ///
    /// Maps to `POST /api/channels` → a ``Channel`` (a bare Conversation; its
    /// `memberCount` decodes to `0`), HTTP 201.
    ///
    /// - Parameters:
    ///   - title: Channel display name. Must be non-empty after server-side trim.
    ///   - createdBy: Member id of the creator. Nil uses the server default.
    /// - Returns: The created ``Channel``.
    public func createChannel(title: String, createdBy: String? = nil) async throws -> Channel {
        try await requestWithEnvelope(
            .post,
            path: "/channels",
            body: CreateChannelRequest(title: title, createdBy: createdBy)
        )
    }

    /// Add a member to a channel (idempotent server-side).
    ///
    /// Maps to `POST /api/channels/:id/join` → `{ success: true }`.
    ///
    /// - Parameters:
    ///   - channelId: The channel to join.
    ///   - memberId: The member id being added.
    ///   - memberKind: Whether the member is the `user` or an `agent`.
    /// - Throws: ``APIClientError`` on 404 (unknown channel) / 400 (bad input).
    public func joinChannel(
        channelId: String,
        memberId: String,
        memberKind: MemberKind
    ) async throws {
        let encodedId = channelId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? channelId
        let _: ChannelActionAck = try await requestWithEnvelope(
            .post,
            path: "/channels/\(encodedId)/join",
            body: JoinChannelRequest(memberId: memberId, memberKind: memberKind.rawValue)
        )
    }

    /// Remove a member from a channel.
    ///
    /// Maps to `POST /api/channels/:id/leave` → `{ success: true }`.
    ///
    /// - Parameters:
    ///   - channelId: The channel to leave.
    ///   - memberId: The member id being removed.
    /// - Throws: ``APIClientError`` on 404 (unknown channel) / 400 (bad input).
    public func leaveChannel(channelId: String, memberId: String) async throws {
        let encodedId = channelId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? channelId
        let _: ChannelActionAck = try await requestWithEnvelope(
            .post,
            path: "/channels/\(encodedId)/leave",
            body: LeaveChannelRequest(memberId: memberId)
        )
    }

    /// Post a message to a channel. The sender MUST already be a member; the
    /// backend returns 403 otherwise and fans the message out room-scoped.
    ///
    /// Maps to `POST /api/channels/:id/messages` →
    /// `{ messageId, timestamp }`, HTTP 201.
    ///
    /// - Parameters:
    ///   - channelId: The channel to post to.
    ///   - body: The message text. Must be non-empty.
    ///   - senderId: The member id of the sender (default `"user"`).
    /// - Returns: A ``SendChatMessageResponse`` (messageId + timestamp).
    /// - Throws: ``APIClientError`` on 404 / 400 / 403.
    public func postToChannel(
        channelId: String,
        body: String,
        senderId: String = "user"
    ) async throws -> SendChatMessageResponse {
        let encodedId = channelId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? channelId
        return try await requestWithEnvelope(
            .post,
            path: "/channels/\(encodedId)/messages",
            body: PostChannelMessageRequest(body: body, senderId: senderId)
        )
    }
}
