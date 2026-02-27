import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

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
    /// CRT terminal font at specified size.
    /// When `monospace` is true (default), uses ShareTechMono or system monospace.
    /// When false (e.g., Document theme), uses the standard system font with the given design.
    /// - Parameters:
    ///   - size: Font size in points
    ///   - monospace: Whether to use monospace font (CRT themes) or system font
    ///   - design: Font design to use when `monospace` is false (e.g., `.rounded` for Friendly)
    public static func crt(_ size: CGFloat, monospace: Bool = true, design: Font.Design = .default) -> Font {
        guard monospace else {
            return .system(size: size, design: design)
        }
        #if os(iOS)
        if let _ = UIFont(name: CRTTypography.fontFamily, size: size) {
            return .custom(CRTTypography.fontFamily, size: size)
        }
        #elseif os(macOS)
        if let _ = NSFont(name: CRTTypography.fontFamily, size: size) {
            return .custom(CRTTypography.fontFamily, size: size)
        }
        #endif
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

// MARK: - Scheme-Aware Font Helpers

extension CRTTheme.Typography {
    /// Scheme-aware font that respects `useMonospaceFont` and `fontDesign`.
    /// Returns monospace for Pip-Boy/StarCraft, rounded for Friendly, default for Document.
    public static func font(size: CGFloat, weight: Font.Weight = .regular, theme: CRTTheme.ColorTheme) -> Font {
        .system(size: size, weight: weight, design: theme.fontDesign)
    }
}

// MARK: - Text Style Modifiers

extension View {
    /// Apply CRT text styling with glow effect (scheme-aware).
    /// Friendly theme: normal tracking, no uppercase. CRT themes: wide tracking.
    public func crtTextStyle(
        _ theme: CRTTheme.ColorTheme,
        size: CGFloat = CRTTypography.sizeBase,
        letterSpacing: CGFloat = CRTTypography.letterSpacingWide
    ) -> some View {
        let effectiveSpacing = theme.colorPalette != nil ? CRTTypography.letterSpacingNormal : letterSpacing
        return self
            .font(.crt(size, monospace: theme.useMonospaceFont, design: theme.fontDesign))
            .foregroundColor(theme.textPrimary)
            .tracking(effectiveSpacing)
    }

    /// Apply CRT header styling (scheme-aware).
    /// Friendly theme: title case, normal tracking, heavier weight. CRT themes: uppercase, wide tracking.
    public func crtHeaderStyle(_ theme: CRTTheme.ColorTheme, size: CGFloat = CRTTypography.sizeLG) -> some View {
        let isFriendly = theme.colorPalette != nil
        return self
            .font(isFriendly
                ? .system(size: size, weight: .bold, design: .rounded)
                : .crt(size, monospace: theme.useMonospaceFont, design: theme.fontDesign))
            .foregroundColor(theme.textPrimary)
            .tracking(isFriendly ? CRTTypography.letterSpacingNormal : CRTTypography.letterSpacingWider)
            .textCase(isFriendly ? nil : .uppercase)
    }

    /// Apply CRT label styling (scheme-aware).
    /// Friendly theme: sentence case, rounded font. CRT themes: uppercase, wide tracking.
    public func crtLabelStyle(_ theme: CRTTheme.ColorTheme) -> some View {
        let isFriendly = theme.colorPalette != nil
        return self
            .font(isFriendly
                ? .system(size: CRTTypography.sizeXS, weight: .medium, design: .rounded)
                : .crt(CRTTypography.sizeXS, monospace: theme.useMonospaceFont, design: theme.fontDesign))
            .foregroundColor(theme.textSecondary)
            .tracking(isFriendly ? CRTTypography.letterSpacingNormal : CRTTypography.letterSpacingWider)
            .textCase(isFriendly ? nil : .uppercase)
    }
}

// MARK: - Attributed String Support

extension AttributedString {
    /// Create an attributed string with CRT styling
    public static func crt(
        _ string: String,
        theme: CRTTheme.ColorTheme,
        size: CGFloat = CRTTypography.sizeBase
    ) -> AttributedString {
        var attributed = AttributedString(string)
        attributed.font = .crt(size, monospace: theme.useMonospaceFont, design: theme.fontDesign)
        attributed.foregroundColor = theme.textPrimary
        attributed.kern = CRTTypography.letterSpacingWide
        return attributed
    }
}
