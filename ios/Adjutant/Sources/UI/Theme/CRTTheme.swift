import SwiftUI

// MARK: - CRT Theme

/// Theme configuration for CRT-style retro terminal aesthetics.
/// Provides colors, typography, and visual effects for the Pip-Boy inspired UI.
public enum CRTTheme {

    // MARK: - Color Themes

    /// Available app-wide color schemes
    public enum ColorTheme: String, CaseIterable, Identifiable {
        case pipboy = "pipboy"        // Green CRT (default)
        case document = "document"    // Clean white/black
        case starcraft = "starcraft"  // Dark purple + teal
        case friendly = "friendly"    // Playful multi-color palette

        public var id: String { rawValue }

        /// Display name for the theme
        public var displayName: String {
            switch self {
            case .pipboy: return "PIP-BOY"
            case .document: return "DOCUMENT"
            case .starcraft: return "STARCRAFT"
            case .friendly: return "FRIENDLY"
            }
        }

        /// Primary accent color for this theme
        public var primary: Color {
            switch self {
            case .pipboy: return Color(red: 0.125, green: 0.761, blue: 0.055)     // #20C20E
            case .document: return Color(red: 0.067, green: 0.067, blue: 0.067)   // #111111
            case .starcraft: return Color(red: 0.0, green: 1.0, blue: 0.835)      // #00FFD5
            case .friendly: return Color(red: 0.918, green: 0.306, blue: 0.208)      // #EA4E35 (warm red-orange)
            }
        }

        /// Bright/highlighted variant of the primary color
        public var bright: Color {
            switch self {
            case .pipboy: return Color(red: 0.2, green: 1.0, blue: 0.2)           // #33FF33
            case .document: return Color.black                                      // #000000
            case .starcraft: return Color(red: 0.4, green: 1.0, blue: 0.925)      // #66FFEC
            case .friendly: return Color(red: 0.255, green: 0.522, blue: 0.957)    // #4185F4 (Google blue)
            }
        }

        /// Dim/muted variant of the primary color
        public var dim: Color {
            switch self {
            case .pipboy: return Color(red: 0.039, green: 0.373, blue: 0.027)     // #0A5F07
            case .document: return Color(red: 0.463, green: 0.463, blue: 0.463)   // #767676 (WCAG AA on white)
            case .starcraft: return Color(red: 0.0, green: 0.467, blue: 0.4)      // #007766
            case .friendly: return Color(red: 0.529, green: 0.545, blue: 0.569)    // #878B91 (neutral gray)
            }
        }

        /// Theme-specific background colors
        public var background: BackgroundSet {
            switch self {
            case .pipboy:
                return BackgroundSet(
                    screen: Color(red: 0.008, green: 0.02, blue: 0.008),       // #020502
                    panel: Color(red: 0.016, green: 0.039, blue: 0.016),       // #040A04
                    elevated: Color(red: 0.024, green: 0.059, blue: 0.024)     // #060F06
                )
            case .document:
                return BackgroundSet(
                    screen: Color(red: 0.98, green: 0.98, blue: 0.973),        // #FAFAF8
                    panel: Color.white,                                         // #FFFFFF
                    elevated: Color(red: 0.941, green: 0.941, blue: 0.933)     // #F0F0EE
                )
            case .starcraft:
                return BackgroundSet(
                    screen: Color(red: 0.016, green: 0.016, blue: 0.102),      // #04041A
                    panel: Color(red: 0.047, green: 0.031, blue: 0.125),       // #0C0820
                    elevated: Color(red: 0.086, green: 0.055, blue: 0.188)     // #160E30
                )
            case .friendly:
                return BackgroundSet(
                    screen: Color(red: 0.973, green: 0.969, blue: 0.965),      // #F8F7F6 (warm neutral)
                    panel: Color.white,                                         // #FFFFFF
                    elevated: Color(red: 0.953, green: 0.949, blue: 0.941)     // #F3F2F0 (warm gray)
                )
            }
        }

        /// Whether CRT visual effects (scanlines, glow, flicker, noise) are enabled
        public var crtEffectsEnabled: Bool {
            switch self {
            case .pipboy, .starcraft: return true
            case .document, .friendly: return false
            }
        }

        /// Whether to use monospace font (true) or system font (false)
        public var useMonospaceFont: Bool {
            switch self {
            case .pipboy, .starcraft: return true
            case .document, .friendly: return false
            }
        }

