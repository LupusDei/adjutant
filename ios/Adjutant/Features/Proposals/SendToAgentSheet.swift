import SwiftUI
import AdjutantKit

/// Sheet for choosing how to send an accepted proposal to an agent.
/// Two paths: pick an existing active agent, or spawn a new one.
struct SendToAgentSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var coordinator: AppCoordinator

    let proposal: Proposal
    let onSent: (String) -> Void

    enum Tab: String, CaseIterable {
        case existing = "EXISTING AGENT"
        case spawn = "SPAWN NEW"
    }

    @State private var selectedTab: Tab = .existing
    @State private var agents: [CrewMember] = []
    @State private var selectedAgent: String?
    @State private var isLoadingAgents = true

    // Spawn tab state
    @State private var projects: [Project] = []
    @State private var callsigns: [Callsign] = []
    @State private var selectedProject: Project?
    @State private var callsign: String = ""
    @State private var showingCallsignPicker = false

    @State private var isSending = false
    @State private var errorMessage: String?

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                proposalSummary
                tabBar
                content
                if let errorMessage {
                    errorBanner(errorMessage)
                }
                actionBar
            }
            .background(CRTTheme.Background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SEND TO AGENT", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                    .disabled(isSending)
                }
            }
        }
        .task {
            await loadAgents()
            await loadSpawnData()
        }
        .sheet(isPresented: $showingCallsignPicker) {
            CallsignPickerView { name in
                callsign = name
            }
        }
    }

    // MARK: - Proposal Summary

    private var proposalSummary: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTText(
                proposal.title.uppercased(),
                style: .body,
                glowIntensity: .subtle
            )
            .lineLimit(1)

            Spacer()

            let badgeColor = proposal.type == .product ? CRTTheme.State.success : CRTTheme.State.warning
            Text(proposal.type.rawValue.uppercased())
                .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(badgeColor)
                .padding(.horizontal, CRTTheme.Spacing.xs)
                .padding(.vertical, 2)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(badgeColor.opacity(0.5), lineWidth: 1)
                )
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.dim.opacity(0.05))
    }

    // MARK: - Tab Bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        selectedTab = tab
                    }
                } label: {
                    VStack(spacing: 4) {
                        CRTText(
                            tab.rawValue,
                            style: .caption,
                            glowIntensity: selectedTab == tab ? .medium : .none,
                            color: selectedTab == tab ? theme.primary : theme.dim
                        )
                        Rectangle()
                            .fill(selectedTab == tab ? theme.primary : Color.clear)
                            .frame(height: 2)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        ScrollView {
            switch selectedTab {
            case .existing:
                existingAgentList
            case .spawn:
                spawnForm
            }
        }
        .frame(minHeight: 200)
    }

    // MARK: - Existing Agent List

    private var existingAgentList: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            if isLoadingAgents {
                LoadingIndicator(size: .small)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else if agents.isEmpty {
                CRTText("NO ACTIVE AGENTS FOUND", style: .body, glowIntensity: .subtle, color: theme.dim)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                ForEach(agents) { agent in
                    agentRow(agent)
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
    }

    private func agentRow(_ agent: CrewMember) -> some View {
        let isSelected = selectedAgent == agent.name
        let statusColor = agentStatusColor(agent.status)

        return Button {
            withAnimation(.easeInOut(duration: 0.1)) {
                selectedAgent = agent.name
            }
            #if canImport(UIKit)
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            #endif
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)
                    .crtGlow(color: statusColor, radius: 3, intensity: 0.4)

                CRTText(
                    agent.name.uppercased(),
                    style: .body,
                    glowIntensity: isSelected ? .medium : .subtle,
                    color: isSelected ? theme.primary : theme.dim
                )

                CRTText(
                    agent.status.rawValue.uppercased(),
                    style: .caption,
                    glowIntensity: .none,
                    color: statusColor
                )

                Spacer()

                if let task = agent.currentTask, !task.isEmpty {
                    Text(task.count > 25 ? String(task.prefix(25)) + "..." : task)
                        .font(CRTTheme.Typography.font(size: 9))
                        .foregroundColor(theme.dim.opacity(0.6))
                        .lineLimit(1)
                }

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(theme.primary)
                }
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? theme.primary.opacity(0.1) : theme.dim.opacity(0.03))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isSelected ? theme.primary.opacity(0.5) : theme.dim.opacity(0.1),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Spawn Form

    private var spawnForm: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.lg) {
            // Callsign
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
                            callsign.isEmpty ? "SELECT CALLSIGN" : callsign.uppercased(),
                            style: .body,
                            glowIntensity: .medium,
                            color: callsign.isEmpty ? theme.dim : theme.primary
                        )

                        Spacer()

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

            // Project
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("PROJECT", style: .caption, glowIntensity: .subtle, color: theme.dim)

                if projects.isEmpty {
                    CRTText("NO PROJECTS FOUND", style: .body, glowIntensity: .subtle, color: theme.dim)
                        .padding(.vertical, CRTTheme.Spacing.md)
                        .frame(maxWidth: .infinity)
                } else {
                    ForEach(projects) { project in
                        projectRow(project)
                    }
                }
            }

            CRTText(
                "A new agent will be spawned and given this proposal as its initial task.",
                style: .caption,
                glowIntensity: .subtle,
                color: theme.dim.opacity(0.7)
            )
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.md)
    }

    private func projectRow(_ project: Project) -> some View {
        let isSelected = selectedProject?.id == project.id

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedProject = project
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 14))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)

                CRTText(
                    project.name.uppercased(),
                    style: .body,
                    glowIntensity: isSelected ? .medium : .subtle,
                    color: isSelected ? theme.primary : theme.dim
                )

                Spacer()

                if project.active {
                    CRTText("ACTIVE", style: .caption, glowIntensity: .subtle, color: CRTTheme.State.success)
                }

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
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

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
            Text("ERROR: \(message)")
                .font(CRTTheme.Typography.font(size: 11))
        }
        .foregroundColor(CRTTheme.State.error)
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            Spacer()
            CRTButton(
                actionButtonLabel,
                variant: .primary,
                size: .large,
                isLoading: isSending
            ) {
                Task<Void, Never> { await handleSend() }
            }
            .disabled(!canSend || isSending)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.md)
    }

    private var actionButtonLabel: String {
        switch selectedTab {
        case .existing:
            return "SEND MESSAGE"
        case .spawn:
            return callsign.isEmpty ? "SPAWN & SEND" : "SPAWN \(callsign.uppercased()) & SEND"
        }
    }

    private var canSend: Bool {
        switch selectedTab {
        case .existing:
            return selectedAgent != nil
        case .spawn:
            return selectedProject != nil && !callsign.isEmpty
        }
    }

    // MARK: - Data Loading

    private func loadAgents() async {
        isLoadingAgents = true
        do {
            let all = try await apiClient.getAgents()
            agents = all.filter { $0.status != .offline }
            isLoadingAgents = false
        } catch {
            agents = []
            isLoadingAgents = false
        }
    }

    private func loadSpawnData() async {
        do {
            async let projectsFetch = apiClient.getProjects()
            async let callsignsFetch = apiClient.getCallsigns()

            let (fetchedProjects, fetchedCallsigns) = try await (projectsFetch, callsignsFetch)
            projects = fetchedProjects
            callsigns = fetchedCallsigns

            if let active = projects.first(where: { $0.active }) {
                selectedProject = active
            } else if projects.count == 1 {
                selectedProject = projects.first
            }

            let available = callsigns.filter { $0.available }
            if let random = available.randomElement() {
                callsign = random.name
            }
        } catch {
            // Non-critical — spawn tab still usable if projects loaded
        }
    }

    // MARK: - Actions

    private func handleSend() async {
        isSending = true
        errorMessage = nil

        do {
            switch selectedTab {
            case .existing:
                guard let agentName = selectedAgent else { return }
                let prompt = buildProposalPrompt()
                _ = try await apiClient.sendChatMessage(
                    agentId: agentName,
                    body: prompt,
                    threadId: "proposal-\(proposal.id)"
                )

                #if canImport(UIKit)
                let feedback = UINotificationFeedbackGenerator()
                feedback.notificationOccurred(.success)
                #endif

                isSending = false
                onSent(agentName)

                // Navigate to chat with the agent
                coordinator.pendingChatAgentId = agentName
                coordinator.selectTab(.chat)
                dismiss()

            case .spawn:
                guard let project = selectedProject else { return }
                let session = try await apiClient.createSession(
                    CreateSessionRequest(
                        name: callsign.isEmpty ? nil : callsign,
                        projectPath: project.path,
                        mode: "swarm",
                        workspaceType: "primary"
                    )
                )

                // Wait for agent to initialize, then send proposal
                let prompt = buildProposalPrompt()
                try await Task.sleep(nanoseconds: 3_000_000_000)

                do {
                    _ = try await apiClient.sendSessionInput(id: session.id, text: prompt)
                } catch {
                    _ = try await apiClient.sendChatMessage(
                        agentId: session.name,
                        body: prompt,
                        threadId: "proposal-\(proposal.id)"
                    )
                }

                #if canImport(UIKit)
                let feedback = UINotificationFeedbackGenerator()
                feedback.notificationOccurred(.success)
                #endif

                isSending = false
                onSent(session.name)

                coordinator.pendingChatAgentId = session.name
                coordinator.selectTab(.chat)
                dismiss()
            }
        } catch {
            isSending = false
            errorMessage = error.localizedDescription
        }
    }

    private func buildProposalPrompt() -> String {
        """
        ## Proposal: \(proposal.title)

        **Type:** \(proposal.type.rawValue)
        **Author:** \(proposal.author)
        **Status:** \(proposal.status.rawValue)

        ### Description

        \(proposal.description)

        ---

        Please use /speckit.specify to create a feature specification from this proposal, then /speckit.plan to generate an implementation plan, and /speckit.beads to create executable beads for orchestration.
        """
    }

    // MARK: - Helpers

    private func agentStatusColor(_ status: CrewMemberStatus) -> Color {
        switch status {
        case .working:
            return CRTTheme.State.success
        case .idle:
            return CRTTheme.State.info
        case .blocked, .stuck:
            return CRTTheme.State.warning
        case .offline:
            return CRTTheme.State.error
        }
    }
}

// MARK: - Preview

#Preview("SendToAgentSheet") {
    SendToAgentSheet(
        proposal: Proposal(
            id: "test-1",
            author: "test-agent",
            title: "Improve UX",
            description: "Add onboarding flow",
            type: .product,
            status: .accepted,
            createdAt: "2026-02-24T00:00:00Z",
            updatedAt: "2026-02-24T01:00:00Z"
        ),
        onSent: { _ in }
    )
    .environmentObject(AppCoordinator())
}
