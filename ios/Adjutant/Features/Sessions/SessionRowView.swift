import SwiftUI
import AdjutantKit

/// Row view for a single session in the agent switcher.
struct SessionRowView: View {
    @Environment(\.crtTheme) private var theme

    let session: ManagedSession
    let isActive: Bool
    let onTap: () -> Void
    let onKill: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                StatusDot(statusType, size: 10, pulse: shouldPulse)

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(session.name, style: .body, glowIntensity: isActive ? .bright : .medium)

                        if isActive {
                            BadgeView("ACTIVE", style: .status(.success))
                        }
                    }

                    HStack(spacing: CRTTheme.Spacing.xs) {
                        // Status badge
                        BadgeView(statusText, style: .status(statusType))

                        // Mode badge
                        CRTText(session.mode.rawValue.uppercased(), style: .caption, glowIntensity: .subtle, color: theme.dim)

                        // Project path (truncated)
                        CRTText(
                            projectName,
                            style: .caption,
                            glowIntensity: .subtle,
                            color: theme.dim
                        )
                        .lineLimit(1)
                    }
                }

                Spacer()

                // Kill button (only for non-offline sessions)
                if session.status != .offline {
                    Button {
                        onKill()
                    } label: {
                        Image(systemName: "stop.circle")
                            .font(.system(size: 18))
                            .foregroundColor(CRTTheme.State.error.opacity(0.7))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.md)
            .background(
                isActive
                    ? theme.primary.opacity(0.08)
                    : CRTTheme.Background.panel.opacity(0.3)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isActive ? theme.primary.opacity(0.5) : theme.primary.opacity(0.2),
                        lineWidth: isActive ? 1.5 : 1
                    )
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityDescription)
    }

    // MARK: - Status Helpers

    private var statusType: BadgeView.Style.StatusType {
        switch session.status {
        case .idle: return .info
        case .working: return .success
        case .waitingPermission: return .warning
        case .offline: return .offline
        }
    }

    private var statusText: String {
        switch session.status {
        case .idle: return "IDLE"
        case .working: return "WORKING"
        case .waitingPermission: return "PERMISSION"
        case .offline: return "OFFLINE"
        }
    }

    private var shouldPulse: Bool {
        session.status == .working || session.status == .waitingPermission
    }

    private var projectName: String {
        // Extract last path component
        let components = session.projectPath.split(separator: "/")
        return String(components.last ?? "")
    }

    private var accessibilityDescription: String {
        var desc = "Session \(session.name), \(statusText.lowercased())"
        if isActive { desc += ", active" }
        desc += ", project \(projectName)"
        return desc
    }
}

// MARK: - Preview

#Preview("Session Rows") {
    VStack(spacing: 12) {
        SessionRowView(
            session: ManagedSession(
                id: "s1",
                name: "adjutant-main",
                tmuxSession: "gt-adj-polecat-s1",
                tmuxPane: "%0",
                projectPath: "/Users/dev/adjutant",
                mode: .standalone,
                status: .working,
                workspaceType: .primary,
                connectedClients: ["c1"],
                pipeActive: true,
                createdAt: "2026-02-15T10:00:00Z",
                lastActivity: "2026-02-15T16:00:00Z"
            ),
            isActive: true,
            onTap: {},
            onKill: {}
        )

        SessionRowView(
            session: ManagedSession(
                id: "s2",
                name: "feature-auth",
                tmuxSession: "gt-adj-polecat-s2",
                tmuxPane: "%1",
                projectPath: "/Users/dev/auth-service",
                mode: .gastown,
                status: .idle,
                workspaceType: .worktree,
                connectedClients: [],
                pipeActive: false,
                createdAt: "2026-02-15T09:00:00Z",
                lastActivity: "2026-02-15T12:00:00Z"
            ),
            isActive: false,
            onTap: {},
            onKill: {}
        )

        SessionRowView(
            session: ManagedSession(
                id: "s3",
                name: "polecat-review",
                tmuxSession: "gt-adj-polecat-s3",
                tmuxPane: "%2",
                projectPath: "/Users/dev/review-app",
                mode: .swarm,
                status: .waitingPermission,
                workspaceType: .copy,
                connectedClients: ["c2"],
                pipeActive: true,
                createdAt: "2026-02-15T08:00:00Z",
                lastActivity: "2026-02-15T15:30:00Z"
            ),
            isActive: false,
            onTap: {},
            onKill: {}
        )
    }
    .padding()
    .background(CRTTheme.Background.screen)
}
