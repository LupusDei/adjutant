import SwiftUI
import AdjutantKit

/// Main settings view for app configuration.
/// Includes theme selection, tunnel control, notifications, voice settings, and about section.
struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @Environment(\.crtTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.lg) {
                // Header
                settingsHeader

                // Theme Section
                themeSection

                // Tunnel Section
                tunnelSection

                // Notifications Section
                notificationsSection

                // Voice Section
                voiceSection

                // Rig Filter Section
                rigFilterSection

                // About Section
                aboutSection
            }
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header

    private var settingsHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText("SETTINGS", style: .header)
                CRTText("SYSTEM CONFIGURATION", style: .caption, color: theme.dim)
            }
            Spacer()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Theme Section

    private var themeSection: some View {
        CRTCard(header: "THEME", headerBadge: viewModel.selectedTheme.displayName) {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Theme preview
                themePreview

                // Theme selector
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: CRTTheme.Spacing.sm) {
                    ForEach(ThemeIdentifier.allCases) { themeOption in
                        ThemeButton(
                            theme: themeOption,
                            isSelected: viewModel.selectedTheme == themeOption,
                            onTap: {
                                withAnimation(.easeInOut(duration: CRTTheme.Animation.normal)) {
                                    viewModel.setTheme(themeOption)
                                }
                            }
                        )
                    }
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private var themePreview: some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            // Sample text
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTText("PREVIEW", style: .subheader)
                CRTText("Sample body text", style: .body)
                CRTText("Caption text", style: .caption, color: theme.dim)
            }

            Spacer()

            // Sample button
            VStack(spacing: CRTTheme.Spacing.xs) {
                Circle()
                    .fill(theme.primary)
                    .frame(width: 32, height: 32)
                    .crtGlow(color: theme.primary, radius: 8, intensity: 0.6)

                CRTText("ACTIVE", style: .caption)
            }
        }
        .padding(CRTTheme.Spacing.md)
        .background(CRTTheme.Background.elevated.opacity(0.5))
        .cornerRadius(CRTTheme.CornerRadius.md)
    }

    // MARK: - Tunnel Section

    private var tunnelSection: some View {
        CRTCard(header: "TUNNEL") {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Status display
                HStack {
                    StatusDot(tunnelStatusType, size: 12, pulse: viewModel.powerState == .running)

                    CRTText(tunnelStatusText, style: .body, color: tunnelStatusColor)

                    Spacer()

                    if viewModel.isTunnelOperating {
                        InlineLoadingIndicator()
                    }
                }

                // Control buttons
                HStack(spacing: CRTTheme.Spacing.md) {
                    CRTButton(
                        "START",
                        variant: viewModel.powerState == .stopped ? .primary : .ghost,
                        size: .medium
                    ) {
                        Task {
                            await viewModel.startTunnel()
                        }
                    }
                    .disabled(viewModel.powerState != .stopped || viewModel.isTunnelOperating)

                    CRTButton(
                        "STOP",
                        variant: viewModel.powerState == .running ? .danger : .ghost,
                        size: .medium
                    ) {
                        Task {
                            await viewModel.stopTunnel()
                        }
                    }
                    .disabled(viewModel.powerState != .running || viewModel.isTunnelOperating)
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private var tunnelStatusType: BadgeView.Style.StatusType {
        switch viewModel.powerState {
        case .running: return .success
        case .starting, .stopping: return .warning
        case .stopped: return .offline
        }
    }

    private var tunnelStatusText: String {
        switch viewModel.powerState {
        case .running: return "TUNNEL ACTIVE"
        case .starting: return "STARTING..."
        case .stopping: return "STOPPING..."
        case .stopped: return "TUNNEL OFFLINE"
        }
    }

    private var tunnelStatusColor: Color {
        switch viewModel.powerState {
        case .running: return CRTTheme.State.success
        case .starting, .stopping: return CRTTheme.State.warning
        case .stopped: return CRTTheme.State.offline
        }
    }

    // MARK: - Notifications Section

    private var notificationsSection: some View {
        CRTCard(header: "NOTIFICATIONS") {
            SettingsToggleRow(
                title: "PUSH NOTIFICATIONS",
                subtitle: "Receive alerts for new mail and crew status",
                isOn: $viewModel.notificationsEnabled
            )
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Voice Section

    private var voiceSection: some View {
        CRTCard(header: "VOICE") {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Voice availability status
                if !viewModel.isVoiceAvailable {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(CRTTheme.State.warning)
                        CRTText("Voice features unavailable", style: .caption, color: CRTTheme.State.warning)
                        Spacer()
                    }
                }

                // Voice selection
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    CRTText("VOICE TYPE", style: .caption, color: theme.dim)

                    HStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(SettingsViewModel.VoiceOption.allCases) { voice in
                            VoiceOptionButton(
                                voice: voice,
                                isSelected: viewModel.selectedVoice == voice,
                                onTap: { viewModel.selectedVoice = voice }
                            )
                        }
                    }
                }

                // Volume slider
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    HStack {
                        CRTText("VOLUME", style: .caption, color: theme.dim)
                        Spacer()
                        CRTText("\(Int(viewModel.voiceVolume * 100))%", style: .mono, color: theme.primary)
                    }

                    CRTSlider(value: $viewModel.voiceVolume, range: 0...1)
                }
            }
            .disabled(!viewModel.isVoiceAvailable)
            .opacity(viewModel.isVoiceAvailable ? 1.0 : 0.5)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Rig Filter Section

    private var rigFilterSection: some View {
        CRTCard(header: "DEFAULT RIG FILTER") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("Filter content by rig on startup", style: .caption, color: theme.dim)

                // All rigs option
                RigFilterOption(
                    title: "ALL RIGS",
                    isSelected: viewModel.defaultRigFilter == nil,
                    onTap: { viewModel.defaultRigFilter = nil }
                )

                // Individual rigs
                ForEach(viewModel.availableRigs, id: \.self) { rig in
                    RigFilterOption(
                        title: rig.uppercased(),
                        isSelected: viewModel.defaultRigFilter == rig,
                        onTap: { viewModel.defaultRigFilter = rig }
                    )
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - About Section

    private var aboutSection: some View {
        CRTCard(header: "ABOUT") {
            VStack(spacing: CRTTheme.Spacing.sm) {
                AboutRow(label: "VERSION", value: viewModel.appVersion)
                AboutRow(label: "BUILD", value: "ADJUTANT iOS")

                Divider()
                    .background(theme.dim.opacity(0.3))

                HStack {
                    Spacer()
                    CRTText("GAS TOWN SYSTEMS", style: .caption, color: theme.dim)
                    Spacer()
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }
}

// MARK: - Theme Button

private struct ThemeButton: View {
    @Environment(\.crtTheme) private var currentTheme

    let theme: ThemeIdentifier
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: CRTTheme.Spacing.xs) {
                Circle()
                    .fill(themeColor)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Circle()
                            .stroke(isSelected ? themeColor : Color.clear, lineWidth: 2)
                            .padding(-4)
                    )
                    .crtGlow(color: themeColor, radius: isSelected ? 8 : 0, intensity: isSelected ? 0.6 : 0)

                CRTText(
                    theme.displayName,
                    style: .caption,
                    glowIntensity: isSelected ? .medium : .none,
                    color: isSelected ? themeColor : currentTheme.dim
                )
            }
            .padding(.vertical, CRTTheme.Spacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(theme.displayName) theme")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var themeColor: Color {
        switch theme {
        case .green: return CRTTheme.ColorTheme.green.primary
        case .red: return CRTTheme.ColorTheme.red.primary
        case .blue: return CRTTheme.ColorTheme.blue.primary
        case .tan: return CRTTheme.ColorTheme.tan.primary
        case .pink: return CRTTheme.ColorTheme.pink.primary
        case .purple: return CRTTheme.ColorTheme.purple.primary
        }
    }
}

// MARK: - Settings Toggle Row

private struct SettingsToggleRow: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let subtitle: String?
    @Binding var isOn: Bool

    init(title: String, subtitle: String? = nil, isOn: Binding<Bool>) {
        self.title = title
        self.subtitle = subtitle
        self._isOn = isOn
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText(title, style: .body)
                if let subtitle = subtitle {
                    CRTText(subtitle, style: .caption, color: theme.dim)
                }
            }

            Spacer()

            CRTToggle(isOn: $isOn)
        }
    }
}

// MARK: - CRT Toggle

private struct CRTToggle: View {
    @Environment(\.crtTheme) private var theme
    @Binding var isOn: Bool

    var body: some View {
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

// MARK: - Voice Option Button

private struct VoiceOptionButton: View {
    @Environment(\.crtTheme) private var theme

    let voice: SettingsViewModel.VoiceOption
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            CRTText(
                voice.displayName,
                style: .caption,
                glowIntensity: isSelected ? .medium : .none,
                color: isSelected ? theme.primary : theme.dim
            )
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? theme.primary.opacity(0.2) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(isSelected ? theme.primary : theme.dim.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voice.displayName)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - CRT Slider

private struct CRTSlider: View {
    @Environment(\.crtTheme) private var theme
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Track background
                RoundedRectangle(cornerRadius: 2)
                    .fill(theme.dim.opacity(0.2))
                    .frame(height: 4)

                // Filled track
                RoundedRectangle(cornerRadius: 2)
                    .fill(theme.primary)
                    .frame(width: geometry.size.width * normalizedValue, height: 4)
                    .crtGlow(color: theme.primary, radius: 3, intensity: 0.4)

                // Knob
                Circle()
                    .fill(theme.primary)
                    .frame(width: 16, height: 16)
                    .offset(x: (geometry.size.width - 16) * normalizedValue)
                    .crtGlow(color: theme.primary, radius: 4, intensity: 0.5)
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        let newValue = gesture.location.x / geometry.size.width
                        value = min(max(range.lowerBound, range.lowerBound + (range.upperBound - range.lowerBound) * newValue), range.upperBound)
                    }
            )
        }
        .frame(height: 24)
        .accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment:
                value = min(value + 0.1, range.upperBound)
            case .decrement:
                value = max(value - 0.1, range.lowerBound)
            @unknown default:
                break
            }
        }
    }

    private var normalizedValue: Double {
        (value - range.lowerBound) / (range.upperBound - range.lowerBound)
    }
}

