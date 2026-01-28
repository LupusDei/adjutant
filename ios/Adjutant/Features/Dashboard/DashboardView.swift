import SwiftUI
import AdjutantKit

/// Main dashboard view with Beads Kanban preview, Crew, and Mail status.
struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Header with rig filter and power status
                AppHeaderView(
                    title: "DASHBOARD",
                    subtitle: "SYSTEM OVERVIEW",
                    availableRigs: appState.availableRigs,
                    isLoading: viewModel.isRefreshing,
                    onPowerTap: { coordinator.navigate(to: .settings) }
                )

                // Beads Kanban Preview (full width at top)
                BeadsKanbanPreviewWidget(
                    inProgressBeads: viewModel.inProgressBeads,
                    hookedBeads: viewModel.hookedBeads,
                    recentClosedBeads: viewModel.recentClosedBeads,
                    onTap: { coordinator.navigate(to: .beads) },
                    onBeadTap: { bead in
                        coordinator.navigate(to: .beadDetail(id: bead.id))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Crew Widget (full width with member list)
                CrewWidget(
                    crewMembers: viewModel.activeCrewMembers,
                    issueCount: viewModel.crewWithIssues,
                    onTap: { coordinator.navigate(to: .crew) },
                    onMemberTap: { member in
                        coordinator.navigate(to: .agentDetail(member: member))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Mail Widget (compact)
                MailWidgetCompact(
                    unreadCount: viewModel.unreadCount,
                    onTap: { coordinator.navigate(to: .mail) }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)
            }
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .refreshable {
            await viewModel.refresh()
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .overlay {
            if viewModel.isLoading && viewModel.recentMail.isEmpty {
                LoadingIndicator(size: .large, text: "LOADING")
            }
        }
    }

}

// MARK: - Beads Kanban Preview Widget

private struct BeadsKanbanPreviewWidget: View {
    @Environment(\.crtTheme) private var theme

    let inProgressBeads: [BeadInfo]
    let hookedBeads: [BeadInfo]
    let recentClosedBeads: [BeadInfo]
    let onTap: () -> Void
    let onBeadTap: (BeadInfo) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "square.grid.2x2.fill")
                            .foregroundColor(theme.primary)
                        CRTText("BEADS", style: .subheader)

                        Spacer()

                        let totalActive = inProgressBeads.count + hookedBeads.count
                        if totalActive > 0 {
                            BadgeView("\(totalActive) ACTIVE", style: .status(.success))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Horizontally scrollable kanban columns
                if inProgressBeads.isEmpty && hookedBeads.isEmpty && recentClosedBeads.isEmpty {
                    EmptyStateView(
                        title: "NO ACTIVE BEADS",
                        icon: "tray"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: CRTTheme.Spacing.md) {
                            // In Progress column
                            KanbanColumnPreview(
                                title: "IN PROGRESS",
                                beads: inProgressBeads,
                                color: CRTTheme.State.success,
                                onBeadTap: onBeadTap
                            )

                            // Hooked column
                            KanbanColumnPreview(
                                title: "HOOKED",
                                beads: hookedBeads,
                                color: CRTTheme.State.info,
                                onBeadTap: onBeadTap
                            )

                            // Recent Closed column
                            KanbanColumnPreview(
                                title: "RECENT",
                                beads: recentClosedBeads,
                                color: CRTTheme.State.offline,
                                onBeadTap: onBeadTap
                            )
                        }
                        .padding(.vertical, CRTTheme.Spacing.xs)
                    }
                }
            }
        }
    }
}

private struct KanbanColumnPreview: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let beads: [BeadInfo]
    let color: Color
    let onBeadTap: (BeadInfo) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Column header
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                CRTText(title, style: .caption, color: theme.dim)
                CRTText("(\(beads.count))", style: .caption, color: theme.dim)
            }

            // Bead cards
            if beads.isEmpty {
                RoundedRectangle(cornerRadius: 4)
                    .stroke(theme.dim.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .frame(width: 140, height: 40)
            } else {
                ForEach(beads.prefix(3)) { bead in
                    Button(action: { onBeadTap(bead) }) {
                        BeadCardPreview(bead: bead, accentColor: color)
                    }
                    .buttonStyle(.plain)
                }

                if beads.count > 3 {
                    CRTText("+\(beads.count - 3) more", style: .caption, color: theme.dim)
                        .frame(width: 140, alignment: .center)
                }
            }
        }
        .frame(width: 150)
    }
}

private struct BeadCardPreview: View {
    @Environment(\.crtTheme) private var theme
    let bead: BeadInfo
    let accentColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                CRTText(bead.id.uppercased(), style: .caption, color: accentColor)
                Spacer()
                if let priority = bead.priorityLevel {
                    CRTText("P\(priority.rawValue)", style: .caption, color: priorityColor(priority))
                }
            }
            CRTText(bead.title, style: .caption, color: theme.primary)
                .lineLimit(2)
        }
        .padding(CRTTheme.Spacing.xs)
        .frame(width: 140, alignment: .leading)
        .background(theme.dim.opacity(0.1))
        .cornerRadius(4)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(accentColor.opacity(0.3), lineWidth: 1)
        )
    }

    private func priorityColor(_ priority: MessagePriority) -> Color {
        switch priority {
        case .lowest, .low: return theme.dim
        case .normal: return theme.primary
        case .high: return .orange
        case .urgent: return .red
        }
    }
}

