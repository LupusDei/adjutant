import SwiftUI
import AdjutantKit

/// View for displaying a single file's content.
/// Renders markdown files with MarkdownTextView, plain text with monospaced font.
struct FileContentView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: FileContentViewModel

    init(projectId: String, filePath: String) {
        _viewModel = StateObject(wrappedValue: FileContentViewModel(
            projectId: projectId,
            filePath: filePath
        ))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                VStack {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    Spacer()
                }
            } else if let content = viewModel.fileContent {
                ScrollView {
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                        if content.isMarkdown {
                            MarkdownTextView(content.content)
                        } else {
                            // Plain text with monospaced font
                            Text(content.content)
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(theme.bright)
                        }
                    }
                    .padding(CRTTheme.Spacing.md)
                }
                // MarkdownTextView inline text (.text, .bold, .italic, .boldItalic)
                // does not set foregroundColor — it inherits from the parent context.
                // Without this, text renders as system default (black on dark bg = invisible).
                .foregroundColor(theme.primary)
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
            } else {
                // Default state before onAppear fires (isLoading=false, no content, no error).
                // Without this, the Group renders nothing against the dark background = black screen.
                VStack {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    Spacer()
                }
            }
        }
        .background(theme.background.screen)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                CRTText(viewModel.fileName.uppercased(), style: .subheader, glowIntensity: .medium)
            }
        }
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
    }
}

// MARK: - ViewModel

/// ViewModel for loading and displaying a single file's content.
@MainActor
final class FileContentViewModel: BaseViewModel {
    // MARK: - Published Properties

    @Published private(set) var fileContent: FileContent?

    // MARK: - Properties

    let projectId: String
    let filePath: String
    private let apiClient: APIClient

    /// Extract the file name from the path for display in the toolbar.
    var fileName: String {
        (filePath as NSString).lastPathComponent
    }

    // MARK: - Initialization

    init(projectId: String, filePath: String, apiClient: APIClient? = nil) {
        self.projectId = projectId
        self.filePath = filePath
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction {
            self.fileContent = try await self.apiClient.readProjectFile(
                projectId: self.projectId,
                path: self.filePath
            )
        }
    }
}
