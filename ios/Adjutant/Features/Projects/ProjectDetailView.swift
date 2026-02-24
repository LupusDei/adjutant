import SwiftUI
import AdjutantKit

/// Detail view for a single project (rig), showing its agents with status,
/// spawn controls, and merge queue info.
struct ProjectDetailView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ProjectDetailViewModel
    @EnvironmentObject private var coordinator: AppCoordinator
    @State private var showCallsignPicker = false

    init(rig: RigStatus) {
        _viewModel = StateObject(wrappedValue: ProjectDetailViewModel(rig: rig))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Project header card
                projectHeaderCard

                // Agents section
                agentsCard

                // Merge queue section
                mergeQueueCard

                // Actions section
                actionsCard
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                CRTText(viewModel.rigName.uppercased(), style: .subheader, glowIntensity: .medium)
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .sheet(isPresented: $showCallsignPicker) {
            CallsignPickerView { callsignName in
                Task {
                    await viewModel.spawnPolecat(callsign: callsignName)
                    if let spawnedCallsign = viewModel.lastSpawnedCallsign {
                        coordinator.pendingChatAgentId = spawnedCallsign
                        coordinator.selectTab(.chat)
                    }
                }
            }
            .presentationDetents([.large])
        }
    }

    // MARK: - Header Card

    private var projectHeaderCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Name and status
                HStack {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(theme.primary)

                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                        CRTText(viewModel.rigName.uppercased(), style: .subheader, glowIntensity: .medium)
                        CRTText(viewModel.rig.path, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            .lineLimit(1)
                    }

                    Spacer()

                    // Agent count badge
                    BadgeView(
                        "\(viewModel.runningCount)/\(viewModel.totalCount) ACTIVE",
                        style: .status(viewModel.runningCount > 0 ? .success : .offline)
                    )
                }
            }
        }
    }

    // MARK: - Agents Card

    private var agentsCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                HStack {
                    Image(systemName: "person.3.fill")
                        .foregroundColor(theme.primary)
                    CRTText("AGENTS", style: .subheader)
                    Spacer()
                    CRTText("\(viewModel.allAgents.count)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Agent list
                if viewModel.allAgents.isEmpty {
                    CRTText("NO AGENTS", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ForEach(viewModel.allAgents) { agent in
                        agentRow(agent)
                    }
                }
            }
        }
    }

    private func agentRow(_ agent: AgentEntry) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot
            StatusDot(
                agent.status.running ? .success : .offline,
                size: 8,
                pulse: agent.status.running && agent.status.state == .working
            )

            // Type icon
            Image(systemName: agentIcon(for: agent.type))
                .font(.system(size: 12))
                .foregroundColor(theme.dim)
                .frame(width: 16)

            // Name
            VStack(alignment: .leading, spacing: 2) {
                CRTText(agent.name.uppercased(), style: .caption, color: theme.primary)
                CRTText(
                    agent.type.rawValue.uppercased(),
                    style: .caption,
                    color: theme.dim
                )
            }

            Spacer()

            // Status
            CRTText(
                agent.status.running ? "RUNNING" : "STOPPED",
                style: .caption,
                color: agent.status.running ? CRTTheme.State.success : theme.dim
            )

            // Unread mail badge
            if agent.status.unreadMail > 0 {
                UnreadBadge(agent.status.unreadMail)
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xs)
        .padding(.horizontal, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(
                    agent.status.running ? theme.primary.opacity(0.2) : theme.dim.opacity(0.15),
                    lineWidth: 1
                )
        )
    }

    // MARK: - Merge Queue Card

    private var mergeQueueCard: some View {
        CRTCard(style: .minimal) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "arrow.triangle.merge")
                        .foregroundColor(theme.primary)
                    CRTText("MERGE QUEUE", style: .subheader)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                HStack(spacing: CRTTheme.Spacing.lg) {
                    mergeQueueStat("PENDING", count: viewModel.rig.mergeQueue.pending, color: CRTTheme.State.info)
                    mergeQueueStat("IN FLIGHT", count: viewModel.rig.mergeQueue.inFlight, color: CRTTheme.State.success)
                    mergeQueueStat("BLOCKED", count: viewModel.rig.mergeQueue.blocked, color: CRTTheme.State.warning)
                }
            }
        }
    }

    private func mergeQueueStat(_ label: String, count: Int, color: Color) -> some View {
        VStack(spacing: CRTTheme.Spacing.xxxs) {
            CRTText("\(count)", style: .header, glowIntensity: count > 0 ? .subtle : .none, color: count > 0 ? color : theme.dim)
            CRTText(label, style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
    }

    // MARK: - Actions Card

    private var actionsCard: some View {
        CRTCard(style: .minimal) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "bolt.fill")
                        .foregroundColor(theme.primary)
                    CRTText("ACTIONS", style: .subheader)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Spawn polecat button — tap for quick spawn, long-press to choose callsign
                Button {
                    Task {
                        await viewModel.spawnPolecat()
                        if let spawnedCallsign = viewModel.lastSpawnedCallsign {
                            coordinator.pendingChatAgentId = spawnedCallsign
                            coordinator.selectTab(.chat)
                        }
                    }
                } label: {
                    HStack {
                        if viewModel.isSpawning {
                            LoadingIndicator(size: .small)
                        } else {
                            Image(systemName: "plus.circle")
                                .foregroundColor(theme.primary)
                        }
                        CRTText("SPAWN POLECAT", style: .body, glowIntensity: .medium)
                        Spacer()
                        HStack(spacing: 4) {
                            Image(systemName: "hand.tap")
                                .font(.system(size: 10))
                            CRTText("HOLD TO NAME", style: .caption, glowIntensity: .subtle, color: theme.dim.opacity(0.6))
                        }
                        .foregroundColor(theme.dim.opacity(0.6))
                    }
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .background(theme.primary.opacity(0.1))
                    .cornerRadius(CRTTheme.CornerRadius.sm)
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isSpawning)
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.5)
                        .onEnded { _ in
                            let impact = UIImpactFeedbackGenerator(style: .heavy)
                            impact.impactOccurred()
                            showCallsignPicker = true
                        }
                )

                // Spawn message
                if let message = viewModel.spawnMessage {
                    CRTText(message, style: .caption, glowIntensity: .subtle, color: theme.dim)
                }
            }
        }
    }

    // MARK: - Helpers

    private func agentIcon(for type: AgentType) -> String {
        switch type {
        case .mayor: return "crown"
        case .deacon: return "building.columns"
        case .witness: return "eye"
        case .refinery: return "gearshape.2"
        case .crew: return "wrench"
        case .polecat: return "hare"
        case .user: return "person.circle"
        case .agent: return "cpu"
        }
    }
}

// MARK: - Preview

#Preview("ProjectDetailView") {
    NavigationStack {
        ProjectDetailView(
            rig: RigStatus(
                name: "greenplace",
                path: "/Users/dev/code/greenplace",
                witness: AgentStatus(name: "witness", running: true, unreadMail: 2),
                refinery: AgentStatus(name: "refinery", running: true, unreadMail: 0),
                crew: [],
                polecats: [
                    AgentStatus(name: "polecat-abc", running: true, pinnedWork: ["adj-4lw"], unreadMail: 1, state: .working),
                    AgentStatus(name: "polecat-xyz", running: false, unreadMail: 0)
                ],
                mergeQueue: MergeQueueSummary(pending: 3, inFlight: 1, blocked: 0)
            )
        )
        .environmentObject(AppCoordinator())
    }
}
