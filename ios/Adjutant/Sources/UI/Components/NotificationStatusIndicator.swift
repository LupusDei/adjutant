import SwiftUI

// MARK: - NotificationStatusIndicator

/// A header indicator showing notification/voice system status.
///
/// Displays the current state of voice and notification features:
/// - Available: Shows speaker icon with glow
/// - Unavailable: Hidden or dimmed
/// - Muted: Shows mute icon
///
/// ## Example Usage
/// ```swift
/// NotificationStatusIndicator()
///     .onTapGesture {
///         AppState.shared.isVoiceMuted.toggle()
///     }
/// ```
public struct NotificationStatusIndicator: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    /// The size of the indicator icon
    private let iconSize: CGFloat

    /// Creates a notification status indicator.
    /// - Parameter iconSize: The size of the indicator icon (default: 20)
    public init(iconSize: CGFloat = 20) {
        self.iconSize = iconSize
    }

    public var body: some View {
        Button {
            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                appState.isVoiceMuted.toggle()
            }
        } label: {
            indicatorContent
        }
        .buttonStyle(.plain)
        .opacity(appState.isVoiceAvailable ? 1.0 : 0.3)
        .disabled(!appState.isVoiceAvailable)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(accessibilityHint)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Content

    @ViewBuilder
    private var indicatorContent: some View {
        ZStack {
            // Background circle for touch target
            Circle()
                .fill(Color.clear)
                .frame(width: iconSize * 1.8, height: iconSize * 1.8)

            // Icon
            Image(systemName: iconName)
                .font(.system(size: iconSize, weight: .medium))
                .foregroundColor(iconColor)
                .crtGlow(color: glowColor, radius: glowRadius, intensity: glowIntensity)
        }
    }

    // MARK: - Icon Properties

    private var iconName: String {
        if !appState.isVoiceAvailable {
            return "speaker.slash"
        } else if appState.isVoiceMuted {
            return "speaker.slash.fill"
        } else {
            return "speaker.wave.2.fill"
        }
    }

    private var iconColor: Color {
        if !appState.isVoiceAvailable {
            return theme.dim
        } else if appState.isVoiceMuted {
            return CRTTheme.State.warning
        } else {
            return theme.primary
        }
    }

    private var glowColor: Color {
        if !appState.isVoiceAvailable {
            return .clear
        } else if appState.isVoiceMuted {
            return CRTTheme.State.warning
        } else {
            return theme.primary
        }
    }

    private var glowRadius: CGFloat {
        appState.isVoiceAvailable ? 4 : 0
    }

    private var glowIntensity: Double {
        appState.isVoiceAvailable ? 0.5 : 0
    }

    // MARK: - Accessibility

    private var accessibilityLabel: String {
        if !appState.isVoiceAvailable {
            return "Voice unavailable"
        } else if appState.isVoiceMuted {
            return "Voice muted"
        } else {
            return "Voice enabled"
        }
    }

    private var accessibilityHint: String {
        if appState.isVoiceAvailable {
            return appState.isVoiceMuted ? "Double tap to unmute" : "Double tap to mute"
        } else {
            return "Voice features are not available"
        }
    }
}

// MARK: - Compact Variant

/// A compact notification status indicator for tight header spaces.
public struct CompactNotificationStatusIndicator: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    public init() {}

    public var body: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            // Status dot
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
                .crtGlow(color: statusColor, radius: 2, intensity: 0.4)

            // Label
            if appState.isVoiceMuted {
                CRTText("MUTED", style: .caption, color: CRTTheme.State.warning)
            }
        }
        .opacity(appState.isVoiceAvailable ? 1.0 : 0.3)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var statusColor: Color {
        if !appState.isVoiceAvailable {
            return theme.dim
        } else if appState.isVoiceMuted {
            return CRTTheme.State.warning
        } else {
            return CRTTheme.State.success
        }
    }

    private var accessibilityLabel: String {
        if !appState.isVoiceAvailable {
            return "Voice unavailable"
        } else if appState.isVoiceMuted {
            return "Voice muted"
        } else {
            return "Voice available"
        }
    }
}

// MARK: - Preview

#Preview("NotificationStatusIndicator - All States") {
    VStack(spacing: 32) {
        // Available state
        VStack {
            NotificationStatusIndicator()
            CRTText("Available", style: .caption)
        }

        // Muted state (simulated)
        VStack {
            ZStack {
                Circle()
                    .fill(Color.clear)
                    .frame(width: 36, height: 36)

                Image(systemName: "speaker.slash.fill")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(CRTTheme.State.warning)
                    .crtGlow(color: CRTTheme.State.warning, radius: 4, intensity: 0.5)
            }
            CRTText("Muted", style: .caption)
        }

        // Unavailable state (simulated)
        VStack {
            ZStack {
                Circle()
                    .fill(Color.clear)
                    .frame(width: 36, height: 36)

                Image(systemName: "speaker.slash")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(CRTTheme.ColorTheme.pipboy.dim)
            }
            .opacity(0.3)
            CRTText("Unavailable", style: .caption)
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("CompactNotificationStatusIndicator") {
    HStack(spacing: 24) {
        // Available
        VStack {
            CompactNotificationStatusIndicator()
            CRTText("Available", style: .caption)
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
