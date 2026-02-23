import SwiftUI
import AdjutantKit

/// CRT-themed sheet for spawning a new agent (polecat).
/// Shows available rigs grouped from the agents list, with a confirm button.
/// Follows the CallsignPickerView pattern for CRT sheet styling.
struct SpawnAgentSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    /// Callback when spawn completes successfully
    let onSpawned: () -> Void

    @State private var availableRigs: [String] = []
    @State private var selectedRig: String?
    @State private var isLoading = true
    @State private var isSpawning = false
    @State private var errorMessage: String?

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoading {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("SCANNING RIGS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if let errorMessage {
                    Spacer()
                    ErrorBanner(
                        message: errorMessage,
                        onRetry: { Task { await loadRigs() } },
                        onDismiss: { self.errorMessage = nil }
                    )
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    Spacer()
                } else if availableRigs.isEmpty {
                    Spacer()
                    VStack(spacing: CRTTheme.Spacing.sm) {
                        Image(systemName: "server.rack")
                            .font(.system(size: 36))
                            .foregroundColor(theme.dim)
                        CRTText("NO RIGS AVAILABLE", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                        CRTText("No rigs found to spawn agents on.", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
                    }
                    Spacer()
                } else {
                    rigSelection
                }
            }
            .background(CRTTheme.Background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SPAWN AGENT", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                    .disabled(isSpawning)
                }
            }
        }
        .task {
            await loadRigs()
        }
    }

    // MARK: - Rig Selection

    private var rigSelection: some View {
        VStack(spacing: 0) {
            // Rig list
            ScrollView {
                LazyVStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(availableRigs, id: \.self) { rig in
                        rigRow(rig)
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
            }

            // Confirm button
            confirmButton
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
        }
    }

    private func rigRow(_ rig: String) -> some View {
        let isSelected = selectedRig == rig

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedRig = rig
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Rig icon
                Image(systemName: "server.rack")
                    .font(.system(size: 16))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)

                // Rig name
                CRTText(
                    rig.uppercased(),
                    style: .body,
                    glowIntensity: isSelected ? .medium : .subtle,
                    color: isSelected ? theme.primary : theme.dim
                )

                Spacer()

                // Selection indicator
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(theme.primary)
                }
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? theme.primary.opacity(0.15) : theme.dim.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isSelected ? theme.primary.opacity(0.5) : theme.dim.opacity(0.15),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var confirmButton: some View {
        CRTButton(
            "SPAWN POLECAT",
            variant: .primary,
            size: .large,
            isLoading: isSpawning
        ) {
            guard let rig = selectedRig else { return }
            Task { await spawnAgent(rig: rig) }
        }
        .frame(maxWidth: .infinity)
        .disabled(selectedRig == nil || isSpawning)
    }

    // MARK: - Data Loading

    private func loadRigs() async {
        isLoading = true
        errorMessage = nil

        do {
            let agents = try await apiClient.getAgents()
            let rigs = Set(agents.compactMap { $0.rig })
            availableRigs = rigs.sorted()

            // Auto-select if only one rig
            if availableRigs.count == 1 {
                selectedRig = availableRigs.first
            }

            isLoading = false
        } catch {
            errorMessage = "Failed to load rigs: \(error.localizedDescription)"
            isLoading = false
        }
    }

    private func spawnAgent(rig: String) async {
        isSpawning = true
        errorMessage = nil

        do {
            _ = try await apiClient.spawnPolecat(rig: rig)
            isSpawning = false

            #if canImport(UIKit)
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.success)
            #endif

            onSpawned()
            dismiss()
        } catch {
            isSpawning = false
            errorMessage = "Failed to spawn agent: \(error.localizedDescription)"
        }
    }
}

// MARK: - Preview

#Preview("SpawnAgentSheet") {
    SpawnAgentSheet(onSpawned: {})
}
