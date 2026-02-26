import SwiftUI
import AdjutantKit

/// Top-level view listing projects.
/// Mode-aware: shows rigs in gastown mode, registered projects in swarm mode.
struct ProjectsListView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ProjectsListViewModel

    /// Callback when a rig is selected (gastown mode)
    var onSelectRig: ((RigStatus) -> Void)?

    /// Callback when a project is selected (swarm mode)
    var onSelectProject: ((Project) -> Void)?

    init(
        apiClient: APIClient? = nil,
        onSelectRig: ((RigStatus) -> Void)? = nil,
        onSelectProject: ((Project) -> Void)? = nil
    ) {
        _viewModel = StateObject(wrappedValue: ProjectsListViewModel(apiClient: apiClient))
        self.onSelectRig = onSelectRig
        self.onSelectProject = onSelectProject
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView

            // Search bar
            searchBar

            // Content
            contentView
        }
        .background(theme.background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .sheet(isPresented: $viewModel.showingCreateSheet) {
            createProjectSheet
        }
    }

    // MARK: - Subviews

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("PROJECTS", style: .subheader, glowIntensity: .medium)
                CRTText(
                    viewModel.headerSubtitle,
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }

            Spacer()

            // Add project button (non-gastown only)
            if !viewModel.isGastownMode {
                Button {
                    viewModel.showingCreateSheet = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(theme.primary)
                }
            }

            // Refresh button
            Button {
                Task { await viewModel.refresh() }
            } label: {
                if viewModel.isLoading {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(theme.primary)
                }
            }
            .disabled(viewModel.isLoading)
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

    private var searchBar: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundColor(theme.dim)

            TextField("", text: $viewModel.searchText)
                .textFieldStyle(.plain)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .disableAutocorrection(true)
                .placeholder(when: viewModel.searchText.isEmpty) {
                    Text("Search projects...")
                        .font(CRTTheme.Typography.font(size: 14))
                        .foregroundColor(theme.dim.opacity(0.5))
                }

            if !viewModel.searchText.isEmpty {
                Button {
                    viewModel.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(theme.dim)
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(theme.background.elevated)
        .cornerRadius(CRTTheme.CornerRadius.sm)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.panel.opacity(0.5))
    }

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.hasNoData {
            loadingView
        } else if !viewModel.hasItems {
            emptyView
        } else if viewModel.isGastownMode {
            rigList
        } else {
            projectList
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("LOADING PROJECTS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "folder")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            if viewModel.hasActiveFilters {
                CRTText("NO MATCHING PROJECTS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText("Try adjusting your search.",
                        style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))

                Button {
                    viewModel.clearFilters()
                } label: {
                    CRTText("CLEAR SEARCH", style: .caption, glowIntensity: .medium)
                        .padding(.horizontal, CRTTheme.Spacing.md)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(theme.primary.opacity(0.15))
                        .cornerRadius(CRTTheme.CornerRadius.sm)
                        .overlay(
                            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                                .stroke(theme.primary.opacity(0.5), lineWidth: 1)
                        )
                }
                .padding(.top, CRTTheme.Spacing.sm)
            } else {
                CRTText("NO PROJECTS FOUND", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText(
                    viewModel.isGastownMode
                        ? "No rigs are configured."
                        : "Register a project to get started.",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6)
                )
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Gastown Rig List

    private var rigList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(viewModel.filteredRigs, id: \.name) { rig in
                    ProjectRowView(
                        rig: rig,
                        runningCount: viewModel.runningAgentCount(for: rig),
                        totalCount: viewModel.agentCount(for: rig),
                        onTap: { onSelectRig?(rig) }
                    )
                }

                errorBanner
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Swarm Project List

    private var projectList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(viewModel.filteredProjects) { project in
                    SwarmProjectRow(
                        project: project,
                        onTap: { onSelectProject?(project) }
                    )
                }

                errorBanner
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Create Project Sheet

    private var createProjectSheet: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            CRTText("ADD PROJECT", style: .subheader, glowIntensity: .medium)
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
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .disableAutocorrection(true)
            }

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTText("NAME (OPTIONAL)", style: .caption, glowIntensity: .subtle, color: theme.dim)
                TextField("project-name", text: $viewModel.newProjectName)
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(theme.primary)
                    .padding(CRTTheme.Spacing.sm)
                    .background(theme.dim.opacity(0.1))
                    .cornerRadius(8)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .disableAutocorrection(true)
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
                    Task { await viewModel.createProjectFromSheet() }
                } label: {
                    if viewModel.isCreating {
                        LoadingIndicator(size: .small)
                            .padding(.horizontal, CRTTheme.Spacing.lg)
                            .padding(.vertical, CRTTheme.Spacing.sm)
                    } else {
                        CRTText("CREATE", style: .body, glowIntensity: .medium)
                            .padding(.horizontal, CRTTheme.Spacing.lg)
                            .padding(.vertical, CRTTheme.Spacing.sm)
                            .background(theme.primary.opacity(0.15))
                            .cornerRadius(8)
                    }
                }
                .disabled(viewModel.newProjectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isCreating)
            }

            Spacer()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .background(theme.background.screen)
        .presentationDetents([.medium])
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.errorMessage {
            ErrorBanner(
                message: error,
                onRetry: {
                    Task { await viewModel.refresh() }
                },
                onDismiss: { viewModel.clearError() }
            )
        }
    }
}

// MARK: - Swarm Project Row

/// Row view for a swarm project.
private struct SwarmProjectRow: View {
    @Environment(\.crtTheme) private var theme

    let project: Project
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Project icon
                Image(systemName: project.active ? "folder.fill" : "folder")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(project.active ? theme.primary : theme.dim)
                    .frame(width: 28)

                // Main content
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    CRTText(project.name.uppercased(), style: .body, glowIntensity: .medium)
                    CRTText(abbreviatedPath, style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .lineLimit(1)
                }

                Spacer()

                // Session count and active badge
                VStack(alignment: .trailing, spacing: CRTTheme.Spacing.xxxs) {
                    if !project.sessions.isEmpty {
                        HStack(spacing: CRTTheme.Spacing.xxs) {
                            StatusDot(.success, size: 8, pulse: true)
                            CRTText(
                                "\(project.sessions.count) SESSIONS",
                                style: .caption,
                                glowIntensity: .subtle,
                                color: theme.primary
                            )
                        }
                    }

                    if project.active {
                        CRTText("ACTIVE", style: .caption, color: CRTTheme.State.success)
                    }
                }

                // Navigation chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(theme.dim)
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.md)
            .background(theme.background.panel.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        project.active ? theme.primary.opacity(0.3) : theme.primary.opacity(0.2),
                        lineWidth: 1
                    )
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
        }
        .buttonStyle(.plain)
    }

    private var abbreviatedPath: String {
        let path = project.path
        if let homeRange = path.range(of: "/Users/") {
            let afterUsers = path[homeRange.upperBound...]
            if let slashIndex = afterUsers.firstIndex(of: "/") {
                return "~" + String(afterUsers[slashIndex...])
            }
        }
        return path
    }
}

// MARK: - Preview

#Preview("ProjectsListView - Gastown") {
    ProjectsListView { rig in
        print("Selected: \(rig.name)")
    }
}
