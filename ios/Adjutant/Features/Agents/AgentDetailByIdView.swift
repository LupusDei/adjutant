import SwiftUI
import AdjutantKit

/// Wrapper view that loads an agent by ID and displays AgentDetailView.
/// Used for deep linking from timeline events where only the agentId is known.
struct AgentDetailByIdView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator

    let agentId: String

    @State private var member: CrewMember?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let member {
                AgentDetailView(member: member)
            } else if isLoading {
                loadingView
            } else {
                errorView
            }
        }
        .task {
            await loadAgent()
        }
    }

    // MARK: - Loading State

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            ProgressView()
                .tint(theme.primary)
            Text("LOADING AGENT...")
                .font(.crtSM)
                .foregroundColor(theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background.screen)
    }

    // MARK: - Error State

    private var errorView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(CRTTheme.State.warning)
            Text(errorMessage ?? "AGENT NOT FOUND")
                .font(.crtSM)
                .foregroundColor(theme.dim)
                .multilineTextAlignment(.center)
            Button {
                Task<Void, Never> {
                    await loadAgent()
                }
            } label: {
                Text("RETRY")
                    .font(.crtSM)
                    .foregroundColor(theme.primary)
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(theme.primary, lineWidth: 1)
                    )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background.screen)
    }

    // MARK: - Data Loading

    private func loadAgent() async {
        isLoading = true
        errorMessage = nil

        do {
            let agents = try await AppState.shared.apiClient.getAgents()
            if let found = agents.first(where: { $0.id == agentId }) {
                member = found
            } else {
                errorMessage = "AGENT \"\(agentId)\" NOT FOUND"
            }
        } catch {
            errorMessage = "FAILED TO LOAD AGENT: \(error.localizedDescription.uppercased())"
        }

        isLoading = false
    }
}
