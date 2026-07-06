import Foundation
import Combine
import AdjutantKit

/// Loads a message image attachment's bytes through the **authenticated** API
/// client (adj-203.5.3).
///
/// `GET /api/uploads/:id` is behind `apiKeyAuth`, so a bare `AsyncImage(url:)`
/// (which cannot attach the Bearer header) 401s. This loader delegates to
/// ``APIClient/fetchUploadData(id:)`` so the same auth header used for every
/// other API call is sent, and exposes a simple state machine the view binds to.
@MainActor
final class AttachmentImageLoader: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded(Data)
        case failed(String)
    }

    @Published private(set) var state: LoadState = .idle

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch the attachment bytes (authenticated). Idempotent-ish: re-entry
    /// restarts the load.
    func load(attachmentId: String) async {
        state = .loading
        do {
            let data = try await apiClient.fetchUploadData(id: attachmentId)
            state = .loaded(data)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
