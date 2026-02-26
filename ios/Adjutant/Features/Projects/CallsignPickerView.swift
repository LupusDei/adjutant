import SwiftUI
import AdjutantKit

/// CRT-themed sheet for choosing a StarCraft hero callsign when spawning an agent.
/// Shows all 44 callsigns grouped by race with availability indicators.
struct CallsignPickerView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let onSelect: (String) -> Void

    @State private var callsigns: [Callsign] = []
    @State private var selectedRace: CallsignRace?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                raceFilterTabs
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    .padding(.top, CRTTheme.Spacing.sm)

                Divider()
                    .background(theme.dim.opacity(0.3))
                    .padding(.top, CRTTheme.Spacing.sm)

                if isLoading {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("SCANNING ROSTER...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if let errorMessage {
                    Spacer()
                    ErrorBanner(
                        message: errorMessage,
                        onRetry: { Task { await loadCallsigns() } },
                        onDismiss: { self.errorMessage = nil }
                    )
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    Spacer()
                } else {
                    callsignList
                }
            }
            .background(theme.background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SELECT CALLSIGN", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                }
            }
        }
        .task {
            await loadCallsigns()
        }
    }

    // MARK: - Race Filter Tabs

    private var raceFilterTabs: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            raceTab(label: "ALL", race: nil)
            raceTab(label: "TERRAN", race: .terran)
            raceTab(label: "ZERG", race: .zerg)
            raceTab(label: "PROTOSS", race: .protoss)
        }
    }

    private func raceTab(label: String, race: CallsignRace?) -> some View {
        let isSelected = selectedRace == race
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedRace = race
            }
        } label: {
            CRTText(
                label,
                style: .caption,
                glowIntensity: isSelected ? .medium : .subtle,
                color: isSelected ? theme.primary : theme.dim
            )
            .padding(.vertical, CRTTheme.Spacing.xs)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? theme.primary.opacity(0.15) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isSelected ? theme.primary.opacity(0.5) : theme.dim.opacity(0.2),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Callsign List

    private var filteredCallsigns: [Callsign] {
        guard let race = selectedRace else { return callsigns }
        return callsigns.filter { $0.race == race }
    }

    private var callsignList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.xs) {
                ForEach(filteredCallsigns) { callsign in
                    callsignRow(callsign)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
    }

    private func callsignRow(_ callsign: Callsign) -> some View {
        Button {
            guard callsign.available else { return }
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onSelect(callsign.name)
            dismiss()
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Race icon
                CRTText(
                    raceIcon(callsign.race),
                    style: .caption,
                    glowIntensity: callsign.available ? .medium : .subtle,
                    color: callsign.available ? raceColor(callsign.race) : theme.dim.opacity(0.4)
                )
                .frame(width: 20)

                // Name
                CRTText(
                    callsign.name.uppercased(),
                    style: .body,
                    glowIntensity: callsign.available ? .medium : .subtle,
                    color: callsign.available ? theme.primary : theme.dim.opacity(0.4)
                )

                Spacer()

                // Status indicator
                if callsign.available {
                    CRTText("READY", style: .caption, glowIntensity: .subtle, color: CRTTheme.State.success)
                } else {
                    CRTText("IN USE", style: .caption, glowIntensity: .subtle, color: theme.dim.opacity(0.4))
                }
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(callsign.available ? theme.dim.opacity(0.05) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        callsign.available ? theme.primary.opacity(0.15) : theme.dim.opacity(0.08),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!callsign.available)
    }

    // MARK: - Helpers

    private func raceIcon(_ race: CallsignRace) -> String {
        switch race {
        case .terran: return "T"
        case .zerg: return "Z"
        case .protoss: return "P"
        }
    }

    private func raceColor(_ race: CallsignRace) -> Color {
        switch race {
        case .terran: return CRTTheme.State.info
        case .zerg: return CRTTheme.State.error
        case .protoss: return CRTTheme.State.warning
        }
    }

    private func loadCallsigns() async {
        isLoading = true
        errorMessage = nil

        do {
            callsigns = try await apiClient.getCallsigns()
            isLoading = false
        } catch {
            errorMessage = "Failed to load callsigns: \(error.localizedDescription)"
            isLoading = false
        }
    }
}
