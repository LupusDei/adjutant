import SwiftUI
import AdjutantKit

/// Channel membership roster + add-agent picker (adj-4wrro).
///
/// Presented from the ``ChannelView`` header's members button. Two sections,
/// Pip-Boy themed to match ``CreateChannelSheet``:
///
///  1. **MEMBERS** — the channel's current roster (`viewModel.members`), each
///     row showing the member id, kind (USER / AGENT), and role.
///  2. **ADD AGENT** — agents not already in the channel; tapping one calls
///     ``ChannelViewModel/addMember(agentId:)``, which joins them as an agent
///     and reloads the roster. The picker is searchable and re-filters as the
///     roster grows, so a just-added agent drops out of the list immediately.
struct ChannelMembersSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ChannelViewModel

    let channel: Channel

    /// API client used to fetch the spawnable agent roster. Defaults to the app
    /// singleton; injectable for previews/tests.
    var apiClient: APIClient = AppState.shared.apiClient

    @State private var allAgents: [CrewMember] = []
    @State private var searchText = ""
    @State private var isAddingId: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                membersSection
                Divider().background(theme.dim.opacity(0.3))
                addAgentSection
            }
            .background(theme.background.screen)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("#\(channel.displayTitle) MEMBERS", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.primary)
                }
            }
        }
        .task {
            await viewModel.loadMembers()
            await loadAgents()
        }
    }

    // MARK: - Current members

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("MEMBERS — \(viewModel.members.count)")
            if viewModel.members.isEmpty {
                CRTText("No members loaded.", style: .caption, glowIntensity: .none, color: theme.dim)
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    .padding(.vertical, CRTTheme.Spacing.sm)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.members) { member in
                            memberRow(member)
                            if member.id != viewModel.members.last?.id {
                                Divider().background(theme.dim.opacity(0.3))
                            }
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
    }

    @ViewBuilder
    private func memberRow(_ member: ChannelMember) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: member.memberKind == .user ? "person.fill" : "cpu")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(theme.dim)
                .frame(width: 22)
            CRTText(member.memberId.uppercased(), style: .body, glowIntensity: .subtle)
            Spacer()
            CRTText(member.role.uppercased(), style: .caption, glowIntensity: .none, color: theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
    }

    // MARK: - Add agent

    /// Agents eligible to add: not already a member and not the operator. The
    /// roster is the source of truth, so a member set rebuilt from
    /// `viewModel.members` keeps this in sync after each add.
    private var addableAgents: [CrewMember] {
        let memberIds = Set(viewModel.members.map(\.memberId))
        let base = allAgents.filter { agent in
            agent.id != ChannelViewModel.userMemberId && !memberIds.contains(agent.id)
        }
        guard !searchText.isEmpty else { return base }
        let query = searchText.lowercased()
        return base.filter { $0.id.lowercased().contains(query) || $0.name.lowercased().contains(query) }
    }

    private var addAgentSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("ADD AGENT")
            CRTTextField("Search agents...", text: $searchText, icon: "magnifyingglass")
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.top, CRTTheme.Spacing.sm)

            if addableAgents.isEmpty {
                CRTText("No agents available to add.", style: .caption, glowIntensity: .none, color: theme.dim)
                    .padding(CRTTheme.Spacing.md)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(addableAgents) { agent in
                            addAgentRow(agent)
                            if agent.id != addableAgents.last?.id {
                                Divider().background(theme.dim.opacity(0.3))
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func addAgentRow(_ agent: CrewMember) -> some View {
        Button {
            addAgent(agent)
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: "cpu")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(theme.dim)
                    .frame(width: 22)
                CRTText(agent.name.uppercased(), style: .body, glowIntensity: .subtle)
                Spacer()
                if isAddingId == agent.id {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(theme.primary)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isAddingId != nil)
        .accessibilityLabel("Add \(agent.name)")
    }

    // MARK: - Helpers

    private func sectionHeader(_ text: String) -> some View {
        CRTText(text, style: .caption, glowIntensity: .subtle, color: theme.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .background(theme.background.panel)
    }

    private func addAgent(_ agent: CrewMember) {
        isAddingId = agent.id
        Task<Void, Never> {
            await viewModel.addMember(agentId: agent.id)
            isAddingId = nil
        }
    }

    private func loadAgents() async {
        if let agents = try? await apiClient.getAgents() {
            allAgents = agents
        }
    }
}
