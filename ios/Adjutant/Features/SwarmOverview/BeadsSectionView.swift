import SwiftUI
import AdjutantKit

/// Beads section for the Swarm Overview — shows beads grouped by status.
struct BeadsSectionView: View {
    let beads: BeadsOverview
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
            beadGroup(
                label: "IN PROGRESS",
                items: beads.inProgress,
                statusDot: .success,
                dimmed: false
            )
            beadGroup(
                label: "OPEN",
                items: beads.open,
                statusDot: .info,
                dimmed: false
            )
            beadGroup(
                label: "RECENTLY CLOSED",
                items: beads.recentlyClosed,
                statusDot: .offline,
                dimmed: true
            )
        }
    }

    // MARK: - Group

    @ViewBuilder
    private func beadGroup(
        label: String,
        items: [OverviewBeadSummary],
        statusDot: BadgeView.Style.StatusType,
        dimmed: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Group header
            HStack(spacing: CRTTheme.Spacing.xs) {
                Circle()
                    .fill(statusDot.color)
                    .frame(width: 6, height: 6)
                CRTText(label, style: .caption, color: theme.dim)
                Spacer()
                CRTText("\(items.count)", style: .caption, color: theme.dim.opacity(0.6))
            }

            if items.isEmpty {
                CRTText("No beads \(label.lowercased())", style: .caption, color: theme.dim.opacity(0.4))
                    .padding(.leading, CRTTheme.Spacing.sm)
            } else {
                VStack(spacing: CRTTheme.Spacing.xxs) {
                    ForEach(items) { bead in
                        beadRow(bead, dimmed: dimmed)
                    }
                }
            }
        }
    }

    // MARK: - Bead Row

    @ViewBuilder
    private func beadRow(_ bead: OverviewBeadSummary, dimmed: Bool) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
            // Top line: ID + title
            HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
                CRTText(bead.id, style: .caption, color: theme.dim.opacity(dimmed ? 0.4 : 0.7))
                CRTText(bead.title, style: .body, color: dimmed ? theme.dim : theme.primary)
                    .lineLimit(2)
            }

            // Bottom line: badges + metadata
            HStack(spacing: CRTTheme.Spacing.xs) {
                BadgeView(bead.type.uppercased(), style: .tag)
                BadgeView("P\(bead.priority)", style: .priority(bead.priority))

                if let assignee = bead.assignee {
                    CRTText(assignee, style: .caption, color: theme.dim)
                }

                Spacer()

                if bead.status == "closed", bead.closedAt != nil {
                    CRTText("✓", style: .caption, color: CRTTheme.State.success)
                }

                CRTText(relativeTime(from: bead.updatedAt ?? bead.createdAt), style: .caption, color: theme.dim.opacity(0.5))
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(CRTTheme.Background.panel.opacity(dimmed ? 0.2 : 0.4))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(dimmed ? 0.1 : 0.2), lineWidth: 1)
        )
        .opacity(dimmed ? 0.7 : 1.0)
    }

    // MARK: - Helpers

    private func relativeTime(from dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        // Try with fractional seconds first, then without
        guard let date = formatter.date(from: dateString) ?? {
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: dateString)
        }() else {
            return dateString
        }

        let interval = Date().timeIntervalSince(date)
        let seconds = Int(interval)

        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        if seconds < 86400 { return "\(seconds / 3600)h ago" }
        return "\(seconds / 86400)d ago"
    }
}
