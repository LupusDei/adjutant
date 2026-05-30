import SwiftUI

/// Compact inline DM ↔ Channels switch (adj-164.6.5 redesign).
///
/// Replaces the old full-width segmented band, which stacked a second header on
/// top of each surface's own header. This is a small two-segment capsule that
/// lives in the existing surface headers — Direct (bubble) | Channels (#). The
/// active segment is tinted and glows; tapping a segment switches mode. It adds
/// no vertical chrome of its own, so the chat tab reads as a single clean header.
struct ChatModeToggle: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject var controller: ChatModeController

    var body: some View {
        HStack(spacing: 0) {
            segment(.directMessages, systemImage: "bubble.left.fill", label: "Direct messages")
            segment(.channels, systemImage: "number", label: "Channels")
        }
        .padding(2)
        .background(
            Capsule(style: .continuous)
                .fill(theme.background.screen.opacity(0.5))
                .overlay(
                    Capsule(style: .continuous)
                        .stroke(theme.dim.opacity(0.35), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Chat mode")
    }

    @ViewBuilder
    private func segment(_ mode: ChatMode, systemImage: String, label: String) -> some View {
        let active = controller.mode == mode
        Button {
            controller.switchTo(mode)
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(active ? theme.background.screen : theme.dim)
                .frame(width: 30, height: 22)
                .background(
                    Capsule(style: .continuous)
                        .fill(active ? theme.primary : Color.clear)
                )
                .crtGlow(
                    color: theme.primary,
                    radius: active ? 4 : 0,
                    intensity: active ? 0.4 : 0
                )
                .contentShape(Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
