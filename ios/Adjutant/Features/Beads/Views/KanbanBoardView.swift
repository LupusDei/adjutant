import SwiftUI
import AdjutantKit

/// A 7-column Kanban board for displaying beads across workflow stages.
/// Columns: BACKLOG -> OPEN -> IN PROGRESS -> TESTING -> MERGING -> COMPLETE -> CLOSED
struct KanbanBoardView: View {
    @Environment(\.crtTheme) private var theme

    let beads: [BeadInfo]
    let onBeadTap: (BeadInfo) -> Void

    /// Groups beads into columns based on their status
    private var columns: [KanbanColumn] {
        kanbanColumns.map { definition in
            let columnBeads = beads.filter { bead in
                mapStatusToColumn(bead.status) == definition.id
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
                            onBeadTap: onBeadTap
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
        let availableWidth = size.width - (CRTTheme.Spacing.xs * 2)
        let columnCount = CGFloat(kanbanColumns.count)
        let spacing = CRTTheme.Spacing.xs * (columnCount - 1)

        // On iPhone (< 600pt width), show ~2.5 columns to hint scrolling
        // On iPad (>= 600pt), show more columns
        if size.width < 600 {
            let visibleColumns: CGFloat = 2.5
            return (availableWidth - (CRTTheme.Spacing.xs * (visibleColumns - 1))) / visibleColumns
        } else {
            // Show up to 5 columns on iPad
            let visibleColumns = min(5, columnCount)
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
                status: "backlog",
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
                id: "adj-004",
                title: "Code review",
                status: "testing",
                priority: 1,
                type: "task",
                assignee: "adjutant/crew/bob",
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T04:00:00Z",
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
        onBeadTap: { _ in }
    )
    .background(CRTTheme.Background.screen)
}
