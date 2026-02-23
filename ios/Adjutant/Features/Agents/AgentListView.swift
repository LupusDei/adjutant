import SwiftUI
import AdjutantKit

/// Main agent list view showing all agents organized hierarchically.
/// Features search, rig filtering, and navigation to detail views.
struct AgentListView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: AgentListViewModel
    @State private var showingRigPicker = false
    @State private var showingSpawnSheet = false

    /// Callback when an agent is selected
    var onSelectMember: ((CrewMember) -> Void)?

    init(apiClient: APIClient, onSelectMember: ((CrewMember) -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: AgentListViewModel(apiClient: apiClient))
        self.onSelectMember = onSelectMember
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView

            // Filter bar
            filterBar

            // Content
            contentView
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .sheet(isPresented: $showingRigPicker) {
            rigPickerSheet
        }
        .sheet(isPresented: $showingSpawnSheet) {
            SpawnAgentSheet {
                Task { await viewModel.refresh() }
            }
        }
    }

    // MARK: - Subviews

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("AGENTS", style: .subheader, glowIntensity: .medium)
                CRTText("\(viewModel.displayedCount) AGENTS", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            Spacer()

            // Spawn button
            Button {
                showingSpawnSheet = true
            } label: {
                Image(systemName: "plus.circle")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.primary)
            }
            .accessibilityLabel("Spawn agent")

            // Refresh button
            Button {
                Task { await viewModel.refresh() }
            } label: {
                if viewModel.isLoading {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(theme.primary)
                }
            }
            .disabled(viewModel.isLoading)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            CRTTheme.Background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
    }

    private var filterBar: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            // Search field
            HStack(spacing: CRTTheme.Spacing.xs) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundColor(theme.dim)

                TextField("", text: $viewModel.searchText)
                    .textFieldStyle(.plain)
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .disableAutocorrection(true)
                    .placeholder(when: viewModel.searchText.isEmpty) {
                        Text("Search by name...")
                            .font(CRTTheme.Typography.font(size: 14))
                            .foregroundColor(theme.dim.opacity(0.5))
                    }

                if !viewModel.searchText.isEmpty {
                    Button {
                        viewModel.searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(theme.dim)
                    }
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(CRTTheme.Background.elevated)
            .cornerRadius(CRTTheme.CornerRadius.sm)
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(0.3), lineWidth: 1)
            )

            // Status filter chips
            statusFilterBar

            // Rig filter button
            HStack {
                Button {
                    showingRigPicker = true
                } label: {
                    HStack(spacing: CRTTheme.Spacing.xxs) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                            .font(.system(size: 12))

                        if let rig = viewModel.selectedRig {
                            CRTText(rig.uppercased(), style: .caption, glowIntensity: .subtle)
                        } else {
                            CRTText("ALL RIGS", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        }
                    }
                    .foregroundColor(viewModel.selectedRig != nil ? theme.primary : theme.dim)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xxs)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .fill(viewModel.selectedRig != nil ? theme.primary.opacity(0.15) : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .stroke(viewModel.selectedRig != nil ? theme.primary.opacity(0.5) : theme.dim.opacity(0.3), lineWidth: 1)
                    )
                }

                Spacer()

                if viewModel.hasActiveFilters {
                    Button {
                        viewModel.clearFilters()
                    } label: {
                        CRTText("CLEAR", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    }
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.panel.opacity(0.5))
    }

    // MARK: - Status Filter Bar

    private var statusFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                // ALL chip
                statusFilterChip(label: "ALL", count: viewModel.allCrewMembers.count, isSelected: viewModel.selectedStatus == nil) {
                    viewModel.selectedStatus = nil
                }

                // Per-status chips
                ForEach(statusFilterOptions, id: \.status) { option in
                    statusFilterChip(
                        label: option.label,
                        count: viewModel.statusCounts[option.status] ?? 0,
                        isSelected: viewModel.selectedStatus == option.status,
                        dotColor: option.color
                    ) {
                        if viewModel.selectedStatus == option.status {
                            viewModel.selectedStatus = nil
                        } else {
                            viewModel.selectedStatus = option.status
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    /// Status filter options with display metadata
    private var statusFilterOptions: [(status: CrewMemberStatus, label: String, color: Color)] {
        [
            (.working, "WORKING", CRTTheme.State.success),
            (.idle, "IDLE", CRTTheme.State.info),
            (.blocked, "BLOCKED", CRTTheme.State.warning),
            (.offline, "OFFLINE", CRTTheme.State.offline),
        ]
    }

    private func statusFilterChip(
        label: String,
        count: Int,
        isSelected: Bool,
        dotColor: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                if let dotColor {
                    Circle()
                        .fill(dotColor)
                        .frame(width: 6, height: 6)
                }

                Text(label)
                    .font(CRTTheme.Typography.font(size: 10, weight: isSelected ? .bold : .medium))
                    .tracking(CRTTheme.Typography.letterSpacing)

                Text("\(count)")
                    .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                    .opacity(0.7)
            }
            .foregroundColor(isSelected ? theme.primary : theme.dim)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? theme.primary.opacity(0.15) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        isSelected ? theme.primary.opacity(0.6) : theme.dim.opacity(0.2),
                        lineWidth: 1
                    )
            )
            .crtGlow(color: theme.primary, radius: isSelected ? 3 : 0, intensity: isSelected ? 0.3 : 0)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.allCrewMembers.isEmpty {
            loadingView
        } else if viewModel.groupedCrewMembers.isEmpty {
            emptyView
        } else {
            agentList
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("LOADING AGENTS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "person.3")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            if viewModel.hasActiveFilters {
                CRTText("NO MATCHING AGENTS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText("Try adjusting your search or filters.",
                        style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))

                Button {
                    viewModel.clearFilters()
                } label: {
                    CRTText("CLEAR FILTERS", style: .caption, glowIntensity: .medium)
                        .padding(.horizontal, CRTTheme.Spacing.md)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(theme.primary.opacity(0.15))
                        .cornerRadius(CRTTheme.CornerRadius.sm)
                        .overlay(
                            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                                .stroke(theme.primary.opacity(0.5), lineWidth: 1)
                        )
                }
                .padding(.top, CRTTheme.Spacing.sm)
            } else {
                CRTText("NO AGENTS FOUND", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                CRTText(
                    AppState.shared.deploymentMode == .gastown
                        ? "Gas Town appears to be empty."
                        : "No active agent sessions. Start an agent from the Projects tab.",
                    style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6)
                )
            }
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var agentList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.md, pinnedViews: .sectionHeaders) {
                ForEach(viewModel.groupedCrewMembers) { group in
                    Section {
                        ForEach(group.members) { member in
                            AgentRowView(member: member) {
                                onSelectMember?(member)
                            }
                        }
                    } header: {
                        sectionHeader(for: group)
                    }
                }

                // Error banner
                if let error = viewModel.errorMessage {
                    ErrorBanner(
                        message: error,
                        onRetry: {
                            Task { await viewModel.refresh() }
                        },
                        onDismiss: { viewModel.clearError() }
                    )
                    .padding(.horizontal)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    private func sectionHeader(for group: AgentListViewModel.AgentTypeGroup) -> some View {
        HStack {
            CRTText(group.displayName, style: .caption, glowIntensity: .subtle, color: theme.dim)

            Rectangle()
                .fill(theme.dim.opacity(0.3))
                .frame(height: 1)

            CRTText("\(group.members.count)", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
        .padding(.horizontal, CRTTheme.Spacing.xxs)
        .background(CRTTheme.Background.screen)
    }

    private var rigPickerSheet: some View {
        NavigationView {
            List {
                Button {
                    viewModel.selectedRig = nil
                    showingRigPicker = false
                } label: {
                    HStack {
                        Text("All Rigs")
                            .foregroundColor(theme.primary)
                        Spacer()
                        if viewModel.selectedRig == nil {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.primary)
                        }
                    }
                }

                ForEach(viewModel.availableRigs, id: \.self) { rig in
                    Button {
                        viewModel.selectedRig = rig
                        showingRigPicker = false
                    } label: {
                        HStack {
                            Text(rig)
                                .foregroundColor(theme.primary)
                            Spacer()
                            if viewModel.selectedRig == rig {
                                Image(systemName: "checkmark")
                                    .foregroundColor(theme.primary)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .background(CRTTheme.Background.screen)
            .navigationTitle("Filter by Rig")
            #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showingRigPicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Placeholder Modifier

extension View {
    func placeholder<Content: View>(
        when shouldShow: Bool,
        alignment: Alignment = .leading,
        @ViewBuilder placeholder: () -> Content
    ) -> some View {
        ZStack(alignment: alignment) {
            placeholder().opacity(shouldShow ? 1 : 0)
            self
        }
    }
}

// MARK: - Preview

#Preview("AgentListView") {
    let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:3000")!)
    let apiClient = APIClient(configuration: config)

    return AgentListView(apiClient: apiClient) { member in
        print("Selected: \(member.name)")
    }
}

#Preview("AgentListView Blue Theme") {
    let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:3000")!)
    let apiClient = APIClient(configuration: config)

    return AgentListView(apiClient: apiClient)
        .crtTheme(.blue)
}
