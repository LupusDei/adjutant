import SwiftUI

/// Quick Input Floating Action Button.
/// Provides rapid message composition to the Mayor from any screen.
struct QuickInputFAB: View {
    @StateObject private var viewModel = QuickInputViewModel()
    @Environment(\.crtTheme) private var theme
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            // Dimming overlay when expanded
            if viewModel.isExpanded {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(CRTTheme.Animation.buttonPress) {
                            viewModel.close()
                        }
                    }
            }

            // Expanded form or FAB
            if viewModel.isExpanded {
                expandedForm
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.5, anchor: .bottomTrailing).combined(with: .opacity),
                        removal: .scale(scale: 0.5, anchor: .bottomTrailing).combined(with: .opacity)
                    ))
            } else {
                fabButton
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: viewModel.isExpanded)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - FAB Button

    private var fabButton: some View {
        Button {
            withAnimation(CRTTheme.Animation.buttonPress) {
                viewModel.isExpanded = true
            }
        } label: {
            ZStack {
                Circle()
                    .fill(theme.primary)
                    .frame(width: 56, height: 56)

                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 24))
                    .foregroundColor(theme.background.screen)
            }
            .crtGlow(color: theme.primary, radius: 12, intensity: 0.5)
        }
        .buttonStyle(.plain)
        .padding(.trailing, CRTTheme.Spacing.md)
        .padding(.bottom, CRTTheme.Spacing.md)
        .accessibilityLabel("Quick message to Mayor")
        .accessibilityHint("Double tap to compose a quick message")
    }

    // MARK: - Expanded Form

    private var expandedForm: some View {
        VStack(spacing: 0) {
            // Header
            formHeader

            // Status banner (if needed)
            statusBanner

            // Message input
            messageInput

            // Action bar
            actionBar
        }
        .background(theme.background.panel)
        .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .stroke(theme.primary.opacity(0.6), lineWidth: 1)
        )
        .crtGlow(color: theme.primary, radius: 8, intensity: 0.3)
        .frame(maxWidth: 400)
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.bottom, CRTTheme.Spacing.md)
        // Hidden escape key handler
        .background(
            Button("") {
                withAnimation(CRTTheme.Animation.buttonPress) {
                    viewModel.close()
                }
            }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
        )
    }

    // MARK: - Form Header

    private var formHeader: some View {
        HStack {
            // TO badge
            BadgeView("TO: MAYOR", style: .label)

            // FROM badge
            BadgeView("FROM: \(viewModel.identity)", style: .label)

            Spacer()

            // Close button
            Button {
                withAnimation(CRTTheme.Animation.buttonPress) {
                    viewModel.close()
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(theme.dim)
                    .frame(width: 28, height: 28)
                    .background(theme.dim.opacity(0.2))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.primary.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    // MARK: - Status Banner

    @ViewBuilder
    private var statusBanner: some View {
        switch viewModel.sendState {
        case .success:
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(CRTTheme.State.success)
                CRTText("MESSAGE SENT", style: .caption, color: CRTTheme.State.success)
                Spacer()
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(CRTTheme.State.success.opacity(0.15))

        case .error(let message):
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(CRTTheme.State.error)
                CRTText("ERROR SENDING", style: .caption, color: CRTTheme.State.error)
                Spacer()
                Button {
                    viewModel.dismissError()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(CRTTheme.State.error)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(CRTTheme.State.error.opacity(0.15))
            .accessibilityLabel("Error: \(message)")

        default:
            EmptyView()
        }
    }

    // MARK: - Message Input

    private var messageInput: some View {
        CRTTextEditor(
            "Type your message...",
            text: $viewModel.messageBody,
            showCharacterCount: true,
            minHeight: 100
        )
        .focused($isTextFieldFocused)
        .padding(CRTTheme.Spacing.md)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isTextFieldFocused = true
            }
        }
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Voice button (if available)
            if viewModel.isVoiceAvailable {
                Button {
                    viewModel.toggleRecording()
                } label: {
                    Image(systemName: viewModel.isRecording ? "stop.circle.fill" : "mic.fill")
                        .font(.system(size: 20))
                        .foregroundColor(viewModel.isRecording ? CRTTheme.State.error : theme.primary)
                        .frame(width: 44, height: 44)
                        .background(
                            viewModel.isRecording
                                ? CRTTheme.State.error.opacity(0.2)
                                : theme.primary.opacity(0.1)
                        )
                        .clipShape(Circle())
                        .overlay(
                            Circle()
                                .stroke(
                                    viewModel.isRecording ? CRTTheme.State.error : theme.primary.opacity(0.5),
                                    lineWidth: 1
                                )
                        )
                }
                .buttonStyle(.plain)
                .crtGlow(
                    color: viewModel.isRecording ? CRTTheme.State.error : theme.primary,
                    radius: viewModel.isRecording ? 6 : 0,
                    intensity: viewModel.isRecording ? 0.4 : 0
                )
                .accessibilityLabel(viewModel.isRecording ? "Stop recording" : "Start voice recording")
            }

            Spacer()

            // Keyboard shortcut hint
            CRTText("CMD+ENTER TO SEND", style: .caption, glowIntensity: .subtle, color: theme.dim)
                .opacity(0.7)

            // Send button with keyboard shortcut
            Button {
                Task {
                    await viewModel.sendMessage()
                }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    if viewModel.sendState == .sending {
                        InlineLoadingIndicator()
                    }

                    Text("SEND")
                        .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                        .tracking(CRTTheme.Typography.wideLetterSpacing)
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 16)
                .foregroundColor(theme.background.screen)
                .background(viewModel.canSend ? theme.primary : theme.dim)
                .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(viewModel.canSend ? theme.primary : theme.dim, lineWidth: 2)
                )
                .crtGlow(
                    color: theme.primary,
                    radius: 6,
                    intensity: viewModel.canSend ? 0.3 : 0
                )
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSend)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.elevated.opacity(0.5))
    }
}

// MARK: - Keyboard Shortcut Modifier

extension QuickInputFAB {
    /// Adds escape key handling to close the expanded form
    func onEscapeKey(_ action: @escaping () -> Void) -> some View {
        self.background(
            Button("") {
                action()
            }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
        )
    }
}

// MARK: - Preview

#Preview("QuickInputFAB - Collapsed") {
    ZStack {
        CRTTheme.ColorTheme.pipboy.background.screen
            .ignoresSafeArea()

        QuickInputFAB()
    }
}

#Preview("QuickInputFAB - Expanded") {
    struct PreviewWrapper: View {
        @State private var showExpanded = true

        var body: some View {
            ZStack {
                CRTTheme.ColorTheme.pipboy.background.screen
                    .ignoresSafeArea()

                VStack {
                    Text("Background Content")
                        .foregroundColor(.white)
                    Spacer()
                }

                QuickInputFAB()
            }
            .onAppear {
                // Expand after a brief delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    // Would need to expose a way to expand for preview
                }
            }
        }
    }

    return PreviewWrapper()
}
