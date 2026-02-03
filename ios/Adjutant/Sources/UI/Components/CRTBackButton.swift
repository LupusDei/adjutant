import SwiftUI

// MARK: - CRTBackButton

/// A CRT-styled back button for navigation.
///
/// `CRTBackButton` provides a retro terminal-style back button that matches
/// the overall Adjutant aesthetic with phosphor glow effects.
///
/// ## Example Usage
/// ```swift
/// .toolbar {
///     ToolbarItem(placement: .navigationBarLeading) {
///         CRTBackButton()
///     }
/// }
/// ```
public struct CRTBackButton: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var isPressed = false

    private let label: String
    private let action: (() -> Void)?

    /// Creates a CRT-styled back button.
    /// - Parameters:
    ///   - label: The button label (default: "BACK")
    ///   - action: Optional custom action. If nil, uses environment dismiss.
    public init(_ label: String = "BACK", action: (() -> Void)? = nil) {
        self.label = label
        self.action = action
    }

    public var body: some View {
        Button(action: performAction) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                // Chevron icon
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))

                // Label
                Text(label.uppercased())
                    .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
            }
            .foregroundColor(theme.primary)
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isPressed ? theme.primary.opacity(0.15) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(isPressed ? 0.8 : 0.5), lineWidth: 1)
            )
            .crtGlow(
                color: theme.primary,
                radius: isPressed ? 8 : 4,
                intensity: isPressed ? 0.5 : 0.2
            )
            .scaleEffect(isPressed ? 0.95 : 1.0)
        }
        .buttonStyle(.plain)
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
        .accessibilityLabel("Go back")
        .accessibilityAddTraits(.isButton)
    }

    private func performAction() {
        #if canImport(UIKit)
        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
        impactFeedback.impactOccurred()
        #endif

        if let action = action {
            action()
        } else {
            dismiss()
        }
    }
}

// MARK: - View Modifier for CRT Navigation Style

/// A view modifier that applies CRT styling to navigation bars.
public struct CRTNavigationStyle: ViewModifier {
    @Environment(\.crtTheme) private var theme

    public func body(content: Content) -> some View {
        content
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            #endif
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    CRTBackButton()
                }
            }
    }
}

extension View {
    /// Applies CRT styling to navigation, including a custom back button.
    public func crtNavigationStyle() -> some View {
        modifier(CRTNavigationStyle())
    }
}

// MARK: - Preview

#Preview("CRTBackButton") {
    NavigationStack {
        VStack {
            CRTText("Detail View", style: .header)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton()
            }
            ToolbarItem(placement: .principal) {
                CRTText("TITLE", style: .subheader, glowIntensity: .subtle)
            }
        }
    }
}

#Preview("CRTBackButton Pressed") {
    HStack(spacing: 20) {
        CRTBackButton()
        CRTBackButton("CLOSE")
    }
    .padding()
    .background(CRTTheme.Background.screen)
}
