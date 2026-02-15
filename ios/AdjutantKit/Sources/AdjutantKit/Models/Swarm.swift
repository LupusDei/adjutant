import Foundation

/// A swarm of agents working on one project in separate worktrees.
/// Mirrors the backend `SwarmInfo` type from `swarm-service.ts`.
public struct SwarmInfo: Codable, Identifiable, Equatable {
    public let id: String
    public let projectPath: String
    public let agents: [SwarmAgent]
    public let coordinator: String?
    public let createdAt: String

    public init(
        id: String,
        projectPath: String,
        agents: [SwarmAgent],
        coordinator: String? = nil,
        createdAt: String
    ) {
        self.id = id
        self.projectPath = projectPath
        self.agents = agents
        self.coordinator = coordinator
        self.createdAt = createdAt
    }
}

/// An agent within a swarm.
public struct SwarmAgent: Codable, Identifiable, Equatable {
    public let sessionId: String
    public let name: String
    public let branch: String
    public let status: String
    public let isCoordinator: Bool

    public var id: String { sessionId }

    public init(
        sessionId: String,
        name: String,
        branch: String,
        status: String,
        isCoordinator: Bool
    ) {
        self.sessionId = sessionId
        self.name = name
        self.branch = branch
        self.status = status
        self.isCoordinator = isCoordinator
    }
}

/// Branch status for a swarm agent.
public struct BranchStatus: Codable, Identifiable, Equatable {
    public let branch: String
    public let agentName: String
    public let aheadOfMain: Int
    public let behindMain: Int
    public let hasConflicts: Bool

    public var id: String { branch }
}

/// Result of a merge operation.
public struct MergeResult: Codable, Equatable {
    public let success: Bool
    public let branch: String
    public let merged: Bool?
    public let conflicts: [String]?
    public let error: String?
}

/// Request body for creating a swarm.
public struct CreateSwarmRequest: Encodable {
    public let projectPath: String
    public let agentCount: Int
    public let workspaceType: String?
    public let coordinatorIndex: Int?
    public let baseName: String?

    public init(
        projectPath: String,
        agentCount: Int,
        workspaceType: String? = nil,
        coordinatorIndex: Int? = nil,
        baseName: String? = nil
    ) {
        self.projectPath = projectPath
        self.agentCount = agentCount
        self.workspaceType = workspaceType
        self.coordinatorIndex = coordinatorIndex
        self.baseName = baseName
    }
}

/// Request body for adding an agent to a swarm.
public struct AddSwarmAgentRequest: Encodable {
    public let name: String?

    public init(name: String? = nil) {
        self.name = name
    }
}

/// Request body for merging a branch.
public struct MergeBranchRequest: Encodable {
    public let branch: String

    public init(branch: String) {
        self.branch = branch
    }
}

/// Response from removing an agent.
public struct RemoveAgentResponse: Codable, Equatable {
    public let removed: Bool
}

/// Response from destroying a swarm.
public struct DestroySwarmResponse: Codable, Equatable {
    public let destroyed: Bool
}
