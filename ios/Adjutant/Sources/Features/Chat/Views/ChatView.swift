import SwiftUI
import AdjutantKit

/// Main chat view for direct messaging with agents.
/// Features SMS-style bubbles, auto-scroll, typing indicator, and voice input.
/// Supports chatting with Mayor or any crew agent.
struct ChatView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: ChatViewModel
    @State private var scrollProxy: ScrollViewProxy?
    @State private var showRecipientSelector = false
    @State private var showConnectionDetails = false
    @State private var selectedSession: ManagedSession?

    init(apiClient: APIClient, speechService: (any SpeechRecognitionServiceProtocol)? = nil) {
        let service = speechService ?? SpeechRecognitionService()
        _viewModel = StateObject(wrappedValue: ChatViewModel(apiClient: apiClient, speechService: service))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            // Messages area
            messagesArea

            // Streaming response (token-by-token)
            if let streamText = viewModel.streamingText {
                streamingBubble(text: streamText)
            }

            // Typing indicator
            if viewModel.isTyping {
                typingIndicator
            }

            // Speech error banner
            if let speechError = viewModel.speechError {
                ErrorBanner(
                    message: speechError,
                    onRetry: nil,
                    onDismiss: { viewModel.clearSpeechError() }
                )
                .padding(.horizontal)
            }

            // Input area
            ChatInputView(
                text: $viewModel.inputText,
                recipientName: viewModel.recipientShortName,
                isRecordingVoice: viewModel.isRecordingVoice,
                canSend: viewModel.canSend,
                onSend: {
                    Task {
                        await viewModel.sendMessage()
                        scrollToBottom()
                    }
                },
                onVoiceToggle: {
                    viewModel.toggleVoiceRecording()
                }
            )
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
            // Handle deep link from push notification
            if let agentId = coordinator.pendingChatAgentId {
                coordinator.pendingChatAgentId = nil
                Task {
                    await viewModel.setRecipient(agentId)
                }
            }
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .onChange(of: viewModel.messages.count) { _, _ in
            scrollToBottom()
        }
        .sheet(isPresented: $showConnectionDetails) {
            ConnectionDetailsSheet(
                method: viewModel.communicationMethod,
                state: viewModel.connectionState,
                isStreaming: viewModel.isStreamActive,
                networkType: NetworkMonitor.shared.connectionType,
                serverURL: viewModel.serverURL,
                lastPollTime: viewModel.lastPollTime,
                pollingInterval: 30.0
            )
        }
        .onChange(of: viewModel.streamingText) { _, _ in
            scrollToBottom()
        }
        .onChange(of: viewModel.inputText) { _, _ in
            viewModel.userDidType()
        }
        .sheet(isPresented: $showRecipientSelector) {
            RecipientSelectorSheet(
                recipients: viewModel.availableRecipients,
                selectedRecipient: viewModel.selectedRecipient,
                onSelect: { recipient in
                    Task {
                        await viewModel.setRecipient(recipient)
                    }
                    showRecipientSelector = false
                }
            )
        }
        .fullScreenCover(item: $selectedSession) { session in
            let wsClient = WebSocketClient(
                baseURL: AppState.shared.apiBaseURL,
                apiKey: AppState.shared.apiKey
            )
            SessionChatView(session: session, wsClient: wsClient, showDismiss: true)
        }
    }

    // MARK: - Subviews

    private var chatHeader: some View {
        HStack {
            Button {
                showRecipientSelector = true
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(viewModel.recipientDisplayName, style: .subheader, glowIntensity: .medium)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(theme.primary)
                    }
                    CRTText("DIRECT CHANNEL", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }
            }
            .buttonStyle(.plain)

            Spacer()

            // Session switcher button
            SessionSwitcherButton(onSessionSelected: { session in
                selectedSession = session
            })

            // Connection status badge
            ConnectionStatusBadge(
                method: viewModel.communicationMethod,
                state: viewModel.connectionState,
                isStreaming: viewModel.isStreamActive,
                onTap: { showConnectionDetails = true }
            )
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
                            isOutgoing: viewModel.isOutgoing(message),
                            isPlaying: viewModel.isPlaying(message: message),
                            isSynthesizing: viewModel.isSynthesizing(message: message),
                            onPlay: {
                                Task {
                                    await viewModel.playAudio(for: message)
                                }
                            },
                            onStop: {
                                viewModel.stopAudio()
                            }
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
                            onRetry: {
                                Task { await viewModel.refresh() }
                            },
                            onDismiss: { viewModel.clearError() }
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
                await viewModel.refresh()
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
            CRTText("Send a message to start a conversation with \(viewModel.recipientDisplayName).",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.xl)
    }

    private var typingIndicator: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            CRTText("\(viewModel.recipientDisplayName) IS TYPING", style: .caption, glowIntensity: .subtle, color: theme.dim)
            TypingDots()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func streamingBubble(text: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText(viewModel.recipientDisplayName, style: .caption, glowIntensity: .subtle, color: theme.dim)
                HStack(alignment: .bottom, spacing: 2) {
                    CRTText(text, style: .body, glowIntensity: .subtle)
                    StreamingCursor()
                }
            }
            .padding(CRTTheme.Spacing.sm)
            .background(theme.dim.opacity(0.1))
            .cornerRadius(12)
            Spacer(minLength: 60)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Private Methods

    private func scrollToBottom() {
        withAnimation(.easeOut(duration: 0.2)) {
            scrollProxy?.scrollTo("bottom", anchor: .bottom)
        }
    }
}

