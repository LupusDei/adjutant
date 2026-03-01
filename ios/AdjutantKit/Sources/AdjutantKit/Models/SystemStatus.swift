import Foundation

/// Workspace metadata
public struct WorkspaceInfo: Codable, Equatable, Hashable {
    public let name: String
    public let root: String

    public init(name: String, root: String) {
        self.name = name
        self.root = root
    }
}

/// Simplified system status — no power state, no rigs, no infrastructure.
/// Just workspace info, agents, and a timestamp.
public struct SystemStatus: Codable, Equatable {
    /// Workspace metadata
    public let workspace: WorkspaceInfo
    /// All agents in the system
    public let agents: [CrewMember]
    /// Timestamp of this status snapshot
    public let fetchedAt: String

    public init(
        workspace: WorkspaceInfo,
        agents: [CrewMember],
        fetchedAt: String
    ) {
        self.workspace = workspace
        self.agents = agents
        self.fetchedAt = fetchedAt
    }

    private enum CodingKeys: String, CodingKey {
        case workspace
        case agents
        case fetchedAt
    }
}