// MARK: - Rig Filter Option

private struct RigFilterOption: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                // Radio indicator
                Circle()
                    .fill(isSelected ? theme.primary : Color.clear)
                    .frame(width: 12, height: 12)
                    .overlay(
                        Circle()
                            .stroke(isSelected ? theme.primary : theme.dim, lineWidth: 1)
                    )
                    .crtGlow(color: isSelected ? theme.primary : .clear, radius: 3, intensity: 0.4)

                CRTText(title, style: .body, color: isSelected ? theme.primary : theme.dim)

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(theme.primary)
                }
            }
            .padding(.vertical, CRTTheme.Spacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - About Row

private struct AboutRow: View {
    @Environment(\.crtTheme) private var theme

    let label: String
    let value: String

    var body: some View {
        HStack {
            CRTText(label, style: .caption, color: theme.dim)
            Spacer()
            CRTText(value, style: .mono)
        }
    }
}

// MARK: - Empty State View (if not already defined)

private struct EmptyStateView: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let icon: String

    var body: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundColor(theme.dim)

            CRTText(title, style: .caption, color: theme.dim)
        }
    }
}

// MARK: - Preview

#Preview("Settings View") {
    SettingsView()
        .environmentObject(AppCoordinator())
}

#Preview("Settings View - Blue Theme") {
    SettingsView()
        .environmentObject(AppCoordinator())
        .crtTheme(.blue)
}
