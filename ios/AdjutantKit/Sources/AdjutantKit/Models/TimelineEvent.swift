import Foundation

/// A single event in the agent activity timeline.
/// Maps to the backend `TimelineEvent` interface from `types/events.ts`.
public struct TimelineEvent: Codable, Identifiable, Equatable {
    /// Unique event ID
    public let id: String
    /// Event type (status_change, progress_report, announcement, message_sent, bead_updated, bead_closed)
    public let eventType: String
    /// Agent that triggered the event
    public let agentId: String
    /// Human-readable description of the action
    public let action: String
    /// Additional event-specific data
    public let detail: [String: AnyCodableValue]?
    /// Related bead ID, if any
    public let beadId: String?
    /// Related message ID, if any
    public let messageId: String?
    /// ISO 8601 timestamp
    public let createdAt: String

    public init(
        id: String,
        eventType: String,
        agentId: String,
        action: String,
        detail: [String: AnyCodableValue]? = nil,
        beadId: String? = nil,
        messageId: String? = nil,
        createdAt: String
    ) {
        self.id = id
        self.eventType = eventType
        self.agentId = agentId
        self.action = action
        self.detail = detail
        self.beadId = beadId
        self.messageId = messageId
        self.createdAt = createdAt
    }

    private static let dateFormatterWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let dateFormatterBasic = ISO8601DateFormatter()

    /// Parse the createdAt timestamp into a Date
    public var date: Date? {
        Self.dateFormatterWithFractional.date(from: createdAt)
            ?? Self.dateFormatterBasic.date(from: createdAt)
    }
}

/// Response from GET /api/events/timeline.
public struct TimelineResponse: Codable, Equatable {
    /// Timeline events in reverse chronological order
    public let events: [TimelineEvent]
    /// Whether more events are available for pagination
    public let hasMore: Bool

    public init(events: [TimelineEvent], hasMore: Bool) {
        self.events = events
        self.hasMore = hasMore
    }
}
