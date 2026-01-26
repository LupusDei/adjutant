import SwiftUI
import AdjutantKit

/// A draggable card view for displaying a bead in the Kanban board.
/// Matches the frontend KanbanCard.tsx component with Pip-Boy terminal aesthetic.
struct KanbanCardView: View {
    @Environment(\.crtTheme) private var theme

    let bead: BeadInfo
    let isDragging: Bool

    init(bead: BeadInfo, isDragging: Bool = false) {
        self.bead = bead
        self.isDragging = isDragging
    }

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            // Header: ID + Priority
            headerRow

            // Title
            titleText

            // Footer: Type + Assignee
            footerRow
        }
        .padding(CRTTheme.Spacing.xs)
        .background(CRTTheme.Background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.dim.opacity(0.5), lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.sm)
        .opacity(isDragging ? 0.5 : 1.0)
        .crtGlow(
            color: theme.primary,
            radius: isDragging ? 10 : 0,
            intensity: isDragging ? 0.6 : 0
        )
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isDragging)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Subviews

    private var headerRow: some View {
        HStack {
            // Bead ID
            Text(bead.id)
                .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                .foregroundColor(theme.bright)
                .tracking(CRTTheme.Typography.letterSpacing)

            Spacer()

            // Priority badge
            Text(priorityLabel)
                .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                .foregroundColor(priorityColor)
        }
    }

    private var titleText: some View {
        Text(bead.title)
            .font(CRTTheme.Typography.font(size: 11, weight: .medium))
            .foregroundColor(theme.primary)
            .lineLimit(2)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, CRTTheme.Spacing.xxxs)
    }

    private var footerRow: some View {
        HStack {
            // Type
            Text(bead.type.uppercased())
                .font(CRTTheme.Typography.font(size: 9))
                .foregroundColor(theme.dim)
                .tracking(CRTTheme.Typography.letterSpacing)

            Spacer()

            // Assignee
            if let assignee = formatAssignee(bead.assignee) {
                Text(assignee)
                    .font(CRTTheme.Typography.font(size: 9))
                    .foregroundColor(theme.primary)
                    .padding(.horizontal, CRTTheme.Spacing.xxs)
                    .padding(.vertical, 1)
                    .background(theme.primary.opacity(0.1))
                    .cornerRadius(CRTTheme.CornerRadius.sm)
            }
        }
    }

    // MARK: - Helpers

    private var priorityLabel: String {
        "P\(bead.priority)"
    }

    private var priorityColor: Color {
        switch bead.priority {
        case 0:
            return CRTTheme.Priority.urgent       // #FF4444
        case 1:
            return CRTTheme.Priority.high         // #FFB000
        case 2:
            return theme.primary                  // Theme green
        case 3:
            return theme.dim                      // Dim theme
        default:
            return CRTTheme.Priority.lowest       // #666666
        }
    }

    private func formatAssignee(_ assignee: String?) -> String? {
        guard let assignee, !assignee.isEmpty else { return nil }
        let parts = assignee.split(separator: "/")
        return parts.last.map(String.init) ?? assignee
    }

    private var accessibilityLabel: String {
        var label = "\(bead.title), \(bead.type), priority \(bead.priority)"
        if let assignee = bead.assignee {
            label += ", assigned to \(formatAssignee(assignee) ?? assignee)"
        }
        if isDragging {
            label += ", dragging"
        }
        return label
    }
}

// MARK: - Preview

#Preview("KanbanCard - Normal") {
    VStack(spacing: 8) {
        KanbanCardView(
            bead: BeadInfo(
                id: "adj-001",
                title: "Implement Beads Tracker View with filtering and search",
                status: "in_progress",
                priority: 1,
                type: "feature",
                assignee: "adjutant/polecats/flint",
                rig: "adjutant",
                source: "adjutant",
                labels: ["ios", "feature"],
                createdAt: "2026-01-25T10:00:00Z",
                updatedAt: nil
            )
        )

        KanbanCardView(
            bead: BeadInfo(
                id: "adj-002",
                title: "Fix critical bug",
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
        )

        KanbanCardView(
            bead: BeadInfo(
                id: "hq-003",
                title: "Low priority task with a very long title that should wrap to two lines",
                status: "backlog",
                priority: 4,
                type: "task",
                assignee: "adjutant/crew/bob",
                rig: nil,
                source: "town",
                labels: [],
                createdAt: "2026-01-24T10:00:00Z",
                updatedAt: nil
            )
        )
    }
    .padding()
    .frame(width: 200)
    .background(CRTTheme.Background.screen)
}

#Preview("KanbanCard - Dragging") {
    HStack(spacing: 16) {
        KanbanCardView(
            bead: BeadInfo(
                id: "adj-001",
                title: "Normal card",
                status: "open",
                priority: 2,
                type: "task",
                assignee: "adjutant/polecats/jasper",
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T10:00:00Z",
                updatedAt: nil
            ),
            isDragging: false
        )

        KanbanCardView(
            bead: BeadInfo(
                id: "adj-002",
                title: "Dragging card",
                status: "open",
                priority: 2,
                type: "task",
                assignee: "adjutant/polecats/jasper",
                rig: "adjutant",
                source: "adjutant",
                labels: [],
                createdAt: "2026-01-25T10:00:00Z",
                updatedAt: nil
            ),
            isDragging: true
        )
    }
    .padding()
    .frame(width: 400)
    .background(CRTTheme.Background.screen)
}

#Preview("KanbanCard - All Priorities") {
    VStack(spacing: 8) {
        ForEach(0..<5) { priority in
            KanbanCardView(
                bead: BeadInfo(
                    id: "adj-\(priority)",
                    title: "Priority \(priority) task",
                    status: "open",
                    priority: priority,
                    type: "task",
                    assignee: nil,
                    rig: "adjutant",
                    source: "adjutant",
                    labels: [],
                    createdAt: "2026-01-25T10:00:00Z",
                    updatedAt: nil
                )
            )
        }
    }
    .padding()
    .frame(width: 180)
    .background(CRTTheme.Background.screen)
}
