#if canImport(UIKit)
import UIKit
#endif
import SwiftUI
import AdjutantKit

/// Collapsible section showing all callsigns with individual toggles and a master toggle.
/// Placed at the bottom of the Agents page per design spec.
struct CallsignRosterSection: View {
    @Environment(\.crtTheme) private var theme

    @State private var isExpanded = false
    @State private var callsigns: [CallsignSetting] = []
    @State private var masterEnabled = true
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedCallsignPersona: (name: String, personaId: String)?

    private let apiClient = AppState.shared.apiClient

    /// Number of enabled callsigns
    private var enabledCount: Int {
        callsigns.filter { $0.enabled }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Collapsible header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
                #if canImport(UIKit)
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                #endif
            } label: {
                HStack {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(theme.dim)

                    CRTText("CALLSIGN ROSTER", style: .caption, glowIntensity: .subtle, color: theme.dim)

                    Rectangle()
                        .fill(theme.dim.opacity(0.3))
                        .frame(height: 1)

                    Text("(\(enabledCount)/\(callsigns.count) ENABLED)")
                        .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(theme.dim)
                }
                .padding(.vertical, CRTTheme.Spacing.xs)
                .padding(.horizontal, CRTTheme.Spacing.md)
            }
            .buttonStyle(.plain)

            // Expanded content
            if isExpanded {
                expandedContent
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .task {
            await loadCallsigns()
        }
        .sheet(isPresented: Binding(
            get: { selectedCallsignPersona != nil },
            set: { if !$0 { selectedCallsignPersona = nil } }
        )) {
            if let info = selectedCallsignPersona {
                PersonaDetailSheet(agentName: info.name, personaId: info.personaId)
            }
        }
    }

    // MARK: - Expanded Content

    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Master toggle
            masterToggleRow

            Divider()
                .background(theme.dim.opacity(0.2))

            // Loading/error state
            if isLoading {
                HStack {
                    Spacer()
                    LoadingIndicator(size: .small)
                    Spacer()
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
            } else if let errorMessage {
                ErrorBanner(
                    message: errorMessage,
                    onRetry: { Task<Void, Never> { await loadCallsigns() } },
                    onDismiss: { self.errorMessage = nil }
                )
            } else {
                // Callsign grid
                callsignGrid
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.bottom, CRTTheme.Spacing.md)
    }

    // MARK: - Master Toggle

    private var masterToggleRow: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Text("ENABLE ALL")
                .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(theme.primary)

            Spacer()

            Toggle("", isOn: Binding(
                get: { masterEnabled },
                set: { newValue in
                    Task<Void, Never> { await toggleAll(enabled: newValue) }
                }
            ))
            .tint(theme.primary)
            .labelsHidden()
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    // MARK: - Callsign Grid

    private var callsignGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 120), spacing: CRTTheme.Spacing.xs)],
            spacing: CRTTheme.Spacing.xs
        ) {
            ForEach(callsigns) { callsign in
                callsignToggleRow(callsign)
            }
        }
    }

    private func callsignToggleRow(_ callsign: CallsignSetting) -> some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Text(callsign.name.uppercased())
                .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                .tracking(0.5)
                .foregroundColor(callsign.enabled && masterEnabled ? theme.primary : theme.dim.opacity(0.4))
                .lineLimit(1)

            Spacer()

            Toggle("", isOn: Binding(
                get: { callsign.enabled },
                set: { newValue in
                    Task<Void, Never> { await toggleCallsign(name: callsign.name, enabled: newValue) }
                }
            ))
            .tint(theme.primary)
            .labelsHidden()
            .scaleEffect(0.8)
            .disabled(!masterEnabled)
        }
        .padding(.horizontal, CRTTheme.Spacing.xs)
        .padding(.vertical, CRTTheme.Spacing.xxxs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .opacity(masterEnabled ? 1.0 : 0.5)
        .onLongPressGesture {
            Task<Void, Never> {
                do {
                    let personas = try await apiClient.getPersonas()
                    if let persona = personas.first(where: { $0.name.lowercased() == callsign.name.lowercased() }) {
                        selectedCallsignPersona = (name: callsign.name, personaId: persona.id)
                    }
                } catch {
                    // No persona for this callsign — ignore
                }
            }
        }
    }

    // MARK: - API Calls

    private func loadCallsigns() async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await apiClient.getCallsignToggles()
            callsigns = response.callsigns
            masterEnabled = response.masterEnabled
            isLoading = false
        } catch {
            isLoading = false
            errorMessage = "Failed to load callsigns: \(error.localizedDescription)"
        }
    }

    private func toggleCallsign(name: String, enabled: Bool) async {
        // Optimistic update
        if let index = callsigns.firstIndex(where: { $0.name == name }) {
            callsigns[index] = CallsignSetting(name: name, enabled: enabled)
        }

        do {
            _ = try await apiClient.toggleCallsign(name: name, enabled: enabled)
        } catch {
            // Revert on failure
            await loadCallsigns()
        }
    }

    private func toggleAll(enabled: Bool) async {
        // Optimistic update
        masterEnabled = enabled
        callsigns = callsigns.map { CallsignSetting(name: $0.name, enabled: enabled) }

        do {
            _ = try await apiClient.toggleAllCallsigns(enabled: enabled)
        } catch {
            // Revert on failure
            await loadCallsigns()
        }
    }
}

// MARK: - Preview

#Preview("CallsignRosterSection") {
    VStack {
        Spacer()
        CallsignRosterSection()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
