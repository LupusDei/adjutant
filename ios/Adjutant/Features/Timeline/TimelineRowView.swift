import SwiftUI
import AdjutantKit

/// A row displaying a single timeline event.
/// Tappable to expand and show event detail when available.
struct TimelineRowView: View {
    @Environment(\.crtTheme) private var theme
    @State private var isExpanded = false

    let event: TimelineEvent

    /// Optional callback for navigation actions (tappable bead links — resolves first action)
    var onNavigate: ((TimelineEvent) -> Void)? = nil

    /// Optional callback for a specific context menu action
    var onAction: ((TimelineAction) -> Void)? = nil

    /// Whether the event has non-empty detail data
    private var hasDetail: Bool {
        guard let detail = event.detail else { return false }
        return !detail.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Main row content
            Button {
                if hasDetail {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                }
            } label: {
                HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
                    // Event type icon
                    eventIcon

                    // Content
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                        // Top row: agent + event type badge + expand indicator + timestamp
                        HStack(spacing: CRTTheme.Spacing.xs) {
                            Text(formatAgentName(event.agentId))
                                .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                                .foregroundColor(theme.primary)
                                .lineLimit(1)

                            BadgeView(eventTypeLabel.uppercased(), style: .tag)

                            Spacer(minLength: 0)

                            // Expand indicator
                            if hasDetail {
                                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                    .font(.system(size: 10))
                                    .foregroundColor(theme.dim)
                            }

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
                            .multilineTextAlignment(.leading)

                        // Bead reference — tappable link
                        if let beadId = event.beadId, !beadId.isEmpty {
                            Button {
                                onNavigate?(event)
                            } label: {
                                HStack(spacing: CRTTheme.Spacing.xxxs) {
                                    Image(systemName: "link")
                                        .font(.system(size: 9))
                                    Text(beadId)
                                        .font(CRTTheme.Typography.font(size: 10))
                                        .underline()
                                }
                                .foregroundColor(theme.primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .contextMenu {
                let actions = TimelineNavigationResolver.actions(for: event)
                ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                    Button {
                        onAction?(action)
                    } label: {
                        Label(action.label, systemImage: action.icon)
                    }
                }
            }

            // Expandable detail section
            if isExpanded, let detail = event.detail {
                detailView(detail)
                    .transition(.opacity.combined(with: .move(edge: .top)))
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
        case "coordinator_action": return "terminal.fill"
        case "auto_develop_enabled": return "play.circle.fill"
        case "auto_develop_disabled": return "stop.circle.fill"
        case "auto_develop_phase_changed": return "arrow.right.circle.fill"
        case "proposal_completed": return "checkmark.seal.fill"
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
        case "coordinator_action": return Color(red: 1.0, green: 0.8, blue: 0.0)
        case "auto_develop_enabled": return CRTTheme.State.success
        case "auto_develop_disabled": return CRTTheme.State.error
        case "auto_develop_phase_changed": return Color(red: 0.4, green: 0.8, blue: 1.0)
        case "proposal_completed": return CRTTheme.State.success
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
        case "coordinator_action": return "COORD"
        case "auto_develop_enabled": return "AUTO-DEV ON"
        case "auto_develop_disabled": return "AUTO-DEV OFF"
        case "auto_develop_phase_changed": return "PHASE"
        case "proposal_completed": return "PROPOSAL DONE"
        default: return event.eventType
        }
    }

    // MARK: - Detail View

    @ViewBuilder
    private func detailView(_ detail: [String: AnyCodableValue]) -> some View {
        let isCoordAction = event.eventType == "coordinator_action"

        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            if isCoordAction {
                coordinatorDetailView(detail)
            } else {
                genericDetailView(detail)
            }
        }
        .padding(.leading, 28 + CRTTheme.Spacing.sm) // align with content (icon width + spacing)
        .padding(.trailing, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.primary.opacity(0.03))
        .overlay(
            Rectangle()
                .frame(width: 2)
                .foregroundColor(
                    isCoordAction
                        ? Color(red: 1.0, green: 0.8, blue: 0.0).opacity(0.5)
                        : theme.primary.opacity(0.3)
                ),
            alignment: .leading
        )
    }

    private func coordinatorDetailView(_ detail: [String: AnyCodableValue]) -> some View {
        let amber = Color(red: 1.0, green: 0.8, blue: 0.0)
        return VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            if let value = detail["behavior"]?.stringValue {
                detailRow(label: "BEHAVIOR", value: value, labelColor: amber)
            }
            if let value = detail["target"]?.stringValue {
                detailRow(label: "TARGET", value: value, labelColor: amber)
            }
            if let value = detail["reason"]?.stringValue {
                detailRow(label: "REASON", value: value, labelColor: amber)
            }
        }
    }

    private func genericDetailView(_ detail: [String: AnyCodableValue]) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            ForEach(detail.keys.sorted(), id: \.self) { key in
                if let value = detail[key]?.stringValue {
                    detailRow(label: key.uppercased(), value: value, labelColor: theme.dim)
                }
            }
        }
    }

    private func detailRow(label: String, value: String, labelColor: Color) -> some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
            Text(label + ":")
                .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                .foregroundColor(labelColor)
                .frame(minWidth: 70, alignment: .leading)
            Text(value)
                .font(CRTTheme.Typography.font(size: 11))
                .foregroundColor(theme.primary.opacity(0.85))
                .lineLimit(5)
                .multilineTextAlignment(.leading)
        }
    }

    // MARK: - Formatting

    private func formatAgentName(_ agentId: String) -> String {
        // Extract last component (e.g., "adjutant/agents/flint" -> "flint")
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
                eventType: "coordinator_action",
                agentId: "coordinator",
                action: "Spawned build-monitor behavior",
                detail: [
                    "behavior": .string("build-monitor"),
                    "target": .string("ios-engineer"),
                    "reason": .string("Monitor CI build status"),
                ],
                createdAt: "2026-02-28T09:50:00Z"
            )
        )
        TimelineRowView(
            event: TimelineEvent(
                id: "evt-003",
                eventType: "announcement",
                agentId: "web-timeline",
                action: "Completed adj-028.2.1: Created TimelinePanel component",
                createdAt: "2026-02-28T09:45:00Z"
            )
        )
        TimelineRowView(
            event: TimelineEvent(
                id: "evt-004",
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
