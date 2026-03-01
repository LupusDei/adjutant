import Foundation

/// Priority levels for messages. Lower number = higher priority.
public enum MessagePriority: Int, Codable, CaseIterable {
    case urgent = 0
    case high = 1
    case normal = 2
    case low = 3
    case lowest = 4
}

/// Message types indicating the purpose of the message.
public enum MessageType: String, CaseIterable {
    case notification
    case task
    case scavenge
    case reply
}

extension MessageType: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = MessageType(rawValue: rawValue) ?? .notification
    }
}

/// Possible statuses for a crew member.
public enum CrewMemberStatus: String, CaseIterable {
    case idle
    case working
    case blocked
    case stuck
    case offline
}

extension CrewMemberStatus: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = CrewMemberStatus(rawValue: rawValue) ?? .idle
    }
}

/// Agent types in the system.
/// Unknown values are mapped to .agent as a safe fallback.
public enum AgentType: String, CaseIterable {
    case user
    case agent
}

extension AgentType: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = AgentType(rawValue: rawValue) ?? .agent
    }
}

/// Agent special states
public enum AgentState: String, CaseIterable {
    case stuck
    case awaitingGate = "awaiting-gate"
    case idle
    case working
}

extension AgentState: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = AgentState(rawValue: rawValue) ?? .idle
    }
}
