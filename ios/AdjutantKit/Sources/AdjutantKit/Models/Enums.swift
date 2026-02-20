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

/// Deployment mode for the Adjutant app.
/// Determines which features and tabs are available.
public enum DeploymentMode: String, Codable, CaseIterable {
    case gastown
    case swarm
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
