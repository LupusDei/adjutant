import SwiftUI

// MARK: - CRTText

/// A text view styled with CRT phosphor glow effects.
///
/// `CRTText` provides retro terminal-style text with configurable glow intensity
/// and automatic theming based on the current `crtTheme` environment value.
///
/// ## Example Usage
/// ```swift
/// CRTText("SYSTEM READY")
///     .crtTextStyle(.header)
///
/// CRTText("Processing...", style: .body, glowIntensity: .medium)
/// ```
public struct CRTText: View {
    @Environment(\.crtTheme) private var theme

    private let text: String
    private let style: TextStyle
    private let glowIntensity: GlowIntensity
    private let color: Color?

    /// Text style presets for common use cases
    public enum TextStyle {
        case header      // Large, all-caps header text
        case subheader   // Medium header text
        case body        // Standard body text
        case caption     // Small caption/label text
        case mono        // Monospace code-style text

        var fontSize: CGFloat {
            switch self {
            case .header: return 24
            case .subheader: return 18
            case .body: return 16
            case .caption: return 12
            case .mono: return 14
            }
        }

        var fontWeight: Font.Weight {
            switch self {
            case .header, .subheader: return .bold
            case .body, .mono: return .regular
            case .caption: return .medium
            }
        }

        var isUppercased: Bool {
            switch self {
            case .header, .subheader, .caption: return true
            case .body, .mono: return false
            }
        }

        var letterSpacing: CGFloat {
            switch self {
            case .header: return 2.0
            case .subheader: return 1.5
            case .caption: return 1.0
            case .body, .mono: return 0.5
            }
        }
    }

    /// Glow intensity levels
    public enum GlowIntensity {
        case none
        case subtle
        case medium
        case bright

        var radius: CGFloat {
            switch self {
            case .none: return 0
            case .subtle: return 2
            case .medium: return 4
            case .bright: return 8
            }
        }

        var opacity: Double {
            switch self {
            case .none: return 0
            case .subtle: return 0.3
            case .medium: return 0.5
            case .bright: return 0.7
            }
        }
    }

    /// Creates a CRT-styled text view.
    /// - Parameters:
    ///   - text: The text content to display
    ///   - style: The text style preset (default: `.body`)
    ///   - glowIntensity: The phosphor glow intensity (default: `.medium`)
    ///   - color: Optional custom color (defaults to theme primary)
    public init(
        _ text: String,
        style: TextStyle = .body,
        glowIntensity: GlowIntensity = .medium,
        color: Color? = nil
    ) {
        self.text = text
        self.style = style
        self.glowIntensity = glowIntensity
        self.color = color
    }

    public var body: some View {
        Text(style.isUppercased ? text.uppercased() : text)
            .font(CRTTheme.Typography.font(size: style.fontSize, weight: style.fontWeight, theme: theme))
            .tracking(style.letterSpacing)
            .foregroundColor(resolvedColor)
            .crtGlow(
                color: resolvedColor,
                radius: glowIntensity.radius,
                intensity: glowIntensity.opacity
            )
            .accessibilityLabel(text)
    }

    private var resolvedColor: Color {
        color ?? theme.textPrimary
    }
}

// MARK: - Style Modifier

extension CRTText {
    /// Applies a different text style
    public func crtTextStyle(_ style: TextStyle) -> CRTText {
        CRTText(text, style: style, glowIntensity: glowIntensity, color: color)
    }

    /// Applies a different glow intensity
    public func crtGlowIntensity(_ intensity: GlowIntensity) -> CRTText {
        CRTText(text, style: style, glowIntensity: intensity, color: color)
    }

    /// Applies a custom color
    public func crtColor(_ color: Color) -> CRTText {
        CRTText(text, style: style, glowIntensity: glowIntensity, color: color)
    }
}

// MARK: - Preview

#Preview("CRTText Styles") {
    ScrollView {
        VStack(alignment: .leading, spacing: 20) {
            Group {
                CRTText("Header Text", style: .header)
                CRTText("Subheader Text", style: .subheader)
                CRTText("Body text with standard formatting", style: .body)
                CRTText("Caption Label", style: .caption)
                CRTText("monospace_code_text", style: .mono)
            }

            Divider().background(CRTTheme.ColorTheme.pipboy.dim)

            Group {
                CRTText("No Glow", glowIntensity: .none)
                CRTText("Subtle Glow", glowIntensity: .subtle)
                CRTText("Medium Glow", glowIntensity: .medium)
                CRTText("Bright Glow", glowIntensity: .bright)
            }

            Divider().background(CRTTheme.ColorTheme.pipboy.dim)

            Group {
                CRTText("Success", color: CRTTheme.State.success)
                CRTText("Warning", color: CRTTheme.State.warning)
                CRTText("Error", color: CRTTheme.State.error)
            }
        }
        .padding()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("CRTText Themes") {
    HStack(spacing: 20) {
        ForEach(CRTTheme.ColorTheme.allCases) { theme in
            VStack {
                CRTText(theme.displayName, style: .caption)
                CRTText("ACTIVE", style: .header, glowIntensity: .bright)
            }
            .crtTheme(theme)
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
