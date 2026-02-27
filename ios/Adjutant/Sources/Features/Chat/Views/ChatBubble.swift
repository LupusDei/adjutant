import SwiftUI
import AdjutantKit

/// SMS-style chat bubble for displaying messages.
struct ChatBubble: View {
    @Environment(\.crtTheme) private var theme

    let message: PersistentMessage
    let isOutgoing: Bool

    /// Whether this message is currently playing audio
    var isPlaying: Bool = false

    /// Whether this message is currently synthesizing audio
    var isSynthesizing: Bool = false

    /// Callback when play button is tapped
    var onPlay: (() -> Void)?

    /// Callback when stop button is tapped
    var onStop: (() -> Void)?

    /// Callback when retry button is tapped (for failed messages)
    var onRetry: (() -> Void)?

    /// Bubble alignment based on message direction
    private var alignment: HorizontalAlignment {
        isOutgoing ? .trailing : .leading
    }

    /// Bubble background color
    private var bubbleColor: Color {
        if isOutgoing {
            return theme.primary.opacity(0.2)
        } else {
            return theme.background.elevated
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
        HStack(alignment: .bottom, spacing: CRTTheme.Spacing.xxs) {
            if isOutgoing {
                Spacer(minLength: 40)
                // Timestamp + delivery status to the left of outgoing bubbles
                VStack(alignment: .trailing, spacing: 2) {
                    if isOutgoing {
                        deliveryStatusView
                    }
                    if let date = message.date {
                        Text(formatTimestamp(date))
                            .font(CRTTheme.Typography.font(size: 10))
                            .foregroundColor(theme.dim.opacity(0.4))
                    }
                }
            }

            VStack(alignment: alignment, spacing: CRTTheme.Spacing.xxs) {
                // Sender label for incoming messages
                if !isOutgoing {
                    CRTText(message.senderName.uppercased(), style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                }

                // Message content with optional play button
                HStack(alignment: .bottom, spacing: CRTTheme.Spacing.xs) {
                    // Message bubble
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

                    // Play/Stop button for incoming messages
                    if !isOutgoing, let onPlay = onPlay, let onStop = onStop {
                        Button {
                            if isPlaying {
                                onStop()
                            } else {
                                onPlay()
                            }
                        } label: {
                            if isSynthesizing {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: theme.dim))
                                    .frame(width: 24, height: 24)
                            } else {
                                Image(systemName: isPlaying ? "stop.fill" : "speaker.wave.2.fill")
                                    .font(.system(size: 14))
                                    .foregroundColor(isPlaying ? CRTTheme.State.error : theme.dim)
                                    .frame(width: 24, height: 24)
                            }
                        }
                        .disabled(isSynthesizing)
                        .accessibilityLabel(isPlaying ? "Stop audio" : "Play audio")
                    }
                }
            }

            if !isOutgoing {
                // Timestamp to the right of incoming bubbles
                if let date = message.date {
                    Text(formatTimestamp(date))
                        .font(CRTTheme.Typography.font(size: 10))
                        .foregroundColor(theme.dim.opacity(0.4))
                }
                Spacer(minLength: 40)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isOutgoing ? "You" : message.senderName): \(message.body)")
    }

    /// Delivery status indicator for outgoing messages
    @ViewBuilder
    private var deliveryStatusView: some View {
        if message.deliveryStatus == .pending {
            Image(systemName: "clock")
                .font(.system(size: 9))
                .foregroundColor(theme.dim.opacity(0.4))
        } else if message.deliveryStatus == .failed {
            Button {
                onRetry?()
            } label: {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 9))
                    .foregroundColor(CRTTheme.State.error)
            }
            .buttonStyle(.plain)
        }
    }

    /// Format the message timestamp for minimal display (e.g. "2/26 8:02pm")
    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            formatter.dateFormat = "h:mma"
        } else if calendar.component(.year, from: date) == calendar.component(.year, from: Date()) {
            formatter.dateFormat = "M/d h:mma"
        } else {
            formatter.dateFormat = "M/d/yy h:mma"
        }

        formatter.amSymbol = "am"
        formatter.pmSymbol = "pm"
        return formatter.string(from: date)
    }
}

// MARK: - Preview

struct ChatBubble_Previews: PreviewProvider {
    static var previews: some View {
        let now = ISO8601DateFormatter().string(from: Date())

        let incomingMessage = PersistentMessage(
            id: "test-1",
            agentId: "mayor",
            recipient: "user",
            role: .agent,
            body: "Welcome to Gas Town. How can I help you today?",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )

        let outgoingMessage = PersistentMessage(
            id: "test-2",
            agentId: "user",
            recipient: "mayor",
            role: .user,
            body: "I need to check the status of my convoy.",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )

        VStack(spacing: 16) {
            ChatBubble(message: incomingMessage, isOutgoing: false)
            ChatBubble(message: outgoingMessage, isOutgoing: true)
        }
        .padding()
        .background(CRTTheme.ColorTheme.pipboy.background.screen)
    }
}
