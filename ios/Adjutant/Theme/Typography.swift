import SwiftUI

/// Typography definitions for the CRT theme
public enum CRTTypography {
    /// Primary monospace font family
    /// Uses Share Tech Mono with fallbacks to system monospace
    public static let fontFamily = "ShareTechMono-Regular"

    /// System fallback font for when Share Tech Mono is unavailable
    public static let fallbackFont = "Courier New"

    // MARK: - Font Sizes

    /// Extra small text (12pt)
    public static let sizeXS: CGFloat = 12

    /// Small text (14pt)
    public static let sizeSM: CGFloat = 14

    /// Base/body text (16pt)
    public static let sizeBase: CGFloat = 16

    /// Large text (18pt)
    public static let sizeLG: CGFloat = 18

    /// Extra large text (20pt)
    public static let sizeXL: CGFloat = 20

    /// 2X large text (24pt)
    public static let size2XL: CGFloat = 24

    /// 3X large text (30pt)
    public static let size3XL: CGFloat = 30

    /// 4X large text (36pt)
    public static let size4XL: CGFloat = 36

    /// 5X large text (48pt)
    public static let size5XL: CGFloat = 48

    // MARK: - Letter Spacing

    /// Tight letter spacing
    public static let letterSpacingTight: CGFloat = -0.5

    /// Normal letter spacing
    public static let letterSpacingNormal: CGFloat = 0

    /// Wide letter spacing (for headers)
    public static let letterSpacingWide: CGFloat = 0.8

    /// Wider letter spacing (for labels)
    public static let letterSpacingWider: CGFloat = 1.6

    // MARK: - Line Heights

    /// Tight line height multiplier
    public static let lineHeightTight: CGFloat = 1.1

    /// Normal line height multiplier
    public static let lineHeightNormal: CGFloat = 1.4

    /// Relaxed line height multiplier
    public static let lineHeightRelaxed: CGFloat = 1.6
}

// MARK: - Font Extension

extension Font {
    /// CRT terminal font at specified size
    public static func crt(_ size: CGFloat) -> Font {
        if let _ = UIFont(name: CRTTypography.fontFamily, size: size) {
            return .custom(CRTTypography.fontFamily, size: size)
        }
        return .system(size: size, design: .monospaced)
    }

    /// CRT terminal font - extra small
    public static var crtXS: Font { .crt(CRTTypography.sizeXS) }

    /// CRT terminal font - small
    public static var crtSM: Font { .crt(CRTTypography.sizeSM) }

    /// CRT terminal font - base/body
    public static var crtBase: Font { .crt(CRTTypography.sizeBase) }

    /// CRT terminal font - large
    public static var crtLG: Font { .crt(CRTTypography.sizeLG) }

    /// CRT terminal font - extra large
    public static var crtXL: Font { .crt(CRTTypography.sizeXL) }

    /// CRT terminal font - 2X large
    public static var crt2XL: Font { .crt(CRTTypography.size2XL) }

    /// CRT terminal font - 3X large
    public static var crt3XL: Font { .crt(CRTTypography.size3XL) }

    /// CRT terminal font - 4X large
    public static var crt4XL: Font { .crt(CRTTypography.size4XL) }

    /// CRT terminal font - 5X large
    public static var crt5XL: Font { .crt(CRTTypography.size5XL) }
}

// MARK: - Text Style Modifiers

extension View {
    /// Apply CRT text styling with glow effect
    public func crtTextStyle(
        _ theme: CRTTheme,
        size: CGFloat = CRTTypography.sizeBase,
        letterSpacing: CGFloat = CRTTypography.letterSpacingWide
    ) -> some View {
        self
            .font(.crt(size))
            .foregroundColor(theme.primary)
            .tracking(letterSpacing)
    }

    /// Apply CRT header styling (uppercase, wide tracking)
    public func crtHeaderStyle(_ theme: CRTTheme, size: CGFloat = CRTTypography.sizeLG) -> some View {
        self
            .font(.crt(size))
            .foregroundColor(theme.primary)
            .tracking(CRTTypography.letterSpacingWider)
            .textCase(.uppercase)
    }

    /// Apply CRT label styling (smaller, uppercase)
    public func crtLabelStyle(_ theme: CRTTheme) -> some View {
        self
            .font(.crt(CRTTypography.sizeXS))
            .foregroundColor(theme.dim)
            .tracking(CRTTypography.letterSpacingWider)
            .textCase(.uppercase)
    }
}

// MARK: - Attributed String Support

extension AttributedString {
    /// Create an attributed string with CRT styling
    public static func crt(
        _ string: String,
        theme: CRTTheme,
        size: CGFloat = CRTTypography.sizeBase
    ) -> AttributedString {
        var attributed = AttributedString(string)
        attributed.font = .crt(size)
        attributed.foregroundColor = theme.primary
        attributed.kern = CRTTypography.letterSpacingWide
        return attributed
    }
}
