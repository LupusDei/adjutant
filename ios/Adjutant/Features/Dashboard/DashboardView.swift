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

                // Widget Grid
                LazyVGrid(columns: gridColumns, spacing: CRTTheme.Spacing.md) {
                    // Mail Widget
                    MailWidget(
                        unreadCount: viewModel.unreadCount,
                        recentMessages: viewModel.recentMail,
                        onTap: { coordinator.navigate(to: .mail) },
                        onMessageTap: { message in
                            coordinator.navigate(to: .mailDetail(id: message.id))
                        }
                    )

                    // Crew Widget
                    CrewWidget(
                        crewMembers: viewModel.activeCrewMembers,
                        issueCount: viewModel.crewWithIssues,
                        onTap: { coordinator.navigate(to: .crew) },
                        onMemberTap: { member in
                            coordinator.navigate(to: .agentDetail(member: member))
                        }
                    )

                    // Convoy Widget
                    ConvoyWidget(
                        convoys: viewModel.convoys,
                        totalProgress: viewModel.totalConvoyProgress,
                        onTap: { coordinator.navigate(to: .convoys) },
                        onConvoyTap: { convoy in
                            coordinator.navigate(to: .convoyDetail(id: convoy.id))
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

// MARK: - Convoy Widget

private struct ConvoyWidget: View {
    @Environment(\.crtTheme) private var theme

    let convoys: [Convoy]
    let totalProgress: Double
    let onTap: () -> Void
    let onConvoyTap: (Convoy) -> Void

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                Button(action: onTap) {
                    HStack {
                        Image(systemName: "shippingbox.fill")
                            .foregroundColor(theme.primary)
                        CRTText("CONVOYS", style: .subheader)

                        Spacer()

                        if !convoys.isEmpty {
                            CRTText("\(Int(totalProgress * 100))%", style: .mono, glowIntensity: .subtle)
                        }

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Convoy list
                if convoys.isEmpty {
                    EmptyStateView(
                        title: "NO ACTIVE CONVOYS",
                        icon: "checkmark.circle"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ForEach(convoys.prefix(3)) { convoy in
                        Button(action: { onConvoyTap(convoy) }) {
                            ConvoyProgressRow(convoy: convoy)
                        }
                        .buttonStyle(.plain)
                    }

                    if convoys.count > 3 {
                        Button(action: onTap) {
                            HStack {
                                Spacer()
                                CRTText("VIEW ALL (\(convoys.count))", style: .caption, color: theme.primary)
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

private struct ConvoyProgressRow: View {
    @Environment(\.crtTheme) private var theme
    let convoy: Convoy

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack {
                CRTText(convoy.title, style: .body)
                    .lineLimit(1)

                Spacer()

                CRTText(
                    "\(convoy.progress.completed)/\(convoy.progress.total)",
                    style: .mono,
                    color: theme.dim
                )
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.dim.opacity(0.2))
                        .frame(height: 4)

                    // Progress
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.primary)
                        .frame(width: geometry.size.width * convoy.progress.percentage, height: 4)
                        .crtGlow(color: theme.primary, radius: 3, intensity: 0.4)
                }
            }
            .frame(height: 4)

            if let rig = convoy.rig {
                CRTText("RIG: \(rig.uppercased())", style: .caption, color: theme.dim)
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
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
