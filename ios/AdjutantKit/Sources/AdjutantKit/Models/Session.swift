import Foundation

/// A managed tmux session tracked by the Session Bridge.
/// Mirrors the backend `ManagedSession` type from `types/session.ts`.
public struct ManagedSession: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let tmuxSession: String
    public let tmuxPane: String
    public let projectPath: String
    public let mode: SessionMode
    public let status: SessionStatus
    public let workspaceType: WorkspaceType
    public let connectedClients: [String]
    public let pipeActive: Bool
    public let createdAt: String
    public let lastActivity: String

    public init(
        id: String,
        name: String,
        tmuxSession: String,
        tmuxPane: String,
        projectPath: String,
        mode: SessionMode,
        status: SessionStatus,
        workspaceType: WorkspaceType,
        connectedClients: [String],
        pipeActive: Bool,
        createdAt: String,
        lastActivity: String
    ) {
        self.id = id
        self.name = name
        self.tmuxSession = tmuxSession
        self.tmuxPane = tmuxPane
        self.projectPath = projectPath
        self.mode = mode
        self.status = status
        self.workspaceType = workspaceType
        self.connectedClients = connectedClients
        self.pipeActive = pipeActive
        self.createdAt = createdAt
        self.lastActivity = lastActivity
    }
}

/// Session operating mode
public enum SessionMode: String, Codable, CaseIterable {
    case standalone
    case swarm
    case gastown
}

/// Session operational status
public enum SessionStatus: String, Codable, CaseIterable {
    case idle
    case working
    case waitingPermission = "waiting_permission"
    case offline
}

/// Workspace type for the session
public enum WorkspaceType: String, Codable, CaseIterable {
    case primary
    case worktree
    case copy
}

/// Request body for creating a new session
public struct CreateSessionRequest: Encodable {
    public let name: String?
    public let projectPath: String
    public let mode: String
    public let workspaceType: String?

    public init(
        name: String? = nil,
        projectPath: String,
        mode: String = "standalone",
        workspaceType: String? = nil
    ) {
        self.name = name
        self.projectPath = projectPath
        self.mode = mode
        self.workspaceType = workspaceType
    }
}

/// Response from killing a session
public struct KillSessionResponse: Codable, Equatable {
    public let killed: Bool
}

/// Response from session discovery
public struct DiscoverSessionsResponse: Codable, Equatable {
    public let discovered: Int
    public let sessions: [ManagedSession]
}
