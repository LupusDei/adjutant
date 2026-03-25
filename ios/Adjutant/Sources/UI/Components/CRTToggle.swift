import SwiftUI

/// A toggle switch styled with CRT phosphor effects.
///
/// Provides a retro terminal-style toggle with smooth animation,
/// glow effects on the active state, and accessible labeling.
///
/// ## Example Usage
/// ```swift
/// CRTToggle(isOn: $isEnabled)
/// ```
public struct CRTToggle: View {
    @Environment(\.crtTheme) private var theme
    @Binding var isOn: Bool

    public init(isOn: Binding<Bool>) {
        _isOn = isOn
    }

    public var body: some View {
        Button {
            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                isOn.toggle()
            }
        } label: {
            ZStack {
                // Track
                RoundedRectangle(cornerRadius: 12)
                    .fill(isOn ? theme.primary.opacity(0.3) : theme.dim.opacity(0.2))
                    .frame(width: 48, height: 28)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isOn ? theme.primary : theme.dim.opacity(0.5), lineWidth: 1)
                    )

                // Knob
                Circle()
                    .fill(isOn ? theme.primary : theme.dim)
                    .frame(width: 22, height: 22)
                    .offset(x: isOn ? 10 : -10)
                    .crtGlow(color: isOn ? theme.primary : .clear, radius: 4, intensity: 0.5)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isButton)
    }
}
