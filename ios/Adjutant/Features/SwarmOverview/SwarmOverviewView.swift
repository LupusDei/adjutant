import SwiftUI
import AdjutantKit

/// Swarm Overview page — aggregated project dashboard showing beads, epics, and agents.
struct SwarmOverviewView: View {
    @StateObject private var viewModel = SwarmOverviewViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoading && viewModel.overview == nil {
                ProgressView()
                    .tint(theme.primary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = viewModel.errorMessage, viewModel.overview == nil {
                errorView(error)
            } else if let overview = viewModel.overview {
                overviewContent(overview)
            } else {
                emptyView
            }
        }
        .background(CRTTheme.Background.screen)
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
                Task { await viewModel.startAgent(callsign: callsign) }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func overviewContent(_ overview: ProjectOverviewResponse) -> some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.lg) {
                startAgentSection
                agentsSection(overview.agents)
                beadsSection(overview.beads)
                epicsSection(overview.epics)
            }
            .padding(.vertical, CRTTheme.Spacing.md)
            .padding(.horizontal, CRTTheme.Spacing.md)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Start Agent

    private var startAgentSection: some View {
        CRTButton("START AGENT", variant: .primary, size: .large) {
            Task { await viewModel.startAgent() }
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5)
                .onEnded { _ in
                    viewModel.showingCallsignPicker = true
                }
        )
    }

    // MARK: - Sections

    @ViewBuilder
    private func agentsSection(_ agents: [AgentOverview]) -> some View {
        CRTCard(header: "AGENTS", headerBadge: "\(agents.count)") {
            AgentsSectionView(agents: agents)
        }
    }

    @ViewBuilder
    private func beadsSection(_ beads: BeadsOverview) -> some View {
        let totalCount = beads.open.count + beads.inProgress.count + beads.recentlyClosed.count
        CRTCard(header: "BEADS", headerBadge: "\(totalCount)") {
            BeadsSectionView(beads: beads)
        }
    }

    @ViewBuilder
    private func epicsSection(_ epics: EpicsOverview) -> some View {
        let totalCount = epics.inProgress.count + epics.recentlyCompleted.count
        CRTCard(header: "EPICS", headerBadge: "\(totalCount)") {
            EpicsSectionView(epics: epics)
        }
    }

    // MARK: - States

    @ViewBuilder
    private func errorView(_ error: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            CRTText("ERROR", style: .subheader, color: CRTTheme.State.error)
            CRTText(error, style: .caption, color: theme.dim)
            CRTButton("RETRY", variant: .secondary, size: .medium) {
                viewModel.clearError()
                Task { await viewModel.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            CRTText("NO DATA", style: .subheader, color: theme.dim)
            CRTText("Pull to refresh or start an agent", style: .caption, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Placeholder: Agents Section

/// Stub for agents section — real implementation built by another agent.
struct AgentsSectionView: View {
    let agents: [AgentOverview]
    @Environment(\.crtTheme) private var theme

    var body: some View {
        if agents.isEmpty {
            CRTText("No agents active", style: .caption, color: theme.dim)
        } else {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                ForEach(agents) { agent in
                    HStack(spacing: CRTTheme.Spacing.sm) {
                        StatusDot(statusType(for: agent.status), size: 6, pulse: agent.status == "working")
                        CRTText(agent.name.uppercased(), style: .body)
                        Spacer()
                        BadgeView(agent.status.uppercased(), style: .status(statusType(for: agent.status)))
                    }
                }
            }
        }
    }

    private func statusType(for status: String) -> BadgeView.Style.StatusType {
        switch status {
        case "working": return .success
        case "blocked": return .warning
        case "idle": return .info
        default: return .offline
        }
    }
}

// MARK: - Placeholder: Epics Section

/// Stub for epics section — real implementation built by another agent.
struct EpicsSectionView: View {
    let epics: EpicsOverview
    @Environment(\.crtTheme) private var theme

    var body: some View {
        let allEpics = epics.inProgress + epics.recentlyCompleted
        if allEpics.isEmpty {
            CRTText("No epics", style: .caption, color: theme.dim)
        } else {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                ForEach(allEpics) { epic in
                    HStack(spacing: CRTTheme.Spacing.sm) {
                        CRTText(epic.id, style: .caption, color: theme.dim)
                        CRTText(epic.title, style: .body)
                        Spacer()
                        CRTText("\(epic.closedChildren)/\(epic.totalChildren)", style: .caption, color: theme.dim)
                    }
                }
            }
        }
    }
}
