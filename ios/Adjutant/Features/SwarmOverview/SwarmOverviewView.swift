import SwiftUI
import AdjutantKit

/// Swarm Overview page — aggregated project dashboard showing agents, unread messages, tasks, and epics.
struct SwarmOverviewView: View {
    @StateObject private var viewModel = SwarmOverviewViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @Environment(\.crtTheme) private var theme
    @State private var skeletonPulse = false

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoading && viewModel.overview == nil {
                loadingSkeleton
            } else if let error = viewModel.errorMessage, viewModel.overview == nil {
                errorView(error)
            } else if let overview = viewModel.overview {
                overviewContent(overview)
            } else {
                emptyView
            }
        }
        .background(theme.background.screen)
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
        .onChange(of: viewModel.spawnedSessionId) { _, newId in
            if let sessionId = newId {
                coordinator.pendingChatAgentId = sessionId
                coordinator.selectTab(.chat)
                viewModel.spawnedSessionId = nil
            }
        }
        .sheet(isPresented: $viewModel.showingCallsignPicker) {
            CallsignPickerView { callsign in
                viewModel.showingCallsignPicker = false
                Task<Void, Never> { await viewModel.startAgent(callsign: callsign) }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func overviewContent(_ overview: ProjectOverviewResponse) -> some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.lg) {
                // Stale data banner
                if viewModel.errorMessage != nil {
                    staleDataBanner
                }

                // 1. Agents with status (top element)
                agentsSection(overview.agents)

                // 2. Unread messages grouped by agent
                unreadMessagesSection(overview.unreadMessages ?? [])

                // 3. Tasks: In Progress + Recently Completed
                tasksSection(overview.beads)

                // 4. Epics: In Progress + Recently Completed
                epicsSection(overview.epics)
            }
            .padding(.vertical, CRTTheme.Spacing.md)
            .padding(.horizontal, CRTTheme.Spacing.md)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Agents Section

    @ViewBuilder
    private func agentsSection(_ agents: [AgentOverview]) -> some View {
        CRTCard(header: "AGENTS", headerBadge: "\(agents.count)") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Start Agent button
                CRTButton("START AGENT", variant: .secondary, size: .medium) {
                    Task<Void, Never> { await viewModel.startAgent() }
                }
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.5)
                        .onEnded { _ in
                            viewModel.showingCallsignPicker = true
                        }
                )

                if agents.isEmpty {
                    VStack(spacing: CRTTheme.Spacing.sm) {
                        Image(systemName: "person.3")
                            .font(.system(size: 32))
                            .foregroundColor(theme.dim)
                        CRTText("NO ACTIVE AGENTS", style: .caption, color: theme.dim)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(agents) { agent in
                            Button {
                                coordinator.navigate(to: .agentDetail(member: crewMember(from: agent)))
                            } label: {
                                agentRow(agent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func agentRow(_ agent: AgentOverview) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot
            Circle()
                .fill(statusColor(for: agent.status))
                .frame(width: 8, height: 8)

            // Name + status title (task description)
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                CRTText(agent.name.uppercased(), style: .body)
                if let task = agent.currentBead {
                    CRTText(task, style: .caption, color: theme.dim)
                        .lineLimit(1)
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
                CRTText("\(agent.unreadCount)", style: .caption, color: .black)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.primary)
                    .clipShape(Capsule())
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(theme.dim)
        }
        .padding(.vertical, CRTTheme.Spacing.xs)
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(statusColor(for: agent.status).opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Unread Messages Section

    @ViewBuilder
    private func unreadMessagesSection(_ messages: [OverviewUnreadSummary]) -> some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
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
                        ForEach(messages) { msg in
                            Button(action: {
                                coordinator.pendingChatAgentId = msg.agentId
                                coordinator.selectTab(.chat)
                            }) {
                                unreadRow(msg)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func unreadRow(_ msg: OverviewUnreadSummary) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTText(
                msg.agentId.uppercased(),
                style: .caption,
                color: theme.primary
            )
            .lineLimit(1)
            .frame(minWidth: 60, alignment: .leading)

            CRTText(
                truncatedBody(msg.latestBody),
                style: .caption,
                color: theme.dim
            )
            .lineLimit(1)

            Spacer()

            BadgeView("\(msg.unreadCount)", style: .count)

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

    // MARK: - Tasks Section

    @ViewBuilder
    private func tasksSection(_ beads: BeadsOverview) -> some View {
        let tasks = filterTasks(beads)
        let inProgress = tasks.filter { $0.status == "in_progress" }
        let completed = tasks.filter { $0.status == "closed" }

        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                Button(action: { coordinator.navigate(to: .beads) }) {
                    HStack {
                        Image(systemName: "checklist")
                            .foregroundColor(theme.primary)
                        CRTText("TASKS", style: .subheader)
                        Spacer()
                        if !inProgress.isEmpty {
                            BadgeView("\(inProgress.count) ACTIVE", style: .status(.success))
                        }
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                if inProgress.isEmpty && completed.isEmpty {
                    EmptyStateView(title: "NO TASKS", icon: "tray")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    if !inProgress.isEmpty {
                        CRTText("IN PROGRESS", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(inProgress.prefix(7)) { bead in
                                Button(action: { coordinator.navigate(to: .beadDetail(id: bead.id)) }) {
                                    taskRow(bead, completedAt: nil)
                                }
                                .buttonStyle(.plain)
                            }
                            if inProgress.count > 7 {
                                CRTText("+\(inProgress.count - 7) more", style: .caption, color: theme.dim)
                                    .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                    }

                    if !completed.isEmpty {
                        if !inProgress.isEmpty {
                            Divider()
                                .background(theme.dim.opacity(0.2))
                                .padding(.vertical, CRTTheme.Spacing.xxs)
                        }
                        CRTText("RECENTLY COMPLETED", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(completed.prefix(5)) { bead in
                                Button(action: { coordinator.navigate(to: .beadDetail(id: bead.id)) }) {
                                    taskRow(bead, completedAt: bead.closedAt ?? bead.updatedAt)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }

    private func taskRow(_ bead: OverviewBeadSummary, completedAt: String?) -> some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            CRTText(bead.id.uppercased(), style: .caption, color: theme.dim)
                .lineLimit(1)

            CRTText(bead.title, style: .caption, color: theme.primary)
                .lineLimit(1)

            Spacer()

            if let ts = completedAt {
                CRTText(formatChatTimestamp(ts), style: .caption, color: theme.dim)
            }

            CRTText("P\(bead.priority)", style: .caption, color: priorityColor(bead.priority))
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

    // MARK: - Epics Section

    @ViewBuilder
    private func epicsSection(_ epics: EpicsOverview) -> some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                Button(action: { coordinator.navigate(to: .epics) }) {
                    HStack {
                        Image(systemName: "flag.fill")
                            .foregroundColor(theme.primary)
                        CRTText("EPICS", style: .subheader)
                        Spacer()
                        if !epics.inProgress.isEmpty {
                            BadgeView("\(epics.inProgress.count) ACTIVE", style: .status(.success))
                        }
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(theme.dim)
                    }
                }
                .buttonStyle(.plain)

                Divider()
                    .background(theme.dim.opacity(0.3))

                if epics.inProgress.isEmpty && epics.recentlyCompleted.isEmpty {
                    EmptyStateView(title: "NO EPICS", icon: "flag")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    if !epics.inProgress.isEmpty {
                        CRTText("IN PROGRESS", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(epics.inProgress.prefix(5)) { epic in
                                Button(action: { coordinator.navigate(to: .epicDetail(id: epic.id)) }) {
                                    epicRow(epic, completedAt: nil)
                                }
                                .buttonStyle(.plain)
                            }
                            if epics.inProgress.count > 5 {
                                CRTText("+\(epics.inProgress.count - 5) more", style: .caption, color: theme.dim)
                                    .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                    }

                    if !epics.recentlyCompleted.isEmpty {
                        if !epics.inProgress.isEmpty {
                            Divider()
                                .background(theme.dim.opacity(0.2))
                                .padding(.vertical, CRTTheme.Spacing.xxs)
                        }
                        CRTText("RECENTLY COMPLETED", style: .caption, color: theme.dim)
                        VStack(spacing: CRTTheme.Spacing.xs) {
                            ForEach(epics.recentlyCompleted.prefix(5)) { epic in
                                Button(action: { coordinator.navigate(to: .epicDetail(id: epic.id)) }) {
                                    epicRow(epic, completedAt: epic.closedAt)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }

    private func epicRow(_ epic: EpicProgress, completedAt: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                CRTText(epic.id.uppercased(), style: .caption, color: theme.dim)
                CRTText(epic.title, style: .caption, color: theme.primary)
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
                            .fill(epicProgressColor(epic))
                            .frame(width: geo.size.width * epic.completionPercent, height: 6)
                    }
                }
                .frame(height: 6)

                CRTText(
                    "\(epic.closedChildren)/\(epic.totalChildren)",
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
                .stroke(epicProgressColor(epic).opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - States

    private var loadingSkeleton: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            CRTText("LOADING OVERVIEW...", style: .caption, color: theme.dim)
                .opacity(skeletonPulse ? 0.8 : 0.3)
                .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: skeletonPulse)
                .onAppear { skeletonPulse = true }

            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.dim.opacity(skeletonPulse ? 0.12 : 0.06))
                        .frame(width: 120, height: 16)
                    ForEach(0..<2, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .fill(theme.dim.opacity(skeletonPulse ? 0.08 : 0.03))
                            .frame(height: 44)
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
            }
            .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: skeletonPulse)
        }
        .padding(.vertical, CRTTheme.Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func errorView(_ error: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.warning)

            CRTText("CONNECTION ERROR", style: .subheader, color: CRTTheme.State.warning)
            CRTText(error, style: .caption, color: theme.dim)
                .multilineTextAlignment(.center)

            CRTButton("RETRY", variant: .secondary, size: .medium) {
                viewModel.clearError()
                Task<Void, Never> { await viewModel.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var staleDataBanner: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(CRTTheme.State.warning)
                .font(.system(size: 12))
            VStack(alignment: .leading, spacing: 2) {
                CRTText("USING CACHED DATA", style: .caption, color: CRTTheme.State.warning)
                if let error = viewModel.errorMessage {
                    CRTText(error, style: .caption, color: theme.dim.opacity(0.6))
                }
            }
            Spacer()
            Button {
                viewModel.clearError()
                Task<Void, Never> { await viewModel.refresh() }
            } label: {
                CRTText("RETRY", style: .caption, color: CRTTheme.State.warning)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(CRTTheme.State.warning.opacity(0.1))
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 40))
                .foregroundColor(theme.dim)
            CRTText("NO DATA", style: .subheader, color: theme.dim)
            CRTText("Could not load overview", style: .caption, color: theme.dim.opacity(0.6))

            CRTButton("RETRY", variant: .secondary, size: .medium) {
                Task<Void, Never> { await viewModel.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Helpers

    private func crewMember(from agent: AgentOverview) -> CrewMember {
        CrewMember(
            id: agent.id,
            name: agent.name,
            type: .agent,
            rig: nil,
            status: CrewMemberStatus(rawValue: agent.status) ?? .idle,
            currentTask: agent.currentBead,
            unreadMail: agent.unreadCount,
            sessionId: agent.sessionId
        )
    }

    private func statusColor(for status: String) -> Color {
        switch status.lowercased() {
        case "working": return CRTTheme.State.success
        case "idle": return CRTTheme.State.info
        case "blocked": return CRTTheme.State.error
        default: return CRTTheme.State.offline
        }
    }

    private func epicProgressColor(_ epic: EpicProgress) -> Color {
        if epic.status == "closed" || epic.completionPercent >= 1.0 {
            return .green
        } else if epic.completionPercent > 0.5 {
            return theme.primary
        } else if epic.completionPercent > 0 {
            return .orange
        }
        return theme.dim
    }

    private func priorityColor(_ priority: Int) -> Color {
        switch priority {
        case 0: return .red
        case 1: return .orange
        case 2: return theme.primary
        default: return theme.dim
        }
    }

    /// Filter beads to non-epic tasks only
    private func filterTasks(_ beads: BeadsOverview) -> [OverviewBeadSummary] {
        let all = beads.inProgress + beads.recentlyClosed
        return all.filter { $0.type != "epic" }
    }

    private func truncatedBody(_ body: String) -> String {
        let oneLine = body.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if oneLine.count <= 60 { return oneLine }
        return String(oneLine.prefix(60)) + "..."
    }

    /// Formats a date string like "2/26 8:23pm" matching the chat bubble style.
    private func formatChatTimestamp(_ dateString: String) -> String {
        let date: Date
        if let d = ISO8601DateFormatter().date(from: dateString) {
            date = d
        } else {
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
}
