import SwiftUI
import AdjutantKit

/// A 4-column Kanban board for displaying beads across workflow stages.
/// Columns: OPEN -> HOOKED -> IN PROGRESS -> CLOSED
/// Supports drag-and-drop between columns with optimistic updates.
struct KanbanBoardView: View {
    @Environment(\.crtTheme) private var theme
    let beads: [BeadInfo]
    let draggingBeadId: String?
    let targetColumnId: KanbanColumnId?
    let onBeadTap: (BeadInfo) -> Void
    let onDrop: (BeadInfo, KanbanColumnId) -> Void

    /// Always true — swarm mode is the only deployment mode now
    private let isSwarm = true

    /// Groups beads into columns based on their status.
    /// In Swarm mode, hooked beads are mapped to inProgress.
    private var columns: [KanbanColumn] {
        let definitions = getKanbanColumns(isSwarm: isSwarm)
        return definitions.map { definition in
            let columnBeads = beads.filter { bead in
                mapStatusToColumn(bead.status, isSwarm: isSwarm) == definition.id
            }
            return KanbanColumn(
                id: definition.id,
                title: definition.title,
                beads: columnBeads,
                color: definition.color
            )
        }
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
                    ForEach(columns) { column in
                        KanbanColumnView(
                            column: KanbanColumnDefinition(
                                id: column.id,
                                title: column.title,
                                color: column.color
                            ),
                            beads: column.beads,
                            draggingBeadId: draggingBeadId,
                            isDropTarget: targetColumnId == column.id && draggingBeadId != nil,
                            onBeadTap: onBeadTap,
                            onDrop: { bead in
                                onDrop(bead, column.id)
                            }
                        )
                        .frame(width: columnWidth(for: geometry.size))
                    }
                }
                .padding(CRTTheme.Spacing.xs)
            }
        }
    }

    /// Calculates column width based on available space.
    /// On larger screens (iPad), shows more columns. On iPhone, shows ~2-3 columns.
    private func columnWidth(for size: CGSize) -> CGFloat {
        let definitions = getKanbanColumns(isSwarm: isSwarm)
        let availableWidth = size.width - (CRTTheme.Spacing.xs * 2)
        let columnCount = CGFloat(definitions.count)
        let spacing = CRTTheme.Spacing.xs * (columnCount - 1)

        // On iPhone (< 600pt width), show ~1.7 columns to hint scrolling
        // On iPad (>= 600pt), show more columns
        if size.width < 600 {
            let visibleColumns: CGFloat = 1.7
            return (availableWidth - (CRTTheme.Spacing.xs * (visibleColumns - 1))) / visibleColumns
        } else {
            // Show up to ~3.3 columns on iPad
            let visibleColumns = min(3.3, columnCount)
            return (availableWidth - (CRTTheme.Spacing.xs * (visibleColumns - 1))) / visibleColumns
        }
    }
}

// MARK: - Preview

#Preview("Kanban Board") {
    KanbanBoardView(
        beads: [
            BeadInfo(
                id: "adj-001",
                title: "Implement feature",
                status: "open",
                priority: 1,
                type: "feature",
                assignee: "adjutant/polecats/flint",
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T10:00:00Z",
                updatedAt: nil
            ),
            BeadInfo(
                id: "adj-002",
                title: "Fix bug",
                status: "in_progress",
                priority: 0,
                type: "bug",
                assignee: nil,
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T08:00:00Z",
                updatedAt: nil
            ),
            BeadInfo(
                id: "adj-003",
                title: "Write tests",
                status: "open",
                priority: 2,
                type: "task",
                assignee: nil,
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T06:00:00Z",
                updatedAt: nil
            ),
            BeadInfo(
                id: "adj-005",
                title: "Deploy to staging",
                status: "closed",
                priority: 3,
                type: "task",
                assignee: nil,
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T02:00:00Z",
                updatedAt: nil
            )
        ],
        draggingBeadId: nil,
        targetColumnId: nil,
        onBeadTap: { _ in },
        onDrop: { _, _ in }
    )
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
