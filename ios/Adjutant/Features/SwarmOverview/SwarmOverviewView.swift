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
                loadingSkeleton
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
                // Stale data banner
                if viewModel.errorMessage != nil {
                    staleDataBanner
                }

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

    private var loadingSkeleton: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            // Skeleton for Start Agent button
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(theme.dim.opacity(0.1))
                .frame(height: 50)
                .padding(.horizontal, CRTTheme.Spacing.md)

            // Skeleton for sections
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.dim.opacity(0.1))
                        .frame(width: 120, height: 16)
                    ForEach(0..<2, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .fill(theme.dim.opacity(0.05))
                            .frame(height: 44)
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
            }
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
                Task { await viewModel.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var staleDataBanner: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(CRTTheme.State.warning)
                .font(.system(size: 12))
            CRTText("USING CACHED DATA", style: .caption, color: CRTTheme.State.warning)
            Spacer()
            Button {
                viewModel.clearError()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10))
                    .foregroundColor(theme.dim)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(CRTTheme.State.warning.opacity(0.1))
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            CRTText("NO DATA", style: .subheader, color: theme.dim)
            CRTText("Pull to refresh or start an agent", style: .caption, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
