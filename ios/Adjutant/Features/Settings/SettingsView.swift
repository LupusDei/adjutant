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

                // Server URL Section
                serverSection

                // API Key Section
                apiKeySection

                // Communication Section
                communicationSection

                // Notifications Section
                notificationsSection

                // Voice Section
                voiceSection

                // About Section
                aboutSection
            }
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
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
                            .fill(theme.background.panel)
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
                            .fill(theme.background.panel)
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
/// Each card uses the scheme's own colors and a distinctive visual treatment
/// so users can identify each theme at a glance without reading the name.
private struct SchemePreviewCard: View {
    let scheme: ThemeIdentifier
    let isSelected: Bool
    let onTap: () -> Void

    /// The color theme for this card's scheme
    private var colorTheme: CRTTheme.ColorTheme { scheme.colorTheme }

    /// Corner radius: larger for non-CRT themes, tight for CRT themes
    private var cornerRadius: CGFloat {
        colorTheme.crtEffectsEnabled ? CRTTheme.CornerRadius.md : CRTTheme.CornerRadius.lg
    }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .topLeading) {
                // Theme-specific content
                cardContent
                    .padding(CRTTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 120)

                // Scanline overlay for CRT themes
                if colorTheme.crtEffectsEnabled {
                    CardScanlineOverlay(lineColor: colorTheme.primary)
                        .opacity(0.06)
                        .allowsHitTesting(false)
                }
            }
            .background(cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(cardBorder)
            .compositingGroup()
            .shadow(
                color: cardShadowColor,
                radius: cardShadowRadius,
                x: 0,
                y: cardShadowY
            )
            .scaleEffect(isSelected ? 1.0 : 0.97)
            .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(scheme.displayName) theme")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(isSelected ? "Currently selected" : "Double tap to select")
    }

    // MARK: - Card Content (per-theme)

    @ViewBuilder
    private var cardContent: some View {
        switch scheme {
        case .pipboy:
            pipboyContent
        case .document:
            documentContent
        case .starcraft:
            starcraftContent
        case .friendly:
            friendlyContent
        }
    }

    // MARK: - Pip-Boy Content

    /// Retro terminal aesthetic: monospace header, cursor blink, system readout lines
    private var pipboyContent: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Header with terminal prompt feel
            HStack(spacing: CRTTheme.Spacing.xs) {
                Text(">")
                    .font(.crt(CRTTypography.sizeLG))
                    .foregroundColor(colorTheme.bright)
                    .crtGlow(color: colorTheme.bright, radius: 3, intensity: 0.4)

                Text(scheme.displayName)
                    .font(.crt(CRTTypography.sizeLG))
                    .foregroundColor(colorTheme.textPrimary)
                    .tracking(CRTTypography.letterSpacingWider)
                    .crtGlow(color: colorTheme.primary, radius: 2, intensity: 0.3)

                // Blinking cursor
                BlinkingCursor(color: colorTheme.bright)

                Spacer()

                selectionIndicator
            }

            // Thin green divider with glow
            Rectangle()
                .fill(colorTheme.primary.opacity(0.5))
                .frame(height: 1)
                .crtGlow(color: colorTheme.primary, radius: 3, intensity: 0.3)

            // System readout lines
            HStack(spacing: CRTTheme.Spacing.xs) {
                Text("STATUS")
                    .font(.crt(CRTTypography.sizeXS))
                    .foregroundColor(colorTheme.dim)
                    .tracking(CRTTypography.letterSpacingWider)

                Rectangle()
                    .fill(colorTheme.dim.opacity(0.3))
                    .frame(width: 1, height: 10)

                Text("NOMINAL")
                    .font(.crt(CRTTypography.sizeXS))
                    .foregroundColor(colorTheme.bright)
                    .crtGlow(color: colorTheme.bright, radius: 2, intensity: 0.3)
            }

            Text("All subsystems operational")
                .font(.crt(CRTTypography.sizeSM))
                .foregroundColor(colorTheme.textSecondary)
        }
    }

    // MARK: - Document Content

    /// Clean professional aesthetic: serif-like hierarchy, paragraph lines, subtle shadow
    private var documentContent: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Clean header with proper typographic hierarchy
            HStack {
                Text(scheme.displayName)
                    .font(.system(size: CRTTypography.sizeLG, weight: .semibold, design: .default))
                    .foregroundColor(colorTheme.textPrimary)
                    .tracking(CRTTypography.letterSpacingWide)

                Spacer()

                selectionIndicator
            }

            // Clean thin divider
            Rectangle()
                .fill(colorTheme.dim.opacity(0.2))
                .frame(height: 1)

            // Document-style paragraph lines (abstract text representation)
            VStack(alignment: .leading, spacing: 6) {
                DocumentLine(widthFraction: 1.0, color: colorTheme.dim.opacity(0.15))
                DocumentLine(widthFraction: 0.85, color: colorTheme.dim.opacity(0.12))
                DocumentLine(widthFraction: 0.92, color: colorTheme.dim.opacity(0.10))
                DocumentLine(widthFraction: 0.6, color: colorTheme.dim.opacity(0.08))
            }

            // Subtle body text
            Text("Clean, focused reading")
                .font(.system(size: CRTTypography.sizeSM, weight: .regular, design: .default))
                .foregroundColor(colorTheme.textSecondary)
        }
    }

    // MARK: - StarCraft Content

    /// Sci-fi electric aesthetic: teal accents, geometric decorations, gradient feel
    private var starcraftContent: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Header with electric accent
            HStack(spacing: CRTTheme.Spacing.xs) {
                // Small geometric accent
                Diamond(color: colorTheme.bright)
                    .frame(width: 8, height: 8)
                    .crtGlow(color: colorTheme.bright, radius: 4, intensity: 0.6)

                Text(scheme.displayName)
                    .font(.crt(CRTTypography.sizeLG))
                    .foregroundColor(colorTheme.textPrimary)
                    .tracking(CRTTypography.letterSpacingWider)
                    .crtGlow(color: colorTheme.primary, radius: 2, intensity: 0.3)

                Spacer()

                selectionIndicator
            }

            // Electric teal gradient divider
            GeometryReader { geometry in
                LinearGradient(
                    colors: [
                        colorTheme.primary.opacity(0.0),
                        colorTheme.primary.opacity(0.8),
                        colorTheme.bright,
                        colorTheme.primary.opacity(0.8),
                        colorTheme.primary.opacity(0.0)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: geometry.size.width, height: 1)
                .crtGlow(color: colorTheme.bright, radius: 4, intensity: 0.5)
            }
            .frame(height: 1)

            // Sci-fi status readout with teal accents
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Mini status bars
                HStack(spacing: 3) {
                    ForEach(0..<4, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(index < 3 ? colorTheme.bright : colorTheme.dim.opacity(0.3))
                            .frame(width: 12, height: 4)
                            .crtGlow(
                                color: colorTheme.bright,
                                radius: index < 3 ? 2 : 0,
                                intensity: index < 3 ? 0.4 : 0
                            )
                    }
                }

                Text("PSIONIC LINK ACTIVE")
                    .font(.crt(CRTTypography.sizeXS))
                    .foregroundColor(colorTheme.dim)
                    .tracking(CRTTypography.letterSpacingWider)
            }

            Text("Protoss neural interface online")
                .font(.crt(CRTTypography.sizeSM))
                .foregroundColor(colorTheme.textSecondary)
        }
    }

    // MARK: - Friendly Content

    /// Playful multi-color aesthetic: Google/kindergarten vibes, variety of colors
    private var friendlyContent: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Header with playful styling
            HStack {
                // Each letter in a different color
                HStack(spacing: 1) {
                    ForEach(Array(zip(Array("FRIENDLY"), friendlyAccentColors)), id: \.0) { letter, color in
                        Text(String(letter))
                            .font(.system(size: CRTTypography.sizeLG, weight: .heavy, design: .rounded))
                            .foregroundColor(color)
                    }
                }

                Spacer()

                selectionIndicator
            }

            // Colorful accent circles — varied sizes for playful feel
            HStack(spacing: 6) {
                ForEach(Array(friendlyAccentColors.enumerated()), id: \.offset) { index, color in
                    Circle()
                        .fill(color)
                        .frame(width: CGFloat([16, 12, 14, 12, 10, 14][index]),
                               height: CGFloat([16, 12, 14, 12, 10, 14][index]))
                }

                Spacer()
            }

            // Playful tagline
            Text("A playground of colors")
                .font(.system(size: CRTTypography.sizeSM, weight: .medium, design: .rounded))
                .foregroundColor(colorTheme.textSecondary)
        }
    }

    /// Google-style multi-color palette from the canonical FriendlyColorPalette
    private var friendlyAccentColors: [Color] {
        colorTheme.colorPalette?.allColors ?? [colorTheme.primary, colorTheme.accent]
    }

    // MARK: - Shared Selection Indicator

    @ViewBuilder
    private var selectionIndicator: some View {
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

    // MARK: - Card Styling

    /// Background: uses scheme screen color; StarCraft gets a subtle gradient overlay
    @ViewBuilder
    private var cardBackground: some View {
        switch scheme {
        case .starcraft:
            ZStack {
                colorTheme.background.screen
                // Subtle purple-to-deeper gradient
                LinearGradient(
                    colors: [
                        colorTheme.background.panel.opacity(0.3),
                        colorTheme.background.screen
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        default:
            colorTheme.background.screen
        }
    }

    /// Border styling: CRT schemes get glow, Document gets clean subtle border with shadow
    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .stroke(
                isSelected ? colorTheme.primary : colorTheme.dim.opacity(0.3),
                lineWidth: isSelected ? 2 : 1
            )
            .crtGlow(
                color: colorTheme.primary,
                radius: (isSelected && colorTheme.crtEffectsEnabled) ? 10 : 0,
                intensity: (isSelected && colorTheme.crtEffectsEnabled) ? 0.5 : 0
            )
    }

    // MARK: - Shadow Properties

    /// Shadow color: Document gets a real shadow, CRT themes get colored glow-shadow
    private var cardShadowColor: Color {
        if !isSelected { return .clear }
        if colorTheme.crtEffectsEnabled {
            return colorTheme.primary.opacity(0.2)
        } else {
            return Color.black.opacity(0.12)
        }
    }

    private var cardShadowRadius: CGFloat {
        isSelected ? (colorTheme.crtEffectsEnabled ? 12 : 6) : 0
    }

    private var cardShadowY: CGFloat {
        isSelected ? (colorTheme.crtEffectsEnabled ? 0 : 3) : 0
    }
}

// MARK: - Blinking Cursor

/// A terminal-style blinking cursor block for the Pip-Boy card
private struct BlinkingCursor: View {
    let color: Color
    @State private var isVisible = true

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(width: 8, height: 14)
            .opacity(isVisible ? 1.0 : 0.0)
            .crtGlow(color: color, radius: 2, intensity: 0.3)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    isVisible = false
                }
            }
    }
}

