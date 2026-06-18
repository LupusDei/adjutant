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

/// A project's proposal **style guide** (adj-201 / US4). v1 is brand color only:
/// a required primary (when a guide is set) and an optional secondary.
///
/// Mirrors the backend `ProjectStyleGuide` type from `services/projects-service.ts`.
/// Both fields are optional because an **unset guide is a valid state** — the backend
/// returns `{ brandColorPrimary: null, brandColorSecondary: null }` when no guide is set.
public struct ProjectStyleGuide: Codable, Equatable {
    /// Primary brand/accent color as a hex string (`#RGB` / `#RRGGBB`), or nil when unset.
    public let brandColorPrimary: String?
    /// Optional secondary brand color as a hex string, or nil.
    public let brandColorSecondary: String?

    enum CodingKeys: String, CodingKey {
        case brandColorPrimary, brandColorSecondary
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // decodeIfPresent tolerates absent keys (older backends) AND JSON null.
        self.brandColorPrimary = try container.decodeIfPresent(String.self, forKey: .brandColorPrimary)
        self.brandColorSecondary = try container.decodeIfPresent(String.self, forKey: .brandColorSecondary)
    }

    public init(brandColorPrimary: String? = nil, brandColorSecondary: String? = nil) {
        self.brandColorPrimary = brandColorPrimary
        self.brandColorSecondary = brandColorSecondary
    }
}

/// Request body for `PUT /api/projects/:id/style-guide`.
///
/// The wire shape is `{ "primary": String, "secondary": String? }` — matching the
/// backend Zod schema EXACTLY (NOT the model's `brandColor*` field names). `secondary`
/// is always emitted (as JSON `null` when nil) so the server can distinguish a cleared
/// secondary from an omitted field.
public struct SetProjectStyleGuideRequest: Encodable {
    public let primary: String
    public let secondary: String?

    public init(primary: String, secondary: String?) {
        self.primary = primary
        self.secondary = secondary
    }

    enum CodingKeys: String, CodingKey {
        case primary, secondary
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(primary, forKey: .primary)
        // encode (not encodeIfPresent) so a nil secondary serializes as explicit null.
        try container.encode(secondary, forKey: .secondary)
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
