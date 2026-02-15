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
                    title: "ADJUTANT",
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

                // Projects Widget (full width)
                ProjectsWidget(
                    rigs: viewModel.rigStatuses,
                    onTap: { rig in
                        coordinator.navigate(to: .projectDetail(rig: rig))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Mail Widget with recent messages (full width)
                MailWidget(
                    recentMail: viewModel.recentMail,
                    unreadCount: viewModel.unreadCount,
                    onTap: { coordinator.navigate(to: .mail) },
                    onMessageTap: { message in
                        coordinator.navigate(to: .mailDetail(id: message.id))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Crew Widget with Active Crew list (full width)
                CrewWidget(
                    activeCrewMembers: viewModel.activeCrewMembers,
                    issueCount: viewModel.crewWithIssues,
                    onTap: { coordinator.navigate(to: .crew) },
                    onMemberTap: { member in
                        coordinator.navigate(to: .agentDetail(member: member))
                    }
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
                            // Hooked column (first - work to start)
                            KanbanColumnPreview(
                                title: "HOOKED",
                                beads: hookedBeads,
                                color: CRTTheme.State.info,
                                onBeadTap: onBeadTap
                            )

                            // In Progress column (second - active work)
                            KanbanColumnPreview(
                                title: "IN PROGRESS",
                                beads: inProgressBeads,
                                color: CRTTheme.State.success,
                                onBeadTap: onBeadTap
                            )

                            // Closed column (third - completed work)
                            KanbanColumnPreview(
                                title: "CLOSED",
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

// MARK: - Crew Widget with Active Crew List

private struct CrewWidget: View {
    @Environment(\.crtTheme) private var theme

    let activeCrewMembers: [CrewMember]
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

                        if activeCrewMembers.count > 0 {
                            BadgeView("\(activeCrewMembers.count) ACTIVE", style: .status(.success))
                        }

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

                // Active crew list
                if activeCrewMembers.isEmpty {
                    EmptyStateView(
                        title: "NO ACTIVE CREW",
                        icon: "person.slash"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(activeCrewMembers.prefix(5)) { member in
                            Button(action: { onMemberTap(member) }) {
                                CrewPreviewRow(member: member)
                            }
                            .buttonStyle(.plain)
                        }

                        if activeCrewMembers.count > 5 {
                            CRTText("+\(activeCrewMembers.count - 5) more", style: .caption, color: theme.dim)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, CRTTheme.Spacing.xxs)
                        }
                    }
                }
            }
        }
    }
}

private struct CrewPreviewRow: View {
    @Environment(\.crtTheme) private var theme
    let member: CrewMember

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status indicator
            StatusDot(statusType, size: 8, pulse: shouldPulse)

            // Name and rig
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    CRTText(
                        member.name.uppercased(),
                        style: .caption,
                        color: theme.primary
                    )
                    .lineLimit(1)

                    if let rig = member.rig {
                        CRTText("[\(rig)]", style: .caption, color: theme.dim)
                            .lineLimit(1)
                    }
                }

                // Status or current task
                if let task = member.currentTask {
                    CRTText(task, style: .caption, color: theme.dim)
                        .lineLimit(1)
                } else {
                    CRTText(statusDisplayText, style: .caption, color: statusColor)
                }
            }

            Spacer()

            // Unread mail indicator
            if member.unreadMail > 0 {
                BadgeView("\(member.unreadMail)", style: .count)
            }
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(statusColor.opacity(0.3), lineWidth: 1)
        )
    }

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
}

// MARK: - Projects Widget

private struct ProjectsWidget: View {
    @Environment(\.crtTheme) private var theme

    let rigs: [RigStatus]
    let onTap: (RigStatus) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundColor(theme.primary)
                    CRTText("PROJECTS", style: .subheader)

                    Spacer()

                    if !rigs.isEmpty {
                        BadgeView("\(rigs.count) RIGS", style: .status(.info))
                    }
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Project list
                if rigs.isEmpty {
                    EmptyStateView(
                        title: "NO PROJECTS",
                        icon: "folder"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(rigs.prefix(4), id: \.name) { rig in
                            Button(action: { onTap(rig) }) {
                                ProjectPreviewRow(rig: rig)
                            }
                            .buttonStyle(.plain)
                        }

                        if rigs.count > 4 {
                            CRTText("+\(rigs.count - 4) more", style: .caption, color: theme.dim)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, CRTTheme.Spacing.xxs)
                        }
                    }
                }
            }
        }
    }
}

