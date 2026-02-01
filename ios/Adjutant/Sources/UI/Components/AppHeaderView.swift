import SwiftUI

/// Shared app header component containing power status and rig filter.
/// Used across main views (Dashboard, Mail, Beads) for consistent navigation.
struct AppHeaderView: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    /// Title displayed in the header
    let title: String

    /// Subtitle displayed below the title
    let subtitle: String?

    /// Available rigs for the filter dropdown
    let availableRigs: [String]

    /// Whether to show a loading indicator
    var isLoading: Bool = false

    /// Action when power button is tapped
    var onPowerTap: (() -> Void)?

    init(
        title: String,
        subtitle: String? = nil,
        availableRigs: [String] = [],
        isLoading: Bool = false,
        onPowerTap: (() -> Void)? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.availableRigs = availableRigs
        self.isLoading = isLoading
        self.onPowerTap = onPowerTap
    }

    var body: some View {
        HStack(alignment: .center, spacing: CRTTheme.Spacing.md) {
            // Title section
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText(title, style: .header)
                if let subtitle = subtitle {
                    CRTText(subtitle, style: .caption, color: theme.dim)
                }
            }

            Spacer()

            // Loading indicator
            if isLoading {
                InlineLoadingIndicator()
            }

            // Rig filter dropdown
            RigFilterDropdown(availableRigs: availableRigs)

            // Power status indicator
            powerStatusButton
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private var powerStatusButton: some View {
        Button {
            onPowerTap?()
        } label: {
            HStack(spacing: CRTTheme.Spacing.xs) {
                // Status dot with pulse animation for running state
                StatusDot(
                    powerStatusType,
                    size: 10,
                    pulse: appState.powerState == .running
                )

                // Power icon
                Image(systemName: "power")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(powerIconColor)
            }
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(powerBackgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(powerBorderColor, lineWidth: 1)
            )
            .crtGlow(
                color: powerGlowColor,
                radius: appState.powerState == .running ? 6 : 0,
                intensity: appState.powerState == .running ? 0.4 : 0
            )
        }
        .buttonStyle(.plain)
        .disabled(appState.powerState.isTransitioning)
        .accessibilityLabel("Power status: \(powerStatusLabel)")
        .accessibilityHint(onPowerTap != nil ? "Tap to toggle power" : "")
    }

    // MARK: - Power Status Helpers

    private var powerStatusType: BadgeView.Style.StatusType {
        switch appState.powerState {
        case .running: return .success
        case .starting, .stopping: return .warning
        case .stopped: return .offline
        }
    }

    private var powerIconColor: Color {
        switch appState.powerState {
        case .running: return CRTTheme.State.success
        case .starting, .stopping: return CRTTheme.State.warning
        case .stopped: return CRTTheme.State.offline
        }
    }

    private var powerBackgroundColor: Color {
        switch appState.powerState {
        case .running: return CRTTheme.State.success.opacity(0.1)
        case .starting, .stopping: return CRTTheme.State.warning.opacity(0.1)
        case .stopped: return CRTTheme.State.offline.opacity(0.1)
        }
    }

    private var powerBorderColor: Color {
        switch appState.powerState {
        case .running: return CRTTheme.State.success.opacity(0.4)
        case .starting, .stopping: return CRTTheme.State.warning.opacity(0.4)
        case .stopped: return CRTTheme.State.offline.opacity(0.3)
        }
    }

    private var powerGlowColor: Color {
        switch appState.powerState {
        case .running: return CRTTheme.State.success
        case .starting, .stopping: return CRTTheme.State.warning
        case .stopped: return .clear
        }
    }

    private var powerStatusLabel: String {
        switch appState.powerState {
        case .running: return "Online"
        case .starting: return "Starting"
        case .stopping: return "Stopping"
        case .stopped: return "Offline"
        }
    }
}

// MARK: - Preview

#Preview("App Header - Running") {
    VStack {
        AppHeaderView(
            title: "ADJUTANT",
            subtitle: "SYSTEM OVERVIEW",
            availableRigs: ["adjutant", "beads", "gastown"]
        )
        Spacer()
    }
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
    .onAppear {
        AppState.shared.updatePowerState(.running)
    }
}

#Preview("App Header - Stopped") {
    VStack {
        AppHeaderView(
            title: "MAIL",
            subtitle: nil,
            availableRigs: ["adjutant", "beads"]
        )
        Spacer()
    }
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
    .onAppear {
        AppState.shared.updatePowerState(.stopped)
    }
}
