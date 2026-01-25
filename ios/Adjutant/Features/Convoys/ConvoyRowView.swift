import SwiftUI
import AdjutantKit

/// A row view for displaying a convoy with expandable tracked issues.
struct ConvoyRowView: View {
    @Environment(\.crtTheme) private var theme

    let convoy: Convoy
    let isExpanded: Bool
    let onToggleExpand: () -> Void
    let onIssueTap: ((TrackedIssue) -> Void)?

    init(
        convoy: Convoy,
        isExpanded: Bool,
        onToggleExpand: @escaping () -> Void,
        onIssueTap: ((TrackedIssue) -> Void)? = nil
    ) {
        self.convoy = convoy
        self.isExpanded = isExpanded
        self.onToggleExpand = onToggleExpand
        self.onIssueTap = onIssueTap
    }

    var body: some View {
        VStack(spacing: 0) {
            // Main convoy card (always visible)
            Button(action: onToggleExpand) {
                convoyHeader
            }
            .buttonStyle(.plain)

            // Expanded content (tracked issues)
            if isExpanded {
                trackedIssuesList
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(CRTTheme.Background.panel)
        .cornerRadius(CRTTheme.CornerRadius.md)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Convoy Header

    private var convoyHeader: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Title row
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    // Convoy ID
                    CRTText(convoy.id.uppercased(), style: .mono, glowIntensity: .subtle, color: theme.dim)

                    // Title
                    CRTText(convoy.title, style: .body, glowIntensity: .medium)
                        .lineLimit(2)
                }

                Spacer()

                // Expand/collapse chevron
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(theme.dim)
                    .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isExpanded)
            }

            // Rig badge (if applicable)
            if let rig = convoy.rig {
                BadgeView("RIG: \(rig.uppercased())", style: .tag)
            }

            // Progress section
            progressSection

            // Status badge
            HStack {
                statusBadge

                Spacer()

                // Issues count
                CRTText(
                    "\(convoy.trackedIssues.count) ISSUES",
                    style: .caption,
                    glowIntensity: .none,
                    color: theme.dim
                )
            }
        }
        .padding(CRTTheme.Spacing.md)
    }

    // MARK: - Progress Section

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Progress text
            HStack {
                CRTText(
                    "\(convoy.progress.completed)/\(convoy.progress.total) COMPLETE",
                    style: .caption,
                    glowIntensity: .subtle
                )

                Spacer()

                CRTText(
                    "\(Int(convoy.progress.percentage * 100))%",
                    style: .mono,
                    glowIntensity: .medium
                )
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background track
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.dim.opacity(0.2))
                        .frame(height: 6)

                    // Progress fill
                    RoundedRectangle(cornerRadius: 2)
                        .fill(progressColor)
                        .frame(width: max(0, geometry.size.width * convoy.progress.percentage), height: 6)
                        .crtGlow(color: progressColor, radius: 4, intensity: 0.5)
                }
            }
            .frame(height: 6)
        }
    }

    // MARK: - Status Badge

    private var statusBadge: some View {
        BadgeView(statusText, style: .status(statusType))
    }

    private var statusText: String {
        if convoy.isComplete {
            return "COMPLETE"
        } else if convoy.progress.completed == 0 {
            return "NOT STARTED"
        } else {
            return "IN PROGRESS"
        }
    }

    private var statusType: BadgeView.Style.StatusType {
        if convoy.isComplete {
            return .success
        } else if convoy.progress.completed == 0 {
            return .offline
        } else {
            return .info
        }
    }

    private var progressColor: Color {
        if convoy.isComplete {
            return CRTTheme.State.success
        } else if convoy.progress.percentage >= 0.5 {
            return theme.primary
        } else if convoy.progress.percentage >= 0.25 {
            return CRTTheme.State.warning
        } else {
            return CRTTheme.State.error
        }
    }

    // MARK: - Tracked Issues List

    private var trackedIssuesList: some View {
        VStack(spacing: 0) {
            // Divider
            Rectangle()
                .fill(theme.primary.opacity(0.2))
                .frame(height: 1)

            // Issues
            VStack(spacing: 0) {
                ForEach(convoy.trackedIssues) { issue in
                    trackedIssueRow(issue)

                    if issue.id != convoy.trackedIssues.last?.id {
                        Rectangle()
                            .fill(theme.dim.opacity(0.1))
                            .frame(height: 1)
                            .padding(.leading, CRTTheme.Spacing.md)
                    }
                }
            }
            .padding(.vertical, CRTTheme.Spacing.xs)
        }
    }

    private func trackedIssueRow(_ issue: TrackedIssue) -> some View {
        Button {
            onIssueTap?(issue)
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                StatusDot(issueStatusType(issue), size: 8)

                // Issue details
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        CRTText(issue.id.uppercased(), style: .mono, glowIntensity: .none, color: theme.dim)

                        if let priority = issue.priority {
                            BadgeView("P\(priority)", style: .priority(priority))
                        }
                    }

                    CRTText(issue.title, style: .caption, glowIntensity: .subtle)
                        .lineLimit(1)
                }

                Spacer()

                // Assignee (if assigned)
                if let assignee = issue.assignee {
                    CRTText(shortAssignee(assignee), style: .caption, glowIntensity: .none, color: theme.dim)
                }

                // Chevron for navigation
                Image(systemName: "chevron.right")
                    .font(.system(size: 10))
                    .foregroundColor(theme.dim.opacity(0.5))
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(onIssueTap == nil)
    }

    private func issueStatusType(_ issue: TrackedIssue) -> BadgeView.Style.StatusType {
        switch issue.status.lowercased() {
        case "closed", "done", "completed":
            return .success
        case "in_progress", "active", "working":
            return .info
        case "blocked":
            return .warning
        case "stuck":
            return .error
        default:
            return .offline
        }
    }

    private func shortAssignee(_ assignee: String) -> String {
        // Extract the last component of the assignee path
        // e.g., "polecat/basalt" -> "basalt"
        assignee.split(separator: "/").last.map(String.init) ?? assignee
    }
}

// MARK: - Preview

#Preview("Convoy Row - Collapsed") {
    VStack(spacing: CRTTheme.Spacing.md) {
        ConvoyRowView(
            convoy: ConvoysViewModel.mockConvoys[0],
            isExpanded: false,
            onToggleExpand: {}
        )

        ConvoyRowView(
            convoy: ConvoysViewModel.mockConvoys[1],
            isExpanded: false,
            onToggleExpand: {}
        )
    }
    .padding()
    .background(CRTTheme.Background.screen)
}

#Preview("Convoy Row - Expanded") {
    ConvoyRowView(
        convoy: ConvoysViewModel.mockConvoys[0],
        isExpanded: true,
        onToggleExpand: {}
    ) { issue in
        print("Tapped issue: \(issue.id)")
    }
    .padding()
    .background(CRTTheme.Background.screen)
}

#Preview("Convoy Row - Complete") {
    let completeConvoy = Convoy(
        id: "convoy-done",
        title: "Completed Sprint",
        status: "closed",
        rig: "adjutant",
        progress: ConvoyProgress(completed: 5, total: 5),
        trackedIssues: [
            TrackedIssue(id: "done-1", title: "Task 1", status: "closed"),
            TrackedIssue(id: "done-2", title: "Task 2", status: "closed")
        ]
    )

    return ConvoyRowView(
        convoy: completeConvoy,
        isExpanded: true,
        onToggleExpand: {}
    )
    .padding()
    .background(CRTTheme.Background.screen)
}
