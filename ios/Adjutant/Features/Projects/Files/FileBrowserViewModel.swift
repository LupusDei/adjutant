import Foundation
import AdjutantKit

/// ViewModel for browsing project directories.
/// Manages directory listing, breadcrumb navigation, and path state.
@MainActor
final class FileBrowserViewModel: BaseViewModel {
    // MARK: - Published Properties

    @Published private(set) var entries: [DirectoryEntry] = []
    @Published var currentPath: String

    // MARK: - Properties

    let projectId: String
    let projectName: String
    private let apiClient: APIClient
    private var navigationTask: Task<Void, Never>?

    /// Breadcrumb path components for navigation.
    /// Always starts with the project name at root, then each path segment.
    var breadcrumbs: [(name: String, path: String)] {
        var result: [(String, String)] = [(projectName, "")]
        if !currentPath.isEmpty {
            let components = currentPath.split(separator: "/")
            var accumulated = ""
            for component in components {
                accumulated += (accumulated.isEmpty ? "" : "/") + component
                result.append((String(component), accumulated))
            }
        }
        return result
    }

    // MARK: - Initialization

    init(projectId: String, projectName: String, initialPath: String = "", apiClient: APIClient? = nil) {
        self.projectId = projectId
        self.projectName = projectName
        self.currentPath = initialPath
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: entries.isEmpty) {
            self.entries = try await self.apiClient.listProjectFiles(
                projectId: self.projectId,
                path: self.currentPath
            )
        }
    }

    // MARK: - Navigation

    /// Navigate to a directory path and reload entries.
    /// Cancels any in-flight navigation to prevent stale data from a previous request
    /// overwriting the current directory's entries (adj-3ho9).
    func navigateTo(path: String) {
        navigationTask?.cancel()
        currentPath = path
        entries = []  // Clear stale entries immediately to show loading state (adj-npky)
        navigationTask = Task<Void, Never> { await refresh() }
    }
}
