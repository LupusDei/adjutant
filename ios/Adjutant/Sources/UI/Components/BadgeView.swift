import SwiftUI

// MARK: - BadgeView

/// A badge view for displaying counts, status, or labels with CRT styling.
///
/// `BadgeView` provides various badge styles for notifications, status indicators,
/// priority levels, and general labeling.
///
/// ## Example Usage
/// ```swift
/// BadgeView("5", style: .count)
///
/// BadgeView("ACTIVE", style: .status(.success))
///
/// BadgeView("P1", style: .priority(.high))
///
/// BadgeView("MAIL", style: .label)
/// ```
public struct BadgeView: View {
    @Environment(\.crtTheme) private var theme

    private let text: String
    private let style: Style

    /// Badge visual styles
    public enum Style {
        case count              // Numeric count badge (e.g., unread count)
        case label              // Text label badge
        case status(StatusType) // Status indicator
        case priority(Int)      // Priority level (0-4)
        case tag                // Generic tag style

        /// Status types for status badges
        public enum StatusType {
            case success    // Green/active
            case warning    // Amber/blocked
            case error      // Red/stuck
            case offline    // Gray/offline
            case info       // Blue/informational

            var color: Color {
                switch self {
                case .success: return CRTTheme.State.success
                case .warning: return CRTTheme.State.warning
                case .error: return CRTTheme.State.error
                case .offline: return CRTTheme.State.offline
                case .info: return CRTTheme.State.info
                }
            }
        }
    }

    /// Creates a badge view.
    /// - Parameters:
    ///   - text: The badge text content
    ///   - style: The visual style (default: `.label`)
    public init(_ text: String, style: Style = .label) {
        self.text = text
        self.style = style
    }

    public var body: some View {
        Text(text.uppercased())
            .font(CRTTheme.Typography.font(size: fontSize, weight: fontWeight, theme: theme))
            .tracking(letterSpacing)
            .foregroundColor(foregroundColor)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .background(background)
            .clipShape(shape)
            .overlay(border)
            .crtGlow(color: glowColor, radius: 2, intensity: glowIntensity)
            .accessibilityLabel(accessibilityText)
    }

    // MARK: - Style Properties

    private var fontSize: CGFloat {
        switch style {
        case .count: return 10
        case .label, .tag: return 11
        case .status, .priority: return 10
        }
    }

    private var fontWeight: Font.Weight {
        switch style {
        case .count, .priority: return .bold
        case .label, .status, .tag: return .medium
        }
    }

    private var letterSpacing: CGFloat {
        switch style {
        case .count: return 0
        case .label, .status, .priority, .tag: return 0.5
        }
    }

    private var horizontalPadding: CGFloat {
        switch style {
        case .count: return 5
        case .label, .tag: return 8
        case .status, .priority: return 6
        }
    }

    private var verticalPadding: CGFloat {
        switch style {
        case .count: return 2
        case .label, .tag: return 4
        case .status, .priority: return 3
        }
    }

    private var foregroundColor: Color {
        switch style {
        case .count:
            return theme.background.screen
        case .label, .tag:
            return theme.primary
        case .status(let type):
            return type.color
        case .priority(let level):
            return priorityColor(for: level)
        }
    }

    private var background: some View {
        Group {
            switch style {
            case .count:
                theme.primary
            case .label, .tag:
                theme.primary.opacity(0.15)
            case .status(let type):
                type.color.opacity(0.15)
            case .priority(let level):
                priorityColor(for: level).opacity(0.15)
            }
        }
    }

    private var shape: AnyShape {
        switch style {
        case .count:
            AnyShape(Capsule())
        default:
            AnyShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
        }
    }

    @ViewBuilder
    private var border: some View {
        switch style {
        case .count:
            Capsule()
                .stroke(theme.primary, lineWidth: 0)
        case .label, .tag:
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        case .status(let type):
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(type.color.opacity(0.5), lineWidth: 1)
        case .priority(let level):
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(priorityColor(for: level).opacity(0.5), lineWidth: 1)
        }
    }

    private var glowColor: Color {
        switch style {
        case .count, .label, .tag:
            return theme.primary
        case .status(let type):
            return type.color
        case .priority(let level):
            return priorityColor(for: level)
        }
    }

    private var glowIntensity: Double {
        switch style {
        case .count: return 0.4
        case .status: return 0.3
        default: return 0.2
        }
    }

    private func priorityColor(for level: Int) -> Color {
        switch level {
        case 0: return CRTTheme.Priority.urgent
        case 1: return CRTTheme.Priority.high
        case 2: return theme.primary
        case 3: return theme.dim
        default: return CRTTheme.Priority.lowest
        }
    }

