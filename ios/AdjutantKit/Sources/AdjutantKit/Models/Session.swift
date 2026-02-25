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
public enum SessionMode: String, CaseIterable {
    case swarm
    case gastown
}

extension SessionMode: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Map legacy "standalone" to .swarm
        if rawValue == "standalone" {
            self = .swarm
            return
        }
        guard let mode = SessionMode(rawValue: rawValue) else {
            // Default to .swarm for unknown values
            self = .swarm
            return
        }
        self = mode
    }
}

/// Session operational status
public enum SessionStatus: String, CaseIterable {
    case idle
    case working
    case waitingPermission = "waiting_permission"
    case offline
}

extension SessionStatus: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Fall back to .offline for unknown statuses
        self = SessionStatus(rawValue: rawValue) ?? .offline
    }
}

/// Workspace type for the session
public enum WorkspaceType: String, CaseIterable {
    case primary
    case worktree
    case copy
}

extension WorkspaceType: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Fall back to .primary for unknown workspace types
        self = WorkspaceType(rawValue: rawValue) ?? .primary
    }
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
        mode: String = "swarm",
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

/// Request body for sending input to a session
public struct SendSessionInputRequest: Encodable {
    public let text: String

    public init(text: String) {
        self.text = text
    }
}

/// Response from sending input to a session
public struct SendSessionInputResponse: Codable, Equatable {
    public let sent: Bool
}
