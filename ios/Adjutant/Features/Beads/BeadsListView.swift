import SwiftUI
import AdjutantKit

/// Main beads view displaying all beads in a Kanban board with filtering and search.
/// Supports drag-and-drop between columns with optimistic updates.
struct BeadsListView: View {
    @StateObject private var viewModel = BeadsListViewModel()
    @EnvironmentObject private var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared
    @Environment(\.crtTheme) private var theme

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

                // Filter bar
                filterBar

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
        .background(CRTTheme.Background.screen)
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

            // Rig filter dropdown
            RigFilterDropdown(availableRigs: viewModel.rigOptions)

            // Count badge
            if viewModel.openCount > 0 {
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
        .background(CRTTheme.Background.panel)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            // Top row: Overseer toggle + Rig filter
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Overseer toggle
                overseerToggle

                Spacer()

                // Rig filter dropdown
                RigFilterDropdown(availableRigs: appState.availableRigs)
            }

            // Search field
            searchField
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.elevated)
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
        .background(CRTTheme.Background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
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
                coordinator.navigate(to: .beadDetail(id: bead.id))
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
        let fromColumn = mapStatusToColumn(bead.status)

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

    /// Beads filtered for Kanban display with overseer mode applied
    private var filteredBeadsForKanban: [BeadInfo] {
        var result = viewModel.filteredBeads

        // Apply overseer mode filtering
        if appState.isOverseerMode {
            let excludedTypes = ["message", "epic", "convoy", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]
            let excludedPatterns = ["witness", "wisp", "internal", "sync", "coordination", "mail delivery", "polecat", "crew assignment", "rig status", "heartbeat", "health check"]

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
