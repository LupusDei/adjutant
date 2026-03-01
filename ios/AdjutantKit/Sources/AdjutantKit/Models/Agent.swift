import Foundation

/// A crew member (agent) in the system
public struct CrewMember: Codable, Identifiable, Equatable, Hashable {
    /// Unique identifier (e.g., "greenplace/Toast")
    public let id: String
    /// Display name
    public let name: String
    /// Agent type for icon/styling
    public let type: AgentType
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
    /// Current git branch
    public let branch: String?
    /// Session ID for linking to session chat
    public let sessionId: String?

    public init(
        id: String,
        name: String,
        type: AgentType,
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
        self.status = status
        self.currentTask = currentTask
        self.unreadMail = unreadMail
        self.firstSubject = firstSubject
        self.firstFrom = firstFrom
        self.branch = branch
        self.sessionId = sessionId
    }

    // Custom CodingKeys to gracefully ignore unknown fields like "rig"
    private enum CodingKeys: String, CodingKey {
        case id, name, type, status, currentTask, unreadMail
        case firstSubject, firstFrom, branch, sessionId
    }
}
