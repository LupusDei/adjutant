import SwiftUI
import AdjutantKit

/// CRT-themed sheet for spawning a new agent.
/// Shows project selector, random callsign name (tap to change), and dynamic spawn button.
struct SpawnAgentSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var coordinator: AppCoordinator

    /// Callback when spawn completes successfully
    let onSpawned: () -> Void

    @State private var projects: [Project] = []
    @State private var callsigns: [Callsign] = []
    @State private var selectedProject: Project?
    @State private var agentName: String = ""
    @State private var isEditing = false
    @State private var isLoading = true
    @State private var isSpawning = false
    @State private var errorMessage: String?
    @State private var showingCallsignPicker = false

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoading {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("INITIALIZING...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if let errorMessage {
                    Spacer()
                    ErrorBanner(
                        message: errorMessage,
                        onRetry: { Task { await loadData() } },
                        onDismiss: { self.errorMessage = nil }
                    )
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    Spacer()
                } else {
                    spawnForm
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
            await loadData()
        }
        .sheet(isPresented: $showingCallsignPicker) {
            CallsignPickerView { name in
                agentName = name
            }
        }
    }

    // MARK: - Spawn Form

    private var spawnForm: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: CRTTheme.Spacing.lg) {
                    // Agent name (first - most important choice)
                    nameSection

                    // Project selection
                    projectSection
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
            }

            // Spawn button
            spawnButton
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
        }
    }

    // MARK: - Project Section

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("PROJECT", style: .caption, glowIntensity: .subtle, color: theme.dim)

            if projects.isEmpty {
                emptyProjectsState
            } else {
                LazyVStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(projects) { project in
                        projectRow(project)
                    }
                }
            }
        }
    }

    private var emptyProjectsState: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 16))
                .foregroundColor(theme.dim)
            CRTText("NO PROJECTS FOUND", style: .body, glowIntensity: .subtle, color: theme.dim)
        }
        .padding(.vertical, CRTTheme.Spacing.md)
        .frame(maxWidth: .infinity)
    }

    private func projectRow(_ project: Project) -> some View {
        let isSelected = selectedProject?.id == project.id

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedProject = project
            }
            #if canImport(UIKit)
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            #endif
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Project icon
                Image(systemName: "folder.fill")
                    .font(.system(size: 14))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)

                // Project name
                VStack(alignment: .leading, spacing: 2) {
                    CRTText(
                        project.name.uppercased(),
                        style: .body,
                        glowIntensity: isSelected ? .medium : .subtle,
                        color: isSelected ? theme.primary : theme.dim
                    )

                    if let remote = project.gitRemote, !remote.isEmpty {
                        Text(remote)
                            .font(CRTTheme.Typography.font(size: 10))
                            .foregroundColor(theme.dim.opacity(0.5))
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Active indicator
                if project.active {
                    CRTText("ACTIVE", style: .caption, glowIntensity: .subtle, color: CRTTheme.State.success)
                }

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

    // MARK: - Name Section

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("CALLSIGN", style: .caption, glowIntensity: .subtle, color: theme.dim)

            Button {
                showingCallsignPicker = true
            } label: {
                HStack(spacing: CRTTheme.Spacing.sm) {
                    Image(systemName: "person.text.rectangle")
                        .font(.system(size: 16))
                        .foregroundColor(theme.primary)

                    CRTText(
                        agentName.isEmpty ? "SELECT CALLSIGN" : agentName.uppercased(),
                        style: .body,
                        glowIntensity: .medium,
                        color: agentName.isEmpty ? theme.dim : theme.primary
                    )

                    Spacer()

                    // Tap to change hint
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 10))
                        CRTText("TAP TO CHANGE", style: .caption, glowIntensity: .subtle, color: theme.dim.opacity(0.6))
                    }
                    .foregroundColor(theme.dim.opacity(0.6))
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.primary.opacity(0.08))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Spawn Button

    private var spawnButton: some View {
        CRTButton(
            agentName.isEmpty ? "SPAWN AGENT" : "SPAWN \(agentName.uppercased())",
            variant: .primary,
            size: .large,
            isLoading: isSpawning
        ) {
            guard let project = selectedProject else { return }
            Task { await spawnAgent(project: project) }
        }
        .frame(maxWidth: .infinity)
        .disabled(selectedProject == nil || agentName.isEmpty || isSpawning)
    }

    // MARK: - Data Loading

    private func loadData() async {
        isLoading = true
        errorMessage = nil

        do {
            async let projectsFetch = apiClient.getProjects()
            async let callsignsFetch = apiClient.getCallsigns()

            let (fetchedProjects, fetchedCallsigns) = try await (projectsFetch, callsignsFetch)
            projects = fetchedProjects
            callsigns = fetchedCallsigns

            // Auto-select active project
            if let active = projects.first(where: { $0.active }) {
                selectedProject = active
            } else if projects.count == 1 {
                selectedProject = projects.first
            }

            // Pick a random available callsign
            let available = callsigns.filter { $0.available }
            if let random = available.randomElement() {
                agentName = random.name
            }

            isLoading = false
        } catch {
            errorMessage = "Failed to load: \(error.localizedDescription)"
            isLoading = false
        }
    }

    private func spawnAgent(project: Project) async {
        isSpawning = true
        errorMessage = nil

        do {
            let response = try await apiClient.spawnPolecat(projectPath: project.path, callsign: agentName.isEmpty ? nil : agentName)
            isSpawning = false

            #if canImport(UIKit)
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.success)
            #endif

            onSpawned()

            // Navigate to chat with the spawned agent
            let chatAgentId = response.callsign ?? agentName
            if !chatAgentId.isEmpty {
                coordinator.pendingChatAgentId = chatAgentId
                coordinator.selectTab(.chat)
            }

            dismiss()
        } catch {
            isSpawning = false
            errorMessage = "Failed to spawn: \(error.localizedDescription)"
        }
    }
}

// MARK: - Preview

#Preview("SpawnAgentSheet") {
    SpawnAgentSheet(onSpawned: {})
        .environmentObject(AppCoordinator())
}
