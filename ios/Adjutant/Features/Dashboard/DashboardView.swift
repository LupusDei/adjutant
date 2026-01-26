import SwiftUI
import AdjutantKit

/// Main dashboard view with widget grid for Mail, Crew, and Convoy status.
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

                // Beads Kanban Preview (top, full width)
                BeadsKanbanWidget(
                    beadsByColumn: viewModel.beadsByColumn,
                    openCount: viewModel.openBeadsCount,
                    activeCount: viewModel.activeBeadsCount,
                    onTap: { coordinator.navigate(to: .beads) },
                    onBeadTap: { bead in
                        coordinator.navigate(to: .beadDetail(id: bead.id))
                    }
                )
                .padding(.horizontal, CRTTheme.Spacing.md)

                // Bottom row: Crew + Mail
                LazyVGrid(columns: gridColumns, spacing: CRTTheme.Spacing.md) {
                    // Crew Widget
                    CrewWidget(
                        crewMembers: viewModel.activeCrewMembers,
                        issueCount: viewModel.crewWithIssues,
                        onTap: { coordinator.navigate(to: .crew) },
                        onMemberTap: { member in
                            coordinator.navigate(to: .agentDetail(member: member))
                        }
                    )

                    // Mail Widget (moved from top)
                    MailWidget(
                        unreadCount: viewModel.unreadCount,
                        recentMessages: viewModel.recentMail,
                        onTap: { coordinator.navigate(to: .mail) },
                        onMessageTap: { message in
                            coordinator.navigate(to: .mailDetail(id: message.id))
                        }
                    )
                }
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

    // MARK: - Subviews

    private var gridColumns: [GridItem] {
        [GridItem(.flexible(), spacing: CRTTheme.Spacing.md)]
    }
}

// MARK: - Mail Widget

private struct MailWidget: View {
    @Environment(\.crtTheme) private var theme

