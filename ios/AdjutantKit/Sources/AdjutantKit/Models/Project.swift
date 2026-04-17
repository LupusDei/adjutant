import Foundation

/// A registered project tracked by the Projects service.
/// Mirrors the backend `Project` type from `services/projects-service.ts`.
/// adj-162: `active` field removed — project selection is client-side only.
public struct Project: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let path: String
    public let gitRemote: String?
    public let mode: String
    public let sessions: [String]
    public let createdAt: String
    public let autoDevelop: Bool?
    public let visionContext: String?
    public let autoDevelopPausedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, path, gitRemote, mode, sessions, createdAt, autoDevelop, visionContext, autoDevelopPausedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.name = try container.decode(String.self, forKey: .name)
        self.path = try container.decode(String.self, forKey: .path)
        self.gitRemote = try container.decodeIfPresent(String.self, forKey: .gitRemote)
        self.mode = try container.decode(String.self, forKey: .mode)
        self.sessions = try container.decodeIfPresent([String].self, forKey: .sessions) ?? []
        self.createdAt = try container.decode(String.self, forKey: .createdAt)
        self.autoDevelop = try container.decodeIfPresent(Bool.self, forKey: .autoDevelop)
        self.visionContext = try container.decodeIfPresent(String.self, forKey: .visionContext)
        self.autoDevelopPausedAt = try container.decodeIfPresent(String.self, forKey: .autoDevelopPausedAt)
    }

    public init(
        id: String,
        name: String,
        path: String,
        gitRemote: String? = nil,
        mode: String,
        sessions: [String] = [],
        createdAt: String,
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
