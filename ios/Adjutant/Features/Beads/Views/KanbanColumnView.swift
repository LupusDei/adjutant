import SwiftUI
import AdjutantKit

/// A single column in the Kanban board displaying beads with a specific status.
/// Supports drag-and-drop as a drop target with visual feedback.
struct KanbanColumnView: View {
    @Environment(\.crtTheme) private var theme

    let column: KanbanColumnDefinition
    let beads: [BeadInfo]
    let draggingBeadId: String?
    let isDropTarget: Bool
    let onBeadTap: (BeadInfo) -> Void
    let onDrop: (BeadInfo) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Column header
            headerView

            // Cards container
            cardsContainer
        }
        .background(theme.background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(isDropTarget ? column.color : theme.primary.opacity(0.2), lineWidth: isDropTarget ? 2 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
        .crtGlow(
            color: column.color,
            radius: isDropTarget ? 8 : 0,
            intensity: isDropTarget ? 0.4 : 0
        )
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isDropTarget)
        .dropDestination(for: BeadInfo.self) { items, _ in
            guard let bead = items.first else { return false }
            onDrop(bead)
            return true
        }
    }

    // MARK: - Subviews

    private var headerView: some View {
        HStack {
            // Column title
            Text(column.title)
                .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                .foregroundColor(column.color)
                .tracking(1)

            Spacer()

            // Count badge
            Text("\(beads.count)")
                .font(CRTTheme.Typography.font(size: 9))
                .foregroundColor(theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.xs)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(theme.background.elevated)
        .overlay(
            Rectangle()
                .fill(column.color)
                .frame(height: 2),
            alignment: .bottom
        )
    }

    private var cardsContainer: some View {
        ScrollView {
            if beads.isEmpty {
                emptyState
            } else {
                LazyVStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(beads) { bead in
                        KanbanCardView(
                            bead: bead,
                            isDragging: draggingBeadId == bead.id,
                            onTap: { onBeadTap(bead) }
                        )
                        .draggable(bead) {
                            KanbanCardView(bead: bead, isDragging: true)
                                .frame(width: 150)
                        }
                    }
                }
                .padding(CRTTheme.Spacing.xs)
            }
        }
    }

    private var emptyState: some View {
        Text(isDropTarget ? "DROP HERE" : "EMPTY")
            .font(CRTTheme.Typography.font(size: 9))
            .foregroundColor(isDropTarget ? column.color : theme.dim.opacity(0.5))
            .tracking(1)
            .frame(maxWidth: .infinity)
            .padding(.vertical, CRTTheme.Spacing.lg)
    }
}

// MARK: - Preview

#Preview("Kanban Column") {
    HStack(spacing: CRTTheme.Spacing.xs) {
        KanbanColumnView(
            column: kanbanColumns[1], // OPEN
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
                    title: "Fix bug in auth flow",
                    status: "open",
                    priority: 0,
                    type: "bug",
                    assignee: nil,
                    rig: "adjutant",
                    source: "adjutant",
                    labels: [],
                    createdAt: "2026-01-25T08:00:00Z",
                    updatedAt: nil
                )
            ],
            draggingBeadId: nil,
            isDropTarget: false,
            onBeadTap: { _ in },
            onDrop: { _ in }
        )

        KanbanColumnView(
            column: kanbanColumns[0], // BACKLOG
            beads: [],
            draggingBeadId: "adj-001",
            isDropTarget: true,
            onBeadTap: { _ in },
            onDrop: { _ in }
        )
    }
    .padding()
    .frame(height: 400)
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
