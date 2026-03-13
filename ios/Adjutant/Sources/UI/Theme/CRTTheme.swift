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
        case glass = "glass"          // Apple-inspired frosted glass

        public var id: String { rawValue }

        /// Display name for the theme
        public var displayName: String {
            switch self {
            case .pipboy: return "PIP-BOY"
            case .document: return "DOCUMENT"
            case .starcraft: return "STARCRAFT"
            case .friendly: return "FRIENDLY"
            case .glass: return "GLASS"
            }
        }

        /// Primary accent color for this theme
        public var primary: Color {
            switch self {
            case .pipboy: return Color(red: 0.125, green: 0.761, blue: 0.055)     // #20C20E
            case .document: return Color(red: 0.067, green: 0.067, blue: 0.067)   // #111111
            case .starcraft: return Color(red: 0.0, green: 1.0, blue: 0.835)      // #00FFD5
            case .friendly: return Color(red: 0.345, green: 0.337, blue: 0.839)      // #5856D6 (joyful indigo)
            case .glass: return Color(red: 0.0, green: 0.478, blue: 1.0)              // #007AFF (iOS system blue)
            }
        }

        /// Bright/highlighted variant of the primary color
        public var bright: Color {
            switch self {
            case .pipboy: return Color(red: 0.2, green: 1.0, blue: 0.2)           // #33FF33
            case .document: return Color.black                                      // #000000
            case .starcraft: return Color(red: 0.502, green: 1.0, blue: 0.941)     // #80FFF0
            case .friendly: return Color(red: 0.231, green: 0.471, blue: 0.906)    // #3B78E7 (vivid blue)
            case .glass: return Color(red: 0.039, green: 0.518, blue: 1.0)            // #0A84FF (iOS system blue bright)
            }
        }

        /// Dim/muted variant of the primary color
        public var dim: Color {
            switch self {
            case .pipboy: return Color(red: 0.039, green: 0.373, blue: 0.027)     // #0A5F07
            case .document: return Color(red: 0.420, green: 0.420, blue: 0.420)   // #6B6B6B (exceeds WCAG AA on white)
            case .starcraft: return Color(red: 0.0, green: 0.733, blue: 0.6)       // #00BB99
            case .friendly: return Color(red: 0.522, green: 0.463, blue: 0.686)    // #8576AF (soft purple, WCAG AA compliant)
            case .glass: return Color(red: 0.557, green: 0.557, blue: 0.576)          // #8E8E93 (iOS system gray)
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
                    elevated: Color(red: 0.961, green: 0.961, blue: 0.949)     // #F5F5F2
                )
            case .starcraft:
                return BackgroundSet(
                    screen: Color(red: 0.024, green: 0.016, blue: 0.118),      // #06041E
                    panel: Color(red: 0.063, green: 0.031, blue: 0.157),       // #100828
                    elevated: Color(red: 0.110, green: 0.063, blue: 0.251)     // #1C1040
                )
            case .friendly:
                return BackgroundSet(
                    screen: Color(red: 0.941, green: 0.925, blue: 1.0),        // #F0ECFF (light lavender)
                    panel: Color(red: 1.0, green: 0.984, blue: 0.976),         // #FFFBF9 (warm blush white)
                    elevated: Color(red: 0.941, green: 0.957, blue: 1.0)       // #F0F4FF (light sky)
                )
            case .glass:
                return BackgroundSet(
                    screen: Color(red: 0.949, green: 0.949, blue: 0.969),      // #F2F2F7 (iOS system gray 6)
                    panel: Color.white.opacity(0.72),                           // Translucent white
                    elevated: Color.white.opacity(0.85)                         // More opaque white
                )
            }
        }

        /// Whether CRT visual effects (scanlines, glow, flicker, noise) are enabled
        public var crtEffectsEnabled: Bool {
            switch self {
            case .pipboy, .starcraft: return true
            case .document, .friendly, .glass: return false
            }
        }

        /// Whether to use monospace font (true) or system font (false)
        public var useMonospaceFont: Bool {
            switch self {
            case .pipboy, .starcraft: return true
            case .document, .friendly, .glass: return false
            }
        }

        /// Font design style for this theme
        public var fontDesign: Font.Design {
            switch self {
            case .pipboy, .starcraft: return .monospaced
            case .document, .glass: return .default
            case .friendly: return .rounded
            }
        }

        /// Multi-color palette for themes that support color variety (currently Friendly only)
        public var colorPalette: FriendlyColorPalette? {
            switch self {
            case .friendly:
                return FriendlyColorPalette(
                    blue: Color(red: 0.231, green: 0.471, blue: 0.906),    // #3B78E7
                    red: Color(red: 0.910, green: 0.271, blue: 0.227),     // #E8453A
                    yellow: Color(red: 0.976, green: 0.659, blue: 0.145),  // #F9A825
                    green: Color(red: 0.180, green: 0.620, blue: 0.294),   // #2E9E4B
                    purple: Color(red: 0.639, green: 0.278, blue: 0.820),  // #A347D1
                    orange: Color(red: 1.0, green: 0.388, blue: 0.200),    // #FF6333
                    pink: Color(red: 0.910, green: 0.263, blue: 0.576),    // #E84393
                    teal: Color(red: 0.0, green: 0.722, blue: 0.580)       // #00B894
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
            case .friendly: return Color(red: 0.176, green: 0.141, blue: 0.322)   // #2D2452 (dark indigo)
            case .glass: return Color(red: 0.110, green: 0.110, blue: 0.118)          // #1C1C1E (near black)
            }
        }

        /// Secondary/dim text color for this theme
        public var textSecondary: Color {
            switch self {
            case .pipboy: return dim
            case .document: return Color(red: 0.420, green: 0.420, blue: 0.420)   // #6B6B6B (exceeds WCAG AA)
            case .starcraft: return dim
            case .friendly: return Color(red: 0.420, green: 0.373, blue: 0.561)    // #6B5F8F (muted purple, WCAG AA compliant)
            case .glass: return Color(red: 0.388, green: 0.388, blue: 0.400)          // #636366 (iOS system gray)
            }
        }

        /// Accent color for interactive elements (buttons, links)
        public var accent: Color {
            switch self {
            case .pipboy: return primary
            case .document: return Color(red: 0.145, green: 0.388, blue: 0.922)   // #2563EB
            case .starcraft: return primary
            case .friendly: return Color(red: 0.345, green: 0.337, blue: 0.839)   // #5856D6 (joyful indigo)
            case .glass: return Color(red: 0.0, green: 0.478, blue: 1.0)              // #007AFF (iOS system blue)
            }
        }

        /// Preferred color scheme for system UI elements
        public var preferredColorScheme: ColorScheme {
            switch self {
            case .pipboy, .starcraft: return .dark
            case .document, .friendly, .glass: return .light
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

    /// Multi-color palette for the Friendly theme's joyful variety.
    /// Provides 8 named accent colors for components that want color diversity.
    public struct FriendlyColorPalette {
        public let blue: Color      // #3B78E7
        public let red: Color       // #E8453A
        public let yellow: Color    // #F9A825
        public let green: Color     // #2E9E4B
        public let purple: Color    // #A347D1
        public let orange: Color    // #FF6333
        public let pink: Color      // #E84393
        public let teal: Color      // #00B894

        /// All colors in display order
        public var allColors: [Color] {
            [blue, red, yellow, green, purple, orange, pink, teal]
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

        /// Friendly theme uses larger radii for a softer, child-friendly look
        public static func forTheme(_ theme: ColorTheme) -> (sm: CGFloat, md: CGFloat, lg: CGFloat) {
            switch theme {
            case .friendly:
                return (sm: 8, md: 12, lg: 16)
            default:
                return (sm: sm, md: md, lg: lg)
            }
        }
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
            // Reduced from 3 shadow passes to 2 for GPU performance (adj-6yp4.1)
            content
                .shadow(color: color.opacity(intensity), radius: radius)
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
