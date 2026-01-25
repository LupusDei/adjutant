import SwiftUI

// MARK: - ErrorBanner

/// A banner view for displaying error messages with CRT styling.
///
/// `ErrorBanner` provides a prominent error display with optional
/// dismiss and retry actions.
///
/// ## Example Usage
/// ```swift
/// ErrorBanner(message: "Connection failed")
///
/// ErrorBanner(
///     message: "Unable to load messages",
///     details: "Check your network connection",
///     onRetry: { loadMessages() },
///     onDismiss: { clearError() }
/// )
/// ```
public struct ErrorBanner: View {
    @Environment(\.crtTheme) private var theme

    private let message: String
    private let details: String?
    private let style: Style
    private let onRetry: (() -> Void)?
    private let onDismiss: (() -> Void)?

    /// Banner visual styles
    public enum Style {
        case error      // Red/critical
        case warning    // Amber/warning
        case info       // Blue/informational

        var color: Color {
            switch self {
            case .error: return CRTTheme.State.error
            case .warning: return CRTTheme.State.warning
            case .info: return CRTTheme.State.info
            }
        }

        var icon: String {
            switch self {
            case .error: return "exclamationmark.triangle.fill"
            case .warning: return "exclamationmark.circle.fill"
            case .info: return "info.circle.fill"
            }
        }

        var accessibilityPrefix: String {
            switch self {
            case .error: return "Error"
            case .warning: return "Warning"
            case .info: return "Information"
            }
        }
    }

    /// Creates an error banner.
    /// - Parameters:
    ///   - message: The main error message
    ///   - details: Optional additional details
    ///   - style: The visual style (default: `.error`)
    ///   - onRetry: Optional retry action
    ///   - onDismiss: Optional dismiss action
    public init(
        message: String,
        details: String? = nil,
        style: Style = .error,
        onRetry: (() -> Void)? = nil,
        onDismiss: (() -> Void)? = nil
    ) {
        self.message = message
        self.details = details
        self.style = style
        self.onRetry = onRetry
        self.onDismiss = onDismiss
    }

    public var body: some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
            // Icon
            Image(systemName: style.icon)
                .font(.system(size: 20))
                .foregroundColor(style.color)
                .crtGlow(color: style.color, radius: 4, intensity: 0.5)

            // Message content
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                Text(message.uppercased())
                    .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .foregroundColor(style.color)

                if let details = details {
                    Text(details)
                        .font(CRTTheme.Typography.font(size: 12))
                        .foregroundColor(style.color.opacity(0.8))
                }
            }

            Spacer()

            // Actions
            HStack(spacing: CRTTheme.Spacing.xs) {
                if let onRetry = onRetry {
                    Button(action: onRetry) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(style.color)
                    }
                    .accessibilityLabel("Retry")
                }

                if let onDismiss = onDismiss {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(style.color.opacity(0.7))
                    }
                    .accessibilityLabel("Dismiss")
                }
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(style.color.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(style.color.opacity(0.5), lineWidth: 1)
        )
        .crtGlow(color: style.color, radius: 4, intensity: 0.2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(style.accessibilityPrefix): \(message)")
        .accessibilityHint(details ?? "")
    }
}

// MARK: - Inline Error Text

/// A compact inline error message display.
public struct InlineError: View {
    @Environment(\.crtTheme) private var theme

    private let message: String

    /// Creates an inline error message.
    /// - Parameter message: The error message to display
    public init(_ message: String) {
        self.message = message
    }

    public var body: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 12))

            Text(message)
                .font(CRTTheme.Typography.font(size: 12))
        }
        .foregroundColor(CRTTheme.State.error)
        .accessibilityLabel("Error: \(message)")
    }
}

// MARK: - Empty State View

/// A view for displaying empty or "no content" states.
public struct EmptyStateView: View {
    @Environment(\.crtTheme) private var theme

    private let title: String
    private let message: String?
    private let icon: String?
    private let action: (() -> Void)?
    private let actionTitle: String?

    /// Creates an empty state view.
    /// - Parameters:
    ///   - title: The main title text
    ///   - message: Optional description message
    ///   - icon: Optional SF Symbol name
    ///   - actionTitle: Optional action button title
    ///   - action: Optional action to perform
    public init(
        title: String,
        message: String? = nil,
        icon: String? = nil,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.message = message
        self.icon = icon
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            if let icon = icon {
                Image(systemName: icon)
                    .font(.system(size: 40))
                    .foregroundColor(theme.dim)
            }

            VStack(spacing: CRTTheme.Spacing.xs) {
                CRTText(title, style: .subheader, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)

                if let message = message {
                    CRTText(message, style: .caption, glowIntensity: .none)
                        .foregroundColor(theme.dim.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
            }

            if let actionTitle = actionTitle, let action = action {
                CRTButton(actionTitle, variant: .secondary, size: .small, action: action)
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityHint(message ?? "")
    }
}

// MARK: - Preview

#Preview("ErrorBanner Styles") {
    VStack(spacing: 16) {
        ErrorBanner(
            message: "Connection failed",
            details: "Unable to reach the server. Please check your network.",
            onRetry: { },
            onDismiss: { }
        )

        ErrorBanner(
            message: "Session expired",
            style: .warning,
            onDismiss: { }
        )

        ErrorBanner(
            message: "New version available",
            details: "Update to get the latest features",
            style: .info
        )
    }
    .padding()
    .background(CRTTheme.Background.screen)
}

#Preview("InlineError") {
    VStack(alignment: .leading, spacing: 8) {
        CRTTextField("Email", text: .constant("invalid"))
        InlineError("Invalid email format")
    }
    .padding()
    .background(CRTTheme.Background.screen)
}

#Preview("EmptyStateView") {
    VStack(spacing: 32) {
        EmptyStateView(
            title: "NO MESSAGES",
            message: "Your inbox is empty",
            icon: "envelope"
        )

        EmptyStateView(
            title: "NO RESULTS",
            message: "Try adjusting your search filters",
            icon: "magnifyingglass",
            actionTitle: "CLEAR FILTERS",
            action: { }
        )
    }
    .background(CRTTheme.Background.screen)
}
