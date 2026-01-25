import SwiftUI
import AdjutantKit

/// A row view for displaying a single crew member in the list.
struct CrewRowView: View {
    @Environment(\.crtTheme) private var theme

    let member: CrewMember
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                statusIndicator

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    // Name and type
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(member.name, style: .body, glowIntensity: .medium)

                        if let rig = member.rig {
                            CRTText("[\(rig)]", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        }
                    }

                    // Status/task info
                    if let task = member.currentTask {
                        CRTText(task, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            .lineLimit(1)
                    } else {
                        statusText
                    }
                }

                Spacer()

                // Unread mail badge
                if member.unreadMail > 0 {
                    UnreadBadge(member.unreadMail)
                }

                // Navigation chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(theme.dim)
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.md)
            .background(CRTTheme.Background.panel.opacity(0.3))
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
        if member.unreadMail > 0 {
            description += ", \(member.unreadMail) unread messages"
        }
        return description
    }
}

// MARK: - Preview

#Preview("CrewRowView States") {
    VStack(spacing: 12) {
        CrewRowView(
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

        CrewRowView(
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

        CrewRowView(
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

        CrewRowView(
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

        CrewRowView(
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
    .background(CRTTheme.Background.screen)
}