// MARK: - Card Scanline Overlay

/// Lightweight scanline texture for preview cards. Unlike the full ScanlineOverlay
/// in CRTEffects.swift, this draws colored lines matching the card's own scheme
/// rather than reading from the environment theme.
private struct CardScanlineOverlay: View {
    let lineColor: Color

    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 3
            let lineCount = Int(size.height / spacing)
            for i in 0..<lineCount {
                let y = CGFloat(i) * spacing
                let rect = CGRect(x: 0, y: y, width: size.width, height: 1)
                context.fill(Path(rect), with: .color(lineColor))
            }
        }
    }
}

// MARK: - Document Line

/// A horizontal bar representing a line of text in a document preview
private struct DocumentLine: View {
    let widthFraction: CGFloat
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            RoundedRectangle(cornerRadius: 1.5)
                .fill(color)
                .frame(width: geometry.size.width * widthFraction, height: 3)
        }
        .frame(height: 3)
    }
}

// MARK: - Diamond Shape

/// A small diamond/rhombus decoration for sci-fi themed cards
private struct Diamond: View {
    let color: Color

    var body: some View {
        Rectangle()
            .fill(color)
            .rotationEffect(.degrees(45))
            .scaleEffect(x: 0.7, y: 0.7)
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

#Preview("Settings View - Document Theme") {
    SettingsView()
        .environmentObject(AppCoordinator())
        .crtTheme(.document)
}
