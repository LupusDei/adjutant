import Foundation

/// A tracked issue within a convoy
public struct TrackedIssue: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let title: String
    public let status: String
    public let assignee: String?
    public let issueType: String?
    public let updatedAt: String?
    public let priority: Int?
    public let description: String?

    public init(
        id: String,
        title: String,
        status: String,
        assignee: String? = nil,
        issueType: String? = nil,
        updatedAt: String? = nil,
        priority: Int? = nil,
        description: String? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.assignee = assignee
        self.issueType = issueType
        self.updatedAt = updatedAt
        self.priority = priority
        self.description = description
    }
}

/// Convoy progress tracking
public struct ConvoyProgress: Codable, Equatable, Hashable {
    public let completed: Int
    public let total: Int

    public init(completed: Int, total: Int) {
        self.completed = completed
        self.total = total
    }

    /// Progress as a percentage (0.0 - 1.0)
    public var percentage: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total)
    }
}

/// A convoy (work package) in the gastown system
public struct Convoy: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public let title: String
    public let status: String
    /// The rig this convoy is associated with, or null for town-level convoys
    public let rig: String?
    public let progress: ConvoyProgress
    public let trackedIssues: [TrackedIssue]

    public init(
        id: String,
        title: String,
        status: String,
        rig: String?,
        progress: ConvoyProgress,
        trackedIssues: [TrackedIssue]
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.rig = rig
        self.progress = progress
        self.trackedIssues = trackedIssues
    }

    /// Check if convoy is complete (only true if there are tasks AND all are complete)
    public var isComplete: Bool {
        progress.total > 0 && progress.completed >= progress.total
    }

    /// Check if convoy has no tracked tasks
    public var hasNoTasks: Bool {
        progress.total == 0
    }
}
