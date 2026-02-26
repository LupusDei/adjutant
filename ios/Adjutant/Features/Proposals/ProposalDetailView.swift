import SwiftUI
import AdjutantKit

/// Detail view for a single proposal showing full content and action buttons.
struct ProposalDetailView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: ProposalDetailViewModel
    @State private var showingSendToAgent = false
    @State private var sendToAgentMode: SendToAgentMode = .execute

    init(proposalId: String) {
        _viewModel = StateObject(wrappedValue: ProposalDetailViewModel(proposalId: proposalId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                if viewModel.isLoading {
                    LoadingIndicator()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let proposal = viewModel.proposal {
                    titleCard(proposal)
                    badgesCard(proposal)
                    metadataCard(proposal)
                    descriptionCard(proposal)
                    actionsCard(proposal)
                } else if let error = viewModel.errorMessage {
                    errorView(error)
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        #endif
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton {
                    coordinator.pop()
                }
            }
            ToolbarItem(placement: .principal) {
                CRTText("PROPOSAL DETAIL", style: .subheader, glowIntensity: .subtle)
            }
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .alert("SENT TO AGENT", isPresented: $viewModel.sendSuccess) {
            Button("OK") { }
        } message: {
            Text("Proposal has been sent to the agent for epic planning.")
        }
        .sheet(isPresented: $showingSendToAgent) {
            if let proposal = viewModel.proposal {
                SendToAgentSheet(proposal: proposal, mode: sendToAgentMode) { _ in
                    // For discuss mode, skip the alert — we navigate straight to chat
                    if sendToAgentMode == .execute {
                        viewModel.markSentToAgent()
                    }
                }
            }
        }
    }

    // MARK: - Title Card

    @ViewBuilder
    private func titleCard(_ proposal: Proposal) -> some View {
        CRTCard(header: "TITLE") {
            CRTText(proposal.title, style: .body, glowIntensity: .medium)
                .fixedSize(horizontal: false, vertical: true)
        }
        .crtCardStyle(.elevated)
    }

    // MARK: - Badges Card

    @ViewBuilder
    private func badgesCard(_ proposal: Proposal) -> some View {
        CRTCard(header: "CLASSIFICATION") {
            HStack(spacing: CRTTheme.Spacing.md) {
                // Type badge
                typeBadge(proposal.type)

                // Status badge
                statusBadge(proposal.status)

                Spacer()
            }
        }
    }

    @ViewBuilder
    private func typeBadge(_ type: ProposalType) -> some View {
        let color = typeBadgeColor(type)
        Text(type.rawValue.uppercased())
            .font(CRTTheme.Typography.font(size: 10, weight: .bold))
            .tracking(CRTTheme.Typography.letterSpacing)
            .foregroundColor(color)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(color.opacity(0.15))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(color.opacity(0.4), lineWidth: 1)
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
            .crtGlow(color: color, radius: 2, intensity: 0.2)
    }

    @ViewBuilder
    private func statusBadge(_ status: ProposalStatus) -> some View {
        let color = statusColor(status)
        Text(status.rawValue.uppercased())
            .font(CRTTheme.Typography.font(size: 10, weight: .bold))
            .tracking(CRTTheme.Typography.letterSpacing)
            .foregroundColor(color)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(color.opacity(0.15))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(color.opacity(0.4), lineWidth: 1)
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
            .crtGlow(color: color, radius: 2, intensity: 0.2)
    }

    // MARK: - Metadata Card

    @ViewBuilder
    private func metadataCard(_ proposal: Proposal) -> some View {
        CRTCard(header: "METADATA") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                metadataRow("AUTHOR:", value: proposal.author)
                metadataRow("CREATED:", value: viewModel.formattedCreatedDate)
                metadataRow("UPDATED:", value: viewModel.formattedUpdatedDate)
            }
        }
        .crtCardStyle(.minimal)
    }

    @ViewBuilder
    private func metadataRow(_ label: String, value: String) -> some View {
        HStack {
            CRTText(label, style: .caption, glowIntensity: .subtle)
                .foregroundColor(theme.dim)
                .frame(width: 80, alignment: .leading)
            CRTText(value, style: .body, glowIntensity: .subtle)
        }
    }

    // MARK: - Description Card

    @ViewBuilder
    private func descriptionCard(_ proposal: Proposal) -> some View {
        CRTCard(header: "DESCRIPTION") {
            CRTText(proposal.description, style: .body, glowIntensity: .subtle)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Actions Card

    @ViewBuilder
    private func actionsCard(_ proposal: Proposal) -> some View {
        CRTCard(header: "ACTIONS") {
            switch proposal.status {
            case .pending:
                HStack(spacing: CRTTheme.Spacing.md) {
                    CRTButton("ACCEPT", variant: .primary, size: .medium) {
                        Task<Void, Never> { await viewModel.accept() }
                    }
                    CRTButton("DISCUSS", variant: .secondary, size: .medium) {
                        sendToAgentMode = .discuss
                        showingSendToAgent = true
                    }
                    CRTButton("DISMISS", variant: .danger, size: .medium) {
                        Task<Void, Never> { await viewModel.dismiss() }
                    }
                    Spacer()
                }

            case .accepted:
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Circle()
                            .fill(CRTTheme.State.success)
                            .frame(width: 8, height: 8)
                        CRTText("ACCEPTED", style: .subheader, glowIntensity: .medium)
                            .foregroundColor(CRTTheme.State.success)
                    }

                    HStack(spacing: CRTTheme.Spacing.md) {
                        CRTButton("COMPLETE", variant: .secondary, size: .medium) {
                            Task<Void, Never> { await viewModel.complete() }
                        }

                        CRTButton("SEND TO AGENT", variant: .primary, size: .large) {
                            sendToAgentMode = .execute
                            showingSendToAgent = true
                        }
                        .crtGlow(color: theme.primary, radius: 8, intensity: 0.4)
                    }
                }

            case .completed:
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Circle()
                        .fill(CRTTheme.State.info)
                        .frame(width: 8, height: 8)
                    CRTText("COMPLETED", style: .subheader, glowIntensity: .medium)
                        .foregroundColor(CRTTheme.State.info)
                }

            case .dismissed:
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Circle()
                        .fill(CRTTheme.State.error)
                        .frame(width: 8, height: 8)
                    CRTText("DISMISSED", style: .subheader, glowIntensity: .none)
                        .foregroundColor(theme.dim)
                }
            }
        }
    }

    // MARK: - Error View

    @ViewBuilder
    private func errorView(_ error: String) -> some View {
        CRTCard {
            VStack(spacing: CRTTheme.Spacing.md) {
                CRTText("ERROR", style: .subheader, color: CRTTheme.State.error)
                CRTText(error, style: .body, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)

                CRTButton("RETRY", variant: .secondary) {
                    Task<Void, Never> {
                        await viewModel.loadProposal()
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func typeBadgeColor(_ type: ProposalType) -> Color {
        switch type {
        case .product:
            return CRTTheme.State.success
        case .engineering:
            return CRTTheme.State.warning
        }
    }

    private func statusColor(_ status: ProposalStatus) -> Color {
        switch status {
        case .pending:
            return theme.primary
        case .accepted:
            return CRTTheme.State.success
        case .completed:
            return CRTTheme.State.info
        case .dismissed:
            return CRTTheme.State.error
        }
    }
}

// MARK: - Preview

#Preview("Proposal Detail") {
    NavigationStack {
        ProposalDetailView(proposalId: "test-proposal-id")
    }
    .environmentObject(AppCoordinator())
}
