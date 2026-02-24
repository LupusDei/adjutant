import SwiftUI
import AdjutantKit

// MARK: - Navigation Note (adj-020.4.3)
// Post-spawn navigation pattern verified against AppCoordinator:
// - pendingChatAgentId: Published String? property exists (line 165)
// - selectTab(.chat): method exists (line 237), maps to AppTab.chat
// - ChatView handles pendingChatAgentId for recipient selection via notification deep link
// The .onChange(of: viewModel.spawnedSessionId) pattern in SwarmOverviewView is correct.

// MARK: - AgentsSectionView

/// Displays the agents list section for the Swarm Overview dashboard.
/// Shows each agent's status, current bead, and unread message count.
struct AgentsSectionView: View {
    let agents: [AgentOverview]
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            if agents.isEmpty {
                emptyState
            } else {
                VStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(agents) { agent in
                        agentRow(agent)
                    }
                }
            }
        }
    }

    // MARK: - Agent Row

    private func agentRow(_ agent: AgentOverview) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot
            Circle()
                .fill(statusColor(for: agent.status))
                .frame(width: 8, height: 8)

            // Name + current bead
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                CRTText(agent.name.uppercased(), style: .body)
                if let bead = agent.currentBead {
                    CRTText(bead, style: .caption, color: theme.dim)
                }
            }

            Spacer()

            // Status text
            CRTText(
                agent.status.uppercased(),
                style: .caption,
                color: statusColor(for: agent.status)
            )

            // Unread badge
            if agent.unreadCount > 0 {
                Text("\(agent.unreadCount)")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(.black)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.primary)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xs)
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.dim.opacity(0.15), lineWidth: 1)
        )
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "person.3")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)
            CRTText("NO ACTIVE AGENTS", style: .caption, color: theme.dim)
            CRTText(
                "Start an agent to begin work",
                style: .caption,
                color: theme.dim.opacity(0.6)
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, CRTTheme.Spacing.lg)
    }

    // MARK: - Helpers

    private func statusColor(for status: String) -> Color {
        switch status.lowercased() {
        case "working": return CRTTheme.State.success
        case "idle": return CRTTheme.State.info
        case "blocked": return CRTTheme.State.error
        default: return CRTTheme.State.offline
        }
    }
}

// MARK: - StartAgentSection

/// A prominent button for spawning a new agent.
/// Tap for quick spawn (random callsign), long-press for callsign picker.
struct StartAgentSection: View {
    let onTap: () -> Void
    let onLongPress: () -> Void
    @Environment(\.crtTheme) private var theme

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 20))
                CRTText("START AGENT", style: .subheader, glowIntensity: .bright)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, CRTTheme.Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(theme.primary.opacity(0.15))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.primary.opacity(0.5), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5)
                .onEnded { _ in onLongPress() }
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
    }
}

// MARK: - Previews

#Preview("Agents Section - With Agents") {
    ScrollView {
        AgentsSectionView(agents: [
            AgentOverview(
                id: "1", name: "researcher", status: "working",
                currentBead: "adj-020.4 Build agents UI", unreadCount: 3
            ),
            AgentOverview(
                id: "2", name: "implementer", status: "idle",
                currentBead: nil, unreadCount: 0
            ),
            AgentOverview(
                id: "3", name: "tester", status: "blocked",
                currentBead: "adj-020.5 Fix test suite", unreadCount: 1
            ),
        ])
        .padding(.vertical)
    }
    .background(CRTTheme.Background.screen)
}

#Preview("Agents Section - Empty") {
    ScrollView {
        AgentsSectionView(agents: [])
            .padding(.vertical)
    }
    .background(CRTTheme.Background.screen)
}

#Preview("Start Agent Button") {
    VStack {
        StartAgentSection(onTap: {}, onLongPress: {})
    }
    .padding(.vertical)
    .background(CRTTheme.Background.screen)
}
