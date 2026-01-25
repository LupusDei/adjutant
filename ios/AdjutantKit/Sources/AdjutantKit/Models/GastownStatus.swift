import Foundation

/// Merge queue summary for a rig
public struct MergeQueueSummary: Codable, Equatable, Hashable {
    public let pending: Int
    public let inFlight: Int
    public let blocked: Int

    public init(pending: Int, inFlight: Int, blocked: Int) {
        self.pending = pending
        self.inFlight = inFlight
        self.blocked = blocked
    }
}

/// Status of a single rig
public struct RigStatus: Codable, Equatable, Hashable {
    /// Rig name
    public let name: String
    /// Rig root path
    public let path: String
    /// Witness agent for this rig
    public let witness: AgentStatus
    /// Refinery agent for this rig
    public let refinery: AgentStatus
    /// Crew workers for this rig
    public let crew: [AgentStatus]
    /// Active polecats (ephemeral workers)
    public let polecats: [AgentStatus]
    /// Merge queue summary
    public let mergeQueue: MergeQueueSummary

    public init(
        name: String,
        path: String,
        witness: AgentStatus,
        refinery: AgentStatus,
        crew: [AgentStatus],
        polecats: [AgentStatus],
        mergeQueue: MergeQueueSummary
    ) {
        self.name = name
        self.path = path
        self.witness = witness
        self.refinery = refinery
        self.crew = crew
        self.polecats = polecats
        self.mergeQueue = mergeQueue
    }
}

/// Operator (human user) information
public struct OperatorInfo: Codable, Equatable, Hashable {
    public let name: String
    public let email: String
    public let unreadMail: Int

    public init(name: String, email: String, unreadMail: Int) {
        self.name = name
        self.email = email
        self.unreadMail = unreadMail
    }
}

/// Town metadata
public struct TownInfo: Codable, Equatable, Hashable {
    public let name: String
    public let root: String

    public init(name: String, root: String) {
        self.name = name
        self.root = root
    }
}

/// Infrastructure agent statuses
public struct InfrastructureStatus: Codable, Equatable, Hashable {
    public let mayor: AgentStatus
    public let deacon: AgentStatus
    public let daemon: AgentStatus

    public init(mayor: AgentStatus, deacon: AgentStatus, daemon: AgentStatus) {
        self.mayor = mayor
        self.deacon = deacon
        self.daemon = daemon
    }
}

/// Complete gastown system status
public struct GastownStatus: Codable, Equatable {
    /// Current power state
    public let powerState: PowerState
    /// Town metadata
    public let town: TownInfo
    /// Operator (human user) information
    public let `operator`: OperatorInfo
    /// Infrastructure agent statuses
    public let infrastructure: InfrastructureStatus
    /// Per-rig agent information
    public let rigs: [RigStatus]
    /// Timestamp of this status snapshot
    public let fetchedAt: String

    public init(
        powerState: PowerState,
        town: TownInfo,
        operator: OperatorInfo,
        infrastructure: InfrastructureStatus,
        rigs: [RigStatus],
        fetchedAt: String
    ) {
        self.powerState = powerState
        self.town = town
        self.operator = `operator`
        self.infrastructure = infrastructure
        self.rigs = rigs
        self.fetchedAt = fetchedAt
    }
}

/// Response for power state changes
public struct PowerStateChange: Codable, Equatable {
    public let previousState: PowerState
    public let newState: PowerState

    public init(previousState: PowerState, newState: PowerState) {
        self.previousState = previousState
        self.newState = newState
    }
}
