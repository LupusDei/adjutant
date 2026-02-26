import SwiftUI
import AdjutantKit

/// Live session chat view that connects to an active tmux session via WebSocket v2.
/// Shows streaming terminal output and provides input field + interrupt button.
struct SessionChatView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isInputFocused: Bool
    @StateObject private var viewModel: SessionChatViewModel
    @State private var scrollProxy: ScrollViewProxy?
    @State private var autoScroll = true
    @State private var newContentCount = 0
    @State private var lastScrollTime: Date = .distantPast

    /// When true, shows an X button in the header for dismissing (used in fullScreenCover presentations)
    let showDismiss: Bool

    init(session: ManagedSession, wsClient: WebSocketClient, showDismiss: Bool = false) {
        _viewModel = StateObject(wrappedValue: SessionChatViewModel(
            session: session,
            wsClient: wsClient
        ))
        self.showDismiss = showDismiss
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            sessionHeader

            // Output area
            outputArea

            // Permission prompt (when waiting)
            if viewModel.isWaitingPermission {
                permissionPrompt
            }

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
        .onChange(of: viewModel.outputLines.count) { _, _ in
            scrollToBottomIfNeeded()
        }
        .onChange(of: viewModel.outputEvents.count) { _, _ in
            scrollToBottomIfNeeded()
        }
    }

    // MARK: - Header

    private var sessionHeader: some View {
        HStack {
            // Dismiss button (when presented as fullScreenCover)
            if showDismiss {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(theme.dim)
                }
                .padding(.trailing, CRTTheme.Spacing.xs)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    CRTText(viewModel.session.name.uppercased(), style: .subheader, glowIntensity: .medium)
                    statusBadge
                }
                CRTText("SESSION", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            Spacer()

            // Connection indicator
            HStack(spacing: CRTTheme.Spacing.xs) {
                Circle()
                    .fill(viewModel.isConnected ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                CRTText(
                    viewModel.isConnected ? "LIVE" : "OFFLINE",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: viewModel.isConnected ? .green : .red
                )
            }

            // Clear output button
            Button {
                viewModel.clearOutput()
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundColor(theme.dim)
            }
            .padding(.leading, CRTTheme.Spacing.sm)
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

    private var statusBadge: some View {
        let (label, color) = statusInfo(viewModel.sessionStatus)
        return CRTText(label, style: .caption, glowIntensity: .subtle, color: color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(4)
    }

    // MARK: - Output Area

    /// Whether structured events are available (use chat view vs raw terminal)
    private var hasStructuredEvents: Bool {
        !viewModel.outputEvents.isEmpty
    }

    private var outputArea: some View {
        ZStack(alignment: .bottom) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if hasStructuredEvents {
                            // Structured chat view — parsed output events
                            ForEach(viewModel.outputEvents) { event in
                                OutputEventRenderer(event: event)
                                    .id(event.id)
                            }
                        } else {
                            // Raw terminal view — fallback when no events parsed yet
                            ForEach(viewModel.outputLines) { line in
                                Text(line.text)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(theme.primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .id(line.id)
                            }
                        }

                        if viewModel.outputLines.isEmpty && viewModel.outputEvents.isEmpty {
                            emptyState
                        }

                        // Bottom anchor — visibility drives auto-scroll detection
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                            .onAppear {
                                autoScroll = true
                                newContentCount = 0
                            }
                            .onDisappear {
                                autoScroll = false
                            }
                    }
                    .padding(CRTTheme.Spacing.sm)
                }
                .scrollDismissesKeyboard(.interactively)
                .onAppear {
                    scrollProxy = proxy
                }
            }

            // "Scroll to bottom" button when user has scrolled up
            if !autoScroll && newContentCount > 0 {
                scrollToBottomButton
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
    }

    private var scrollToBottomButton: some View {
        Button {
            autoScroll = true
            newContentCount = 0
            scrollToBottom()
        } label: {
            HStack(spacing: CRTTheme.Spacing.xs) {
                Image(systemName: "arrow.down")
                    .font(.system(size: 12, weight: .bold))
                Text("\(newContentCount) NEW")
                    .font(.system(.caption2, design: .monospaced))
            }
            .foregroundColor(theme.primary)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(CRTTheme.Background.panel)
            .cornerRadius(CRTTheme.CornerRadius.md)
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.primary.opacity(0.5), lineWidth: 1)
            )
        }
        .padding(.bottom, CRTTheme.Spacing.sm)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
            CRTText(
                viewModel.isConnected ? "WAITING FOR OUTPUT..." : "CONNECTING...",
                style: .subheader,
                glowIntensity: .subtle,
                color: theme.dim
            )
        }
        .frame(maxWidth: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    // MARK: - Permission Prompt

    private var permissionPrompt: some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 20))
                .foregroundColor(.orange)

            CRTText("PERMISSION REQUESTED", style: .body, glowIntensity: .medium)

            Spacer()

            Button {
                viewModel.respondToPermission(approved: false)
            } label: {
                CRTText("DENY", style: .caption, glowIntensity: .subtle, color: .red)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .background(Color.red.opacity(0.15))
                    .cornerRadius(6)
            }

            Button {
                viewModel.respondToPermission(approved: true)
            } label: {
                CRTText("APPROVE", style: .caption, glowIntensity: .medium, color: .green)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .background(Color.green.opacity(0.15))
                    .cornerRadius(6)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(Color.orange.opacity(0.1))
    }

    // MARK: - Input Area

    private var inputArea: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Interrupt button (Ctrl-C)
            Button {
                viewModel.sendInterrupt()
            } label: {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 24))
                    .foregroundColor(.red)
            }
            .disabled(!viewModel.isConnected)

            // Text input
            TextField("Send input...", text: $viewModel.inputText)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(theme.dim.opacity(0.1))
                .cornerRadius(8)
                .focused($isInputFocused)
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

    /// Scrolls to bottom only if user is already at bottom.
    /// Skips animation for rapid updates to prevent flickering.
    private func scrollToBottomIfNeeded() {
        guard autoScroll else {
            newContentCount += 1
            return
        }
        let now = Date()
        let elapsed = now.timeIntervalSince(lastScrollTime)
        lastScrollTime = now

        if elapsed < 0.3 {
            // Rapid updates — scroll without animation to prevent flicker
            scrollProxy?.scrollTo("bottom", anchor: .bottom)
        } else {
            withAnimation(.easeOut(duration: 0.2)) {
                scrollProxy?.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private func scrollToBottom() {
        withAnimation(.easeOut(duration: 0.2)) {
            scrollProxy?.scrollTo("bottom", anchor: .bottom)
        }
    }

    private func statusInfo(_ status: String) -> (String, Color) {
        switch status {
        case "working": return ("WORKING", .green)
        case "idle": return ("IDLE", .yellow)
        case "waiting_permission": return ("PERMISSION", .orange)
        case "offline": return ("OFFLINE", .red)
        default: return (status.uppercased(), theme.dim)
        }
    }
}
