import Foundation
import Combine

/// Observable view model owning the Artifacts library: the list, load/error state, the
/// publish / unpublish / create / delete operations, and the selection that drives the
/// list → viewer flow (epic adj-j7az6, Phase 4 / US4).
///
/// Lives in AdjutantKit (not the app target) so all of this logic is unit-testable
/// without an app host. The active server base URL is injected as a closure
/// (`serverBaseURL`) — the app passes `{ ServerProfileStore.shared.active?.baseURL }` —
/// so per-artifact share URLs are always built from the active server via
/// ``publicArtifactURL(base:token:)``.
@MainActor
public final class ArtifactsViewModel: ObservableObject {
    /// The artifacts library, newest-first.
    @Published public private(set) var artifacts: [Artifact] = []
    /// True while the initial list load is in flight.
    @Published public private(set) var isLoading: Bool = false
    /// True while a mutating op (publish/unpublish/create/delete) is in flight.
    @Published public private(set) var isWorking: Bool = false
    /// Human-readable error message from the last failed operation, else nil.
    @Published public private(set) var errorMessage: String?
    /// The artifact currently selected for viewing, else nil.
    @Published public var selectedArtifact: Artifact?
    /// The composed, self-contained document for the selected artifact (drives the
    /// WKWebView viewer), else nil.
    @Published public private(set) var documentHTML: String?
    /// True while the selected artifact's composed document is being fetched.
    @Published public private(set) var isLoadingDocument: Bool = false
    /// Error message from the last document fetch, else nil.
    @Published public private(set) var documentError: String?

    private let apiClient: APIClient
    private let serverBaseURL: () -> String?

    public init(apiClient: APIClient, serverBaseURL: @escaping () -> String?) {
        self.apiClient = apiClient
        self.serverBaseURL = serverBaseURL
    }

    /// True when the library is empty (drives the empty-state UI).
    public var isEmpty: Bool { artifacts.isEmpty }

    // MARK: - Load

    /// Fetches the artifacts library (newest-first). Sets `errorMessage` on failure.
    public func load() async {
        isLoading = true
        errorMessage = nil
        do {
            artifacts = try await apiClient.fetchArtifacts()
        } catch {
            errorMessage = Self.describe(error)
        }
        isLoading = false
    }

    // MARK: - Selection

    /// Select an artifact for viewing.
    public func select(_ artifact: Artifact) {
        selectedArtifact = artifact
    }

    /// Clear the current selection.
    public func clearSelection() {
        selectedArtifact = nil
    }

    // MARK: - Viewer (composed document)

    /// Select an artifact and fetch its composed, self-contained document for the WKWebView
    /// viewer. Works for PRIVATE artifacts (authed owner download endpoint). Sets
    /// `documentError` on failure.
    public func openDocument(for artifact: Artifact) async {
        selectedArtifact = artifact
        documentHTML = nil
        documentError = nil
        isLoadingDocument = true
        do {
            documentHTML = try await apiClient.downloadArtifactDocument(id: artifact.id)
        } catch {
            documentError = Self.describe(error)
        }
        isLoadingDocument = false
    }

    /// Dismiss the viewer: clears the selection and the fetched document/error.
    public func closeDocument() {
        selectedArtifact = nil
        documentHTML = nil
        documentError = nil
        isLoadingDocument = false
    }

    // MARK: - Create

    /// Creates a new artifact from authored HTML and prepends it (newest-first). Returns
    /// the created artifact on success, or nil on failure (with `errorMessage` set).
    @discardableResult
    public func create(title: String, html: String, description: String? = nil) async -> Artifact? {
        guard !isWorking else { return nil }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let created = try await apiClient.createArtifact(
                title: title,
                html: html,
                description: description
            )
            artifacts.insert(created, at: 0)
            return created
        } catch {
            errorMessage = Self.describe(error)
            return nil
        }
    }

    // MARK: - Publish / Unpublish

    /// Publishes an artifact and updates it in place. No-op if another op is in flight.
    public func publish(_ artifact: Artifact) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await apiClient.publishArtifact(id: artifact.id)
            replace(result.artifact)
        } catch {
            errorMessage = Self.describe(error)
        }
    }

    /// Unpublishes an artifact and updates it in place. No-op if another op is in flight.
    public func unpublish(_ artifact: Artifact) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let updated = try await apiClient.unpublishArtifact(id: artifact.id)
            replace(updated)
        } catch {
            errorMessage = Self.describe(error)
        }
    }

    /// Toggles publish state based on the artifact's current value.
    public func togglePublished(_ artifact: Artifact) async {
        if artifact.isPublished {
            await unpublish(artifact)
        } else {
            await publish(artifact)
        }
    }

    // MARK: - Delete

    /// Deletes an artifact and removes it from the list; clears selection if it was selected.
    public func delete(_ artifact: Artifact) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await apiClient.deleteArtifact(id: artifact.id)
            artifacts.removeAll { $0.id == artifact.id }
            if selectedArtifact?.id == artifact.id {
                selectedArtifact = nil
            }
        } catch {
            errorMessage = Self.describe(error)
        }
    }

    // MARK: - Share URL

    /// The public share URL for an artifact, built from the active server base and the
    /// artifact's share token. Returns nil when the artifact is not published, has no
    /// token, or there is no active server — i.e. there is nothing valid to share.
    public func shareURL(for artifact: Artifact) -> URL? {
        guard artifact.isPublished,
              let token = artifact.shareToken,
              let base = serverBaseURL() else {
            return nil
        }
        return publicArtifactURL(base: base, token: token)
    }

    // MARK: - Private

    /// Replace an artifact in the list (and the selection, if it is the selected one) by id.
    private func replace(_ updated: Artifact) {
        if let idx = artifacts.firstIndex(where: { $0.id == updated.id }) {
            artifacts[idx] = updated
        }
        if selectedArtifact?.id == updated.id {
            selectedArtifact = updated
        }
    }

    private static func describe(_ error: Error) -> String {
        if let apiError = error as? APIClientError {
            return apiError.localizedDescription
        }
        return error.localizedDescription
    }
}
