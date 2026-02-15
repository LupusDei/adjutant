import SwiftUI
import AdjutantKit

/// A row view for displaying a single project (rig) in the list.
struct ProjectRowView: View {
    @Environment(\.crtTheme) private var theme

    let rig: RigStatus
    let runningCount: Int
    let totalCount: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Project icon
                Image(systemName: "folder.fill")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(hasRunningAgents ? theme.primary : theme.dim)
                    .frame(width: 28)

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    // Project name
                    CRTText(rig.name.uppercased(), style: .body, glowIntensity: .medium)

                    // Path
                    CRTText(abbreviatedPath, style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .lineLimit(1)
                }

                Spacer()

                // Agent count and merge queue
                VStack(alignment: .trailing, spacing: CRTTheme.Spacing.xxxs) {
                    // Running/total agents
                    HStack(spacing: CRTTheme.Spacing.xxs) {
                        StatusDot(hasRunningAgents ? .success : .offline, size: 8, pulse: hasRunningAgents)
                        CRTText(
                            "\(runningCount)/\(totalCount)",
                            style: .caption,
                            glowIntensity: .subtle,
                            color: hasRunningAgents ? theme.primary : theme.dim
                        )
                    }

                    // Merge queue summary
                    if mergeQueueTotal > 0 {
                        HStack(spacing: CRTTheme.Spacing.xxs) {
                            Image(systemName: "arrow.triangle.merge")
                                .font(.system(size: 10))
                                .foregroundColor(theme.dim)
                            CRTText("\(mergeQueueTotal)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        }
                    }
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

    // MARK: - Helpers

    private var hasRunningAgents: Bool {
        runningCount > 0
    }

    private var mergeQueueTotal: Int {
        rig.mergeQueue.pending + rig.mergeQueue.inFlight + rig.mergeQueue.blocked
    }

    private var abbreviatedPath: String {
        let path = rig.path
        if let homeRange = path.range(of: "/Users/") {
            let afterUsers = path[homeRange.upperBound...]
            if let slashIndex = afterUsers.firstIndex(of: "/") {
                return "~" + String(afterUsers[slashIndex...])
            }
        }
        return path
    }

    private var accessibilityDescription: String {
        "\(rig.name), \(runningCount) of \(totalCount) agents running"
    }
}

// MARK: - Preview

#Preview("ProjectRowView") {
    VStack(spacing: 12) {
        ProjectRowView(
            rig: RigStatus(
                name: "greenplace",
                path: "/Users/dev/code/greenplace",
                witness: AgentStatus(name: "witness", running: true, unreadMail: 0),
                refinery: AgentStatus(name: "refinery", running: true, unreadMail: 0),
                crew: [],
                polecats: [
                    AgentStatus(name: "polecat-abc", running: true, unreadMail: 1)
                ],
                mergeQueue: MergeQueueSummary(pending: 2, inFlight: 1, blocked: 0)
            ),
            runningCount: 3,
            totalCount: 3,
            onTap: {}
        )

        ProjectRowView(
            rig: RigStatus(
                name: "oldforge",
                path: "/Users/dev/code/oldforge",
                witness: AgentStatus(name: "witness", running: false, unreadMail: 0),
                refinery: AgentStatus(name: "refinery", running: false, unreadMail: 0),
                crew: [],
                polecats: [],
                mergeQueue: MergeQueueSummary(pending: 0, inFlight: 0, blocked: 0)
            ),
            runningCount: 0,
            totalCount: 2,
            onTap: {}
        )
    }
    .padding()
    .background(CRTTheme.Background.screen)
}
