import SwiftUI
import AdjutantKit

/// File browser view for navigating project directories.
/// Shows breadcrumb navigation, directory entries with folder/file icons,
/// and supports drilling into subdirectories or opening files.
struct FileBrowserView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: FileBrowserViewModel
    @EnvironmentObject private var coordinator: AppCoordinator

    init(projectId: String, projectName: String, initialPath: String = "") {
        _viewModel = StateObject(wrappedValue: FileBrowserViewModel(
            projectId: projectId,
            projectName: projectName,
            initialPath: initialPath
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Breadcrumb bar
            breadcrumbBar

            // Content
            if viewModel.isLoading {
                Spacer()
                LoadingIndicator(size: .medium)
                Spacer()
            } else if let error = viewModel.errorMessage {
                VStack {
                    Spacer()
                    ErrorBanner(
                        message: error,
                        onRetry: { Task<Void, Never> { await viewModel.refresh() } },
                        onDismiss: { viewModel.clearError() }
                    )
                    .padding(CRTTheme.Spacing.md)
                    Spacer()
                }
            } else if viewModel.entries.isEmpty {
                Spacer()
                CRTText("EMPTY DIRECTORY", style: .caption, color: theme.dim)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: CRTTheme.Spacing.xxs) {
                        ForEach(viewModel.entries) { entry in
                            entryRow(entry)
                        }
                    }
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                }
            }
        }
        .background(theme.background.screen)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                CRTText("FILES", style: .subheader, glowIntensity: .medium)
            }
        }
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
    }

    // MARK: - Breadcrumb Bar

    /// Horizontal scrolling breadcrumb bar showing path components.
    /// Each component is tappable to navigate back to that directory level.
    private var breadcrumbBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                ForEach(Array(viewModel.breadcrumbs.enumerated()), id: \.offset) { index, crumb in
                    if index > 0 {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10))
                            .foregroundColor(theme.dim)
                    }
                    Button {
                        viewModel.navigateTo(path: crumb.path)
                    } label: {
                        CRTText(
                            crumb.name.uppercased(),
                            style: .caption,
                            color: index == viewModel.breadcrumbs.count - 1 ? theme.primary : theme.dim
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)
        }
        .background(theme.background.panel)
        .overlay(
            Rectangle()
                .fill(theme.dim.opacity(0.2))
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Entry Row

    private func entryRow(_ entry: DirectoryEntry) -> some View {
        Button {
            if entry.isDirectory {
                viewModel.navigateTo(path: entry.path)
            } else {
                coordinator.navigate(to: .projectFile(
                    projectId: viewModel.projectId,
                    projectName: viewModel.projectName,
                    filePath: entry.path
                ))
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: entry.isDirectory ? "folder.fill" : (entry.isMarkdown ? "doc.text" : "doc"))
                    .font(.system(size: 16))
                    .foregroundColor(entry.isDirectory ? theme.primary : theme.dim)
                    .frame(width: 24)

                CRTText(entry.name, style: .body, color: entry.isDirectory ? theme.primary : theme.bright)

                Spacer()

                if !entry.isDirectory {
                    CRTText(formatFileSize(entry.size), style: .caption, color: theme.dim)
                }

                if entry.isDirectory {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundColor(theme.dim)
                }
            }
            .padding(.vertical, CRTTheme.Spacing.xs)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(theme.dim.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.dim.opacity(0.15), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    /// Format byte count into human-readable file size.
    private func formatFileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(bytes / 1024) KB" }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }
}
