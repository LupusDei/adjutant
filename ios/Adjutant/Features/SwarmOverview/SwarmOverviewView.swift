import SwiftUI
import AdjutantKit

/// Swarm Overview page — aggregated project dashboard showing beads, epics, and agents.
struct SwarmOverviewView: View {
    @StateObject private var viewModel = SwarmOverviewViewModel()
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack {
            if viewModel.isLoading && viewModel.overview == nil {
                ProgressView()
                    .tint(theme.primary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = viewModel.errorMessage, viewModel.overview == nil {
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                }
                .foregroundColor(theme.dim)
            } else {
                Text("SWARM OVERVIEW")
                    .font(CRTTheme.Typography.font(size: 18, weight: .bold))
                    .tracking(CRTTheme.Typography.wideLetterSpacing)
                    .foregroundColor(theme.primary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(CRTTheme.Background.screen)
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
    }
}
