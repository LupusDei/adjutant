import SwiftUI
import AdjutantKit

/// Main convoys list view displaying active work packages with progress tracking.
/// Features rig filtering, sorting options, and expandable convoy cards.
struct ConvoysListView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ConvoysViewModel
    @EnvironmentObject private var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared

    @State private var showingSortPicker = false

    init(viewModel: ConvoysViewModel = ConvoysViewModel()) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with rig filter
            AppHeaderView(
                title: "CONVOYS",
                subtitle: subtitleText,
                availableRigs: appState.availableRigs,
                isLoading: viewModel.isLoading,
                onPowerTap: { coordinator.navigate(to: .settings) }
            )

            // Sort bar
            sortBar

            // Content
            contentView
        }
        .background(CRTTheme.Background.screen)
        #if os(iOS)
        .navigationBarHidden(true)
        #endif
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .sheet(isPresented: $showingSortPicker) {
            sortPickerSheet
        }
    }

    // MARK: - Subtitle

    private var subtitleText: String? {
        guard !viewModel.filteredConvoys.isEmpty else { return nil }
        let incomplete = viewModel.incompleteCount
        let total = viewModel.filteredConvoys.count
        let progress = Int(viewModel.totalProgress * 100)
        return "\(incomplete) OF \(total) ACTIVE | \(progress)% OVERALL"
    }

    // MARK: - Sort Bar

    private var sortBar: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Sort button
            Button {
                showingSortPicker = true
            } label: {
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 12))

                    CRTText(viewModel.sortOption.displayName, style: .caption, glowIntensity: .subtle)

                    Image(systemName: "chevron.down")
                        .font(.system(size: 10))
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.primary.opacity(0.1))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

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
        .background(CRTTheme.Background.panel.opacity(0.5))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.2)),
            alignment: .bottom
        )
    }

    // MARK: - Content View

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.convoys.isEmpty {
            loadingView
        } else if let error = viewModel.errorMessage {
            errorView(message: error)
        } else if viewModel.isEmpty {
            emptyView
        } else {
            convoysList
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("LOADING CONVOYS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.error)
                .crtGlow(color: CRTTheme.State.error, radius: 8, intensity: 0.4)

            CRTText("ERROR LOADING CONVOYS", style: .subheader, glowIntensity: .medium, color: CRTTheme.State.error)

            CRTText(message, style: .caption, glowIntensity: .none, color: theme.dim)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await viewModel.refresh() }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                    CRTText("RETRY", style: .caption, glowIntensity: .medium)
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .background(theme.primary.opacity(0.15))
                .cornerRadius(CRTTheme.CornerRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.5), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .padding(.top, CRTTheme.Spacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
                .crtGlow(color: theme.primary, radius: 8, intensity: 0.2)

            if appState.selectedRig != nil {
                CRTText("NO CONVOYS FOR RIG", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText("Try selecting a different rig or viewing all rigs.",
                        style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))

                Button {
                    appState.selectedRig = nil
                } label: {
                    CRTText("VIEW ALL RIGS", style: .caption, glowIntensity: .medium)
                        .padding(.horizontal, CRTTheme.Spacing.md)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(theme.primary.opacity(0.15))
                        .cornerRadius(CRTTheme.CornerRadius.sm)
                        .overlay(
                            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                                .stroke(theme.primary.opacity(0.5), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .padding(.top, CRTTheme.Spacing.sm)
            } else {
                CRTText("NO ACTIVE CONVOYS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText("All work packages are complete.",
                        style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Convoys List

    private var convoysList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.md) {
                ForEach(viewModel.filteredConvoys) { convoy in
                    ConvoyRowView(
                        convoy: convoy,
                        isExpanded: viewModel.isExpanded(convoy.id),
                        onToggleExpand: {
                            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                                viewModel.toggleExpanded(convoy.id)
                            }
                        },
                        onIssueTap: { issue in
                            coordinator.navigate(to: .beadDetail(id: issue.id))
                        }
                    )
                }

                // Error banner (if any)
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

    // MARK: - Sort Picker Sheet

    private var sortPickerSheet: some View {
        NavigationView {
            List {
                ForEach(ConvoysViewModel.SortOption.allCases) { option in
                    Button {
                        viewModel.sortOption = option
                        showingSortPicker = false
                    } label: {
                        HStack {
                            Text(option.displayName)
                                .foregroundColor(theme.primary)
                            Spacer()
                            if viewModel.sortOption == option {
                                Image(systemName: "checkmark")
                                    .foregroundColor(theme.primary)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .background(CRTTheme.Background.screen)
            .navigationTitle("Sort By")
            #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showingSortPicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Preview

#Preview("Convoys List") {
    ConvoysListView()
        .environmentObject(AppCoordinator())
}

#Preview("Convoys List - Blue Theme") {
    ConvoysListView()
        .environmentObject(AppCoordinator())
        .crtTheme(.blue)
}

#Preview("Convoys List - Empty") {
    let viewModel = ConvoysViewModel()
    return ConvoysListView(viewModel: viewModel)
        .environmentObject(AppCoordinator())
}
