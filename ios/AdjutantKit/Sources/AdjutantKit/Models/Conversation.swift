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

/// Whether a conversation member is the dashboard operator or an agent.
/// Mirrors the backend `member_kind` column (`conversation-store.ts`).
public enum MemberKind: String, Codable, Sendable, CaseIterable {
    case user
    case agent
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

/// A Slack-style channel as surfaced by the channels REST API (adj-164.6).
///
/// A channel IS a conversation with `kind == .channel`; this type adds the
/// denormalized `memberCount` the backend emits in `ChannelSummary`
/// (`conversation-store.ts`). The same struct decodes both list rows
/// (`GET /api/channels` → has `memberCount`) and a freshly-created channel
/// (`POST /api/channels` → a bare Conversation with no `memberCount`); when the
/// field is absent it defaults to `0`.
public struct Channel: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: ConversationKind
    public let title: String?
    public let archived: Bool
    /// Denormalized member count for list rendering. Defaults to `0` when the
    /// payload omits it (e.g. the create response, which is a bare Conversation).
    public let memberCount: Int
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        kind: ConversationKind = .channel,
        title: String? = nil,
        archived: Bool = false,
        memberCount: Int = 0,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.archived = archived
        self.memberCount = memberCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, title, archived, memberCount, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decodeIfPresent(ConversationKind.self, forKey: .kind) ?? .channel
        title = try c.decodeIfPresent(String.self, forKey: .title)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        // memberCount is absent on the create response (bare Conversation).
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 0
        createdAt = try c.decode(String.self, forKey: .createdAt)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
    }

    /// The channel's display name, falling back to the id when untitled.
    public var displayTitle: String {
        if let title, !title.isEmpty { return title }
        return id
    }
}

/// Response envelope payload for `GET /api/channels`.
/// Mirrors the backend success-envelope `data` shape:
/// `{ channels: ChannelSummary[], total }`.
public struct ChannelsListResponse: Codable, Sendable {
    public let channels: [Channel]
    public let total: Int

    public init(channels: [Channel], total: Int) {
        self.channels = channels
        self.total = total
    }
}

/// A single channel member as surfaced by `GET /api/channels/:id/members`
/// (adj-4wrro).
///
/// Mirrors the backend `ConversationMember` exactly — the serialized
/// `rowToMember(...)` output in `conversation-store.ts`:
/// `{ conversationId, memberId, memberKind, role, joinedAt, lastReadAt }`.
/// `lastReadAt` is `null` for a member who has never opened the room, so it is
/// optional here. `Identifiable` keys on `memberId` (the per-conversation PK
/// half) so roster lists can `ForEach` over members directly.
public struct ChannelMember: Codable, Identifiable, Hashable, Sendable {
    public let conversationId: String
    public let memberId: String
    public let memberKind: MemberKind
    /// `"member"` or `"owner"`. Kept as a string (not an enum) so an unknown
    /// future role from the backend decodes instead of throwing.
    public let role: String
    public let joinedAt: String
    public let lastReadAt: String?

    /// Stable identity for list rendering — the member id is unique within a
    /// conversation (composite PK `(conversation_id, member_id)`).
    public var id: String { memberId }

    public init(
        conversationId: String,
        memberId: String,
        memberKind: MemberKind,
        role: String,
        joinedAt: String,
        lastReadAt: String? = nil
    ) {
        self.conversationId = conversationId
        self.memberId = memberId
        self.memberKind = memberKind
        self.role = role
        self.joinedAt = joinedAt
        self.lastReadAt = lastReadAt
    }
}

/// Response envelope payload for `GET /api/channels/:id/members`.
/// Mirrors the backend success-envelope `data` shape:
/// `{ members: ConversationMember[], total }`.
public struct ChannelMembersResponse: Codable, Sendable {
    public let members: [ChannelMember]
    public let total: Int

    public init(members: [ChannelMember], total: Int) {
        self.members = members
        self.total = total
    }
}
