import Foundation

/// A registered project tracked by the Projects service.
/// Mirrors the backend `Project` type from `services/projects-service.ts`.
public struct Project: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let path: String
    public let gitRemote: String?
    public let mode: String
    public let sessions: [String]
    public let createdAt: String
    public let active: Bool
    public let autoDevelop: Bool?
    public let visionContext: String?
    public let autoDevelopPausedAt: String?

    public init(
        id: String,
        name: String,
        path: String,
        gitRemote: String? = nil,
        mode: String,
        sessions: [String] = [],
        createdAt: String,
        active: Bool = false,
        autoDevelop: Bool? = nil,
        visionContext: String? = nil,
        autoDevelopPausedAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.path = path
        self.gitRemote = gitRemote
        self.mode = mode
        self.sessions = sessions
        self.createdAt = createdAt
        self.active = active
        self.autoDevelop = autoDevelop
        self.visionContext = visionContext
        self.autoDevelopPausedAt = autoDevelopPausedAt
    }
}

/// Request body for creating a project.
public struct CreateProjectRequest: Encodable {
    public let path: String?
    public let cloneUrl: String?
    public let name: String?
    public let empty: Bool?
    public let targetDir: String?

    public init(
        path: String? = nil,
        cloneUrl: String? = nil,
        name: String? = nil,
        empty: Bool? = nil,
        targetDir: String? = nil
    ) {
        self.path = path
        self.cloneUrl = cloneUrl
        self.name = name
        self.empty = empty
        self.targetDir = targetDir
    }
}

/// Response for project deletion.
public struct DeleteProjectResponse: Codable {
    public let id: String
    public let deleted: Bool
}

/// Response from the discover endpoint.
public struct DiscoverProjectsResponse: Codable {
    public let discovered: Int
    public let projects: [Project]
}
