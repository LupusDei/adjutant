import SwiftUI
import AdjutantKit

/// View mode for the beads screen: Kanban board, dependency graph, or epics list.
enum BeadsViewMode: String, CaseIterable {
    case kanban = "BOARD"
    case graph = "GRAPH"
    case epics = "EPICS"

    /// SF Symbol icon representing this view mode.
    var iconName: String {
        switch self {
        case .kanban: return "rectangle.split.3x1"
        case .graph: return "point.3.connected.trianglepath.dotted"
        case .epics: return "list.bullet.clipboard"
        }
    }
}

/// Main beads view displaying all beads in a Kanban board with filtering and search.
/// Supports drag-and-drop between columns with optimistic updates.
/// Includes a toggle to switch to the dependency graph view.
struct BeadsListView: View {
    @StateObject private var viewModel = BeadsListViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared
    @Environment(\.crtTheme) private var theme

    // MARK: - View Mode

    @State private var viewMode: BeadsViewMode = .kanban

    // MARK: - Drag & Drop State

    @State private var draggingBeadId: String?
    @State private var targetColumnId: KanbanColumnId?
    @State private var isUpdating = false
    @State private var updateError: String?

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                // Header
                headerView

                // Filter bar (only in kanban mode)
                if viewMode == .kanban {
                    filterBar
                }

