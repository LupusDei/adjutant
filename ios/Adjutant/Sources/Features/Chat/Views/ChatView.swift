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
    @StateObject private var keyboardObserver = KeyboardObserver()
    @State private var showRecipientSelector = false
    @State private var showConnectionDetails = false
    @State private var showSearch = false
    @State private var selectedSession: ManagedSession?

    init(apiClient: APIClient, speechService: (any SpeechRecognitionServiceProtocol)? = nil) {
        let service = speechService ?? SpeechRecognitionService()
        _viewModel = StateObject(wrappedValue: ChatViewModel(apiClient: apiClient, speechService: service))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            // Reconnection banner
            if viewModel.connectionState != .connected && viewModel.connectionState != .streaming {
                reconnectionBanner
            }

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

            // Keyboard dismiss button (just above input area)
            if keyboardObserver.isVisible {
                HStack {
                    Spacer()
                    Button {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(theme.primary)
                            .padding(8)
                            .background(
                                Circle()
                                    .fill(theme.background.panel)
                                    .overlay(
                                        Circle()
                                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                                    )
                            )
                            .crtGlow(color: theme.primary, radius: 4, intensity: 0.3)
                    }
                    .padding(.trailing, 12)
                }
                .padding(.vertical, 4)
                .transition(.opacity.combined(with: .scale(scale: 0.8)))
                .animation(.easeOut(duration: 0.15), value: keyboardObserver.isVisible)
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
        .background(theme.background.screen)
        .onAppear {
            viewModel.onAppear()
            scrollToBottom()
            coordinator.activeViewingAgentId = viewModel.selectedRecipient
            NotificationService.shared.isViewingChat = true
            NotificationService.shared.activeViewingAgentId = viewModel.selectedRecipient
            // Handle deep link from push notification
            if let agentId = coordinator.pendingChatAgentId {
                coordinator.pendingChatAgentId = nil
                Task {
                    await viewModel.setRecipient(agentId)
                    coordinator.activeViewingAgentId = agentId
                    NotificationService.shared.activeViewingAgentId = agentId
                }
            }
        }
        .onDisappear {
            viewModel.onDisappear()
            coordinator.activeViewingAgentId = nil
            NotificationService.shared.isViewingChat = false
            NotificationService.shared.activeViewingAgentId = nil
        }
        .onChange(of: viewModel.scrollToBottomTrigger) { _, _ in
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
        .onChange(of: coordinator.pendingChatAgentId) { _, newAgentId in
            if let agentId = newAgentId {
                coordinator.pendingChatAgentId = nil
                Task {
                    await viewModel.setRecipient(agentId)
                    coordinator.activeViewingAgentId = agentId
                    NotificationService.shared.activeViewingAgentId = agentId
                }
            }
        }
        .onChange(of: viewModel.selectedRecipient) { _, newRecipient in
            coordinator.activeViewingAgentId = newRecipient
            NotificationService.shared.activeViewingAgentId = newRecipient
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
                unreadCounts: viewModel.unreadCounts,
                onSelect: { recipient in
                    Task {
                        await viewModel.setRecipient(recipient)
                    }
                    showRecipientSelector = false
                }
            )
        }
        .onChange(of: showRecipientSelector) { _, isShowing in
            if isShowing {
                Task { await viewModel.loadRecipients() }
            }
        }
        .onChange(of: coordinator.selectedTab) { _, newTab in
            if newTab == .chat {
                scrollToBottom()
                Task {
                    await viewModel.loadRecipients()
                    await viewModel.refresh()
                }
            }
        }
        .fullScreenCover(item: $selectedSession) { session in
            let wsClient = WebSocketClient(
                baseURL: AppState.shared.apiBaseURL,
                apiKey: AppState.shared.apiKey
            )
            SessionChatView(session: session, wsClient: wsClient, showDismiss: true)
        }
        .sheet(isPresented: $showSearch) {
            ChatSearchSheet(viewModel: viewModel)
        }
        .onReceive(NotificationCenter.default.publisher(for: .switchToSession)) { notification in
            if let sessionId = notification.userInfo?["sessionId"] as? String {
                Task {
                    if let session = try? await AppState.shared.apiClient.getSession(id: sessionId) {
                        selectedSession = session
                    }
                }
            }
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
                .padding(.vertical, CRTTheme.Spacing.xs)
                .padding(.trailing, CRTTheme.Spacing.md)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            // Search button
            Button {
                showSearch = true
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(theme.primary)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)

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
            theme.background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 20, coordinateSpace: .local)
                .onEnded { value in
                    if value.translation.height > 30 {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    }
                }
        )
    }

    private var reconnectionBanner: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            if viewModel.connectionState == .connecting {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                    .scaleEffect(0.7)
            } else {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 12))
                    .foregroundColor(CRTTheme.State.warning)
            }
            CRTText(
                viewModel.connectionState == .connecting ? "RECONNECTING..." : "CONNECTION LOST",
                style: .caption,
                glowIntensity: .subtle,
                color: viewModel.connectionState == .connecting ? theme.primary : CRTTheme.State.warning
            )
            Spacer()
            if viewModel.connectionState == .disconnected {
                Button {
                    viewModel.onAppear()
                } label: {
                    CRTText("RETRY", style: .caption, glowIntensity: .medium)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            (viewModel.connectionState == .connecting ? theme.primary : CRTTheme.State.warning)
                .opacity(0.1)
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
            .scrollDismissesKeyboard(.interactively)
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
        Group {
            if viewModel.isLoadingHistory {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    LoadingIndicator(size: .small)
                    CRTText("LOADING...", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.dim)
                .padding(.vertical, CRTTheme.Spacing.sm)
            } else {
                Button {
                    Task {
                        await viewModel.loadMoreHistory()
                    }
                } label: {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 12))
                        CRTText("LOAD EARLIER MESSAGES", style: .caption, glowIntensity: .subtle)
                    }
                    .foregroundColor(theme.dim)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                }
                .buttonStyle(.plain)
                .onAppear {
                    // Auto-load when this element scrolls into view
                    Task {
                        await viewModel.loadMoreHistory()
                    }
                }
            }
        }
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

