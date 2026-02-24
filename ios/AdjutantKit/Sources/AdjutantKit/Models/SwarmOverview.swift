import Foundation

// MARK: - Project Overview Response

/// Aggregated project overview data from GET /api/projects/:id/overview.
/// Provides a single-request snapshot of beads, epics, and agents for a project.
public struct ProjectOverviewResponse: Codable, Equatable {
    public let project: ProjectSummary
    public let beads: BeadsOverview
    public let epics: EpicsOverview
    public let agents: [AgentOverview]

    public init(
        project: ProjectSummary,
        beads: BeadsOverview,
        epics: EpicsOverview,
        agents: [AgentOverview]
    ) {
        self.project = project
        self.beads = beads
        self.epics = epics
        self.agents = agents
    }
}

// MARK: - Project Summary

/// Lightweight project identity for the overview header.
public struct ProjectSummary: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let path: String
    public let active: Bool

    public init(id: String, name: String, path: String, active: Bool) {
        self.id = id
        self.name = name
        self.path = path
        self.active = active
    }
}

// MARK: - Beads Overview

/// Beads grouped by status for the overview dashboard.
public struct BeadsOverview: Codable, Equatable {
    public let open: [OverviewBeadSummary]
    public let inProgress: [OverviewBeadSummary]
    public let recentlyClosed: [OverviewBeadSummary]

    public init(
        open: [OverviewBeadSummary],
        inProgress: [OverviewBeadSummary],
        recentlyClosed: [OverviewBeadSummary]
    ) {
        self.open = open
        self.inProgress = inProgress
        self.recentlyClosed = recentlyClosed
    }
}

/// Bead summary for the project overview.
/// Named `OverviewBeadSummary` to avoid collision with the widget-level `BeadSummary` in Bead.swift.
public struct OverviewBeadSummary: Codable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let status: String
    public let priority: Int
    /// Bead type: "task", "bug", or "epic"
    public let type: String
    public let assignee: String?
    public let createdAt: String
    public let updatedAt: String?
    public let closedAt: String?

    public init(
        id: String,
        title: String,
        status: String,
        priority: Int,
        type: String,
        assignee: String?,
        createdAt: String,
        updatedAt: String? = nil,
        closedAt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.priority = priority
        self.type = type
        self.assignee = assignee
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.closedAt = closedAt
    }
}

// MARK: - Epics Overview

/// Epics grouped by completion state for the overview dashboard.
public struct EpicsOverview: Codable, Equatable {
    public let inProgress: [EpicProgress]
    public let recentlyCompleted: [EpicProgress]

    public init(
        inProgress: [EpicProgress],
        recentlyCompleted: [EpicProgress]
    ) {
        self.inProgress = inProgress
        self.recentlyCompleted = recentlyCompleted
    }
}

/// Epic with child completion progress.
public struct EpicProgress: Codable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let status: String
    public let totalChildren: Int
    public let closedChildren: Int
    /// Completion ratio from 0.0 to 1.0
    public let completionPercent: Double
    public let assignee: String?

    public init(
        id: String,
        title: String,
        status: String,
        totalChildren: Int,
        closedChildren: Int,
        completionPercent: Double,
        assignee: String? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.totalChildren = totalChildren
        self.closedChildren = closedChildren
        self.completionPercent = completionPercent
        self.assignee = assignee
    }
}

// MARK: - Agent Overview

/// Agent summary for the project overview, showing status and current work.
public struct AgentOverview: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    /// Agent status: "working", "idle", "blocked", or "offline"
    public let status: String
    /// Title of the bead the agent is currently working on
    public let currentBead: String?
    public let unreadCount: Int
    public let sessionId: String?

    public init(
        id: String,
        name: String,
        status: String,
        currentBead: String? = nil,
        unreadCount: Int = 0,
        sessionId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.currentBead = currentBead
        self.unreadCount = unreadCount
        self.sessionId = sessionId
    }
}
