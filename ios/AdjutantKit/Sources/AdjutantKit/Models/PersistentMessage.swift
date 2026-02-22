import Foundation

/// Role of the message sender.
public enum MessageRole: String, Codable, Sendable, CaseIterable {
    case user
    case agent
    case system
    case announcement
}

/// Delivery status of a persistent message.
public enum DeliveryStatus: String, Codable, Sendable, CaseIterable {
    case pending
    case sent
    case delivered
    case read
    case failed
}

/// A persistent message from the SQLite message store.
/// Maps to the backend `Message` interface from `message-store.ts`.
public struct PersistentMessage: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let sessionId: String?
    public let agentId: String
    public let recipient: String?
    public let role: MessageRole
    public let body: String
    public let metadata: [String: AnyCodableValue]?
    public let deliveryStatus: DeliveryStatus
    public let eventType: String?
    public let threadId: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        sessionId: String? = nil,
        agentId: String,
        recipient: String? = nil,
        role: MessageRole,
        body: String,
        metadata: [String: AnyCodableValue]? = nil,
        deliveryStatus: DeliveryStatus = .pending,
        eventType: String? = nil,
        threadId: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.sessionId = sessionId
        self.agentId = agentId
        self.recipient = recipient
        self.role = role
        self.body = body
        self.metadata = metadata
        self.deliveryStatus = deliveryStatus
        self.eventType = eventType
        self.threadId = threadId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private static let dateFormatterWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let dateFormatterBasic = ISO8601DateFormatter()

    /// Parse the createdAt timestamp string into a Date
    public var date: Date? {
        Self.dateFormatterWithFractional.date(from: createdAt)
            ?? Self.dateFormatterBasic.date(from: createdAt)
    }

    /// Display name for the sender
    public var senderName: String {
        if role == .user {
            return "You"
        }
        return agentId
    }

    /// Whether this message is from the user
    public var isFromUser: Bool {
        role == .user
    }
}

/// Unread count for a single agent.
public struct UnreadCount: Codable, Sendable, Equatable {
    public let agentId: String
    public let count: Int

    public init(agentId: String, count: Int) {
        self.agentId = agentId
        self.count = count
    }
}

/// Response envelope for unread counts endpoint.
public struct UnreadCountsResponse: Codable, Sendable {
    public let counts: [UnreadCount]

    public init(counts: [UnreadCount]) {
        self.counts = counts
    }
}

/// Response from POST /api/messages (send message).
public struct SendChatMessageResponse: Codable, Sendable, Equatable {
    public let messageId: String
    public let timestamp: String

    public init(messageId: String, timestamp: String) {
        self.messageId = messageId
        self.timestamp = timestamp
    }
}

/// Request body for POST /api/messages.
public struct SendChatMessageRequest: Encodable, Sendable {
    public let to: String
    public let body: String
    public let threadId: String?
    public let metadata: [String: AnyCodableValue]?

    public init(
        to: String,
        body: String,
        threadId: String? = nil,
        metadata: [String: AnyCodableValue]? = nil
    ) {
        self.to = to
        self.body = body
        self.threadId = threadId
        self.metadata = metadata
    }
}

/// Paginated response for messages list endpoint.
public struct MessagesListResponse: Codable, Sendable {
    public let items: [PersistentMessage]
    public let total: Int
    public let hasMore: Bool

    public init(items: [PersistentMessage], total: Int, hasMore: Bool) {
        self.items = items
        self.total = total
        self.hasMore = hasMore
    }
}

/// A type-erased Codable value for metadata dictionaries.
/// Supports JSON primitives: String, Int, Double, Bool, and null.
public enum AnyCodableValue: Codable, Hashable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let val = try? container.decode(Bool.self) {
            self = .bool(val)
        } else if let val = try? container.decode(Int.self) {
            self = .int(val)
        } else if let val = try? container.decode(Double.self) {
            self = .double(val)
        } else if let val = try? container.decode(String.self) {
            self = .string(val)
        } else {
            self = .null
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let val): try container.encode(val)
        case .int(let val): try container.encode(val)
        case .double(let val): try container.encode(val)
        case .bool(let val): try container.encode(val)
        case .null: try container.encodeNil()
        }
    }
}