/// Sheet view for selecting a chat recipient.
/// Shows agent status, current task, and assigned beads for context.
private struct RecipientSelectorSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let recipients: [CrewMember]
    let selectedRecipient: String
    let unreadCounts: [String: Int]
    let onSelect: (String) -> Void

    @State private var searchText = ""
    @State private var agentBeads: [String: [BeadInfo]] = [:]

    private let apiClient = AppState.shared.apiClient

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

                // Recipients list
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // Mayor row — only shown in Gas Town mode
                        if AppState.shared.deploymentMode == .gastown {
                            recipientRow(
                                id: "mayor/",
                                name: "Mayor",
                                type: .mayor,
                                status: nil,
                                currentTask: nil,
                                beads: agentBeads["mayor/"] ?? [],
                                isSelected: selectedRecipient == "mayor/",
                                unreadCount: unreadCounts["mayor/"] ?? 0
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
                                status: crew.status,
                                currentTask: crew.currentTask,
                                beads: agentBeads[crew.id] ?? [],
                                isSelected: selectedRecipient == crew.id,
                                unreadCount: unreadCounts[crew.id] ?? 0
                            )

                            if crew.id != filteredRecipients.last?.id {
                                Divider()
                                    .background(theme.dim.opacity(0.3))
                            }
                        }
                    }
                }
            }
            .background(theme.background.screen)
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
        .task {
            await loadAgentBeads()
        }
    }

    @ViewBuilder
    private func recipientRow(
        id: String,
        name: String,
        type: AgentType,
        status: CrewMemberStatus?,
        currentTask: String?,
        beads: [BeadInfo],
        isSelected: Bool,
        unreadCount: Int = 0
    ) -> some View {
        Button {
            onSelect(id)
        } label: {
            HStack {
                // Status dot + agent icon stack
                ZStack(alignment: .bottomTrailing) {
                    Image(systemName: iconForAgentType(type))
                        .font(.system(size: 20))
                        .foregroundColor(isSelected ? theme.primary : theme.dim)
                        .frame(width: 32)

                    if let status {
                        Circle()
                            .fill(statusColor(status))
                            .frame(width: 8, height: 8)
                            .offset(x: 2, y: 2)
                    }
                }

                // Name, status, and bead context
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(name.uppercased(), style: .body, glowIntensity: isSelected ? .medium : .subtle)

                        if let status {
                            CRTText(
                                statusLabel(status),
                                style: .caption,
                                glowIntensity: .subtle,
                                color: statusColor(status)
                            )
                        }
                    }

                    // Show current task prominently when available
                    if let task = currentTask, !task.isEmpty {
                        Text(task)
                            .font(CRTTheme.Typography.font(size: 13, theme: theme))
                            .foregroundColor(theme.dim)
                            .lineLimit(2)
                    } else if let topBead = beads.first {
                        HStack(spacing: CRTTheme.Spacing.xxs) {
                            CRTText(topBead.id, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            CRTText(topBead.title, style: .caption, glowIntensity: .none, color: theme.dim)
                                .lineLimit(1)
                        }
                    }
                }

                Spacer()

                // Bead count badge (if assigned beads)
                if !beads.isEmpty {
                    Text("\(beads.count)")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(theme.dim)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(theme.dim.opacity(0.4), lineWidth: 1)
                        )
                }

                // Unread count badge
                if unreadCount > 0 {
                    Text("\(unreadCount)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(theme.background.screen)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.primary)
                        .clipShape(Capsule())
                }

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

    private func statusColor(_ status: CrewMemberStatus) -> Color {
        switch status {
        case .working: return CRTTheme.State.info
        case .idle: return CRTTheme.State.success
        case .blocked: return CRTTheme.State.warning
        case .stuck: return CRTTheme.State.error
        case .offline: return CRTTheme.State.offline
        }
    }

    private func statusLabel(_ status: CrewMemberStatus) -> String {
        switch status {
        case .working: return "WORKING"
        case .idle: return "IDLE"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }

    /// Checks if a bead's assignee matches a given agent ID.
    /// Handles format differences: assignee may be "rig/type/name" while agent ID could be just "name".
    private func assigneeMatches(_ assignee: String?, agentId: String) -> Bool {
        guard let assignee, !assignee.isEmpty else { return false }
        if assignee == agentId { return true }
        // Match last path component: "adjutant/polecats/toast" matches agent ID "toast"
        if let lastComponent = assignee.split(separator: "/").last, String(lastComponent) == agentId {
            return true
        }
        // Match agent ID as path prefix: agent "adjutant/polecats/toast" matches assignee "toast"
        if let lastComponent = agentId.split(separator: "/").last, String(lastComponent) == assignee {
            return true
        }
        return false
    }

    /// Loads beads and groups them by assignee for display in recipient rows
    private func loadAgentBeads() async {
        do {
            // Fetch active beads (open, hooked, in_progress, blocked) + recently closed
            let activeBeads = try await apiClient.getBeads(rig: "all", status: .default)
            let closedBeads = try await apiClient.getBeads(rig: "all", status: .closed, limit: 50)

            var mapping: [String: [BeadInfo]] = [:]
            let allAgentIds = recipients.map(\.id)

            // Group active beads by matching agent ID
            for bead in activeBeads {
                for agentId in allAgentIds {
                    if assigneeMatches(bead.assignee, agentId: agentId) {
                        mapping[agentId, default: []].append(bead)
                        break
                    }
                }
            }

            // For agents with no active beads, show their last closed bead
            for agentId in allAgentIds where mapping[agentId] == nil {
                if let lastClosed = closedBeads.first(where: { assigneeMatches($0.assignee, agentId: agentId) }) {
                    mapping[agentId] = [lastClosed]
                }
            }

            agentBeads = mapping
        } catch {
            // Non-critical — just show recipients without bead context
        }
    }
}

// MARK: - Chat Search Sheet

/// Sheet for searching chat messages
private struct ChatSearchSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ChatViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search field
                CRTTextField("Search messages...", text: $viewModel.searchQuery, icon: "magnifyingglass")
                    .padding(CRTTheme.Spacing.md)
                    .onChange(of: viewModel.searchQuery) { _, _ in
                        viewModel.performSearch()
                    }

                // Results
                if viewModel.isSearching {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("SEARCHING...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if let results = viewModel.searchResults {
                    if results.isEmpty {
                        Spacer()
                        VStack(spacing: CRTTheme.Spacing.sm) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 36))
                                .foregroundColor(theme.dim)
                            CRTText("NO RESULTS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                        }
                        Spacer()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 0) {
                                ForEach(results) { message in
                                    searchResultRow(message)

                                    if message.id != results.last?.id {
                                        Divider()
                                            .background(theme.dim.opacity(0.3))
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Spacer()
                    VStack(spacing: CRTTheme.Spacing.sm) {
                        Image(systemName: "text.magnifyingglass")
                            .font(.system(size: 36))
                            .foregroundColor(theme.dim)
                        CRTText("SEARCH MESSAGES", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                        CRTText("Type to search conversation history", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
                    }
                    Spacer()
                }
            }
            .background(theme.background.screen)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SEARCH", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        viewModel.clearSearch()
                        dismiss()
                    }
                    .foregroundColor(theme.primary)
                }
            }
        }
    }

    @ViewBuilder
    private func searchResultRow(_ message: PersistentMessage) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            HStack {
                CRTText(
                    message.isFromUser ? "YOU" : message.agentId.uppercased(),
                    style: .caption,
                    glowIntensity: .subtle
                )
                Spacer()
                if let date = message.date {
                    CRTText(
                        date.formatted(date: .abbreviated, time: .shortened),
                        style: .caption,
                        glowIntensity: .none,
                        color: theme.dim
                    )
                }
            }
            CRTText(message.body, style: .body, glowIntensity: .subtle)
                .lineLimit(3)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
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
        .crtTheme(.starcraft)
}
