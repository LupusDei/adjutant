import SwiftUI
import AdjutantKit

/// SMS-style chat bubble for displaying messages.
struct ChatBubble: View {
    @Environment(\.crtTheme) private var theme

    let message: Message
    let isOutgoing: Bool

    /// Bubble alignment based on message direction
    private var alignment: HorizontalAlignment {
        isOutgoing ? .trailing : .leading
    }

    /// Bubble background color
    private var bubbleColor: Color {
        if isOutgoing {
            return theme.primary.opacity(0.2)
        } else {
            return CRTTheme.Background.elevated
        }
    }

    /// Border color
    private var borderColor: Color {
        if isOutgoing {
            return theme.primary.opacity(0.6)
        } else {
            return theme.dim.opacity(0.6)
        }
    }

    var body: some View {
        HStack {
            if isOutgoing {
                Spacer(minLength: 60)
            }

            VStack(alignment: alignment, spacing: CRTTheme.Spacing.xxs) {
                // Sender label for incoming messages
                if !isOutgoing {
                    CRTText(message.senderName.uppercased(), style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                }

                // Message content
                Text(message.body)
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                            .fill(bubbleColor)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                            .stroke(borderColor, lineWidth: 1)
                    )
                    .crtGlow(
                        color: isOutgoing ? theme.primary : theme.dim,
                        radius: 4,
                        intensity: 0.2
                    )

                // Timestamp
                if let date = message.date {
                    CRTText(
                        formatTimestamp(date),
                        style: .caption,
                        glowIntensity: .none,
                        color: theme.dim.opacity(0.6)
                    )
                }
            }

            if !isOutgoing {
                Spacer(minLength: 60)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isOutgoing ? "You" : message.senderName): \(message.body)")
    }

    /// Format the message timestamp for display
    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
        } else if calendar.isDateInYesterday(date) {
            formatter.dateFormat = "'YESTERDAY' HH:mm"
        } else {
            formatter.dateFormat = "MMM d, HH:mm"
        }

        return formatter.string(from: date).uppercased()
    }
}

// MARK: - Preview

struct ChatBubble_Previews: PreviewProvider {
    static var previews: some View {
        let incomingMessage = Message(
            id: "test-1",
            from: "mayor/",
            to: "user",
            subject: "",
            body: "Welcome to Gas Town. How can I help you today?",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: true,
            priority: .normal,
            type: .notification,
            threadId: "thread-1",
            pinned: false,
            isInfrastructure: false
        )

        let outgoingMessage = Message(
            id: "test-2",
            from: "user",
            to: "mayor/",
            subject: "",
            body: "I need to check the status of my convoy.",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: true,
            priority: .normal,
            type: .task,
            threadId: "thread-1",
            pinned: false,
            isInfrastructure: false
        )

        VStack(spacing: 16) {
            ChatBubble(message: incomingMessage, isOutgoing: false)
            ChatBubble(message: outgoingMessage, isOutgoing: true)
        }
        .padding()
        .background(CRTTheme.Background.screen)
    }
}
