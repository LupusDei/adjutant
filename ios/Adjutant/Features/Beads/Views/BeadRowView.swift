import SwiftUI
import AdjutantKit

/// A row view displaying a single bead in the list.
struct BeadRowView: View {
    @Environment(\.crtTheme) private var theme
    let bead: BeadInfo
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                statusIndicator

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    // Title row
                    titleRow

                    // Metadata row
                    metadataRow
                }

                Spacer(minLength: 0)

                // Priority badge
                priorityBadge
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .background(theme.background.panel)
            .overlay(
                Rectangle()
                    .stroke(theme.primary.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Double tap to view details")
    }

    // MARK: - Subviews

    private var statusIndicator: some View {
        StatusDot(statusType, size: 10, pulse: bead.status == "in_progress")
    }

    private var titleRow: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            // ID badge
            Text(bead.id)
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
                .lineLimit(1)

            // Type badge
            BadgeView(bead.type.uppercased(), style: .tag)
        }
    }

    private var metadataRow: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
            // Title
            Text(bead.title)
                .font(CRTTheme.Typography.font(size: 14, weight: .medium))
                .foregroundColor(theme.primary)
                .lineLimit(2)
                .crtGlow(color: theme.primary, radius: 2, intensity: 0.2)

            // Assignee and labels
            HStack(spacing: CRTTheme.Spacing.xs) {
                if let assignee = bead.assignee, !assignee.isEmpty {
                    HStack(spacing: CRTTheme.Spacing.xxxs) {
                        Image(systemName: "person.fill")
                            .font(.system(size: 9))
                        Text(formatAssignee(assignee))
                            .font(CRTTheme.Typography.font(size: 10))
                    }
                    .foregroundColor(theme.dim)
                }

                if !bead.labels.isEmpty {
                    Text(bead.labels.prefix(2).joined(separator: ", "))
                        .font(CRTTheme.Typography.font(size: 10))
                        .foregroundColor(theme.dim.opacity(0.7))
                        .lineLimit(1)
                }
            }
        }
    }

    private var priorityBadge: some View {
        VStack(alignment: .trailing, spacing: CRTTheme.Spacing.xxs) {
            BadgeView("P\(bead.priority)", style: .priority(bead.priority))

            // Status text
            Text(displayStatus.uppercased().replacingOccurrences(of: "_", with: " "))
                .font(CRTTheme.Typography.font(size: 9, weight: .medium))
                .foregroundColor(statusType.color)
        }
    }

    // MARK: - Helpers

    /// Effective status for display — hooked is shown as in_progress.
    private var displayStatus: String {
        if bead.status.lowercased() == "hooked" {
            return "in_progress"
        }
        return bead.status
    }

    /// Valid statuses: open, hooked, in_progress, closed
    private var statusType: BadgeView.Style.StatusType {
        switch displayStatus.lowercased() {
        case "closed":
            return .offline
        case "hooked", "in_progress":
            return .info
        case "open":
            return .success
        default:
            return .success
        }
    }

    private func formatAssignee(_ assignee: String) -> String {
        // Extract last component (e.g., "adjutant/agents/flint" -> "flint")
        let components = assignee.split(separator: "/")
        if let last = components.last {
            return String(last)
        }
        return assignee
    }

    private var accessibilityLabel: String {
        var label = "\(bead.title), \(bead.type), priority \(bead.priority), status \(bead.status)"
        if let assignee = bead.assignee {
            label += ", assigned to \(formatAssignee(assignee))"
        }
        return label
    }
}

// MARK: - Preview

#Preview("Bead Row - Open") {
    VStack(spacing: 0) {
        BeadRowView(
            bead: BeadInfo(
                id: "adj-001",
                title: "Implement Beads Tracker View with filtering and search",
                status: "in_progress",
                priority: 1,
                type: "feature",
                assignee: "adjutant/agents/flint",
                rig: "adjutant",
                source: "adjutant",
                labels: ["ios", "feature"],
                createdAt: "2026-01-25T10:00:00Z",
                updatedAt: nil
            ),
            onTap: {}
        )

        BeadRowView(
            bead: BeadInfo(
                id: "adj-002",
                title: "Fix critical bug",
                status: "open",
                priority: 0,
                type: "bug",
                assignee: nil,
                rig: "adjutant",
                source: "adjutant",
                labels: ["urgent"],
                createdAt: "2026-01-25T08:00:00Z",
                updatedAt: nil
            ),
            onTap: {}
        )

        BeadRowView(
            bead: BeadInfo(
                id: "adj-004",
                title: "Completed feature",
                status: "closed",
                priority: 3,
                type: "feature",
                assignee: "adjutant/crew/bob",
                rig: "adjutant",
                source: "adjutant",
                labels: ["done"],
                createdAt: "2026-01-20T10:00:00Z",
                updatedAt: "2026-01-22T17:00:00Z"
            ),
            onTap: {}
        )
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
