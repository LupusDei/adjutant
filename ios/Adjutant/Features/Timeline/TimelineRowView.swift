import SwiftUI
import AdjutantKit

/// A row displaying a single timeline event.
struct TimelineRowView: View {
    @Environment(\.crtTheme) private var theme

    let event: TimelineEvent

    var body: some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
            // Event type icon
            eventIcon

            // Content
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                // Top row: agent + event type badge
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text(formatAgentName(event.agentId))
                        .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                        .foregroundColor(theme.primary)
                        .lineLimit(1)

                    BadgeView(eventTypeLabel.uppercased(), style: .tag)

                    Spacer(minLength: 0)

                    // Timestamp
                    Text(formatTimestamp(event.createdAt))
                        .font(CRTTheme.Typography.font(size: 10))
                        .foregroundColor(theme.dim.opacity(0.7))
                }

                // Action text
                Text(event.action)
                    .font(CRTTheme.Typography.font(size: 13))
                    .foregroundColor(theme.primary.opacity(0.85))
                    .lineLimit(3)

                // Bead reference
                if let beadId = event.beadId {
                    HStack(spacing: CRTTheme.Spacing.xxxs) {
                        Image(systemName: "link")
                            .font(.system(size: 9))
                        Text(beadId)
                            .font(CRTTheme.Typography.font(size: 10))
                    }
                    .foregroundColor(theme.dim)
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.panel)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.1)),
            alignment: .bottom
        )
    }

    // MARK: - Event Icon

    private var eventIcon: some View {
        Image(systemName: iconName)
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(iconColor)
            .frame(width: 28, height: 28)
            .background(
                Circle()
                    .fill(iconColor.opacity(0.12))
            )
            .crtGlow(color: iconColor, radius: 3, intensity: 0.3)
    }

    private var iconName: String {
        switch event.eventType {
        case "status_change": return "arrow.triangle.2.circlepath"
        case "progress_report": return "chart.bar.fill"
        case "announcement": return "megaphone.fill"
        case "message_sent": return "envelope.fill"
        case "bead_updated": return "circle.grid.3x3"
        case "bead_closed": return "checkmark.circle.fill"
        default: return "circle.fill"
        }
    }

    private var iconColor: Color {
        switch event.eventType {
        case "status_change": return theme.primary
        case "progress_report": return CRTTheme.State.info
        case "announcement": return CRTTheme.State.warning
        case "message_sent": return theme.primary
        case "bead_updated": return CRTTheme.State.info
        case "bead_closed": return CRTTheme.State.success
        default: return theme.dim
        }
    }

    private var eventTypeLabel: String {
        switch event.eventType {
        case "status_change": return "STATUS"
        case "progress_report": return "PROGRESS"
        case "announcement": return "ANNOUNCE"
        case "message_sent": return "MESSAGE"
        case "bead_updated": return "BEAD"
        case "bead_closed": return "CLOSED"
        default: return event.eventType
        }
    }

    // MARK: - Formatting

    private func formatAgentName(_ agentId: String) -> String {
        // Extract last component (e.g., "adjutant/polecats/flint" -> "flint")
        let components = agentId.split(separator: "/")
        if let last = components.last {
            return String(last).uppercased()
        }
        return agentId.uppercased()
    }

    private static let dateFormatterWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let dateFormatterBasic = ISO8601DateFormatter()

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    private func formatTimestamp(_ timestamp: String) -> String {
        let date = Self.dateFormatterWithFractional.date(from: timestamp)
            ?? Self.dateFormatterBasic.date(from: timestamp)
        guard let date else { return timestamp }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Preview

#Preview("Timeline Row") {
    VStack(spacing: 0) {
        TimelineRowView(
            event: TimelineEvent(
                id: "evt-001",
                eventType: "status_change",
                agentId: "ios-timeline",
                action: "Status changed to working on adj-028.3",
                detail: ["status": .string("working")],
                createdAt: "2026-02-28T10:00:00Z"
            )
        )
        TimelineRowView(
            event: TimelineEvent(
                id: "evt-002",
                eventType: "announcement",
                agentId: "web-timeline",
                action: "Completed adj-028.2.1: Created TimelinePanel component",
                createdAt: "2026-02-28T09:45:00Z"
            )
        )
        TimelineRowView(
            event: TimelineEvent(
                id: "evt-003",
                eventType: "bead_closed",
                agentId: "backend-timeline",
                action: "Closed bead adj-028.1.6",
                beadId: "adj-028.1.6",
                createdAt: "2026-02-28T09:30:00Z"
            )
        )
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
