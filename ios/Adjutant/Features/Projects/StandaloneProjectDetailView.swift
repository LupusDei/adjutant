import SwiftUI
import AdjutantKit

/// Detail view for a standalone/swarm project.
/// Shows project info, active sessions, swarms, and actions to start agents or teams.
struct StandaloneProjectDetailView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: StandaloneProjectDetailViewModel
    @EnvironmentObject private var coordinator: AppCoordinator
    @State private var selectedSession: ManagedSession?

    init(project: Project) {
        _viewModel = StateObject(wrappedValue: StandaloneProjectDetailViewModel(project: project))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.md) {
                projectHeaderCard
                sessionsCard
                swarmsCard
                actionsCard
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                CRTText(viewModel.project.name.uppercased(), style: .subheader, glowIntensity: .medium)
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
        .alert("DELETE PROJECT", isPresented: $viewModel.showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task {
                    if await viewModel.deleteProject() {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will unregister the project. Source files will not be deleted.")
        }
        .fullScreenCover(item: $selectedSession) { session in
            let wsClient = WebSocketClient(
                baseURL: AppState.shared.apiBaseURL,
                apiKey: AppState.shared.apiKey
            )
            SessionChatView(session: session, wsClient: wsClient, showDismiss: true)
        }
    }

    // MARK: - Header Card

    private var projectHeaderCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Name and active status
                HStack {
                    Image(systemName: viewModel.project.active ? "folder.fill" : "folder")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(theme.primary)

                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                        CRTText(viewModel.project.name.uppercased(), style: .subheader, glowIntensity: .medium)
                        CRTText(viewModel.abbreviatedPath, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            .lineLimit(1)
                    }

                    Spacer()

                    if viewModel.project.active {
                        BadgeView("ACTIVE", style: .status(.success))
                    }
                }

                // Git remote
                if let remote = viewModel.project.gitRemote, !remote.isEmpty {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 12))
                            .foregroundColor(theme.dim)
                        CRTText(remote, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            .lineLimit(1)
                    }
                }

                // Stats row
                HStack(spacing: CRTTheme.Spacing.lg) {
                    statItem(
                        label: "SESSIONS",
                        value: "\(viewModel.sessions.count)",
                        color: viewModel.hasActiveSessions ? CRTTheme.State.success : theme.dim
                    )
                    statItem(
                        label: "SWARMS",
                        value: "\(viewModel.swarms.count)",
                        color: !viewModel.swarms.isEmpty ? CRTTheme.State.info : theme.dim
                    )
                    statItem(
                        label: "MODE",
                        value: viewModel.project.mode.uppercased(),
                        color: theme.dim
                    )
                }
                .padding(.top, CRTTheme.Spacing.xs)
            }
        }
    }

    private func statItem(label: String, value: String, color: Color) -> some View {
        VStack(spacing: CRTTheme.Spacing.xxxs) {
            CRTText(value, style: .body, glowIntensity: .subtle, color: color)
            CRTText(label, style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
    }

    // MARK: - Sessions Card

    private var sessionsCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "terminal")
                        .foregroundColor(theme.primary)
                    CRTText("SESSIONS", style: .subheader)
                    Spacer()
                    CRTText("\(viewModel.sessions.count)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if viewModel.sessions.isEmpty {
                    CRTText("NO ACTIVE SESSIONS", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ForEach(viewModel.sessions) { session in
                        sessionRow(session)
                    }
                }
            }
        }
    }

    private func sessionRow(_ session: ManagedSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                StatusDot(
                    sessionStatusDot(session.status),
                    size: 8,
                    pulse: session.status == .working
                )

                VStack(alignment: .leading, spacing: 2) {
                    CRTText(session.name.uppercased(), style: .caption, color: theme.primary)
                    CRTText(
                        "\(session.mode.rawValue.uppercased()) \u{2022} \(session.workspaceType.rawValue.uppercased())",
                        style: .caption,
                        color: theme.dim
                    )
                }

                Spacer()

                // Status label
                CRTText(
                    session.status.rawValue.replacingOccurrences(of: "_", with: " ").uppercased(),
                    style: .caption,
                    color: sessionStatusColor(session.status)
                )

                // Kill button
                Button {
                    Task { await viewModel.killSession(session) }
                } label: {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 14))
                        .foregroundColor(CRTTheme.State.error.opacity(0.7))
                }
                .buttonStyle(.plain)
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
                        session.status != .offline ? theme.primary.opacity(0.2) : theme.dim.opacity(0.15),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Swarms Card

    private var swarmsCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "person.3.sequence")
                        .foregroundColor(theme.primary)
                    CRTText("SWARMS", style: .subheader)
                    Spacer()
                    CRTText("\(viewModel.swarms.count)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if viewModel.swarms.isEmpty {
                    CRTText("NO ACTIVE SWARMS", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    ForEach(viewModel.swarms) { swarm in
                        swarmRow(swarm)
                    }
                }
            }
        }
    }

    private func swarmRow(_ swarm: SwarmInfo) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            StatusDot(.success, size: 8, pulse: true)

            VStack(alignment: .leading, spacing: 2) {
                CRTText("SWARM \(swarm.id.prefix(8).uppercased())", style: .caption, color: theme.primary)
                CRTText(
                    "\(swarm.agents.count) AGENTS",
                    style: .caption,
                    color: theme.dim
                )
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(theme.dim)
        }
        .padding(.vertical, CRTTheme.Spacing.xs)
        .padding(.horizontal, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
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

                // Start Agent button
                actionButton(
                    icon: "plus.circle",
                    label: "START AGENT",
                    isLoading: viewModel.isCreatingSession
                ) {
                    Task {
                        if let session = await viewModel.createSession() {
                            selectedSession = session
                        }
                    }
                }

                // Start Team button
                actionButton(
                    icon: "person.3.fill",
                    label: "START TEAM (3 AGENTS)",
                    isLoading: viewModel.isCreatingSwarm
                ) {
                    Task { _ = await viewModel.createSwarm() }
                }

                // Activate button (if not active)
                if !viewModel.project.active {
                    actionButton(
                        icon: "checkmark.circle",
                        label: "SET AS ACTIVE PROJECT",
                        isLoading: false
                    ) {
                        Task { await viewModel.activateProject() }
                    }
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Delete button
                Button {
                    viewModel.showDeleteConfirmation = true
                } label: {
                    HStack {
                        if viewModel.isDeletingProject {
                            LoadingIndicator(size: .small)
                        } else {
                            Image(systemName: "trash")
                                .foregroundColor(CRTTheme.State.error)
                        }
                        CRTText("UNREGISTER PROJECT", style: .body, glowIntensity: .subtle, color: CRTTheme.State.error)
                        Spacer()
                    }
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .background(CRTTheme.State.error.opacity(0.1))
                    .cornerRadius(CRTTheme.CornerRadius.sm)
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .stroke(CRTTheme.State.error.opacity(0.3), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isDeletingProject)

                // Error banner
                if let error = viewModel.errorMessage {
                    ErrorBanner(
                        message: error,
                        onRetry: { Task { await viewModel.refresh() } },
                        onDismiss: { viewModel.clearError() }
                    )
                }
            }
        }
    }

    private func actionButton(
        icon: String,
        label: String,
        isLoading: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack {
                if isLoading {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: icon)
                        .foregroundColor(theme.primary)
                }
                CRTText(label, style: .body, glowIntensity: .medium)
                Spacer()
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
        .disabled(isLoading)
    }

    // MARK: - Helpers

    private func sessionStatusDot(_ status: SessionStatus) -> BadgeView.Style.StatusType {
        switch status {
        case .working: return .success
        case .idle: return .info
        case .waitingPermission: return .warning
        case .offline: return .offline
        }
    }

    private func sessionStatusColor(_ status: SessionStatus) -> Color {
        switch status {
        case .working: return CRTTheme.State.success
        case .idle: return CRTTheme.State.info
        case .waitingPermission: return CRTTheme.State.warning
        case .offline: return theme.dim
        }
    }
}

// MARK: - Preview

#Preview("StandaloneProjectDetailView") {
    NavigationStack {
        StandaloneProjectDetailView(
            project: Project(
                id: "proj-1",
                name: "adjutant",
                path: "/Users/dev/code/adjutant",
                gitRemote: "git@github.com:org/adjutant.git",
                mode: "standalone",
                sessions: ["sess-1", "sess-2"],
                createdAt: "2025-01-15T10:00:00Z",
                active: true
            )
        )
        .environmentObject(AppCoordinator())
    }
}
