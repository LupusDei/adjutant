import Foundation

// MARK: - Mission Control — Portfolio Rollup (epic adj-208, US2)
//
// Codable mirrors of `GET /api/overview/projects` (US1). One request returns, per
// project, the active epic + completion, remaining open epics/beads, assigned agents,
// and a coordination status; plus portfolio-wide totals. Decoded from the `data` payload
// of the standard `ApiResponse<T>` envelope (envelope-aware — see `ApiResponse`).
//
// The shared `APIClient` decoder is a plain `JSONDecoder()` (no key strategy), so keys
// are camelCase exactly as the backend emits them.

// MARK: - OverviewProjectsResponse

/// Full portfolio rollup: one stream per project plus portfolio totals.
public struct OverviewProjectsResponse: Codable, Equatable {
    /// Per-project coordination streams.
    public let projects: [ProjectStreamRollup]
    /// Portfolio-wide aggregate counters.
    public let totals: PortfolioTotals

    public init(projects: [ProjectStreamRollup], totals: PortfolioTotals) {
        self.projects = projects
        self.totals = totals
    }
}

// MARK: - ProjectStreamRollup

/// A single project's coordination snapshot for the Mission Control map.
///
/// `activeEpic` is `nil` when the project has no in-progress epic. `status` is retained
/// as the raw backend string for forward compatibility; use ``statusKind`` for a typed,
/// exhaustive switch that never crashes on an unrecognized value.
public struct ProjectStreamRollup: Codable, Equatable, Identifiable {
    /// Canonical project UUID (also the `Identifiable` id).
    public let projectId: String
    /// Display name (never used as a lookup key — see Project Identity rules).
    public let name: String
    /// The epic with the most recent in-progress activity; `nil` when none.
    public let activeEpic: ActiveEpic?
    /// Count of open, not-started epics remaining.
    public let epicsRemaining: Int
    /// Count of open beads remaining across the project.
    public let openBeadsRemaining: Int
    /// Agents currently assigned to this project.
    public let agents: [ProjectAgent]
    /// Raw coordination status: `"on_track" | "needs_input" | "blocked"`.
    /// Prefer ``statusKind`` for branching.
    public let status: String

    /// `Identifiable` conformance keyed on the project UUID.
    public var id: String { projectId }

    /// Typed, defensive view of ``status`` — unknown raw values map to ``ProjectRollupStatus/unknown``.
    public var statusKind: ProjectRollupStatus {
        ProjectRollupStatus(rawValue: status) ?? .unknown
    }

    public init(
        projectId: String,
        name: String,
        activeEpic: ActiveEpic?,
        epicsRemaining: Int,
        openBeadsRemaining: Int,
        agents: [ProjectAgent],
        status: String
    ) {
        self.projectId = projectId
        self.name = name
        self.activeEpic = activeEpic
        self.epicsRemaining = epicsRemaining
        self.openBeadsRemaining = openBeadsRemaining
        self.agents = agents
        self.status = status
    }
}

// MARK: - ProjectRollupStatus

/// The coordination beacon state for a project stream.
///
/// Backed by the raw backend strings. Decoding uses the raw ``ProjectStreamRollup/status``
/// string plus this enum's failable initializer, so a future backend value degrades to
/// ``unknown`` rather than throwing (Constitution Rule 1 — tolerate real data drift).
public enum ProjectRollupStatus: String, Equatable, CaseIterable {
    case onTrack = "on_track"
    case needsInput = "needs_input"
    case blocked = "blocked"
    /// Fallback for any value the client does not recognize.
    case unknown
}

// MARK: - ActiveEpic

/// The project's active (most-recently-in-progress) epic with completion progress.
public struct ActiveEpic: Codable, Equatable, Identifiable {
    /// Epic bead id (e.g. `"adj-208"`), also the `Identifiable` id.
    public let id: String
    public let title: String
    /// Completion ratio from 0.0 to 1.0.
    public let completionPercent: Double
    public let closedChildren: Int
    public let totalChildren: Int

    public init(
        id: String,
        title: String,
        completionPercent: Double,
        closedChildren: Int,
        totalChildren: Int
    ) {
        self.id = id
        self.title = title
        self.completionPercent = completionPercent
        self.closedChildren = closedChildren
        self.totalChildren = totalChildren
    }
}

// MARK: - ProjectAgent

/// A minimal agent marker for the map: identity + status only.
public struct ProjectAgent: Codable, Equatable, Identifiable {
    /// Agent id (e.g. `"engineer-ios-data"`), also the `Identifiable` id.
    public let id: String
    /// Agent status string (e.g. `"working" | "idle" | "blocked" | "offline"`).
    public let status: String

    public init(id: String, status: String) {
        self.id = id
        self.status = status
    }
}

// MARK: - PortfolioTotals

/// Portfolio-wide aggregate counters shown in the Mission Control header.
public struct PortfolioTotals: Codable, Equatable {
    public let projects: Int
    public let agentsActive: Int
    public let epicsRemaining: Int
    public let openBeadsRemaining: Int
    public let blocked: Int
    public let needsInput: Int
    /// Portfolio completion ratio from 0.0 to 1.0.
    public let portfolioCompletionPercent: Double

    public init(
        projects: Int,
        agentsActive: Int,
        epicsRemaining: Int,
        openBeadsRemaining: Int,
        blocked: Int,
        needsInput: Int,
        portfolioCompletionPercent: Double
    ) {
        self.projects = projects
        self.agentsActive = agentsActive
        self.epicsRemaining = epicsRemaining
        self.openBeadsRemaining = openBeadsRemaining
        self.blocked = blocked
        self.needsInput = needsInput
        self.portfolioCompletionPercent = portfolioCompletionPercent
    }
}
