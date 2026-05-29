import Foundation

/// The unified first-class chat entity (adj-164.1).
///
/// A conversation is either a 1:1 direct message (`kind == .dm`, exactly two
/// members) or a Slack-style channel (`kind == .channel`, N members). The same
/// type backs both surfaces on iOS, mirroring the backend `Conversation`
/// (`conversation-store.ts`, emitted camelCase by `rowToConversation`).
public struct Conversation: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: ConversationKind
    public let title: String?
    public let archived: Bool
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        kind: ConversationKind,
        title: String? = nil,
        archived: Bool = false,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.archived = archived
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Discriminator distinguishing direct messages from channels.
public enum ConversationKind: String, Codable, Sendable, CaseIterable {
    case dm
    case channel
}

/// Response envelope payload for `GET /api/conversations`.
/// Mirrors the backend success-envelope `data` shape:
/// `{ conversations: Conversation[], total }`.
public struct ConversationsListResponse: Codable, Sendable {
    public let conversations: [Conversation]
    public let total: Int

    public init(conversations: [Conversation], total: Int) {
        self.conversations = conversations
        self.total = total
    }
}