    let unreadCount: Int
    let recentMessages: [Message]
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
                            BadgeView("\(unreadCount)", style: .count)
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
                if recentMessages.isEmpty {
                    EmptyStateView(
                        title: "NO MESSAGES",
                        icon: "envelope.open"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ForEach(recentMessages.prefix(3)) { message in
                        Button(action: { onMessageTap(message) }) {
                            MailPreviewRow(message: message)
                        }
                        .buttonStyle(.plain)
                    }

                    if recentMessages.count > 3 {
                        Button(action: onTap) {
                            HStack {
                                Spacer()
                                CRTText("VIEW ALL", style: .caption, color: theme.primary)
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

private struct MailPreviewRow: View {
    @Environment(\.crtTheme) private var theme
    let message: Message

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            // Unread indicator
            Circle()
                .fill(message.read ? Color.clear : theme.primary)
                .frame(width: 6, height: 6)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    CRTText(message.senderName, style: .body, color: message.read ? theme.dim : theme.primary)
                        .lineLimit(1)

                    Spacer()

                    if let date = message.date {
                        CRTText(date.relativeFormat, style: .caption, color: theme.dim)
                    }
                }

                CRTText(message.subject, style: .caption, color: theme.dim)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
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
        HStack(spacing: CRTTheme.Spacing.xs) {
            StatusDot(statusType, size: 8, pulse: member.status == .working)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    CRTText(member.name.uppercased(), style: .body)
                        .lineLimit(1)

                    Spacer()

                    BadgeView(member.type.rawValue.uppercased(), style: .tag)
                }

                if let task = member.currentTask {
                    CRTText(task, style: .caption, color: theme.dim)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    private var statusType: BadgeView.Style.StatusType {
        switch member.status {
        case .working: return .success
        case .idle: return .info
        case .blocked: return .warning
        case .stuck: return .error
        case .offline: return .offline
        }
    }
}

// MARK: - Beads Kanban Widget

private struct BeadsKanbanWidget: View {
    @Environment(\.crtTheme) private var theme

    let beadsByColumn: [KanbanColumnId: [BeadInfo]]
    let openCount: Int
    let activeCount: Int
    let onTap: () -> Void
    let onBeadTap: (BeadInfo) -> Void

    /// Columns to display in the preview (excludes CLOSED for compactness)
    private let displayColumns: [KanbanColumnDefinition] = [
        kanbanColumns[0], // OPEN
        kanbanColumns[1], // HOOKED
        kanbanColumns[2], // IN PROGRESS
        kanbanColumns[4], // BLOCKED
    ]

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "circle.grid.3x3")
                            .foregroundColor(theme.primary)
                        CRTText("WORK BOARD", style: .subheader)

                        Spacer()

                        if openCount > 0 {
                            BadgeView("\(openCount) OPEN", style: .status(.success))
                        }

                        if activeCount > 0 {
                            BadgeView("\(activeCount) ACTIVE", style: .status(.info))
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Kanban columns preview
                if isEmpty {
                    EmptyStateView(
                        title: "NO BEADS",
                        icon: "circle.grid.3x3"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
                            ForEach(displayColumns, id: \.id) { column in
                                KanbanPreviewColumn(
                                    column: column,
                                    beads: beadsByColumn[column.id] ?? [],
                                    onBeadTap: onBeadTap
                                )
                                .frame(width: 140)
                            }
                        }
                        .padding(.vertical, CRTTheme.Spacing.xxs)
                    }

                    // View all button
                    Button(action: onTap) {
                        HStack {
                            Spacer()
                            CRTText("VIEW FULL BOARD", style: .caption, color: theme.primary)
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

    private var isEmpty: Bool {
        beadsByColumn.values.allSatisfy { $0.isEmpty }
    }
}

/// Compact column view for the Kanban preview on the dashboard
private struct KanbanPreviewColumn: View {
    @Environment(\.crtTheme) private var theme

    let column: KanbanColumnDefinition
    let beads: [BeadInfo]
    let onBeadTap: (BeadInfo) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Column header
            HStack {
                Text(column.title)
                    .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                    .foregroundColor(column.color)
                    .tracking(0.5)

                Spacer()

                Text("\(beads.count)")
                    .font(CRTTheme.Typography.font(size: 9))
                    .foregroundColor(theme.dim)
            }
            .padding(.horizontal, CRTTheme.Spacing.xxs)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(CRTTheme.Background.elevated)
            .overlay(
                Rectangle()
                    .fill(column.color)
                    .frame(height: 2),
                alignment: .bottom
            )

            // Beads
            if beads.isEmpty {
                Text("—")
                    .font(CRTTheme.Typography.font(size: 9))
                    .foregroundColor(theme.dim.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.md)
            } else {
                VStack(spacing: CRTTheme.Spacing.xxs) {
                    ForEach(beads.prefix(3)) { bead in
                        Button(action: { onBeadTap(bead) }) {
                            BeadPreviewCard(bead: bead)
                        }
                        .buttonStyle(.plain)
                    }

                    if beads.count > 3 {
                        Text("+\(beads.count - 3) more")
                            .font(CRTTheme.Typography.font(size: 8))
                            .foregroundColor(theme.dim)
                    }
                }
                .padding(CRTTheme.Spacing.xxs)
            }
        }
        .background(CRTTheme.Background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
    }
}

/// Compact bead card for the dashboard preview
private struct BeadPreviewCard: View {
    @Environment(\.crtTheme) private var theme
    let bead: BeadInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // ID + Priority
            HStack {
                Text(bead.id)
                    .font(CRTTheme.Typography.font(size: 8, weight: .bold))
                    .foregroundColor(theme.bright)
                    .lineLimit(1)

                Spacer()

                BadgeView("P\(bead.priority)", style: .priority(bead.priority))
            }

            // Title
            Text(bead.title)
                .font(CRTTheme.Typography.font(size: 9))
                .foregroundColor(theme.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(CRTTheme.Spacing.xxs)
        .background(CRTTheme.Background.elevated)
        .cornerRadius(CRTTheme.CornerRadius.sm)
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
