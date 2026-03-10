import Foundation
import UniformTypeIdentifiers
import CoreTransferable

/// A bead (issue/task) in the system
public struct BeadInfo: Codable, Identifiable, Equatable, Hashable {
    /// Bead ID (e.g., "gb-53tj")
    public let id: String
    /// Bead title
    public let title: String
    /// Description text (may be empty in list responses)
    public let description: String?
    /// Status (open, closed, etc.)
    public let status: String
    /// Priority (0-4, lower = higher priority)
    public let priority: Int
    /// Issue type (feature, bug, task, etc.)
    public let type: String
    /// Assignee address or null
    public let assignee: String?
    /// Project name extracted from assignee, or null
    public let project: String?
    /// Source project name
    public let source: String
    /// Labels attached to the bead
    public let labels: [String]
    /// ISO 8601 creation timestamp
    public let createdAt: String
    /// ISO 8601 last update timestamp
    public let updatedAt: String?

    public init(
        id: String,
        title: String,
        description: String? = nil,
        status: String,
        priority: Int,
        type: String,
        assignee: String?,
        project: String?,
        source: String,
        labels: [String],
        createdAt: String,
        updatedAt: String?
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.status = status
        self.priority = priority
        self.type = type
        self.assignee = assignee
        self.project = project
        self.source = source
        self.labels = labels
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    // Shared date formatters (avoid per-call allocation — adj-6yp4.1)
    private static let isoFormatterFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoFormatterBasic = ISO8601DateFormatter()

    /// Parse the createdAt timestamp into a Date
    public var createdDate: Date? {
        Self.isoFormatterFractional.date(from: createdAt)
            ?? Self.isoFormatterBasic.date(from: createdAt)
    }

    /// Parse the updatedAt timestamp into a Date
    public var updatedDate: Date? {
        guard let updatedAt else { return nil }
        return Self.isoFormatterFractional.date(from: updatedAt)
            ?? Self.isoFormatterBasic.date(from: updatedAt)
    }

    /// Get priority as MessagePriority enum
    public var priorityLevel: MessagePriority? {
        MessagePriority(rawValue: priority)
    }
}

// MARK: - Bead Detail

/// A dependency relationship between two beads.
public struct BeadDependency: Codable, Equatable, Hashable {
    /// The bead that has this dependency
    public let issueId: String
    /// The bead it depends on
    public let dependsOnId: String
    /// Dependency type (blocks, blocked_by)
    public let type: String

    public init(issueId: String, dependsOnId: String, type: String) {
        self.issueId = issueId
        self.dependsOnId = dependsOnId
        self.type = type
    }
}

/// Loose dependency for graceful decoding when the backend sends unexpected formats.
/// All fields are optional so decoding never fails — invalid entries are filtered out.
private struct LooseBeadDependency: Codable {
    let issueId: String?
    let dependsOnId: String?
    let type: String?

