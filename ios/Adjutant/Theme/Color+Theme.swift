import SwiftUI

// MARK: - Theme-Aware Color Extensions

extension Color {
    /// Primary phosphor color for current theme
    public static func crtPrimary(for theme: CRTTheme) -> Color {
        theme.primary
    }

    /// Bright/highlighted color for current theme
    public static func crtBright(for theme: CRTTheme) -> Color {
        theme.bright
    }

    /// Dim/muted color for current theme
    public static func crtDim(for theme: CRTTheme) -> Color {
        theme.dim
    }

    /// Glow color for current theme
    public static func crtGlow(for theme: CRTTheme) -> Color {
        theme.glow
    }

    /// Bloom color for current theme
    public static func crtBloom(for theme: CRTTheme) -> Color {
        theme.bloom
    }

    // MARK: - Static Theme Colors

    /// CRT screen background
    public static let crtBackground = CRTTheme.screenBackground

    /// CRT panel background
    public static let crtPanel = CRTTheme.panelBackground

    /// CRT bezel color
    public static let crtBezel = CRTTheme.bezel

    /// CRT error/danger color
    public static let crtError = CRTTheme.error

    /// CRT warning/amber color
    public static let crtAmber = CRTTheme.amber

    /// CRT offline/disabled color
    public static let crtOffline = CRTTheme.offline
}

// MARK: - UIColor Extensions

extension UIColor {
    /// Create UIColor from CRT theme primary
    public static func crtPrimary(for theme: CRTTheme) -> UIColor {
        UIColor(theme.primary)
    }

    /// Create UIColor from CRT theme bright
    public static func crtBright(for theme: CRTTheme) -> UIColor {
        UIColor(theme.bright)
    }

    /// Create UIColor from CRT theme dim
    public static func crtDim(for theme: CRTTheme) -> UIColor {
        UIColor(theme.dim)
    }

    /// CRT screen background
    public static let crtBackground = UIColor(CRTTheme.screenBackground)

    /// CRT panel background
    public static let crtPanel = UIColor(CRTTheme.panelBackground)

    /// CRT error color
    public static let crtError = UIColor(CRTTheme.error)

    /// CRT amber/warning color
    public static let crtAmber = UIColor(CRTTheme.amber)
}

// MARK: - CGColor Extensions

extension CGColor {
    /// Create CGColor from CRT theme primary
    public static func crtPrimary(for theme: CRTTheme) -> CGColor {
        let rgb = theme.primaryRGB
        return CGColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1.0)
    }
}

// MARK: - Semantic Color Helpers

extension Color {
    /// Status indicator color
    public static func crtStatus(_ status: CRTTheme.StatusColor, theme: CRTTheme) -> Color {
        status.color(for: theme)
    }

    /// Priority badge color
    public static func crtPriority(_ priority: CRTTheme.PriorityColor, theme: CRTTheme) -> Color {
        priority.color(for: theme)
    }

    /// Text color based on emphasis
    public static func crtText(emphasis: TextEmphasis, theme: CRTTheme) -> Color {
        switch emphasis {
        case .primary:
            return theme.primary
        case .secondary:
            return theme.dim
        case .muted:
            return theme.dim.opacity(0.7)
        case .disabled:
            return CRTTheme.offline
        case .bright:
            return theme.bright
        }
    }

    /// Text emphasis levels
    public enum TextEmphasis {
        case primary
        case secondary
        case muted
        case disabled
        case bright
    }
}

// MARK: - Border Colors

extension Color {
    /// Border color based on state
    public static func crtBorder(state: BorderState, theme: CRTTheme) -> Color {
        switch state {
        case .default:
            return theme.dim
        case .subtle:
            return theme.dim.opacity(0.5)
        case .active:
            return theme.primary
        case .focused:
            return theme.bright
        case .error:
            return CRTTheme.error
        case .warning:
            return CRTTheme.amber
        }
    }

    /// Border state types
    public enum BorderState {
        case `default`
        case subtle
        case active
        case focused
        case error
        case warning
    }
}

// MARK: - Gradient Helpers

extension LinearGradient {
    /// CRT phosphor gradient (top to bottom glow)
    public static func crtPhosphor(theme: CRTTheme) -> LinearGradient {
        LinearGradient(
            colors: [theme.bright.opacity(0.1), theme.primary.opacity(0.05)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// CRT bezel gradient
    public static var crtBezel: LinearGradient {
        LinearGradient(
            colors: [CRTTheme.bezelHighlight, CRTTheme.bezelShadow],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension RadialGradient {
    /// CRT glow gradient for buttons/indicators
    public static func crtGlow(theme: CRTTheme) -> RadialGradient {
        RadialGradient(
            colors: [theme.bright.opacity(0.3), theme.primary.opacity(0.1), .clear],
            center: .center,
            startRadius: 0,
            endRadius: 20
        )
    }
}

// MARK: - ShapeStyle Extensions

extension ShapeStyle where Self == Color {
    /// Theme-aware primary color
    public static func crtPrimary(theme: CRTTheme) -> Color {
        theme.primary
    }

    /// Theme-aware dim color
    public static func crtDim(theme: CRTTheme) -> Color {
        theme.dim
    }
}
