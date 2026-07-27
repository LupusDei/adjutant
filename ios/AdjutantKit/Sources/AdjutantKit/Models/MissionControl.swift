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

    /// The project's in-progress epics/features, each with its own completion, agents,
    /// and ``FeatureRollup/activityLevel`` (epic adj-209, US2). Empty when the backend
    /// emits no `features` key (old adj-208 payloads) or the project has none.
    public let features: [FeatureRollup]

    /// Composite agentic-intensity for the whole project, normalized `0...1`
    /// (active agents + recent `report_progress` cadence + in-progress bead count).
    /// Drives the "busier = hotter" map encoding. Defaults to `0` when absent.
    public let activityLevel: Double

    /// Uncapped count of active agents on this project (adj-209 removes the old 5-dot
    /// cap). Falls back to `agents.count` when the backend omits the key.
    public let agentCount: Int

    /// `true` when this project's rollup was served from stale/partial data (e.g. a
    /// cold-dolt "degraded" read). The map surfaces a degraded indicator rather than
    /// implying the (possibly empty) counts are authoritative. Defaults to `false`.
    public let degraded: Bool

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
        status: String,
        features: [FeatureRollup] = [],
        activityLevel: Double = 0,
        agentCount: Int? = nil,
        degraded: Bool = false
    ) {
        self.projectId = projectId
        self.name = name
        self.activeEpic = activeEpic
        self.epicsRemaining = epicsRemaining
        self.openBeadsRemaining = openBeadsRemaining
        self.agents = agents
        self.status = status
        self.features = features
        self.activityLevel = activityLevel
        // Uncapped count; when unspecified, the assigned-agent list is the best proxy.
        self.agentCount = agentCount ?? agents.count
        self.degraded = degraded
    }

    private enum CodingKeys: String, CodingKey {
        case projectId, name, activeEpic, epicsRemaining, openBeadsRemaining
        case agents, status, features, activityLevel, agentCount, degraded
    }

    /// Tolerant decode: the adj-209 fields (`features`, `activityLevel`, `agentCount`)
    /// are ADDITIVE, so a payload without them (old adj-208 shape, or a partial rollout)
    /// still decodes — `features` → `[]`, `activityLevel` → `0`, `agentCount` →
    /// `agents.count`. Unknown keys are ignored by `KeyedDecodingContainer`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectId = try c.decode(String.self, forKey: .projectId)
        name = try c.decode(String.self, forKey: .name)
        activeEpic = try c.decodeIfPresent(ActiveEpic.self, forKey: .activeEpic)
        epicsRemaining = try c.decodeIfPresent(Int.self, forKey: .epicsRemaining) ?? 0
        openBeadsRemaining = try c.decodeIfPresent(Int.self, forKey: .openBeadsRemaining) ?? 0
        let decodedAgents = try c.decodeIfPresent([ProjectAgent].self, forKey: .agents) ?? []
        agents = decodedAgents
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ProjectRollupStatus.unknown.rawValue
        features = try c.decodeIfPresent([FeatureRollup].self, forKey: .features) ?? []
        activityLevel = try c.decodeIfPresent(Double.self, forKey: .activityLevel) ?? 0
        agentCount = try c.decodeIfPresent(Int.self, forKey: .agentCount) ?? decodedAgents.count
        degraded = try c.decodeIfPresent(Bool.self, forKey: .degraded) ?? false
    }
}

// MARK: - FeatureRollup

/// One in-progress feature/epic node inside a project stream (epic adj-209, US2).
///
/// Each node carries its own completion, the agents working it, a coordination
/// ``status``, and a composite ``activityLevel`` (`0...1`) that drives the map's
/// per-feature "busier = hotter" encoding (thickness/brightness, flow speed, glow).
/// Shares ``ProjectAgent`` and ``ProjectRollupStatus`` with the project rollup so the
/// map renders project- and feature-level markers identically.
public struct FeatureRollup: Codable, Equatable, Identifiable {
    /// Feature/epic bead id (e.g. `"adj-209.2"`), also the `Identifiable` id.
    public let id: String
    public let title: String
    /// Completion of the feature's children as an integer percent, 0–100.
    /// (Typed `Double` to tolerate drift and feed the completion-ring math directly.)
    public let completionPercent: Double
    public let closedChildren: Int
    public let totalChildren: Int
    /// Agents currently working this feature node.
    public let agents: [ProjectAgent]
    /// Composite agentic-intensity for this feature, normalized `0...1`.
    public let activityLevel: Double
    /// Raw coordination status; prefer ``statusKind`` for branching.
    public let status: String

    /// Typed, defensive view of ``status`` — unknown raw values map to ``ProjectRollupStatus/unknown``.
    public var statusKind: ProjectRollupStatus {
        ProjectRollupStatus(rawValue: status) ?? .unknown
    }

    public init(
        id: String,
        title: String,
        completionPercent: Double,
        closedChildren: Int,
        totalChildren: Int,
        agents: [ProjectAgent],
        activityLevel: Double,
        status: String
    ) {
        self.id = id
        self.title = title
        self.completionPercent = completionPercent
        self.closedChildren = closedChildren
        self.totalChildren = totalChildren
        self.agents = agents
        self.activityLevel = activityLevel
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, completionPercent, closedChildren, totalChildren
        case agents, activityLevel, status
    }

    /// Tolerant decode: `id` is required (a node needs identity); every other field
    /// defaults so a partial payload never throws and unknown keys are ignored.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        completionPercent = try c.decodeIfPresent(Double.self, forKey: .completionPercent) ?? 0
        closedChildren = try c.decodeIfPresent(Int.self, forKey: .closedChildren) ?? 0
        totalChildren = try c.decodeIfPresent(Int.self, forKey: .totalChildren) ?? 0
        agents = try c.decodeIfPresent([ProjectAgent].self, forKey: .agents) ?? []
        activityLevel = try c.decodeIfPresent(Double.self, forKey: .activityLevel) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ProjectRollupStatus.unknown.rawValue
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
    /// Completion of the epic's children as an integer percent, 0–100.
    /// (Backend emits `Math.round(fraction * 100)`; typed as `Double` to tolerate drift
    /// and to feed the map's completion-ring math directly — divide by 100 for a fraction.)
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
    /// Portfolio completion as an integer percent, 0–100 (mean of active epics'
    /// `completionPercent`; 0 when no epic is active). Typed as `Double` to tolerate drift.
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
