import SwiftUI
import AdjutantKit

/// Main beads list view displaying all beads with filtering and search.
struct BeadsListView: View {
    @StateObject private var viewModel = BeadsListViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView

            // Filter bar
            filterBar

            // Content
            content
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
            Task {
                await viewModel.loadBeads()
            }
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            // Title
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                CRTText("BEADS", style: .header)
                    .crtGlow(color: theme.primary, radius: 4, intensity: 0.4)

                CRTText("Issue & Task Tracker", style: .caption, color: theme.dim)
            }

            Spacer()

            // Count badge
            if viewModel.openCount > 0 {
                BadgeView("\(viewModel.openCount) OPEN", style: .status(.success))
            }

            // Refresh button
            Button {
                Task {
                    await viewModel.refresh()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.primary)
                    .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                    .animation(
                        viewModel.isLoading ?
                            .linear(duration: 1).repeatForever(autoreverses: false) :
                            .default,
                        value: viewModel.isLoading
                    )
            }
            .disabled(viewModel.isLoading)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.panel)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            // Search field
            searchField

            // Filter chips
            filterChips
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.elevated)
    }

    private var searchField: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundColor(theme.dim)

            TextField("Search beads...", text: $viewModel.searchText)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()

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
        .background(CRTTheme.Background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                ForEach(BeadsListViewModel.BeadFilter.allCases) { filter in
                    FilterChip(
                        title: filter.displayName,
                        icon: filter.systemImage,
                        isSelected: viewModel.currentFilter == filter,
                        count: countForFilter(filter)
                    ) {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            viewModel.currentFilter = filter
                        }
                    }
                }
            }
        }
    }

    private func countForFilter(_ filter: BeadsListViewModel.BeadFilter) -> Int? {
        switch filter {
        case .all:
            return viewModel.beads.count
        case .open:
            return viewModel.openCount
        case .assigned:
            return viewModel.beads.filter { $0.assignee != nil && !$0.assignee!.isEmpty }.count
        case .priority:
            return viewModel.priorityCount
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.beads.isEmpty {
            loadingView
        } else if let errorMessage = viewModel.errorMessage {
            errorView(errorMessage)
        } else if viewModel.isEmpty {
            emptyView
        } else {
            beadsList
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                .scaleEffect(1.5)
            CRTText("LOADING BEADS...", style: .body, color: theme.dim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.error)
                .crtGlow(color: CRTTheme.State.error, radius: 8, intensity: 0.4)

            CRTText("ERROR", style: .header, color: CRTTheme.State.error)
            CRTText(message, style: .body, color: theme.dim)

            Button {
                viewModel.clearError()
                Task {
                    await viewModel.refresh()
                }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                    Text("RETRY")
                }
                .font(CRTTheme.Typography.font(size: 14, weight: .medium))
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.lg)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(theme.primary, lineWidth: 1)
                )
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "circle.grid.3x3")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
                .crtGlow(color: theme.primary, radius: 8, intensity: 0.2)

            CRTText("NO BEADS", style: .header, color: theme.dim)
            CRTText(viewModel.emptyStateMessage, style: .body, color: theme.dim.opacity(0.7))

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var beadsList: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(viewModel.filteredBeads) { bead in
                    BeadRowView(bead: bead) {
                        coordinator.navigate(to: .beadDetail(id: bead.id))
                    }
                }
            }
            .padding(.vertical, 1)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Filter Chip

private struct FilterChip: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let icon: String
    let isSelected: Bool
    let count: Int?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Image(systemName: icon)
                    .font(.system(size: 11))

                Text(title)
                    .font(CRTTheme.Typography.font(size: 11, weight: isSelected ? .bold : .medium))

                if let count = count, count > 0 {
                    Text("(\(count))")
                        .font(CRTTheme.Typography.font(size: 10))
                        .foregroundColor(isSelected ? theme.primary : theme.dim)
                }
            }
            .foregroundColor(isSelected ? theme.primary : theme.dim)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(
                isSelected ?
                    theme.primary.opacity(0.15) :
                    CRTTheme.Background.panel
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isSelected ? theme.primary : theme.primary.opacity(0.3),
                        lineWidth: 1
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
            .crtGlow(
                color: theme.primary,
                radius: isSelected ? 3 : 0,
                intensity: isSelected ? 0.3 : 0
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#Preview("Beads List") {
    BeadsListView()
        .environmentObject(AppCoordinator())
}
