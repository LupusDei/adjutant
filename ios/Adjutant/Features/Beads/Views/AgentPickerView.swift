import SwiftUI
import AdjutantKit

/// CRT-themed sheet for selecting an agent to assign a bead to.
/// Shows all agents sorted by status (working/idle first, offline dimmed).
struct AgentPickerView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let onSelect: (CrewMember) -> Void

    @State private var agents: [CrewMember] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoading {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("SCANNING AGENTS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if let errorMessage {
                    Spacer()
                    ErrorBanner(
                        message: errorMessage,
                        onRetry: { Task { await loadAgents() } },
                        onDismiss: { self.errorMessage = nil }
                    )
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    Spacer()
                } else if agents.isEmpty {
                    Spacer()
                    CRTText("NO AGENTS AVAILABLE", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                    Spacer()
                } else {
                    agentList
                }
            }
            .background(CRTTheme.Background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("SELECT AGENT", style: .subheader, glowIntensity: .medium)
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
            await loadAgents()
        }
    }

    // MARK: - Agent List

    private var sortedAgents: [CrewMember] {
        agents.sorted { a, b in
            let aOnline = a.status != .offline
            let bOnline = b.status != .offline
            if aOnline != bOnline { return aOnline }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    private var agentList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.xs) {
                ForEach(sortedAgents) { agent in
                    agentRow(agent)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
    }

    private func agentRow(_ agent: CrewMember) -> some View {
        let isOnline = agent.status != .offline

        return Button {
            guard isOnline else { return }
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onSelect(agent)
            dismiss()
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status dot
                StatusDot(
                    isOnline ? (agent.status == .working ? .info : .success) : .offline,
                    pulse: agent.status == .working
                )

                // Agent name
                VStack(alignment: .leading, spacing: 2) {
                    CRTText(
                        agent.name.uppercased(),
                        style: .body,
                        glowIntensity: isOnline ? .medium : .subtle,
                        color: isOnline ? theme.primary : theme.dim.opacity(0.4)
                    )

                    if let task = agent.currentTask, isOnline {
                        CRTText(
                            task,
                            style: .caption,
                            glowIntensity: .subtle,
                            color: theme.dim
                        )
                        .lineLimit(1)
                    }
                }

                Spacer()

                // Type badge
                BadgeView(
                    agent.type.rawValue.uppercased(),
                    style: .tag
                )
                .opacity(isOnline ? 1.0 : 0.4)

                // Status label
                CRTText(
                    statusLabel(agent.status),
                    style: .caption,
                    glowIntensity: .subtle,
                    color: isOnline ? statusColor(agent.status) : theme.dim.opacity(0.4)
                )
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isOnline ? theme.dim.opacity(0.05) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isOnline ? theme.primary.opacity(0.15) : theme.dim.opacity(0.08),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!isOnline)
    }

    // MARK: - Helpers

    private func statusLabel(_ status: CrewMemberStatus) -> String {
        switch status {
        case .working: return "WORKING"
        case .idle: return "IDLE"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }

    private func statusColor(_ status: CrewMemberStatus) -> Color {
        switch status {
        case .working: return CRTTheme.State.info
        case .idle: return CRTTheme.State.success
        case .blocked: return CRTTheme.State.warning
        case .stuck: return CRTTheme.State.error
        case .offline: return CRTTheme.State.offline
        }
    }

    private func loadAgents() async {
        isLoading = true
        errorMessage = nil

        do {
            agents = try await apiClient.getAgents()
            isLoading = false
        } catch {
            errorMessage = "Failed to load agents: \(error.localizedDescription)"
            isLoading = false
        }
    }
}