private struct ProjectPreviewRow: View {
    @Environment(\.crtTheme) private var theme
    let rig: RigStatus

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot
            StatusDot(hasRunning ? .success : .offline, size: 8, pulse: hasRunning)

            // Name
            CRTText(rig.name.uppercased(), style: .caption, color: theme.primary)
                .lineLimit(1)

            Spacer()

            // Agent count
            CRTText("\(runningCount)/\(totalCount)", style: .caption, color: theme.dim)

            // Merge queue indicator
            if mergeQueueTotal > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.triangle.merge")
                        .font(.system(size: 9))
                        .foregroundColor(theme.dim)
                    CRTText("\(mergeQueueTotal)", style: .caption, color: theme.dim)
                }
            }

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
                .stroke(hasRunning ? theme.primary.opacity(0.2) : theme.dim.opacity(0.15), lineWidth: 1)
        )
    }

    private var runningCount: Int {
        var count = 0
        if rig.witness.running { count += 1 }
        if rig.refinery.running { count += 1 }
        count += rig.crew.filter { $0.running }.count
        count += rig.polecats.filter { $0.running }.count
        return count
    }

    private var totalCount: Int {
        2 + rig.crew.count + rig.polecats.count
    }

    private var hasRunning: Bool {
        runningCount > 0
    }

    private var mergeQueueTotal: Int {
        rig.mergeQueue.pending + rig.mergeQueue.inFlight + rig.mergeQueue.blocked
    }
}

// MARK: - Compact Widgets (Unused)

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

// MARK: - Mail Widget with Recent Messages

private struct MailWidget: View {
    @Environment(\.crtTheme) private var theme

    let recentMail: [Message]
    let unreadCount: Int
    let onTap: () -> Void
    let onMessageTap: (Message) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "envelope.fill")
                            .foregroundColor(theme.primary)
                        CRTText("MAIL", style: .subheader)

                        Spacer()

                        if unreadCount > 0 {
                            BadgeView("\(unreadCount) UNREAD", style: .status(.warning))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Recent messages
                if recentMail.isEmpty {
                    EmptyStateView(
                        title: "NO RECENT MAIL",
                        icon: "envelope"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(recentMail) { message in
                            Button(action: { onMessageTap(message) }) {
                                MailPreviewRow(message: message)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }
}

private struct MailPreviewRow: View {
    @Environment(\.crtTheme) private var theme
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
            // Unread indicator
            Circle()
                .fill(message.read ? Color.clear : theme.bright)
                .frame(width: 6, height: 6)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                // Top row: Sender and time
                HStack {
                    CRTText(
                        message.senderName.uppercased(),
                        style: .caption,
                        color: message.read ? theme.primary : theme.bright
                    )
                    .lineLimit(1)

                    Spacer()

                    CRTText(formattedDate, style: .caption, color: theme.dim)
                }

                // Subject
                CRTText(
                    message.subject,
                    style: .caption,
                    color: message.read ? theme.primary.opacity(0.8) : theme.primary
                )
                .lineLimit(1)
            }

            // Priority indicator
            if message.priority.rawValue <= MessagePriority.high.rawValue {
                priorityIndicator
            }
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(message.read ? theme.dim.opacity(0.05) : theme.dim.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(
                    message.read ? theme.dim.opacity(0.2) : theme.primary.opacity(0.3),
                    lineWidth: 1
                )
        )
    }

    private var formattedDate: String {
        guard let date = message.date else { return "" }

        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            return formatter.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return "YEST"
        } else if calendar.isDate(date, equalTo: now, toGranularity: .weekOfYear) {
            let formatter = DateFormatter()
            formatter.dateFormat = "EEE"
            return formatter.string(from: date).uppercased()
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "M/d"
            return formatter.string(from: date)
        }
    }

    @ViewBuilder
    private var priorityIndicator: some View {
        let color: Color = message.priority == .urgent ? .red : .orange
        Circle()
            .fill(color)
            .frame(width: 6, height: 6)
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
