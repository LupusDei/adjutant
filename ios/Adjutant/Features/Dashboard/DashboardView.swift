import SwiftUI
import AdjutantKit

/// Main dashboard view: Unread Messages, Tasks, Epics.
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
                    title: "ADJUTANT",
                    subtitle: "SYSTEM OVERVIEW",
                    availableRigs: appState.availableRigs,
                    isLoading: viewModel.isRefreshing,
                    onPowerTap: { coordinator.navigate(to: .settings) }
                )

                // Unread Messages (top)
                UnreadMessagesWidget(
                    messages: viewModel.unreadMessages,
                    onAgentTap: { agentId in
                        coordinator.pendingChatAgentId = agentId
                        coordinator.selectTab(.chat)
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Tasks: In Progress + Recently Completed
                TasksWidget(
                    inProgressTasks: viewModel.inProgressTasks,
                    recentCompletedTasks: viewModel.recentCompletedTasks,
                    onTap: { coordinator.navigate(to: .beads) },
                    onBeadTap: { bead in
                        coordinator.navigateReplacingPath(to: .beadDetail(id: bead.id))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Epics: In Progress + Recently Completed
                EpicsOverviewWidget(
                    inProgressEpics: viewModel.inProgressEpics,
                    completedEpics: viewModel.completedEpics,
                    onTap: { coordinator.navigate(to: .beads) }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)
            }
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
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
            if viewModel.isLoading && viewModel.unreadMessages.isEmpty {
                LoadingIndicator(size: .large, text: "LOADING")
            }
        }
    }
}

// MARK: - Chat-style timestamp formatting

/// Formats a date string like "2/26 8:23pm" matching the chat bubble style.
private func formatChatTimestamp(_ dateString: String) -> String {
    // Parse ISO 8601 / SQLite datetime
    let date: Date
    if let d = ISO8601DateFormatter().date(from: dateString) {
        date = d
    } else {
        // Try SQLite format: "2026-02-27 02:35:34"
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        fmt.timeZone = TimeZone(identifier: "UTC")
        guard let d = fmt.date(from: dateString) else { return dateString }
        date = d
    }

    let formatter = DateFormatter()
    let calendar = Calendar.current

    if calendar.isDateInToday(date) {
        formatter.dateFormat = "h:mma"
    } else if calendar.component(.year, from: date) ==
              calendar.component(.year, from: Date()) {
        formatter.dateFormat = "M/d h:mma"
    } else {
        formatter.dateFormat = "M/d/yy h:mma"
    }

    formatter.amSymbol = "am"
    formatter.pmSymbol = "pm"
    return formatter.string(from: date)
}

// MARK: - Unread Messages Widget

private struct UnreadMessagesWidget: View {
    @Environment(\.crtTheme) private var theme

