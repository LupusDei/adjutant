import SwiftUI
import AdjutantKit

/// Main proposals list view with status/type filter pickers,
/// pull-to-refresh, and empty state handling.
@MainActor
struct ProposalsView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel = ProposalsViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Header
            AppHeaderView(
                title: "PROPOSALS",
                availableRigs: [],
                isLoading: viewModel.isLoading,
                onPowerTap: nil
            )
            .padding(.vertical, CRTTheme.Spacing.sm)

            // Filter bar
            filterBar

            // Content
            if viewModel.isLoading && viewModel.proposals.isEmpty {
                loadingView
            } else if let error = viewModel.errorMessage {
                errorView(message: error)
            } else if viewModel.isEmpty {
                emptyView
            } else {
                proposalList
            }
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
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status filter
            statusPicker

            // Type filter
            typePicker

            Spacer()
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

    private var statusPicker: some View {
        Menu {
            Button {
                viewModel.statusFilter = nil
            } label: {
                HStack {
                    Text("ALL")
                    if viewModel.statusFilter == nil {
                        Image(systemName: "checkmark")
                    }
                }
            }

            ForEach(ProposalStatus.allCases, id: \.rawValue) { status in
                Button {
                    viewModel.statusFilter = status
                } label: {
                    HStack {
                        Text(status.rawValue.uppercased())
                        if viewModel.statusFilter == status {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Text(statusFilterLabel)
                    .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10))
            }
            .foregroundColor(theme.primary)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(theme.primary.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.primary.opacity(0.3), lineWidth: 1)
            )
        }
        .accessibilityLabel("Status filter: \(statusFilterLabel)")
    }

    private var typePicker: some View {
        Menu {
            Button {
                viewModel.typeFilter = nil
            } label: {
                HStack {
                    Text("ALL TYPES")
                    if viewModel.typeFilter == nil {
                        Image(systemName: "checkmark")
                    }
                }
            }

            ForEach(ProposalType.allCases, id: \.rawValue) { type in
                Button {
                    viewModel.typeFilter = type
                } label: {
                    HStack {
                        Text(type.rawValue.uppercased())
                        if viewModel.typeFilter == type {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Text(typeFilterLabel)
                    .font(CRTTheme.Typography.font(size: 12, weight: .medium))
                    .tracking(CRTTheme.Typography.letterSpacing)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10))
            }
            .foregroundColor(theme.dim)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(theme.primary.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.primary.opacity(0.2), lineWidth: 1)
            )
        }
        .accessibilityLabel("Type filter: \(typeFilterLabel)")
    }

    // MARK: - Proposal List

    private var proposalList: some View {
        List {
            ForEach(viewModel.proposals) { proposal in
                Button {
                    coordinator.navigate(to: .proposalDetail(id: proposal.id))
                } label: {
                    ProposalCard(
                        proposal: proposal,
                        onAccept: proposal.status == .pending ? {
                            Task<Void, Never> { await viewModel.accept(id: proposal.id) }
                        } : nil,
                        onDismiss: proposal.status == .pending ? {
                            Task<Void, Never> { await viewModel.dismiss(id: proposal.id) }
                        } : nil,
                        onComplete: proposal.status == .accepted ? {
                            Task<Void, Never> { await viewModel.complete(id: proposal.id) }
                        } : nil
                    )
                }
                .buttonStyle(.plain)
                .listRowBackground(CRTTheme.Background.screen)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(
                    top: CRTTheme.Spacing.xs,
                    leading: CRTTheme.Spacing.md,
                    bottom: CRTTheme.Spacing.xs,
                    trailing: CRTTheme.Spacing.md
                ))
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(CRTTheme.Background.screen)
        .refreshable {
            await viewModel.load()
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack {
            Spacer()
            LoadingIndicator(text: "LOADING PROPOSALS")
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()
            ErrorBanner(
                message: message,
                details: "Pull down to retry",
                onRetry: {
                    Task {
                        await viewModel.load()
                    }
                }
            )
            .padding(.horizontal, CRTTheme.Spacing.md)
            Spacer()
        }
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack {
            Spacer()
            EmptyStateView(
                title: "NO PROPOSALS",
                message: viewModel.emptyStateMessage,
                icon: "lightbulb"
            )
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Helpers

    private var statusFilterLabel: String {
        if let status = viewModel.statusFilter {
            return status.rawValue.uppercased()
        }
        return "ALL STATUS"
    }

    private var typeFilterLabel: String {
        if let type = viewModel.typeFilter {
            return type.rawValue.uppercased()
        }
        return "ALL TYPES"
    }
}

// MARK: - Preview

#Preview("Proposals View") {
    NavigationStack {
        ProposalsView()
    }
    .environmentObject(AppCoordinator())
    .preferredColorScheme(.dark)
}
