import SwiftUI
import AdjutantKit

/// The chat tab shell (adj-gw7ol redesign): the active surface fills the tab and
/// each surface header hosts a compact ``ChatModeToggle`` for DM ↔ Channels.
///
/// The old full-width segmented band stacked a second header on top of every
/// surface and read as clunky chrome. It is gone — the shell now renders only
/// the active surface and hands each one the ``ChatModeController`` so the
/// in-header toggle can drive the switch. Direct messages keep the existing
/// ``ChatView``; channels show the list or, when one is open, its room view.
struct ChatShellView: View {
    @Environment(\.crtTheme) private var theme

    let apiClient: APIClient

    @StateObject private var modeController = ChatModeController()
    @StateObject private var channelViewModel: ChannelViewModel

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _channelViewModel = StateObject(wrappedValue: ChannelViewModel(apiClient: apiClient))
    }

    var body: some View {
        surface
            .background(theme.background.screen)
    }

    // MARK: - Active surface

    @ViewBuilder
    private var surface: some View {
        switch modeController.mode {
        case .directMessages:
            ChatView(apiClient: apiClient, modeController: modeController)
        case .channels:
            channelsSurface
        }
    }

    @ViewBuilder
    private var channelsSurface: some View {
        if let channel = channelViewModel.selectedChannel {
            ChannelView(
                viewModel: channelViewModel,
                channel: channel,
                modeController: modeController,
                onBack: {
                    channelViewModel.clearSelection()
                    modeController.selectedChannelId = nil
                }
            )
        } else {
            ChannelListView(viewModel: channelViewModel, modeController: modeController) { channel in
                modeController.selectedChannelId = channel.id
            }
        }
    }
}
