import SwiftUI

/// Preview demonstrating all CRT themes and effects
struct ThemePreviewView: View {
    @StateObject private var themeManager = ThemeManager.shared
    @ThemeStorage private var selectedTheme: CRTTheme

    var body: some View {
        CRTScreenContainer(
            enableScanlines: true,
            enableFlicker: true,
            enableNoise: true,
            enableVignette: true
        ) {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    Text("CRT DESIGN SYSTEM")
                        .crtHeaderStyle(selectedTheme, size: CRTTypography.size2XL)
                        .crtGlow(selectedTheme)

                    // Theme selector
                    themeSelector

                    // Typography samples
                    typographySamples

                    // Color palette
                    colorPalette

                    // Status indicators
                    statusIndicators

                    // Priority badges
                    priorityBadges

                    // Effect toggles (for preview)
                    effectsDemo
                }
                .padding()
            }
        }
        .withCRTTheme(selectedTheme)
    }

    private var themeSelector: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("THEME SELECTOR")
                .crtLabelStyle(selectedTheme)

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                ForEach(CRTTheme.allCases) { theme in
                    ThemeButton(
                        theme: theme,
                        isSelected: selectedTheme == theme
                    ) {
                        selectedTheme = theme
                    }
                }
            }
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }

    private var typographySamples: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("TYPOGRAPHY")
                .crtLabelStyle(selectedTheme)

            Group {
                Text("5XL Header")
                    .font(.crt5XL)
                Text("4XL Header")
                    .font(.crt4XL)
                Text("3XL Header")
                    .font(.crt3XL)
                Text("2XL Header")
                    .font(.crt2XL)
                Text("XL Text")
                    .font(.crtXL)
                Text("Large Text")
                    .font(.crtLG)
                Text("Base Text - The quick brown fox jumps over the lazy dog")
                    .font(.crtBase)
                Text("Small Text")
                    .font(.crtSM)
                Text("Extra Small Text")
                    .font(.crtXS)
            }
            .foregroundColor(selectedTheme.primary)
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }

    private var colorPalette: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("COLOR PALETTE")
                .crtLabelStyle(selectedTheme)

            HStack(spacing: 12) {
                ColorSwatch(color: selectedTheme.bright, label: "BRIGHT")
                ColorSwatch(color: selectedTheme.primary, label: "PRIMARY")
                ColorSwatch(color: selectedTheme.dim, label: "DIM")
                ColorSwatch(color: selectedTheme.glow, label: "GLOW")
            }

            Text("SYSTEM COLORS")
                .crtLabelStyle(selectedTheme)
                .padding(.top, 8)

            HStack(spacing: 12) {
                ColorSwatch(color: .crtError, label: "ERROR")
                ColorSwatch(color: .crtAmber, label: "AMBER")
                ColorSwatch(color: .crtOffline, label: "OFFLINE")
                ColorSwatch(color: .crtBackground, label: "BG")
            }
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }

    private var statusIndicators: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("STATUS INDICATORS")
                .crtLabelStyle(selectedTheme)

            HStack(spacing: 16) {
                StatusDot(status: .working, theme: selectedTheme, label: "WORKING")
                StatusDot(status: .idle, theme: selectedTheme, label: "IDLE")
                StatusDot(status: .blocked, theme: selectedTheme, label: "BLOCKED")
                StatusDot(status: .stuck, theme: selectedTheme, label: "STUCK")
                StatusDot(status: .offline, theme: selectedTheme, label: "OFFLINE")
            }
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }

    private var priorityBadges: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PRIORITY BADGES")
                .crtLabelStyle(selectedTheme)

            HStack(spacing: 12) {
                PriorityBadge(priority: .p0, theme: selectedTheme)
                PriorityBadge(priority: .p1, theme: selectedTheme)
                PriorityBadge(priority: .p2, theme: selectedTheme)
                PriorityBadge(priority: .p3, theme: selectedTheme)
                PriorityBadge(priority: .p4, theme: selectedTheme)
            }
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }

    private var effectsDemo: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("GLOW EFFECTS")
                .crtLabelStyle(selectedTheme)

            HStack(spacing: 24) {
                Text("SMALL")
                    .font(.crtBase)
                    .foregroundColor(selectedTheme.primary)
                    .crtGlow(selectedTheme, size: .small)

                Text("MEDIUM")
                    .font(.crtBase)
                    .foregroundColor(selectedTheme.primary)
                    .crtGlow(selectedTheme, size: .medium)

                Text("LARGE")
                    .font(.crtBase)
                    .foregroundColor(selectedTheme.primary)
                    .crtGlow(selectedTheme, size: .large)
            }

            Text("PULSING INDICATOR")
                .crtLabelStyle(selectedTheme)
                .padding(.top, 8)

            Circle()
                .fill(selectedTheme.bright)
                .frame(width: 16, height: 16)
                .pulsingGlow(selectedTheme)
        }
        .padding()
        .background(CRTTheme.panelBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(selectedTheme.dim, lineWidth: 1)
        )
    }
}

// MARK: - Supporting Views

private struct ThemeButton: View {
    let theme: CRTTheme
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(theme.primary)
                    .frame(height: 40)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(isSelected ? theme.bright : .clear, lineWidth: 2)
                    )
                    .shadow(color: isSelected ? theme.glow : .clear, radius: 8)

                Text(theme.displayName)
                    .font(.crtXS)
                    .foregroundColor(isSelected ? theme.primary : theme.dim)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct ColorSwatch: View {
    let color: Color
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 4)
                .fill(color)
                .frame(width: 50, height: 50)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )

            Text(label)
                .font(.crtXS)
                .foregroundColor(.crtOffline)
        }
    }
}

private struct StatusDot: View {
    let status: CRTTheme.StatusColor
    let theme: CRTTheme
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Circle()
                .fill(status.color(for: theme))
                .frame(width: 12, height: 12)
                .modifier(StatusGlowModifier(status: status, theme: theme))

            Text(label)
                .font(.crtXS)
                .foregroundColor(theme.dim)
        }
    }
}

private struct StatusGlowModifier: ViewModifier {
    let status: CRTTheme.StatusColor
    let theme: CRTTheme

    func body(content: Content) -> some View {
        if status == .working {
            content.pulsingGlow(theme)
        } else {
            content.shadow(color: status.color(for: theme).opacity(0.5), radius: 4)
        }
    }
}

private struct PriorityBadge: View {
    let priority: CRTTheme.PriorityColor
    let theme: CRTTheme

    var label: String {
        switch priority {
        case .p0: return "P0"
        case .p1: return "P1"
        case .p2: return "P2"
        case .p3: return "P3"
        case .p4: return "P4"
        }
    }

    var body: some View {
        Text(label)
            .font(.crtXS)
            .foregroundColor(.black)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(priority.color(for: theme))
            .cornerRadius(2)
    }
}

// MARK: - Preview Provider

#Preview("Theme Preview") {
    ThemePreviewView()
}

#Preview("Green Theme") {
    ThemePreviewView()
        .environment(\.crtTheme, .green)
}

#Preview("Red Theme") {
    ThemePreviewView()
        .environment(\.crtTheme, .red)
}

#Preview("Blue Theme") {
    ThemePreviewView()
        .environment(\.crtTheme, .blue)
}
