import SwiftUI
import Combine
import AdjutantKit

/// Multi-party channel room view (adj-164.6.3).
///
/// Renders a flat, conversation-scoped timeline with per-sender attribution by
/// reusing ``ChatBubble`` + ``MessageGrouping`` (the same path as the DM view),
/// with `showOutgoingSenderLabel` enabled so the operator's own turns are
/// attributed too — see ``ChannelBubbleAttribution``. The room subscribes to the
/// channel's WS fan-out on appear and unsubscribes on disappear.
struct ChannelView: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject var viewModel: ChannelViewModel

    /// The channel being shown.
    let channel: Channel

    /// Drives the in-header DM ↔ Channels toggle (adj-gw7ol). Optional so the
    /// view still renders standalone (e.g. previews/tests) without the shell.
    var modeController: ChatModeController?

    /// Back action — returns to the channel list.
    var onBack: () -> Void = {}

    @State private var scrollProxy: ScrollViewProxy?
    @State private var isAtBottom = true
    @State private var showMembersSheet = false
    @StateObject private var wsService = ChatWebSocketService()
    @State private var incomingCancellable: AnyCancellable?

    var body: some View {
        VStack(spacing: 0) {
            header
            messagesArea
            composer
        }
        .background(theme.background.screen)
        .onChange(of: viewModel.messages.count) { _, _ in
            if MessageGrouping.shouldAutoScroll(isAtBottom: isAtBottom) {
                scrollToBottom()
            }
        }
        .task {
            await viewModel.loadMessages()
        }
        .onAppear { connectRealtime() }
        .onDisappear { disconnectRealtime() }
        .sheet(isPresented: $showMembersSheet) {
            ChannelMembersSheet(viewModel: viewModel, channel: channel)
        }
    }

    // MARK: - Real-time (room-scoped fan-out)

    private func connectRealtime() {
        // Route only this channel's incoming messages into the timeline; the VM
        // drops any that don't belong (bleed guard) and bumps unread for others.
        incomingCancellable = wsService.incomingMessage
            .receive(on: DispatchQueue.main)
            .sink { message in
                viewModel.applyIncoming(message)
            }
        wsService.connect(baseURL: AppState.shared.apiBaseURL, apiKey: AppState.shared.apiKey)
        wsService.subscribeToChannel(channel.id)
    }

    private func disconnectRealtime() {
        wsService.unsubscribeFromChannel(channel.id)
        incomingCancellable?.cancel()
        incomingCancellable = nil
        wsService.disconnect()
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(theme.primary)
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to channels")

            VStack(alignment: .leading, spacing: 2) {
                CRTText("#\(channel.displayTitle)", style: .subheader, glowIntensity: .medium)
                CRTText(
                    "\(channel.memberCount) MEMBER\(channel.memberCount == 1 ? "" : "S")",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }
            Spacer()

            // Members roster + add-agent picker (adj-4wrro).
            Button {
                showMembersSheet = true
            } label: {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(theme.primary)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Channel members")

            if let modeController {
                ChatModeToggle(controller: modeController)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            theme.background.panel.overlay(
                Rectangle().frame(height: 1).foregroundColor(theme.dim.opacity(0.3)),
                alignment: .bottom
            )
        )
    }

    // MARK: - Messages

    private var messagesArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: CRTTheme.Spacing.sm) {
                    let groupFlags = MessageGrouping.computeGroups(for: viewModel.messages)
                    ForEach(viewModel.messages) { message in
                        ChatBubble(
                            message: message,
                            isOutgoing: message.isFromUser,
                            isFirstInGroup: groupFlags[message.id]?.isFirstInGroup ?? true,
                            isLastInGroup: groupFlags[message.id]?.isLastInGroup ?? true,
                            showOutgoingSenderLabel: true
                        )
                        .id(message.id)
                    }

                    if viewModel.messages.isEmpty && !viewModel.isLoading {
                        emptyState
                    }
                    if viewModel.isLoading {
                        LoadingIndicator(size: .medium).padding()
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .onAppear { isAtBottom = true }
                        .onDisappear { isAtBottom = false }
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await viewModel.loadMessages() }
            .onAppear { scrollProxy = proxy }
        }
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
            CRTText("NO MESSAGES", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Be the first to post in #\(channel.displayTitle).",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.xl)
    }

    // MARK: - Composer

    private var composer: some View {
        ChatInputView(
            text: $viewModel.inputText,
            recipientName: channel.displayTitle.uppercased(),
            isRecordingVoice: false,
            canSend: viewModel.canSend,
            onSend: {
                isAtBottom = true
                Task {
                    await viewModel.sendMessage()
                    scrollToBottom()
                }
            },
            onVoiceToggle: {}
        )
    }

    // MARK: - Scroll

    private func scrollToBottom(animated: Bool = true) {
        for delay in [0.05, 0.3] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if animated {
                    withAnimation(.easeOut(duration: 0.2)) {
                        scrollProxy?.scrollTo("bottom", anchor: .bottom)
                    }
                } else {
                    scrollProxy?.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }
}
