import SwiftUI
import AdjutantKit

/// Headerless epic list for embedding in the Beads page view mode toggle.
/// Reuses EpicsListViewModel, EpicRowView, and navigates to .epicDetail.
struct EpicsContentView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel = EpicsListViewModel()

    var body: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.md) {
                // Open Epics Section
                if !viewModel.openEpics.isEmpty {
                    sectionHeader("OPEN", count: viewModel.openEpics.count)

                    ForEach(viewModel.openEpics) { epic in
                        EpicRowView(epic: epic) {
                            coordinator.navigateReplacingPath(to: .epicDetail(id: epic.id))
                        }
                    }
                }

                // Complete Epics Section
                if !viewModel.completeEpics.isEmpty {
                    sectionHeader("COMPLETE", count: viewModel.completeEpics.count)
                        .padding(.top, viewModel.openEpics.isEmpty ? 0 : CRTTheme.Spacing.md)

                    ForEach(viewModel.completeEpics) { epic in
                        EpicRowView(epic: epic) {
                            coordinator.navigateReplacingPath(to: .epicDetail(id: epic.id))
                        }
                    }
                }

                // Empty state
                if viewModel.isEmpty && !viewModel.isLoading {
                    emptyState
                }

                // Loading indicator
                if viewModel.isLoading {
                    LoadingIndicator(size: .medium)
                        .padding()
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
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Subviews

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            CRTText(title, style: .caption, glowIntensity: .subtle, color: theme.dim)

            Spacer()

            CRTText("\(count)", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
        }
        .padding(.horizontal, CRTTheme.Spacing.xs)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "list.bullet.clipboard")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO EPICS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Epics will appear here when created.",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.xl)
    }
}
