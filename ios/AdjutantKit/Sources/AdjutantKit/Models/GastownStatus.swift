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

/// Town metadata (legacy Gas Town naming)
public struct TownInfo: Codable, Equatable, Hashable {
    public let name: String
    public let root: String

    public init(name: String, root: String) {
        self.name = name
        self.root = root
    }
}

/// Power control capabilities
public struct PowerCapabilities: Codable, Equatable, Hashable {
    /// Whether the system can be started/stopped
    public let canControl: Bool
    /// Whether the system auto-starts (no manual control needed)
    public let autoStart: Bool

    public init(canControl: Bool, autoStart: Bool) {
        self.canControl = canControl
        self.autoStart = autoStart
    }
}

/// Infrastructure agent statuses.
/// Handles both Gas Town shape (mayor/deacon/daemon) and generalized shape (coordinator/healthCheck/daemon).
public struct InfrastructureStatus: Codable, Equatable, Hashable {
    public let mayor: AgentStatus
    public let deacon: AgentStatus
    public let daemon: AgentStatus

    public init(mayor: AgentStatus, deacon: AgentStatus, daemon: AgentStatus) {
        self.mayor = mayor
        self.deacon = deacon
        self.daemon = daemon
    }

    // Custom decoding to handle both Gas Town and generalized status shapes.
    // Gas Town: { mayor, deacon, daemon }
    // Generalized (SystemStatus): { coordinator, healthCheck?, daemon? }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Try Gas Town shape first (mayor/deacon/daemon)
        if let mayor = try? container.decode(AgentStatus.self, forKey: .mayor) {
            self.mayor = mayor
            self.deacon = (try? container.decode(AgentStatus.self, forKey: .deacon))
                ?? AgentStatus(name: "deacon", running: false, unreadMail: 0)
            self.daemon = (try? container.decode(AgentStatus.self, forKey: .daemon))
                ?? AgentStatus(name: "daemon", running: false, unreadMail: 0)
        }
        // Fall back to generalized shape (coordinator/healthCheck/daemon)
        else if let coordinator = try? container.decode(AgentStatus.self, forKey: .coordinator) {
            self.mayor = coordinator
            self.deacon = (try? container.decode(AgentStatus.self, forKey: .healthCheck))
                ?? AgentStatus(name: "healthCheck", running: false, unreadMail: 0)
            self.daemon = (try? container.decode(AgentStatus.self, forKey: .daemon))
                ?? AgentStatus(name: "daemon", running: false, unreadMail: 0)
        } else {
            // Last resort: create offline placeholders
            self.mayor = AgentStatus(name: "coordinator", running: false, unreadMail: 0)
            self.deacon = AgentStatus(name: "healthCheck", running: false, unreadMail: 0)
            self.daemon = AgentStatus(name: "daemon", running: false, unreadMail: 0)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case mayor
        case deacon
        case daemon
        // Generalized SystemStatus keys
        case coordinator
        case healthCheck
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mayor, forKey: .mayor)
        try container.encode(deacon, forKey: .deacon)
        try container.encode(daemon, forKey: .daemon)
    }
}

/// Complete system status.
/// Handles both legacy Gas Town shape and the generalized SystemStatus shape.
///
/// Gas Town shape: { powerState, town, operator, infrastructure, rigs, fetchedAt }
/// SystemStatus shape: { powerState, powerCapabilities, workspace, operator, infrastructure?, rigs, agents, fetchedAt }
public struct GastownStatus: Equatable {
    /// Current power state
    public let powerState: PowerState
    /// Power control capabilities (nil for legacy responses)
    public let powerCapabilities: PowerCapabilities?
    /// Town/workspace metadata
    public let town: TownInfo
    /// Operator (human user) information
    public let `operator`: OperatorInfo
    /// Infrastructure agent statuses (optional in swarm mode)
    public let infrastructure: InfrastructureStatus?
    /// Per-rig agent information
    public let rigs: [RigStatus]
    /// All crew members/agents (from generalized status)
    public let agents: [CrewMember]
    /// Timestamp of this status snapshot
    public let fetchedAt: String

    public init(
        powerState: PowerState,
        powerCapabilities: PowerCapabilities? = nil,
        town: TownInfo,
        operator: OperatorInfo,
        infrastructure: InfrastructureStatus? = nil,
        rigs: [RigStatus],
        agents: [CrewMember] = [],
        fetchedAt: String
    ) {
        self.powerState = powerState
        self.powerCapabilities = powerCapabilities
        self.town = town
        self.operator = `operator`
        self.infrastructure = infrastructure
        self.rigs = rigs
        self.agents = agents
        self.fetchedAt = fetchedAt
    }

    private enum CodingKeys: String, CodingKey {
        case powerState
        case powerCapabilities
        case town
        case workspace
        case `operator`
        case infrastructure
        case rigs
        case agents
        case fetchedAt
    }
}

extension GastownStatus: Decodable {
    // Custom decoding to handle both Gas Town and SystemStatus shapes.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        self.powerState = try container.decode(PowerState.self, forKey: .powerState)
        self.powerCapabilities = try container.decodeIfPresent(PowerCapabilities.self, forKey: .powerCapabilities)
        self.fetchedAt = try container.decode(String.self, forKey: .fetchedAt)
        self.`operator` = try container.decode(OperatorInfo.self, forKey: .operator)
        self.rigs = (try? container.decode([RigStatus].self, forKey: .rigs)) ?? []
        self.agents = (try? container.decode([CrewMember].self, forKey: .agents)) ?? []

        // Town can come as "town" (Gas Town) or "workspace" (SystemStatus)
        if let town = try? container.decode(TownInfo.self, forKey: .town) {
            self.town = town
        } else if let workspace = try? container.decode(TownInfo.self, forKey: .workspace) {
            self.town = workspace
        } else {
            self.town = TownInfo(name: "unknown", root: "")
        }

        // Infrastructure is optional in SystemStatus (swarm mode omits it)
        self.infrastructure = try container.decodeIfPresent(InfrastructureStatus.self, forKey: .infrastructure)
    }
}

extension GastownStatus: Encodable {
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(powerState, forKey: .powerState)
        try container.encodeIfPresent(powerCapabilities, forKey: .powerCapabilities)
        try container.encode(town, forKey: .town)
        try container.encode(`operator`, forKey: .operator)
        try container.encodeIfPresent(infrastructure, forKey: .infrastructure)
        try container.encode(rigs, forKey: .rigs)
        try container.encode(agents, forKey: .agents)
        try container.encode(fetchedAt, forKey: .fetchedAt)
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
