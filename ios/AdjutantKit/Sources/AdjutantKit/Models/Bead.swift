import Foundation
import UniformTypeIdentifiers
import CoreTransferable

/// A bead (issue/task) in the gastown system
public struct BeadInfo: Codable, Identifiable, Equatable, Hashable {
    /// Bead ID (e.g., "gb-53tj")
    public let id: String
    /// Bead title
    public let title: String
    /// Status (open, closed, etc.)
    public let status: String
    /// Priority (0-4, lower = higher priority)
    public let priority: Int
    /// Issue type (feature, bug, task, etc.)
    public let type: String
    /// Assignee address or null
    public let assignee: String?
    /// Rig name extracted from assignee or null for town-level
    public let rig: String?
    /// Source database: "town" for hq-*, or rig name for rig-specific beads
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
        status: String,
        priority: Int,
        type: String,
        assignee: String?,
        rig: String?,
        source: String,
        labels: [String],
        createdAt: String,
        updatedAt: String?
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.priority = priority
        self.type = type
        self.assignee = assignee
        self.rig = rig
        self.source = source
        self.labels = labels
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Parse the createdAt timestamp into a Date
    public var createdDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: createdAt) ?? ISO8601DateFormatter().date(from: createdAt)
    }

    /// Parse the updatedAt timestamp into a Date
    public var updatedDate: Date? {
        guard let updatedAt else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: updatedAt) ?? ISO8601DateFormatter().date(from: updatedAt)
    }

    /// Get priority as MessagePriority enum
    public var priorityLevel: MessagePriority? {
        MessagePriority(rawValue: priority)
    }
}

// MARK: - Transferable for Drag & Drop

extension BeadInfo: Transferable {
    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .json)
    }
}