// MARK: - Streaming Cursor Animation

/// Blinking cursor shown at the end of streaming text
private struct StreamingCursor: View {
    @Environment(\.crtTheme) private var theme
    @State private var visible = true

    var body: some View {
        Rectangle()
            .fill(theme.primary)
            .frame(width: 2, height: 14)
            .opacity(visible ? 1.0 : 0.0)
            .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: visible)
            .onAppear { visible = false }
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

// MARK: - Recipient Selector Sheet

/// Sheet view for selecting a chat recipient
private struct RecipientSelectorSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let recipients: [CrewMember]
    let selectedRecipient: String
    let onSelect: (String) -> Void

    @State private var searchText = ""

    private var filteredRecipients: [CrewMember] {
        if searchText.isEmpty {
            return recipients
        }
        let query = searchText.lowercased()
        return recipients.filter { crew in
            crew.id.lowercased().contains(query) ||
            crew.name.lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search field
                CRTTextField("Search agents...", text: $searchText, icon: "magnifyingglass")
                    .padding(CRTTheme.Spacing.md)

                // TODO: Consolidate Direct Channel recipient selector with Sessions switcher.
                // In non-Gas Town modes, these serve overlapping purposes.

                // Recipients list
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // Mayor row — only shown in Gas Town mode
                        if AppState.shared.deploymentMode == .gastown {
                            recipientRow(
                                id: "mayor/",
                                name: "Mayor",
                                type: .mayor,
                                isSelected: selectedRecipient == "mayor/"
                            )

                            Divider()
                                .background(theme.dim.opacity(0.3))
                        }

                        // Other recipients
                        ForEach(filteredRecipients) { crew in
                            recipientRow(
                                id: crew.id,
                                name: crew.name,
                                type: crew.type,
                                isSelected: selectedRecipient == crew.id
                            )

                            if crew.id != filteredRecipients.last?.id {
                                Divider()
                                    .background(theme.dim.opacity(0.3))
                            }
                        }
                    }
                }
            }
            .background(CRTTheme.Background.screen)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SELECT RECIPIENT", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(theme.primary)
                }
            }
        }
    }

    @ViewBuilder
    private func recipientRow(id: String, name: String, type: AgentType, isSelected: Bool) -> some View {
        Button {
            onSelect(id)
        } label: {
            HStack {
                // Agent icon
                Image(systemName: iconForAgentType(type))
                    .font(.system(size: 20))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)
                    .frame(width: 32)

                // Name and ID
                VStack(alignment: .leading, spacing: 2) {
                    CRTText(name.uppercased(), style: .body, glowIntensity: isSelected ? .medium : .subtle)
                    CRTText(id, style: .caption, glowIntensity: .none)
                        .foregroundColor(theme.dim)
                }

                Spacer()

                // Selection indicator
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(theme.primary)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .background(isSelected ? theme.primary.opacity(0.1) : Color.clear)
        }
        .buttonStyle(.plain)
    }

    private func iconForAgentType(_ type: AgentType) -> String {
        switch type {
        case .mayor: return "crown"
        case .deacon: return "bell"
        case .witness: return "eye"
        case .refinery: return "gearshape.2"
        case .crew: return "person"
        case .polecat: return "bolt"
        case .user: return "person.circle"
        case .agent: return "cpu"
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
