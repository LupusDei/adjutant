#if canImport(UIKit)
import UIKit
#endif
import SwiftUI

// MARK: - CRTButton

/// A button styled with CRT phosphor effects and press animations.
///
/// `CRTButton` provides retro terminal-style buttons with configurable variants,
/// haptic feedback, and smooth press animations.
///
/// ## Example Usage
/// ```swift
/// CRTButton("SEND") {
///     sendMessage()
/// }
///
/// CRTButton("DELETE", variant: .danger) {
///     deleteItem()
/// }
/// .crtButtonSize(.large)
/// ```
public struct CRTButton: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @State private var isPressed = false

    private let title: String
    private let variant: Variant
    private let size: Size
    private let isLoading: Bool
    private let action: () -> Void

    /// Button visual variants
    public enum Variant {
        case primary    // Filled background
        case secondary  // Outlined
        case ghost      // Minimal, text only
        case danger     // Red/destructive

        func backgroundColor(theme: CRTTheme.ColorTheme, isPressed: Bool) -> Color {
            switch self {
            case .primary:
                return isPressed ? theme.bright : theme.accent
            case .secondary, .ghost:
                return isPressed ? theme.accent.opacity(0.1) : .clear
            case .danger:
                return isPressed ? CRTTheme.State.error.opacity(0.2) : .clear
            }
        }

        func foregroundColor(theme: CRTTheme.ColorTheme) -> Color {
            switch self {
            case .primary:
                return theme.background.screen
            case .secondary, .ghost:
                return theme.textPrimary
            case .danger:
                return CRTTheme.State.error
            }
        }

        func borderColor(theme: CRTTheme.ColorTheme, isPressed: Bool) -> Color {
            switch self {
            case .primary:
                return isPressed ? theme.bright : theme.accent
            case .secondary:
                return isPressed ? theme.bright : theme.accent
            case .ghost:
                return .clear
            case .danger:
                return isPressed ? CRTTheme.State.error.opacity(0.8) : CRTTheme.State.error
            }
        }
    }

    /// Button size presets
    public enum Size {
        case small
        case medium
        case large

        var verticalPadding: CGFloat {
            switch self {
            case .small: return 6
            case .medium: return 10
            case .large: return 14
            }
        }

        var horizontalPadding: CGFloat {
            switch self {
            case .small: return 12
            case .medium: return 16
            case .large: return 24
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small: return 12
            case .medium: return 14
            case .large: return 16
            }
        }
    }

    /// Creates a CRT-styled button.
    /// - Parameters:
    ///   - title: The button text
    ///   - variant: The visual style variant (default: `.primary`)
    ///   - size: The button size (default: `.medium`)
    ///   - isLoading: Whether to show loading state (default: `false`)
    ///   - action: The action to perform when tapped
    public init(
        _ title: String,
        variant: Variant = .primary,
        size: Size = .medium,
        isLoading: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.variant = variant
        self.size = size
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: performAction) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                if isLoading {
                    LoadingIndicator(size: .small)
                }

                Text(title.uppercased())
                    .font(CRTTheme.Typography.font(size: size.fontSize, weight: .bold, theme: theme))
                    .tracking(CRTTheme.Typography.wideLetterSpacing)
            }
            .padding(.vertical, size.verticalPadding)
            .padding(.horizontal, size.horizontalPadding)
            .foregroundColor(foregroundColor)
            .background(backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(borderColor, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md))
            .crtGlow(
                color: glowColor,
                radius: isPressed ? 12 : 6,
                intensity: isPressed ? 0.6 : 0.3
            )
            .scaleEffect(isPressed ? 0.96 : 1.0)
            .opacity(isEnabled ? 1.0 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isLoading)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(CRTTheme.Animation.buttonPress) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(CRTTheme.Animation.buttonPress) {
                        isPressed = false
                    }
                }
        )
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isLoading ? "Loading" : "")
    }

    private var backgroundColor: Color {
        variant.backgroundColor(theme: theme, isPressed: isPressed)
    }

    private var foregroundColor: Color {
        variant.foregroundColor(theme: theme)
    }

    private var borderColor: Color {
        variant.borderColor(theme: theme, isPressed: isPressed)
    }

    private var glowColor: Color {
        switch variant {
        case .danger:
            return CRTTheme.State.error
        default:
            return theme.primary
        }
    }

    private func performAction() {
        guard !isLoading else { return }

        // Haptic feedback
        #if canImport(UIKit)
        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
        impactFeedback.impactOccurred()
        #endif

        action()
    }
}

// MARK: - Modifiers

extension CRTButton {
    /// Sets the button size
    public func crtButtonSize(_ size: Size) -> CRTButton {
        CRTButton(title, variant: variant, size: size, isLoading: isLoading, action: action)
    }

    /// Sets the button variant
    public func crtButtonVariant(_ variant: Variant) -> CRTButton {
        CRTButton(title, variant: variant, size: size, isLoading: isLoading, action: action)
    }
}

// MARK: - Preview

#Preview("CRTButton Variants") {
    VStack(spacing: 20) {
        CRTButton("Primary") { }

        CRTButton("Secondary", variant: .secondary) { }

        CRTButton("Ghost", variant: .ghost) { }

        CRTButton("Danger", variant: .danger) { }

        CRTButton("Loading", isLoading: true) { }

        CRTButton("Disabled") { }
            .disabled(true)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("CRTButton Sizes") {
    VStack(spacing: 20) {
        CRTButton("Small", size: .small) { }

        CRTButton("Medium", size: .medium) { }

        CRTButton("Large", size: .large) { }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("CRTButton Themes") {
    HStack(spacing: 12) {
        ForEach(CRTTheme.ColorTheme.allCases) { theme in
            CRTButton("TAP") { }
                .crtTheme(theme)
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
