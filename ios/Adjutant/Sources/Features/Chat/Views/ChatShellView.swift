import SwiftUI
import AdjutantKit

/// The chat tab shell (adj-164.6.5): a segmented DM ↔ Channels switcher above
/// the active surface. Direct messages keep the existing ``ChatView``; channels
/// show the list or, when one is open, its room view.
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
        VStack(spacing: 0) {
            modeSwitcher
            surface
        }
        .background(theme.background.screen)
    }

    // MARK: - Mode switcher

    private var modeSwitcher: some View {
        HStack(spacing: 0) {
            ForEach(ChatMode.allCases, id: \.self) { mode in
                Button {
                    modeController.switchTo(mode)
                } label: {
                    CRTText(
                        mode.label,
                        style: .caption,
                        glowIntensity: modeController.mode == mode ? .medium : .none,
                        color: modeController.mode == mode ? theme.primary : theme.dim
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                    .background(
                        modeController.mode == mode
                            ? theme.primary.opacity(0.12)
                            : Color.clear
                    )
                    .overlay(
                        Rectangle()
                            .frame(height: 2)
                            .foregroundColor(modeController.mode == mode ? theme.primary : .clear),
                        alignment: .bottom
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(modeController.mode == mode ? .isSelected : [])
            }
        }
        .background(theme.background.panel)
    }

    // MARK: - Active surface

    @ViewBuilder
    private var surface: some View {
        switch modeController.mode {
        case .directMessages:
            ChatView(apiClient: apiClient)
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
                onBack: {
                    channelViewModel.clearSelection()
                    modeController.selectedChannelId = nil
                }
            )
        } else {
            ChannelListView(viewModel: channelViewModel) { channel in
                modeController.selectedChannelId = channel.id
            }
        }
    }
}