// MARK: - Crew Widget

private struct CrewWidget: View {
    @Environment(\.crtTheme) private var theme

    let crewMembers: [CrewMember]
    let issueCount: Int
    let onTap: () -> Void
    let onMemberTap: (CrewMember) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "person.3.fill")
                            .foregroundColor(theme.primary)
                        CRTText("CREW", style: .subheader)

                        Spacer()

                        if issueCount > 0 {
                            BadgeView("\(issueCount) ISSUES", style: .status(.warning))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Crew status summary
                if crewMembers.isEmpty {
                    EmptyStateView(
                        title: "NO ACTIVE CREW",
                        icon: "person.crop.circle.badge.questionmark"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    // Status counts
                    HStack(spacing: CRTTheme.Spacing.md) {
                        StatusCount(
                            status: .success,
                            label: "WORKING",
                            count: crewMembers.filter { $0.status == .working }.count
                        )
                        StatusCount(
                            status: .info,
                            label: "IDLE",
                            count: crewMembers.filter { $0.status == .idle }.count
                        )
                        StatusCount(
                            status: .warning,
                            label: "BLOCKED",
                            count: crewMembers.filter { $0.status == .blocked }.count
                        )
                        StatusCount(
                            status: .error,
                            label: "STUCK",
                            count: crewMembers.filter { $0.status == .stuck }.count
                        )
                    }
                    .padding(.vertical, CRTTheme.Spacing.xs)

                    Divider()
                        .background(theme.dim.opacity(0.3))

                    // Individual crew members (first few)
                    ForEach(crewMembers.prefix(4)) { member in
                        Button(action: { onMemberTap(member) }) {
                            CrewMemberRow(member: member)
                        }
                        .buttonStyle(.plain)
                    }

                    if crewMembers.count > 4 {
                        Button(action: onTap) {
                            HStack {
                                Spacer()
                                CRTText("VIEW ALL (\(crewMembers.count))", style: .caption, color: theme.primary)
                                Image(systemName: "arrow.right")
                                    .font(.caption)
                                    .foregroundColor(theme.primary)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.top, CRTTheme.Spacing.xxs)
                    }
                }
            }
        }
    }
}

private struct StatusCount: View {
    @Environment(\.crtTheme) private var theme

    let status: BadgeView.Style.StatusType
    let label: String
    let count: Int

    var body: some View {
        VStack(spacing: CRTTheme.Spacing.xxs) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                StatusDot(status, size: 6)
                CRTText("\(count)", style: .body, color: status.color)
            }
            CRTText(label, style: .caption, color: theme.dim)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct CrewMemberRow: View {
    @Environment(\.crtTheme) private var theme
    let member: CrewMember

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status indicator
            StatusDot(statusType, size: 8, pulse: member.status == .working)

            // Name and task
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    CRTText(member.name, style: .body, color: theme.primary)
                    if let rig = member.rig {
                        CRTText("[\(rig)]", style: .caption, color: theme.dim)
                    }
                }
                if let task = member.currentTask {
                    CRTText(task, style: .caption, color: theme.dim)
                        .lineLimit(1)
                } else {
                    CRTText(statusText, style: .caption, color: statusType.color)
                }
            }

            Spacer()

            // Unread mail indicator
            if member.unreadMail > 0 {
                BadgeView("\(member.unreadMail)", style: .count)
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    private var statusType: BadgeView.Style.StatusType {
        switch member.status {
        case .idle: return .info
        case .working: return .success
        case .blocked: return .warning
        case .stuck: return .error
        case .offline: return .offline
        }
    }

    private var statusText: String {
        switch member.status {
        case .idle: return "IDLE"
        case .working: return "WORKING"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }
}

private struct MailWidgetCompact: View {
    @Environment(\.crtTheme) private var theme

    let unreadCount: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            CRTCard(style: .standard) {
                VStack(spacing: CRTTheme.Spacing.xs) {
                    HStack {
                        Image(systemName: "envelope.fill")
                            .foregroundColor(theme.primary)
                        CRTText("MAIL", style: .caption)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }

                    HStack {
                        VStack(alignment: .leading) {
                            CRTText("\(unreadCount)", style: .header, glowIntensity: unreadCount > 0 ? .subtle : .none)
                            CRTText("UNREAD", style: .caption, color: theme.dim)
                        }

                        Spacer()

                        if unreadCount > 0 {
                            Circle()
                                .fill(theme.primary)
                                .frame(width: 8, height: 8)
                        }
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Date Extension

private extension Date {
    /// Format date as relative time (e.g., "2h ago", "Yesterday")
    var relativeFormat: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}

// MARK: - Preview

#Preview("Dashboard") {
    DashboardView()
        .environmentObject(AppCoordinator())
}
