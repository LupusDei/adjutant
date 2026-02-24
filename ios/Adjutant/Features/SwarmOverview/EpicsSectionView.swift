import SwiftUI
import AdjutantKit

// MARK: - Epics Section View

/// Displays epic progress overview with in-progress bars, recently completed, and empty state.
struct EpicsSectionView: View {
    let epics: EpicsOverview
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            sectionHeader

            if !epics.inProgress.isEmpty {
                inProgressSection
            } else {
                emptyOrRecentlyCompleted
            }
        }
    }

    // MARK: - Section Header

    private var sectionHeader: some View {
        HStack {
            CRTText("EPICS", style: .subheader, glowIntensity: .medium)
            Spacer()
            let totalCount = epics.inProgress.count + epics.recentlyCompleted.count
            CRTText("\(totalCount)", style: .caption, color: theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - In-Progress Section

    private var inProgressSection: some View {
        let sorted = epics.inProgress.sorted { $0.completionPercent > $1.completionPercent }
        return VStack(spacing: CRTTheme.Spacing.xs) {
            ForEach(sorted) { epic in
                epicRow(epic)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Epic Row

    private func epicRow(_ epic: EpicProgress) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            HStack {
                CRTText(epic.title, style: .body)
                Spacer()
                CRTText(
                    "\(Int(epic.completionPercent * 100))%",
                    style: .caption,
                    glowIntensity: epic.completionPercent > 0.8 ? .bright : .subtle,
                    color: epic.completionPercent > 0.8 ? theme.primary : theme.dim
                )
            }

            CRTProgressBar(progress: epic.completionPercent)

            HStack {
                CRTText(
                    "\(epic.closedChildren)/\(epic.totalChildren) tasks",
                    style: .caption,
                    color: theme.dim
                )
                if let assignee = epic.assignee {
                    Spacer()
                    CRTText(
                        assignee.uppercased(),
                        style: .caption,
                        color: theme.dim.opacity(0.6)
                    )
                }
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

    // MARK: - Empty / Recently Completed

    @ViewBuilder
    private var emptyOrRecentlyCompleted: some View {
        if !epics.recentlyCompleted.isEmpty {
            recentlyCompletedSection
        } else {
            emptyState
        }
    }

    private var recentlyCompletedSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText("RECENTLY COMPLETED", style: .caption, color: theme.dim)

            ForEach(epics.recentlyCompleted.prefix(3)) { epic in
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(CRTTheme.State.success.opacity(0.6))
                        .font(.system(size: 14))

                    CRTText(epic.title, style: .body, color: theme.dim.opacity(0.6))

                    Spacer()

                    CRTText(
                        "\(epic.totalChildren) tasks",
                        style: .caption,
                        color: theme.dim.opacity(0.4)
                    )
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "chart.bar")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)
            CRTText("NO EPICS", style: .caption, color: theme.dim)
            CRTText(
                "Epics will appear here when created",
                style: .caption,
                color: theme.dim.opacity(0.6)
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, CRTTheme.Spacing.lg)
    }
}

// MARK: - CRT Progress Bar

/// A horizontal progress bar with CRT phosphor styling.
private struct CRTProgressBar: View {
    let progress: Double
    @Environment(\.crtTheme) private var theme

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Background track
                RoundedRectangle(cornerRadius: 2)
                    .fill(theme.dim.opacity(0.2))

                // Filled portion
                RoundedRectangle(cornerRadius: 2)
                    .fill(theme.primary.opacity(0.8))
                    .frame(width: max(geometry.size.width * progress, 2))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Preview

#Preview("Epics - In Progress") {
    ScrollView {
        EpicsSectionView(
            epics: EpicsOverview(
                inProgress: [
                    EpicProgress(id: "adj-020", title: "Swarm Overview", status: "in_progress",
                                 totalChildren: 8, closedChildren: 6, completionPercent: 0.75, assignee: "team-lead"),
                    EpicProgress(id: "adj-019", title: "iOS Foundation", status: "in_progress",
                                 totalChildren: 4, closedChildren: 4, completionPercent: 1.0),
                    EpicProgress(id: "adj-018", title: "MCP Bridge", status: "in_progress",
                                 totalChildren: 10, closedChildren: 3, completionPercent: 0.3, assignee: "builder"),
                ],
                recentlyCompleted: []
            )
        )
    }
    .background(CRTTheme.Background.screen)
}

#Preview("Epics - Recently Completed") {
    ScrollView {
        EpicsSectionView(
            epics: EpicsOverview(
                inProgress: [],
                recentlyCompleted: [
                    EpicProgress(id: "adj-015", title: "Agent Chat", status: "closed",
                                 totalChildren: 5, closedChildren: 5, completionPercent: 1.0),
                    EpicProgress(id: "adj-014", title: "Beads CRUD", status: "closed",
                                 totalChildren: 3, closedChildren: 3, completionPercent: 1.0),
                ]
            )
        )
    }
    .background(CRTTheme.Background.screen)
}

#Preview("Epics - Empty") {
    ScrollView {
        EpicsSectionView(
            epics: EpicsOverview(inProgress: [], recentlyCompleted: [])
        )
    }
    .background(CRTTheme.Background.screen)
}
