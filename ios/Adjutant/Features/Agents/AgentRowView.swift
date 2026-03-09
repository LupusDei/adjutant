import SwiftUI
import AdjutantKit

/// Context about an agent's bead workload for display in the row.
struct AgentBeadContext {
    /// Number of beads assigned to this agent
    let assignedCount: Int
    /// The ID of the current in-progress bead, if any
    let currentBeadId: String?

    static let empty = AgentBeadContext(assignedCount: 0, currentBeadId: nil)
}

/// A row view for displaying a single agent in the list.
struct AgentRowView: View {
    @Environment(\.crtTheme) private var theme

    let member: CrewMember
    var beadContext: AgentBeadContext = .empty
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                statusIndicator

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    // Name and bead badge row
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        // Friendly: agent-specific color from palette
                        let agentColor = theme.colorPalette?.color(for: member.name) ?? theme.primary

                        CRTText(member.name, style: .body, glowIntensity: .medium, color: agentColor)

                        // Project badge
                        if let project = member.project, !project.isEmpty {
                            Text(project.uppercased())
                                .font(CRTTheme.Typography.font(size: 8, weight: .bold))
                                .tracking(0.5)
                                .foregroundColor(theme.dim)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 3)
                                        .stroke(theme.dim.opacity(0.4), lineWidth: 0.5)
                                )
                        }

                        // Current bead ID badge
                        if let beadId = beadContext.currentBeadId {
                            Text(beadId)
                                .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                                .tracking(0.5)
                                .foregroundColor(agentColor)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(agentColor.opacity(0.12))
                                .cornerRadius(3)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 3)
                                        .stroke(agentColor.opacity(0.3), lineWidth: 0.5)
                                )
                        }

                        Spacer(minLength: 0)

                        // Cost and context indicators (top-right)
                        costContextView
                    }

                    // Status label
                    Text(statusDisplayText)
                        .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                        .tracking(0.5)
                        .foregroundColor(statusColor)

                    // Task description (separate line, more visible)
                    if let task = member.currentTask {
                        Text(task)
                            .font(CRTTheme.Typography.font(size: 11))
                            .foregroundColor(theme.primary.opacity(0.7))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer()

                // Bead count indicator
                if beadContext.assignedCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "circle.grid.3x3")
                            .font(.system(size: 9))
                            .foregroundColor(theme.dim)
                        Text("\(beadContext.assignedCount)")
                            .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                            .foregroundColor(theme.dim)
                    }
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(theme.dim.opacity(0.1))
                    .cornerRadius(3)
                }

                // Unread mail badge
                if (member.unreadMail ?? 0) > 0 {
                    UnreadBadge(member.unreadMail ?? 0)
                }

                // Navigation chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(theme.dim)
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.md)
            .background(theme.background.panel.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(0.2), lineWidth: 1)
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityDescription)
    }

    // MARK: - Subviews

    private var statusIndicator: some View {
        StatusDot(statusType, size: 10, pulse: shouldPulse)
    }

    // MARK: - Cost & Context

    @ViewBuilder
    private var costContextView: some View {
        HStack(spacing: 4) {
            if let cost = member.cost {
                Text(String(format: "$%.2f", cost))
                    .font(CRTTheme.Typography.font(size: 9, weight: .regular))
                    .foregroundColor(theme.dim)
            }

            if let ctx = member.contextPercent {
                HStack(spacing: 2) {
                    Text("CTX")
                        .font(CRTTheme.Typography.font(size: 8, weight: .bold))
                        .foregroundColor(contextColor(for: ctx).opacity(0.7))

                    // Compact progress bar
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(theme.dim.opacity(0.2))
                            .frame(width: 20, height: 3)

                        RoundedRectangle(cornerRadius: 1)
                            .fill(contextColor(for: ctx))
                            .frame(width: max(1, 20 * CGFloat(min(ctx, 100)) / 100), height: 3)
                    }

                    Text(String(format: "%.0f%%", ctx))
                        .font(CRTTheme.Typography.font(size: 8, weight: .bold))
                        .foregroundColor(contextColor(for: ctx))
                }
            }
        }
    }

    /// Color for context usage based on threshold: green < 50%, yellow 50-75%, orange 75-90%, red > 90%
    private func contextColor(for percent: Double) -> Color {
        switch percent {
        case ..<50:
            return theme.primary
        case 50..<75:
            return CRTTheme.State.warning
        case 75..<90:
            return Color(red: 1.0, green: 0.5, blue: 0.0) // Orange
        default:
            return CRTTheme.State.error
        }
    }

    // MARK: - Status Helpers

    private var statusType: BadgeView.Style.StatusType {
        switch member.status {
        case .idle:
            return .info
        case .working:
            return .success
        case .blocked:
            return .warning
        case .stuck:
            return .error
        case .offline:
            return .offline
        }
    }

    private var statusDisplayText: String {
        switch member.status {
        case .idle: return "IDLE"
        case .working: return "WORKING"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }

    private var statusColor: Color {
        statusType.color
    }

    private var shouldPulse: Bool {
        member.status == .working || member.status == .stuck
    }

    private var accessibilityDescription: String {
        var description = "\(member.name), \(member.type.rawValue)"
        description += ", status: \(statusDisplayText.lowercased())"
        if (member.unreadMail ?? 0) > 0 {
            description += ", \(member.unreadMail ?? 0) unread messages"
        }
        return description
    }
}

// MARK: - Preview

#Preview("AgentRowView States") {
    VStack(spacing: 12) {
        AgentRowView(
            member: CrewMember(
                id: "agent-coordinator",
                name: "Coordinator",
                type: .agent,
                status: .working,
                currentTask: "Coordinating infrastructure",
                unreadMail: 3,
                firstSubject: "Status update",
                cost: 1.23,
                contextPercent: 42
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "agent-watcher",
                name: "Watcher",
                type: .agent,
                status: .idle,
                unreadMail: 0,
                cost: 0.05,
                contextPercent: 12
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "agent-abc",
                name: "agent-abc",
                type: .agent,
                status: .blocked,
                currentTask: "Waiting on review",
                unreadMail: 1,
                cost: 3.50,
                contextPercent: 67
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "agent-xyz",
                name: "agent-xyz",
                type: .agent,
                status: .stuck,
                currentTask: "Build failing",
                unreadMail: 5,
                cost: 8.99,
                contextPercent: 92
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "agent-old",
                name: "agent-old",
                type: .agent,
                status: .offline,
                unreadMail: 0
            ),
            onTap: {}
        )
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
