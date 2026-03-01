import Foundation

/// A mail message in the system
public struct Message: Codable, Identifiable, Equatable, Hashable {
    /// Unique identifier (beads issue ID format, e.g., "gb-53tj")
    public let id: String
    /// Sender address (e.g., "system", "adjutant/agent-abc")
    public let from: String
    /// Recipient address
    public let to: String
    /// Message subject line
    public let subject: String
    /// Full message body content
    public let body: String
    /// ISO 8601 timestamp when message was sent
    public let timestamp: String
    /// Whether the message has been read
    public let read: Bool
    /// Priority level: 0=urgent, 1=high, 2=normal, 3=low, 4=lowest
    public let priority: MessagePriority
    /// Type indicating message purpose
    public let type: MessageType
    /// Thread ID for grouping related messages
    public let threadId: String
    /// ID of message being replied to (if type is 'reply')
    public let replyTo: String?
    /// If true, message won't be auto-archived
    public let pinned: Bool
    /// Additional recipient addresses
    public let cc: [String]?
    /// True if this is an infrastructure/coordination message
    public let isInfrastructure: Bool

    public init(
        id: String,
        from: String,
        to: String,
        subject: String,
        body: String,
        timestamp: String,
        read: Bool,
        priority: MessagePriority,
        type: MessageType,
        threadId: String,
        replyTo: String? = nil,
        pinned: Bool,
        cc: [String]? = nil,
        isInfrastructure: Bool
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.subject = subject
        self.body = body
        self.timestamp = timestamp
        self.read = read
        self.priority = priority
        self.type = type
        self.threadId = threadId
        self.replyTo = replyTo
        self.pinned = pinned
        self.cc = cc
        self.isInfrastructure = isInfrastructure
    }

    /// Parse the timestamp string into a Date
    public var date: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
    }

    /// Get the sender name without trailing slash
    public var senderName: String {
        from.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

/// Request body for sending a new message
public struct SendMessageRequest: Encodable {
    /// Recipient address
    public var to: String?
    /// Sender address (default: resolved from environment)
    public var from: String?
    /// Message subject (required)
    public let subject: String
    /// Message body (required)
    public let body: String
    /// Priority level (default: 2)
    public var priority: MessagePriority?
    /// Message type (default: 'task')
    public var type: MessageType?
    /// ID of message being replied to
    public var replyTo: String?
    /// If true, append reply instructions with message ID to body
    public var includeReplyInstructions: Bool?

    public init(
        to: String? = nil,
        from: String? = nil,
        subject: String,
        body: String,
        priority: MessagePriority? = nil,
        type: MessageType? = nil,
        replyTo: String? = nil,
        includeReplyInstructions: Bool? = nil
    ) {
        self.to = to
        self.from = from
        self.subject = subject
        self.body = body
        self.priority = priority
        self.type = type
        self.replyTo = replyTo
        self.includeReplyInstructions = includeReplyInstructions
    }
}
