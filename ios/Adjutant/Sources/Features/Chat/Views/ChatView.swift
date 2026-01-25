import SwiftUI
import AdjutantKit

/// Main chat view for direct messaging with the Mayor.
/// Features SMS-style bubbles, auto-scroll, typing indicator, and voice input.
struct ChatView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: ChatViewModel
    @State private var scrollProxy: ScrollViewProxy?

    init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: ChatViewModel(apiClient: apiClient))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            // Messages area
            messagesArea

            // Typing indicator
            if viewModel.isTyping {
                typingIndicator
            }

            // Input area
            ChatInputView(
                text: $viewModel.inputText,
                isRecordingVoice: viewModel.isRecordingVoice,
                canSend: viewModel.canSend,
                onSend: {
                    Task {
                        await viewModel.sendMessage()
                        scrollToBottom()
                    }
                },
                onVoiceToggle: {
                    viewModel.isRecordingVoice.toggle()
                    // Voice recording implementation would go here
                }
            )
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .onChange(of: viewModel.messages.count) { _, _ in
            scrollToBottom()
        }
    }

    // MARK: - Subviews

    private var chatHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("MAYOR", style: .subheader, glowIntensity: .medium)
                CRTText("DIRECT CHANNEL", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            Spacer()

            // Status indicator
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Circle()
                    .fill(CRTTheme.State.success)
                    .frame(width: 8, height: 8)
                CRTText("ONLINE", style: .caption, glowIntensity: .subtle, color: CRTTheme.State.success)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            CRTTheme.Background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
    }

    private var messagesArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: CRTTheme.Spacing.sm) {
                    // Pull to refresh / load more
                    if viewModel.hasMoreHistory {
                        loadMoreButton
                    }

                    // Messages
                    ForEach(viewModel.messages) { message in
                        ChatBubble(
                            message: message,
                            isOutgoing: viewModel.isOutgoing(message)
                        )
                        .id(message.id)
                    }

                    // Empty state
                    if viewModel.messages.isEmpty && !viewModel.isLoading {
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
                            onDismiss: { viewModel.clearError() },
                            onRetry: {
                                Task { await viewModel.refresh() }
                            }
                        )
                        .padding(.horizontal)
                    }

                    // Bottom anchor for scrolling
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
            }
            .refreshable {
                await viewModel.loadMoreHistory()
            }
            .onAppear {
                scrollProxy = proxy
                scrollToBottom()
            }
        }
    }

    private var loadMoreButton: some View {
        Button {
            Task {
                await viewModel.loadMoreHistory()
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.xs) {
                if viewModel.isLoadingHistory {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12))
                }
                CRTText("LOAD EARLIER MESSAGES", style: .caption, glowIntensity: .subtle)
            }
            .foregroundColor(theme.dim)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .disabled(viewModel.isLoadingHistory)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO MESSAGES", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Send a message to start a conversation with the Mayor.",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.xl)
    }

    private var typingIndicator: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            CRTText("MAYOR IS TYPING", style: .caption, glowIntensity: .subtle, color: theme.dim)
            TypingDots()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Private Methods

    private func scrollToBottom() {
        withAnimation(.easeOut(duration: 0.2)) {
            scrollProxy?.scrollTo("bottom", anchor: .bottom)
        }
    }
}

// MARK: - Typing Dots Animation

/// Animated typing indicator dots
private struct TypingDots: View {
    @Environment(\.crtTheme) private var theme
    @State private var animationPhase = 0
    @State private var timer: Timer?

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(theme.dim)
                    .frame(width: 6, height: 6)
                    .opacity(animationPhase == index ? 1.0 : 0.3)
            }
        }
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
                withAnimation(.easeInOut(duration: 0.2)) {
                    animationPhase = (animationPhase + 1) % 3
                }
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }
}

// MARK: - Preview

#Preview("ChatView Empty") {
    let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:3000")!)
    let apiClient = APIClient(configuration: config)

    return ChatView(apiClient: apiClient)
}

#Preview("ChatView with Messages") {
    let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:3000")!)
    let apiClient = APIClient(configuration: config)

    return ChatView(apiClient: apiClient)
        .crtTheme(.blue)
}
