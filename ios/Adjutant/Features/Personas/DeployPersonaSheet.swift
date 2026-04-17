import SwiftUI
import AdjutantKit

/// Sheet for deploying a persona as a new agent.
/// Shows persona details, project selector, callsign pre-filled with persona name.
struct DeployPersonaSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let persona: Persona
    let onDeployed: () -> Void

    @State private var projects: [Project] = []
    @State private var selectedProject: Project?
    @State private var callsign: String = ""
    @State private var isLoading = true
    @State private var isDeploying = false
    @State private var errorMessage: String?

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
                        onRetry: { Task<Void, Never> { await loadProjects() } },
                        onDismiss: { self.errorMessage = nil }
                    )
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    Spacer()
                } else {
                    deployForm
                }
            }
            .background(theme.background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("DEPLOY \(persona.name.uppercased())", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                    .disabled(isDeploying)
                }
            }
        }
        .task {
            callsign = persona.name.lowercased()
            await loadProjects()
        }
    }

    // MARK: - Deploy Form

    private var deployForm: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: CRTTheme.Spacing.lg) {
                    // Persona info
                    personaInfoSection

                    // Callsign
                    callsignSection

                    // Project selection
                    projectSection
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
            }

            // Deploy button
            deployButton
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
        }
    }

    // MARK: - Persona Info

    private var personaInfoSection: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            TraitRadarChart(traits: persona.traits, size: 60)

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text("\u{25C7}")
                        .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                        .foregroundColor(theme.primary)
                    Text(persona.name.uppercased())
                        .font(CRTTheme.Typography.font(size: 16, weight: .bold))
                        .tracking(CRTTheme.Typography.letterSpacing)
                        .foregroundColor(theme.primary)
                }

                if !persona.description.isEmpty {
                    Text(persona.description)
                        .font(CRTTheme.Typography.font(size: 12))
                        .foregroundColor(theme.dim)
                }

                Text("\(persona.traits.totalPoints)/\(TraitValues.pointBudget) PTS")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(theme.dim)
            }

            Spacer()
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.background.panel.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.sm)
    }

    // MARK: - Callsign Section

    private var callsignSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("CALLSIGN", style: .caption, glowIntensity: .subtle, color: theme.dim)

            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: "person.text.rectangle")
                    .font(.system(size: 16))
                    .foregroundColor(theme.primary)

                TextField("", text: $callsign)
                    .textFieldStyle(.plain)
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .disableAutocorrection(true)
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
    }

    // MARK: - Project Section

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("PROJECT", style: .caption, glowIntensity: .subtle, color: theme.dim)

            if projects.isEmpty {
                HStack(spacing: CRTTheme.Spacing.sm) {
                    Image(systemName: "folder.badge.questionmark")
                        .font(.system(size: 16))
                        .foregroundColor(theme.dim)
                    CRTText("NO PROJECTS FOUND", style: .body, glowIntensity: .subtle, color: theme.dim)
                }
                .padding(.vertical, CRTTheme.Spacing.md)
                .frame(maxWidth: .infinity)
            } else {
                LazyVStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(projects) { project in
                        projectRow(project)
                    }
                }
            }
        }
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
                Image(systemName: "folder.fill")
                    .font(.system(size: 14))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)

                VStack(alignment: .leading, spacing: 2) {
                    CRTText(
                        project.name.uppercased(),
                        style: .body,
                        glowIntensity: isSelected ? .medium : .subtle,
                        color: isSelected ? theme.primary : theme.dim
                    )
                }

                Spacer()

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

    // MARK: - Deploy Button

    private var deployButton: some View {
        CRTButton(
            isDeploying ? "DEPLOYING \(persona.name.uppercased())..." : "DEPLOY \(persona.name.uppercased())",
            variant: .primary,
            size: .large,
            isLoading: isDeploying
        ) {
            guard let project = selectedProject else { return }
            Task<Void, Never> { await deploy(project: project) }
        }
        .frame(maxWidth: .infinity)
        .disabled(selectedProject == nil || callsign.isEmpty || isDeploying)
    }

    // MARK: - Data Loading

    private func loadProjects() async {
        isLoading = true
        errorMessage = nil

        do {
            let fetchedProjects = try await apiClient.getProjects()
            projects = fetchedProjects

            // Auto-select from AppState or fallback to first project
            if let selected = AppState.shared.selectedProject,
               projects.contains(where: { $0.id == selected.id }) {
                selectedProject = selected
            } else if projects.count == 1 {
                selectedProject = projects.first
            }

            isLoading = false
        } catch {
            errorMessage = "Failed to load projects: \(error.localizedDescription)"
            isLoading = false
        }
    }

    private func deploy(project: Project) async {
        isDeploying = true
        errorMessage = nil

        do {
            // Use the persona name as callsign, pass personaId for prompt injection
            let _ = try await apiClient.spawnAgent(
                projectId: project.id,
                callsign: callsign.isEmpty ? nil : callsign,
                personaId: persona.id
            )
            dismiss()
            onDeployed()
        } catch {
            isDeploying = false
            errorMessage = "Failed to deploy: \(error.localizedDescription)"
        }
    }
}

// MARK: - Preview

#Preview("DeployPersonaSheet") {
    let persona = Persona(
        id: "1", name: "Sentinel",
        description: "QA specialist with deep testing focus",
        traits: TraitValues(qaCorrectness: 18, testingUnit: 16, testingAcceptance: 14),
        createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z"
    )

    DeployPersonaSheet(persona: persona, onDeployed: {})
}
