import Foundation

/// A crew member (agent) in the gastown system
public struct CrewMember: Codable, Identifiable, Equatable, Hashable {
    /// Unique identifier (e.g., "greenplace/Toast")
    public let id: String
    /// Display name
    public let name: String
    /// Agent type for icon/styling
    public let type: AgentType
    /// Which rig this agent belongs to (null for town-level)
    public let rig: String?
    /// Current operational status
    public let status: CrewMemberStatus
    /// Current task description (if working)
    public let currentTask: String?
    /// Number of unread messages
    public let unreadMail: Int?
    /// First unread message subject (for preview)
    public let firstSubject: String?
    /// Sender of first unread message (for preview)
    public let firstFrom: String?
    /// Current git branch (for polecats)
    public let branch: String?
    /// Session ID for linking to session chat (standalone/swarm)
    public let sessionId: String?

    public init(
        id: String,
        name: String,
        type: AgentType,
        rig: String?,
        status: CrewMemberStatus,
        currentTask: String? = nil,
        unreadMail: Int? = nil,
        firstSubject: String? = nil,
        firstFrom: String? = nil,
        branch: String? = nil,
        sessionId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.rig = rig
        self.status = status
        self.currentTask = currentTask
        self.unreadMail = unreadMail
        self.firstSubject = firstSubject
        self.firstFrom = firstFrom
        self.branch = branch
        self.sessionId = sessionId
    }
}

/// Agent status within gastown infrastructure
public struct AgentStatus: Codable, Equatable, Hashable {
    /// Agent identifier
    public let name: String
    /// Whether the agent is currently running
    public let running: Bool
    /// Work items pinned to this agent
    public let pinnedWork: [String]?
    /// Number of unread messages
    public let unreadMail: Int
    /// First unread message subject (for preview)
    public let firstMessageSubject: String?
    /// Special states like 'stuck' or 'awaiting-gate'
    public let state: AgentState?

    public init(
        name: String,
        running: Bool,
        pinnedWork: [String]? = nil,
        unreadMail: Int,
        firstMessageSubject: String? = nil,
        state: AgentState? = nil
    ) {
        self.name = name
        self.running = running
        self.pinnedWork = pinnedWork
        self.unreadMail = unreadMail
        self.firstMessageSubject = firstMessageSubject
        self.state = state
    }
}

/// Request body for spawning a polecat
public struct SpawnPolecatRequest: Encodable {
    /// Rig name (required)
    public let rig: String

    public init(rig: String) {
        self.rig = rig
    }
}

/// Response for polecat terminal capture
public struct TerminalCapture: Codable, Equatable {
    /// Terminal content with ANSI escape codes
    public let content: String
    /// tmux session name (e.g., "gt-greenplace-polecat-abc123")
    public let sessionName: String
    /// ISO 8601 capture timestamp
    public let timestamp: String

    public init(content: String, sessionName: String, timestamp: String) {
        self.content = content
        self.sessionName = sessionName
        self.timestamp = timestamp
    }
}
