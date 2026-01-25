import SwiftUI

/// A dropdown menu for filtering content by rig.
/// Shows "All Rigs" option plus available rigs from the system status.
struct RigFilterDropdown: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    /// Available rig names to show in the dropdown
    let availableRigs: [String]

    /// Whether the dropdown is expanded
    @State private var isExpanded = false

    var body: some View {
        Menu {
            // All Rigs option
            Button {
                withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                    appState.selectedRig = nil
                }
            } label: {
                HStack {
                    Text("ALL RIGS")
                    if appState.selectedRig == nil {
                        Image(systemName: "checkmark")
                    }
                }
            }

            if !availableRigs.isEmpty {
                Divider()

                // Individual rig options
                ForEach(availableRigs, id: \.self) { rig in
                    Button {
                        withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                            appState.selectedRig = rig
                        }
                    } label: {
                        HStack {
                            Text(rig.uppercased())
                            if appState.selectedRig == rig {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        } label: {
            dropdownButton
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Rig filter")
        .accessibilityValue(appState.selectedRig?.uppercased() ?? "All rigs")
    }

    private var dropdownButton: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "server.rack")
                .font(.system(size: 14))
                .foregroundColor(theme.primary)

            Text(displayText)
                .font(CRTTheme.Typography.font(size: 12, weight: .medium))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(theme.primary)
                .lineLimit(1)

            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(theme.primary.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    private var displayText: String {
        if let rig = appState.selectedRig {
            return rig.uppercased()
        }
        return "ALL RIGS"
    }
}

// MARK: - Preview

#Preview("Rig Filter Dropdown") {
    VStack(spacing: 20) {
        RigFilterDropdown(availableRigs: ["adjutant", "beads", "gastown", "longeye"])

        RigFilterDropdown(availableRigs: [])
    }
    .padding()
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
}
