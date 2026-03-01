import Foundation
import SwiftUI

/// Kanban column identifiers matching bead status values.
/// Workflow: open -> hooked -> in_progress -> closed
public enum KanbanColumnId: String, Codable, CaseIterable, Identifiable {
    case open
    case hooked
    case inProgress = "in_progress"
    case closed

    public var id: String { rawValue }
}

/// Column configuration for the Kanban board.
public struct KanbanColumn: Identifiable {
    public let id: KanbanColumnId
    public let title: String
    public var beads: [BeadInfo]
    public let color: Color

    public init(id: KanbanColumnId, title: String, beads: [BeadInfo] = [], color: Color) {
        self.id = id
        self.title = title
        self.beads = beads
        self.color = color
    }
}

/// Column definition without beads, used for configuration.
public struct KanbanColumnDefinition {
    public let id: KanbanColumnId
    public let title: String
    public let color: Color

    public init(id: KanbanColumnId, title: String, color: Color) {
        self.id = id
        self.title = title
        self.color = color
    }
}

/// All column definitions in workflow order with Pip-Boy theme colors.
public let kanbanColumns: [KanbanColumnDefinition] = [
    KanbanColumnDefinition(id: .open, title: "OPEN", color: Color(hex: 0x00FF00)),
    KanbanColumnDefinition(id: .hooked, title: "HOOKED", color: Color(hex: 0x00FFFF)),
    KanbanColumnDefinition(id: .inProgress, title: "IN PROGRESS", color: Color(hex: 0x00FF88)),
    KanbanColumnDefinition(id: .closed, title: "CLOSED", color: Color(hex: 0x444444)),
]

/// Column definitions for Swarm mode (no HOOKED column).
/// Hooked beads are mapped to IN PROGRESS.
public let kanbanColumnsSwarm: [KanbanColumnDefinition] = [
    KanbanColumnDefinition(id: .open, title: "OPEN", color: Color(hex: 0x00FF00)),
    KanbanColumnDefinition(id: .inProgress, title: "IN PROGRESS", color: Color(hex: 0x00FF88)),
    KanbanColumnDefinition(id: .closed, title: "CLOSED", color: Color(hex: 0x444444)),
]

/// Returns the appropriate column definitions based on mode.
public func getKanbanColumns(isSwarm: Bool) -> [KanbanColumnDefinition] {
    return isSwarm ? kanbanColumnsSwarm : kanbanColumns
}

/// Maps bead statuses to Kanban columns.
/// In Swarm mode, hooked maps to inProgress.
public func mapStatusToColumn(_ status: String, isSwarm: Bool = false) -> KanbanColumnId {
    let normalized = status.lowercased()

    switch normalized {
    case "open":
        return .open
    case "hooked":
        return isSwarm ? .inProgress : .hooked
    case "in_progress":
        return .inProgress
    case "closed":
        return .closed
    default:
        return .open  // Unknown statuses default to open
    }
}

// MARK: - Color Extension

extension Color {
    /// Initialize Color from hex value
    init(hex: UInt) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0
        )
    }
}