                // Content
                content
            }

            // Error toast overlay
            if let error = updateError {
                errorToast(error)
            }

            // Updating indicator overlay
            if isUpdating {
                updatingIndicator
            }
        }
        .background(theme.background.screen)
        .onAppear {
            viewModel.onAppear()
            Task {
                await viewModel.loadBeads()
            }
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Title
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                CRTText("WORK BOARD", style: .header)
                    .crtGlow(color: theme.primary, radius: 4, intensity: 0.4)
            }

            Spacer()

            // View mode toggle (Board / Graph)
            viewModeToggle

            // Sort dropdown (only in kanban mode)
            if viewMode == .kanban {
                SortDropdown(currentSort: $viewModel.currentSort)
            }

            // Count badge (hide in epics mode — epics have their own section counts)
            if viewMode != .epics, viewModel.openCount > 0 {
                BadgeView("\(viewModel.openCount) OPEN", style: .status(.success))
            }

            // Refresh button
            Button {
                Task {
                    await viewModel.refresh()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.primary)
                    .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                    .animation(
                        viewModel.isLoading ?
                            .linear(duration: 1).repeatForever(autoreverses: false) :
                            .default,
                        value: viewModel.isLoading
                    )
            }
            .disabled(viewModel.isLoading)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.panel)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    // MARK: - View Mode Toggle

    /// CRT-styled segmented toggle for switching between Board and Graph views.
    private var viewModeToggle: some View {
        HStack(spacing: 0) {
            ForEach(BeadsViewMode.allCases, id: \.self) { mode in
                Button {
                    withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                        viewMode = mode
                    }
                } label: {
                    Image(systemName: mode.iconName)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(viewMode == mode ? theme.bright : theme.dim)
                        .frame(width: 32, height: 28)
                        .background(
                            viewMode == mode
                                ? theme.primary.opacity(0.15)
                                : Color.clear
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.4), lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.sm)
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            // Top row: Overseer toggle + Source filter (mode-aware)
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Overseer toggle
                overseerToggle

                Spacer()

                // Project source filter
                SourceFilterDropdown(sources: viewModel.beadSources, selectedSource: $viewModel.selectedSource)
            }

            // Search field
            searchField
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.elevated)
    }

    private var overseerToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                appState.isOverseerMode.toggle()
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Image(systemName: appState.isOverseerMode ? "eye" : "eye.slash")
                    .font(.system(size: 12))

                Text("OVERSEER")
                    .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                    .tracking(0.5)
            }
            .foregroundColor(appState.isOverseerMode ? theme.primary : theme.dim)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(appState.isOverseerMode ? theme.primary.opacity(0.15) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(
                        appState.isOverseerMode ? theme.primary : theme.primary.opacity(0.3),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var searchField: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundColor(theme.dim)

            TextField("Search beads...", text: $viewModel.searchText)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()

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
        .background(theme.background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch viewMode {
        case .kanban:
            kanbanContent
        case .graph:
            DependencyGraphView()
        case .epics:
            EpicsContentView()
        }
    }

    @ViewBuilder
    private var kanbanContent: some View {
        if viewModel.isLoading && viewModel.beads.isEmpty {
            loadingView
        } else if let errorMessage = viewModel.errorMessage {
            errorView(errorMessage)
        } else if viewModel.isEmpty {
            emptyView
        } else {
            kanbanBoard
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                .scaleEffect(1.5)
            CRTText("SCANNING BEADS DATABASE...", style: .body, color: theme.dim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.error)
                .crtGlow(color: CRTTheme.State.error, radius: 8, intensity: 0.4)

            CRTText("SCAN FAILED", style: .header, color: CRTTheme.State.error)
            CRTText(message, style: .body, color: theme.dim)

            Button {
                viewModel.clearError()
                Task {
                    await viewModel.refresh()
                }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                    Text("RETRY")
                }
                .font(CRTTheme.Typography.font(size: 14, weight: .medium))
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.lg)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(theme.primary, lineWidth: 1)
                )
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "circle.grid.3x3")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
                .crtGlow(color: theme.primary, radius: 8, intensity: 0.2)

            CRTText("NO BEADS", style: .header, color: theme.dim)
            CRTText(viewModel.emptyStateMessage, style: .body, color: theme.dim.opacity(0.7))

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var kanbanBoard: some View {
        KanbanBoardView(
            beads: filteredBeadsForKanban,
            draggingBeadId: draggingBeadId,
            targetColumnId: targetColumnId,
            onBeadTap: { bead in
                Task { @MainActor in
                    coordinator.navigateReplacingPath(to: .beadDetail(id: bead.id))
                }
            },
            onDrop: { bead, targetColumn in
                Task {
                    await handleDrop(bead: bead, to: targetColumn)
                }
            }
        )
    }

    // MARK: - Drag & Drop Handling

    private func handleDrop(bead: BeadInfo, to targetColumn: KanbanColumnId) async {
        let fromColumn = mapStatusToColumn(bead.status, isSwarm: true)

        // Don't process drop on same column
        guard fromColumn != targetColumn else {
            draggingBeadId = nil
            targetColumnId = nil
            return
        }

        // Clear drag state
        draggingBeadId = nil
        targetColumnId = nil

        // Save previous status for rollback
        let previousStatus = bead.status
        let newStatus = targetColumn.rawValue

        // Optimistic update
        viewModel.updateBeadStatusLocally(beadId: bead.id, newStatus: newStatus)

        // API call
        isUpdating = true
        do {
            let apiClient = AppState.shared.apiClient
            _ = try await apiClient.updateBeadStatus(id: bead.id, status: newStatus)
            isUpdating = false
        } catch {
            // Rollback on error
            viewModel.updateBeadStatusLocally(beadId: bead.id, newStatus: previousStatus)
            isUpdating = false

            // Show error toast (auto-dismiss after 3 seconds)
            updateError = "Failed to update \(bead.id): \(error.localizedDescription)"
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                updateError = nil
            }
        }
    }

    // MARK: - Overlays

    private func errorToast(_ message: String) -> some View {
        VStack {
            Text(message)
                .font(CRTTheme.Typography.font(size: 12))
                .foregroundColor(.white)
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .fill(CRTTheme.State.error.opacity(0.9))
                )
                .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 2)

            Spacer()
        }
        .padding(.top, CRTTheme.Spacing.xs)
        .transition(.move(edge: .top).combined(with: .opacity))
        .animation(.easeInOut(duration: 0.2), value: updateError != nil)
    }

    private var updatingIndicator: some View {
        VStack {
            HStack {
                Spacer()

                Text("UPDATING...")
                    .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                    .foregroundColor(theme.primary)
                    .tracking(1)
                    .padding(.trailing, CRTTheme.Spacing.md)
                    .padding(.top, CRTTheme.Spacing.xs)
            }

            Spacer()
        }
    }

    /// Beads filtered for Kanban display with search and overseer mode applied.
    /// Uses kanbanBeads (sorted + type-filtered, not status-filtered) since Kanban shows all columns.
    private var filteredBeadsForKanban: [BeadInfo] {
        var result = viewModel.kanbanBeads

        // Apply search filter
        if !viewModel.searchText.isEmpty {
            let query = viewModel.searchText.lowercased()
            result = result.filter { bead in
                bead.title.lowercased().contains(query) ||
                bead.id.lowercased().contains(query) ||
                (bead.description?.lowercased().contains(query) ?? false) ||
                (bead.assignee?.lowercased().contains(query) ?? false) ||
                bead.labels.contains { $0.lowercased().contains(query) }
            }
        }

        // Apply overseer mode filtering
        if appState.isOverseerMode {
            let excludedTypes = ["message", "epic", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]
            let excludedPatterns = ["witness", "wisp", "internal", "sync", "coordination", "mail delivery", "crew assignment", "heartbeat", "health check"]

            result = result.filter { bead in
                let typeLower = bead.type.lowercased()
                let titleLower = bead.title.lowercased()
                let idLower = bead.id.lowercased()
                let assigneeLower = (bead.assignee ?? "").lowercased()

                // Exclude wisp-related beads
                if typeLower.contains("wisp") || titleLower.contains("wisp") ||
                    idLower.contains("wisp") || assigneeLower.contains("wisp") {
                    return false
                }

                // Exclude operational types
                if excludedTypes.contains(typeLower) {
                    return false
                }

                // Exclude by title patterns
                if excludedPatterns.contains(where: { titleLower.contains($0) }) {
                    return false
                }

                // Exclude merge beads
                if titleLower.hasPrefix("merge:") {
                    return false
                }

                return true
            }
        }

        return result
    }
}

// MARK: - Preview

#Preview("Work Board") {
    BeadsListView()
        .environmentObject(AppCoordinator())
}
