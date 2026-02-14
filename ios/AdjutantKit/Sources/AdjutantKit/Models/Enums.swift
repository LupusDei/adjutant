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
public enum MessageType: String, Codable, CaseIterable {
    case notification
    case task
    case scavenge
    case reply
}

/// Possible states for the gastown system.
public enum PowerState: String, Codable, CaseIterable {
    case stopped
    case starting
    case running
    case stopping
}

/// Possible statuses for a crew member.
public enum CrewMemberStatus: String, Codable, CaseIterable {
    case idle
    case working
    case blocked
    case stuck
    case offline
}

/// Agent types in gastown.
public enum AgentType: String, Codable, CaseIterable {
    case mayor
    case deacon
    case witness
    case refinery
    case crew
    case polecat
}

/// Agent special states
public enum AgentState: String, Codable, CaseIterable {
    case stuck
    case awaitingGate = "awaiting-gate"
    case idle
    case working
}

/// Deployment mode determining which features and UI elements are available.
public enum AdjutantMode: String, Codable, CaseIterable, Identifiable {
    case gastown
    case standalone
    case swarm
    case unknown

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .gastown: return "GAS TOWN"
        case .standalone: return "SINGLE AGENT"
        case .swarm: return "SWARM"
        case .unknown: return "UNKNOWN"
        }
    }
}