    private var accessibilityText: String {
        switch style {
        case .count:
            return "\(text) items"
        case .status(let type):
            let statusName: String
            switch type {
            case .success: statusName = "active"
            case .warning: statusName = "warning"
            case .error: statusName = "error"
            case .offline: statusName = "offline"
            case .info: statusName = "info"
            }
            return "\(text), status \(statusName)"
        case .priority(let level):
            return "Priority \(level), \(text)"
        default:
            return text
        }
    }
}

// MARK: - Status Dot

/// A simple status indicator dot with optional pulse animation.
public struct StatusDot: View {
    @Environment(\.crtTheme) private var theme
    @State private var isPulsing = false

    private let status: BadgeView.Style.StatusType
    private let size: CGFloat
    private let pulse: Bool

    /// Creates a status indicator dot.
    /// - Parameters:
    ///   - status: The status type
    ///   - size: The dot diameter (default: `8`)
    ///   - pulse: Whether to animate with a pulse (default: `false`)
    public init(_ status: BadgeView.Style.StatusType, size: CGFloat = 8, pulse: Bool = false) {
        self.status = status
        self.size = size
        self.pulse = pulse
    }

    public var body: some View {
        ZStack {
            // Pulse ring
            if pulse {
                Circle()
                    .fill(status.color.opacity(0.3))
                    .frame(width: size * 2, height: size * 2)
                    .scaleEffect(isPulsing ? 1.5 : 1.0)
                    .opacity(isPulsing ? 0 : 0.5)
                    .animation(
                        .easeInOut(duration: 1.0).repeatForever(autoreverses: false),
                        value: isPulsing
                    )
            }

            // Main dot
            Circle()
                .fill(status.color)
                .frame(width: size, height: size)
                .crtGlow(color: status.color, radius: 3, intensity: 0.6)
        }
        .onAppear {
            if pulse {
                isPulsing = true
            }
        }
        .accessibilityLabel("Status: \(statusName)")
    }

    private var statusName: String {
        switch status {
        case .success: return "active"
        case .warning: return "warning"
        case .error: return "error"
        case .offline: return "offline"
        case .info: return "info"
        }
    }
}

// MARK: - Unread Badge

/// A compact unread count badge for notifications.
public struct UnreadBadge: View {
    @Environment(\.crtTheme) private var theme

    private let count: Int

    /// Creates an unread count badge.
    /// - Parameter count: The unread count to display
    public init(_ count: Int) {
        self.count = count
    }

    public var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(CRTTheme.Typography.font(size: 10, weight: .bold, theme: theme))
                .foregroundColor(theme.background.screen)
                .padding(.horizontal, count > 9 ? 5 : 4)
                .padding(.vertical, 2)
                .background(Capsule().fill(CRTTheme.State.error))
                .crtGlow(color: CRTTheme.State.error, radius: 3, intensity: 0.5)
                .accessibilityLabel("\(count) unread")
        }
    }
}

// MARK: - Preview

#Preview("BadgeView Styles") {
    VStack(spacing: 16) {
        HStack(spacing: 12) {
            BadgeView("5", style: .count)
            BadgeView("12", style: .count)
            BadgeView("99+", style: .count)
        }

        HStack(spacing: 12) {
            BadgeView("MAIL", style: .label)
            BadgeView("CREW", style: .label)
            BadgeView("TASK", style: .tag)
        }

        HStack(spacing: 12) {
            BadgeView("ACTIVE", style: .status(.success))
            BadgeView("BLOCKED", style: .status(.warning))
            BadgeView("STUCK", style: .status(.error))
            BadgeView("OFFLINE", style: .status(.offline))
        }

        HStack(spacing: 12) {
            BadgeView("P0", style: .priority(0))
            BadgeView("P1", style: .priority(1))
            BadgeView("P2", style: .priority(2))
            BadgeView("P3", style: .priority(3))
            BadgeView("P4", style: .priority(4))
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("StatusDot") {
    HStack(spacing: 24) {
        VStack {
            StatusDot(.success)
            Text("Active").font(.caption)
        }

        VStack {
            StatusDot(.success, pulse: true)
            Text("Pulsing").font(.caption)
        }

        VStack {
            StatusDot(.warning)
            Text("Warning").font(.caption)
        }

        VStack {
            StatusDot(.error, pulse: true)
            Text("Error").font(.caption)
        }

        VStack {
            StatusDot(.offline)
            Text("Offline").font(.caption)
        }
    }
    .foregroundColor(.white)
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("UnreadBadge") {
    HStack(spacing: 24) {
        UnreadBadge(0)
        UnreadBadge(3)
        UnreadBadge(12)
        UnreadBadge(99)
        UnreadBadge(150)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
