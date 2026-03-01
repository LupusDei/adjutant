import Foundation

/// Type classification for proposals.
public enum ProposalType: String, Codable, CaseIterable, Sendable {
    case product
    case engineering
}

/// Status lifecycle for proposals.
public enum ProposalStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case accepted
    case dismissed
    case completed
}

/// A proposal submitted by an agent for review.
public struct Proposal: Codable, Identifiable, Equatable, Sendable {
    /// Unique identifier (UUID)
    public let id: String
    /// Agent who authored the proposal
    public let author: String
    /// Proposal title
    public let title: String
    /// Detailed description of the proposal
    public let description: String
    /// Classification: product or engineering
    public let type: ProposalType
    /// Current status in the review lifecycle
    public let status: ProposalStatus
    /// ISO 8601 creation timestamp
    public let createdAt: String
    /// ISO 8601 last-update timestamp
    public let updatedAt: String

    public init(
        id: String,
        author: String,
        title: String,
        description: String,
        type: ProposalType,
        status: ProposalStatus,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.author = author
        self.title = title
        self.description = description
        self.type = type
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Parse the createdAt timestamp into a Date
    public var createdDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: createdAt) ?? ISO8601DateFormatter().date(from: createdAt)
    }

    /// Display-friendly relative date string
    public var relativeDate: String {
        guard let date = createdDate else { return createdAt }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

/// Request body for updating a proposal's status.
public struct UpdateProposalStatusRequest: Encodable, Sendable {
    /// The new status to set
    public let status: ProposalStatus

    public init(status: ProposalStatus) {
        self.status = status
    }
}