        /// Font design style for this theme
        public var fontDesign: Font.Design {
            switch self {
            case .pipboy, .starcraft: return .monospaced
            case .document: return .default
            case .friendly: return .rounded
            }
        }

        /// Multi-color palette for themes that support color variety (currently Friendly only)
        public var colorPalette: FriendlyColorPalette? {
            switch self {
            case .friendly:
                return FriendlyColorPalette(
                    blue: Color(red: 0.255, green: 0.522, blue: 0.957),    // #4185F4
                    red: Color(red: 0.918, green: 0.306, blue: 0.208),     // #EA4E35
                    yellow: Color(red: 0.984, green: 0.737, blue: 0.020),  // #FBBC05
                    green: Color(red: 0.204, green: 0.659, blue: 0.325),   // #34A853
                    purple: Color(red: 0.675, green: 0.345, blue: 0.847),  // #AC58D8
                    orange: Color(red: 1.0, green: 0.435, blue: 0.259)     // #FF6F42
                )
            default:
                return nil
            }
        }

        /// Primary text color for this theme
        public var textPrimary: Color {
            switch self {
            case .pipboy: return primary
            case .document: return Color(red: 0.067, green: 0.067, blue: 0.067)   // #111111
            case .starcraft: return primary
            case .friendly: return Color(red: 0.133, green: 0.133, blue: 0.133)   // #222222
            }
        }

        /// Secondary/dim text color for this theme
        public var textSecondary: Color {
            switch self {
            case .pipboy: return dim
            case .document: return Color(red: 0.463, green: 0.463, blue: 0.463)   // #767676 (WCAG AA)
            case .starcraft: return dim
            case .friendly: return Color(red: 0.427, green: 0.427, blue: 0.427)    // #6D6D6D (neutral)
            }
        }

        /// Accent color for interactive elements (buttons, links)
        public var accent: Color {
            switch self {
            case .pipboy: return primary
            case .document: return Color(red: 0.145, green: 0.388, blue: 0.922)   // #2563EB
            case .starcraft: return primary
            case .friendly: return Color(red: 0.255, green: 0.522, blue: 0.957)   // #4185F4 (Google blue)
            }
        }

        /// Preferred color scheme for system UI elements
        public var preferredColorScheme: ColorScheme {
            switch self {
            case .pipboy, .starcraft: return .dark
            case .document, .friendly: return .light
            }
        }
    }

    // MARK: - Background Set

    /// Theme-aware background color set
    public struct BackgroundSet {
        public let screen: Color
        public let panel: Color
        public let elevated: Color

        public init(screen: Color, panel: Color, elevated: Color) {
            self.screen = screen
            self.panel = panel
            self.elevated = elevated
        }
    }

    // MARK: - Friendly Color Palette

    /// Multi-color palette for the Friendly theme's playful variety.
    /// Provides 6 named accent colors for components that want color diversity.
    public struct FriendlyColorPalette {
        public let blue: Color      // #4185F4
        public let red: Color       // #EA4E35
        public let yellow: Color    // #FBBC05
        public let green: Color     // #34A853
        public let purple: Color    // #AC58D8
        public let orange: Color    // #FF6F42

        /// All colors in display order
        public var allColors: [Color] {
            [blue, red, yellow, green, purple, orange]
        }

        /// Returns a consistent color for a given string (e.g. agent name)
        public func color(for identifier: String) -> Color {
            let hash = abs(identifier.hashValue)
            return allColors[hash % allColors.count]
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
    static let defaultValue: CRTTheme.ColorTheme = .pipboy
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

/// Adds a phosphor glow effect to any view.
/// Scheme-aware: disables glow when CRT effects are disabled (e.g., Document theme).
public struct CRTGlowModifier: ViewModifier {
    @Environment(\.crtTheme) private var theme

    let color: Color
    let radius: CGFloat
    let intensity: Double

    public func body(content: Content) -> some View {
        if theme.crtEffectsEnabled {
            content
                .shadow(color: color.opacity(intensity), radius: radius / 2)
                .shadow(color: color.opacity(intensity * 0.6), radius: radius)
                .shadow(color: color.opacity(intensity * 0.3), radius: radius * 2)
        } else {
            content
        }
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
