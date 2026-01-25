import SwiftUI

// MARK: - CRT Theme

/// Theme configuration for CRT-style retro terminal aesthetics.
/// Provides colors, typography, and visual effects for the Pip-Boy inspired UI.
public enum CRTTheme {

    // MARK: - Color Themes

    /// Available CRT phosphor color themes
    public enum ColorTheme: String, CaseIterable, Identifiable {
        case green = "green"      // GAS-BOY (default)
        case red = "red"          // BLOOD-BAG
        case blue = "blue"        // VAULT-TEC
        case tan = "tan"          // WASTELAND
        case pink = "pink"        // PINK-MIST
        case purple = "purple"    // RAD-STORM

        public var id: String { rawValue }

        /// Display name for the theme
        public var displayName: String {
            switch self {
            case .green: return "GAS-BOY"
            case .red: return "BLOOD-BAG"
            case .blue: return "VAULT-TEC"
            case .tan: return "WASTELAND"
            case .pink: return "PINK-MIST"
            case .purple: return "RAD-STORM"
            }
        }

        /// Primary phosphor color for this theme
        public var primary: Color {
            switch self {
            case .green: return Color(red: 0.125, green: 0.761, blue: 0.055)   // #20C20E
            case .red: return Color(red: 1.0, green: 0.2, blue: 0.2)           // #FF3333
            case .blue: return Color(red: 0.0, green: 0.667, blue: 1.0)        // #00AAFF
            case .tan: return Color(red: 0.824, green: 0.706, blue: 0.549)     // #D2B48C
            case .pink: return Color(red: 1.0, green: 0.412, blue: 0.706)      // #FF69B4
            case .purple: return Color(red: 0.749, green: 0.580, blue: 1.0)    // #BF94FF
            }
        }

        /// Bright/highlighted variant of the primary color
        public var bright: Color {
            switch self {
            case .green: return Color(red: 0.2, green: 1.0, blue: 0.2)         // #33FF33
            case .red: return Color(red: 1.0, green: 0.4, blue: 0.4)           // #FF6666
            case .blue: return Color(red: 0.2, green: 0.8, blue: 1.0)          // #33CCFF
            case .tan: return Color(red: 0.96, green: 0.87, blue: 0.70)        // #F5DEB3
            case .pink: return Color(red: 1.0, green: 0.714, blue: 0.757)      // #FFB6C1
            case .purple: return Color(red: 0.855, green: 0.749, blue: 1.0)    // #DABFFF
            }
        }

        /// Dim/muted variant of the primary color
        public var dim: Color {
            switch self {
            case .green: return Color(red: 0.039, green: 0.373, blue: 0.027)   // #0A5F07
            case .red: return Color(red: 0.533, green: 0.0, blue: 0.0)         // #880000
            case .blue: return Color(red: 0.0, green: 0.267, blue: 0.533)      // #004488
            case .tan: return Color(red: 0.545, green: 0.271, blue: 0.075)     // #8B4513
            case .pink: return Color(red: 0.78, green: 0.082, blue: 0.522)     // #C71585
            case .purple: return Color(red: 0.416, green: 0.051, blue: 0.678)  // #6A0DAD
            }
        }
    }

    // MARK: - Semantic Colors

    /// Background colors for the CRT aesthetic
    public enum Background {
        /// Main screen background - deep CRT black
        public static let screen = Color(red: 0.008, green: 0.02, blue: 0.008)      // #020502

        /// Panel/card background - slightly lighter
        public static let panel = Color(red: 0.016, green: 0.039, blue: 0.016)      // #040A04

        /// Elevated element background
        public static let elevated = Color(red: 0.024, green: 0.059, blue: 0.024)   // #060F06
    }

    /// State indicator colors
    public enum State {
        /// Success/online state
        public static let success = Color(red: 0.078, green: 0.996, blue: 0.090)    // #14FE17

        /// Warning/blocked state
        public static let warning = Color(red: 1.0, green: 0.69, blue: 0.0)         // #FFB000

        /// Error/stuck state
        public static let error = Color(red: 1.0, green: 0.267, blue: 0.267)        // #FF4444

