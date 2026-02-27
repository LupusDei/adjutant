import Foundation

// MARK: - Dashboard Section Wrapper

/// Wraps a dashboard section so it can independently fail.
/// Each section returns data or an error, never killing the entire response.
public struct DashboardSection<T: Decodable>: Decodable {
    /// Section data, nil if the section failed
    public let data: T?
    /// Error message if the section failed
    public let error: String?

    public init(data: T?, error: String? = nil) {
        self.data = data
        self.error = error
    }
}

// MARK: - Beads

/// A category of beads with capped items and a total count.
public struct DashboardBeadCategory: Codable, Equatable {
    public let items: [BeadInfo]
    public let totalCount: Int

    public init(items: [BeadInfo], totalCount: Int) {
        self.items = items
        self.totalCount = totalCount
    }
}

/// Grouped beads section in the dashboard response.
public struct DashboardBeadsData: Decodable, Equatable {
    public let inProgress: DashboardBeadCategory
    public let open: DashboardBeadCategory
    public let closed: DashboardBeadCategory

    public init(inProgress: DashboardBeadCategory, open: DashboardBeadCategory, closed: DashboardBeadCategory) {
        self.inProgress = inProgress
        self.open = open
        self.closed = closed
    }
}

// MARK: - Epics

/// An epic with server-computed progress (no children array — lighter for dashboard).
public struct DashboardEpicItem: Codable, Identifiable, Equatable {
    public let epic: BeadInfo
    public let totalCount: Int
    public let closedCount: Int
    /// 0–1 decimal
    public let progress: Double

    public var id: String { epic.id }

    public init(epic: BeadInfo, totalCount: Int, closedCount: Int, progress: Double) {
        self.epic = epic
        self.totalCount = totalCount
        self.closedCount = closedCount
        self.progress = progress
    }
}

/// Epic category for dashboard display.
public struct DashboardEpicCategory: Decodable, Equatable {
    public let items: [DashboardEpicItem]
    public let totalCount: Int

    public init(items: [DashboardEpicItem], totalCount: Int) {
        self.items = items
        self.totalCount = totalCount
    }
}

/// Grouped epics section in the dashboard response.
public struct DashboardEpicsData: Decodable, Equatable {
    public let inProgress: DashboardEpicCategory
    public let completed: DashboardEpicCategory

    public init(inProgress: DashboardEpicCategory, completed: DashboardEpicCategory) {
        self.inProgress = inProgress
        self.completed = completed
    }
}

// MARK: - Mail

/// Summarised mail data for the dashboard.
public struct DashboardMailSummary: Decodable, Equatable {
    public let recentMessages: [Message]
    public let totalCount: Int
    public let unreadCount: Int

    public init(recentMessages: [Message], totalCount: Int, unreadCount: Int) {
        self.recentMessages = recentMessages
        self.totalCount = totalCount
        self.unreadCount = unreadCount
    }
}

// MARK: - Unread Messages (grouped by agent)

/// Unread messages from a single agent, for the overview widget.
public struct UnreadAgentSummary: Decodable, Equatable, Identifiable {
    public let agentId: String
    public let unreadCount: Int
    public let latestBody: String
    public let latestCreatedAt: String

    public var id: String { agentId }

    public init(agentId: String, unreadCount: Int, latestBody: String, latestCreatedAt: String) {
        self.agentId = agentId
        self.unreadCount = unreadCount
        self.latestBody = latestBody
        self.latestCreatedAt = latestCreatedAt
    }
}

// MARK: - Full Dashboard Response

/// The complete dashboard payload returned by GET /api/dashboard.
/// Each section is independently nullable so partial backend failures
/// don't kill the entire response.
public struct DashboardResponse: Decodable {
    public let status: DashboardSection<GastownStatus>
    public let beads: DashboardSection<DashboardBeadsData>
    public let crew: DashboardSection<[CrewMember]>
    public let unreadCounts: DashboardSection<[String: Int]>
    public let unreadMessages: DashboardSection<[UnreadAgentSummary]>
    public let epics: DashboardSection<DashboardEpicsData>
    public let mail: DashboardSection<DashboardMailSummary>
    public let timestamp: String

    public init(
        status: DashboardSection<GastownStatus>,
        beads: DashboardSection<DashboardBeadsData>,
        crew: DashboardSection<[CrewMember]>,
        unreadCounts: DashboardSection<[String: Int]>,
        unreadMessages: DashboardSection<[UnreadAgentSummary]>,
        epics: DashboardSection<DashboardEpicsData>,
        mail: DashboardSection<DashboardMailSummary>,
        timestamp: String
    ) {
        self.status = status
        self.beads = beads
        self.crew = crew
        self.unreadCounts = unreadCounts
        self.unreadMessages = unreadMessages
        self.epics = epics
        self.mail = mail
        self.timestamp = timestamp
    }
}
