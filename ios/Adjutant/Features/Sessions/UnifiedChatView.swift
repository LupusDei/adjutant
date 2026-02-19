import SwiftUI
import AdjutantKit

/// Unified chat interface for standalone/swarm modes.
/// Shows a filtered view of session events (only messages and user input as chat bubbles),
/// with a session picker and an expand button to see the full session detail.
struct UnifiedChatView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var loader = SessionLoader()

    var body: some View {
        Group {
            if let session = loader.activeSession, let client = loader.wsClient {
                UnifiedChatContent(
                    session: session,
                    wsClient: client,
                    loader: loader
                )
                .id(session.id)
            } else if loader.isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task {
            await loader.loadIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .switchToSession)) { notification in
            if let sessionId = notification.userInfo?["sessionId"] as? String,
               let target = loader.sessions.first(where: { $0.id == sessionId }) {
                loader.switchTo(target)
            }
        }
        .sheet(isPresented: $loader.showingSessionPicker) {
            SessionsView { session in
                loader.switchTo(session)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("CONNECTING TO SESSION...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO ACTIVE SESSIONS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText(
                "Start an agent session to begin.",
                style: .body,
                glowIntensity: .none,
                color: theme.dim.opacity(0.6)
            )
            .multilineTextAlignment(.center)

            if let error = loader.errorMessage {
                CRTText(error, style: .caption, glowIntensity: .none, color: .red)
                    .padding(.top, CRTTheme.Spacing.sm)
            }

            Button {
                Task { await loader.refresh() }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14))
                    CRTText("REFRESH", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .padding(.top, CRTTheme.Spacing.sm)
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }
}

// MARK: - Unified Chat Content

/// Inner content view that owns the SessionChatViewModel for event streaming.
private struct UnifiedChatContent: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: SessionChatViewModel
    @ObservedObject var loader: SessionLoader
    @State private var showingFullSession = false
    @State private var scrollProxy: ScrollViewProxy?
    @State private var autoScroll = true

    /// Stored for passing to the full session view
    let session: ManagedSession
    let wsClient: WebSocketClient

    init(
        session: ManagedSession,
        wsClient: WebSocketClient,
        loader: SessionLoader
    ) {
        self.session = session
        self.wsClient = wsClient
        _viewModel = StateObject(wrappedValue: SessionChatViewModel(
            session: session,
            wsClient: wsClient
        ))
        self.loader = loader
    }

    /// Filtered events: only messages, user input, and status indicators.
    private var chatEvents: [OutputEvent] {
        viewModel.outputEvents.filter { event in
            switch event {
            case .message, .userInput, .status:
                return true
            default:
                return false
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with session picker and expand button
            headerBar

            // Filtered chat content
            chatArea

            // Error banner
            if let error = viewModel.errorMessage {
                ErrorBanner(
                    message: error,
                    onRetry: nil,
                    onDismiss: { viewModel.clearError() }
                )
                .padding(.horizontal)
            }

            // Input area
            inputArea
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .onChange(of: viewModel.outputEvents.count) { _, _ in
            if autoScroll {
                scrollToBottom()
            }
        }
        .fullScreenCover(isPresented: $showingFullSession) {
            SessionChatView(session: session, wsClient: wsClient, showDismiss: true)
        }
    }

    // MARK: - Header (matches gastown ChatView style)

    private var headerBar: some View {
        HStack {
            // Agent/session picker (matches gastown recipient selector style)
            Button {
                loader.showingSessionPicker = true
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        StatusDot(
                            viewModel.isConnected ? .success : .offline,
                            size: 6,
                            pulse: viewModel.sessionStatus == "working"
                        )

                        CRTText(
                            viewModel.session.name.uppercased(),
                            style: .subheader,
                            glowIntensity: .medium
                        )
                        .lineLimit(1)

                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(theme.primary)
                    }
                    CRTText("AGENT SESSION", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }
            }
            .buttonStyle(.plain)

            Spacer()

            // Full session view button
            Button {
                showingFullSession = true
            } label: {
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "terminal")
                        .font(.system(size: 12, weight: .medium))
                    CRTText("FULL", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xxs)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.primary.opacity(0.1))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            // Connection status indicator
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Circle()
                    .fill(viewModel.isConnected ? Color.green : Color.red)
                    .frame(width: 6, height: 6)
                CRTText(
                    viewModel.isConnected ? "LIVE" : "OFFLINE",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: viewModel.isConnected ? .green : .red
                )
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

    // MARK: - Chat Area

    private var chatArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(chatEvents) { event in
                        OutputEventRenderer(event: event)
                            .id(event.id)
                    }

                    if chatEvents.isEmpty {
                        emptyState
                    }

                    // Bottom anchor
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
            }
            .onAppear {
                scrollProxy = proxy
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
            CRTText(
                viewModel.isConnected ? "WAITING FOR MESSAGES..." : "CONNECTING...",
                style: .subheader,
                glowIntensity: .subtle,
                color: theme.dim
            )
        }
        .frame(maxWidth: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    // MARK: - Input Area

    private var inputArea: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Interrupt button
            Button {
                viewModel.sendInterrupt()
            } label: {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 24))
                    .foregroundColor(.red)
            }
            .disabled(!viewModel.isConnected)

            // Text input
            TextField("Message...", text: $viewModel.inputText)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(theme.dim.opacity(0.1))
                .cornerRadius(8)
                .onSubmit {
                    viewModel.sendInput()
                }
                .disabled(!viewModel.isConnected)

            // Send button
            Button {
                viewModel.sendInput()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 24))
                    .foregroundColor(
                        viewModel.inputText.isEmpty ? theme.dim : theme.primary
                    )
            }
            .disabled(viewModel.inputText.isEmpty || !viewModel.isConnected)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            CRTTheme.Background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .top
                )
        )
    }

    // MARK: - Helpers

    private func scrollToBottom() {
        withAnimation(.easeOut(duration: 0.2)) {
            scrollProxy?.scrollTo("bottom", anchor: .bottom)
        }
    }
}
