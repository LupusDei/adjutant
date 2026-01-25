import SwiftUI

/// Input area for composing chat messages with text and voice options.
struct ChatInputView: View {
    @Environment(\.crtTheme) private var theme
    @FocusState private var isTextFieldFocused: Bool

    @Binding var text: String
    let isRecordingVoice: Bool
    let canSend: Bool
    let onSend: () -> Void
    let onVoiceToggle: () -> Void

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            // Voice input button
            voiceButton

            // Text input
            textInput

            // Send button
            sendButton
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            Rectangle()
                .fill(CRTTheme.Background.panel)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .top
                )
        )
    }

    // MARK: - Subviews

    private var voiceButton: some View {
        Button(action: onVoiceToggle) {
            Image(systemName: isRecordingVoice ? "mic.fill" : "mic")
                .font(.system(size: 20))
                .foregroundColor(isRecordingVoice ? CRTTheme.State.error : theme.primary)
                .frame(width: 44, height: 44)
                .background(
                    Circle()
                        .fill(isRecordingVoice ? CRTTheme.State.error.opacity(0.2) : Color.clear)
                )
                .overlay(
                    Circle()
                        .stroke(
                            isRecordingVoice ? CRTTheme.State.error : theme.dim.opacity(0.5),
                            lineWidth: 1
                        )
                )
        }
        .buttonStyle(.plain)
        .crtGlow(
            color: isRecordingVoice ? CRTTheme.State.error : theme.primary,
            radius: isRecordingVoice ? 8 : 0,
            intensity: isRecordingVoice ? 0.4 : 0
        )
        .animation(.easeInOut(duration: 0.2), value: isRecordingVoice)
        .accessibilityLabel(isRecordingVoice ? "Stop recording" : "Start voice input")
    }

    private var textInput: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            TextField("", text: $text, prompt: promptText, axis: .vertical)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                .focused($isTextFieldFocused)
                .lineLimit(1...4)
                .onSubmit {
                    if canSend {
                        onSend()
                    }
                }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .fill(CRTTheme.Background.elevated.opacity(isTextFieldFocused ? 0.8 : 0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .stroke(
                    isTextFieldFocused ? theme.primary : theme.dim.opacity(0.3),
                    lineWidth: isTextFieldFocused ? 2 : 1
                )
        )
        .crtGlow(
            color: theme.primary,
            radius: isTextFieldFocused ? 4 : 0,
            intensity: isTextFieldFocused ? 0.2 : 0
        )
        .animation(.easeInOut(duration: 0.1), value: isTextFieldFocused)
        .accessibilityLabel("Message input")
    }

    private var sendButton: some View {
        Button(action: onSend) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 32))
                .foregroundColor(canSend ? theme.primary : theme.dim.opacity(0.3))
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .crtGlow(
            color: theme.primary,
            radius: canSend ? 6 : 0,
            intensity: canSend ? 0.4 : 0
        )
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .accessibilityLabel("Send message")
        .accessibilityHint(canSend ? "Double tap to send" : "Enter a message first")
    }

    private var promptText: Text {
        Text("MESSAGE MAYOR...")
            .foregroundColor(theme.dim.opacity(0.5))
    }
}

// MARK: - Preview

#Preview("ChatInputView") {
    struct PreviewWrapper: View {
        @State private var text = ""
        @State private var isRecording = false

        var body: some View {
            VStack {
                Spacer()
                ChatInputView(
                    text: $text,
                    isRecordingVoice: isRecording,
                    canSend: !text.isEmpty,
                    onSend: { text = "" },
                    onVoiceToggle: { isRecording.toggle() }
                )
            }
            .background(CRTTheme.Background.screen)
        }
    }

    return PreviewWrapper()
}

#Preview("ChatInputView with Text") {
    struct PreviewWrapper: View {
        @State private var text = "Hello Mayor, I have a question"
        @State private var isRecording = false

        var body: some View {
            VStack {
                Spacer()
                ChatInputView(
                    text: $text,
                    isRecordingVoice: isRecording,
                    canSend: !text.isEmpty,
                    onSend: { },
                    onVoiceToggle: { }
                )
            }
            .background(CRTTheme.Background.screen)
        }
    }

    return PreviewWrapper()
}