        /// Offline/disabled state
        public static let offline = Color(red: 0.4, green: 0.4, blue: 0.4)          // #666666

        /// Info/neutral state
        public static let info = Color(red: 0.0, green: 0.667, blue: 1.0)           // #00AAFF
    }

    /// Priority colors for badges and indicators
    public enum Priority {
        /// P0 - Urgent (red)
        public static let urgent = Color(red: 1.0, green: 0.267, blue: 0.267)       // #FF4444

        /// P1 - High (amber)
        public static let high = Color(red: 1.0, green: 0.69, blue: 0.0)            // #FFB000

        /// P2 - Normal (theme green)
        public static func normal(theme: ColorTheme) -> Color { theme.primary }

        /// P3 - Low (dim theme)
        public static func low(theme: ColorTheme) -> Color { theme.dim }

        /// P4 - Lowest (gray)
        public static let lowest = Color(red: 0.4, green: 0.4, blue: 0.4)           // #666666
    }

    // MARK: - Typography

    /// Font configuration for the CRT aesthetic
    public enum Typography {
        /// Primary monospace font name
        public static let fontName = "Menlo"

        /// Fallback system monospace
        public static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight, design: .monospaced)
        }

        /// Standard letter spacing for terminal feel
        public static let letterSpacing: CGFloat = 0.5

        /// Wide letter spacing for headers
        public static let wideLetterSpacing: CGFloat = 2.0
    }

    // MARK: - Spacing

    /// Standard spacing values based on 4px grid
    public enum Spacing {
        public static let xxxs: CGFloat = 2
        public static let xxs: CGFloat = 4
        public static let xs: CGFloat = 8
        public static let sm: CGFloat = 12
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 24
        public static let xl: CGFloat = 32
        public static let xxl: CGFloat = 48
    }

    // MARK: - Corner Radius

    /// Border radius values - kept minimal for tech aesthetic
    public enum CornerRadius {
        public static let none: CGFloat = 0
        public static let sm: CGFloat = 2
        public static let md: CGFloat = 4
        public static let lg: CGFloat = 6
    }

    // MARK: - Animation

    /// Animation timing configurations
    public enum Animation {
        public static let fast: Double = 0.1
        public static let normal: Double = 0.2
        public static let slow: Double = 0.3

        /// Standard spring animation for button presses
        public static var buttonPress: SwiftUI.Animation {
            .spring(response: 0.2, dampingFraction: 0.6)
        }

        /// Glow pulse animation
        public static var glowPulse: SwiftUI.Animation {
            .easeInOut(duration: 1.0).repeatForever(autoreverses: true)
        }
    }
}

// MARK: - Environment Key

/// Environment key for the current CRT color theme
private struct CRTThemeKey: EnvironmentKey {
    static let defaultValue: CRTTheme.ColorTheme = .green
}

extension EnvironmentValues {
    /// The current CRT color theme
    public var crtTheme: CRTTheme.ColorTheme {
        get { self[CRTThemeKey.self] }
        set { self[CRTThemeKey.self] = newValue }
    }
}

extension View {
    /// Sets the CRT color theme for this view and its descendants
    public func crtTheme(_ theme: CRTTheme.ColorTheme) -> some View {
        environment(\.crtTheme, theme)
    }
}

// MARK: - Glow Effect Modifier

/// Adds a phosphor glow effect to any view
public struct CRTGlowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat
    let intensity: Double

    public func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(intensity), radius: radius / 2)
            .shadow(color: color.opacity(intensity * 0.6), radius: radius)
            .shadow(color: color.opacity(intensity * 0.3), radius: radius * 2)
    }
}

extension View {
    /// Applies a CRT phosphor glow effect
    /// - Parameters:
    ///   - color: The glow color (defaults to theme primary)
    ///   - radius: The glow radius
    ///   - intensity: The glow intensity (0.0 to 1.0)
    public func crtGlow(color: Color, radius: CGFloat = 8, intensity: Double = 0.6) -> some View {
        modifier(CRTGlowModifier(color: color, radius: radius, intensity: intensity))
    }
}
