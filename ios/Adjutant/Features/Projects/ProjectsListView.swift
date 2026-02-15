import SwiftUI
import AdjutantKit

/// Top-level view listing all projects (rigs) with agent counts.
/// Supports search, navigation to project detail, and pull-to-refresh.
struct ProjectsListView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ProjectsListViewModel

    /// Callback when a rig is selected
    var onSelectRig: ((RigStatus) -> Void)?

    init(apiClient: APIClient? = nil, onSelectRig: ((RigStatus) -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: ProjectsListViewModel(apiClient: apiClient))
        self.onSelectRig = onSelectRig
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
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Subviews

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("PROJECTS", style: .subheader, glowIntensity: .medium)
                CRTText(
                    "\(viewModel.filteredRigs.count) RIGS \u{2022} \(viewModel.totalAgentCount) AGENTS",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }

            Spacer()

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
            CRTTheme.Background.panel
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
        .background(CRTTheme.Background.elevated)
        .cornerRadius(CRTTheme.CornerRadius.sm)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.panel.opacity(0.5))
    }

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.rigs.isEmpty {
            loadingView
        } else if viewModel.filteredRigs.isEmpty {
            emptyView
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
                CRTText("No rigs are configured.",
                        style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var projectList: some View {
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

                // Error banner
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
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Preview

#Preview("ProjectsListView") {
    ProjectsListView { rig in
        print("Selected: \(rig.name)")
    }
}
