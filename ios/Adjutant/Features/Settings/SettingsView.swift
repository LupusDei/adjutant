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

                // Server URL Section
                serverSection

                // API Key Section
                apiKeySection

                // Communication Section
                communicationSection

                // Deployment Mode Section
                modeSection

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
            VStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(ThemeIdentifier.allCases) { themeOption in
                    SchemePreviewCard(
                        scheme: themeOption,
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
        .padding(.horizontal, CRTTheme.Spacing.md)
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

    // MARK: - Server Section

    private var serverSection: some View {
        CRTCard(header: "SERVER") {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Current URL display
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    CRTText("API ENDPOINT", style: .caption, color: theme.dim)

                    HStack {
                        Image(systemName: "link")
                            .foregroundColor(theme.dim)
                            .font(.system(size: 14))

                        TextField("https://your-tunnel.ngrok.io", text: $viewModel.serverURL)
                            .textFieldStyle(.plain)
                            .font(.crt(CRTTypography.sizeBase))
                            .foregroundColor(theme.primary)
                            #if os(iOS)
                            .autocapitalization(.none)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            #endif
                            .autocorrectionDisabled()
                    }
                    .padding(CRTTheme.Spacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .fill(CRTTheme.Background.panel)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(
                                viewModel.serverErrorMessage != nil ? CRTTheme.State.error : theme.dim.opacity(0.5),
                                lineWidth: 1
                            )
                    )

                    // Error message
                    if let error = viewModel.serverErrorMessage {
                        HStack(spacing: CRTTheme.Spacing.xs) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(CRTTheme.State.error)
                                .font(.system(size: 12))
                            CRTText(error, style: .caption, color: CRTTheme.State.error)
                        }
                    }
                }

                // Save button
                HStack(spacing: CRTTheme.Spacing.md) {
                    CRTButton(
                        viewModel.isValidatingServer ? "SAVING..." : "SAVE",
                        variant: .primary,
                        size: .medium
                    ) {
                        Task {
                            await viewModel.updateServerURL()
                        }
                    }
                    .disabled(viewModel.serverURL.isEmpty || viewModel.isValidatingServer)

                    CRTButton(
                        "RESET",
                        variant: .ghost,
                        size: .medium
                    ) {
                        viewModel.resetServerURL()
                    }
                    .disabled(viewModel.isValidatingServer)
                }

                // Help text
                CRTText(
                    "Enter your ngrok tunnel URL. The app will reconnect to the new server.",
                    style: .caption,
                    color: theme.dim
                )
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - API Key Section

    private var apiKeySection: some View {
        CRTCard(header: "API KEY") {
            VStack(spacing: CRTTheme.Spacing.md) {
                // API key input
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    CRTText("AUTHENTICATION KEY", style: .caption, color: theme.dim)

                    HStack {
                        Image(systemName: "key.fill")
                            .foregroundColor(theme.dim)
                            .font(.system(size: 14))

                        SecureField("Enter API key", text: $viewModel.apiKey)
                            .textFieldStyle(.plain)
                            .font(.crt(CRTTypography.sizeBase))
                            .foregroundColor(theme.primary)
                            #if os(iOS)
                            .autocapitalization(.none)
                            .textContentType(.password)
                            #endif
                            .autocorrectionDisabled()
                    }
                    .padding(CRTTheme.Spacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .fill(CRTTheme.Background.panel)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.dim.opacity(0.5), lineWidth: 1)
                    )
                }

                // Buttons
                HStack(spacing: CRTTheme.Spacing.md) {
                    CRTButton(
                        viewModel.isSavingAPIKey ? "SAVING..." : "SAVE",
                        variant: .primary,
                        size: .medium
                    ) {
                        Task {
                            await viewModel.saveAPIKey()
                        }
                    }
                    .disabled(viewModel.apiKey.isEmpty || viewModel.isSavingAPIKey)

                    CRTButton(
                        "CLEAR",
                        variant: .ghost,
                        size: .medium
                    ) {
                        viewModel.clearAPIKey()
                    }
                    .disabled(viewModel.apiKey.isEmpty || viewModel.isSavingAPIKey)
                }

                // Help text
                CRTText(
                    "API key is sent with all requests for authentication.",
                    style: .caption,
                    color: theme.dim
                )
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Communication Section

    private var communicationSection: some View {
        CRTCard(header: "COMMUNICATION", headerBadge: viewModel.communicationPriority.displayName) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("DATA SYNC PRIORITY", style: .caption, color: theme.dim)

                ForEach(CommunicationPriority.allCases) { priority in
                    CommunicationPriorityOption(
                        priority: priority,
                        isSelected: viewModel.communicationPriority == priority,
                        onTap: {
                            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                                viewModel.communicationPriority = priority
                            }
                        }
                    )
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Mode Section

    private var modeSection: some View {
        CRTCard(header: "DEPLOYMENT MODE", headerBadge: viewModel.currentMode.displayName) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("OPERATION MODE", style: .caption, color: theme.dim)

                ForEach(DeploymentMode.allCases) { mode in
                    ModeCard(
                        mode: mode,
                        isActive: viewModel.currentMode == mode,
                        isAvailable: modeIsAvailable(mode),
                        unavailableReason: modeUnavailableReason(mode),
                        isSwitching: viewModel.isModeSwitching,
                        onTap: {
                            Task {
                                await viewModel.switchMode(to: mode)
                            }
                        }
                    )
                }

                if let error = viewModel.modeErrorMessage {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(CRTTheme.State.error)
                            .font(.system(size: 12))
                        CRTText(error, style: .caption, color: CRTTheme.State.error)
                    }
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private func modeIsAvailable(_ mode: DeploymentMode) -> Bool {
        guard let available = viewModel.availableModes.first(where: { $0.mode == mode }) else {
            return true // Default to available if not in the list
        }
        return available.available
    }

    private func modeUnavailableReason(_ mode: DeploymentMode) -> String? {
        viewModel.availableModes.first(where: { $0.mode == mode && !$0.available })?.reason
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

// MARK: - Scheme Preview Card

/// A preview card that renders a mini-preview of a color scheme's aesthetic.
/// Each card uses the scheme's own colors to communicate its look and feel.
private struct SchemePreviewCard: View {
    let scheme: ThemeIdentifier
    let isSelected: Bool
    let onTap: () -> Void

    /// The color theme for this card's scheme
    private var colorTheme: CRTTheme.ColorTheme { scheme.colorTheme }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                // Header row with scheme name and selection indicator
                HStack {
                    Text(scheme.displayName)
                        .font(headerFont)
                        .foregroundColor(colorTheme.textPrimary)
                        .tracking(CRTTypography.letterSpacingWider)

                    Spacer()

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(colorTheme.accent)
                            .crtGlow(
                                color: colorTheme.accent,
                                radius: colorTheme.crtEffectsEnabled ? 6 : 0,
                                intensity: colorTheme.crtEffectsEnabled ? 0.5 : 0
                            )
                    }
                }

                // Divider line in theme color
                Rectangle()
                    .fill(colorTheme.dim.opacity(0.4))
                    .frame(height: 1)

                // Sample content lines
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    Text("System status: nominal")
                        .font(bodyFont)
                        .foregroundColor(colorTheme.textPrimary)

                    Text("All subsystems operational")
                        .font(bodyFont)
                        .foregroundColor(colorTheme.textSecondary)
                }
            }
            .padding(CRTTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: 100)
            .background(cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md))
            .overlay(cardBorder)
            .scaleEffect(isSelected ? 1.0 : 0.97)
            .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(scheme.displayName) theme")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(isSelected ? "Currently selected" : "Double tap to select")
    }

    // MARK: - Fonts

    /// Header font: monospace for CRT schemes, system for Document
    private var headerFont: Font {
        colorTheme.useMonospaceFont
            ? .crt(CRTTypography.sizeLG)
            : .system(size: CRTTypography.sizeLG, weight: .bold, design: .default)
    }

    /// Body font: monospace for CRT schemes, system for Document
    private var bodyFont: Font {
        colorTheme.useMonospaceFont
            ? .crt(CRTTypography.sizeSM)
            : .system(size: CRTTypography.sizeSM, weight: .regular, design: .default)
    }

    // MARK: - Card Styling

    /// Background color using the scheme's own screen color
    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
            .fill(colorTheme.background.screen)
    }

    /// Border with glow effect when selected; CRT schemes get a glow, Document gets a clean border
    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
            .stroke(
                isSelected ? colorTheme.primary : colorTheme.dim.opacity(0.3),
                lineWidth: isSelected ? 2 : 1
            )
            .crtGlow(
                color: colorTheme.primary,
                radius: (isSelected && colorTheme.crtEffectsEnabled) ? 8 : 0,
                intensity: (isSelected && colorTheme.crtEffectsEnabled) ? 0.4 : 0
            )
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

// MARK: - Communication Priority Option

private struct CommunicationPriorityOption: View {
    @Environment(\.crtTheme) private var theme

    let priority: CommunicationPriority
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

                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    CRTText(priority.displayName, style: .body, color: isSelected ? theme.primary : theme.dim)
                    CRTText(priority.description, style: .caption, color: theme.dim)
                }

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
        .accessibilityLabel("\(priority.displayName): \(priority.description)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Mode Card

private struct ModeCard: View {
    @Environment(\.crtTheme) private var theme

    let mode: DeploymentMode
    let isActive: Bool
    let isAvailable: Bool
    let unavailableReason: String?
    let isSwitching: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.md) {
                // Mode icon
                Image(systemName: mode.icon)
                    .font(.system(size: 24))
                    .foregroundColor(isActive ? theme.primary : theme.dim)
                    .frame(width: 32)
                    .crtGlow(color: isActive ? theme.primary : .clear, radius: 6, intensity: 0.5)

                // Mode info
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(
                            mode.displayName,
                            style: .body,
                            glowIntensity: isActive ? .medium : .none,
                            color: isActive ? theme.primary : (isAvailable ? theme.dim : theme.dim.opacity(0.4))
                        )

                        if isActive {
                            CRTText("ACTIVE", style: .caption, color: CRTTheme.State.success)
                        }
                    }

                    CRTText(
                        mode.description,
                        style: .caption,
                        color: theme.dim.opacity(isAvailable ? 0.8 : 0.4)
                    )

                    if let reason = unavailableReason {
                        CRTText(reason, style: .caption, color: CRTTheme.State.warning)
                    }
                }

                Spacer()

                // Active indicator
                if isActive {
                    StatusDot(.success, size: 10, pulse: true)
                } else if isSwitching {
                    InlineLoadingIndicator()
                }
            }
            .padding(CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(isActive ? theme.primary.opacity(0.1) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(
                        isActive ? theme.primary : theme.dim.opacity(0.2),
                        lineWidth: isActive ? 2 : 1
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!isAvailable || isActive || isSwitching)
        .opacity(isAvailable ? 1.0 : 0.5)
        .accessibilityLabel("\(mode.displayName): \(mode.description)")
        .accessibilityAddTraits(isActive ? .isSelected : [])
        .accessibilityHint(isAvailable ? (isActive ? "Currently active" : "Tap to switch") : (unavailableReason ?? "Unavailable"))
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

// MARK: - Preview

#Preview("Settings View") {
    SettingsView()
        .environmentObject(AppCoordinator())
}

#Preview("Settings View - StarCraft Theme") {
    SettingsView()
        .environmentObject(AppCoordinator())
        .crtTheme(.starcraft)
}