    func toBeadDependency() -> BeadDependency? {
        guard let issueId, let dependsOnId, let type else { return nil }
        return BeadDependency(issueId: issueId, dependsOnId: dependsOnId, type: type)
    }
}

/// Detailed bead info returned by GET /api/beads/:id.
/// Includes description, dependencies, and additional metadata.
public struct BeadDetail: Codable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let status: String
    public let priority: Int
    public let type: String
    public let assignee: String?
    public let project: String?
    public let source: String
    public let labels: [String]
    public let createdAt: String
    public let updatedAt: String?
    /// Full description text
    public let description: String
    /// Timestamp when bead was closed
    public let closedAt: String?
    /// Agent state (working, idle, stuck, stale)
    public let agentState: String?
    /// Dependency relationships
    public let dependencies: [BeadDependency]
    /// Whether this bead is pinned
    public let pinned: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, status, priority, type, assignee, project, source, labels
        case createdAt, updatedAt, description, closedAt, agentState
        case dependencies, pinned, isPinned
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        status = try container.decode(String.self, forKey: .status)
        priority = try container.decode(Int.self, forKey: .priority)
        type = try container.decode(String.self, forKey: .type)
        assignee = try container.decodeIfPresent(String.self, forKey: .assignee)
        project = try container.decodeIfPresent(String.self, forKey: .project)
        source = try container.decode(String.self, forKey: .source)
        labels = try container.decode([String].self, forKey: .labels)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        description = try container.decode(String.self, forKey: .description)
        closedAt = try container.decodeIfPresent(String.self, forKey: .closedAt)
        agentState = try container.decodeIfPresent(String.self, forKey: .agentState)
        // Backend sends isPinned; fall back to pinned for compatibility
        pinned = try container.decodeIfPresent(Bool.self, forKey: .isPinned)
            ?? container.decodeIfPresent(Bool.self, forKey: .pinned)
        // Gracefully skip malformed dependency objects instead of failing the entire decode
        if let rawDeps = try? container.decode([BeadDependency].self, forKey: .dependencies) {
            dependencies = rawDeps
        } else if let looseDeps = try? container.decode([LooseBeadDependency].self, forKey: .dependencies) {
            dependencies = looseDeps.compactMap { $0.toBeadDependency() }
        } else {
            dependencies = []
        }
    }

    // Shared date formatters (avoid per-call allocation — adj-6yp4.1)
    private static let isoFormatterFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoFormatterBasic = ISO8601DateFormatter()

    /// Parse the createdAt timestamp into a Date
    public var createdDate: Date? {
        Self.isoFormatterFractional.date(from: createdAt)
            ?? Self.isoFormatterBasic.date(from: createdAt)
    }

    /// Parse the updatedAt timestamp into a Date
    public var updatedDate: Date? {
        guard let updatedAt else { return nil }
        return Self.isoFormatterFractional.date(from: updatedAt)
            ?? Self.isoFormatterBasic.date(from: updatedAt)
    }

    /// Parse the closedAt timestamp into a Date
    public var closedDate: Date? {
        guard let closedAt else { return nil }
        return Self.isoFormatterFractional.date(from: closedAt)
            ?? Self.isoFormatterBasic.date(from: closedAt)
    }

    /// Dependencies where this bead blocks another (other beads depend on this one)
    public var blocksDeps: [BeadDependency] {
        dependencies.filter { $0.type == "blocks" }
    }

    /// Dependencies where this bead is blocked by another
    public var blockedByDeps: [BeadDependency] {
        dependencies.filter { $0.type == "blocked_by" }
    }

    /// Derive parent epic ID from bead ID hierarchy.
    /// e.g., "adj-001.1.2" → "adj-001.1", "adj-001.1" → "adj-001"
    public var parentEpicId: String? {
        guard let lastDot = id.lastIndex(of: ".") else { return nil }
        return String(id[id.startIndex..<lastDot])
    }

    /// Get priority as MessagePriority enum
    public var priorityLevel: MessagePriority? {
        MessagePriority(rawValue: priority)
    }

    /// Convert to BeadInfo for compatibility
    public var asBeadInfo: BeadInfo {
        BeadInfo(
            id: id, title: title, description: description, status: status,
            priority: priority, type: type, assignee: assignee, project: project,
            source: source, labels: labels, createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

// MARK: - Bead Source

/// A bead source represents a project directory that contains beads.
/// Returned by GET /api/beads/sources.
public struct BeadSource: Codable, Identifiable, Equatable {
    /// Display name (project name)
    public let name: String
    /// Absolute path to the working directory
    public let path: String
    /// Whether this directory has beads
    public let hasBeads: Bool

    public var id: String { name }

    public init(name: String, path: String, hasBeads: Bool) {
        self.name = name
        self.path = path
        self.hasBeads = hasBeads
    }
}

/// Response from GET /api/beads/sources
public struct BeadSourcesResponse: Codable, Equatable {
    /// Available bead sources
    public let sources: [BeadSource]
    /// Current operating mode
    public let mode: String

    public init(sources: [BeadSource], mode: String) {
        self.sources = sources
        self.mode = mode
    }
}

// MARK: - Agent Summary (for Widget & Live Activity)

/// Lightweight agent summary for widget and Live Activity display.
public struct AgentSummary: Codable, Hashable {
    /// Agent callsign
    public let name: String
    /// Agent status: "working", "blocked", "idle"
    public let status: String

    public init(name: String, status: String) {
        self.name = name
        self.status = status
    }
}

// MARK: - Bead Summary (for Widget & Live Activity)

/// Lightweight bead summary for widget and Live Activity display.
public struct BeadSummary: Codable, Hashable {
    /// Bead identifier
    public let id: String
    /// Bead title
    public let title: String
    /// Short assignee name (callsign only, no project prefix)
    public let assignee: String?

    public init(id: String, title: String, assignee: String?) {
        self.id = id
        self.title = title
        self.assignee = assignee
    }
}

// MARK: - Graph API Types

/// A node in the beads dependency graph, as returned by GET /api/beads/graph.
/// Contains essential bead info needed for visualization.
public struct GraphNodeInfo: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let title: String
    public let status: String
    public let type: String
    public let priority: Int
    public let assignee: String?
    public let source: String?

    public init(
        id: String,
        title: String,
        status: String,
        type: String,
        priority: Int,
        assignee: String?,
        source: String?
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.type = type
        self.priority = priority
        self.assignee = assignee
        self.source = source
    }
}

/// A dependency edge between two beads in the graph.
/// issueId depends on dependsOnId.
public struct GraphEdgeInfo: Codable, Identifiable, Equatable, Hashable {
    public let issueId: String
    public let dependsOnId: String
    public let type: String

    public var id: String { "\(issueId)-\(dependsOnId)" }

    public init(issueId: String, dependsOnId: String, type: String) {
        self.issueId = issueId
        self.dependsOnId = dependsOnId
        self.type = type
    }
}

/// Response from GET /api/beads/graph.
public struct BeadsGraphResponse: Codable, Equatable {
    public let nodes: [GraphNodeInfo]
    public let edges: [GraphEdgeInfo]

    public init(nodes: [GraphNodeInfo], edges: [GraphEdgeInfo]) {
        self.nodes = nodes
        self.edges = edges
    }
}

// MARK: - Epic with Server-Computed Progress

/// Response from GET /api/beads/epics-with-progress.
/// Epic progress computed server-side using the dependency graph.
public struct EpicWithProgressResponse: Codable, Identifiable, Equatable {
    /// The epic bead info
    public let epic: BeadInfo
    /// Child beads (empty in list view, populated in detail view)
    public let children: [BeadInfo]
    /// Total number of children
    public let totalCount: Int
    /// Number of closed children
    public let closedCount: Int
    /// Progress as a decimal (0-1)
    public let progress: Double

    public var id: String { epic.id }

    public init(epic: BeadInfo, children: [BeadInfo], totalCount: Int, closedCount: Int, progress: Double) {
        self.epic = epic
        self.children = children
        self.totalCount = totalCount
        self.closedCount = closedCount
        self.progress = progress
    }
}

// MARK: - Transferable for Drag & Drop

extension BeadInfo: Transferable {
    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .json)
    }
}
