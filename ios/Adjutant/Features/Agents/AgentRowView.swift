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
                        CRTText(member.name, style: .body, glowIntensity: .medium)

                        if let rig = member.rig {
                            CRTText("[\(rig)]", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        }

                        // Current bead ID badge
                        if let beadId = beadContext.currentBeadId {
                            Text(beadId)
                                .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                                .tracking(0.5)
                                .foregroundColor(theme.primary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(theme.primary.opacity(0.12))
                                .cornerRadius(3)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 3)
                                        .stroke(theme.primary.opacity(0.3), lineWidth: 0.5)
                                )
                        }
                    }

                    // Status/task info — always show status, plus task if available
                    VStack(alignment: .leading, spacing: 1) {
                        if let task = member.currentTask {
                            Text(task)
                                .font(CRTTheme.Typography.font(size: 13, theme: theme))
                                .foregroundColor(theme.dim)
                                .lineLimit(2)
                        }
                        statusText
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

    private var statusText: some View {
        CRTText(
            statusDisplayText,
            style: .caption,
            glowIntensity: .subtle,
            color: statusColor
        )
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
        if let rig = member.rig {
            description += ", \(rig)"
        }
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
                id: "mayor/",
                name: "Mayor",
                type: .mayor,
                rig: nil,
                status: .working,
                currentTask: "Coordinating infrastructure",
                unreadMail: 3,
                firstSubject: "Status update"
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "greenplace/witness",
                name: "Witness",
                type: .witness,
                rig: "greenplace",
                status: .idle,
                unreadMail: 0
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "greenplace/polecat-abc",
                name: "polecat-abc",
                type: .polecat,
                rig: "greenplace",
                status: .blocked,
                currentTask: "Waiting on review",
                unreadMail: 1
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "oldforge/polecat-xyz",
                name: "polecat-xyz",
                type: .polecat,
                rig: "oldforge",
                status: .stuck,
                currentTask: "Build failing",
                unreadMail: 5
            ),
            onTap: {}
        )

        AgentRowView(
            member: CrewMember(
                id: "offline/polecat",
                name: "polecat-old",
                type: .polecat,
                rig: "oldforge",
                status: .offline,
                unreadMail: 0
            ),
            onTap: {}
        )
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
