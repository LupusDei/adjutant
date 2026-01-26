import SwiftUI
import AdjutantKit

/// A single column in the Kanban board displaying beads with a specific status.
struct KanbanColumnView: View {
    @Environment(\.crtTheme) private var theme

    let column: KanbanColumnDefinition
    let beads: [BeadInfo]
    let onBeadTap: (BeadInfo) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Column header
            headerView

            // Cards container
            cardsContainer
        }
        .background(CRTTheme.Background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
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
        .background(CRTTheme.Background.elevated)
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
                        KanbanCardView(bead: bead, onTap: {
                            onBeadTap(bead)
                        })
                    }
                }
                .padding(CRTTheme.Spacing.xs)
            }
        }
    }

    private var emptyState: some View {
        Text("EMPTY")
            .font(CRTTheme.Typography.font(size: 9))
            .foregroundColor(theme.dim.opacity(0.5))
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
            onBeadTap: { _ in }
        )

        KanbanColumnView(
            column: kanbanColumns[0], // BACKLOG
            beads: [],
            onBeadTap: { _ in }
        )
    }
    .padding()
    .frame(height: 400)
    .background(CRTTheme.Background.screen)
}
