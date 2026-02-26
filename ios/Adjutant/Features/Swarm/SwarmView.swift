import SwiftUI
import AdjutantKit

/// Swarm management view — create swarms, add/remove agents, view branches.
struct SwarmView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel = SwarmViewModel()

    var body: some View {
        VStack(spacing: 0) {
            headerView
            contentView
        }
        .background(theme.background.screen)
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
        .sheet(isPresented: $viewModel.showingCreateSheet) {
            createSwarmSheet
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("SWARM MODE", style: .subheader, glowIntensity: .medium)
                CRTText(
                    "\(viewModel.swarms.count) SWARM\(viewModel.swarms.count == 1 ? "" : "S")",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }

            Spacer()

            Button {
                viewModel.showingCreateSheet = true
            } label: {
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 14))
                    CRTText("NEW", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(theme.primary.opacity(0.1))
                .cornerRadius(6)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            theme.background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
    }

    // MARK: - Content

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.swarms.isEmpty {
            VStack(spacing: CRTTheme.Spacing.md) {
                LoadingIndicator(size: .large)
                CRTText("SCANNING SWARMS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.swarms.isEmpty {
            emptyView
        } else if let swarm = viewModel.selectedSwarm {
            swarmDetailView(swarm)
        } else {
            swarmListView
        }
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "person.3")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO SWARMS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText(
                "Create a swarm to run multiple agents on one project.",
                style: .body,
                glowIntensity: .none,
                color: theme.dim.opacity(0.6)
            )

            Button {
                viewModel.showingCreateSheet = true
            } label: {
                CRTText("CREATE SWARM", style: .body, glowIntensity: .medium)
                    .padding(.horizontal, CRTTheme.Spacing.lg)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                    .background(theme.primary.opacity(0.15))
                    .cornerRadius(8)
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Swarm List

    private var swarmListView: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(viewModel.swarms) { swarm in
                    swarmCard(swarm)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
    }

    private func swarmCard(_ swarm: SwarmInfo) -> some View {
        Button {
            viewModel.selectSwarm(swarm)
        } label: {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                HStack {
                    CRTText(swarm.id.uppercased(), style: .body, glowIntensity: .medium)
                    Spacer()
                    CRTText(
                        "\(swarm.agents.count) AGENTS",
                        style: .caption,
                        glowIntensity: .subtle,
                        color: .cyan
                    )
                }

                CRTText(
                    swarm.projectPath,
                    style: .caption,
                    glowIntensity: .none,
                    color: theme.dim
                )
            }
            .padding(CRTTheme.Spacing.sm)
            .background(theme.dim.opacity(0.08))
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(theme.dim.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Swarm Detail

    private func swarmDetailView(_ swarm: SwarmInfo) -> some View {
        VStack(spacing: 0) {
            // Back + swarm info
            HStack {
                Button {
                    viewModel.selectedSwarm = nil
                } label: {
                    HStack(spacing: CRTTheme.Spacing.xxs) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12))
                        CRTText("BACK", style: .caption, glowIntensity: .subtle)
                    }
                    .foregroundColor(theme.dim)
                }

                Spacer()

                CRTText(
                    "\(swarm.agents.count) AGENTS",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: .cyan
                )

                // Add agent
                Button {
                    Task { await viewModel.addAgent() }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.green)
                        .padding(6)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(6)
                }

                // Destroy swarm
                Button {
                    Task { await viewModel.destroySwarm(swarm.id) }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12))
                        .foregroundColor(.red)
                        .padding(6)
                        .background(Color.red.opacity(0.15))
                        .cornerRadius(6)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)

            // Error banner
            if let error = viewModel.errorMessage {
                ErrorBanner(
                    message: error,
                    onRetry: nil,
                    onDismiss: { viewModel.clearError() }
                )
                .padding(.horizontal)
            }

            // Agent list
            ScrollView {
                LazyVStack(spacing: CRTTheme.Spacing.sm) {
                    ForEach(swarm.agents) { agent in
                        agentRow(agent, swarmId: swarm.id)
                    }

                    // Branches section
                    if !viewModel.branches.isEmpty {
                        branchesSection
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
            }
        }
    }

    private func agentRow(_ agent: SwarmAgent, swarmId: String) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot
            Circle()
                .fill(agentStatusColor(agent.status))
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text(agent.name.uppercased())
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundColor(theme.primary)

                    if agent.isCoordinator {
                        Text("COORD")
                            .font(.system(.caption2, weight: .bold))
                            .foregroundColor(.orange)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.orange.opacity(0.15))
                            .cornerRadius(3)
                    }
                }

                Text(agent.branch)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(theme.dim)
            }

            Spacer()

            Text(agent.status.uppercased())
                .font(.system(.caption2, weight: .semibold))
                .foregroundColor(agentStatusColor(agent.status))

            // Remove button
            Button {
                Task { await viewModel.removeAgent(sessionId: agent.sessionId) }
            } label: {
                Image(systemName: "minus.circle")
                    .font(.system(size: 14))
                    .foregroundColor(.red.opacity(0.7))
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.dim.opacity(0.06))
        .cornerRadius(8)
    }

    // MARK: - Branches Section

    private var branchesSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText("BRANCHES", style: .caption, glowIntensity: .subtle, color: theme.dim)
                .padding(.top, CRTTheme.Spacing.sm)

            ForEach(viewModel.branches) { branch in
                branchRow(branch)
            }
        }
    }

    private func branchRow(_ branch: BranchStatus) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 12))
                .foregroundColor(.purple)

            VStack(alignment: .leading, spacing: 2) {
                Text(branch.agentName)
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .foregroundColor(theme.primary)

                HStack(spacing: CRTTheme.Spacing.sm) {
                    Text("+\(branch.aheadOfMain)")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundColor(.green)
                    Text("-\(branch.behindMain)")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundColor(.red)
                }
            }

            Spacer()

            if branch.hasConflicts {
                Text("CONFLICTS")
                    .font(.system(.caption2, weight: .bold))
                    .foregroundColor(.red)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.red.opacity(0.15))
                    .cornerRadius(3)
            } else if branch.aheadOfMain > 0 {
                Button {
                    Task { await viewModel.mergeBranch(branch.branch) }
                } label: {
                    Text("MERGE")
                        .font(.system(.caption2, weight: .bold))
                        .foregroundColor(.green)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(4)
                }
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(Color.purple.opacity(0.06))
        .cornerRadius(8)
    }

    // MARK: - Create Swarm Sheet

    private var createSwarmSheet: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            CRTText("CREATE SWARM", style: .subheader, glowIntensity: .medium)
                .padding(.top, CRTTheme.Spacing.md)

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTText("PROJECT PATH", style: .caption, glowIntensity: .subtle, color: theme.dim)
                TextField("/path/to/project", text: $viewModel.newProjectPath)
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(theme.primary)
                    .padding(CRTTheme.Spacing.sm)
                    .background(theme.dim.opacity(0.1))
                    .cornerRadius(8)
            }

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTText("AGENTS: \(viewModel.newAgentCount)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                Stepper("", value: $viewModel.newAgentCount, in: 1...20)
                    .labelsHidden()
            }

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTText("BASE NAME", style: .caption, glowIntensity: .subtle, color: theme.dim)
                TextField("agent", text: $viewModel.newBaseName)
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(theme.primary)
                    .padding(CRTTheme.Spacing.sm)
                    .background(theme.dim.opacity(0.1))
                    .cornerRadius(8)
            }

            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            HStack(spacing: CRTTheme.Spacing.md) {
                Button {
                    viewModel.showingCreateSheet = false
                } label: {
                    CRTText("CANCEL", style: .body, glowIntensity: .subtle, color: theme.dim)
                        .padding(.horizontal, CRTTheme.Spacing.lg)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                }

                Button {
                    Task { await viewModel.createSwarm() }
                } label: {
                    CRTText("CREATE", style: .body, glowIntensity: .medium)
                        .padding(.horizontal, CRTTheme.Spacing.lg)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(theme.primary.opacity(0.15))
                        .cornerRadius(8)
                }
                .disabled(viewModel.newProjectPath.isEmpty || viewModel.isLoading)
            }

            Spacer()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .background(theme.background.screen)
        .presentationDetents([.medium])
    }

    // MARK: - Helpers

    private func agentStatusColor(_ status: String) -> Color {
        switch status {
        case "working": return .green
        case "idle": return .yellow
        case "waiting_permission": return .orange
        case "offline": return .red
        default: return .gray
        }
    }
}
