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

    public init(
        id: String,
        name: String,
        path: String,
        gitRemote: String? = nil,
        mode: String,
        sessions: [String] = [],
        createdAt: String,
        active: Bool = false
    ) {
        self.id = id
        self.name = name
        self.path = path
        self.gitRemote = gitRemote
        self.mode = mode
        self.sessions = sessions
        self.createdAt = createdAt
        self.active = active
    }
}

/// Request body for creating a project.
public struct CreateProjectRequest: Encodable {
    public let path: String?
    public let cloneUrl: String?
    public let name: String?
    public let empty: Bool?

    public init(path: String? = nil, cloneUrl: String? = nil, name: String? = nil, empty: Bool? = nil) {
        self.path = path
        self.cloneUrl = cloneUrl
        self.name = name
        self.empty = empty
    }
}

/// Response for project deletion.
public struct DeleteProjectResponse: Codable {
    public let id: String
    public let deleted: Bool
}