    let messages: [UnreadAgentSummary]
    let onAgentTap: (String) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                HStack {
                    Image(systemName: "envelope.badge.fill")
                        .foregroundColor(theme.primary)
                    CRTText("UNREAD MESSAGES", style: .subheader)

                    Spacer()

                    if !messages.isEmpty {
                        let total = messages.reduce(0) { $0 + $1.unreadCount }
                        BadgeView("\(total) UNREAD", style: .status(.warning))
                    }
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if messages.isEmpty {
                    EmptyStateView(
                        title: "NO UNREAD MESSAGES",
                        icon: "envelope.open"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(messages) { agent in
                            Button(action: { onAgentTap(agent.agentId) }) {
                                UnreadAgentRow(agent: agent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }
}

private struct UnreadAgentRow: View {
    @Environment(\.crtTheme) private var theme
    let agent: UnreadAgentSummary

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Agent name
            CRTText(
                agent.agentId.uppercased(),
                style: .caption,
                color: theme.primary
            )
            .lineLimit(1)
            .frame(minWidth: 60, alignment: .leading)

            // Message preview
            CRTText(
                truncatedBody,
                style: .caption,
                color: theme.dim
            )
            .lineLimit(1)

            Spacer()

            // Unread count badge
            BadgeView("\(agent.unreadCount)", style: .count)

            Image(systemName: "chevron.right")
                .font(.system(size: 10))
                .foregroundColor(theme.dim)
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
    }

    private var truncatedBody: String {
        let oneLine = agent.latestBody.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if oneLine.count <= 60 { return oneLine }
        return String(oneLine.prefix(60)) + "..."
    }
}

// MARK: - Tasks Widget

private struct TasksWidget: View {
    @Environment(\.crtTheme) private var theme

    let inProgressTasks: [BeadInfo]
    let recentCompletedTasks: [BeadInfo]
    let onTap: () -> Void
    let onBeadTap: (BeadInfo) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "checklist")
                            .foregroundColor(theme.primary)
                        CRTText("TASKS", style: .subheader)

                        Spacer()

                        if inProgressTasks.count > 0 {
                            BadgeView("\(inProgressTasks.count) ACTIVE", style: .status(.success))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                if inProgressTasks.isEmpty && recentCompletedTasks.isEmpty {
                    EmptyStateView(
                        title: "NO TASKS",
                        icon: "tray"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    // In Progress
                    if !inProgressTasks.isEmpty {
                        CRTText("IN PROGRESS", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(inProgressTasks.prefix(5)) { bead in
                                Button(action: { onBeadTap(bead) }) {
                                    TaskRow(bead: bead, completedAt: nil)
                                }
                                .buttonStyle(.plain)
                            }
                            if inProgressTasks.count > 5 {
                                CRTText("+\(inProgressTasks.count - 5) more", style: .caption, color: theme.dim)
                                    .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                    }

                    // Recently Completed
                    if !recentCompletedTasks.isEmpty {
                        if !inProgressTasks.isEmpty {
                            Divider()
                                .background(theme.dim.opacity(0.2))
                                .padding(.vertical, CRTTheme.Spacing.xxs)
                        }
                        CRTText("RECENTLY COMPLETED", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(recentCompletedTasks.prefix(5)) { bead in
                                Button(action: { onBeadTap(bead) }) {
                                    TaskRow(bead: bead, completedAt: bead.updatedAt)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct TaskRow: View {
    @Environment(\.crtTheme) private var theme
    let bead: BeadInfo
    let completedAt: String?

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            CRTText(bead.id.uppercased(), style: .caption, color: theme.dim)
                .lineLimit(1)

            CRTText(bead.title, style: .caption, color: theme.primary)
                .lineLimit(1)

            Spacer()

            if let ts = completedAt {
                CRTText(formatChatTimestamp(ts), style: .caption, color: theme.dim)
            }

            if let priority = bead.priorityLevel {
                CRTText("P\(priority.rawValue)", style: .caption, color: priorityColor(priority))
            }
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(theme.dim.opacity(0.15), lineWidth: 1)
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

// MARK: - Epics Overview Widget

private struct EpicsOverviewWidget: View {
    @Environment(\.crtTheme) private var theme

    let inProgressEpics: [DashboardEpicItem]
    let completedEpics: [DashboardEpicItem]
    let onTap: () -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "flag.fill")
                            .foregroundColor(theme.primary)
                        CRTText("EPICS", style: .subheader)

                        Spacer()

                        if inProgressEpics.count > 0 {
                            BadgeView("\(inProgressEpics.count) ACTIVE", style: .status(.success))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                if inProgressEpics.isEmpty && completedEpics.isEmpty {
                    EmptyStateView(
                        title: "NO EPICS",
                        icon: "flag"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    // In Progress
                    if !inProgressEpics.isEmpty {
                        CRTText("IN PROGRESS", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(inProgressEpics.prefix(5)) { item in
                                EpicOverviewRow(item: item, completedAt: nil)
                            }
                            if inProgressEpics.count > 5 {
                                CRTText("+\(inProgressEpics.count - 5) more", style: .caption, color: theme.dim)
                                    .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                    }

                    // Recently Completed
                    if !completedEpics.isEmpty {
                        if !inProgressEpics.isEmpty {
                            Divider()
                                .background(theme.dim.opacity(0.2))
                                .padding(.vertical, CRTTheme.Spacing.xxs)
                        }
                        CRTText("RECENTLY COMPLETED", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(completedEpics.prefix(5)) { item in
                                EpicOverviewRow(item: item, completedAt: item.epic.updatedAt)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct EpicOverviewRow: View {
    @Environment(\.crtTheme) private var theme
    let item: DashboardEpicItem
    let completedAt: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                CRTText(item.epic.id.uppercased(), style: .caption, color: theme.dim)
                CRTText(item.epic.title, style: .caption, color: theme.primary)
                    .lineLimit(1)
                Spacer()
                if let ts = completedAt {
                    CRTText(formatChatTimestamp(ts), style: .caption, color: theme.dim)
                }
            }

            // Progress bar
            HStack(spacing: CRTTheme.Spacing.xs) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(theme.dim.opacity(0.15))
                            .frame(height: 6)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(progressColor)
                            .frame(width: geo.size.width * item.progress, height: 6)
                    }
                }
                .frame(height: 6)

                CRTText(
                    "\(item.closedCount)/\(item.totalCount)",
                    style: .caption,
                    color: theme.dim
                )
                .frame(minWidth: 40, alignment: .trailing)
            }
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(progressColor.opacity(0.3), lineWidth: 1)
        )
    }

    private var progressColor: Color {
        if item.epic.status == "closed" || item.progress >= 1.0 {
            return .green
        } else if item.progress > 0.5 {
            return theme.primary
        } else if item.progress > 0 {
            return .orange
        }
        return theme.dim
    }
}

// MARK: - Preview

#Preview("Dashboard") {
    DashboardView()
        .environmentObject(AppCoordinator())
}
