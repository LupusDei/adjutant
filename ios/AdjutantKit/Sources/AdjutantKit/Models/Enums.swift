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
        // Fall back to .notification for unknown types
        self = MessageType(rawValue: rawValue) ?? .notification
    }
}

/// Deployment mode for the Adjutant app.
/// Determines which features and tabs are available.
public enum DeploymentMode: String, CaseIterable {
    case gastown
    case swarm
}

extension DeploymentMode: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Map legacy "standalone" → .swarm as a defensive fallback.
        // The gt CLI and older data may still emit "standalone".
        if rawValue == "standalone" {
            self = .swarm
            return
        }
        guard let mode = DeploymentMode(rawValue: rawValue) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unknown DeploymentMode: \(rawValue)"
            )
        }
        self = mode
    }
}

/// Possible states for the gastown system.
public enum PowerState: String, Codable, CaseIterable {
    case stopped
    case starting
    case running
    case stopping
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
        // Fall back to .idle for unknown statuses
        self = CrewMemberStatus(rawValue: rawValue) ?? .idle
    }
}

/// Agent types in the system.
/// Gas Town roles: mayor, deacon, witness, refinery, crew, polecat
/// Swarm roles: user, agent
/// Unknown values are mapped to .crew as a safe fallback.
public enum AgentType: String, CaseIterable {
    case mayor
    case deacon
    case witness
    case refinery
    case crew
    case polecat
    // Swarm mode roles
    case user
    case agent
}

extension AgentType: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Use known value or fall back to .crew for unknown roles
        self = AgentType(rawValue: rawValue) ?? .crew
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
        // Fall back to .idle for unknown states
        self = AgentState(rawValue: rawValue) ?? .idle
    }
}
