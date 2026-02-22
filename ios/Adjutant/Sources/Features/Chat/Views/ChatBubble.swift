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

                // Timestamp and delivery status
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    if let date = message.date {
                        CRTText(
                            formatTimestamp(date),
                            style: .caption,
                            glowIntensity: .none,
                            color: theme.dim.opacity(0.6)
                        )
                    }

                    // Delivery status indicator for outgoing messages
                    if isOutgoing {
                        if message.deliveryStatus == .pending {
                            Image(systemName: "clock")
                                .font(.system(size: 10))
                                .foregroundColor(theme.dim.opacity(0.5))
                        } else if message.deliveryStatus == .failed {
                            Button {
                                onRetry?()
                            } label: {
                                HStack(spacing: 2) {
                                    Image(systemName: "exclamationmark.circle")
                                        .font(.system(size: 10))
                                    CRTText("FAILED", style: .caption, glowIntensity: .none, color: CRTTheme.State.error)
                                }
                                .foregroundColor(CRTTheme.State.error)
                            }
                            .buttonStyle(.plain)
                        }
                    }
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
        .background(CRTTheme.Background.screen)
    }
}
