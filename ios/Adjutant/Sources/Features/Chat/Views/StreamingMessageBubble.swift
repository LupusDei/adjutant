import SwiftUI
import AdjutantKit

/// Chat bubble for messages that are actively being streamed.
/// Displays text content that grows as tokens arrive, with a blinking cursor at the end.
struct StreamingMessageBubble: View {
    @Environment(\.crtTheme) private var theme
    @State private var cursorVisible = true
    @State private var timer: Timer?

    let message: Message
    /// Whether the stream encountered an error (connection lost mid-stream)
    var hasError: Bool = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                // Sender label
                CRTText(message.senderName.uppercased(), style: .caption, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)

                // Message bubble with blinking cursor
                HStack(alignment: .bottom, spacing: CRTTheme.Spacing.xs) {
                    bubbleContent

                    // Error indicator
                    if hasError {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(CRTTheme.State.warning)
                            .accessibilityLabel("Stream interrupted")
                    }
                }
            }

            Spacer(minLength: 60)
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                withAnimation(.easeInOut(duration: 0.15)) {
                    cursorVisible.toggle()
                }
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(message.senderName) is responding: \(message.body)")
    }

    private var bubbleContent: some View {
        Group {
            if message.body.isEmpty {
                // Stream just started, no content yet — show just the cursor
                Text(cursorVisible ? "▎" : "\u{00A0}")
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
            } else {
                // Content with trailing cursor
                Text(message.body + (cursorVisible ? "▎" : "\u{00A0}"))
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    .animation(.easeInOut(duration: 0.08), value: message.body)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .fill(CRTTheme.Background.elevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .stroke(hasError ? CRTTheme.State.warning.opacity(0.6) : theme.dim.opacity(0.6), lineWidth: 1)
        )
        .crtGlow(
            color: hasError ? CRTTheme.State.warning : theme.dim,
            radius: 4,
            intensity: 0.2
        )
    }
}

// MARK: - Preview

struct StreamingMessageBubble_Previews: PreviewProvider {
    static var previews: some View {
        let message = Message(
            id: "stream-1",
            from: "mayor/",
            to: "user",
            subject: "",
            body: "I'm processing your request and here is the partial response so far",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: true,
            priority: .normal,
            type: .task,
            threadId: "",
            pinned: false,
            isInfrastructure: false
        )

        VStack(spacing: 16) {
            StreamingMessageBubble(message: message)
            StreamingMessageBubble(message: message, hasError: true)
        }
        .padding()
        .background(CRTTheme.Background.screen)
    }
}
