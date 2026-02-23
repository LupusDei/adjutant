import SwiftUI
import AdjutantKit

/// Detail view for displaying an epic and its subtasks
struct EpicDetailView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: EpicDetailViewModel

    init(epicId: String) {
        _viewModel = StateObject(wrappedValue: EpicDetailViewModel(epicId: epicId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                if let epic = viewModel.epic {
                    // Epic header
                    epicHeader(epic)

                    // Progress section
                    progressSection

                    // Subtasks sections
                    if !viewModel.openSubtasks.isEmpty {
                        subtaskSection("OPEN TASKS", subtasks: viewModel.openSubtasks)
                    }

                    if !viewModel.closedSubtasks.isEmpty {
                        subtaskSection("COMPLETED", subtasks: viewModel.closedSubtasks)
                    }

                    if viewModel.subtasks.isEmpty && !viewModel.isLoading {
                        noSubtasksView
                    }
                }

                // Loading indicator
                if viewModel.isLoading {
                    HStack {
                        Spacer()
                        LoadingIndicator(size: .medium)
                        Spacer()
                    }
                    .padding()
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
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton {
                    coordinator.pop()
                }
            }
            ToolbarItem(placement: .principal) {
                CRTText("EPIC DETAIL", style: .subheader, glowIntensity: .subtle)
            }
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Subviews

    private func epicHeader(_ epic: BeadInfo) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Title
            CRTText(epic.title, style: .header, glowIntensity: .medium)

            // Metadata row
            HStack(spacing: CRTTheme.Spacing.sm) {
                CRTText(epic.id.uppercased(), style: .mono, glowIntensity: .none, color: theme.dim)

                if let rig = epic.rig {
                    BadgeView(rig.uppercased(), style: .label)
                }

                Spacer()

                // Priority badge
                priorityBadge(epic.priority)
            }

            // Dates
            if !viewModel.formattedCreatedDate.isEmpty {
                HStack {
                    CRTText("CREATED:", style: .caption, glowIntensity: .none, color: theme.dim)
                    CRTText(viewModel.formattedCreatedDate, style: .caption, glowIntensity: .subtle)
                }
            }

            if !viewModel.formattedUpdatedDate.isEmpty {
                HStack {
                    CRTText("UPDATED:", style: .caption, glowIntensity: .none, color: theme.dim)
                    CRTText(viewModel.formattedUpdatedDate, style: .caption, glowIntensity: .subtle)
                }
            }
        }
        .padding(CRTTheme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(CRTTheme.Background.elevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack {
                CRTText("PROGRESS", style: .caption, glowIntensity: .subtle, color: theme.dim)
                Spacer()
                CRTText(viewModel.progressText, style: .mono, glowIntensity: .medium)
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 4)
                        .fill(theme.dim.opacity(0.2))
                        .frame(height: 12)

                    // Progress fill
                    RoundedRectangle(cornerRadius: 4)
                        .fill(progressColor)
                        .frame(width: geometry.size.width * viewModel.progress, height: 12)
                        .crtGlow(color: progressColor, radius: 6, intensity: 0.6)
                }
            }
            .frame(height: 12)

            // Status text
            HStack {
                Spacer()
                CRTText(
                    viewModel.isComplete ? "COMPLETE" : "IN PROGRESS",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: viewModel.isComplete ? CRTTheme.State.success : theme.primary
                )
            }
        }
        .padding(CRTTheme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(CRTTheme.Background.elevated)
        )
    }

    private func subtaskSection(_ title: String, subtasks: [BeadInfo]) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            HStack {
                CRTText(title, style: .caption, glowIntensity: .subtle, color: theme.dim)
                Spacer()
                CRTText("\(subtasks.count)", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
            }

            ForEach(subtasks) { subtask in
                subtaskRow(subtask)
            }
        }
    }

    private func subtaskRow(_ subtask: BeadInfo) -> some View {
        Button {
            coordinator.navigate(to: .beadDetail(id: subtask.id))
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status indicator
                Image(systemName: subtask.status == "closed" ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16))
                    .foregroundColor(subtask.status == "closed" ? CRTTheme.State.success : theme.dim)

                // Title
                VStack(alignment: .leading, spacing: 2) {
                    CRTText(subtask.title, style: .body, glowIntensity: .subtle)
                        .lineLimit(1)

                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(subtask.id.uppercased(), style: .caption, glowIntensity: .none, color: theme.dim)

                        if let assignee = subtask.assignee {
                            CRTText("→ \(assignee)", style: .caption, glowIntensity: .none, color: theme.dim)
                        }
                    }
                }

                Spacer()

                // Priority
                priorityBadge(subtask.priority)

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(theme.dim)
            }
            .padding(CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(CRTTheme.Background.elevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.dim.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func priorityBadge(_ priority: Int) -> some View {
        BadgeView("P\(priority)", style: .priority(priority))
    }

    private var noSubtasksView: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)

            CRTText("NO SUBTASKS", style: .body, glowIntensity: .subtle, color: theme.dim)
            CRTText("This epic has no linked tasks.", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    private var progressColor: Color {
        if viewModel.isComplete {
            return CRTTheme.State.success
        } else if viewModel.progress > 0.5 {
            return theme.primary
        } else if viewModel.progress > 0 {
            return CRTTheme.State.warning
        } else {
            return theme.dim
        }
    }
}

// MARK: - Preview

#Preview("Epic Detail") {
    NavigationStack {
        EpicDetailView(epicId: "adj-abc123")
            .environmentObject(AppCoordinator())
    }
}
